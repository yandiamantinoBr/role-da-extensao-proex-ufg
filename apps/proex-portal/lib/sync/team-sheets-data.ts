import { all, one, iso, uid } from '../database';
import { HttpError } from '../errors';
import { canonicalSyncJson, MAX_PORTABLE_TABLE_BYTES, MAX_PORTABLE_TABLE_ROWS, syncDigest, type PortableSchema, type PortableRow } from './contracts';
import { requireTeamSheetPrincipal, teamSheetGuard, type TeamSheetPrincipal } from './team-sheets';

const SCHEMA:PortableSchema={table:'followup_tasks',label:'Demandas da equipe neste projeto',sheetName:'PROEX · Demandas da equipe',mode:'read_only',versionColumn:'version',omitted:['body','assignees','contacts','attachments','history','checklist_rows'],columns:[
 ['_rowKey','Identificador técnico','text'],['_rowHash','Resumo técnico','text'],['id','ID da demanda','text'],['title','Demanda','text'],['status','Estado','text'],['priority','Prioridade','text'],['importance','Importância','text'],['due_at','Prazo (ISO)','text'],['version','Versão','number'],['created_at','Criada em','datetime'],['updated_at','Atualizada em','datetime'],['portal_url','Editar no Portal','text'],
].map(([name,label,type])=>({name,label,type:type as 'text'|'number'|'datetime',editable:false,required:false,system:true,private:false}))};
function invalid(message:string,code='team_sheet_invalid',status=400):never{throw new HttpError(status,message,code);}
const runId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,120}$/.test(value);
const digestValid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const isObject=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const only=(args:Record<string,unknown>,fields:string[])=>{if(Object.keys(args).some(field=>!fields.includes(field)))invalid('Há campos indisponíveis nesta consulta.');};
function liveRun(db:D1Database,p:TeamSheetPrincipal,id:string){return db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM team_sheet_runs WHERE id=? AND token_id=? AND connection_id=? AND connection_version=? AND status='running' AND started_at>?) THEN 1 ELSE json_extract('[]','team_sheet_run_changed') END").bind(id,p.tokenId,p.connectionId,p.connectionVersion,new Date(Date.now()-10*60*1000).toISOString());}
async function guarded(db:D1Database,p:TeamSheetPrincipal,statements:D1PreparedStatement[]){try{return await db.batch([teamSheetGuard(db,p),...statements]);}catch(error){await requireTeamSheetPrincipal(db,p);if(String(error).includes('sync_snapshot_changed'))invalid('A atribuição ou os dados mudaram durante a consulta.','sync_snapshot_changed',409);if(String(error).includes('team_sheet_run_changed'))invalid('A execução encerrou ou expirou. Inicie uma nova consulta.','team_sheet_run_changed',409);throw error;}}
function origin(value:string){const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)invalid('Origem do portal inválida.');return url.origin;}

type ProjectedRow={_rowKey:string;id:string;title:string;status:string;priority:string;importance:string|null;due_at:string|null;version:number;created_at:string;updated_at:string;portal_url:string};
async function projectedRows(db:D1Database,p:TeamSheetPrincipal,portal:string):Promise<ProjectedRow[]>{
 const rows=await all(db,`SELECT t.id _rowKey,t.id,t.title,t.status,t.priority,t.importance,t.due_at,t.version,t.created_at,t.updated_at FROM followup_tasks t
 WHERE t.project_id=? AND EXISTS(SELECT 1 FROM followup_assignees a JOIN followup_teams team ON team.id=a.team_id WHERE a.task_id=t.id AND a.team_id=? AND a.removed_at IS NULL AND team.organization_id=t.organization_id AND team.status='active')
 ORDER BY t.id COLLATE BINARY LIMIT ?`,[p.projectId,p.teamId,MAX_PORTABLE_TABLE_ROWS+1]);
 if(rows.length>MAX_PORTABLE_TABLE_ROWS)invalid('A equipe ultrapassa o limite de 5.000 demandas neste projeto.','team_sheet_table_limit',413);
 return rows.map(row=>({_rowKey:row.id,id:row.id,title:row.title,status:row.status,priority:row.priority,importance:row.importance,due_at:row.due_at,version:row.version,created_at:row.created_at,updated_at:row.updated_at,portal_url:`${portal}/?${new URLSearchParams({module:'demands',project:p.projectId,demandId:row.id})}`}));
}
/** Final linearization point: membership and the complete projected set are asserted inside the same transaction. */
function snapshotGuard(db:D1Database,p:TeamSheetPrincipal,rows:ProjectedRow[]){
 const fields=['title','status','priority','importance','due_at','version','created_at','updated_at'];
 return db.prepare(`SELECT CASE WHEN
 (SELECT COUNT(*) FROM followup_tasks t WHERE t.project_id=? AND EXISTS(SELECT 1 FROM followup_assignees a JOIN followup_teams team ON team.id=a.team_id WHERE a.task_id=t.id AND a.team_id=? AND a.removed_at IS NULL AND team.organization_id=t.organization_id AND team.status='active'))=?
 AND NOT EXISTS(SELECT 1 FROM json_each(?) snapshot LEFT JOIN followup_tasks current ON current.id=json_extract(snapshot.value,'$.id') AND current.project_id=? WHERE current.id IS NULL
 OR ${fields.map(field=>`current.${field} IS NOT json_extract(snapshot.value,'$.${field}')`).join(' OR ')}
 OR NOT EXISTS(SELECT 1 FROM followup_assignees a JOIN followup_teams team ON team.id=a.team_id WHERE a.task_id=current.id AND a.team_id=? AND a.removed_at IS NULL AND team.organization_id=current.organization_id AND team.status='active'))
 THEN 1 ELSE json_extract('[]','sync_snapshot_changed') END`).bind(p.projectId,p.teamId,rows.length,canonicalSyncJson(rows),p.projectId,p.teamId);
}

