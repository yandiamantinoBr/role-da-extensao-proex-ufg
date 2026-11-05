import { memberProjectScopeSql, type PortalActor } from '../access';
import { all, one, iso, uid, type Row } from '../database';
import { HttpError } from '../errors';
import { activeAccount, actorRequired, authority } from '../follow-up/scope';
import { id, text, onlyKeys } from '../follow-up/contracts';
import { syncDigest, SYNC_CONFIGURATION_KEY } from './contracts';

export const TEAM_SHEET_SCRIPT='/integracoes/proex-equipe-planilha.gs';
export type TeamSheetPrincipal={tokenId:string;tokenHash:string;connectionId:string;connectionVersion:number;teamId:string;projectId:string;spreadsheetId:string;userId:string;memberId:string;teamMemberId:string};
const fileId=(value:unknown):value is string=>typeof value==='string'&&/^[-_A-Za-z0-9]{10,200}$/.test(value);
const expected=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
function fail(message:string,code='team_sheet_invalid',status=400):never{throw new HttpError(status,message,code);}

async function scope(db:D1Database,actor:PortalActor|null,teamId:string,projectId:string,manage=false) {
 actorRequired(actor);id(teamId);id(projectId);
 const row=await one(db,`SELECT t.id team_id,t.name team_name,t.organization_id,p.id project_id,p.name project_name,
 ${authority('?','t.organization_id','p.id',true,true)} can_manage,
 (SELECT tm.id FROM followup_team_members tm WHERE tm.team_id=t.id AND tm.user_id=? AND tm.removed_at IS NULL) affiliation_id
 FROM followup_teams t JOIN projects p ON p.organization_id=t.organization_id JOIN organizations o ON o.id=t.organization_id
 WHERE t.id=? AND p.id=? AND t.status='active' AND p.status='active' AND o.status='active'
 AND ${authority('?','t.organization_id','p.id')}`,[actor.userId,actor.userId,teamId,projectId,actor.userId]);
 if(!row||manage&&!row.can_manage||!manage&&!row.can_manage&&!row.affiliation_id)fail('Seu acesso ou vínculo com esta equipe mudou.','team_sheet_forbidden',403);
 return row!;
}
function managementGuard(db:D1Database,actor:PortalActor,teamId:string,projectId:string) {
 return db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM followup_teams t JOIN projects p ON p.organization_id=t.organization_id JOIN organizations o ON o.id=t.organization_id WHERE t.id=? AND p.id=? AND t.status='active' AND p.status='active' AND o.status='active' AND ${authority('?','t.organization_id','p.id',true,true)}) THEN 1 ELSE json_extract('[]','team_sheet_forbidden') END`).bind(teamId,projectId,actor.userId);
}
function audit(db:D1Database,actor:PortalActor,projectId:string,action:string,entityId:string,at:string) {return db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,'{}',?)").bind(uid(),actor.userId,projectId,action,entityId,at);}
async function connection(db:D1Database,teamId:string,projectId:string){return one(db,'SELECT * FROM team_sheet_connections WHERE team_id=? AND project_id=?',[teamId,projectId]);}
function present(row:Row|null){if(!row)return null;const url=`https://docs.google.com/spreadsheets/d/${row.spreadsheet_id}/edit`;return{id:row.id,spreadsheetId:row.spreadsheet_id,label:row.label,enabled:Boolean(row.enabled),version:row.version,sheetGid:row.sheet_gid,tabsVersion:row.tabs_version,url:row.sheet_gid===null?url:`${url}?gid=${row.sheet_gid}#gid=${row.sheet_gid}`,updatedAt:row.updated_at};}
async function translate(db:D1Database,actor:PortalActor,teamId:string,projectId:string,error:unknown):Promise<never>{
 await scope(db,actor,teamId,projectId,true);const message=String(error);
 if(message.includes('team_sheet_file_collision')||message.includes('UNIQUE'))fail('Esse arquivo já está vinculado à mestre, a um projeto ou a outra equipe. Escolha um arquivo exclusivo.','team_sheet_file_collision',409);
 if(message.includes('team_sheet_changed'))fail('O vínculo mudou. Atualize antes de salvar.','team_sheet_changed',409);
 if(message.includes('team_sheet_forbidden'))fail('Seu acesso ou vínculo com esta equipe mudou.','team_sheet_forbidden',403);
 if(message.includes('team_sheet_credential_changed'))fail('A credencial ou sua afiliação mudou. Confira o vínculo antes de continuar.','team_sheet_credential_changed',403);
 if(message.includes('team_sheet_token_limit'))fail('Revogue uma chave antiga antes de gerar outra.','team_sheet_token_limit',409);
 throw error;
}
export async function teamSheetStatus(db:D1Database,actor:PortalActor|null,teamId:string,projectId:string){
 const context=await scope(db,actor,teamId,projectId),row=await connection(db,teamId,projectId);
 const tokens=context.can_manage&&row?await all(db,'SELECT id,label,created_at,expires_at,revoked_at FROM team_sheet_tokens WHERE connection_id=? ORDER BY (revoked_at IS NULL AND expires_at>?) DESC,created_at DESC LIMIT 30',[row.id,iso()]):[];
 const runs=row?await all(db,'SELECT id,status,started_at,finished_at,exported_count,readback_verified FROM team_sheet_runs WHERE connection_id=? AND connection_version=? ORDER BY started_at DESC,id DESC LIMIT 5',[row.id,row.version]):[];
 const final=await scope(db,actor,teamId,projectId);if(Boolean(final.can_manage)!==Boolean(context.can_manage)||final.affiliation_id!==context.affiliation_id)fail('Seus vínculos mudaram. Atualize a página.','team_sheet_forbidden',403);
 return{teamId,projectId,teamName:context.team_name,projectName:context.project_name,canManage:Boolean(context.can_manage),canIssue:Boolean(context.can_manage&&context.affiliation_id),canOpen:Boolean(context.affiliation_id||context.can_manage),connection:present(row),tokens,runs,scriptUrl:TEAM_SHEET_SCRIPT,readOnly:true};
}
export async function configureTeamSheet(db:D1Database,actor:PortalActor|null,teamId:string,projectId:string,input:Record<string,unknown>){
 await scope(db,actor,teamId,projectId,true);actorRequired(actor);onlyKeys(input,['action','spreadsheetId','label','enabled','expectedVersion']);
 if(!fileId(input.spreadsheetId)||!expected(input.expectedVersion)||input.enabled!==undefined&&typeof input.enabled!=='boolean')fail('Confira o ID do arquivo, a versão e a situação.');
 const old=await connection(db,teamId,projectId);if((old?.version??0)!==input.expectedVersion)fail('O vínculo mudou. Atualize antes de salvar.','team_sheet_changed',409);
 const connectionId=old?.id??uid(),at=iso(),label=text(input.label??'Demandas da equipe',100);
 try{await db.batch([managementGuard(db,actor,teamId,projectId),db.prepare("SELECT CASE WHEN COALESCE((SELECT version FROM team_sheet_connections WHERE team_id=? AND project_id=?),0)=? THEN 1 ELSE json_extract('[]','team_sheet_changed') END").bind(teamId,projectId,input.expectedVersion),
 db.prepare("INSERT INTO team_sheet_connections(id,team_id,project_id,spreadsheet_id,label,enabled,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?) ON CONFLICT(team_id,project_id) DO UPDATE SET spreadsheet_id=excluded.spreadsheet_id,label=excluded.label,enabled=excluded.enabled,version=team_sheet_connections.version+1,sheet_gid=NULL,tabs_version=0,updated_at=excluded.updated_at").bind(connectionId,teamId,projectId,input.spreadsheetId,label,input.enabled===false?0:1,actor.userId,at,at),
 db.prepare('UPDATE team_sheet_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE connection_id=?').bind(at,connectionId),db.prepare("UPDATE team_sheet_runs SET status='failed',finished_at=? WHERE connection_id=? AND status='running'").bind(at,connectionId),audit(db,actor,projectId,'team_sheet.configure',connectionId,at)]);}catch(error){return translate(db,actor,teamId,projectId,error);}
 return teamSheetStatus(db,actor,teamId,projectId);
}
export async function createTeamSheetToken(db:D1Database,actor:PortalActor|null,teamId:string,projectId:string,input:Record<string,unknown>){
 const context=await scope(db,actor,teamId,projectId,true);actorRequired(actor);onlyKeys(input,['action','expectedVersion','label','days']);
 if(!context.affiliation_id)fail('Para executar esta consulta, entre na equipe e mantenha acesso de gestão ao projeto. A afiliação não altera suas permissões.','team_sheet_affiliation_required',403);
 const row=await connection(db,teamId,projectId);if(!row?.enabled||row.version!==input.expectedVersion)fail('Confira o vínculo ativo antes de gerar a chave.','team_sheet_changed',409);
 const days=input.days===undefined?7:input.days;if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>30)fail('Escolha de 1 a 30 dias.');
 const grant=await one(db,`SELECT m.id FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN('owner','manager') AND ${memberProjectScopeSql('m','?')} ORDER BY CASE WHEN m.project_id IS NOT NULL THEN 0 WHEN m.organization_id IS NOT NULL THEN 1 ELSE 2 END,m.id LIMIT 1`,[actor.userId,projectId]);
 if(!grant)fail('Seu acesso de gestão mudou.','team_sheet_forbidden',403);
 const token='pxt_'+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const tokenId=uid(),tokenHash=await syncDigest(token),at=iso(),expiresAt=new Date(Date.now()+days*86400000).toISOString(),label=text(input.label??'Consulta da equipe',80);
 const principal:TeamSheetPrincipal={tokenId,tokenHash,connectionId:row.id,connectionVersion:row.version,teamId,projectId,spreadsheetId:row.spreadsheet_id,userId:actor.userId,memberId:grant.id,teamMemberId:context.affiliation_id};
 try{await db.batch([managementGuard(db,actor,teamId,projectId),
 db.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM team_sheet_tokens WHERE connection_id=? AND revoked_at IS NULL AND expires_at>?)<5 AND (SELECT COUNT(*) FROM team_sheet_tokens WHERE user_id=? AND created_at>?)<20 THEN 1 ELSE json_extract('[]','team_sheet_token_limit') END").bind(row.id,at,actor.userId,new Date(Date.now()-86400000).toISOString()),
 db.prepare('INSERT INTO team_sheet_tokens(id,connection_id,connection_version,token_hash,user_id,member_id,team_member_id,label,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(tokenId,row.id,row.version,tokenHash,actor.userId,grant.id,context.affiliation_id,label,at,expiresAt),teamSheetGuard(db,principal),audit(db,actor,projectId,'team_sheet.token.create',tokenId,at)]);}catch(error){return translate(db,actor,teamId,projectId,error);}
 return{id:tokenId,token,label,expiresAt};
}
export async function revokeTeamSheetToken(db:D1Database,actor:PortalActor|null,teamId:string,projectId:string,input:Record<string,unknown>){
 await scope(db,actor,teamId,projectId,true);actorRequired(actor);onlyKeys(input,['action','id']);const tokenId=id(input.id),at=iso();
 await db.batch([managementGuard(db,actor,teamId,projectId),db.prepare('UPDATE team_sheet_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND connection_id IN(SELECT id FROM team_sheet_connections WHERE team_id=? AND project_id=?)').bind(at,tokenId,teamId,projectId),
 db.prepare("UPDATE team_sheet_runs SET status='failed',finished_at=? WHERE token_id=? AND status='running' AND connection_id IN(SELECT id FROM team_sheet_connections WHERE team_id=? AND project_id=?)").bind(at,tokenId,teamId,projectId),audit(db,actor,projectId,'team_sheet.token.revoke',tokenId!,at)]);
 return{id:tokenId,revokedAt:at};
}

export function teamSheetGuard(db:D1Database,p:TeamSheetPrincipal){return db.prepare(`SELECT CASE WHEN EXISTS(
 SELECT 1 FROM team_sheet_tokens k JOIN team_sheet_connections c ON c.id=k.connection_id JOIN followup_teams t ON t.id=c.team_id JOIN projects p ON p.id=c.project_id AND p.organization_id=t.organization_id JOIN organizations o ON o.id=t.organization_id
 JOIN portal_users u ON u.user_id=k.user_id JOIN members m ON m.id=k.member_id AND m.user_id=k.user_id JOIN followup_team_members tm ON tm.id=k.team_member_id AND tm.team_id=t.id AND tm.user_id=k.user_id
 WHERE k.id=? AND k.token_hash=? AND k.user_id=? AND k.member_id=? AND k.team_member_id=? AND k.revoked_at IS NULL AND k.expires_at>? AND k.connection_version=c.version
 AND c.id=? AND c.version=? AND c.enabled=1 AND c.team_id=? AND c.project_id=? AND c.spreadsheet_id=? AND t.status='active' AND p.status='active' AND o.status='active' AND ${activeAccount('u')}
 AND tm.removed_at IS NULL AND m.revoked_at IS NULL AND m.role IN('owner','manager') AND ${memberProjectScopeSql('m','p.id')}
 AND NOT EXISTS(SELECT 1 FROM project_sheet_connections other WHERE other.spreadsheet_id=c.spreadsheet_id)
 AND NOT EXISTS(SELECT 1 FROM settings s WHERE s.name=? AND CASE WHEN json_valid(s.value) THEN json_extract(s.value,'$.spreadsheetId') END=c.spreadsheet_id)
 ) THEN 1 ELSE json_extract('[]','team_sheet_credential_changed') END`).bind(p.tokenId,p.tokenHash,p.userId,p.memberId,p.teamMemberId,iso(),p.connectionId,p.connectionVersion,p.teamId,p.projectId,p.spreadsheetId,SYNC_CONFIGURATION_KEY);}
export async function requireTeamSheetPrincipal(db:D1Database,p:TeamSheetPrincipal){try{await teamSheetGuard(db,p).first();}catch{fail('A credencial, o acesso ou a afiliação mudou. Reconecte após conferir o vínculo.','team_sheet_credential_changed',403);}}
export async function teamSheetPrincipal(db:D1Database,authorization:string|null,spreadsheetId:unknown):Promise<TeamSheetPrincipal>{
 const match=/^Bearer\s+(pxt_[A-Za-z0-9_-]{43})$/.exec(authorization??'');if(!match)fail('Informe uma chave de consulta desta equipe.','team_sheet_token_required',401);
 const tokenHash=await syncDigest(match![1]),row=await one(db,'SELECT k.*,c.team_id,c.project_id,c.spreadsheet_id FROM team_sheet_tokens k JOIN team_sheet_connections c ON c.id=k.connection_id WHERE k.token_hash=?',[tokenHash]);
 if(!row)fail('Chave de equipe inválida.','team_sheet_token_invalid',401);
 if(spreadsheetId!==row!.spreadsheet_id)fail('A chave foi emitida para outro arquivo.','team_sheet_workbook_mismatch',403);
 const p:TeamSheetPrincipal={tokenId:row!.id,tokenHash,connectionId:row!.connection_id,connectionVersion:row!.connection_version,teamId:row!.team_id,projectId:row!.project_id,spreadsheetId:row!.spreadsheet_id,userId:row!.user_id,memberId:row!.member_id,teamMemberId:row!.team_member_id};
 await requireTeamSheetPrincipal(db,p);return p;
}
