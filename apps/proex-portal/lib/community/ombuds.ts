import { LEGACY_ORGANIZATION_ID, platformOwnerAuthoritySql, type PortalActor } from '../access';
import { all, one, uid, iso } from '../database';
import { HttpError } from '../errors';
import { serverWorkClock } from '../follow-up/time';
import { normalizeOmbudsCode } from './ombuds-code';
import { expectedVersion, identifier, only, personText, requireActor, requireInternalMember } from './shared';

/*
 * Anonymous ombuds (ouvidoria). What makes it anonymous is what is NOT written:
 * - no author column, no audit row, no mutation key, no per-person rate counter for the reporter side;
 * - only civil days (Brasília), never instants; random ids in WITHOUT ROWID tables;
 * - the tracking code travels in the POST body and only its SHA-256 is stored.
 * The session is checked (internal members only) and then discarded. Replies BY the ombuds are audited
 * with the responder's id: the ombuds is accountable, the reporter is not identifiable.
 */
export const OMBUDS_CATEGORIES = ['conduct', 'workload', 'environment', 'process', 'platform', 'other'] as const;
const STATUSES = ['received', 'reviewing', 'answered', 'closed'] as const;
export const OMBUDS_DAILY_REPORTS = 40;
export const OMBUDS_DAILY_MESSAGES_PER_REPORT = 10;
/** Collective ceiling for reporter messages per day, so the shared database cannot be inflated. */
export const OMBUDS_DAILY_MESSAGES = 200;
/*
 * Per-person brake kept ONLY in this process's memory (never written anywhere, lost on restart or on another
 * serverless instance). It slows down one person flooding the collective ceiling without creating a record.
 */
export const OMBUDS_MEMORY_LIMIT = 5, OMBUDS_MEMORY_WINDOW_MS = 3600000;
const memoryBrake = new Map<string, number[]>();
export function resetOmbudsMemoryBrake() { memoryBrake.clear(); }
function brake(userId: string, now = Date.now()) {
  const recent = (memoryBrake.get(userId) ?? []).filter(at => now - at < OMBUDS_MEMORY_WINDOW_MS);
  if (recent.length >= OMBUDS_MEMORY_LIMIT) throw new HttpError(429, 'Você enviou muitas mensagens à ouvidoria em pouco tempo. Tente de novo mais tarde.', 'ombuds_memory_limit');
  recent.push(now); memoryBrake.set(userId, recent);
  if (memoryBrake.size > 5000) for (const [key, times] of memoryBrake) if (!times.some(at => now - at < OMBUDS_MEMORY_WINDOW_MS)) memoryBrake.delete(key);
}
const today = () => serverWorkClock().today;

