import { getActor, organizationAuthoritySql, type PortalActor } from '../access';
import { all, one } from '../database';
import { HttpError } from '../errors';
import { DEFAULT_ASSISTANT_CONFIG, object, onlyKeys, validateConfig, type AssistantCredentials } from './contracts';
import { decryptCredentials, encryptCredentials } from './crypto';

const ACTIVE = "COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0 AND u.anonymized_at IS NULL";
export function aiConfigurationAuthority(actor: PortalActor, organizationId: string) {
 const owner = organizationAuthoritySql(actor, organizationId);
 return { sql: `EXISTS(SELECT 1 FROM organizations WHERE id=? AND status='active') AND (${owner.sql} OR EXISTS(
  SELECT 1 FROM ai_configuration_grants g JOIN members issuer ON issuer.id=g.grantor_member_id
  LEFT JOIN portal_users u ON u.user_id=issuer.user_id
  WHERE g.organization_id=? AND g.user_id=? AND g.revoked_at IS NULL
  AND issuer.role='owner' AND issuer.project_id IS NULL AND (issuer.organization_id IS NULL OR issuer.organization_id=g.organization_id) AND issuer.revoked_at IS NULL AND ${ACTIVE}
  AND EXISTS(SELECT 1 FROM members target JOIN portal_users account ON account.user_id=target.user_id WHERE target.user_id=g.user_id AND target.organization_id=g.organization_id AND target.revoked_at IS NULL AND account.status='active' AND account.activation_pending=0 AND account.anonymized_at IS NULL)))`, values: [organizationId, ...owner.values, organizationId, actor.userId] };
}
export async function configurationActor(db: D1Database, actor: PortalActor | null, organizationId: string, ownerOnly = false) {
 const current = actor && await getActor(db, actor); if (!current) throw new HttpError(403, 'Seu acesso mudou. Entre novamente.', 'assistant_forbidden');
 const auth = ownerOnly ? organizationAuthoritySql(current, organizationId) : aiConfigurationAuthority(current, organizationId);
 if (!await one(db, `SELECT id FROM organizations WHERE id=? AND status='active' AND ${auth.sql}`, [organizationId, ...auth.values])) throw new HttpError(403, 'Seu acesso à configuração desta organização mudou.', 'assistant_configuration_forbidden');
 return { current, auth };
}
export async function loadAssistantSettings(db: D1Database, secret: string, organizationId: string, speech = false) {
 const row = await one(db, "SELECT s.* FROM ai_organization_settings s JOIN organizations o ON o.id=s.organization_id AND o.status='active' WHERE s.organization_id=?", [organizationId]);
 if (!row) throw new HttpError(503, 'Esta organização ainda não configurou o assistente.', 'assistant_unavailable');
 const config = validateConfig(JSON.parse(row.config_json)), credentials = object(await decryptCredentials(secret, row.credentials_ciphertext, organizationId));
 if (speech ? !config.sttEnabled || typeof credentials.deepgram !== 'string' || !credentials.deepgram : !config.enabled || typeof credentials.deepseek !== 'string' || !credentials.deepseek || config.jevEnabled && !credentials.typesafe) throw new HttpError(503, speech ? 'A transcrição desta organização está desativada ou sem credencial.' : 'O assistente desta organização está desativado ou sem credencial.', 'assistant_unavailable');
 return { config, credentials: credentials as AssistantCredentials, revision: Number(row.revision) };
}
function id(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new HttpError(400, 'Escolha uma organização válida.', 'assistant_organization'); return value; }
function key(value: unknown): string { if (typeof value !== 'string' || value.length < 12 || value.length > 512 || /\s|[\u0000-\u001f]/u.test(value)) throw new HttpError(400, 'Informe uma chave válida no campo do provedor.', 'assistant_credentials'); return value; }
export async function configureAssistant(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string) {
 onlyKeys(input, ['action','organizationId','config','deepseekKey','typesafeKey','deepgramKey','expectedRevision','replaceCredentials']);
 const organizationId = id(input.organizationId), { current, auth } = await configurationActor(db, actor, organizationId), config = validateConfig(input.config);
 const old = await one(db, 'SELECT revision,credentials_ciphertext FROM ai_organization_settings WHERE organization_id=?', [organizationId]);
 if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (old?.revision ?? 0)) throw new HttpError(409, 'A configuração mudou. Atualize antes de salvar.', 'assistant_configuration_changed');
 const previous = old && input.replaceCredentials !== true ? object(await decryptCredentials(secret, old.credentials_ciphertext, organizationId)) : {};
 const credentials = { deepseek: input.deepseekKey ? key(input.deepseekKey) : String(previous.deepseek ?? ''), typesafe: input.typesafeKey ? key(input.typesafeKey) : String(previous.typesafe ?? ''), deepgram: input.deepgramKey ? key(input.deepgramKey) : String(previous.deepgram ?? '') };
 if (config.enabled && !credentials.deepseek || config.jevEnabled && !credentials.typesafe || config.sttEnabled && !credentials.deepgram) throw new HttpError(400, 'Cadastre as credenciais dos provedores habilitados.', 'assistant_credentials');
 const ciphertext = await encryptCredentials(secret, credentials, organizationId), revision = Number(input.expectedRevision) + 1, at = new Date().toISOString();
 const assertion = db.prepare(`SELECT CASE WHEN ${auth.sql} THEN 1 ELSE json_extract('[]','ai_configuration_revoked') END`).bind(...auth.values);
 const statement = old ? db.prepare('UPDATE ai_organization_settings SET revision=?,config_json=?,credentials_ciphertext=?,updated_by=?,updated_at=? WHERE organization_id=? AND revision=?').bind(revision, JSON.stringify(config), ciphertext, current.userId, at, organizationId, input.expectedRevision) : db.prepare('INSERT INTO ai_organization_settings(organization_id,revision,config_json,credentials_ciphertext,updated_by,updated_at) VALUES(?,?,?,?,?,?)').bind(organizationId, revision, JSON.stringify(config), ciphertext, current.userId, at);
 try { const result = await db.batch([assertion, statement, db.prepare("INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,NULL,?,'assistant.configure',?,?,? WHERE changes()=1").bind(crypto.randomUUID(), current.userId, organizationId, organizationId, JSON.stringify({ revision, enabled: config.enabled, sttEnabled: config.sttEnabled, jevEnabled: config.jevEnabled }), at)]); if (result[1].meta.changes !== 1) throw new HttpError(409, 'A configuração mudou. Atualize a página.', 'assistant_configuration_changed'); }
 catch (error) { if (String(error).includes('ai_configuration_revoked')) throw new HttpError(403, 'A autorização de configuração foi revogada.', 'assistant_configuration_forbidden'); throw error; }
 return { ok: true, revision };
}
export async function assistantStatus(db: D1Database, actor: PortalActor | null, secret: string, selectedId?: string) {
 const current = actor && await getActor(db, actor); if (!current) throw new HttpError(403, 'Entre para usar o assistente.', 'assistant_forbidden');
 const visible = [];
 for (const organization of current.organizations ?? []) {
  let canConfigure = false, canDelegate = false, available = false, sttAvailable = false;
  try { await configurationActor(db, current, organization.id); canConfigure = true; } catch { /* deny */ }
  try { await configurationActor(db, current, organization.id, true); canDelegate = true; } catch { /* deny */ }
  try { await loadAssistantSettings(db, secret, organization.id); available = true; } catch { /* unavailable */ }
  try { await loadAssistantSettings(db, secret, organization.id, true); sttAvailable = true; } catch { /* unavailable */ }
  visible.push({ id: organization.id, name: organization.name, canConfigure, canDelegate, available, sttAvailable });
 }
 const selected = visible.find(organization => organization.id === selectedId) ?? (visible.length === 1 ? visible[0] : undefined);
 const result = { available: selected?.available ?? false, canConfigure: selected?.canConfigure ?? false, canDelegate: selected?.canDelegate ?? false, organizationId: selected?.id ?? '', organizations: visible, voice: { dictation: 'browser-optional', uploadStt: selected?.sttAvailable ?? false } };
 if (!selected?.canConfigure) return result;
 const row = await one(db, 'SELECT revision,config_json FROM ai_organization_settings WHERE organization_id=?', [selected.id]);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const details = { config: row ? validateConfig(JSON.parse(row.config_json)) : DEFAULT_ASSISTANT_CONFIG, revision: row?.revision ?? 0, credentialsConfigured: !!row, usage:await one(db,'SELECT reserved_usd_micros,reserved_tokens,reserved_ms,calls FROM ai_organization_usage WHERE organization_id=? AND day=?',[selected.id,day])??{reserved_usd_micros:0,reserved_tokens:0,reserved_ms:0,calls:0} };
 if (!selected.canDelegate) return { ...result, ...details };
 const candidates = await all(db, "SELECT DISTINCT m.user_id AS userId,COALESCE(NULLIF(p.display_name,''),m.user_id) AS name FROM members m JOIN portal_users u ON u.user_id=m.user_id LEFT JOIN profiles p ON p.user_id=m.user_id WHERE m.organization_id=? AND m.revoked_at IS NULL AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL ORDER BY name", [selected.id]);
 const grants = await all(db, 'SELECT id,user_id AS userId,created_at AS createdAt FROM ai_configuration_grants WHERE organization_id=? AND revoked_at IS NULL', [selected.id]);
 return { ...result, ...details, candidates, grants };
}
export async function manageAssistantGrant(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>) {
 onlyKeys(input, ['action','organizationId','userId','grantId']); const organizationId = id(input.organizationId), { current, auth } = await configurationActor(db, actor, organizationId, true), at = new Date().toISOString();
 const assertion = db.prepare(`SELECT CASE WHEN ${auth.sql} THEN 1 ELSE json_extract('[]','ai_configuration_revoked') END`).bind(...auth.values);
 if (input.action === 'grant.revoke') {
  const grantId = id(input.grantId); await db.batch([assertion, db.prepare('UPDATE ai_configuration_grants SET revoked_at=? WHERE id=? AND organization_id=? AND revoked_at IS NULL').bind(at, grantId, organizationId), db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,'assistant.grant.revoke',?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(), current.userId, organizationId, grantId, at)]); return { ok: true };
 }
 const userId = id(input.userId), grantId = crypto.randomUUID();
 const result = await db.batch([assertion, db.prepare(`INSERT OR IGNORE INTO ai_configuration_grants(id,organization_id,user_id,grantor_member_id,granted_by,created_at)
  SELECT ?,?,?,issuer.id,?,? FROM members issuer LEFT JOIN portal_users u ON u.user_id=issuer.user_id
  WHERE issuer.user_id=? AND issuer.role='owner' AND issuer.project_id IS NULL AND (issuer.organization_id IS NULL OR issuer.organization_id=?) AND issuer.revoked_at IS NULL AND ${ACTIVE}
  AND EXISTS(SELECT 1 FROM members target JOIN portal_users account ON account.user_id=target.user_id WHERE target.user_id=? AND target.organization_id=? AND target.revoked_at IS NULL AND account.status='active' AND account.activation_pending=0 AND account.anonymized_at IS NULL) ORDER BY issuer.organization_id IS NULL,issuer.id LIMIT 1`).bind(grantId, organizationId, userId, current.userId, at, current.userId, organizationId, userId, organizationId), db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,'assistant.grant.create',?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(), current.userId, organizationId, grantId, at)]);
 if (!result[1].meta.changes && !await one(db, 'SELECT id FROM ai_configuration_grants WHERE organization_id=? AND user_id=? AND revoked_at IS NULL', [organizationId,userId])) throw new HttpError(403, 'Escolha uma pessoa ativa desta organização.', 'assistant_grant_target'); return { ok: true };
}
