import { one, iso, uid, type Row } from '../database';
import { type PortalActor } from '../access';
import { HttpError } from '../errors';
import { materialsAction } from '../materials';
import { campaignAction } from '../campaigns';
import { projectAction } from '../projects';
import { createRecord } from '../records';
import { unitsAction } from '../units';
import { configureMaterialLinks } from './project-links';
import { portableDefinition } from './portable';
import { canonicalSyncJson, syncDigest, requireSyncOwner, SYNC_OWNER_SQL, MAX_SYNC_CHANGES, type PortableChange, type PortableChangeResult } from './contracts';

const APPEND_ACTIONS = new Set(['project.create','project.type.create','project.link.create','project.schedule.create','call.create','material.category.create','item.create','offer.create','stock.move','loan.create','record.create','unit.create','sync.material_links.configure']);
const PROJECT_ACTIONS = new Set(['project.create','project.update','project.type.create','project.type.update','project.link.create','project.link.update','project.schedule.create','project.schedule.update','call.create','call.update']);
const MATERIAL_ACTIONS = new Set(['material.category.create','material.category.update','item.create','item.update','offer.create','stock.move','loan.create']);
const camel = (key:string) => key.replace(/_([a-z])/g,(_match,letter:string)=>letter.toUpperCase());
function prizesEnabled(value:unknown):boolean{
 if(value!==true&&value!==false&&value!==0&&value!==1)throw new HttpError(400,'Informe verdadeiro, falso, zero ou um para habilitar dinâmicas e brindes.','invalid_prizes_enabled');
 return value===true||value===1;
}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function validId(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]/.test(value);}
function curatedCode(error:HttpError):string{return typeof error.code==='string'&&/^[a-z0-9_]{1,80}$/.test(error.code)?error.code:'sync_rejected';}
async function receipt(db:D1Database,key:string,fingerprint:string):Promise<PortableChangeResult|null>{
 const found=await one(db,'SELECT fingerprint,result_json FROM sync_receipts WHERE operation_key=?',[key]);
 if(!found)return null;
 if(found.fingerprint!==fingerprint)throw new HttpError(409,'Esta linha de operação já foi usada com outros dados. Crie outra chave.','sync_operation_changed');
 const result=JSON.parse(found.result_json) as PortableChangeResult;
 return {...result,...(result.status==='applied'?{status:'duplicate' as const}:{})};
}
function operation(change:PortableChange):{action:string;input:Record<string,unknown>;entityId:string|null}{
 if(change.action!==undefined){
  if(change.table!==undefined||change.fields!==undefined||!APPEND_ACTIONS.has(change.action)||!object(change.input))throw new HttpError(400,'Esta operação não é permitida pela integração.','sync_invalid_action');
  // Actor, grants and authority are supplied by the server, never by spreadsheet.
  for(const key of Object.keys(change.input))if(['actor','actorId','userId','role','members','capabilities','stock','reserved'].includes(key))throw new HttpError(400,'A operação contém um campo controlado pelo portal.','sync_system_field');
  const input={...change.input};if(change.action==='project.create'&&input.prizesEnabled!==undefined)input.prizesEnabled=prizesEnabled(input.prizesEnabled);
  return {action:change.action,input,entityId:null};
 }
 const schema=typeof change.table==='string'?portableDefinition(change.table):undefined;
 if(!schema?.updateAction||!validId(change.id)||!object(change.fields)||!Object.keys(change.fields).length)throw new HttpError(400,'Escolha uma linha de metadados editável.','sync_invalid_row');
 if(!Number.isSafeInteger(change.expectedVersion)||Number(change.expectedVersion)<1)throw new HttpError(400,'Informe a versão original da linha.','sync_invalid_version');
 const allowed=new Set(schema.columns.filter(column=>column.editable).map(column=>column.name));
 const fields:Record<string,unknown>={};
 for(const [key,value] of Object.entries(change.fields)){
  if(!allowed.has(key))throw new HttpError(400,'Saldos, permissões e campos calculados não podem ser editados na planilha.','sync_system_field');
  fields[camel(key)]=key==='prizes_enabled'?prizesEnabled(value):value;
 }
 return {action:schema.updateAction,input:{...fields,id:change.id,expectedVersion:change.expectedVersion},entityId:change.id};
}
async function invoke(db:D1Database,actor:PortalActor,action:string,input:Record<string,unknown>){
 if(PROJECT_ACTIONS.has(action))return projectAction(db,actor,action,input);
 if(MATERIAL_ACTIONS.has(action))return materialsAction(db,actor,action,input);
 if(action==='campaign.update')return campaignAction(db,actor,action,input);
 if(action==='record.create')return createRecord(db,actor,input);
 if(action==='unit.create'||action==='unit.update')return unitsAction(db,actor,action,input);
 if(action==='sync.material_links.configure')return configureMaterialLinks(db,actor,input);
 throw new HttpError(400,'Operação de integração não disponível.','sync_invalid_action');
}
// Os serviços legados retornam projeções Row diferentes conforme a operação.
function resultId(result:Row|null,fallback:string|null):string|null{return result?.id||result?.project?.id||result?.item?.id||result?.loan?.id||result?.movement?.id||result?.offer?.id||result?.category?.id||result?.call?.id||result?.link?.id||result?.schedule?.id||result?.record?.id||result?.unit?.id||fallback;}

