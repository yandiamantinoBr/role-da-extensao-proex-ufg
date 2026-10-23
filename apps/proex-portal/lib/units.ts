import { requireCapability, type PortalActor } from './access';
import { HttpError } from './errors';
import { prepareMutation } from './mutations';
import { UFG_UNITS, CATALOG_VERIFIED_AT, MODALITIES, MODALITY_TYPE_KEYS } from './extension-catalog';

export type OrganizationalUnit = {
  id: string; name: string; acronym: string; kind: 'proex' | 'academic' | 'agency' | 'external';
  status: 'active' | 'archived'; version: number; created_at: string; updated_at: string;
  group_label: string; campus: string; official_url: string;
};
const KINDS = ['proex', 'academic', 'agency', 'external'];
const OWNER_SQL = `EXISTS(SELECT 1 FROM members m LEFT JOIN portal_users u ON u.user_id=m.user_id
  WHERE m.user_id=? AND m.role='owner' AND m.project_id IS NULL AND m.revoked_at IS NULL
    AND COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0 AND u.anonymized_at IS NULL)`;
function stmt(db: D1Database, sql: string, values: (string | number | null)[] = []) { return db.prepare(sql).bind(...values); }
function text(value: unknown, label: string, maximum: number, optional = false): string {
  if ((value === undefined || value === null) && optional) return '';
  if (typeof value !== 'string') throw new HttpError(400, `Informe ${label} como texto.`, 'invalid_unit');
  const result = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if ((!optional && !result) || Array.from(result).length > maximum || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) throw new HttpError(400, `Use ${optional ? 'até' : 'entre 1 e'} ${maximum} caracteres válidos para ${label}.`, 'invalid_unit');
  return result;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new HttpError(400, 'Selecione uma unidade válida.', 'invalid_unit');
  return value;
}
async function owner(db: D1Database, actor: PortalActor | null): Promise<void> {
  requireCapability(actor, 'organization.manage', null);
  if (!await stmt(db, `SELECT 1 AS allowed WHERE ${OWNER_SQL}`, [actor!.userId]).first()) throw new HttpError(403, 'Somente a administração geral pode gerenciar unidades.', 'units_forbidden');
}
function ownerAssertion(db: D1Database, actor: PortalActor) {
  return stmt(db, `SELECT CASE WHEN ${OWNER_SQL} THEN 1 ELSE json_extract('[]','unit_access_changed') END`, [actor.userId]);
}
async function findUnit(db: D1Database, id: string): Promise<OrganizationalUnit> {
  const unit = await stmt(db, 'SELECT id,name,acronym,kind,status,version,created_at,updated_at,group_label,campus,official_url FROM organizational_units WHERE id=?', [id]).first<OrganizationalUnit>();
  if (!unit) throw new HttpError(404, 'Unidade não encontrada.', 'unit_not_found');
  return unit;
}
async function translateError(db: D1Database, actor: PortalActor, error: unknown): Promise<never> {
  await owner(db, actor);
  if (error instanceof HttpError) throw error;
  if (String(error).includes('unit_changed')) throw new HttpError(409, 'A unidade mudou em outra sessão. Atualize a lista.', 'unit_changed');
  throw error;
}
async function admittedAccount(db: D1Database, actor: PortalActor | null): Promise<void> {
  if (!actor) throw new HttpError(401, 'Entre para consultar as unidades.', 'unauthenticated');
  // A unit is organizational metadata. Listing it never creates a project membership.
  if (!await stmt(db, "SELECT user_id FROM portal_users WHERE user_id=? AND status='active' AND anonymized_at IS NULL", [actor.userId]).first()) throw new HttpError(403, 'Seu acesso ao portal não está ativo.', 'account_inactive');
}
/** Safe directory for profile/project selectors, including the user's current archived unit. */
export async function listOrganizationalUnits(db: D1Database, actor: PortalActor | null, input: { includeArchived?: boolean } = {}): Promise<OrganizationalUnit[]> {
  await admittedAccount(db, actor);
  if (input.includeArchived) await owner(db, actor);
  const result = (await stmt(db, `SELECT id,name,acronym,kind,status,version,created_at,updated_at,group_label,campus,official_url FROM organizational_units
    WHERE ${input.includeArchived ? '1=1' : "status='active' OR id=(SELECT unit_id FROM profiles WHERE user_id=?)"}
    ORDER BY status,name,id`, input.includeArchived ? [] : [actor!.userId]).all<OrganizationalUnit>()).results ?? [];
  await admittedAccount(db, actor);
  if (input.includeArchived) await owner(db, actor);
  return result;
}
/** Unit membership is descriptive only. Privileges remain in project-scoped members. */
export async function unitsAction(db: D1Database, actor: PortalActor | null, action: string, input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!['unit.create', 'unit.update'].includes(action)) return null;
  await owner(db, actor);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['action','id','name','acronym','kind','status','groupLabel','campus','officialUrl','expectedVersion','operationKey'].includes(key))) throw new HttpError(400, 'Envie somente os dados do cadastro da unidade.', 'invalid_unit');
  const existing = action === 'unit.update' ? await findUnit(db, identifier(input.id)) : null;
  const name = text(input.name ?? existing?.name, 'o nome da unidade', 200);
  const acronym = text(input.acronym ?? existing?.acronym, 'a sigla da unidade', 40, true);
  const kind = input.kind ?? existing?.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) throw new HttpError(400, 'Escolha PROEX, unidade acadêmica, órgão ou entidade externa.', 'invalid_unit_kind');
  const groupLabel = text(input.groupLabel ?? existing?.group_label, 'o grupo institucional', 80, true);
  const campus = text(input.campus ?? existing?.campus, 'o câmpus', 120, true);
  const officialUrl = text(input.officialUrl ?? existing?.official_url, 'a página oficial', 300, true);
  if (officialUrl && !/^https:\/\/\S+$/.test(officialUrl)) throw new HttpError(400, 'Use um endereço HTTPS para a página oficial.', 'invalid_unit');
  const status = input.status ?? existing?.status ?? 'active';
  if (status !== 'active' && status !== 'archived') throw new HttpError(400, 'Escolha unidade ativa ou arquivada.', 'invalid_unit_status');
  if (!existing && status !== 'active') throw new HttpError(400, 'Cadastre a unidade como ativa antes de arquivá-la.', 'invalid_unit_status');
  const version = input.expectedVersion;
  if (existing && (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1)) throw new HttpError(400, 'Informe a versão da unidade. Atualize a lista.', 'invalid_version');
  const normalized = existing ? { id: existing.id, expectedVersion: version, operationKey: input.operationKey,
    ...(input.name !== undefined ? { name } : {}), ...(input.acronym !== undefined ? { acronym } : {}),
    ...(input.kind !== undefined ? { kind } : {}), ...(input.status !== undefined ? { status } : {}),
    ...(input.groupLabel !== undefined ? { groupLabel } : {}), ...(input.campus !== undefined ? { campus } : {}), ...(input.officialUrl !== undefined ? { officialUrl } : {}) }
    : { name, acronym, kind, status, groupLabel, campus, officialUrl, operationKey: input.operationKey };
  const mutation = !existing || input.operationKey !== undefined ? await prepareMutation(db, actor!.userId, action, normalized) : null;
  if (mutation?.existingId) {
    await owner(db, actor);
    return { unit: await findUnit(db, mutation.existingId), duplicate: true };
  }
  if (existing && version !== existing.version) throw new HttpError(409, 'A unidade mudou em outra sessão. Atualize a lista.', 'unit_changed');
  const now = new Date().toISOString(), id = existing?.id ?? crypto.randomUUID();
  const audit = stmt(db, 'INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,NULL,?,?,?,?)', [crypto.randomUUID(), actor!.userId, action, id, JSON.stringify({ version: existing ? existing.version + 1 : 1, fields: ['name','acronym','kind','status','group_label','campus','official_url'] }), now]);
  const statements: D1PreparedStatement[] = [ownerAssertion(db, actor!)];
  if (mutation) statements.push(mutation.claimStatement(id));
  if (existing) {
    statements.push(stmt(db, 'UPDATE organizational_units SET name=?,acronym=?,kind=?,status=?,group_label=?,campus=?,official_url=?,version=version+1,updated_at=? WHERE id=? AND version=?', [name, acronym, kind, status, groupLabel, campus, officialUrl, now, id, version as number]));
    statements.push(stmt(db, "SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','unit_changed') END"));
  } else statements.push(stmt(db, 'INSERT INTO organizational_units(id,name,acronym,kind,status,group_label,campus,official_url,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)', [id, name, acronym, kind, status, groupLabel, campus, officialUrl, now, now]));
  statements.push(audit);
  let savedId = id;
  try { await db.batch(statements); }
  catch (error) {
    if (mutation) {
      try { savedId = await mutation.recover(error); }
      catch (recoveryError) { return translateError(db, actor!, recoveryError); }
    } else return translateError(db, actor!, error);
  }
  await owner(db, actor);
  return { unit: await findUnit(db, savedId), ...(savedId !== id ? { duplicate: true } : {}) };
}
// Singular alias keeps the portal dispatcher and MCP action registry consistent.
export const unitAction = unitsAction;