async function codeHash(code: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`proex-ouvidoria:v1:${code}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function code(value: unknown) {
  const normalized = normalizeOmbudsCode(value);
  if (!normalized) throw new HttpError(400, 'Confira o código de acompanhamento. Ele tem o formato OUV-XXXX-XXXX-XXXX-XXXX-XXXX.', 'invalid_ombuds_code');
  return normalized;
}
function failure(error: unknown, extra: Record<string, HttpError> = {}): never {
  const text = String(error);
  if (text.includes('community_access_changed')) throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'community_access_changed');
  if (text.includes('ombuds_daily_limit')) throw new HttpError(429, 'A ouvidoria recebeu muitos relatos hoje. Tente amanhã ou procure a gestão por outro canal.', 'ombuds_daily_limit');
  if (text.includes('ombuds_message_limit')) throw new HttpError(429, 'Este relato já recebeu muitas mensagens hoje. Continue amanhã.', 'ombuds_message_limit');
  if (text.includes('ombuds_closed')) throw new HttpError(409, 'Este relato foi encerrado pela ouvidoria. Se precisar, abra um novo relato.', 'ombuds_closed');
  for (const [marker, mapped] of Object.entries(extra)) if (text.includes(marker)) throw mapped;
  throw error;
}
const guard = (sql: string, marker: string) => `SELECT CASE WHEN ${sql} THEN 1 ELSE json_extract('[]','${marker}') END`;

async function thread(db: D1Database, reportId: string) {
  return await all(db, 'SELECT side,body,sent_on sentOn,seq FROM ombuds_messages WHERE report_id=? ORDER BY seq', [reportId]);
}

/** Reporter side: submit, track by code and add a message. */
export async function ombudsReporterAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor);
  const member = await requireInternalMember(db, actor);
  if (input.action === 'submit') {
    only(input, ['action', 'code', 'category', 'body']);
    const normalized = code(input.code), hash = await codeHash(normalized);
    if (!OMBUDS_CATEGORIES.includes(input.category as typeof OMBUDS_CATEGORIES[number])) throw new HttpError(400, 'Escolha um tema para o relato.', 'invalid_ombuds_category');
    const body = personText(input.body, 10, 4000, 'Escreva o relato em 10 a 4.000 caracteres.');
    const existing = await one(db, 'SELECT r.id,(SELECT body FROM ombuds_messages WHERE report_id=r.id AND seq=1) first FROM ombuds_reports r WHERE r.code_hash=?', [hash]);
    if (existing) {
      if (existing.first === body) return { received: true, duplicate: true };
      throw new HttpError(409, 'Este código já foi usado. Gere um novo código antes de enviar.', 'ombuds_code_used');
    }
    brake(actor.userId);
    const id = uid(), day = today();
    try {
      await db.batch([
        db.prepare(guard(member.sql, 'community_access_changed')).bind(...member.values),
        db.prepare(guard('(SELECT COUNT(*) FROM ombuds_reports WHERE received_on=?)<?', 'ombuds_daily_limit')).bind(day, OMBUDS_DAILY_REPORTS),
        db.prepare('INSERT INTO ombuds_reports(id,code_hash,category,status,received_on,updated_on,version) VALUES(?,?,?,\'received\',?,?,1)').bind(id, hash, input.category, day, day),
        db.prepare('INSERT INTO ombuds_messages(id,report_id,side,body,sent_on,seq) VALUES(?,?,\'reporter\',?,?,1)').bind(uid(), id, body, day),
      ]);
    } catch (error) {
      if (/UNIQUE/i.test(String(error))) {
        const raced = await one(db, 'SELECT (SELECT body FROM ombuds_messages WHERE report_id=r.id AND seq=1) first FROM ombuds_reports r WHERE r.code_hash=?', [hash]);
        if (raced?.first === body) return { received: true, duplicate: true };
        throw new HttpError(409, 'Este código já foi usado. Gere um novo código antes de enviar.', 'ombuds_code_used');
      }
      failure(error);
    }
    return { received: true, duplicate: false };
  }
  if (input.action === 'readers') {
    only(input, ['action']);
    return { readers: await ombudsReaders(db) };
  }
  if (input.action === 'track') {
    only(input, ['action', 'code']);
    const report = await one(db, 'SELECT id,category,status,received_on receivedOn,updated_on updatedOn,version FROM ombuds_reports WHERE code_hash=?', [await codeHash(code(input.code))]);
    if (!report) throw new HttpError(404, 'Nenhum relato com este código. Confira as letras e os números.', 'ombuds_not_found');
    const { id, ...visible } = report;
    return { report: visible, messages: await thread(db, id) };
  }
  if (input.action === 'reply') {
    only(input, ['action', 'code', 'body']);
    const hash = await codeHash(code(input.code));
    const body = personText(input.body, 2, 4000, 'Escreva a mensagem em 2 a 4.000 caracteres.');
    const report = await one(db, 'SELECT id FROM ombuds_reports WHERE code_hash=?', [hash]);
    if (!report) throw new HttpError(404, 'Nenhum relato com este código. Confira as letras e os números.', 'ombuds_not_found');
    brake(actor.userId);
    const day = today();
    try {
      await db.batch([
        db.prepare(guard(member.sql, 'community_access_changed')).bind(...member.values),
        db.prepare(guard("(SELECT status FROM ombuds_reports WHERE id=?)!='closed'", 'ombuds_closed')).bind(report.id),
        db.prepare(guard("(SELECT COUNT(*) FROM ombuds_messages WHERE side='reporter' AND sent_on=? AND seq>1)<?", 'ombuds_message_limit')).bind(day, OMBUDS_DAILY_MESSAGES),
        db.prepare(guard("(SELECT COUNT(*) FROM ombuds_messages WHERE report_id=? AND side='reporter' AND sent_on=?)<?", 'ombuds_message_limit')).bind(report.id, day, OMBUDS_DAILY_MESSAGES_PER_REPORT),
        db.prepare("INSERT INTO ombuds_messages(id,report_id,side,body,sent_on,seq) VALUES(?,?,'reporter',?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM ombuds_messages WHERE report_id=?))").bind(uid(), report.id, body, day, report.id),
        db.prepare("UPDATE ombuds_reports SET status='received',updated_on=?,version=version+1 WHERE id=?").bind(day, report.id),
      ]);
    } catch (error) { failure(error); }
    return { sent: true };
  }
  throw new HttpError(400, 'Operação da ouvidoria inválida.', 'invalid_action');
}

/** Ombuds side: platform owners only. Never returns or stores anything about the reporter. */
/*
 * Who reads the ombuds (Yan, 2026-11-09: "a princípio... é a administração geral e as pessoas que têm acesso total";
 * "pode ser alguém designado pela Proex também"):
 * - by default, active owners and managers with no project restriction, portal-wide or in the PROEX organization itself
 *   (`org_proex`: non-owner members without a project are filled into it by migration 0008);
 * - plus people designated by the general administration, between the start and end dates, until revoked.
 * Readers never see the author: there is no author anywhere to see.
 */
const PORTAL_WIDE_READER = (userSql: string) => `EXISTS(SELECT 1 FROM members ow JOIN portal_users owu ON owu.user_id=ow.user_id WHERE ow.user_id=${userSql}
  AND ow.role IN ('owner','manager') AND ow.project_id IS NULL AND (ow.organization_id IS NULL OR ow.organization_id='${LEGACY_ORGANIZATION_ID}') AND ow.revoked_at IS NULL
  AND owu.status='active' AND owu.activation_pending=0 AND owu.anonymized_at IS NULL)`;
const DESIGNATED_READER = (userSql: string, daySql: string) => `EXISTS(SELECT 1 FROM ombuds_designations od JOIN portal_users odu ON odu.user_id=od.user_id
  WHERE od.user_id=${userSql} AND od.revoked_at IS NULL AND od.starts_on<=${daySql} AND od.ends_on>=${daySql}
  AND odu.status='active' AND odu.activation_pending=0 AND odu.anonymized_at IS NULL
  AND EXISTS(SELECT 1 FROM members odm WHERE odm.user_id=od.user_id AND odm.revoked_at IS NULL))`;
function ombudsAuthority(actor: PortalActor) {
  return { sql: `(SELECT 1 FROM (SELECT ? me,? day) oa WHERE ${PORTAL_WIDE_READER('oa.me')} OR ${DESIGNATED_READER('oa.me', 'oa.day')}) IS NOT NULL`, values: [actor.userId, today()] };
}
async function requireOmbuds(db: D1Database, actor: PortalActor) {
  const authority = ombudsAuthority(actor);
  if (!await db.prepare(`SELECT 1 AS ok WHERE ${authority.sql}`).bind(...authority.values).first()) throw new HttpError(403, 'Só quem lê a ouvidoria (administração geral, acesso total ou pessoa designada) consulta os relatos.', 'ombuds_forbidden');
  return authority;
}
/** Names of who can read the ombuds right now, shown to the person before writing. Names only. */
export async function ombudsReaders(db: D1Database) {
  const day = today();
  const rows = await all(db, `SELECT u.user_id id,COALESCE(NULLIF(p.display_name,''),'Pessoa da equipe') name,
      CASE WHEN ${PORTAL_WIDE_READER('u.user_id')} THEN 'access' ELSE 'designated' END basis,
      (SELECT MAX(od.ends_on) FROM ombuds_designations od WHERE od.user_id=u.user_id AND od.revoked_at IS NULL AND od.starts_on<=? AND od.ends_on>=?) until
    FROM portal_users u LEFT JOIN profiles p ON p.user_id=u.user_id
    WHERE ${PORTAL_WIDE_READER('u.user_id')} OR ${DESIGNATED_READER('u.user_id', '?')} ORDER BY basis,name LIMIT 100`, [day, day, day, day]);
  // Names, basis and end date only: no internal ids leave for every member.
  return rows.map(row => ({ name: String(row.name), basis: row.basis === 'access' ? 'access' : 'designated', until: row.basis === 'access' ? null : row.until ?? null }));
}
/** Designations are managed only by the general administration (active global owner). */
async function requireAdministration(db: D1Database, actor: PortalActor) {
  const owner = platformOwnerAuthoritySql(actor);
  if (!await db.prepare(`SELECT 1 AS ok WHERE ${owner.sql}`).bind(...owner.values).first()) throw new HttpError(403, 'Só a administração geral designa quem lê a ouvidoria.', 'ombuds_designation_forbidden');
  return owner;
}
export async function canManageOmbudsDesignations(db: D1Database, actor: PortalActor | null) {
  if (!actor) return false;
  const owner = platformOwnerAuthoritySql(actor);
  return !!await db.prepare(`SELECT 1 AS ok WHERE ${owner.sql}`).bind(...owner.values).first();
}
const civil = (value: unknown, label: string) => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value) throw new HttpError(400, `Escolha a data de ${label}.`, 'invalid_designation_date'); return value; };
export async function ombudsDesignationAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor);
  const owner = await requireAdministration(db, actor);
  const now = iso();
  if (input.action === 'designations') {
    only(input, ['action']);
    const history = await all(db, `SELECT d.id,d.user_id userId,COALESCE(NULLIF(p.display_name,''),'Pessoa da equipe') name,d.reason,d.starts_on startsOn,d.ends_on endsOn,d.created_at createdAt,
      COALESCE(NULLIF(bp.display_name,''),'Administração') designatedByName,d.revoked_at revokedAt,COALESCE(NULLIF(rp.display_name,''),'Administração') revokedByName,d.revoke_reason revokeReason
      FROM ombuds_designations d LEFT JOIN profiles p ON p.user_id=d.user_id LEFT JOIN profiles bp ON bp.user_id=d.designated_by LEFT JOIN profiles rp ON rp.user_id=d.revoked_by
      ORDER BY d.revoked_at IS NOT NULL, d.created_at DESC LIMIT 200`);
    const candidates = await all(db, `SELECT DISTINCT u.user_id id,COALESCE(NULLIF(p.display_name,''),'Pessoa da equipe') name FROM portal_users u JOIN members m ON m.user_id=u.user_id AND m.revoked_at IS NULL
      LEFT JOIN profiles p ON p.user_id=u.user_id WHERE u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL ORDER BY name LIMIT 1000`);
    return { history, candidates, readers: await ombudsReaders(db), today: today() };
  }
  if (input.action === 'designate') {
    only(input, ['action', 'userId', 'reason', 'startsOn', 'endsOn']);
    const userId = identifier(input.userId, 'a pessoa'), reason = personText(input.reason, 3, 300, 'Explique o motivo em 3 a 300 caracteres.');
    const startsOn = civil(input.startsOn, 'início'), endsOn = civil(input.endsOn, 'fim');
    if (endsOn < startsOn) throw new HttpError(400, 'O fim precisa ser igual ou depois do início.', 'invalid_designation_date');
    if (endsOn < today()) throw new HttpError(400, 'Uma designação que já terminou não dá acesso. Escolha outra data de fim.', 'invalid_designation_date');
    const id = uid();
    try {
      await db.batch([
        db.prepare(`SELECT CASE WHEN ${owner.sql} THEN 1 ELSE json_extract('[]','ombuds_designation_forbidden') END`).bind(...owner.values),
        db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM portal_users u JOIN members m ON m.user_id=u.user_id AND m.revoked_at IS NULL WHERE u.user_id=? AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL) THEN 1 ELSE json_extract('[]','ombuds_designee_unavailable') END").bind(userId),
        db.prepare('INSERT INTO ombuds_designations(id,user_id,designated_by,reason,starts_on,ends_on,created_at) VALUES(?,?,?,?,?,?,?)').bind(id, userId, actor.userId, reason, startsOn, endsOn, now),
        db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,NULL,'ombuds.designate',?,?,?)").bind(uid(), actor.userId, id, JSON.stringify({ startsOn, endsOn }), now),
      ]);
    } catch (error) {
      if (String(error).includes('ombuds_designee_unavailable')) throw new HttpError(409, 'Esta pessoa não tem acesso ativo ao portal.', 'ombuds_designee_unavailable');
      if (String(error).includes('ombuds_designation_forbidden')) throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'ombuds_designation_forbidden');
      throw error;
    }
    return { id };
  }
  if (input.action === 'revoke') {
    only(input, ['action', 'id', 'reason']);
    const id = identifier(input.id, 'a designação'), reason = personText(input.reason, 3, 300, 'Explique o motivo em 3 a 300 caracteres.');
    const results = await db.batch([
      db.prepare(`UPDATE ombuds_designations SET revoked_at=?,revoked_by=?,revoke_reason=? WHERE id=? AND revoked_at IS NULL AND ${owner.sql}`).bind(now, actor.userId, reason, id, ...owner.values),
      db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,'ombuds.designation.revoke',?,'{}',? WHERE changes()=1").bind(uid(), actor.userId, id, now),
    ]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, 'Esta designação já foi revogada ou mudou. Atualize a lista.', 'ombuds_designation_changed');
    return { id };
  }
  throw new HttpError(400, 'Operação de designação inválida.', 'invalid_action');
}
export async function canReadOmbuds(db: D1Database, actor: PortalActor | null) {
  if (!actor) return false;
  const authority = ombudsAuthority(actor);
  return !!await db.prepare(`SELECT 1 AS ok WHERE ${authority.sql}`).bind(...authority.values).first();
}
export async function ombudsInbox(db: D1Database, rawActor: PortalActor | null) {
  const actor = requireActor(rawActor);
  await requireOmbuds(db, actor);
  const rows = await all(db, `SELECT r.id,r.category,r.status,r.received_on receivedOn,r.updated_on updatedOn,r.version,
    (SELECT substr(body,1,160) FROM ombuds_messages WHERE report_id=r.id AND seq=1) excerpt,
    (SELECT COUNT(*) FROM ombuds_messages WHERE report_id=r.id) messages
    FROM ombuds_reports r ORDER BY CASE r.status WHEN 'received' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'answered' THEN 2 ELSE 3 END, r.updated_on DESC, r.id LIMIT 101`);
  return { reports: rows.slice(0, 100), hasMore: rows.length > 100 };
}
export async function ombudsManageAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor);
  const authority = await requireOmbuds(db, actor);
  if (input.action === 'detail') {
    only(input, ['action', 'id']);
    const id = identifier(input.id, 'o relato');
    const report = await one(db, 'SELECT id,category,status,received_on receivedOn,updated_on updatedOn,version FROM ombuds_reports WHERE id=?', [id]);
    if (!report) throw new HttpError(404, 'Relato não encontrado.', 'ombuds_not_found');
    return { report, messages: await thread(db, id) };
  }
  if (input.action === 'respond' || input.action === 'status') {
    only(input, input.action === 'respond' ? ['action', 'id', 'body', 'status', 'expectedVersion'] : ['action', 'id', 'status', 'expectedVersion']);
    const id = identifier(input.id, 'o relato'), version = expectedVersion(input.expectedVersion);
    const status = input.status ?? (input.action === 'respond' ? 'answered' : undefined);
    if (!STATUSES.includes(status as typeof STATUSES[number]) || status === 'received') throw new HttpError(400, 'Escolha o estado do relato.', 'invalid_ombuds_status');
    const body = input.action === 'respond' ? personText(input.body, 2, 4000, 'Escreva a resposta em 2 a 4.000 caracteres.') : null;
    const day = today(), now = iso();
    const statements = [
      db.prepare(`UPDATE ombuds_reports SET status=?,updated_on=?,version=version+1 WHERE id=? AND version=? AND ${authority.sql}`).bind(status, day, id, version, ...authority.values),
      db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','ombuds_changed') END"),
    ];
    if (body) statements.push(db.prepare("INSERT INTO ombuds_messages(id,report_id,side,body,sent_on,seq) VALUES(?,?,'ombuds',?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM ombuds_messages WHERE report_id=?))").bind(uid(), id, body, day, id));
    // Accountability of the ombuds; no reporter data exists to be written here.
    statements.push(db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,NULL,?,?,?,?)")
      .bind(uid(), actor.userId, input.action === 'respond' ? 'ombuds.respond' : 'ombuds.status', id, JSON.stringify({ status }), now));
    try { await db.batch(statements); }
    catch (error) { failure(error, { ombuds_changed: new HttpError(409, 'O relato mudou enquanto você respondia. Atualize e confira.', 'ombuds_changed') }); }
    return { id };
  }
  throw new HttpError(400, 'Operação da ouvidoria inválida.', 'invalid_action');
}
