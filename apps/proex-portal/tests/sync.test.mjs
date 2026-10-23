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
 const url=`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${name}-sync-under-test.mjs`).toString('base64')}`;
 modules.set(name,url);return url;
}
const {exportPortablePage,describePortableSchemas,portablePageCsv}=await import(compile('sync/portable'));
const {applyPortableChanges}=await import(compile('sync/apply'));
const {materialsAction: syncMaterialsAction}=await import(compile('materials'));
const {seedCatalog,catalogPreview}=await import(compile('sync/catalog'));
const {configureSync,startSyncRun,finishSyncRun,syncStatus,requestSync}=await import(compile('sync/control'));
function fixture(){
 const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');
 for(const name of readdirSync(`${directory}drizzle`).filter(name=>name.endsWith('.sql')).sort())native.exec(readFileSync(`${directory}drizzle/${name}`,'utf8'));
 const now=new Date().toISOString();
 native.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run('project-a','Projeto A',now);
 const actor={userId:'owner-a',email:'owner@example.invalid',displayName:'Owner',members:[{id:'member-owner',user_id:'owner-a',email:'owner@example.invalid',role:'owner',project_id:null,revoked_at:null,created_at:now}],capabilities:['organization.manage','projects.manage','campaigns.manage','inventory.manage','loans.manage']};
 native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run('member-owner',actor.userId,actor.email,'owner',null,now);
 native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(actor.userId,actor.email,'active',now,now);
 let beforeBatch;
 const db={native,prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(column){const row=native.prepare(sql).get(...args);return column?row?.[column]??null:row??null;},async all(){return {success:true,results:native.prepare(sql).all(...args)};},async run(){const result=native.prepare(sql).run(...args);return {success:true,results:[],meta:{changes:Number(result.changes)}};},execute(){const results=native.prepare(sql).all(...args);return {success:true,results,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(beforeBatch){const hook=beforeBatch;beforeBatch=undefined;hook();}native.exec('BEGIN');try{const rows=statements.map(statement=>statement.execute());native.exec('COMMIT');return rows;}catch(error){native.exec('ROLLBACK');throw error;}},beforeBatch(hook){beforeBatch=hook;}};
 return {db,actor,now,close:()=>native.close()};
}
function item(f,id='item-a'){f.db.native.prepare('INSERT INTO items(id,project_id,name,category,unit,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,'project-a','Button','gift','unidade',f.now,f.now);}

test('portable schemas explicitly lock ledgers and identity grants while metadata permits only selected columns',()=>{
 const schemas=describePortableSchemas();assert.equal(schemas.limits.page,100);
 assert.equal(schemas.tables.find(row=>row.table==='stock_movements').mode,'append_only');
 assert.equal(schemas.tables.find(row=>row.table==='members').mode,'read_only');
 const items=schemas.tables.find(row=>row.table==='items');assert.equal(items.columns.find(row=>row.name==='stock').editable,false);assert.equal(items.columns.find(row=>row.name==='name').editable,true);
 assert.deepEqual(items.columns.slice(0,2).map(column=>[column.name,column.system,column.editable]),[['_rowKey',true,false],['_rowHash',true,false]]);
 assert.ok(!schemas.tables.some(row=>/auth|login_identifiers|invites|calendar_feeds|portal_users/.test(row.table)));
});

test('owner export uses stable digest pagination, rejects changed snapshots, and excludes operational contacts and secrets',async()=>{
 const f=fixture();try{
  item(f,'item-a');item(f,'item-b');
  const first=await exportPortablePage(f.db,f.actor,{table:'items',limit:1});assert.equal(first.rows.length,1);assert.equal(first.nextCursor,'item-a');assert.match(first.rows[0]._rowHash,/^[a-f0-9]{64}$/);
  const second=await exportPortablePage(f.db,f.actor,{table:'items',limit:1,after:first.nextCursor,expectedDigest:first.digest});assert.equal(second.rows[0].id,'item-b');assert.equal(second.nextCursor,null);
  f.db.native.prepare("UPDATE items SET name='Changed' WHERE id='item-b'").run();
  await assert.rejects(exportPortablePage(f.db,f.actor,{table:'items',after:first.nextCursor,expectedDigest:first.digest}),error=>error.code==='sync_snapshot_changed');
  await assert.rejects(exportPortablePage(f.db,f.actor,{table:'items',after:'item-a'}),error=>error.code==='sync_digest_required');
  const team=await exportPortablePage(f.db,f.actor,{table:'members'});assert.equal(JSON.stringify(team.rows).includes(f.actor.email),false);
  f.db.native.prepare('INSERT INTO profiles(user_id,display_name,phone,avatar_key,mime,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(f.actor.userId,'Team name','secret phone','private/avatar-key','image/png',f.now,f.now);
  const profiles=await exportPortablePage(f.db,f.actor,{table:'profiles'});assert.equal(profiles.rows[0].display_name,'Team name');assert.equal(JSON.stringify(profiles.rows).includes('secret phone'),false);assert.equal(JSON.stringify(profiles.rows).includes('private/avatar-key'),false);
  await assert.rejects(exportPortablePage(f.db,f.actor,{table:'auth_user'}),error=>error.code==='sync_invalid_table');
 }finally{f.close();}
});

test('spreadsheet capability arrays and stale or blocked owners never authorize reads or writes',async()=>{
 const f=fixture();try{
  item(f);const forged={...f.actor,userId:'untrusted'};
  await assert.rejects(exportPortablePage(f.db,forged,{table:'items'}),error=>error.status===403);
  f.db.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(f.actor.userId);
  await assert.rejects(applyPortableChanges(f.db,f.actor,{changes:[{changeKey:'blocked-operation',table:'items',id:'item-a',expectedVersion:1,fields:{name:'Denied'}}]}),error=>error.status===403);
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_receipts').get().n,0);
 }finally{f.close();}
});

test('metadata sync is versioned, receipt-backed and replay-safe without duplicating audit',async()=>{
 const f=fixture();try{
  item(f);const change={changeKey:'rename-button-0001',table:'items',id:'item-a',expectedVersion:1,fields:{name:'Button roxo'}};
  const first=await applyPortableChanges(f.db,f.actor,{changes:[change]});assert.equal(first.results[0].status,'applied');
  const replay=await applyPortableChanges(f.db,f.actor,{changes:[change]});assert.equal(replay.results[0].status,'duplicate');
  assert.equal(f.db.native.prepare("SELECT version FROM items WHERE id='item-a'").get().version,2);
  assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='item.update'").get().n,1);
  await assert.rejects(applyPortableChanges(f.db,f.actor,{changes:[{...change,fields:{name:'Changed replay'}}]}),error=>error.code==='sync_operation_changed');
  const stale=await applyPortableChanges(f.db,f.actor,{changes:[{...change,changeKey:'stale-change-0002'}]});assert.equal(stale.results[0].status,'conflict');
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_conflicts').get().n,1);
  const again=await applyPortableChanges(f.db,f.actor,{changes:[{...change,changeKey:'stale-change-0002'}]});assert.equal(again.results[0].conflictId,stale.results[0].conflictId);
 }finally{f.close();}
});

test('ledger append goes through stock triggers and stable operation keys, while direct stock or grant edits are rejected',async()=>{
 const f=fixture();try{
  item(f);const change={changeKey:'receive-buttons-0001',action:'stock.move',input:{itemId:'item-a',kind:'receive',delta:8,note:'Entrada contada'}};
  const first=await applyPortableChanges(f.db,f.actor,{changes:[change]});assert.equal(first.results[0].status,'applied');
  const replay=await applyPortableChanges(f.db,f.actor,{changes:[change]});assert.equal(replay.results[0].status,'duplicate');
  assert.equal(f.db.native.prepare("SELECT stock FROM items WHERE id='item-a'").get().stock,8);assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,1);
  const rejected=await applyPortableChanges(f.db,f.actor,{changes:[{changeKey:'forge-stock-0002',table:'items',id:'item-a',expectedVersion:1,fields:{stock:999}},{changeKey:'forge-role-0003',table:'members',id:'member-owner',expectedVersion:1,fields:{role:'owner'}}]});
  assert.ok(rejected.results.every(row=>row.status==='rejected'));assert.equal(f.db.native.prepare("SELECT stock FROM items WHERE id='item-a'").get().stock,8);
 }finally{f.close();}
});

test('live owner assertion rolls back mutation and receipt if membership is revoked just before the service batch',async()=>{
 const f=fixture();try{
  item(f);f.db.beforeBatch(()=>f.db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(f.now,'member-owner'));
  await assert.rejects(applyPortableChanges(f.db,f.actor,{changes:[{changeKey:'revocation-race-0001',table:'items',id:'item-a',expectedVersion:1,fields:{name:'Must not commit'}}]}),error=>error.status===403);
  assert.equal(f.db.native.prepare("SELECT name FROM items WHERE id='item-a'").get().name,'Button');assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_receipts').get().n,0);assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM audit').get().n,0);
 }finally{f.close();}
});

test('CAS race does not leave a successful receipt when another revision wins immediately before batch',async()=>{
 const f=fixture();try{
  item(f);f.db.beforeBatch(()=>f.db.native.prepare("UPDATE items SET name='Concurrent',version=2 WHERE id='item-a'").run());
  const result=await applyPortableChanges(f.db,f.actor,{changes:[{changeKey:'metadata-cas-race-01',table:'items',id:'item-a',expectedVersion:1,fields:{name:'Must not commit'}}]});
  assert.equal(result.results[0].status,'conflict');assert.equal(f.db.native.prepare("SELECT name FROM items WHERE id='item-a'").get().name,'Concurrent');
  const receipt=f.db.native.prepare('SELECT result_json FROM sync_receipts').get();assert.equal(JSON.parse(receipt.result_json).status,'conflict');assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM audit').get().n,0);
 }finally{f.close();}
});

test('every operational projection is valid against real migrations, and page/batch limits are enforced',async()=>{
 const f=fixture();try{
  for(const table of describePortableSchemas().tables)assert.equal((await exportPortablePage(f.db,f.actor,{table:table.table})).table,table.table);
  await assert.rejects(exportPortablePage(f.db,f.actor,{table:'items',limit:101}),error=>error.code==='sync_invalid_limit');
  await assert.rejects(applyPortableChanges(f.db,f.actor,{changes:Array.from({length:26},(_,i)=>({changeKey:`too-many-${i}`}))}),error=>error.code==='sync_change_limit');
 }finally{f.close();}
});

test('simultaneous imports share one receipt and one stock movement',async()=>{
 const f=fixture();try{
  item(f);const change={changeKey:'concurrent-stock-01',action:'stock.move',input:{itemId:'item-a',kind:'receive',delta:4,note:'Contado'}};
  const results=await Promise.all([applyPortableChanges(f.db,f.actor,{changes:[change]}),applyPortableChanges(f.db,f.actor,{changes:[change]})]);
  assert.equal(results.filter(result=>result.results[0].status==='applied').length,1);assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,1);assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_receipts').get().n,1);
 }finally{f.close();}
});

test('project metadata and categories use existing versioned services, and audit failure rolls back receipt and domain mutation',async()=>{
 const f=fixture();try{
  item(f);const project=await applyPortableChanges(f.db,f.actor,{changes:[{changeKey:'change-project-001',table:'projects',id:'project-a',expectedVersion:1,fields:{name:'Programa de extensão',lifecycle:'past'}}]});
  assert.equal(project.results[0].status,'applied');assert.equal(f.db.native.prepare("SELECT lifecycle FROM projects WHERE id='project-a'").get().lifecycle,'past');
  const created=await applyPortableChanges(f.db,f.actor,{changes:[{changeKey:'new-category-0001',action:'material.category.create',input:{projectId:'project-a',label:'Lembranças',coreKind:'gift'}}]});assert.equal(created.results[0].status,'applied');
  const category=f.db.native.prepare('SELECT id FROM material_categories').get();
  const revised=await applyPortableChanges(f.db,f.actor,{changes:[{changeKey:'change-category-01',table:'material_categories',id:category.id,expectedVersion:1,fields:{description:'Materiais de divulgação'}}]});assert.equal(revised.results[0].status,'applied');
  f.db.native.exec("CREATE TRIGGER sync_test_audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'audit_unavailable'); END");
  await assert.rejects(applyPortableChanges(f.db,f.actor,{changes:[{changeKey:'rollback-stock-001',action:'stock.move',input:{itemId:'item-a',kind:'receive',delta:3,note:'Entrada'}}]}));
  assert.equal(f.db.native.prepare("SELECT stock FROM items WHERE id='item-a'").get().stock,0);assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_receipts').get().n,3);
 }finally{f.close();}
});

test('Excel CSV escapes formula-like text while preserving quoted accents and newlines',()=>{
 const result=portablePageCsv([{_rowKey:'row-1',_rowHash:'hash',name:'=HYPERLINK("https://example.invalid")',note:'Órgão\n"PROEX"'}]);
 assert.ok(result.startsWith('\uFEFF'));assert.ok(result.includes("\"'=HYPERLINK"));assert.ok(result.includes('Órgão\n""PROEX""'));
});

test('official catalog seed executes real metadata services, starts every item at zero and invents no operations',async()=>{
 const f=fixture();try{
  const preview=catalogPreview();assert.equal(preview.verifiedAt,'2026-10-23');assert.equal(preview.projects.length,10);
  const first=await seedCatalog(f.db,f.actor);assert.equal(first.summary.filter(row=>row.kind==='project').length,10);
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM project_types').get().n,4);
  const items=f.db.native.prepare('SELECT stock,reserved FROM items').all();assert.equal(items.length,11);assert.ok(items.every(item=>item.stock===0&&item.reserved===0));
  for(const table of ['stock_movements','loans','participations','attempts','entitlements','reservations','campaigns','project_schedule_items','records'])assert.equal(f.db.native.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table);
  const historical=f.db.native.prepare("SELECT lifecycle,description FROM projects WHERE name='Mulheres nas Poéticas'").get();assert.equal(historical.lifecycle,'catalog');assert.match(historical.description,/situação atual a confirmar/);
  const current=f.db.native.prepare("SELECT p.lifecycle,t.key FROM projects p JOIN project_types t ON t.id=p.type_id WHERE p.name='UFG nos Parques'").get();assert.equal(current.lifecycle,'active');assert.equal(current.key,'program');
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM calls').get().n,4);assert.ok(f.db.native.prepare('SELECT status FROM calls').all().every(call=>call.status==='draft'));
  const counts=Object.fromEntries(['projects','items','calls','project_links','entity_versions','sync_receipts','audit'].map(table=>[table,f.db.native.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n]));
  await seedCatalog(f.db,f.actor);for(const [table,count]of Object.entries(counts))assert.equal(f.db.native.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,count,`Repeated seed must preserve ${table}`);
 }finally{f.close();}
});

test('catalog seed matches Unicode names and preserves manually edited projects, stock and references',async()=>{
 const f=fixture();try{
  f.db.native.prepare("UPDATE projects SET name=?,description='Manually maintained',status='archived',lifecycle='past',version=5 WHERE id='project-a'").run('ROLÊ DA EXTENSÃO');
  f.db.native.prepare('INSERT INTO items(id,project_id,name,category,unit,stock,reserved,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('existing-button','project-a','BUTTON LARANJA — 2,5 CM','gift','unidade',9,0,f.now,f.now);
  await seedCatalog(f.db,f.actor);
  const role=f.db.native.prepare("SELECT * FROM projects WHERE id='project-a'").get();assert.equal(role.description,'Manually maintained');assert.equal(role.status,'archived');assert.equal(role.lifecycle,'past');assert.equal(role.version,5);
  assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM projects WHERE official_url LIKE '%60194%'").get().n,0,'Existing project is preserved rather than overwritten with seed URL.');
  assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM items WHERE project_id='project-a'").get().n,11);assert.equal(f.db.native.prepare("SELECT stock FROM items WHERE id='existing-button'").get().stock,9);
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);
 }finally{f.close();}
});

test('concurrent catalog seed requests share receipts without duplicating references or zero-stock items',async()=>{
 const f=fixture();try{
  await Promise.all([seedCatalog(f.db,f.actor),seedCatalog(f.db,f.actor)]);
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM projects').get().n,11); // Includes the fixture's pre-existing project.
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM project_types').get().n,4);
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM project_links').get().n,10);
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM calls').get().n,4);
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM items').get().n,11);
  assert.equal(f.db.native.prepare('SELECT COALESCE(SUM(stock),0) n FROM items').get().n,0);
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);
 }finally{f.close();}
});

const syncConfiguration={spreadsheetId:'spreadsheet-test-0001',folderId:'folder-test-0001',attachmentsFolderId:'attachments-test-0001'};
const completion=id=>({id,status:'completed',exportedCount:12,readbackVerified:true,tablesVerified:describePortableSchemas().tables.length});

test('sync configuration requires live owner and stays disabled until all 27 tables have verified readback',async()=>{
 const f=fixture();try{
  await assert.rejects(configureSync(f.db,{...f.actor,userId:'forged'},syncConfiguration),error=>error.status===403);
  await configureSync(f.db,f.actor,syncConfiguration);
  assert.equal((await syncStatus(f.db,f.actor)).connections[0].enabled,0);
  const run=await startSyncRun(f.db,f.actor,{});
  for(const invalid of [{...completion(run.id),readbackVerified:false},{...completion(run.id),tablesVerified:26},{...completion(run.id),exportedCount:'12'}])await assert.rejects(finishSyncRun(f.db,f.actor,invalid),error=>error.status===400);
  assert.equal(f.db.native.prepare('SELECT status FROM sync_runs WHERE id=?').get(run.id).status,'running');
  await finishSyncRun(f.db,f.actor,completion(run.id));
  assert.equal((await syncStatus(f.db,f.actor)).connections[0].enabled,1);
  assert.equal((await finishSyncRun(f.db,f.actor,completion(run.id))).duplicate,true);
  assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='sync.finish'").get().n,1);
  await configureSync(f.db,f.actor,syncConfiguration);assert.equal((await syncStatus(f.db,f.actor)).connections[0].enabled,1);
  await configureSync(f.db,f.actor,{...syncConfiguration,attachmentsFolderId:'attachments-changed-0002'});assert.equal((await syncStatus(f.db,f.actor)).connections[0].enabled,0);
 }finally{f.close();}
});

test('simultaneous starts atomically admit one worker and never interrupt its fresh run',async()=>{
 const f=fixture();try{
  await configureSync(f.db,f.actor,syncConfiguration);
  const attempts=await Promise.allSettled([startSyncRun(f.db,f.actor,{}),startSyncRun(f.db,f.actor,{})]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.code==='sync_running').length,1);
  assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM sync_runs WHERE status='running'").get().n,1);assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM sync_runs WHERE status='failed'").get().n,0);
  await assert.rejects(configureSync(f.db,f.actor,{...syncConfiguration,spreadsheetId:'another-sheet-0002'}),error=>error.code==='sync_running');
  assert.equal(f.db.native.prepare('SELECT external_id FROM sync_connections').get().external_id,syncConfiguration.spreadsheetId);
 }finally{f.close();}
});

test('expired workers are marked interrupted and cannot finish or commit new domain writes',async()=>{
 const f=fixture();try{
  item(f);await configureSync(f.db,f.actor,syncConfiguration);const old=await startSyncRun(f.db,f.actor,{});
  f.db.native.prepare('UPDATE sync_runs SET started_at=? WHERE id=?').run(new Date(Date.now()-31*60*1000).toISOString(),old.id);
  const current=await startSyncRun(f.db,f.actor,{});assert.notEqual(current.id,old.id);
  assert.equal(f.db.native.prepare('SELECT error_code FROM sync_runs WHERE id=?').get(old.id).error_code,'interrupted');
  await assert.rejects(finishSyncRun(f.db,f.actor,completion(old.id)),error=>error.code==='sync_run_not_running');
  // The worker may have passed preflight before another owner finished the run.
  f.db.beforeBatch(()=>f.db.native.prepare("UPDATE sync_runs SET status='failed' WHERE id=?").run(current.id));
  await assert.rejects(applyPortableChanges(f.db,f.actor,{connectionId:'google-sheets',runId:current.id,changes:[{changeKey:'old-worker-stock-01',action:'stock.move',input:{itemId:'item-a',kind:'receive',delta:3,note:'Do not apply'}}]}),error=>error.code==='sync_run_not_running');
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_receipts').get().n,0);
 }finally{f.close();}
});

test('finish is atomic, refuses open conflicts, and cannot enable a different configuration',async()=>{
 const f=fixture();try{
  await configureSync(f.db,f.actor,syncConfiguration);const run=await startSyncRun(f.db,f.actor,{});
  f.db.native.prepare("INSERT INTO sync_conflicts(id,run_id,operation_key,entity_type,reason,status,created_at) VALUES('conflict-test',?,'operation-test','items','changed','open',?)").run(run.id,f.now);
  await assert.rejects(finishSyncRun(f.db,f.actor,completion(run.id)),error=>error.code==='sync_open_conflicts');
  assert.equal(f.db.native.prepare('SELECT enabled FROM sync_connections').get().enabled,0);
  f.db.native.prepare("UPDATE sync_conflicts SET status='resolved' WHERE id='conflict-test'").run();
  const results=await Promise.all([finishSyncRun(f.db,f.actor,completion(run.id)),finishSyncRun(f.db,f.actor,completion(run.id))]);
  assert.equal(results.filter(result=>result.duplicate===true).length,1);assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='sync.finish'").get().n,1);
  await assert.rejects(finishSyncRun(f.db,f.actor,{id:run.id,status:'failed'}),error=>error.code==='sync_run_not_running');
 }finally{f.close();}
});

test('tombstones and owner revocation during control batch prevent configuration/request writes',async()=>{
 const f=fixture();try{
  f.db.native.prepare('UPDATE portal_users SET anonymized_at=? WHERE user_id=?').run(f.now,f.actor.userId);
  await assert.rejects(configureSync(f.db,f.actor,syncConfiguration),error=>error.status===403);
  f.db.native.prepare('UPDATE portal_users SET anonymized_at=NULL WHERE user_id=?').run(f.actor.userId);
  f.db.beforeBatch(()=>f.db.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(f.actor.userId));
  await assert.rejects(requestSync(f.db,f.actor),error=>error.status===403);
  assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM settings WHERE name='sync.requested_at'").get().n,0);
 }finally{f.close();}
});

test('a run finished just before conflict/rejection persistence cannot receive a late conflict or receipt',async()=>{
 const f=fixture();try{
  item(f);await configureSync(f.db,f.actor,syncConfiguration);const run=await startSyncRun(f.db,f.actor,{});
  // Stale input is rejected before a domain transaction. Model the independent
  // finisher committing immediately before the error-recording transaction.
  f.db.native.prepare("UPDATE items SET version=2 WHERE id='item-a'").run();
  f.db.beforeBatch(()=>{f.db.native.prepare("UPDATE sync_runs SET status='completed',finished_at=? WHERE id=?").run(f.now,run.id);f.db.native.prepare("UPDATE sync_connections SET enabled=1 WHERE id='google-sheets'").run();});
  await assert.rejects(applyPortableChanges(f.db,f.actor,{connectionId:'google-sheets',runId:run.id,changes:[{changeKey:'late-conflict-0001',table:'items',id:'item-a',expectedVersion:1,fields:{name:'Stale'}}]}),error=>error.code==='sync_run_not_running');
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_conflicts').get().n,0);assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_receipts').get().n,0);assert.equal(f.db.native.prepare('SELECT conflict_count FROM sync_runs WHERE id=?').get(run.id).conflict_count,0);
 }finally{f.close();}
});

test('domain replay without a service batch cannot append a receipt after its run finishes',async()=>{
 const f=fixture();try{
  item(f);await configureSync(f.db,f.actor,syncConfiguration);const run=await startSyncRun(f.db,f.actor,{});
  const change={changeKey:'late-domain-replay-01',action:'stock.move',input:{itemId:'item-a',kind:'receive',delta:2,note:'Already durable'}};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${f.actor.userId}\nsync\n${change.changeKey}`));
  const operationKey=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  await syncMaterialsAction(f.db,f.actor,'stock.move',{...change.input,operationKey});
  f.db.beforeBatch(()=>f.db.native.prepare("UPDATE sync_runs SET status='completed',finished_at=? WHERE id=?").run(f.now,run.id));
  await assert.rejects(applyPortableChanges(f.db,f.actor,{connectionId:'google-sheets',runId:run.id,changes:[change]}),error=>error.code==='sync_run_not_running');
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_receipts').get().n,0);assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,1);
 }finally{f.close();}
});
