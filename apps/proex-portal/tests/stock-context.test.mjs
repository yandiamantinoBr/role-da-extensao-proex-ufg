import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url)),modules=new Map();
function compile(path){path=resolve(root,path);if(modules.has(path))return modules.get(path);let code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;code=code.replace(/from (['"])(\.[^'"]+)\1/g,(_m,_q,dep)=>`from ${JSON.stringify(compile(resolve(dirname(path),dep+'.ts')))}`);const url=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;modules.set(path,url);return url;}
const {materialsAction,materialDetail}=await import(compile('lib/materials.ts'));
const {stockConsumption,stockContextCatalog}=await import(compile('lib/stock-context.ts'));
function fixture(){
 const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync(root+'drizzle').filter(f=>f.endsWith('.sql')).sort())native.exec(readFileSync(root+'drizzle/'+file,'utf8'));
 const at='2026-10-01T12:00:00.000Z';native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('org-other','Other','other',?,?)").run(at,at);
 native.prepare("INSERT INTO organizational_units(id,name,acronym,kind,created_at,updated_at) VALUES('unit-source','Synthetic Print Unit','SPU','agency',?,?),('unit-recipient','Synthetic Faculty','SF','academic',?,?),('unit-archived','Archived Unit','AU','agency',?,?)").run(at,at,at,at,at,at);
 native.prepare("UPDATE organizational_units SET status='archived' WHERE id='unit-archived'").run();
 native.prepare("INSERT INTO projects(id,name,organization_id,unit_id,created_at) VALUES('project-a','Stock project','org_proex',NULL,?),('project-b','Recipient project','org_proex','unit-recipient',?),('project-c','Other recipient','org_proex','unit-recipient',?),('project-other','Private other organization','org-other',NULL,?)").run(at,at,at,at);
 const members=['project-a','project-b','project-c'].map((project,index)=>({id:'member-'+index,user_id:'synthetic-user',email:'synthetic@example.invalid',role:'manager',project_id:project,revoked_at:null,created_at:at,organization_id:'org_proex'}));
 for(const member of members)native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at,organization_id) VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(member));
 native.prepare("INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES('synthetic-user','synthetic@example.invalid','active',0,?,?)").run(at,at);
 const actor={userId:'synthetic-user',email:'synthetic@example.invalid',displayName:'Synthetic',members,capabilities:[]};
 const db={native,prepare(sql){let values=[];return{sql,bind(...args){values=args;return this;},async first(column){const row=native.prepare(sql).get(...values);return column?row?.[column]??null:row??null;},async all(){return{results:native.prepare(sql).all(...values),success:true};},execute(){const results=native.prepare(sql).all(...values);return{results,success:true,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){native.exec('BEGIN');try{const result=statements.map(s=>s.execute());native.exec('COMMIT');return result;}catch(error){native.exec('ROLLBACK');throw error;}}};
 return{db,actor};
}
async function item(db,actor,name='Folders',unit='unidade'){return(await materialsAction(db,actor,'item.create',{projectId:'project-a',name,category:'consumption',unit,lowStock:2,operationKey:crypto.randomUUID()})).item;}
async function move(db,actor,material,more={}){return materialsAction(db,actor,'stock.move',{itemId:material.id,kind:'receive',delta:100,reason:'Synthetic receipt',operationKey:crypto.randomUUID(),...more});}
test('context is atomic with the immutable ledger, exposes source and SEI, and replay includes the full meaning',async()=>{
 const{db,actor}=fixture();try{const material=await item(db,actor),input={counterpartyType:'unit',counterpartyId:'unit-source',processReference:'23070.000001/2026-00',beneficiaryReference:'Synthetic team',operationKey:'receipt-context-0001'};
  const first=await move(db,actor,material,input),retry=await move(db,actor,material,input);assert.equal(retry.duplicate,true);assert.equal(retry.item.stock,100);assert.equal(db.native.prepare('SELECT COUNT(*) n FROM stock_movement_contexts').get().n,1);
  await assert.rejects(move(db,actor,material,{...input,processReference:'Another process'}),e=>e.code==='operation_conflict');
  const detail=await materialDetail(db,actor,material.id);assert.equal(detail.movements[0].context.counterpartyName,'Synthetic Print Unit');assert.equal(detail.movements[0].context.processReference,input.processReference);assert.equal(detail.movements[0].context.dateSource,'registration');assert.match(detail.movements[0].context.href,/unitId=unit-source/);
  assert.throws(()=>db.native.prepare('UPDATE stock_movement_contexts SET process_reference=? WHERE movement_id=?').run('changed',first.movement.id),/stock_context_immutable/);
  assert.throws(()=>db.native.prepare('DELETE FROM stock_movement_contexts WHERE movement_id=?').run(first.movement.id),/stock_context_immutable/);
  assert.throws(()=>db.native.prepare('UPDATE stock_movements SET delta=1 WHERE id=?').run(first.movement.id),/movement_immutable/);
 }finally{db.native.close();}
});
test('invalid, archived, cross-organization and unauthorized counterparties roll back without changing stock',async()=>{
 const{db,actor}=fixture();try{const material=await item(db,actor);for(const more of[
  {counterpartyType:'unit'}, {counterpartyType:'unit',counterpartyId:'unit-archived'},
  {counterpartyType:'project',counterpartyId:'project-other'}, {counterpartyType:'project',counterpartyId:'project-a'},
  {counterpartyType:'external',counterpartyId:'unit-source'}, {processReference:'x'.repeat(121)},
  {occurredAt:'2026-02-30T12:00:00Z'},{occurredAt:'2026-11-01T12:00:00'}, {occurredAt:'2200-01-01T12:00:00Z'},
 ])await assert.rejects(move(db,actor,material,more));
 db.native.prepare("UPDATE members SET revoked_at='2026-11-06' WHERE project_id='project-b'").run();await assert.rejects(move(db,actor,material,{counterpartyType:'project',counterpartyId:'project-b'}),e=>e.status===403);
 assert.equal(db.native.prepare('SELECT stock FROM items WHERE id=?').get(material.id).stock,0);assert.equal(db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);
 }finally{db.native.close();}
});
test('legacy rows remain unclassified and cannot acquire new context through an idempotent replay',async()=>{
 const{db,actor}=fixture();try{const material=await item(db,actor);db.native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at) VALUES('legacy',?,5,'receive','Synthetic receipt','manual:synthetic-user:legacy-move-0001','synthetic-user','2026-10-05T12:00:00Z')").run(material.id);
 assert.equal((await move(db,actor,material,{delta:5,operationKey:'legacy-move-0001'})).duplicate,true);await assert.rejects(move(db,actor,material,{delta:5,operationKey:'legacy-move-0001',processReference:'late-context'}),e=>e.code==='operation_conflict');
 assert.equal((await materialDetail(db,actor,material.id)).movements[0].context,null);assert.equal(db.native.prepare('SELECT COUNT(*) n FROM stock_movement_contexts').get().n,0);
 }finally{db.native.close();}
});
test('beneficiary project is contextual only, loses labels and IDs with access, and hidden groups merge',async()=>{
 const{db,actor}=fixture();try{const material=await item(db,actor);await move(db,actor,material);await move(db,actor,material,{kind:'distribute',delta:-5,counterpartyType:'project',counterpartyId:'project-b'});await move(db,actor,material,{kind:'distribute',delta:-7,counterpartyType:'project',counterpartyId:'project-c'});
 assert.equal(db.native.prepare("SELECT COUNT(*) n FROM items WHERE project_id IN('project-b','project-c')").get().n,0);
 db.native.prepare("UPDATE members SET revoked_at='2026-11-06' WHERE project_id IN('project-b','project-c')").run();
 const detail=await materialDetail(db,actor,material.id);for(const row of detail.movements.filter(r=>r.delta<0)){assert.equal(row.context.counterpartyId,null);assert.equal(row.context.counterpartyName,null);assert.equal(row.context.href,null);assert.equal(row.context.canOpen,false);}
 const stats=await stockConsumption(db,actor,{projectId:'project-a'}),groups=stats.groups.filter(g=>g.kind==='distribute');assert.equal(groups.length,1);assert.equal(groups[0].quantity,12);assert.equal(groups[0].counterpartyProjectId,null);assert.equal(groups[0].counterpartyName,null);assert.equal(stats.items[0].available,88);
 assert.equal((await stockConsumption(db,actor,{projectId:'project-a',unitId:'unit-recipient'})).movements.length,0);
 const serialized=JSON.stringify(stats);assert.ok(!serialized.includes('Recipient project'));assert.ok(!serialized.includes('project-b'));assert.ok(!serialized.includes('project-c'));
 }finally{db.native.close();}
});
test('consumption forecast requires a measured sample and separates units, consumption and adjustments',async()=>{
 const{db,actor}=fixture();try{const material=await item(db,actor),other=await item(db,actor,'Boxes','caixa'),today=new Date(Date.now()-3*3600000).toISOString().slice(0,10),date=days=>new Date(Date.parse(today)-days*86400000).toISOString().slice(0,10),from=date(10),to=date(1);
 await move(db,actor,material,{occurredAt:from+'T12:00:00-03:00'});await move(db,actor,other);
 for(const days of[9,6,3])await move(db,actor,material,{kind:'consume',delta:-10,occurredAt:date(days)+'T12:00:00-03:00',counterpartyType:'unit',counterpartyId:'unit-recipient'});
 await move(db,actor,material,{kind:'adjust',delta:-50,reason:'Synthetic correction',occurredAt:date(2)+'T12:00:00-03:00'});
 const stats=await stockConsumption(db,actor,{projectId:'project-a',from,to}),summary=stats.items.find(i=>i.itemId===material.id);assert.equal(summary.forecast.available,true);assert.equal(summary.forecast.outflowQuantity,30);assert.equal(summary.forecast.sampleDays,10);assert.equal(summary.forecast.dailyAverage,3);assert.equal(summary.available,20);assert.equal(summary.forecast.daysRemaining,20/3);
 assert.equal(stats.items.find(i=>i.itemId===other.id).forecast.available,false);assert.ok(stats.groups.every(g=>g.measurementUnit==='unidade'));assert.equal((await stockConsumption(db,actor,{unitId:'unit-recipient',projectId:'project-a',from,to})).movements.length,3);
 }finally{db.native.close();}
});
test('archiving or revocation during the context batch rolls the whole physical movement back',async()=>{
 const{db,actor}=fixture();try{const material=await item(db,actor),batch=db.batch.bind(db);let altered=false;db.batch=async statements=>{if(!altered&&statements.some(s=>s.sql.startsWith('INSERT INTO stock_movements'))){altered=true;db.native.prepare("UPDATE projects SET status='archived' WHERE id='project-b'").run();}return batch(statements);};
 await assert.rejects(move(db,actor,material,{counterpartyType:'project',counterpartyId:'project-b'}));assert.equal(db.native.prepare('SELECT stock FROM items WHERE id=?').get(material.id).stock,0);assert.equal(db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);
 }finally{db.native.close();}
});
test('context catalog and summary enforce live project access and never export email identifiers',async()=>{
 const{db,actor}=fixture();try{const list=await stockContextCatalog(db,actor,'project-a');assert.ok(list.units.some(u=>u.id==='unit-source'));assert.ok(!list.units.some(u=>u.id==='unit-archived'));assert.ok(list.projects.every(p=>p.id!=='project-other'&&p.id!=='project-a'));assert.ok(!JSON.stringify(list).includes('@'));
 db.native.prepare("UPDATE members SET revoked_at='2026-11-06' WHERE project_id='project-a'").run();await assert.rejects(stockContextCatalog(db,actor,'project-a'),e=>e.status===403);await assert.rejects(stockConsumption(db,actor,{projectId:'project-a'}),e=>e.status===403);await assert.rejects(stockConsumption(db,null,{}),e=>e.status===401);
 }finally{db.native.close();}
});
test('a concurrent unit edit rolls back the ledger rather than recording a stale measurement snapshot',async()=>{
 const{db,actor}=fixture();try{const material=await item(db,actor),batch=db.batch.bind(db);let changed=false;db.batch=async statements=>{if(!changed&&statements.some(s=>s.sql.startsWith('INSERT INTO stock_movements'))){changed=true;db.native.prepare("UPDATE items SET unit='caixa' WHERE id=?").run(material.id);}return batch(statements);};await assert.rejects(move(db,actor,material));assert.equal(db.native.prepare('SELECT stock FROM items WHERE id=?').get(material.id).stock,0);assert.equal(db.native.prepare('SELECT COUNT(*) n FROM stock_movement_contexts').get().n,0);}finally{db.native.close();}
});
test('a recent material and a changed unit do not borrow unobserved days from the selected period',async()=>{
 const{db,actor}=fixture();try{const material=await item(db,actor),today=new Date(Date.now()-3*3600000).toISOString().slice(0,10),date=days=>new Date(Date.parse(today)-days*86400000).toISOString().slice(0,10);await move(db,actor,material,{occurredAt:date(3)+'T12:00:00-03:00'});for(const days of[3,2,1])await move(db,actor,material,{kind:'consume',delta:-1,occurredAt:date(days)+'T13:00:00-03:00'});let stats=await stockConsumption(db,actor,{projectId:'project-a'});assert.equal(stats.items[0].forecast.sampleDays,3);assert.equal(stats.items[0].forecast.available,false);
 db.native.prepare("UPDATE items SET unit='caixa' WHERE id=?").run(material.id);for(const days of[10,7,4])await move(db,actor,material,{kind:'consume',delta:-1,occurredAt:date(days)+'T14:00:00-03:00'});stats=await stockConsumption(db,actor,{projectId:'project-a'});assert.equal(stats.items[0].forecast.available,false);assert.match(stats.items[0].forecast.reason,/unidade de medida mudou/);assert.equal(stats.items[0].forecast.outflowQuantity,3);
 }finally{db.native.close();}
});
test('low stock attention uses only current authorized duties, without creating mail or task notifications',async()=>{
 const{db,actor}=fixture();try{const material=await item(db,actor),at=new Date().toISOString();await move(db,actor,material,{delta:1});db.native.prepare("INSERT INTO work_responsibility_scopes(id,organization_id,project_id,area,item_id,target_key,created_by,created_at,updated_at) VALUES('scope','org_proex','project-a','materials',?,?,'synthetic-user',?,?)").run(material.id,material.id,at,at);db.native.prepare("INSERT INTO work_responsibility_assignees(id,scope_id,user_id,created_at) VALUES('assignee','scope','synthetic-user',?)").run(at);
 let summary=await stockConsumption(db,actor,{projectId:'project-a'});assert.equal(summary.items[0].attention.active,true);assert.equal(summary.items[0].attention.assignedToMe,true);assert.equal(summary.items[0].attention.assignees.length,1);assert.equal(db.native.prepare('SELECT COUNT(*) n FROM followup_notifications').get().n,0);assert.equal(db.native.prepare('SELECT COUNT(*) n FROM followup_email_queue').get().n,0);
 db.native.prepare("UPDATE work_responsibility_assignees SET revoked_at=? WHERE id='assignee'").run(at);summary=await stockConsumption(db,actor,{projectId:'project-a'});assert.equal(summary.items[0].attention.assignedToMe,false);assert.deepEqual(summary.items[0].attention.assignees,[]);
 }finally{db.native.close();}
});
test('the final atomic read suppresses the response after owner or beneficiary revocation',async()=>{
 for(const project of['project-a','project-b']){const{db,actor}=fixture();try{const material=await item(db,actor);await move(db,actor,material,{counterpartyType:'project',counterpartyId:'project-b'});const batch=db.batch.bind(db);let changed=false;db.batch=async statements=>{if(!changed&&statements[0].sql.startsWith('SELECT p.id,p.name,p.unit_id')){changed=true;db.native.prepare("UPDATE members SET revoked_at='2026-11-06' WHERE project_id=?").run(project);}return batch(statements);};await assert.rejects(stockConsumption(db,actor,{projectId:'project-a'}),e=>[403,409].includes(e.status));}finally{db.native.close();}}
});
test('depletion uses the civil date in Brasília when the UTC day has already advanced',async()=>{
 const RealDate=Date,fixed='2026-11-07T01:00:00.000Z';globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return RealDate.parse(fixed);}};
 const{db,actor}=fixture();try{const material=await item(db,actor);await move(db,actor,material,{delta:33,occurredAt:'2026-10-27T12:00:00-03:00'});for(const date of['2026-10-28','2026-11-01','2026-11-04'])await move(db,actor,material,{kind:'consume',delta:-10,occurredAt:date+'T13:00:00-03:00'});const summary=await stockConsumption(db,actor,{projectId:'project-a',from:'2026-10-27',to:'2026-11-05'});assert.equal(summary.items[0].forecast.daysRemaining,1);assert.equal(summary.items[0].forecast.estimatedDepletion,'2026-11-07');}finally{db.native.close();globalThis.Date=RealDate;}
});
test('catalog returns counterparties from the same atomic live-authority read as its source guard',async()=>{
 const{db,actor}=fixture();try{const batch=db.batch.bind(db);let changed=false;db.batch=async statements=>{if(!changed&&statements.some(s=>s.sql.startsWith('SELECT p.id,p.name,p.unit_id unitId'))){changed=true;db.native.prepare("UPDATE members SET revoked_at='2026-11-06' WHERE project_id='project-b'").run();}return batch(statements);};const catalog=await stockContextCatalog(db,actor,'project-a');assert.ok(changed);assert.ok(catalog.projects.every(p=>p.id!=='project-b'));assert.ok(!JSON.stringify(catalog).includes('Recipient project'));}finally{db.native.close();}
});
