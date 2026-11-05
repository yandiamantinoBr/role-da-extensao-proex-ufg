import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const directory=fileURLToPath(new URL('../',import.meta.url)),modules=new Map();
function compile(name){
 if(modules.has(name))return modules.get(name);
 if(name.endsWith('.json')){const parsed=JSON.parse(readFileSync(`${directory}lib/${name}`,'utf8')),url=`data:text/javascript;base64,${Buffer.from(`export default ${JSON.stringify(parsed)};`).toString('base64')}`;modules.set(name,url);return url;}
 let code=ts.transpileModule(readFileSync(`${directory}lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 code=code.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_match,_quote,dependency)=>`from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name),dependency)).replace(/\.ts$/,'')))}`);
 const url=`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${name}-project-sheets-test.mjs`).toString('base64')}`;modules.set(name,url);return url;
}
const {configureProjectSheet,createProjectSheetToken,revokeProjectSheetToken,projectSheetPrincipal,projectSheetStatus}=await import(compile('sync/project-sheets'));
const {applyProjectSheetChanges,exportProjectSheetPage,callProjectSheetTool}=await import(compile('sync/project-sheets-data'));
const {materialsAction}=await import(compile('materials'));
const {exportPortablePage,describePortableSchemas}=await import(compile('sync/portable'));
const {rateLimit}=await import(compile('rate-limit'));
const {configureSync}=await import(compile('sync/control'));
function fixture(){
 const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');
 for(const name of readdirSync(`${directory}drizzle`).filter(name=>name.endsWith('.sql')).sort())native.exec(readFileSync(`${directory}drizzle/${name}`,'utf8'));
 const now=new Date().toISOString();
 for(const letter of ['a','b']){
  native.prepare('INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run('org-'+letter,'Org '+letter,'test-'+letter,now,now);
  native.prepare('INSERT INTO projects(id,name,organization_id,created_at) VALUES(?,?,?,?)').run('project-'+letter,'Projeto '+letter,'org-'+letter,now);
  native.prepare('INSERT INTO items(id,project_id,name,category,unit,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('item-'+letter,'project-'+letter,'Brinde '+letter,'gift','unidade',now,now);
  native.prepare('INSERT INTO followup_tasks(id,organization_id,project_id,title,body,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('task-'+letter,'org-'+letter,'project-'+letter,'Demanda '+letter,'Corpo privado '+letter,'manager-'+letter,now,now);
 }
 const member={id:'member-manager',user_id:'manager-a',email:'manager@example.invalid',role:'manager',project_id:'project-a',organization_id:'org-a',revoked_at:null,created_at:now};
 native.prepare('INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES(?,?,?,?,?,?,?)').run(member.id,member.user_id,member.email,member.role,member.project_id,member.organization_id,now);
 native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(member.user_id,member.email,'active',now,now);
 const actor={userId:member.user_id,email:member.email,displayName:'Manager',members:[member],capabilities:['access.manage','inventory.manage','inventory.read']};
 let beforeBatch;
 const db={native,prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(column){const row=native.prepare(sql).get(...args);return column?row?.[column]??null:row??null;},async all(){return {success:true,results:native.prepare(sql).all(...args)};},async run(){const result=native.prepare(sql).run(...args);return {success:true,results:[],meta:{changes:Number(result.changes)}};},execute(){const results=native.prepare(sql).all(...args);return {success:true,results,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(beforeBatch){const hook=beforeBatch;beforeBatch=undefined;hook();}native.exec('BEGIN');try{const rows=statements.map(statement=>statement.execute());native.exec('COMMIT');return rows;}catch(error){native.exec('ROLLBACK');throw error;}},beforeBatch(hook){beforeBatch=hook;}};
 return {db,actor,now,close:()=>native.close()};
}
async function connected(f,scope='materials'){
 await configureProjectSheet(f.db,f.actor,'project-a',{spreadsheetId:'synthetic-project-workbook',label:'Planilha projeto A',expectedVersion:0,includeTasks:true});
 const token=await createProjectSheetToken(f.db,f.actor,'project-a',{scope,expectedVersion:1,label:'Pilot'});
 const principal=await projectSheetPrincipal(f.db,'Bearer '+token.token,'synthetic-project-workbook');
 return {principal,token};
}
const rename=(key='rename-item-a-01',version=1)=>({changeKey:key,table:'items',id:'item-a',expectedVersion:version,fields:{name:'Material revisado'}});

test('separate organizations: project credential never exports other projects, private task bodies, identities, master or keys',async()=>{
 const f=fixture();try{
  const {principal}=await connected(f);
  const status=await callProjectSheetTool(f.db,principal,'proex_sync_describe',{});
  assert.equal(status.schemas.tables.length,9);assert.equal(status.configuration.projectId,'project-a');
  for(const schema of status.schemas.tables){const page=await exportProjectSheetPage(f.db,principal,{table:schema.table});const serialized=JSON.stringify(page.rows);assert.ok(!serialized.includes('project-b'));assert.ok(!serialized.includes('Brinde b'));assert.ok(!serialized.includes('Corpo privado'));assert.ok(!serialized.includes('manager@example'));assert.ok(!schema.columns.some(column=>column.private));}
  assert.equal((await exportProjectSheetPage(f.db,principal,{table:'followup_tasks'})).rows[0].title,'Demanda a');
  for(const table of ['members','profiles','settings','audit','project_sheet_tokens','__proto__'])await assert.rejects(exportProjectSheetPage(f.db,principal,{table}),error=>error.code==='sync_invalid_table');
  await assert.rejects(projectSheetStatus(f.db,f.actor,'project-b'),error=>error.status===403);
  await assert.rejects(configureProjectSheet(f.db,f.actor,'project-b',{spreadsheetId:'synthetic-other-workbook',expectedVersion:0}),error=>error.status===403);
  await assert.rejects(callProjectSheetTool(f.db,principal,'proex_sync_configure',{}),error=>error.code==='unknown_tool');
  await assert.rejects(callProjectSheetTool(f.db,principal,'proex_sync_attachment_list',{}),error=>error.code==='unknown_tool');
  await assert.rejects(projectSheetPrincipal(f.db,'Bearer pxs_'+ 'a'.repeat(43),'synthetic-project-workbook'),error=>error.status===401);
 }finally{f.close();}
});
test('material create/edit/stock roundtrip uses existing services, CAS, receipts and a master-visible domain',async()=>{
 const f=fixture();try{
  const {principal}=await connected(f),change={changeKey:'create-calendars-01',action:'item.create',input:{projectId:'project-a',name:'Calendários CONPEEX',category:'gift',unit:'unidade',lowStock:5}};
  const created=await applyProjectSheetChanges(f.db,principal,{changes:[change]});assert.equal(created.results[0].status,'applied');const id=created.results[0].entityId;assert.ok(id);
  const replay=await applyProjectSheetChanges(f.db,principal,{changes:[change]});assert.equal(replay.results[0].status,'duplicate');assert.equal(replay.results[0].entityId,id);
  assert.equal(f.db.native.prepare('SELECT stock FROM items WHERE id=?').get(id).stock,0);
  const receive={changeKey:'receive-calendars-01',action:'stock.move',input:{itemId:id,kind:'receive',delta:42,note:'Contagem física'}};
  await applyProjectSheetChanges(f.db,principal,{changes:[receive]});await applyProjectSheetChanges(f.db,principal,{changes:[receive]});
  assert.equal(f.db.native.prepare('SELECT stock FROM items WHERE id=?').get(id).stock,42);
  await materialsAction(f.db,principal.actor,'item.update',{id,expectedVersion:1,name:'Calendários conferidos'});
  const portalPage=await exportProjectSheetPage(f.db,principal,{table:'items'}),row=portalPage.rows.find(row=>row.id===id);assert.equal(row.name,'Calendários conferidos');assert.equal(row.stock,42);
  await applyProjectSheetChanges(f.db,principal,{changes:[{changeKey:'sheet-description-01',table:'items',id,expectedVersion:row.version,fields:{description:'Separados para cinco dias'}}]});
  assert.equal(f.db.native.prepare('SELECT description FROM items WHERE id=?').get(id).description,'Separados para cinco dias');
  await assert.rejects(applyProjectSheetChanges(f.db,principal,{changes:[{...receive,input:{...receive.input,delta:50}}]}),error=>error.code==='sync_operation_changed');
  const system=await applyProjectSheetChanges(f.db,principal,{changes:[{...rename('system-stock-0001'),fields:{stock:999}}]});assert.equal(system.results[0].status,'rejected');
  const masterActor={...f.actor,members:[{...f.actor.members[0],id:'global-owner',role:'owner',project_id:null,organization_id:null}]};f.db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,NULL,?)').run('global-owner',f.actor.userId,f.actor.email,'owner',f.now);
  const master=await exportPortablePage(f.db,masterActor,{table:'items'});assert.equal(master.rows.find(row=>row.id===id).description,'Separados para cinco dias');
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM stock_movements WHERE item_id=?').get(id).n,1);
 }finally{f.close();}
});
test('cross-project action and reference IDs are rejected before invoking a globally capable issuer',async()=>{
 const f=fixture();try{
  const {principal}=await connected(f);
  // Even adding a real global owner role must not broaden a project token.
  f.db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,NULL,?)').run('global-owner',f.actor.userId,f.actor.email,'owner',f.now);
  const broad=await projectSheetPrincipal(f.db,'Bearer '+(await createProjectSheetToken(f.db,f.actor,'project-a',{scope:'materials',expectedVersion:1})).token,'synthetic-project-workbook');
  const changes=[{...rename('other-project-edit'),id:'item-b'},{changeKey:'other-project-create',action:'item.create',input:{projectId:'project-b',name:'Denied',category:'gift',unit:'unidade'}},{changeKey:'other-project-stock',action:'stock.move',input:{itemId:'item-b',kind:'receive',delta:1}},{changeKey:'forged-role-change',action:'member.create',input:{role:'owner'}}];
  const result=await applyProjectSheetChanges(f.db,broad,{changes});assert.ok(result.results.every(row=>row.status==='rejected'));
  assert.equal(f.db.native.prepare("SELECT name FROM items WHERE id='item-b'").get().name,'Brinde b');assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);
  assert.equal((await exportProjectSheetPage(f.db,principal,{table:'projects'})).rows.length,1);
 }finally{f.close();}
});
test('read-only keys cannot mutate, keys expire in30days and bind to the exact workbook/configuration',async()=>{
 const f=fixture();try{
  const {principal,token}=await connected(f,'read');assert.ok(Date.parse(token.expiresAt)-Date.now()<31*86400000);
  const describe=await callProjectSheetTool(f.db,principal,'proex_sync_describe',{});assert.ok(describe.schemas.tables.every(schema=>schema.mode==='read_only'&&!schema.columns.some(column=>column.editable)));
  await assert.rejects(applyProjectSheetChanges(f.db,principal,{changes:[rename()]}),error=>error.status===403);
  await assert.rejects(projectSheetPrincipal(f.db,'Bearer '+token.token,'wrong-workbook'),error=>error.code==='project_sheet_workbook_mismatch');
  await configureProjectSheet(f.db,f.actor,'project-a',{spreadsheetId:'replacement-project-workbook',expectedVersion:1});
  await assert.rejects(exportProjectSheetPage(f.db,principal,{table:'items'}),error=>error.status===403);
  assert.ok(f.db.native.prepare('SELECT revoked_at FROM project_sheet_tokens WHERE id=?').get(token.id).revoked_at);
 }finally{f.close();}
});
test('owner loss, token revocation, expiry and blocked account invalidate both previously-resolved principal and replays',async()=>{
 for(const revoke of [f=>f.db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(f.now,'member-manager'),f=>f.db.native.prepare('UPDATE project_sheet_tokens SET revoked_at=?').run(f.now),f=>f.db.native.prepare("UPDATE project_sheet_tokens SET expires_at='2000-01-01T00:00:00.000Z'").run(),f=>f.db.native.prepare("UPDATE portal_users SET status='blocked'").run()]){
  const f=fixture();try{const {principal}=await connected(f);await applyProjectSheetChanges(f.db,principal,{changes:[rename()]});revoke(f);await assert.rejects(exportProjectSheetPage(f.db,principal,{table:'items'}),error=>error.status===403);await assert.rejects(applyProjectSheetChanges(f.db,principal,{changes:[rename()]}),error=>error.status===403);}finally{f.close();}
 }
});
test('issuer or credential revocation immediately before the service transaction rolls back domain mutation and receipt',async()=>{
 for(const revoke of [f=>f.db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(f.now,'member-manager'),f=>f.db.native.prepare('UPDATE project_sheet_tokens SET revoked_at=?').run(f.now),f=>f.db.native.prepare('UPDATE project_sheet_connections SET version=version+1').run()]){
  const f=fixture();try{const {principal}=await connected(f);f.db.beforeBatch(()=>revoke(f));await assert.rejects(applyProjectSheetChanges(f.db,principal,{changes:[rename()]}),error=>error.status===403);assert.equal(f.db.native.prepare("SELECT name FROM items WHERE id='item-a'").get().name,'Brinde a');assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM project_sheet_receipts').get().n,0);assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='item.update'").get().n,0);}finally{f.close();}
 }
});
test('CAS races, changed page snapshots and scoped tab links are detected without false success',async()=>{
 const f=fixture();try{
  const {principal}=await connected(f);f.db.beforeBatch(()=>f.db.native.prepare("UPDATE items SET name='Concorrente',version=2 WHERE id='item-a'").run());
  const result=await applyProjectSheetChanges(f.db,principal,{changes:[rename()]});assert.equal(result.results[0].status,'conflict');
  assert.equal(f.db.native.prepare("SELECT name FROM items WHERE id='item-a'").get().name,'Concorrente');assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM project_sheet_conflicts').get().n,1);
  const page=await exportProjectSheetPage(f.db,principal,{table:'items'});f.db.native.prepare("UPDATE items SET name='Outro' WHERE id='item-a'").run();
  await assert.rejects(exportProjectSheetPage(f.db,principal,{table:'items',expectedDigest:page.digest}),error=>error.code==='sync_snapshot_changed');
  await callProjectSheetTool(f.db,principal,'proex_project_sheet_tabs',{tabs:{items:17,followup_tasks:24}});
  const status=await projectSheetStatus(f.db,f.actor,'project-a');assert.equal(status.connection.tabs.items.url,'https://docs.google.com/spreadsheets/d/synthetic-project-workbook/edit?gid=17#gid=17');
  await assert.rejects(callProjectSheetTool(f.db,principal,'proex_project_sheet_tabs',{tabs:{members:5}}),error=>error.status===400);
  await revokeProjectSheetToken(f.db,f.actor,'project-a',{id:principal.tokenId});await assert.rejects(callProjectSheetTool(f.db,principal,'proex_sync_describe',{}),error=>error.status===403);
 }finally{f.close();}
});
test('master workbook is rejected at configure time and also invalidates an existing project binding',async()=>{
 const f=fixture();try{
  f.db.native.prepare('INSERT INTO settings(name,value,updated_at)VALUES(?,?,?)').run('sync.google_sheets.configuration',JSON.stringify({spreadsheetId:'synthetic-master-workbook'}),f.now);
  await assert.rejects(configureProjectSheet(f.db,f.actor,'project-a',{spreadsheetId:'synthetic-master-workbook',expectedVersion:0}),error=>error.code==='project_sheet_master_forbidden');
  const {principal}=await connected(f);assert.throws(()=>f.db.native.prepare('UPDATE settings SET value=?').run(JSON.stringify({spreadsheetId:'synthetic-project-workbook'})),/sync_project_workbook/);
  // Simulate a restored pre-0028 collision to retain the independent runtime fence.
  f.db.native.exec('DROP TRIGGER master_sheet_project_file_update');
  f.db.native.prepare('UPDATE settings SET value=?').run(JSON.stringify({spreadsheetId:'synthetic-project-workbook'}));
  await assert.rejects(exportProjectSheetPage(f.db,principal,{table:'items'}),error=>error.status===403);
  await assert.rejects(projectSheetStatus(f.db,f.actor,'project-a'),error=>error.code==='project_sheet_master_forbidden');
 }finally{f.close();}
});
test('organization owner losing the organization and an archived organization immediately invalidate issued credentials',async()=>{
 for(const move of [f=>{f.db.native.prepare("UPDATE members SET revoked_at=? WHERE id='org-owner'").run(f.now);f.db.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES('org-owner-b',?,?,'owner',NULL,'org-b',?)").run(f.actor.userId,f.actor.email,f.now);},f=>f.db.native.prepare("UPDATE organizations SET status='archived' WHERE id='org-a'").run()]){
  const f=fixture();try{
   f.db.native.prepare("UPDATE members SET revoked_at=? WHERE id='member-manager'").run(f.now);
   f.db.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES('org-owner',?,?,'owner',NULL,'org-a',?)").run(f.actor.userId,f.actor.email,f.now);
   f.actor.members=[{...f.actor.members[0],id:'org-owner',role:'owner',project_id:null}];
   const {principal}=await connected(f);move(f);
   await assert.rejects(exportProjectSheetPage(f.db,principal,{table:'items'}),error=>error.status===403);
   await assert.rejects(applyProjectSheetChanges(f.db,principal,{changes:[rename()]}),error=>error.status===403);
  }finally{f.close();}
 }
});
test('read revalidation after collecting a page suppresses its response when issuer access was revoked mid-request',async()=>{
 const f=fixture();try{
  const {principal}=await connected(f),prepare=f.db.prepare.bind(f.db);let revoked=false;
  f.db.prepare=sql=>{const statement=prepare(sql);if(sql.includes('FROM items WHERE project_id=')){const all=statement.all.bind(statement);statement.all=async()=>{const result=await all();f.db.native.prepare("UPDATE members SET revoked_at=? WHERE id='member-manager'").run(f.now);revoked=true;return result;};}return statement;};
  await assert.rejects(exportProjectSheetPage(f.db,principal,{table:'items'}),error=>error.status===403);assert.equal(revoked,true);
 }finally{f.close();}
});
test('create and movement receipts contain the domain entity ID in the same atomic batch, before response assembly',async()=>{
 const f=fixture();try{
  const {principal}=await connected(f),batch=f.db.batch.bind(f.db);let checks=0;
  f.db.batch=async statements=>{const result=await batch(statements);for(const row of f.db.native.prepare('SELECT entity_id,result_json FROM project_sheet_receipts').all()){assert.ok(row.entity_id);assert.equal(JSON.parse(row.result_json).entityId,row.entity_id);checks++;}return result;};
  const created=await applyProjectSheetChanges(f.db,principal,{changes:[{changeKey:'atomic-material-create',action:'item.create',input:{projectId:'project-a',name:'Novo',category:'gift',unit:'unidade'}}]});
  const id=created.results[0].entityId;
  const moved=await applyProjectSheetChanges(f.db,principal,{changes:[{changeKey:'atomic-movement-create',action:'stock.move',input:{itemId:id,kind:'receive',delta:3}}]});
  assert.notEqual(moved.results[0].entityId,id);assert.ok(checks>=2);
 }finally{f.close();}
});
test('run lifecycle is credential-bound and ended runs cannot authorize mutations; tabs cannot reference arbitrary resources',async()=>{
 const f=fixture();try{
  const {principal}=await connected(f),run=await callProjectSheetTool(f.db,principal,'proex_sync_run_start',{requestId:'run-request-0001'});
  assert.equal((await callProjectSheetTool(f.db,principal,'proex_sync_run_start',{requestId:'run-request-0001'})).id,run.id);
  const otherToken=await createProjectSheetToken(f.db,f.actor,'project-a',{scope:'materials',expectedVersion:1}),other=await projectSheetPrincipal(f.db,'Bearer '+otherToken.token,'synthetic-project-workbook');
  await assert.rejects(applyProjectSheetChanges(f.db,other,{runId:run.id,changes:[rename()]}),error=>error.code==='sync_run_not_running');
  await applyProjectSheetChanges(f.db,principal,{runId:run.id,changes:[rename()]});
  const finished=await callProjectSheetTool(f.db,principal,'proex_sync_run_finish',{id:run.id,status:'completed',exportedCount:3,readbackVerified:true,tablesVerified:9});assert.equal(finished.status,'completed');
  await assert.rejects(applyProjectSheetChanges(f.db,principal,{runId:run.id,changes:[rename()]}),error=>error.code==='sync_run_not_running');
  for(const tabs of [{items:17,followup_tasks:17},{items:-1},{items:Infinity},{'__proto__':18,settings:19}])await assert.rejects(callProjectSheetTool(f.db,principal,'proex_project_sheet_tabs',{tabs}),error=>error.status===400);
 }finally{f.close();}
});
test('task summaries require explicit configuration opt-in; default projection and direct reads exclude them',async()=>{
 const f=fixture();try{
  const configured=await configureProjectSheet(f.db,f.actor,'project-a',{spreadsheetId:'synthetic-project-workbook',expectedVersion:0});assert.equal(configured.connection.includeTasks,false);
  const token=await createProjectSheetToken(f.db,f.actor,'project-a',{scope:'read',expectedVersion:1}),principal=await projectSheetPrincipal(f.db,'Bearer '+token.token,'synthetic-project-workbook');
  const status=await callProjectSheetTool(f.db,principal,'proex_sync_describe',{});assert.equal(status.schemas.tables.length,8);assert.ok(!status.schemas.tables.some(schema=>schema.table==='followup_tasks'));
  await assert.rejects(exportProjectSheetPage(f.db,principal,{table:'followup_tasks'}),error=>error.code==='sync_invalid_table');
  await assert.rejects(callProjectSheetTool(f.db,principal,'proex_project_sheet_tabs',{tabs:{followup_tasks:17}}),error=>error.status===400);
 }finally{f.close();}
});
test('global master configuration cannot promote a project workbook, including a binding created immediately before commit',async()=>{
 const f=fixture();try{
  await connected(f);f.db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,NULL,?)').run('global-owner',f.actor.userId,f.actor.email,'owner',f.now);
  const config={spreadsheetId:'synthetic-project-workbook',folderId:'synthetic-folder-id',attachmentsFolderId:'synthetic-attachments-folder'};
  await assert.rejects(configureSync(f.db,f.actor,config),error=>error.code==='sync_project_workbook');
  assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM settings WHERE name='sync.google_sheets.configuration'").get().n,0);
  f.db.beforeBatch(()=>f.db.native.prepare('UPDATE project_sheet_connections SET spreadsheet_id=?').run('synthetic-replacement-workbook'));
  await assert.rejects(configureSync(f.db,f.actor,{...config,spreadsheetId:'synthetic-replacement-workbook'}),error=>error.code==='sync_project_workbook');
 }finally{f.close();}
});
test('synthetic benchmark compares complete project/master pagination including the persistent limiter cost',async t=>{
 const f=fixture();try{
  await configureProjectSheet(f.db,f.actor,'project-a',{spreadsheetId:'synthetic-project-workbook',expectedVersion:0});
  const token=await createProjectSheetToken(f.db,f.actor,'project-a',{scope:'read',expectedVersion:1}),principal=await projectSheetPrincipal(f.db,'Bearer '+token.token,'synthetic-project-workbook');
  f.db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,NULL,?)').run('global-owner',f.actor.userId,f.actor.email,'owner',f.now);
  const insert=f.db.native.prepare('INSERT INTO items(id,project_id,name,category,unit,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
  f.db.native.exec('BEGIN');for(const letter of ['a','b'])for(let i=0;i<500;i++)insert.run(`bench-${letter}-${String(i).padStart(4,'0')}`,'project-'+letter,'Material sintético '+i,'gift','unidade',f.now,f.now);f.db.native.exec('COMMIT');
  const projectTables=(await callProjectSheetTool(f.db,principal,'proex_sync_describe',{})).schemas.tables;
  async function measure(tables,read,bucket){let calls=0,rows=0;const start=performance.now();for(const schema of tables){let after,digest;do{await rateLimit(f.db,bucket,2000,600000);calls++;const page=await read({table:schema.table,...(after?{after,expectedDigest:digest}:{})});after=page.nextCursor;digest=page.digest;rows+=page.rows.length;}while(after);}return{calls,rows,milliseconds:Math.round(performance.now()-start)};}
  const project=await measure(projectTables,args=>exportProjectSheetPage(f.db,principal,args),'benchmark-project'),master=await measure(describePortableSchemas().tables,args=>exportPortablePage(f.db,f.actor,args),'benchmark-master');
  assert.equal(project.calls,13);assert.equal(master.calls,45);assert.ok(project.rows<master.rows);
  assert.equal(f.db.native.prepare('SELECT SUM(count) n FROM portal_rate_limits').get().n,58);
  t.diagnostic(JSON.stringify({fixture:'2 organizations,1002 items,total data reads including persistent rate-limit transaction',project,master,persistenceReductionPercent:Math.round((1-project.calls/master.calls)*100)}));
 }finally{f.close();}
});
