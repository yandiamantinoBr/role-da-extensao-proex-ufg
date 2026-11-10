import type {PortalActor} from '../access';
import {all,one,type Row} from '../database';
import {syncDigest} from '../sync/contracts';
import {activeAccount} from '../follow-up/scope';
import {emailAddress,emailDispatchInternals as e,emailOwnerCheck,type EmailDispatcher} from '../follow-up/email';
import {preferences} from './service';
import {DEFAULT_PREFERENCES,type NoticeKind} from './shared';

/*
 * Who is told about a convocation: its listed responsibles (still members of the organization) and the managers
 * of each invited project (members with role 'manager' scoped to that project). Notices never carry a guest's
 * name or enrollment: only counts and the link to the portal, where access is checked again.
 *
 * Channels (see docs/CONVOCACOES-E-AVISOS.md):
 *  - bell: computed on read from the event log and the person's receipt; no extra table.
 *  - email: through the MailApp dispatch the portal already uses (consent, quotas, interval and credential of the
 *    demand notices), own queue `convocation_email_queue`, ids `cv-…`. Offered only to an Apps Script that declares
 *    `kinds` including 'convocation'.
 *  - whatsapp: prepared, off. Preferences reject enabling it until the official number exists.
 */
export const CONVOCATION_EMAIL_PREFIX = 'cv-';
export const CONVOCATION_EMAIL_SUBJECT = 'PROEX · Convocação';
export const isConvocationEmailId = (value: unknown) => typeof value === 'string' && value.startsWith(CONVOCATION_EMAIL_PREFIX);
export const CHANNEL_STATUS = {
  bell: { enabled: true, label: 'Sino do portal' },
  email: { enabled: true, label: 'E-mail (MailApp da organização)', requires: 'consentimento de e-mail em Configurações e o script de avisos atualizado' },
  whatsapp: { enabled: false, label: 'WhatsApp', requires: 'depende de um número oficial da PROEX na WhatsApp Business Platform, contratado por um parceiro autorizado pela Meta. Por enquanto, use o sino e o e-mail' },
} as const;

/** SQL true when `user` should hear about convocation `c` (responsible still in the organization, or manager of an invited project). */
export function recipientSql(user: string, c = 'c') {
  return `(EXISTS(SELECT 1 FROM convocation_responsibles rr JOIN members rm ON rm.user_id=rr.user_id AND rm.revoked_at IS NULL AND (rm.organization_id=${c}.organization_id OR rm.organization_id IS NULL)
      WHERE rr.convocation_id=${c}.id AND rr.user_id=${user})
    OR EXISTS(SELECT 1 FROM convocation_projects rcp JOIN members pm ON pm.project_id=rcp.project_id AND pm.revoked_at IS NULL AND pm.role='manager' WHERE rcp.convocation_id=${c}.id AND pm.user_id=${user}))`;
}
/** Projects of the convocation the person follows: all for a responsible, otherwise the ones they manage. */
function followedProjectsSql(user: string, c = 'c') {
  return `(EXISTS(SELECT 1 FROM convocation_responsibles fr WHERE fr.convocation_id=${c}.id AND fr.user_id=${user}) OR EXISTS(SELECT 1 FROM members fm WHERE fm.user_id=${user} AND fm.revoked_at IS NULL AND fm.role='manager' AND fm.project_id=cp.project_id))`;
}