/** Import is deliberately per-row atomic, not a workbook-wide transaction.
 * Service rules and ledger triggers remain the sole domain writers. */
export async function applyPortableChanges(db:D1Database,actor:PortalActor|null,input:{connectionId?:unknown;runId?:unknown;changes:unknown}):Promise<{results:PortableChangeResult[];applied:number;conflicts:number}>{
 await requireSyncOwner(db,actor);
 if(!actor)throw new HttpError(401,'Entre para sincronizar.','unauthenticated');
 if(!Array.isArray(input.changes)||input.changes.length<1||input.changes.length>MAX_SYNC_CHANGES)throw new HttpError(400,'Envie de 1 a 25 operações por vez.','sync_change_limit');
 if(new TextEncoder().encode(canonicalSyncJson(input.changes)).length>128*1024)throw new HttpError(413,'O lote de operações é muito grande.','sync_input_limit');
 const connectionId=input.connectionId===undefined||input.connectionId===null?null:input.connectionId;
 const runId=input.runId===undefined||input.runId===null?null:input.runId;
 if(connectionId!==null&&(!validId(connectionId)||!await one(db,'SELECT id FROM sync_connections WHERE id=?',[connectionId])))throw new HttpError(400,'Integração não encontrada.','sync_connection_not_found');
 if(runId!==null&&(!validId(runId)||!await one(db,"SELECT id FROM sync_runs WHERE id=? AND status='running' AND (connection_id IS ?)",[runId,connectionId])))throw new HttpError(409,'Execução inexistente ou encerrada.','sync_run_not_running');
 const results:PortableChangeResult[]=[];
 for(const raw of input.changes){
  await requireSyncOwner(db,actor);
  if(!object(raw)||typeof raw.changeKey!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(raw.changeKey))throw new HttpError(400,'Cada operação precisa de uma chave estável de 8 a 120 caracteres.','sync_invalid_change_key');
  const change=raw as PortableChange,key=await syncDigest(`${actor.userId}\nsync\n${change.changeKey}`),fingerprint=await syncDigest(canonicalSyncJson({actorId:actor.userId,change}));
  const replay=await receipt(db,key,fingerprint);if(replay){results.push(replay);continue;}
  let entityId:string|null=validId(change.id)?change.id:null;
  try{
   const op=operation(change);entityId=op.entityId;
   let batches=0;
   const accepted:PortableChangeResult={changeKey:change.changeKey,status:'applied',entityId};
   const guarded={prepare:db.prepare.bind(db),batch:async(statements:D1PreparedStatement[])=>{
    if(++batches>1)throw new Error('sync_service_multiple_transactions');
    const assertions=[
     db.prepare(`SELECT CASE WHEN ${SYNC_OWNER_SQL} THEN 1 ELSE json_extract('sync_forbidden','$') END AS authorized`).bind(actor.userId),
     ...(runId?[db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM sync_runs WHERE id=? AND status='running' AND connection_id IS ?) THEN 1 ELSE json_extract('[]','sync_run_not_running') END").bind(runId,connectionId)]:[]),
     db.prepare('INSERT INTO sync_receipts(operation_key,fingerprint,entity_id,result_json,created_at) VALUES(?,?,?,?,?)').bind(key,fingerprint,entityId,JSON.stringify(accepted),iso()),
    ];
    // Every allowed service ends its successful batch with an audit/version row.
    // Zero-change CAS must roll back the claim, rather than record a false success.
    const tail=[db.prepare("SELECT CASE WHEN changes()>0 THEN 1 ELSE json_extract('[]','sync_domain_changed') END AS committed")];
    if(runId)tail.push(db.prepare('UPDATE sync_runs SET applied_count=applied_count+1 WHERE id=?').bind(runId));
    const values=await db.batch([...assertions,...statements,...tail]);
    return values.slice(assertions.length,assertions.length+statements.length);
   }} as unknown as D1Database;
   const result=await invoke(guarded,actor,op.action,{...op.input,operationKey:key});
   if(!result)throw new HttpError(400,'Operação não reconhecida.','sync_invalid_action');
   if(result.duplicate===true){const winner=await receipt(db,key,fingerprint);if(winner){results.push(winner);continue;}}
   entityId=resultId(result,entityId);
   const finalResult:PortableChangeResult={...accepted,entityId};
   if(!batches){
    // A domain-level replay can return before opening a transaction. Its existing
    // mutation key is already durable; recording our receipt does not repeat it.
    await requireSyncOwner(db,actor);
    await db.batch([
     db.prepare(`SELECT CASE WHEN ${SYNC_OWNER_SQL} THEN 1 ELSE json_extract('sync_forbidden','$') END`).bind(actor.userId),
     ...(runId?[db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM sync_runs WHERE id=? AND status='running' AND connection_id IS ?) THEN 1 ELSE json_extract('[]','sync_run_not_running') END").bind(runId,connectionId)]:[]),
     db.prepare('INSERT INTO sync_receipts(operation_key,fingerprint,entity_id,result_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(operation_key) DO NOTHING').bind(key,fingerprint,entityId,JSON.stringify(finalResult),iso()),
    ]);
   }else await db.prepare('UPDATE sync_receipts SET entity_id=?,result_json=? WHERE operation_key=? AND fingerprint=?').bind(entityId,JSON.stringify(finalResult),key,fingerprint).run();
   results.push(finalResult);
  }catch(error){
   await requireSyncOwner(db,actor);
   const recovered=await receipt(db,key,fingerprint);if(recovered){results.push(recovered);continue;}
   let known=error instanceof HttpError?error:null;
   if(String(error).includes('sync_run_not_running'))throw new HttpError(409,'A execução foi encerrada durante a importação. Abra uma nova execução.','sync_run_not_running');
   if(!known&&String(error).includes('sync_domain_changed'))known=new HttpError(409,'A linha mudou durante a importação.','sync_row_changed');
   if(!known)throw error;
   if(known.status===401||known.status===403)throw known;
   const conflictId=uid(),code=curatedCode(known),status=known.status===409?'conflict':'rejected';
   const result:PortableChangeResult={changeKey:change.changeKey,status,entityId,code,...(status==='conflict'?{conflictId}:{})};
   const actual=change.table&&portableDefinition(change.table)?.versionColumn&&validId(change.id)?await one(db,`SELECT version FROM ${change.table} WHERE id=?`,[change.id]):null;
   const statements=[db.prepare(`SELECT CASE WHEN ${SYNC_OWNER_SQL} THEN 1 ELSE json_extract('sync_forbidden','$') END`).bind(actor.userId),...(runId?[db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM sync_runs WHERE id=? AND status='running' AND connection_id IS ?) THEN 1 ELSE json_extract('[]','sync_run_not_running') END").bind(runId,connectionId)]:[]),db.prepare('INSERT INTO sync_receipts(operation_key,fingerprint,entity_id,result_json,created_at) VALUES(?,?,?,?,?)').bind(key,fingerprint,entityId,JSON.stringify(result),iso())];
   if(status==='conflict')statements.push(db.prepare("INSERT INTO sync_conflicts(id,connection_id,run_id,operation_key,entity_type,entity_id,expected_version,actual_version,reason,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'open',?)").bind(conflictId,connectionId,runId,key,change.table||change.action||'operation',entityId,Number.isSafeInteger(change.expectedVersion)?change.expectedVersion:null,actual?.version??null,code,iso()));
   if(status==='conflict'&&runId)statements.push(db.prepare('UPDATE sync_runs SET conflict_count=conflict_count+1 WHERE id=?').bind(runId));
   try{await db.batch(statements);results.push(result);}catch(race){await requireSyncOwner(db,actor);if(String(race).includes('sync_run_not_running'))throw new HttpError(409,'A execução foi encerrada durante a importação. Abra uma nova execução.','sync_run_not_running');const winner=await receipt(db,key,fingerprint);if(!winner)throw race;results.push(winner);}
  }
 }
 return {results,applied:results.filter(row=>row.status==='applied').length,conflicts:results.filter(row=>row.status==='conflict').length};
}