export async function exportTeamSheetPage(db:D1Database,p:TeamSheetPrincipal,args:Record<string,unknown>,portalOrigin:string){
 only(args,['table','limit','after','expectedDigest','runId']);await requireTeamSheetPrincipal(db,p);
 if(args.table!=='followup_tasks')invalid('Esta planilha consulta somente demandas atribuídas à equipe.','team_sheet_invalid_table');
 if(!runId(args.runId))invalid('Inicie uma execução antes de consultar.');
 const limit=args.limit===undefined?100:args.limit;if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>100)invalid('Consulte de 1 a 100 linhas por página.');
 if(args.after!==undefined&&typeof args.after!=='string'||args.expectedDigest!==undefined&&!digestValid(args.expectedDigest)||args.after&&!args.expectedDigest)invalid('Cursor ou resumo da leitura inválido.');
 const portal=origin(portalOrigin);
 const rows=await projectedRows(db,p,portal),serialized=canonicalSyncJson(rows);if(new TextEncoder().encode(serialized).length>MAX_PORTABLE_TABLE_BYTES)invalid('A projeção ultrapassa o limite permitido.','team_sheet_table_bytes',413);
 const digest=await syncDigest(serialized);if(args.expectedDigest&&args.expectedDigest!==digest)invalid('As demandas mudaram durante a consulta. Reinicie a leitura.','sync_snapshot_changed',409);
 const start=args.after?rows.findIndex(row=>row._rowKey===args.after)+1:0;if(args.after&&start===0)invalid('Cursor fora desta versão.','sync_invalid_cursor',409);
 const selected=rows.slice(start,start+limit),page:PortableRow[]=[];for(const row of selected)page.push({...row,_rowHash:await syncDigest(canonicalSyncJson(row))} as PortableRow);
 // Assignment removal is a read-boundary change even while the issuer retains project/team authority.
 if(await syncDigest(canonicalSyncJson(await projectedRows(db,p,portal)))!==digest)invalid('A atribuição ou os dados mudaram durante a leitura.','sync_snapshot_changed',409);
 await guarded(db,p,[snapshotGuard(db,p,rows),liveRun(db,p,args.runId),db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM team_sheet_runs WHERE id=? AND(snapshot_digest IS NULL OR snapshot_digest=?)) THEN 1 ELSE json_extract('[]','team_sheet_run_changed') END").bind(args.runId,digest),db.prepare("UPDATE team_sheet_runs SET snapshot_digest=?,expected_count=? WHERE id=? AND token_id=? AND status='running'").bind(digest,rows.length,args.runId,p.tokenId)]);
 return{formatVersion:1,table:'followup_tasks',digest,rows:page,total:rows.length,nextCursor:start+limit<rows.length?selected[selected.length-1]._rowKey:null,readOnly:true,schema:SCHEMA};
}
export async function callTeamSheetTool(db:D1Database,p:TeamSheetPrincipal,tool:unknown,args:Record<string,unknown>,portalOrigin:string){
 await requireTeamSheetPrincipal(db,p);
 if(tool==='proex_sync_apply'||tool==='proex_sync_configure')invalid('Esta conexão é somente de consulta. Abra a demanda no Portal para editar.','team_sheet_read_only',403);
 if(tool==='proex_sync_describe'){
  only(args,[]);const context=await one(db,'SELECT t.name team_name,p.name project_name FROM followup_teams t JOIN projects p ON p.id=? WHERE t.id=?',[p.projectId,p.teamId]);
  const runs=await all(db,'SELECT id,status,started_at,finished_at,exported_count,readback_verified FROM team_sheet_runs WHERE connection_id=? AND connection_version=? ORDER BY started_at DESC,id DESC LIMIT 5',[p.connectionId,p.connectionVersion]);await requireTeamSheetPrincipal(db,p);
  return{configuration:{teamId:p.teamId,projectId:p.projectId,spreadsheetId:p.spreadsheetId,teamName:context!.team_name,projectName:context!.project_name,scope:'read',readOnly:true},schemas:{formatVersion:1,tables:[SCHEMA],limits:{page:100,tableRows:5000,tableBytes:MAX_PORTABLE_TABLE_BYTES}},runs};
 }
 if(tool==='proex_sync_read')return exportTeamSheetPage(db,p,args,portalOrigin);
 if(tool==='proex_sync_run_start'){
  only(args,['requestId']);if(!runId(args.requestId))invalid('Informe um identificador de execução válido.');const at=iso(),identifier=uid();
  await guarded(db,p,[db.prepare("UPDATE team_sheet_runs SET status='failed',finished_at=? WHERE connection_id=? AND status='running' AND started_at<=?").bind(at,p.connectionId,new Date(Date.now()-10*60*1000).toISOString()),
  db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM team_sheet_runs WHERE connection_id=? AND status='running' AND NOT(token_id=? AND request_id=?)) THEN 1 ELSE json_extract('[]','team_sheet_run_changed') END").bind(p.connectionId,p.tokenId,args.requestId),
  db.prepare("INSERT INTO team_sheet_runs(id,connection_id,token_id,connection_version,request_id,status,started_at) VALUES(?,?,?,?,?,'running',?) ON CONFLICT(token_id,request_id) DO NOTHING").bind(identifier,p.connectionId,p.tokenId,p.connectionVersion,args.requestId,at)]);
  const result=await one(db,'SELECT id,status FROM team_sheet_runs WHERE token_id=? AND request_id=?',[p.tokenId,args.requestId]);await requireTeamSheetPrincipal(db,p);return result;
 }
 if(tool==='proex_sync_run_finish'){
  only(args,['id','status','exportedCount','readbackVerified','snapshotDigest','tablesVerified']);if(!runId(args.id)||!['completed','failed'].includes(String(args.status))||typeof args.exportedCount!=='number'||!Number.isSafeInteger(args.exportedCount)||args.exportedCount<0||args.exportedCount>5000)invalid('Resultado de execução inválido.');
  const old=await one(db,'SELECT * FROM team_sheet_runs WHERE id=? AND token_id=? AND connection_id=?',[args.id,p.tokenId,p.connectionId]);if(!old)invalid('Execução não encontrada.','team_sheet_run_changed',409);
  const current=await projectedRows(db,p,origin(portalOrigin)),currentDigest=await syncDigest(canonicalSyncJson(current));
  const verified=args.status==='completed'&&args.readbackVerified===true&&args.tablesVerified===1&&digestValid(args.snapshotDigest)&&args.snapshotDigest===old!.snapshot_digest&&args.snapshotDigest===currentDigest&&args.exportedCount===old!.expected_count;
  const status=verified?'completed':'failed';
  if(old!.status!=='running'){await guarded(db,p,[snapshotGuard(db,p,current)]);if(old!.status===status&&old!.exported_count===args.exportedCount)return{id:args.id,status,duplicate:true};invalid('A execução já foi encerrada.','team_sheet_run_changed',409);}
  await guarded(db,p,[snapshotGuard(db,p,current),liveRun(db,p,args.id),db.prepare("UPDATE team_sheet_runs SET status=?,finished_at=?,exported_count=?,readback_verified=? WHERE id=? AND token_id=? AND status='running'").bind(status,iso(),args.exportedCount,verified?1:0,args.id,p.tokenId)]);
  return{id:args.id,status};
 }
 if(tool==='proex_team_sheet_tab'){
  only(args,['gid']);if(typeof args.gid!=='number'||!Number.isInteger(args.gid)||args.gid<0||args.gid>2147483647)invalid('Aba inválida.');await guarded(db,p,[db.prepare('UPDATE team_sheet_connections SET sheet_gid=?,tabs_version=tabs_version+1 WHERE id=? AND version=?').bind(args.gid,p.connectionId,p.connectionVersion)]);await requireTeamSheetPrincipal(db,p);return{ok:true};
 }
 if(!isObject(args))invalid('Envie os argumentos da consulta.');
 invalid('Ferramenta indisponível neste conector de equipe.','team_sheet_unknown_tool');
}