/** Bell items: open convocations the person follows, new answers since they last opened it, projects still silent, deadline close. */
export async function convocationInbox(db: D1Database, actor: PortalActor | null) {
  if (!actor) return { items: [], unread: 0 };
  const prefs = await preferences(db, actor.userId), now = Date.now();
  const rows = await all(db, `SELECT c.id,c.title,c.edition,c.event_date,c.response_deadline,COALESCE(r.seen_sequence,0) seen FROM convocations c
    JOIN organizations o ON o.id=c.organization_id AND o.status='active' JOIN portal_users me ON me.user_id=? AND ${activeAccount('me')}
    LEFT JOIN convocation_receipts r ON r.user_id=? AND r.convocation_id=c.id
    WHERE c.status='open' AND c.purged_at IS NULL AND ${recipientSql('?')} ORDER BY c.event_date,c.id LIMIT 50`, [actor.userId, actor.userId, actor.userId, actor.userId]);
  const items = [];
  for (const row of rows) {
    const projects = await all(db, `SELECT cp.project_id,p.name,EXISTS(SELECT 1 FROM convocation_guests g WHERE g.convocation_id=cp.convocation_id AND g.project_id=cp.project_id) answered
      FROM convocation_projects cp JOIN projects p ON p.id=cp.project_id JOIN convocations c ON c.id=cp.convocation_id WHERE cp.convocation_id=? AND ${followedProjectsSql('?')} ORDER BY p.name`, [row.id, actor.userId, actor.userId]);
    const followed = projects.map(project => String(project.project_id));
    const fresh = followed.length ? Number((await one(db, `SELECT COUNT(*) n FROM convocation_events WHERE convocation_id=? AND sequence>? AND kind IN('response_created','response_updated') AND project_id IN(${followed.map(() => '?').join(',')})`, [row.id, row.seen, ...followed]))?.n ?? 0) : 0;
    const silent = projects.filter(project => !project.answered).map(project => String(project.name));
    const deadline = row.response_deadline ? Date.parse(String(row.response_deadline)) : null;
    const deadlineSoon = deadline !== null && deadline > now && deadline - now <= 48 * 3_600_000 && silent.length > 0;
    const showResponses = prefs.response.bell && fresh > 0, showReminder = prefs.reminder.bell && deadlineSoon, showDigest = prefs.digest.bell && silent.length > 0;
    if (!showResponses && !showReminder && !showDigest) continue;
    items.push({ convocationId: row.id, title: row.title, edition: row.edition, eventDate: row.event_date, responseDeadline: row.response_deadline, newResponses: showResponses ? fresh : 0, silentProjects: showDigest || showReminder ? silent : [], deadlineSoon: showReminder, unread: showResponses || showReminder, href: `/?module=convocations&convocation=${encodeURIComponent(String(row.id))}` });
  }
  return { items, unread: items.filter(item => item.unread).length };
}

// ---------------------------------------------------------------- e-mail (MailApp)
type Input = Record<string, unknown>;
const lookback = (now: number) => new Date(now - e.LOOKBACK_MS).toISOString();
const prefSql = (kind: NoticeKind) => `COALESCE((SELECT np.enabled FROM convocation_notification_preferences np WHERE np.user_id=recipient.user_id AND np.kind='${kind}' AND np.channel='email'),${DEFAULT_PREFERENCES[kind].email ? 1 : 0})=1`;
function eligible() {
  return `${activeAccount('recipient')} AND prefs.enabled=1 AND lower(recipient.email)=prefs.consent_email AND q.created_at>=?
    AND c.status='open' AND c.purged_at IS NULL AND EXISTS(SELECT 1 FROM organizations org WHERE org.id=c.organization_id AND org.status='active')
    AND ${recipientSql('recipient.user_id')}
    AND ((q.kind='digest' AND ${prefSql('digest')}) OR (q.kind='reminder' AND ${prefSql('reminder')}) OR (q.kind='response' AND ${prefSql('response')}))`;
}
const joins = `FROM convocation_email_queue q JOIN convocations c ON c.id=q.convocation_id JOIN portal_users recipient ON recipient.user_id=q.user_id
  JOIN followup_email_preferences prefs ON prefs.organization_id=q.organization_id AND prefs.user_id=q.user_id`;
const notBusy = `NOT EXISTS(SELECT 1 FROM convocation_email_queue busy WHERE busy.user_id=q.user_id AND busy.id!=q.id AND (busy.status IN ('claimed','sending') OR (busy.status='uncertain' AND busy.updated_at>?)))`;
/** Brasília civil day and hour, for "once a day after 8h". */
function brasilia(now: number) { const shifted = new Date(now - 3 * 3_600_000); return { day: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() }; }

