import { all, one, iso, uid, text, type Row } from '../database';
import { getActor, projectAuthoritySql, type PortalActor } from '../access';
import { HttpError } from '../errors';
import { syncDigest, SYNC_CONFIGURATION_KEY } from './contracts';

export const PROJECT_SHEET_SCRIPT = '/integracoes/proex-projeto-planilha.gs';
export const PROJECT_SHEET_TABLES = ['projects','material_categories','items','stock_movements','activity_groups','loans','campaigns','project_schedule_items','followup_tasks'] as const;
export type ProjectSheetScope = 'read' | 'materials';
export type ProjectSheetPrincipal = { actor: PortalActor; tokenId: string; tokenHash: string; connectionId: string; connectionVersion: number; projectId: string; spreadsheetId: string; scope: ProjectSheetScope; includeTasks: boolean };
const NOTICE = 'Arquivo exclusivo deste projeto. Permissões do Google Drive são independentes: compartilhe somente com quem pode consultar os dados projetados. Editores podem alterar o Apps Script e usar a credencial restrita. Demandas, agenda e saldos são de leitura; materiais são editáveis somente com chave de materiais. A mestre recebe as alterações na próxima sincronização.';
const validId = (value: unknown): value is string => typeof value === 'string' && /^[-_A-Za-z0-9]{10,200}$/.test(value);
const validVersion = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
export const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function authority(actor: PortalActor, projectId: string, manage: boolean) {
 const live = projectAuthoritySql(actor, manage ? ['access.manage'] : [], '?');
 return { sql: live.sql, values: [...live.values, projectId] };
}
export async function requireProjectSheetAccess(db: D1Database, actor: PortalActor | null, projectId: string, manage = false): Promise<PortalActor> {
 if (!actor) throw new HttpError(401, 'Entre para acessar a planilha.', 'unauthenticated');
 const live = authority(actor, projectId, manage);
 if (!await one(db, `SELECT id FROM projects WHERE id=? AND ${live.sql}`, [projectId, ...live.values])) throw new HttpError(403, 'Seu acesso atual não permite esta integração.', 'project_sheet_forbidden');
 return actor;
}
function managerGuard(db: D1Database, actor: PortalActor, projectId: string) {
 const live = authority(actor, projectId, true);
 return db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=? AND status='active') AND ${live.sql} THEN 1 ELSE json_extract('[]','project_sheet_forbidden') END`).bind(projectId, ...live.values);
}
function masterGuard(db: D1Database, spreadsheetId: string) {
 return db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM settings WHERE name=? AND CASE WHEN json_valid(value) THEN json_extract(value,'$.spreadsheetId') END=?) THEN json_extract('[]','project_sheet_master_forbidden') ELSE 1 END`).bind(SYNC_CONFIGURATION_KEY, spreadsheetId);
}
async function connection(db: D1Database, projectId: string) { return one(db, 'SELECT * FROM project_sheet_connections WHERE project_id=?', [projectId]); }
function mapping(value: string): Record<string, number> {
 try { const parsed: unknown = JSON.parse(value); return isObject(parsed) ? Object.fromEntries(Object.entries(parsed).filter(([key, gid]) => PROJECT_SHEET_TABLES.some(table => key === table) && Number.isSafeInteger(gid) && Number(gid) >= 0).map(([key,gid])=>[key,Number(gid)])) : {}; } catch { return {}; }
}
function present(row: Row | null) {
 if (!row) return null;
 const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${row.spreadsheet_id}/edit`;
 return { id: row.id, projectId: row.project_id, spreadsheetId: row.spreadsheet_id, spreadsheetUrl, label: row.label, enabled: Boolean(row.enabled), includeTasks: Boolean(row.include_tasks), version: row.version, tabsVersion: row.tabs_version, tabs: Object.fromEntries(Object.entries(mapping(row.tabs_json)).map(([key,gid])=>[key,{gid,url:`${spreadsheetUrl}?gid=${gid}#gid=${gid}`}])) , updatedAt: row.updated_at };
}
export async function projectSheetStatus(db: D1Database, actor: PortalActor | null, projectId: string) {
 const current = await requireProjectSheetAccess(db, actor, projectId);
 const live = authority(current, projectId, true);
 const canManage = Boolean(await one(db, `SELECT 1 WHERE ${live.sql}`, live.values));
 const row = await connection(db, projectId);
 if(row&&await one(db,"SELECT 1 FROM settings WHERE name=? AND CASE WHEN json_valid(value) THEN json_extract(value,'$.spreadsheetId') END=?",[SYNC_CONFIGURATION_KEY,row.spreadsheet_id]))throw new HttpError(409,'O arquivo deste projeto coincide com a mestre. A administração deve corrigir os vínculos antes de continuar.','project_sheet_master_forbidden');
 const tokens = canManage && row ? await all(db, 'SELECT id,label,scope,connection_version,created_at,expires_at,revoked_at,last_used_at FROM project_sheet_tokens WHERE connection_id=? ORDER BY created_at DESC LIMIT 50', [row.id]) : [];
 await requireProjectSheetAccess(db, current, projectId, canManage);
 return { projectId, canManage, connection: present(row), tokens, scriptUrl: PROJECT_SHEET_SCRIPT, notice: NOTICE };
}
export async function configureProjectSheet(db: D1Database, actor: PortalActor | null, projectId: string, input: Record<string, unknown>) {
 const current = await requireProjectSheetAccess(db, actor, projectId, true);
 if (!validId(input.spreadsheetId) || !validVersion(input.expectedVersion) || (input.enabled !== undefined && typeof input.enabled !== 'boolean') || (input.includeTasks !== undefined && typeof input.includeTasks !== 'boolean')) throw new HttpError(400, 'Confira o ID do arquivo Google, a versão e a situação.', 'project_sheet_invalid_configuration');
 const old = await connection(db, projectId), version = old?.version ?? 0;
 if (version !== input.expectedVersion) throw new HttpError(409, 'O vínculo mudou. Atualize antes de salvar.', 'project_sheet_changed');
 const id = old?.id ?? uid(), now = iso(), label = text(input.label, 100) || 'Planilha do projeto';
 try { await db.batch([
  managerGuard(db, current, projectId), masterGuard(db, input.spreadsheetId),
  db.prepare("SELECT CASE WHEN COALESCE((SELECT version FROM project_sheet_connections WHERE project_id=?),0)=? THEN 1 ELSE json_extract('[]','project_sheet_changed') END").bind(projectId, version),
  db.prepare("INSERT INTO project_sheet_connections(id,project_id,spreadsheet_id,label,enabled,include_tasks,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?) ON CONFLICT(project_id) DO UPDATE SET spreadsheet_id=excluded.spreadsheet_id,label=excluded.label,enabled=excluded.enabled,include_tasks=excluded.include_tasks,version=project_sheet_connections.version+1,tabs_json='{}',tabs_version=0,updated_at=excluded.updated_at").bind(id, projectId, input.spreadsheetId, label, input.enabled === false ? 0 : 1, input.includeTasks === true ? 1 : 0, current.userId, now, now),
  db.prepare('UPDATE project_sheet_tokens SET revoked_at=? WHERE connection_id=? AND revoked_at IS NULL').bind(now,id),
  db.prepare("UPDATE project_sheet_runs SET status='failed',finished_at=? WHERE connection_id=? AND status='running'").bind(now,id),
  db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,'project_sheet.configure',?,?,?)").bind(uid(),current.userId,projectId,id,JSON.stringify({includeTasks:input.includeTasks===true,enabled:input.enabled!==false}),now),
 ]); } catch (error) { await requireProjectSheetAccess(db,current,projectId,true); if(String(error).includes('project_sheet_master_forbidden'))throw new HttpError(400,'Use outro arquivo: a mestre não pode ser compartilhada como planilha de um projeto.','project_sheet_master_forbidden'); if(String(error).includes('project_sheet_changed'))throw new HttpError(409,'O vínculo mudou. Atualize antes de salvar.','project_sheet_changed'); if(String(error).includes('UNIQUE'))throw new HttpError(409,'Este arquivo já está vinculado a outro projeto.','project_sheet_file_in_use'); throw error; }
 return projectSheetStatus(db,current,projectId);
}
export async function createProjectSheetToken(db: D1Database, actor: PortalActor | null, projectId: string, input: Record<string, unknown>) {
 const current = await requireProjectSheetAccess(db,actor,projectId,true), row = await connection(db,projectId);
 if (!row?.enabled || row.version !== input.expectedVersion) throw new HttpError(409,'Confira o vínculo ativo antes de gerar a chave.','project_sheet_changed');
 if (input.scope !== 'read' && input.scope !== 'materials') throw new HttpError(400,'Escolha leitura ou materiais.','project_sheet_invalid_scope');
 const id=uid(),scope=input.scope,now=iso(),expiresAt=new Date(Date.now()+30*86400000).toISOString(),label=text(input.label,80)||'Conector do projeto';
 const token='pxp_'+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 try { await db.batch([
  managerGuard(db,current,projectId), masterGuard(db,row.spreadsheet_id),
  db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM project_sheet_connections WHERE id=? AND version=? AND enabled=1) THEN 1 ELSE json_extract('[]','project_sheet_changed') END").bind(row.id,row.version),
  db.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM project_sheet_tokens WHERE connection_id=? AND revoked_at IS NULL AND expires_at>?)<5 THEN 1 ELSE json_extract('[]','project_sheet_token_limit') END").bind(row.id,now),
  db.prepare('INSERT INTO project_sheet_tokens(id,connection_id,connection_version,token_hash,user_id,scope,label,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,row.id,row.version,await syncDigest(token),current.userId,scope,label,now,expiresAt),
  db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,'project_sheet.token.create',?,'{}',?)").bind(uid(),current.userId,projectId,id,now),
 ]); } catch(error) { await requireProjectSheetAccess(db,current,projectId,true); if(String(error).includes('project_sheet_token_limit'))throw new HttpError(409,'Revogue uma chave antiga antes de criar outra.','project_sheet_token_limit'); if(String(error).includes('project_sheet_changed'))throw new HttpError(409,'O vínculo mudou. Atualize antes de continuar.','project_sheet_changed'); throw error; }
 return {id,label,scope,token,expiresAt,connectionVersion:row.version};
}
export async function revokeProjectSheetToken(db: D1Database, actor: PortalActor | null, projectId: string, input: Record<string, unknown>) {
 const current=await requireProjectSheetAccess(db,actor,projectId,true),now=iso(),id=text(input.id,100);
 await db.batch([managerGuard(db,current,projectId), db.prepare('UPDATE project_sheet_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND connection_id IN(SELECT id FROM project_sheet_connections WHERE project_id=?)').bind(now,id,projectId), db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,'project_sheet.token.revoke',?,'{}',? WHERE changes()>0").bind(uid(),current.userId,projectId,id,now)]);
 return {id,revokedAt:now};
}
/** Credential identity, workbook binding and live role are reevaluated inside domain transactions too. */
export function projectSheetGuard(db: D1Database, principal: ProjectSheetPrincipal): D1PreparedStatement {
 const auth=authority(principal.actor,principal.projectId,true);
 return db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM project_sheet_tokens t JOIN project_sheet_connections c ON c.id=t.connection_id JOIN projects p ON p.id=c.project_id JOIN organizations org ON org.id=p.organization_id AND org.status='active' JOIN portal_users issuer ON issuer.user_id=t.user_id AND issuer.status='active' AND issuer.activation_pending=0 AND issuer.anonymized_at IS NULL WHERE t.id=? AND t.token_hash=? AND t.user_id=? AND t.scope=? AND t.revoked_at IS NULL AND t.expires_at>? AND t.connection_version=c.version AND c.id=? AND c.project_id=? AND c.spreadsheet_id=? AND c.version=? AND c.enabled=1 AND p.status='active' AND NOT EXISTS(SELECT 1 FROM settings WHERE name=? AND CASE WHEN json_valid(value) THEN json_extract(value,'$.spreadsheetId') END=c.spreadsheet_id)) AND ${auth.sql} THEN 1 ELSE json_extract('[]','project_sheet_credential_changed') END`).bind(principal.tokenId,principal.tokenHash,principal.actor.userId,principal.scope,iso(),principal.connectionId,principal.projectId,principal.spreadsheetId,principal.connectionVersion,SYNC_CONFIGURATION_KEY,...auth.values);
}
export async function requireProjectSheetPrincipal(db: D1Database, principal: ProjectSheetPrincipal) {
 try { await projectSheetGuard(db,principal).first(); } catch { throw new HttpError(403,'A chave, o vínculo ou as permissões do responsável mudaram. Reconecte a planilha.','project_sheet_credential_changed'); }
}
export async function projectSheetPrincipal(db: D1Database, authorization: string | null, spreadsheetId: unknown): Promise<ProjectSheetPrincipal> {
 const match=/^Bearer\s+(pxp_[A-Za-z0-9_-]{43})$/.exec(authorization??'');
 if(!match)throw new HttpError(401,'Informe uma chave restrita de projeto.','sync_token_required');
 const hash=await syncDigest(match[1]),row=await one(db,'SELECT t.*,c.project_id,c.spreadsheet_id,c.include_tasks,u.email FROM project_sheet_tokens t JOIN project_sheet_connections c ON c.id=t.connection_id JOIN portal_users u ON u.user_id=t.user_id WHERE t.token_hash=?',[hash]);
 if(!row)throw new HttpError(401,'Chave de projeto inválida.','sync_token_invalid');
 if(spreadsheetId!==row.spreadsheet_id)throw new HttpError(403,'A chave pertence a outro arquivo Google.','project_sheet_workbook_mismatch');
 const actor=await getActor(db,{userId:row.user_id,email:row.email,displayName:row.email});
 if(!actor)throw new HttpError(403,'Conta do responsável indisponível.','project_sheet_credential_changed');
 const principal:ProjectSheetPrincipal={actor,tokenId:row.id,tokenHash:hash,connectionId:row.connection_id,connectionVersion:row.connection_version,projectId:row.project_id,spreadsheetId:row.spreadsheet_id,scope:row.scope,includeTasks:Boolean(row.include_tasks)};
 await requireProjectSheetPrincipal(db,principal);
 await db.prepare('UPDATE project_sheet_tokens SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<?)').bind(iso(),row.id,new Date(Date.now()-60000).toISOString()).run();
 return principal;
}