const comparable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
/**
 * Pré-cadastro das unidades acadêmicas e órgãos da UFG (lib/catalog/ufg-unidades-2026.ts).
 * Idempotente e em uma única transação: unidades já cadastradas (mesma sigla ou nome) são
 * preservadas e só recebem grupo, câmpus e página oficial quando esses campos estão vazios.
 */
export async function seedUfgUnits(db: D1Database, actor: PortalActor | null): Promise<{ created: number; completed: number; verifiedAt: string }> {
  await owner(db, actor);
  const existing = (await stmt(db, 'SELECT id,name,acronym,group_label,campus,official_url FROM organizational_units').all<{ id: string; name: string; acronym: string; group_label: string; campus: string; official_url: string }>()).results ?? [];
  const now = new Date().toISOString(), statements: D1PreparedStatement[] = [ownerAssertion(db, actor!)];
  let created = 0, completed = 0;
  // Modalidades da UFG como tipos de iniciativa (Programa, Projeto, Curso, Evento, Prestação de Serviço).
  const types = new Set(((await stmt(db, 'SELECT key FROM project_types').all<{ key: string }>()).results ?? []).map(row => row.key));
  for (const modality of MODALITIES) {
    const key = MODALITY_TYPE_KEYS[modality.key];
    if (!key || types.has(key)) continue;
    statements.push(stmt(db, "INSERT INTO project_types(id,key,label,description,status,version,created_at,updated_at) VALUES(?,?,?,?,'active',1,?,?)", [crypto.randomUUID(), key, modality.label, modality.definition.slice(0, 1000), now, now]));
    created++;
  }
  for (const unit of UFG_UNITS) {
    const match = existing.find(row => (unit.acronym && comparable(row.acronym) === comparable(unit.acronym)) || comparable(row.name) === comparable(unit.name));
    if (match) {
      if ((!match.group_label && unit.group) || (!match.campus && unit.campus) || (!match.official_url && unit.officialUrl)) {
        statements.push(stmt(db, "UPDATE organizational_units SET group_label=CASE WHEN group_label='' THEN ? ELSE group_label END,campus=CASE WHEN campus='' THEN ? ELSE campus END,official_url=CASE WHEN official_url='' THEN ? ELSE official_url END,version=version+1,updated_at=? WHERE id=?", [unit.group, unit.campus, unit.officialUrl, now, match.id]));
        completed++;
      }
      continue;
    }
    statements.push(stmt(db, "INSERT INTO organizational_units(id,name,acronym,kind,status,group_label,campus,official_url,version,created_at,updated_at) VALUES(?,?,?,?,'active',?,?,?,1,?,?)", [crypto.randomUUID(), unit.name, unit.acronym, unit.kind, unit.group, unit.campus, unit.officialUrl, now, now]));
    created++;
  }
  if (created || completed) {
    statements.push(stmt(db, "INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,NULL,'unit.catalog.seed','ufg-unidades',?,?)", [crypto.randomUUID(), actor!.userId, JSON.stringify({ created, completed, verifiedAt: CATALOG_VERIFIED_AT }), now]));
    try { await db.batch(statements); } catch (error) { return translateError(db, actor!, error); }
  }
  return { created, completed, verifiedAt: CATALOG_VERIFIED_AT };
}