/** Due notices become queue rows (unique keys make this idempotent): daily summary, deadline reminder, new answers. */
export function materialize(db: D1Database, organizationId: string, now: number) {
  const at = new Date(now).toISOString(), { day, hour } = brasilia(now);
  const recipients = `SELECT c.id convocation_id,c.organization_id,u.user_id FROM convocations c JOIN portal_users u ON ${recipientSql('u.user_id')} AND ${activeAccount('u')}
    WHERE c.organization_id=? AND c.status='open' AND c.purged_at IS NULL`;
  const silent = `EXISTS(SELECT 1 FROM convocation_projects sp WHERE sp.convocation_id=x.convocation_id AND NOT EXISTS(SELECT 1 FROM convocation_guests sg WHERE sg.convocation_id=sp.convocation_id AND sg.project_id=sp.project_id))`;
  const insert = (kind: string, key: string, where: string, values: unknown[]) => db.prepare(`INSERT OR IGNORE INTO convocation_email_queue(id,notice_key,convocation_id,organization_id,user_id,kind,created_at,updated_at)
    SELECT '${CONVOCATION_EMAIL_PREFIX}'||lower(hex(randomblob(16))),${key},x.convocation_id,x.organization_id,x.user_id,'${kind}',?,? FROM (${recipients}) x WHERE ${where} LIMIT 200`).bind(at, at, organizationId, ...values);
  const statements = [];
  if (hour >= 8) statements.push(insert('digest', `'digest:'||x.convocation_id||':'||x.user_id||':${day}'`, silent, []));
  statements.push(insert('reminder', `'reminder:'||x.convocation_id||':'||x.user_id`, `${silent} AND EXISTS(SELECT 1 FROM convocations rc WHERE rc.id=x.convocation_id AND rc.response_deadline IS NOT NULL AND julianday(rc.response_deadline)>julianday(?) AND julianday(rc.response_deadline)-julianday(?)<=1.0)`, [at, at]));
  statements.push(db.prepare(`INSERT OR IGNORE INTO convocation_email_queue(id,notice_key,convocation_id,organization_id,user_id,kind,created_at,updated_at)
    SELECT '${CONVOCATION_EMAIL_PREFIX}'||lower(hex(randomblob(16))),'response:'||ev.id||':'||x.user_id,x.convocation_id,x.organization_id,x.user_id,'response',?,?
    FROM (${recipients}) x JOIN convocation_events ev ON ev.convocation_id=x.convocation_id AND ev.kind='response_created' AND ev.created_at>=?
    WHERE EXISTS(SELECT 1 FROM convocation_responsibles er WHERE er.convocation_id=x.convocation_id AND er.user_id=x.user_id) OR EXISTS(SELECT 1 FROM members em WHERE em.user_id=x.user_id AND em.revoked_at IS NULL AND em.role='manager' AND em.project_id=ev.project_id) LIMIT 200`)
    .bind(at, at, organizationId, new Date(now - 6 * 3_600_000).toISOString()));
  return statements;
}

