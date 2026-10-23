import { all, one, iso, uid } from '../database';
import { HttpError } from '../errors';
import { type PortalActor } from '../access';
import { requireSyncOwner, SYNC_OWNER_SQL } from './contracts';
import { describePortableSchemas } from './portable';
import { materialLinksStatus } from './project-links';

const CONFIG = 'sync.google_sheets.configuration';
const RUN_LEASE_MS = 30 * 60 * 1000;
function assertion(db:D1Database,predicate:string,values:unknown[],code:string){return db.prepare(`SELECT CASE WHEN (${predicate}) THEN 1 ELSE json_extract('[]','${code}') END`).bind(...values);}
async function translateControlError(db:D1Database,actor:PortalActor,error:unknown):Promise<never>{
 await requireSyncOwner(db,actor);
 const message=String(error);
 if(message.includes('sync_running'))throw new HttpError(409,'Já existe uma sincronização em andamento.','sync_running');
 if(message.includes('sync_not_configured'))throw new HttpError(409,'Configure a planilha primeiro.','sync_not_configured');
 if(message.includes('sync_run_not_running'))throw new HttpError(409,'Execução encerrada ou não encontrada.','sync_run_not_running');
 if(message.includes('sync_open_conflicts'))throw new HttpError(409,'Resolva os conflitos pendentes antes de concluir esta execução.','sync_open_conflicts');
 throw error;
}
export async function syncStatus(db:D1Database,actor:PortalActor|null) {
 await requireSyncOwner(db,actor);
 const config=await one(db,'SELECT value FROM settings WHERE name=?',[CONFIG]);
 const result={formatVersion:1,schemas:describePortableSchemas(),configuration:config?JSON.parse(config.value):null,
  materialLinks:await materialLinksStatus(db,actor),
  connections:await all(db,'SELECT id,provider,label,external_id,enabled,updated_at FROM sync_connections ORDER BY created_at'),
  runs:await all(db,'SELECT id,connection_id,status,direction,started_at,finished_at,exported_count,applied_count,conflict_count,error_code FROM sync_runs ORDER BY started_at DESC LIMIT 20'),
  conflicts:await all(db,"SELECT id,entity_type,entity_id,expected_version,actual_version,reason,status,created_at FROM sync_conflicts WHERE status='open' ORDER BY created_at DESC LIMIT 100"),
  requestedAt:(await one(db,"SELECT value FROM settings WHERE name='sync.requested_at'"))?.value??null,
  instructions:'A base operacional é transacional. A planilha permite editar apenas metadados autorizados. Saldos, permissões, resultados e histórico são calculados pelo portal. Uma configuração salva não comprova sincronização; confira uma execução concluída com leitura de retorno.'};
 await requireSyncOwner(db,actor);return result;
}
function externalId(value:unknown,label:string){if(typeof value!=='string'||!/^[-_A-Za-z0-9]{10,200}$/.test(value))throw new HttpError(400,`Informe um identificador válido de ${label}.`,'sync_invalid_external_id');return value;}
export async function configureSync(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>){
 await requireSyncOwner(db,actor);if(!actor)throw new HttpError(401,'Entre para configurar.');
 const spreadsheetId=externalId(input.spreadsheetId,'planilha'),folderId=externalId(input.folderId,'pasta'),attachmentsFolderId=externalId(input.attachmentsFolderId,'pasta de anexos');
 const now=iso(),configuration={spreadsheetId,spreadsheetUrl:`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,folderId,attachmentsFolderId,formatVersion:1};
 try{await db.batch([
  db.prepare(`SELECT CASE WHEN ${SYNC_OWNER_SQL} THEN 1 ELSE json_extract('sync_forbidden','$') END`).bind(actor.userId),
  assertion(db,"NOT EXISTS(SELECT 1 FROM sync_runs WHERE connection_id='google-sheets' AND status='running' AND started_at>?)",[new Date(Date.now()-RUN_LEASE_MS).toISOString()],'sync_running'),
  db.prepare("UPDATE sync_runs SET status='failed',finished_at=?,error_code='interrupted' WHERE connection_id='google-sheets' AND status='running'").bind(now),
  db.prepare("INSERT INTO sync_connections(id,provider,label,external_id,enabled,created_by,created_at,updated_at) VALUES('google-sheets','google_sheets','Planilha operacional PROEX',?,0,?,?,?) ON CONFLICT(id) DO UPDATE SET external_id=excluded.external_id,enabled=CASE WHEN EXISTS(SELECT 1 FROM settings WHERE name=? AND value=?) THEN sync_connections.enabled ELSE 0 END,updated_at=excluded.updated_at").bind(spreadsheetId,actor.userId,now,now,CONFIG,JSON.stringify(configuration)),
  db.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(CONFIG,JSON.stringify(configuration),now),
  db.prepare("INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) VALUES(?,?,'sync.configure','google-sheets','{}',?)").bind(uid(),actor.userId,now),
 ]);}catch(error){return translateControlError(db,actor,error);}return {configuration};
}
export async function requestSync(db:D1Database,actor:PortalActor|null){
 await requireSyncOwner(db,actor);if(!actor)throw new HttpError(401,'Entre para continuar.');
 const now=iso();try{await db.batch([db.prepare(`SELECT CASE WHEN ${SYNC_OWNER_SQL} THEN 1 ELSE json_extract('sync_forbidden','$') END`).bind(actor.userId),db.prepare("INSERT INTO settings(name,value,updated_at) VALUES('sync.requested_at',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(now,now)]);}catch(error){return translateControlError(db,actor,error);}
 return {requestedAt:now,message:'Solicitação registrada. Ela será atendida pela rotina conectada; consulte o histórico para confirmar a conclusão.'};
}
export async function startSyncRun(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>){
 await requireSyncOwner(db,actor);if(!actor)throw new HttpError(401,'Entre para continuar.');
 const connection=await one(db,"SELECT id FROM sync_connections WHERE id='google-sheets'");if(!connection)throw new HttpError(409,'Configure a planilha primeiro.','sync_not_configured');
 const cutoff=new Date(Date.now()-RUN_LEASE_MS).toISOString();
 const previous=await one(db,"SELECT id FROM sync_runs WHERE connection_id='google-sheets' AND status='running' AND started_at>?",[cutoff]);
 if(previous)throw new HttpError(409,'Já existe uma sincronização em andamento.','sync_running');
 const id=uid(),now=iso();try{await db.batch([
 db.prepare(`SELECT CASE WHEN ${SYNC_OWNER_SQL} THEN 1 ELSE json_extract('sync_forbidden','$') END`).bind(actor.userId),
 assertion(db,"EXISTS(SELECT 1 FROM sync_connections WHERE id='google-sheets')",[],'sync_not_configured'),
 assertion(db,"NOT EXISTS(SELECT 1 FROM sync_runs WHERE connection_id='google-sheets' AND status='running' AND started_at>?)",[cutoff],'sync_running'),
 db.prepare("UPDATE sync_runs SET status='failed',finished_at=?,error_code='interrupted' WHERE connection_id='google-sheets' AND status='running'").bind(now),
 db.prepare("INSERT INTO sync_runs(id,connection_id,status,direction,started_by,started_at) VALUES(?,'google-sheets','running','bidirectional',?,?)").bind(id,actor.userId,now),
 ]);}catch(error){return translateControlError(db,actor,error);}return {id,connectionId:'google-sheets',startedAt:now,...input.requestId?{requestId:String(input.requestId).slice(0,120)}:{}};
}
export async function finishSyncRun(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>){
 await requireSyncOwner(db,actor);if(!actor)throw new HttpError(401,'Entre para continuar.');
 if(typeof input.id!=='string'||input.id.length>200||!['completed','conflict','failed'].includes(String(input.status)))throw new HttpError(400,'Informe uma execução e um resultado válidos.');
 const exportedCount=input.exportedCount??0;if(typeof exportedCount!=='number'||!Number.isSafeInteger(exportedCount)||exportedCount<0||exportedCount>150000)throw new HttpError(400,'Contagem inválida.');
 // The cloud caller must attest actual native Sheets readback, not just a successful write request.
 if(input.status==='completed'&&(input.readbackVerified!==true||input.tablesVerified!==describePortableSchemas().tables.length))throw new HttpError(400,'Conclua a leitura de retorno de todas as abas antes de confirmar a sincronização.','sync_readback_required');
 const findRun=()=>one(db,'SELECT id,status,exported_count,finished_at FROM sync_runs WHERE id=? AND started_by=?',[input.id,actor.userId]);
 const run=await findRun();if(!run)throw new HttpError(409,'Execução encerrada ou não encontrada.','sync_run_not_running');
 const replay=(row:Record<string,any>|null)=>row&&row.status===input.status&&row.exported_count===exportedCount?{id:input.id,status:row.status,finishedAt:row.finished_at,duplicate:true}:null;
 if(run.status!=='running'){const saved=replay(run);if(saved)return saved;throw new HttpError(409,'Execução encerrada ou não encontrada.','sync_run_not_running');}
 const code=input.status==='failed'?'provider_or_readback_failed':null,now=iso();
 try{await db.batch([
 db.prepare(`SELECT CASE WHEN ${SYNC_OWNER_SQL} THEN 1 ELSE json_extract('sync_forbidden','$') END`).bind(actor.userId),
 assertion(db,"EXISTS(SELECT 1 FROM sync_runs WHERE id=? AND started_by=? AND status='running')",[input.id,actor.userId],'sync_run_not_running'),
 ...(input.status==='completed'?[assertion(db,"NOT EXISTS(SELECT 1 FROM sync_conflicts WHERE run_id=? AND status='open')",[input.id],'sync_open_conflicts')]:[]),
 db.prepare('UPDATE sync_runs SET status=?,finished_at=?,exported_count=?,error_code=? WHERE id=? AND status=\'running\' AND started_by=?').bind(input.status,now,exportedCount,code,input.id,actor.userId),
 ...(input.status==='completed'?[db.prepare("UPDATE sync_connections SET enabled=1,updated_at=? WHERE id='google-sheets'").bind(now)]:[]),
 db.prepare("INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) VALUES(?,?,'sync.finish',?,'{}',?)").bind(uid(),actor.userId,input.id,now),
 ]);}catch(error){await requireSyncOwner(db,actor);const saved=replay(await findRun());if(saved)return saved;return translateControlError(db,actor,error);}return {id:input.id,status:input.status,finishedAt:now};
}
