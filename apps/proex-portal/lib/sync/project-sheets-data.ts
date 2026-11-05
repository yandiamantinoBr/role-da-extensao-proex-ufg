import { all, one, iso, uid } from '../database';
import { HttpError } from '../errors';
import { materialsAction } from '../materials';
import { portableDefinition } from './portable';
import { canonicalSyncJson, syncDigest, MAX_PORTABLE_TABLE_ROWS, MAX_PORTABLE_TABLE_BYTES, MAX_SYNC_CHANGES, type PortableSchema, type PortableChange, type PortableChangeResult, type PortableRow } from './contracts';
import { isObject, PROJECT_SHEET_TABLES, projectSheetGuard, requireProjectSheetPrincipal, type ProjectSheetPrincipal } from './project-sheets';

// Fields are explicit. In particular no identity, contacts, credentials, financial
// patrimony metadata, private attachments, free-form task body or global catalog.
const PROJECTIONS: Record<string,{fields:string;where:string;editable?:string}> = {
 projects:{fields:'id,name,short_name,status,color,official_url,location,version',where:'id=?'},
 material_categories:{fields:'id,project_id,label,core_kind,description,status,version,created_at,updated_at',where:'project_id=?',editable:'label,description,status'},
 items:{fields:'id,project_id,name,category,category_id,unit,stock,reserved,low_stock,description,condition,asset_code,version,created_at,updated_at',where:'project_id=?',editable:'name,category_id,unit,low_stock,description,condition,asset_code'},
 stock_movements:{fields:'id,item_id,delta,kind,created_at',where:'item_id IN(SELECT id FROM items WHERE project_id=?)'},
 activity_groups:{fields:'id,project_id,title,occurred_at,kind,created_at',where:'project_id=?'},
 loans:{fields:'id,project_id,item_id,action_name,starts_at,ends_at,status,created_at,returned_at,checked_out_at',where:'project_id=? AND item_id IN(SELECT id FROM items WHERE project_id=loans.project_id)'},
 campaigns:{fields:'id,project_id,name,location,starts_at,ends_at,status,version,created_at',where:'project_id=?'},
 project_schedule_items:{fields:'id,project_id,title,starts_at,ends_at,status,url,version,created_at,updated_at',where:'project_id=?'},
 followup_tasks:{fields:'id,project_id,title,priority,status,due_at,version,created_at,updated_at',where:'project_id=?'},
};
function schemas(principal: ProjectSheetPrincipal): PortableSchema[] {
 return PROJECT_SHEET_TABLES.map(table=>{
  const original=portableDefinition(table)!,p=PROJECTIONS[table],fields=new Set(['_rowKey','_rowHash',...p.fields.split(',')]),editable=new Set(principal.scope==='materials'?(p.editable??'').split(','):[]);
  return {...original,sheetName:'PROEX · '+table,mode:p.editable&&principal.scope==='materials'?'metadata':'read_only',updateAction:p.editable&&principal.scope==='materials'?original.updateAction:undefined,columns:original.columns.filter(column=>fields.has(column.name)).map(column=>({...column,editable:editable.has(column.name),system:!editable.has(column.name),private:false})),omitted:original.columns.filter(column=>!fields.has(column.name)).map(column=>column.name)};
 });
}
export async function exportProjectSheetPage(db:D1Database,principal:ProjectSheetPrincipal,input:Record<string,unknown>) {
 await requireProjectSheetPrincipal(db,principal);
 const table=typeof input.table==='string'?input.table:'',definition=PROJECTIONS[table];
 if(!Object.hasOwn(PROJECTIONS,table))throw new HttpError(400,'Tabela indisponível neste projeto.','sync_invalid_table');
 const limit=input.limit===undefined?100:input.limit;
 if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new HttpError(400,'Use de 1 a 100 linhas por página.','sync_invalid_limit');
 if(input.after!==undefined&&typeof input.after!=='string')throw new HttpError(400,'Cursor inválido.','sync_invalid_cursor');
 if(input.expectedDigest!==undefined&&(typeof input.expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedDigest)))throw new HttpError(400,'Resumo inválido.','sync_invalid_digest');
 if(input.after&&!input.expectedDigest)throw new HttpError(400,'Continue com o resumo original.','sync_digest_required');
 const rows=await all(db,`SELECT id AS _rowKey,${definition.fields} FROM ${table} WHERE ${definition.where} ORDER BY id COLLATE BINARY LIMIT ?`,[principal.projectId,MAX_PORTABLE_TABLE_ROWS+1]);
 if(rows.length>MAX_PORTABLE_TABLE_ROWS)throw new HttpError(413,'A tabela excede o limite da projeção.','sync_table_limit');
 const serialized=canonicalSyncJson(rows);
 if(new TextEncoder().encode(serialized).length>MAX_PORTABLE_TABLE_BYTES)throw new HttpError(413,'A tabela excede o tamanho permitido.','sync_table_bytes');
 const digest=await syncDigest(serialized);
 if(input.expectedDigest&&input.expectedDigest!==digest)throw new HttpError(409,'Os dados mudaram durante a leitura. Reinicie esta tabela.','sync_snapshot_changed');
 const start=input.after?rows.findIndex(row=>row._rowKey===input.after)+1:0;
 if(input.after&&start===0)throw new HttpError(409,'Cursor fora desta versão.','sync_invalid_cursor');
 const selected=rows.slice(start,start+limit),page:PortableRow[]=[];
 for(const row of selected)page.push({...row,_rowHash:await syncDigest(canonicalSyncJson(row))} as PortableRow);
 await requireProjectSheetPrincipal(db,principal);
 const schema=schemas(principal).find(row=>row.table===table)!;
 return {formatVersion:1,table,digest,rows:page,total:rows.length,nextCursor:start+limit<rows.length?selected[selected.length-1]._rowKey:null,readOnly:schema.mode==='read_only',schema};
}
function validId(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]/.test(value);}
const camel=(key:string)=>key.replace(/_([a-z])/g,(_match,letter:string)=>letter.toUpperCase());
const APPENDS:Record<string,readonly string[]>={
 'item.create':['projectId','category','categoryId','name','unit','lowStock','description','assetCode'],
 'material.category.create':['projectId','coreKind','label','description'],
 'stock.move':['itemId','kind','delta','note','reason','groupId'],
};
async function projectOperation(db:D1Database,principal:ProjectSheetPrincipal,change:PortableChange){
 if(principal.scope!=='materials')throw new HttpError(403,'A chave é somente de leitura.','project_sheet_read_only');
 let action:string,fields:Record<string,unknown>,target:{table:string;id:string}|null=null;
 if(change.action!==undefined){
  const allowed=APPENDS[change.action];
  if(!Object.hasOwn(APPENDS,change.action)||change.table!==undefined||change.fields!==undefined||!isObject(change.input))throw new HttpError(400,'Operação indisponível nesta planilha.','sync_invalid_action');
  if(Object.keys(change.input).some(key=>!allowed.includes(key)))throw new HttpError(400,'Campo controlado pelo Portal.','sync_system_field');
  action=change.action;fields={...change.input};
  if(action==='stock.move'){if(!validId(fields.itemId))throw new HttpError(400,'Informe o material.','sync_invalid_row');target={table:'items',id:fields.itemId};}
  else {if(fields.projectId!==principal.projectId)throw new HttpError(400,'Operação fora do projeto desta planilha.','project_sheet_scope');fields.projectId=principal.projectId;}
 }else{
  const schema=schemas(principal).find(row=>row.table===change.table);
  if(!schema?.updateAction||!validId(change.id)||!isObject(change.fields)||!Object.keys(change.fields).length)throw new HttpError(400,'Escolha uma linha de material ou categoria editável.','sync_invalid_row');
  if(!Number.isSafeInteger(change.expectedVersion)||Number(change.expectedVersion)<1)throw new HttpError(400,'Informe a versão original.','sync_invalid_version');
  const allowed=new Set(schema.columns.filter(column=>column.editable).map(column=>column.name));
  if(Object.keys(change.fields).some(key=>!allowed.has(key)))throw new HttpError(400,'Campo controlado pelo Portal.','sync_system_field');
  action=schema.updateAction;fields={...Object.fromEntries(Object.entries(change.fields).map(([key,value])=>[camel(key),value])),id:change.id,expectedVersion:change.expectedVersion};target={table:schema.table,id:change.id};
 }
 if(target&&!await one(db,`SELECT 1 FROM ${target.table} WHERE id=? AND project_id=?`,[target.id,principal.projectId]))throw new HttpError(400,'Linha indisponível neste projeto.','project_sheet_scope');
 if(fields.categoryId&&!await one(db,'SELECT 1 FROM material_categories WHERE id=? AND project_id=?',[fields.categoryId,principal.projectId]))throw new HttpError(400,'Categoria indisponível neste projeto.','project_sheet_scope');
 if(fields.groupId&&!await one(db,'SELECT 1 FROM activity_groups WHERE id=? AND project_id=?',[fields.groupId,principal.projectId]))throw new HttpError(400,'Atividade indisponível neste projeto.','project_sheet_scope');
 return {action,fields,target};
}
function targetGuard(db:D1Database,principal:ProjectSheetPrincipal,target:{table:string;id:string}|null){
 return target?[db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${target.table} WHERE id=? AND project_id=?) THEN 1 ELSE json_extract('[]','project_sheet_scope') END`).bind(target.id,principal.projectId)]:[];
}
function runGuard(db:D1Database,principal:ProjectSheetPrincipal,runId:string|null){return runId?[db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM project_sheet_runs WHERE id=? AND token_id=? AND connection_id=? AND connection_version=? AND status='running' AND started_at>?) THEN 1 ELSE json_extract('[]','sync_run_not_running') END").bind(runId,principal.tokenId,principal.connectionId,principal.connectionVersion,new Date(Date.now()-10*60000).toISOString())]:[];}
async function existingReceipt(db:D1Database,key:string,fingerprint:string):Promise<PortableChangeResult|null>{
 const row=await one(db,'SELECT fingerprint,result_json FROM project_sheet_receipts WHERE operation_key=?',[key]);
 if(!row)return null;
 if(row.fingerprint!==fingerprint)throw new HttpError(409,'A chave já foi usada com outros dados. Crie outra operação.','sync_operation_changed');
 const result=JSON.parse(row.result_json) as PortableChangeResult;
 return {...result,...(result.status==='applied'?{status:'duplicate' as const}:{})};
}
function resultId(result:Record<string,unknown>,fallback:string|null){for(const key of ['item','category','movement']){const value=result[key];if(isObject(value)&&typeof value.id==='string')return value.id;}return fallback;}
export async function applyProjectSheetChanges(db:D1Database,principal:ProjectSheetPrincipal,input:Record<string,unknown>){
 await requireProjectSheetPrincipal(db,principal);
 if(principal.scope!=='materials')throw new HttpError(403,'A chave é somente de leitura.','project_sheet_read_only');
 if(!Array.isArray(input.changes)||input.changes.length<1||input.changes.length>MAX_SYNC_CHANGES)throw new HttpError(400,'Envie de 1 a 25 operações.','sync_change_limit');
 if(new TextEncoder().encode(canonicalSyncJson(input.changes)).length>128*1024)throw new HttpError(413,'Lote muito grande.','sync_input_limit');
 const runId=input.runId===undefined||input.runId===null?null:input.runId;
 if(runId!==null&&!validId(runId))throw new HttpError(400,'Execução inválida.','sync_run_not_running');
 const results:PortableChangeResult[]=[];
 for(const raw of input.changes){
  await requireProjectSheetPrincipal(db,principal);
  try{for(const guard of runGuard(db,principal,runId))await guard.first();}catch{throw new HttpError(409,'A execução encerrou. Inicie uma nova sincronização.','sync_run_not_running');}
  if(!isObject(raw)||typeof raw.changeKey!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(raw.changeKey))throw new HttpError(400,'Informe uma chave estável de 8 a 120 caracteres.','sync_invalid_change_key');
  const change=raw as PortableChange,key=await syncDigest(`project-sheet\n${principal.connectionId}\n${change.changeKey}`),fingerprint=await syncDigest(canonicalSyncJson(change));
  const replay=await existingReceipt(db,key,fingerprint);if(replay){results.push(replay);continue;}
  let entityId:string|null=null;
  try{
   const op=await projectOperation(db,principal,change);entityId=op.target?.id??null;
   const accepted:PortableChangeResult={changeKey:change.changeKey,status:'applied',entityId};let batches=0;
   // Resolve the domain-created ID in the same transaction as its receipt. A
   // process crash after COMMIT must still return that ID on the next request.
   const mutationScope=await syncDigest(`${principal.actor.userId}\n${op.action}\n${key}`);
   const durableEntity=op.action==='stock.move'?db.prepare("UPDATE project_sheet_receipts SET entity_id=(SELECT id FROM stock_movements WHERE ref_id=?),result_json=json_set(result_json,'$.entityId',(SELECT id FROM stock_movements WHERE ref_id=?)) WHERE operation_key=?").bind(`manual:${principal.actor.userId}:${key}`,`manual:${principal.actor.userId}:${key}`,key):op.action.endsWith('.create')?db.prepare("UPDATE project_sheet_receipts SET entity_id=(SELECT entity_id FROM mutation_keys WHERE scope=?),result_json=json_set(result_json,'$.entityId',(SELECT entity_id FROM mutation_keys WHERE scope=?)) WHERE operation_key=?").bind(mutationScope,mutationScope,key):null;
   const guarded={prepare:db.prepare.bind(db),batch:async(statements:D1PreparedStatement[])=>{
    if(++batches>1)throw new Error('project_sheet_multiple_transactions');
    const prefix=[projectSheetGuard(db,principal),...runGuard(db,principal,runId),...targetGuard(db,principal,op.target),db.prepare('INSERT INTO project_sheet_receipts(operation_key,connection_id,fingerprint,entity_id,result_json,created_at) VALUES(?,?,?,?,?,?)').bind(key,principal.connectionId,fingerprint,entityId,JSON.stringify(accepted),iso())];
    const tail=[db.prepare("SELECT CASE WHEN changes()>0 THEN 1 ELSE json_extract('[]','sync_domain_changed') END"),...(durableEntity?[durableEntity,db.prepare("SELECT CASE WHEN (SELECT entity_id FROM project_sheet_receipts WHERE operation_key=?) IS NOT NULL THEN 1 ELSE json_extract('[]','sync_domain_changed') END").bind(key)]:[]),...(runId?[db.prepare('UPDATE project_sheet_runs SET applied_count=applied_count+1 WHERE id=?').bind(runId)]:[])];
    const values=await db.batch([...prefix,...statements,...tail]);return values.slice(prefix.length,prefix.length+statements.length);
   }} as unknown as D1Database;
   const output=await materialsAction(guarded,principal.actor,op.action,{...op.fields,operationKey:key});
   if(!output)throw new HttpError(400,'Operação indisponível.','sync_invalid_action');
   entityId=resultId(output,entityId);const final:PortableChangeResult={...accepted,entityId};
   // Domain replays can return before a transaction; still guard the receipt.
   await db.batch([projectSheetGuard(db,principal),...runGuard(db,principal,runId),db.prepare('INSERT INTO project_sheet_receipts(operation_key,connection_id,fingerprint,entity_id,result_json,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(operation_key) DO UPDATE SET entity_id=excluded.entity_id,result_json=excluded.result_json WHERE project_sheet_receipts.fingerprint=excluded.fingerprint').bind(key,principal.connectionId,fingerprint,entityId,JSON.stringify(final),iso())]);
   results.push(final);
  }catch(error){
   await requireProjectSheetPrincipal(db,principal);
   if(String(error).includes('project_sheet_scope'))throw new HttpError(403,'O escopo da linha mudou. Atualize a planilha.','project_sheet_scope');
   if(String(error).includes('sync_run_not_running'))throw new HttpError(409,'A execução encerrou. Inicie uma nova sincronização.','sync_run_not_running');
   const recovered=await existingReceipt(db,key,fingerprint);if(recovered){results.push(recovered);continue;}
   const known=error instanceof HttpError?error:String(error).includes('sync_domain_changed')?new HttpError(409,'A linha mudou.','sync_row_changed'):null;
   if(!known||known.status===401||known.status===403)throw error;
   const conflictId=uid(),status=known.status===409?'conflict':'rejected',code=/^[a-z0-9_]{1,80}$/.test(known.code??'')?known.code:'sync_rejected';
   const result:PortableChangeResult={changeKey:change.changeKey,status,entityId,code,...(status==='conflict'?{conflictId}:{})};
   try{await db.batch([projectSheetGuard(db,principal),...runGuard(db,principal,runId),db.prepare('INSERT INTO project_sheet_receipts(operation_key,connection_id,fingerprint,entity_id,result_json,created_at) VALUES(?,?,?,?,?,?)').bind(key,principal.connectionId,fingerprint,entityId,JSON.stringify(result),iso()),...(status==='conflict'?[db.prepare("INSERT INTO project_sheet_conflicts(id,connection_id,entity_type,entity_id,expected_version,reason,created_at) VALUES(?,?,?,?,?,?,?)").bind(conflictId,principal.connectionId,change.table??change.action??'operation',entityId,change.expectedVersion??null,code,iso()),...(runId?[db.prepare('UPDATE project_sheet_runs SET conflict_count=conflict_count+1 WHERE id=?').bind(runId)]:[])]:[])]);results.push(result);}catch(race){await requireProjectSheetPrincipal(db,principal);const winner=await existingReceipt(db,key,fingerprint);if(!winner)throw race;results.push(winner);}
  }
 }
 return {results,applied:results.filter(row=>row.status==='applied').length,conflicts:results.filter(row=>row.status==='conflict').length};
}
async function describe(db:D1Database,principal:ProjectSheetPrincipal){
 await requireProjectSheetPrincipal(db,principal);
 const runs=await all(db,'SELECT id,status,started_at,finished_at,exported_count,applied_count,conflict_count FROM project_sheet_runs WHERE connection_id=? ORDER BY started_at DESC LIMIT 10',[principal.connectionId]);
 const conflicts=await all(db,"SELECT id,entity_type,entity_id,expected_version,reason,status,created_at FROM project_sheet_conflicts WHERE connection_id=? AND status='open' ORDER BY created_at DESC LIMIT 100",[principal.connectionId]);
 await requireProjectSheetPrincipal(db,principal);
 return {configuration:{spreadsheetId:principal.spreadsheetId,projectId:principal.projectId,scope:principal.scope},schemas:{formatVersion:1,tables:schemas(principal),limits:{page:100,tableRows:MAX_PORTABLE_TABLE_ROWS,tableBytes:MAX_PORTABLE_TABLE_BYTES}},runs,conflicts};
}
export async function callProjectSheetTool(db:D1Database,principal:ProjectSheetPrincipal,tool:unknown,args:Record<string,unknown>){
 await requireProjectSheetPrincipal(db,principal);
 if(tool==='proex_sync_describe')return describe(db,principal);
 if(tool==='proex_sync_read')return exportProjectSheetPage(db,principal,args);
 if(tool==='proex_sync_apply')return applyProjectSheetChanges(db,principal,args);
 if(tool==='proex_sync_run_start'){
  if(typeof args.requestId!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(args.requestId))throw new HttpError(400,'Identificador de execução inválido.','invalid_input');
  const id=uid();await db.batch([projectSheetGuard(db,principal),db.prepare("INSERT INTO project_sheet_runs(id,connection_id,token_id,connection_version,request_id,status,started_at) VALUES(?,?,?,?,?,'running',?) ON CONFLICT(token_id,request_id) DO NOTHING").bind(id,principal.connectionId,principal.tokenId,principal.connectionVersion,args.requestId,iso())]);
  return one(db,'SELECT id,status FROM project_sheet_runs WHERE token_id=? AND request_id=?',[principal.tokenId,args.requestId]);
 }
 if(tool==='proex_sync_run_finish'){
  if(!validId(args.id)||!['completed','conflict','failed'].includes(String(args.status))||typeof args.exportedCount!=='number'||!Number.isSafeInteger(args.exportedCount)||args.exportedCount<0||args.exportedCount>PROJECT_SHEET_TABLES.length*MAX_PORTABLE_TABLE_ROWS)throw new HttpError(400,'Resultado de execução inválido.','invalid_input');
  const status=args.status==='completed'&&(args.readbackVerified!==true||args.tablesVerified!==PROJECT_SHEET_TABLES.length)?'failed':args.status;
  await db.batch([projectSheetGuard(db,principal),...runGuard(db,principal,args.id),db.prepare('UPDATE project_sheet_runs SET status=?,finished_at=?,exported_count=? WHERE id=? AND token_id=?').bind(status,iso(),args.exportedCount,args.id,principal.tokenId)]);
  return {id:args.id,status};
 }
 if(tool==='proex_project_sheet_tabs'){
  if(!isObject(args.tabs))throw new HttpError(400,'Informe as abas.','invalid_input');
  const entries=Object.entries(args.tabs),seen=new Set<number>();
  for(const [key,gid] of entries){if(!PROJECT_SHEET_TABLES.some(table=>key===table)||typeof gid!=='number'||!Number.isSafeInteger(gid)||gid<0||gid>2147483647||seen.has(gid))throw new HttpError(400,'Abas inválidas.','invalid_input');seen.add(gid);}
  await db.batch([projectSheetGuard(db,principal),db.prepare('UPDATE project_sheet_connections SET tabs_json=?,tabs_version=tabs_version+1 WHERE id=?').bind(JSON.stringify(args.tabs),principal.connectionId)]);
  return {ok:true};
 }
 throw new HttpError(400,'Ferramenta indisponível no conector de projeto.','unknown_tool');
}