export async function claimConvocationEmail(db: D1Database, principal: EmailDispatcher, input: Input, runtimeOrigin: unknown, now = Date.now()) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'remainingQuota']);
  await e.requireDispatcher(db, principal, input.organizationId);
  const c = await e.config(db, e.id(input.organizationId), runtimeOrigin, input.installerEmail);
  if (e.quotaInput(input.remainingQuota) < 1) return { claim: null, state: 'google_quota' };
  if (c.next_send_at > now) return { claim: null, state: 'interval' };
  const at = new Date(now).toISOString();
  await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    db.prepare("UPDATE convocation_email_queue SET status='queued',claim_hash=NULL,claim_nonce=NULL,claim_expires_at=NULL,updated_at=? WHERE organization_id=? AND status='claimed' AND claim_expires_at<=?").bind(at, c.organization_id, now),
    ...materialize(db, c.organization_id, now)]);
  const candidate = await one(db, `SELECT q.id ${joins} WHERE q.organization_id=? AND q.status='queued' AND ${eligible()} AND ${notBusy} ORDER BY q.created_at,q.id LIMIT 1`, [c.organization_id, lookback(now), lookback(now)]);
  if (!candidate) return { claim: null, state: 'idle' };
  const claimToken = e.randomToken(), hash = await syncDigest(claimToken), nonce = crypto.randomUUID();
  await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    e.assertion(db, `EXISTS(SELECT 1 ${joins} WHERE q.id=? AND q.status='queued' AND ${eligible()} AND ${notBusy})`, [candidate.id, lookback(now), lookback(now)], 'email_recipient_changed'),
    db.prepare("UPDATE convocation_email_queue SET status='claimed',claim_hash=?,claim_nonce=?,claim_expires_at=?,dispatcher_id=?,credential_hash=?,configuration_version=?,updated_at=? WHERE id=? AND status='queued'")
      .bind(hash, nonce, now + e.CLAIM_MS, principal.actor.userId, principal.credentialHash, c.version, at, candidate.id)]);
  return { claim: { id: candidate.id, claimToken, expiresAt: new Date(now + e.CLAIM_MS).toISOString() } };
}
async function queueRow(db: D1Database, principal: EmailDispatcher, input: Input, c: { organization_id: string; version: number }) {
  const claimToken = input.claimToken;
  if (typeof claimToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(claimToken)) e.fail('email_claim_changed', 'Claim inválido.');
  const row = await one(db, 'SELECT * FROM convocation_email_queue WHERE id=? AND organization_id=?', [e.id(input.id), c.organization_id]);
  if (!row || row.claim_hash !== await syncDigest(claimToken as string) || row.dispatcher_id !== principal.actor.userId || row.credential_hash !== principal.credentialHash || row.configuration_version !== c.version) e.fail('email_claim_changed', 'O claim pertence a outro envio.');
  return row!;
}
/** Text without personal data: counts and the portal link only. */
async function body(db: D1Database, row: Row, origin: string) {
  const c = await one(db, 'SELECT id,title,edition,event_date,response_deadline FROM convocations WHERE id=?', [row.convocation_id]);
  const counts = await one(db, "SELECT SUM(response='yes') yes,SUM(response='maybe') maybe,SUM(response='no') no FROM convocation_guests WHERE convocation_id=?", [row.convocation_id]);
  const silent = Number((await one(db, 'SELECT COUNT(*) n FROM convocation_projects cp WHERE cp.convocation_id=? AND NOT EXISTS(SELECT 1 FROM convocation_guests g WHERE g.convocation_id=cp.convocation_id AND g.project_id=cp.project_id)', [row.convocation_id]))?.n ?? 0);
  const name = `${c!.title}${c!.edition ? ` · ${c!.edition}` : ''}`, date = String(c!.event_date).split('-').reverse().join('/');
  const status = `${Number(counts?.yes ?? 0)} confirmações, ${Number(counts?.maybe ?? 0)} talvez e ${Number(counts?.no ?? 0)} recusas. ${silent ? `${silent} ${silent === 1 ? 'projeto ainda não respondeu' : 'projetos ainda não responderam'}.` : 'Todos os projetos já responderam.'}`;
  const lead = row.kind === 'response' ? `Chegou uma nova resposta na convocação “${name}” (${date}).` : row.kind === 'reminder' ? `O prazo de resposta da convocação “${name}” (${date}) termina em menos de 24 horas.` : `Resumo do dia da convocação “${name}” (${date}).`;
  return `${lead}\n${status}\n\nAcompanhe no portal:\n${origin}/?module=convocations&convocation=${encodeURIComponent(String(c!.id))}`;
}
export async function beginConvocationEmail(db: D1Database, principal: EmailDispatcher, input: Input, runtimeOrigin: unknown, now = Date.now()) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'remainingQuota', 'id', 'claimToken']);
  await e.requireDispatcher(db, principal, input.organizationId);
  const c = await e.config(db, e.id(input.organizationId), runtimeOrigin, input.installerEmail);
  if (e.quotaInput(input.remainingQuota) < 1) e.fail('email_google_quota', 'A conta não tem cota MailApp disponível.');
  const row = await queueRow(db, principal, input, c);
  if (row.status !== 'claimed' || Number(row.claim_expires_at) <= now) e.fail('email_claim_changed', 'O aviso já foi iniciado ou o claim expirou.');
  const at = new Date(now).toISOString(), day = e.dayKey(now);
  const buckets = [{ day, bucket: 'organization', limit: c.daily_limit }, { day, bucket: 'person:' + row.user_id, limit: c.person_daily_limit }, { day, bucket: 'convocations:organization', limit: Math.max(1, Math.floor(c.daily_limit / 3)) }, { day, bucket: 'convocations:person:' + row.user_id, limit: 3 }];
  const sendNonce = crypto.randomUUID(), acceptanceToken = e.randomToken(), acceptanceHash = await syncDigest(acceptanceToken);
  await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    e.assertion(db, "EXISTS(SELECT 1 FROM convocation_email_queue WHERE id=? AND status='claimed' AND claim_hash=? AND claim_nonce=? AND claim_expires_at>? AND dispatcher_id=? AND credential_hash=? AND configuration_version=?)", [row.id, row.claim_hash, row.claim_nonce, now, principal.actor.userId, principal.credentialHash, c.version], 'email_claim_changed'),
    e.assertion(db, `EXISTS(SELECT 1 ${joins} WHERE q.id=? AND ${eligible()})`, [row.id, lookback(now)], 'email_recipient_changed'),
    e.assertion(db, 'EXISTS(SELECT 1 FROM followup_email_configuration WHERE organization_id=? AND next_send_at<=?)', [c.organization_id, now], 'email_interval'),
    ...buckets.map(b => db.prepare('INSERT INTO followup_email_usage(organization_id,day,bucket) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(c.organization_id, b.day, b.bucket)),
    ...buckets.map(b => e.assertion(db, 'EXISTS(SELECT 1 FROM followup_email_usage WHERE organization_id=? AND day=? AND bucket=? AND reserved<?)', [c.organization_id, b.day, b.bucket, b.limit], 'email_quota')),
    db.prepare("UPDATE convocation_email_queue SET status='sending',send_nonce=?,acceptance_hash=?,sending_at=?,updated_at=? WHERE id=? AND status='claimed'").bind(sendNonce, acceptanceHash, at, at, row.id),
    ...buckets.map(b => db.prepare("UPDATE followup_email_usage SET reserved=reserved+1 WHERE organization_id=? AND day=? AND bucket=? AND EXISTS(SELECT 1 FROM convocation_email_queue WHERE id=? AND send_nonce=? AND status='sending')").bind(c.organization_id, b.day, b.bucket, row.id, sendNonce)),
    db.prepare('UPDATE followup_email_configuration SET next_send_at=? WHERE organization_id=?').bind(now + c.interval_seconds * 1000, c.organization_id),
    e.audit(db, principal.actor.userId, c.organization_id, 'convocation.email.sending', String(row.id), at)]);
  const d = e.dispatcherSql(principal);
  const recipient = await one(db, `SELECT lower(recipient.email) email ${joins} WHERE q.id=? AND q.status='sending' AND q.send_nonce=? AND ${eligible()} AND ${d.sql}
    AND EXISTS(SELECT 1 FROM followup_email_configuration WHERE organization_id=? AND enabled=1 AND version=?)`, [row.id, sendNonce, lookback(Date.now()), ...d.values, c.organization_id, c.version]);
  if (!recipient) {
    await db.prepare("UPDATE convocation_email_queue SET status='uncertain',updated_at=? WHERE id=? AND send_nonce=? AND status='sending'").bind(new Date().toISOString(), row.id, sendNonce).run();
    e.fail('email_recipient_changed', 'O acesso mudou após a reserva. Nenhum conteúdo será liberado.');
  }
  return { senderEmail: c.sender_email, to: emailAddress(recipient!.email), subject: CONVOCATION_EMAIL_SUBJECT, body: await body(db, row, c.portal_origin), acceptanceToken, sendNonce };
}
export async function acknowledgeConvocationEmail(db: D1Database, principal: EmailDispatcher, input: Input, runtimeOrigin: unknown) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'id', 'claimToken', 'acceptanceToken']);
  await e.requireDispatcher(db, principal, input.organizationId);
  const c = await e.config(db, e.id(input.organizationId), runtimeOrigin, input.installerEmail), row = await queueRow(db, principal, input, c);
  if (typeof input.acceptanceToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.acceptanceToken) || row.acceptance_hash !== await syncDigest(input.acceptanceToken) || !['sending', 'uncertain', 'accepted'].includes(String(row.status))) e.fail('email_claim_changed', 'Confirmação inválida.');
  if (row.status === 'accepted') return { status: 'accepted', meaning: 'mailapp_returned_without_error', replayed: true };
  const at = new Date().toISOString();
  const result = await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    db.prepare("UPDATE convocation_email_queue SET status='accepted',accepted_at=COALESCE(accepted_at,?),updated_at=? WHERE id=? AND acceptance_hash=? AND status IN('sending','uncertain')").bind(at, at, row.id, row.acceptance_hash),
    db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,'convocation.email.accepted',?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(), principal.actor.userId, c.organization_id, row.id, at)]);
  return { status: 'accepted', meaning: 'mailapp_returned_without_error', replayed: Number(result![2].meta.changes) !== 1 };
}
export async function recoverConvocationEmail(db: D1Database, principal: EmailDispatcher, input: Input) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'id', 'claimToken']);
  await e.requireDispatcher(db, principal, input.organizationId);
  if (typeof input.claimToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.claimToken)) e.fail('email_claim_changed', 'Claim inválido.');
  const row = await one(db, 'SELECT * FROM convocation_email_queue WHERE id=? AND organization_id=?', [e.id(input.id), e.id(input.organizationId)]);
  if (!row || row.claim_hash !== await syncDigest(input.claimToken as string) || row.dispatcher_id !== principal.actor.userId) return { status: 'superseded' };
  await e.batch(db, [e.dispatcherAssertion(db, principal), db.prepare("UPDATE convocation_email_queue SET status=CASE WHEN status='claimed' THEN 'queued' WHEN status='sending' THEN 'uncertain' ELSE status END,claim_hash=CASE WHEN status='claimed' THEN NULL ELSE claim_hash END,updated_at=? WHERE id=?").bind(new Date().toISOString(), row.id)]);
  return { status: (await one(db, 'SELECT status FROM convocation_email_queue WHERE id=?', [row.id]))?.status ?? 'uncertain' };
}
export async function reconcileConvocationEmail(db: D1Database, actor: PortalActor | null, input: Input) {
  e.keys(input, ['action', 'organizationId', 'id', 'outcome', 'confirmed']);
  if (!actor) e.fail('unauthenticated', 'Entre para conferir o envio.', 401);
  const orgId = e.id(input.organizationId), queueId = e.id(input.id);
  if (!['accepted_attested', 'close_unconfirmed'].includes(String(input.outcome)) || input.confirmed !== true) e.fail('email_reconcile_confirmation', 'Confirme a conferência manual. Nenhum reenvio é criado.', 400);
  const at = new Date().toISOString();
  await e.batch(db, [e.assertion(db, emailOwnerCheck(), [actor!.userId, orgId]),
    e.assertion(db, "EXISTS(SELECT 1 FROM convocation_email_queue WHERE id=? AND organization_id=? AND status IN('sending','uncertain'))", [queueId, orgId], 'email_claim_changed'),
    db.prepare('UPDATE convocation_email_queue SET status=?,reconciled_at=?,updated_at=? WHERE id=?').bind(input.outcome === 'accepted_attested' ? 'accepted_attested' : 'closed_unconfirmed', at, at, queueId),
    e.audit(db, actor!.userId, orgId, input.outcome === 'accepted_attested' ? 'convocation.email.accepted_attested' : 'convocation.email.closed_unconfirmed', queueId, at)]);
  return { ok: true, retry: false, meaning: 'manual_attestation_no_delivery_proof' };
}
