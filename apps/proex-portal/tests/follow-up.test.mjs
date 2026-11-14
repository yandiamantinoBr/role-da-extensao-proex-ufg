import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {resolve,dirname} from 'node:path';import ts from 'typescript';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createArchive,validateArchive} from '../platform-node/backup-format.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
function compile(file){file=resolve(root,file);if(cache.has(file))return cache.get(file);let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;code=code.replace(/from (['"])(\.[^'"]+)\1/g,(_m,_q,name)=>`from ${JSON.stringify(compile(resolve(dirname(file),name+'.ts')))}`);const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,url);return url;}
const {getActor}=await import(compile('lib/access.ts'));
const {followupAction,followupList,followupDetail,followupCatalog,notificationInbox}=await import(compile('lib/follow-up/service.ts'));
const {manualShareUrl}=await import(compile('lib/follow-up/contracts.ts'));
const {exportPortablePage,describePortableSchemas}=await import(compile('lib/sync/portable.ts'));
function fixture(t){const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(root+'drizzle').filter(n=>n.endsWith('.sql')).sort())native.exec(readFileSync(root+'drizzle/'+name,'utf8'));t.after(()=>native.close());const now=new Date().toISOString();
 const insert=(table,row)=>{const cols=Object.keys(row);native.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));};
 for(const suffix of ['a','b']){insert('organizations',{id:`org-${suffix}`,name:`Organization ${suffix}`,slug:`org-${suffix}`,created_at:now,updated_at:now});insert('projects',{id:`project-${suffix}`,organization_id:`org-${suffix}`,name:`Project ${suffix}`,created_at:now});insert('items',{id:`item-${suffix}`,project_id:`project-${suffix}`,name:suffix==='a'?'Coletes P/M/G':'Private organization B item',category:'distribution',unit:'un',stock:40,created_at:now});insert('campaigns',{id:`campaign-${suffix}`,project_id:`project-${suffix}`,name:`Event ${suffix}`,starts_at:now,ends_at:new Date(Date.now()+86400000).toISOString(),status:'active',created_at:now});}
 const users={};function user(name,role,project,org){insert('portal_users',{user_id:name,email:name+'@example.invalid',status:'active',created_at:now,updated_at:now});insert('profiles',{user_id:name,display_name:name,created_at:now,updated_at:now});insert('members',{id:'member-'+name,user_id:name,email:name+'@example.invalid',role,project_id:project,organization_id:org,created_at:now});return users[name]={userId:name,email:name+'@example.invalid',displayName:name};}
 user('platform','owner',null,null);user('admin-a','owner',null,'org-a');user('admin-b','owner',null,'org-b');user('manager-a','manager','project-a','org-a');user('viewer-a','viewer','project-a','org-a');user('worker-a','inventory','project-a','org-a');user('worker-b','inventory','project-b','org-b');
 const db={native,reads:0,before:null,fail:null,prepare(sql){let values=[];return{sql,bind(...args){values=args;return this;},async first(){db.reads++;return native.prepare(sql).get(...values)??null;},async all(){db.reads++;return{results:native.prepare(sql).all(...values)};},async run(){return this.execute();},execute(){if(db.fail?.test(sql)){db.fail=null;throw new Error('synthetic storage failure');}const results=native.prepare(sql).all(...values);return{results,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(this.before){const hook=this.before;this.before=null;hook();}native.exec('BEGIN');try{const results=statements.map(s=>s.execute());native.exec('COMMIT');return results;}catch(error){native.exec('ROLLBACK');throw error;}}};
 return{db,native,users,insert,now,actor:name=>getActor(db,users[name])};
}
const create=(extra={})=>({organizationId:'org-a',projectId:'project-a',title:'Recontagem de bottons',body:'Conferir a quantidade física antes de movimentar estoque.',priority:'high',dueAt:'2026-11-05',userIds:['worker-a'],operationKey:crypto.randomUUID(),...extra});
const act=(f,actor,action,input)=>followupAction(f.db,actor,action,{action,...input});

test('reference options match live module access and hidden links persist on an unrelated edit',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),inventory=await f.actor('worker-a'),viewer=await f.actor('viewer-a');
 f.insert('items',{id:'asset-a',project_id:'project-a',name:'Projetor de teste',category:'equipment',unit:'un',stock:1,created_at:f.now});
 f.insert('loans',{id:'private-loan',project_id:'project-a',item_id:'asset-a',action_name:'Reserva de teste',borrower_name:'Pessoa fictícia',starts_at:Date.now()+3600000,ends_at:Date.now()+7200000,created_by:'manager-a',created_at:f.now});
 const [managerCatalog,inventoryCatalog,viewerCatalog]=await Promise.all([manager,inventory,viewer].map(actor=>followupCatalog(f.db,actor,{projectId:'project-a'})));
 assert.equal(managerCatalog.loans[0].id,'private-loan');
 assert.equal(managerCatalog.canCloseCampaign,true);
 assert.deepEqual(inventoryCatalog.items.map(item=>Object.keys(item).sort()),[['id','name','unit'],['id','name','unit']]);
 assert.deepEqual(inventoryCatalog.loans,[]);
 assert.deepEqual(inventoryCatalog.campaigns,[]);
 assert.deepEqual(viewerCatalog.people,[]);
 assert.deepEqual(viewerCatalog.teams,[]);
 assert.deepEqual(viewerCatalog.items,[]);
 for(const loanId of ['private-loan','invented-loan']) {
  await assert.rejects(act(f,inventory,'task.create',create({loanId})),{status:403,code:'followup_reference'});
 }
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,0);
 const allowed=await act(f,manager,'task.create',create({loanId:'private-loan',campaignId:'campaign-a'}));
 const edit=await act(f,inventory,'task.update',{id:allowed.task.id,title:'Nova descrição da tarefa',expectedVersion:1,operationKey:crypto.randomUUID()});
 assert.equal(edit.task.title,'Nova descrição da tarefa');
 assert.equal(f.native.prepare('SELECT loan_id FROM followup_tasks WHERE id=?').get(edit.task.id).loan_id,'private-loan');
 await assert.rejects(act(f,inventory,'task.update',{id:allowed.task.id,loanId:null,expectedVersion:2,operationKey:crypto.randomUUID()}),{status:403,code:'followup_reference'});
 await assert.rejects(act(f,inventory,'checklist.activity.create',{projectId:'project-a',title:'Vínculo proibido',campaignId:'campaign-a',rows:[{label:'Confirmação?'}],operationKey:crypto.randomUUID()}),{status:403,code:'followup_reference'});
 f.db.before=()=>f.native.prepare("UPDATE members SET role='inventory' WHERE user_id='manager-a'").run();
 await assert.rejects(act(f,manager,'task.create',create({loanId:'private-loan'})),{status:403,code:'followup_reference'});
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,1);
 f.insert('members',{id:'organization-loans',user_id:'worker-a',email:'worker-a@example.invalid',role:'loans',project_id:null,organization_id:'org-a',created_at:f.now});
 const mixed=await f.actor('worker-a');
 assert.equal((await followupCatalog(f.db,mixed,{projectId:'project-a'})).loans[0].id,'private-loan');
 f.db.before=()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE id='organization-loans'").run(f.now);
 const after=await followupCatalog(f.db,mixed,{projectId:'project-a'});
 assert.equal(after.canEdit,true);
 assert.deepEqual(after.loans,[]);
 assert.ok(after.items.length);
});

test('tasks, rosters and org-wide scope follow live memberships; forged arrays and teams never grant access',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a'),worker=await f.actor('worker-a'),viewer=await f.actor('viewer-a'),other=await f.actor('worker-b');
 const created=await act(f,admin,'task.create',create());assert.equal(created.task.priority,'high');assert.equal(created.task.canEdit,true);
 assert.equal((await followupList(f.db,worker)).tasks.length,1);assert.equal((await followupList(f.db,other)).tasks.length,0);await assert.rejects(followupDetail(f.db,other,created.task.id),{status:404});
 await assert.rejects(act(f,viewer,'task.create',create()),{status:403});await assert.rejects(act(f,worker,'task.create',create({projectId:null})),{status:403});
 const org=await act(f,admin,'task.create',create({projectId:null,userIds:['admin-a']}));assert.equal(org.task.project_id,null);assert.equal((await followupList(f.db,worker)).tasks.length,1);
 const catalog=await followupCatalog(f.db,worker,{projectId:'project-a'});assert.ok(!JSON.stringify(catalog).includes('worker-b'));assert.ok(!JSON.stringify(catalog).includes('@example.invalid'));assert.equal(catalog.canManageTeams,false);
 f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='worker-a'").run(f.now);assert.equal((await followupList(f.db,worker)).tasks.length,0);await assert.rejects(followupCatalog(f.db,worker,{projectId:'project-a'}),{status:403});
});

test('task creation, CAS updates and lost replies are idempotent without orphan claims or unauthorized replay',async t=>{
 const f=fixture(t),actor=await f.actor('manager-a'),input=create();const first=await act(f,actor,'task.create',input),repeat=await act(f,actor,'task.create',input);assert.equal(first.task.id,repeat.task.id);assert.equal(repeat.duplicate,true);
 const update={id:first.task.id,expectedVersion:1,status:'in_progress',operationKey:crypto.randomUUID()};const changed=await act(f,actor,'task.update',update);assert.equal(changed.task.version,2);assert.equal(changed.task.status,'in_progress');
 await assert.rejects(act(f,actor,'task.update',{...update,operationKey:crypto.randomUUID()}),{status:409});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_history').get().n,2);
 const count=f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n;f.db.before=()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager-a'").run(f.now);await assert.rejects(act(f,actor,'task.create',create()));assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,count);
 await assert.rejects(act(f,actor,'task.create',input),{status:403});
});

test('references and responsible people cannot cross organization/project boundaries even inside the transaction',async t=>{
 const f=fixture(t),actor=await f.actor('admin-a');for(const extra of [{campaignId:'campaign-b'},{itemId:'item-b'},{userIds:['worker-b']}])await assert.rejects(act(f,actor,'task.create',create(extra)));
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,0);
 f.db.before=()=>f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='worker-a'").run();await assert.rejects(act(f,actor,'task.create',create()),{status:409});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,0);
});

test('explicit task-only delegation lets an assigned viewer work without granting inventory, other tasks or administrative edits',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),viewer=await f.actor('viewer-a');
 const first=await act(f,manager,'task.create',create({userIds:['viewer-a']})),other=await act(f,manager,'task.create',create({userIds:['viewer-a']}));
 const work={id:first.task.id,status:'in_progress',note:'Texto preparado pela comunicação.',expectedVersion:1,operationKey:crypto.randomUUID()};
 await assert.rejects(act(f,viewer,'task.work',work),{status:403});
 await assert.rejects(act(f,manager,'task.worker.grant',{id:first.task.id,userId:'viewer-a',operationKey:crypto.randomUUID()}),{status:400});
 const grant={id:first.task.id,userId:'viewer-a',confirmed:true,operationKey:crypto.randomUUID()};
 const granted=await act(f,manager,'task.worker.grant',grant);assert.equal(granted.workGrants.length,1);assert.equal((await act(f,manager,'task.worker.grant',grant)).duplicate,true);
 const visible=await followupDetail(f.db,viewer,first.task.id);assert.equal(visible.task.canEdit,false);assert.equal(visible.task.canWork,true);assert.equal(visible.task.canDelegateWork,false);assert.deepEqual(visible.workGrants,[]);
 const changed=await act(f,viewer,'task.work',work);assert.equal(changed.task.status,'in_progress');assert.equal(changed.task.version,2);assert.equal((await act(f,viewer,'task.work',work)).duplicate,true);
 assert.equal(changed.history[0].snapshot.progressNote,work.note);
 await assert.rejects(act(f,viewer,'task.work',{...work,id:other.task.id,operationKey:crypto.randomUUID()}),{status:403});
 await assert.rejects(act(f,viewer,'task.update',{id:first.task.id,title:'Tentativa administrativa',expectedVersion:2,operationKey:crypto.randomUUID()}),{status:404});
 await assert.rejects(act(f,viewer,'task.work',{...work,expectedVersion:2,title:'Campo injetado',operationKey:crypto.randomUUID()}),{status:400});
 assert.equal(f.native.prepare("SELECT role FROM members WHERE user_id='viewer-a'").get().role,'viewer');assert.equal(f.native.prepare("SELECT stock FROM items WHERE id='item-a'").get().stock,40);
 await act(f,manager,'task.worker.revoke',{id:first.task.id,grantId:granted.workGrants[0].id,confirmed:true,operationKey:crypto.randomUUID()});
 await assert.rejects(act(f,viewer,'task.work',work),{status:403});
});

test('task-only grants stop on issuer revocation, assignment removal, team removal and a revocation at commit',async t=>{
 for(const kind of ['issuer','assignment','team','batch']){
  const f=fixture(t),admin=await f.actor('admin-a'),manager=await f.actor('manager-a'),viewer=await f.actor('viewer-a');
  const team=await act(f,admin,'team.create',{organizationId:'org-a',name:'Comunicação',userIds:['viewer-a'],operationKey:crypto.randomUUID()});
  const created=await act(f,manager,'task.create',create({userIds:[],teamIds:[team.teamId]}));
  await act(f,manager,'task.worker.grant',{id:created.task.id,userId:'viewer-a',confirmed:true,operationKey:crypto.randomUUID()});
  assert.equal((await followupDetail(f.db,viewer,created.task.id)).task.canWork,true);
  if(kind==='issuer')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager-a'").run(f.now);
  if(kind==='assignment')await act(f,manager,'task.update',{id:created.task.id,expectedVersion:1,userIds:[],teamIds:[],operationKey:crypto.randomUUID()});
  if(kind==='team')await act(f,admin,'team.update',{id:team.teamId,expectedVersion:1,name:'Comunicação',userIds:[],operationKey:crypto.randomUUID()});
  if(kind==='batch')f.db.before=()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='viewer-a'").run(f.now);
  await assert.rejects(act(f,viewer,'task.work',{id:created.task.id,status:'completed',expectedVersion:kind==='assignment'?2:1,operationKey:crypto.randomUUID()}),{status:403});
  assert.notEqual(f.native.prepare('SELECT status FROM followup_tasks WHERE id=?').get(created.task.id).status,'completed');
 }
});

test('delegated checklist counts remain reviewable; only operational staff can create discrepancy tasks',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),viewer=await f.actor('viewer-a');
 const created=await act(f,manager,'checklist.create',{projectId:'project-a',title:'Conferência da equipe',rows:[{itemId:'item-a',size:'M',expected:5}],userIds:['viewer-a'],operationKey:crypto.randomUUID()});
 await act(f,manager,'task.worker.grant',{id:created.task.id,userId:'viewer-a',confirmed:true,operationKey:crypto.randomUUID()});
 const counted=await act(f,viewer,'checklist.count',{id:created.checklist.id,rowId:created.checklist.rows[0].id,expectedVersion:1,counted:4,damaged:1,note:'Um colete avariado.',operationKey:crypto.randomUUID()});
 assert.equal(counted.checklist.rows[0].counted,4);assert.equal(f.native.prepare("SELECT stock FROM items WHERE id='item-a'").get().stock,40);
 await assert.rejects(act(f,viewer,'checklist.complete',{id:created.checklist.id,expectedVersion:2,createFollowups:false,operationKey:crypto.randomUUID()}),{status:409,code:'followup_manager_review'});
 const complete=await act(f,manager,'checklist.complete',{id:created.checklist.id,expectedVersion:2,createFollowups:true,operationKey:crypto.randomUUID()});assert.equal(complete.checklist.followups.length,1);
});

test('losing operational authority at commit cannot fall back to a task-only grant to approve discrepancies or create tasks',async t=>{
 for(const createFollowups of [true,false]){
  const f=fixture(t),manager=await f.actor('manager-a'),worker=await f.actor('worker-a');
  const created=await act(f,manager,'checklist.create',{projectId:'project-a',title:'Revisão operacional',rows:[{itemId:'item-a',size:'G',expected:5}],userIds:['worker-a'],operationKey:crypto.randomUUID()});
  await act(f,manager,'task.worker.grant',{id:created.task.id,userId:'worker-a',confirmed:true,operationKey:crypto.randomUUID()});
  await act(f,worker,'checklist.count',{id:created.checklist.id,rowId:created.checklist.rows[0].id,expectedVersion:1,counted:4,damaged:1,operationKey:crypto.randomUUID()});
  const before=f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n;
  f.db.before=()=>f.native.prepare("UPDATE members SET role='viewer' WHERE user_id='worker-a'").run();
  await assert.rejects(act(f,worker,'checklist.complete',{id:created.checklist.id,expectedVersion:2,createFollowups,operationKey:crypto.randomUUID()}),{status:403});
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_checklist_actions').get().n,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,before);assert.equal(f.native.prepare('SELECT status FROM followup_checklists').get().status,'open');
 }
});

test('archived organizations retain authorized history while blocking writes, delegation and inbox notices; GET never writes',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a'),viewer=await f.actor('viewer-a');const created=await act(f,admin,'task.create',create({userIds:['viewer-a']}));
 const notice=(await notificationInbox(f.db,viewer)).notifications[0];
 const before=f.native.prepare('SELECT total_changes() n').get().n;
 await notificationInbox(f.db,viewer);await followupList(f.db,viewer);await followupDetail(f.db,viewer,created.task.id);await followupCatalog(f.db,viewer,{projectId:'project-a'});
 assert.equal(f.native.prepare('SELECT total_changes() n').get().n,before);
 f.native.prepare("UPDATE organizations SET status='archived' WHERE id='org-a'").run();
 assert.equal((await followupList(f.db,viewer)).tasks.length,1);const detail=await followupDetail(f.db,admin,created.task.id);assert.equal(detail.task.canEdit,false);assert.equal(detail.task.canWork,false);assert.equal(detail.task.canDelegateWork,false);
 assert.equal((await followupCatalog(f.db,viewer,{projectId:'project-a'})).canEdit,false);assert.equal((await notificationInbox(f.db,viewer)).notifications.length,0);
 await act(f,viewer,'notification.read',{id:notice.id,read:true});assert.equal(f.native.prepare('SELECT read_at FROM followup_notifications WHERE id=?').get(notice.id).read_at,null);
 await assert.rejects(act(f,admin,'task.create',create()),{status:403});await assert.rejects(act(f,admin,'task.update',{id:created.task.id,expectedVersion:1,title:'Alterado',operationKey:crypto.randomUUID()}),{status:404});
});

test('organization task assignment candidates are admins; private team management has its own organization roster',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a'),worker=await f.actor('worker-a');
 const catalog=await followupCatalog(f.db,admin,{organizationId:'org-a'});assert.ok(catalog.people.some(p=>p.userId==='admin-a'));assert.ok(!catalog.people.some(p=>p.userId==='worker-a'));assert.ok(catalog.teamPeople.some(p=>p.userId==='worker-a'));assert.ok(!catalog.teamPeople.some(p=>p.userId==='worker-b'));
 const limited=await followupCatalog(f.db,worker,{projectId:'project-a'});assert.deepEqual(limited.teamPeople,[]);
});

test('portable Sheets projections are global-owner read-only and exclude roster, delegation, notifications and private notes',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a'),platform=await f.actor('platform'),viewer=await f.actor('viewer-a');
 const created=await act(f,admin,'checklist.create',{projectId:'project-a',title:'Conferência exportável',rows:[{itemId:'item-a',size:'P',expected:5}],userIds:['viewer-a'],operationKey:crypto.randomUUID()});
 await act(f,admin,'checklist.count',{id:created.checklist.id,rowId:created.checklist.rows[0].id,expectedVersion:1,counted:4,damaged:1,note:'Private synthetic note not for Sheets.',operationKey:crypto.randomUUID()});
 for(const table of ['followup_teams','followup_tasks','followup_checklists','followup_checklist_items','followup_checklist_actions']){
  await assert.rejects(exportPortablePage(f.db,admin,{table}),{status:403});await assert.rejects(exportPortablePage(f.db,viewer,{table}),{status:403});
  const page=await exportPortablePage(f.db,platform,{table});assert.equal(page.readOnly,true);assert.ok(page.schema.columns.every(column=>!column.editable));assert.ok(!JSON.stringify(page.rows).includes('Private synthetic note'));assert.ok(!JSON.stringify(page.rows).includes('viewer-a'));
 }
 const schemas=describePortableSchemas().tables;for(const table of ['followup_team_members','followup_work_grants','followup_assignees','followup_notifications','followup_history'])assert.ok(!schemas.some(s=>s.table===table));
 assert.equal(schemas.find(s=>s.table==='followup_checklist_items').columns.find(c=>c.name==='size').type,'text');
});

test('complete SQLite backup inventories and restores all follow-up tables including internal receipts and grants',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a');
 const created=await act(f,admin,'task.create',create({userIds:['viewer-a']}));await act(f,admin,'task.worker.grant',{id:created.task.id,userId:'viewer-a',confirmed:true,operationKey:crypto.randomUUID()});
 f.native.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)');const migrations=readdirSync(root+'drizzle').filter(n=>n.endsWith('.sql')).sort().map(name=>({name,sql:readFileSync(root+'drizzle/'+name,'utf8')}));for(const row of migrations)f.native.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(row.name);
 const archive=createArchive({backend:'disk',snapshot:{version:1,data:gzipSync(f.native.serialize())},objects:[]},{migrations,ownerId:'platform'});
 const restored=validateArchive(archive.bytes,{migrations});const followupTables=f.native.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'followup_%' ORDER BY name").all().map(row=>row.name);assert.deepEqual(restored.manifest.sqlite.tables.filter(t=>t.name.startsWith('followup_')).map(t=>t.name).sort(),followupTables);
 const copy=new DatabaseSync(':memory:');try{copy.deserialize(gunzipSync(restored.snapshot));assert.equal(copy.prepare('SELECT COUNT(*) n FROM followup_work_grants').get().n,1);assert.equal(copy.prepare('SELECT COUNT(*) n FROM followup_notifications').get().n,2);assert.equal(copy.prepare('SELECT title FROM followup_tasks WHERE id=?').get(created.task.id).title,created.task.title);assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(),[]);}finally{copy.close();}
});

test('a person can join several teams; team removal hides inbox immediately without changing any application grant',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a'),worker=await f.actor('worker-a');const team1=await act(f,admin,'team.create',{organizationId:'org-a',name:'Comunicação',userIds:['worker-a'],operationKey:crypto.randomUUID()});const team2=await act(f,admin,'team.create',{organizationId:'org-a',name:'Eventos',userIds:['worker-a'],operationKey:crypto.randomUUID()});
 const grants=f.native.prepare('SELECT COUNT(*) n FROM members').get().n;const task=await act(f,admin,'task.create',create({userIds:[],teamIds:[team1.teamId]}));assert.equal((await notificationInbox(f.db,worker)).unread,1);assert.equal((await notificationInbox(f.db,worker)).pending.length,1);
 const catalog=await followupCatalog(f.db,admin,{projectId:'project-a'});assert.equal(catalog.teams.filter(t=>t.members.some(m=>m.userId==='worker-a')).length,2);
 await act(f,admin,'team.update',{id:team1.teamId,expectedVersion:1,name:'Comunicação',userIds:[],operationKey:crypto.randomUUID()});const inbox=await notificationInbox(f.db,worker);assert.equal(inbox.notifications.length,0);assert.equal(inbox.pending.length,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM members').get().n,grants);assert.ok(task.task.id&&team2.teamId);
});

test('notification reads are per-user, persistent and hidden after project revocation or account blocking',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a'),worker=await f.actor('worker-a'),other=await f.actor('worker-b');await act(f,admin,'task.create',create());const inbox=await notificationInbox(f.db,worker);assert.equal(inbox.email.enabled,false);assert.equal(inbox.unread,1);const notice=inbox.notifications[0];
 await act(f,other,'notification.read',{id:notice.id,read:true});assert.equal((await notificationInbox(f.db,worker)).unread,1);await act(f,worker,'notification.read',{id:notice.id,read:true});assert.equal((await notificationInbox(f.db,worker)).unread,0);await act(f,worker,'notification.read',{id:notice.id,read:false});assert.equal((await notificationInbox(f.db,worker)).unread,1);
 f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='worker-a'").run();assert.equal((await notificationInbox(f.db,worker)).notifications.length,0);assert.equal((await notificationInbox(f.db,worker)).pending.length,0);
});

test('closing an event and opening its review is atomic, CAS protected and safe to retry',async t=>{
 const f=fixture(t),actor=await f.actor('manager-a'),input={projectId:'project-a',title:'Conferência CONPEEX',campaignId:'campaign-a',closeCampaign:true,expectedCampaignVersion:1,rows:[{itemId:'item-a',size:'P',expected:10},{itemId:'item-a',size:'M',expected:15},{itemId:'item-a',size:'G',expected:15}],userIds:['worker-a'],operationKey:crypto.randomUUID()};
 f.db.fail=/INSERT INTO followup_checklist_items/;await assert.rejects(act(f,actor,'checklist.create',input));assert.equal(f.native.prepare("SELECT status FROM campaigns WHERE id='campaign-a'").get().status,'active');assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,0);
 const created=await act(f,actor,'checklist.create',input);assert.equal(created.checklist.rows.length,3);assert.equal(f.native.prepare("SELECT status FROM campaigns WHERE id='campaign-a'").get().status,'closed');assert.equal((await act(f,actor,'checklist.create',input)).task.id,created.task.id);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,1);assert.equal(f.native.prepare("SELECT stock FROM items WHERE id='item-a'").get().stock,40);
});

test('checklists count sizes and damage, create reviewed follow-ups once, and never modify inventory or reservations',async t=>{
 const f=fixture(t),actor=await f.actor('worker-a'),created=await act(f,actor,'checklist.create',{projectId:'project-a',rows:[{itemId:'item-a',size:'P',expected:10},{itemId:'item-a',size:'M',expected:10}],operationKey:crypto.randomUUID()});let detail=created;
 await assert.rejects(act(f,actor,'checklist.complete',{id:detail.checklist.id,expectedVersion:1,createFollowups:true,operationKey:crypto.randomUUID()}));
 detail=await act(f,actor,'checklist.count',{id:detail.checklist.id,rowId:detail.checklist.rows[0].id,expectedVersion:detail.checklist.version,counted:8,damaged:2,note:'Dois coletes com costura rompida.',operationKey:crypto.randomUUID()});
 detail=await act(f,actor,'checklist.count',{id:detail.checklist.id,rowId:detail.checklist.rows[1].id,expectedVersion:detail.checklist.version,counted:10,damaged:0,operationKey:crypto.randomUUID()});const finish={id:detail.checklist.id,expectedVersion:detail.checklist.version,createFollowups:true,operationKey:crypto.randomUUID()};
 detail=await act(f,actor,'checklist.complete',finish);assert.equal(detail.checklist.status,'completed');assert.equal(detail.task.status,'completed');assert.equal(detail.checklist.followups.length,1);assert.equal((await act(f,actor,'checklist.complete',finish)).checklist.followups.length,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,2);
 assert.deepEqual({...f.native.prepare("SELECT stock,reserved FROM items WHERE id='item-a'").get()},{stock:40,reserved:0});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);
});

test('WhatsApp sharing is a manual URL with a title and protected task link, without phone recipients or hidden task body',()=>{const url=new URL(manualShareUrl('Recontagem', 'task-synthetic','https://portal.example.invalid/?module=demands'));assert.equal(url.origin,'https://wa.me');assert.equal(url.pathname,'/');assert.deepEqual([...url.searchParams.keys()],['text']);assert.ok(url.searchParams.get('text').includes('demandId=task-synthetic'));assert.throws(()=>manualShareUrl('x','id','javascript:alert(1)'));});

test('internal benchmark: paginated task reads and a 1000-notice inbox stay bounded and perform zero writes',async t=>{
 const f=fixture(t),worker=await f.actor('worker-a');
 for(let index=0;index<1000;index++){
  const taskId='benchmark-task-'+index;f.insert('followup_tasks',{id:taskId,organization_id:'org-a',project_id:'project-a',title:'Synthetic task '+index,priority:'medium',status:'open',created_by:'admin-a',created_at:f.now,updated_at:f.now});
  f.insert('followup_assignees',{id:'benchmark-assignee-'+index,task_id:taskId,user_id:'worker-a',created_at:f.now});
  f.insert('followup_notifications',{id:'benchmark-notice-'+index,task_id:taskId,user_id:'worker-a',cause_key:'task:1',created_at:f.now});
 }
 const before=f.native.prepare('SELECT total_changes() n').get().n,tasks=[],inbox=[];
 for(let sample=0;sample<10;sample++){
  const beforeReads=f.db.reads;let start=performance.now();const page=await followupList(f.db,worker,{projectId:'project-a'});tasks.push(performance.now()-start);assert.ok(f.db.reads-beforeReads<=2,'a page must use bounded reads rather than a query per task');assert.equal(page.tasks.length,50);assert.equal(page.hasMore,true);
  start=performance.now();const notices=await notificationInbox(f.db,worker);inbox.push(performance.now()-start);assert.equal(notices.notifications.length,100);assert.equal(notices.unread,1000);assert.equal(notices.pending.length,100);assert.equal(notices.pendingHasMore,true);
 }
 assert.equal(f.native.prepare('SELECT total_changes() n').get().n,before);
 const metrics=values=>{const sorted=values.toSorted((a,b)=>a-b);return{samples:sorted.length,p50Ms:+sorted[4].toFixed(2),p95Ms:+sorted[9].toFixed(2)};};
 t.diagnostic(JSON.stringify({benchmark:'followup-local-sqlite',fixture:{tasks:1000,notices:1000},taskPage:metrics(tasks),inbox:metrics(inbox),writes:0,limitation:'Synthetic in-memory SQLite; does not estimate serverless capacity.'}));
});


test('partial team metadata updates preserve its roster; removing everyone requires an explicit empty array',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a');const team=await act(f,admin,'team.create',{organizationId:'org-a',name:'Comunicação',userIds:['worker-a','viewer-a'],operationKey:crypto.randomUUID()});
 await act(f,admin,'team.update',{id:team.teamId,expectedVersion:1,name:'Comunicação e divulgação',operationKey:crypto.randomUUID()});
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_team_members WHERE team_id=? AND removed_at IS NULL').get(team.teamId).n,2);
 await act(f,admin,'team.update',{id:team.teamId,expectedVersion:2,status:'archived',userIds:[],operationKey:crypto.randomUUID()});
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_team_members WHERE team_id=? AND removed_at IS NULL').get(team.teamId).n,0);
});

test('clearing all dismisses the whole authorized window without reading, deleting or consuming later notices',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a'),worker=await f.actor('worker-a'),other=await f.actor('worker-b');
 const first=await act(f,admin,'task.create',create());
 for(let i=0;i<105;i++){
  f.insert('followup_notifications',{id:'older-'+i,task_id:first.task.id,user_id:'worker-a',cause_key:'synthetic:'+i,created_at:f.now});
 }
 const before=await notificationInbox(f.db,worker);
 assert.equal(before.notifications.length,100);
 assert.equal(before.hasMore,true);
 assert.equal(before.unread,106);
 assert.equal(before.clearThrough,'older-104');
 f.insert('followup_notifications',{id:'later',task_id:first.task.id,user_id:'worker-a',cause_key:'synthetic:later',created_at:f.now});
 const otherResult=await act(f,other,'notification.dismiss',{through:before.clearThrough});
 assert.equal(otherResult.unread,0);
 assert.equal((await notificationInbox(f.db,worker)).unread,107);
 const result=await act(f,worker,'notification.dismiss',{through:before.clearThrough});
 assert.deepEqual(result.notifications.map(row=>row.id),['later']);
 assert.equal(result.hasMore,false);
 assert.equal(result.unread,1);
 assert.equal(result.pending.length,1);
 assert.equal((await notificationInbox(f.db,admin)).unread,1);
 const metadata=()=>f.native.prepare("SELECT COUNT(*) n,MIN(dismissed_at) first,MAX(dismissed_at) last FROM followup_inbox_entries WHERE dismissed_at IS NOT NULL").get();
 assert.equal(metadata().n,106);
 const saved=metadata();
 assert.equal((await act(f,worker,'notification.dismiss',{through:before.clearThrough})).unread,1);
 assert.deepEqual(metadata(),saved);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM followup_notifications WHERE user_id='worker-a' AND read_at IS NULL").get().n,107);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,1);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_history').get().n,1);
});

test('dismissing a notice group and hiding followed work use separate personal controls and live authority',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a'),worker=await f.actor('worker-a'),other=await f.actor('worker-b');
 const first=(await act(f,admin,'task.create',create())).task;
 const second=(await act(f,admin,'task.create',create({title:'Outro item sintético'}))).task;
 const before=await notificationInbox(f.db,worker);
 const dismissed=await act(f,worker,'notification.dismiss',{through:before.clearThrough,taskId:first.id});
 assert.deepEqual(dismissed.notifications.map(row=>row.task_id),[second.id]);
 assert.equal(dismissed.pending.length,2);
 const forbidden=await act(f,other,'pending.visibility',{taskId:first.id,version:first.version,hidden:true});
 assert.equal(forbidden.hiddenPending.length,0);
 assert.equal(forbidden.pendingVisibility,'outdated');
 const hidden=await act(f,worker,'pending.visibility',{taskId:first.id,version:first.version,hidden:true});
 assert.equal(hidden.pendingVisibility,'confirmed');
 assert.deepEqual(hidden.pending.map(row=>row.id),[second.id]);
 assert.deepEqual(hidden.hiddenPending.map(row=>row.id),[first.id]);
 assert.equal(hidden.unread,1);
 assert.equal((await notificationInbox(f.db,admin)).pending.length,2);
 const hideAgain=await act(f,worker,'pending.visibility',{taskId:first.id,version:first.version,hidden:true});
 assert.equal(hideAgain.hiddenPending.length,1);
 assert.equal(hideAgain.pendingVisibility,'confirmed');
 for(let attempt=0;attempt<2;attempt++){
  const restored=await act(f,worker,'pending.visibility',{taskId:first.id,version:first.version,hidden:false});
  assert.equal(restored.pending.length,2);
  assert.equal(restored.pendingVisibility,'confirmed');
 }
 await act(f,worker,'pending.visibility',{taskId:first.id,version:first.version,hidden:true});
 const updated=(await act(f,admin,'task.update',{id:first.id,expectedVersion:first.version,title:'Novo contexto sintético',operationKey:crypto.randomUUID()})).task;
 const fresh=await notificationInbox(f.db,worker);
 assert.ok(fresh.pending.some(row=>row.id===first.id&&row.version===updated.version));
 assert.equal(fresh.hiddenPending.length,0);
 assert.ok(fresh.notifications.some(row=>row.task_id===first.id));
 const stale=await act(f,worker,'pending.visibility',{taskId:first.id,version:first.version,hidden:true});
 assert.equal(stale.pending.length,2);
 assert.equal(stale.pendingVisibility,'outdated');
 await act(f,worker,'pending.visibility',{taskId:first.id,version:updated.version,hidden:true});
 const staleRestore=await act(f,worker,'pending.visibility',{taskId:first.id,version:first.version,hidden:false});
 assert.equal(staleRestore.pendingVisibility,'outdated');
 assert.ok(staleRestore.hiddenPending.some(row=>row.id===first.id&&row.version===updated.version));
 f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='worker-a'").run(f.now);
 await act(f,worker,'notification.dismiss',{through:fresh.clearThrough});
 await act(f,worker,'pending.visibility',{taskId:second.id,version:second.version,hidden:true});
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM followup_inbox_entries WHERE dismissed_at IS NOT NULL").get().n,1);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM followup_hidden_pending WHERE task_id=?").get(second.id).n,0);
 assert.equal((await notificationInbox(f.db,worker)).pending.length,0);
});

test('migration backfills old notices and allocates fresh immutable ordering after removal',()=>{
 const native=new DatabaseSync(':memory:');
 try{
  native.exec('PRAGMA foreign_keys=ON');
  const files=readdirSync(root+'drizzle').filter(n=>n.endsWith('.sql')).sort();
  const file=files.find(n=>n==='0019_followup_personal_inbox.sql');
  for(const name of files.filter(n=>n<file))native.exec(readFileSync(root+'drizzle/'+name,'utf8'));
  native.exec(`
   INSERT INTO portal_users(user_id,email,created_at,updated_at) VALUES('p','p@example.invalid','2026-11-04','2026-11-04');
   INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('org-test','Org test','org-test','2026-11-04','2026-11-04');
   INSERT INTO followup_tasks(id,organization_id,title,created_by,created_at,updated_at) VALUES('t','org-test','Synthetic','p','2026-11-04','2026-11-04');
   INSERT INTO followup_notifications(id,task_id,user_id,cause_key,created_at) VALUES('n','t','p','one','2026-11-04');
  `);
  native.exec(readFileSync(root+'drizzle/'+file,'utf8'));
  const first=native.prepare("SELECT sequence FROM followup_inbox_entries WHERE notification_id='n'").get().sequence;
  native.exec(`DELETE FROM followup_notifications WHERE id='n';
    INSERT INTO followup_notifications(id,task_id,user_id,cause_key,created_at) VALUES('n2','t','p','two','2026-11-04');`);
  assert.equal(native.prepare('SELECT COUNT(*) n FROM followup_inbox_entries').get().n,1);
  assert.ok(native.prepare("SELECT sequence FROM followup_inbox_entries WHERE notification_id='n2'").get().sequence>first);
  assert.deepEqual(native.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{native.close();}
});

test('hidden pending cursor preserves priority, due date and ID after a concurrent removal and rechecks live scope',async t=>{
 const f=fixture(t),worker=await f.actor('worker-a'),other=await f.actor('worker-b');
 const priorities=['high','medium','low'];
 const sample=Array.from({length:46},(_,index)=>({
  id:'hidden-'+String(index).padStart(2,'0'),rank:index%3,due:index%4===0?null:'2026-11-'+String(5+index%4).padStart(2,'0'),
 }));
 function hiddenTask(row,owner,org,project){
  f.insert('followup_tasks',{id:row.id,title:'Pendência '+row.id,priority:priorities[row.rank],due_at:row.due,created_by:owner,organization_id:org,project_id:project,created_at:f.now,updated_at:f.now});
  f.insert('followup_hidden_pending',{task_id:row.id,user_id:owner,task_version:1});
 }
 for(const row of sample)hiddenTask(row,'worker-a','org-a','project-a');
 hiddenTask({id:'foreign-hidden',rank:1,due:null},'worker-b','org-b','project-b');
 const expected=[...sample].sort((left,right)=>left.rank-right.rank||(left.due??'9999').localeCompare(right.due??'9999')||left.id.localeCompare(right.id)).map(row=>row.id);
 const first=await notificationInbox(f.db,worker);
 assert.deepEqual(first.hiddenPending.map(row=>row.id),expected.slice(0,20));
 assert.ok(first.hiddenPendingCursor);
 assert.equal(first.hiddenPendingAfter,null);
 assert.equal(first.hiddenPendingHasMore,true);
 f.native.prepare('UPDATE followup_tasks SET version=2 WHERE id=?').run(expected[0]);
 const second=await notificationInbox(f.db,worker,first.hiddenPendingCursor);
 assert.deepEqual(second.hiddenPending.map(row=>row.id),expected.slice(20,40));
 assert.equal(second.hiddenPendingAfter,first.hiddenPendingCursor);
 assert.equal(second.hiddenPendingHasMore,true);
 const third=await notificationInbox(f.db,worker,second.hiddenPendingCursor);
 assert.deepEqual(third.hiddenPending.map(row=>row.id),expected.slice(40));
 assert.equal(third.hiddenPendingHasMore,false);
 assert.equal(third.hiddenPendingCursor,null);
 assert.ok(!(await notificationInbox(f.db,other,first.hiddenPendingCursor)).hiddenPending.some(row=>expected.includes(row.id)));
 await assert.rejects(notificationInbox(f.db,worker,"0~2026-11-05~' OR 1=1"),{status:400});
 f.db.before=()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='worker-a'").run(f.now);
 const revoked=await notificationInbox(f.db,worker,first.hiddenPendingCursor);
 assert.equal(revoked.hiddenPending.length,0);
 assert.equal(revoked.hiddenPendingCursor,null);
});


const activityInput=(extra={})=>({organizationId:'org-a',projectId:'project-a',title:'Mesa de apresentação QA',rows:[{label:'Apresentação realizada?'},{label:'Avaliação registrada?'}],userIds:['viewer-a'],operationKey:crypto.randomUUID(),...extra});
async function activityGrant(f,manager,taskId,userId='viewer-a'){return act(f,manager,'task.worker.grant',{id:taskId,userId,confirmed:true,operationKey:crypto.randomUUID()});}
const answerStep=(f,actor,detail,index,answer='yes',note='')=>act(f,actor,'checklist.activity.answer',{id:detail.checklist.id,rowId:detail.checklist.rows[index].id,expectedVersion:detail.checklist.rows[index].version,answer,note,operationKey:crypto.randomUUID()});

test('activity checklists preserve material contracts and never complete through the material branch or alter stock',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),viewer=await f.actor('viewer-a'),before=f.native.prepare('SELECT stock,reserved FROM items WHERE id=?').get('item-a');
 let detail=await act(f,manager,'checklist.activity.create',activityInput());assert.equal(detail.checklist.kind,'activity');assert.equal(detail.checklist.rows.length,2);assert.ok(detail.checklist.rows.every(row=>row.answer===null));
 await activityGrant(f,manager,detail.task.id);assert.equal((await followupDetail(f.db,viewer,detail.task.id)).task.canWork,true);
 await assert.rejects(act(f,manager,'checklist.complete',{id:detail.checklist.id,expectedVersion:1,operationKey:crypto.randomUUID()}),{status:400});
 await assert.rejects(act(f,manager,'checklist.count',{id:detail.checklist.id,rowId:detail.checklist.rows[0].id,counted:2,expectedVersion:1,operationKey:crypto.randomUUID()}),{status:400});
 await assert.rejects(act(f,viewer,'checklist.activity.complete',{id:detail.checklist.id,expectedVersion:1,operationKey:crypto.randomUUID()}),{status:400});
 await assert.rejects(act(f,manager,'task.update',{id:detail.task.id,status:'completed',expectedVersion:1,operationKey:crypto.randomUUID()}),{status:400});
 detail=await answerStep(f,viewer,detail,0);detail=await answerStep(f,viewer,detail,1,'not_applicable','Atividade não exigiu este registro.');
 detail=await act(f,viewer,'checklist.activity.complete',{id:detail.checklist.id,expectedVersion:detail.checklist.version,operationKey:crypto.randomUUID()});assert.equal(detail.task.status,'completed');assert.equal(detail.checklist.status,'completed');assert.deepEqual(f.native.prepare('SELECT stock,reserved FROM items WHERE id=?').get('item-a'),before);
 await assert.rejects(answerStep(f,viewer,detail,0,'no'),{status:409});
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_checklist_items').get().n,0);
});

test('two activity monitors can answer different steps concurrently; same-step writes use CAS and retries remain idempotent',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),first=await f.actor('viewer-a');
 f.insert('portal_users',{user_id:'viewer-two',email:'viewer-two@example.invalid',status:'active',created_at:f.now,updated_at:f.now});f.insert('members',{id:'member-viewer-two',user_id:'viewer-two',email:'viewer-two@example.invalid',role:'viewer',project_id:'project-a',organization_id:'org-a',created_at:f.now});f.users['viewer-two']={userId:'viewer-two',email:'viewer-two@example.invalid',displayName:'Monitor QA'};
 const second=await f.actor('viewer-two');let detail=await act(f,manager,'checklist.activity.create',activityInput({userIds:['viewer-a','viewer-two']}));await activityGrant(f,manager,detail.task.id);await activityGrant(f,manager,detail.task.id,'viewer-two');
 const results=await Promise.all([answerStep(f,first,detail,0),answerStep(f,second,detail,1)]);assert.equal(results.length,2);detail=await followupDetail(f.db,manager,detail.task.id);assert.deepEqual(detail.checklist.rows.map(row=>row.version),[2,2]);assert.equal(detail.checklist.version,3);
 const update={id:detail.checklist.id,rowId:detail.checklist.rows[0].id,expectedVersion:2,answer:'yes',note:'Confirmado',operationKey:crypto.randomUUID()};const changed=await act(f,first,'checklist.activity.answer',update);const replay=await act(f,first,'checklist.activity.answer',update);assert.equal(replay.duplicate,true);assert.equal(changed.checklist.rows[0].version,3);
 const outcomes=await Promise.allSettled([answerStep(f,first,detail,1,'yes','Primeira resposta'),answerStep(f,second,detail,1,'no','Segunda resposta')]);assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(outcomes.find(row=>row.status==='rejected').reason.status,409);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_history WHERE task_id=?').get(detail.task.id).n,5);
});

test('activity answer and lost-reply replay honor grant/issuer revocation at the commit boundary and cross-project scope',async t=>{
 for(const condition of ['grant','issuer']){const f=fixture(t),manager=await f.actor('manager-a'),viewer=await f.actor('viewer-a'),outsider=await f.actor('worker-b');const detail=await act(f,manager,'checklist.activity.create',activityInput());await activityGrant(f,manager,detail.task.id);
 await assert.rejects(answerStep(f,outsider,detail,0),{status:404});
 const before=f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n;
 f.db.before=()=>condition==='grant'?f.native.prepare('UPDATE followup_work_grants SET revoked_at=? WHERE task_id=?').run(f.now,detail.task.id):f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager-a'").run(f.now);
 await assert.rejects(answerStep(f,viewer,detail,0),{status:403});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,before);assert.equal(f.native.prepare('SELECT answer FROM followup_checklist_steps WHERE id=?').get(detail.checklist.rows[0].id).answer,null);
 }
});

test('activity negative answers require operational review and retain a restricted change history',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),viewer=await f.actor('viewer-a');let detail=await act(f,manager,'checklist.activity.create',activityInput());await activityGrant(f,manager,detail.task.id);detail=await answerStep(f,viewer,detail,0,'no','Ausência registrada para revisão.');detail=await answerStep(f,viewer,detail,1,'yes');
 assert.equal(detail.history.find(row=>row.snapshot.activityChecklistChange?.rowId===detail.checklist.rows[0].id).snapshot.activityChecklistChange.after.note,'Ausência registrada para revisão.');
 await assert.rejects(act(f,viewer,'checklist.activity.complete',{id:detail.checklist.id,expectedVersion:detail.checklist.version,operationKey:crypto.randomUUID()}),{status:409});
 detail=await act(f,manager,'checklist.activity.complete',{id:detail.checklist.id,expectedVersion:detail.checklist.version,operationKey:crypto.randomUUID()});assert.equal(detail.task.status,'completed');
 const tables=describePortableSchemas().tables.map(row=>row.table);assert.ok(!tables.includes('followup_checklist_steps'));assert.ok(!JSON.stringify(describePortableSchemas()).includes('activityChecklistChange'));
});

test('activity checkpoints reject foreign rows, oversize text and material rows in the wrong kind; failed storage rolls back',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a');const first=await act(f,manager,'checklist.activity.create',activityInput()),second=await act(f,manager,'checklist.activity.create',activityInput());
 await assert.rejects(act(f,manager,'checklist.activity.answer',{id:first.checklist.id,rowId:second.checklist.rows[0].id,expectedVersion:1,answer:'yes',note:'',operationKey:crypto.randomUUID()}),{status:404});
 await assert.rejects(answerStep(f,manager,first,0,'yes','x'.repeat(601)),{status:400});
 await assert.rejects(act(f,manager,'checklist.activity.create',activityInput({rows:[{label:'x'.repeat(161)}]})),{status:400});
 assert.throws(()=>f.native.prepare("INSERT INTO followup_checklist_items(id,checklist_id,item_id,expected) VALUES('forged',?,'item-a',1)").run(first.checklist.id),/followup_reference_mismatch/);
 assert.throws(()=>f.native.prepare("UPDATE followup_checklists SET kind='materials' WHERE id=?").run(first.checklist.id),/followup_scope_immutable/);
 const before=f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n;f.db.fail=/UPDATE followup_checklist_steps/;await assert.rejects(answerStep(f,manager,first,0));assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,before);assert.equal(f.native.prepare('SELECT answer FROM followup_checklist_steps WHERE id=?').get(first.checklist.rows[0].id).answer,null);
});


test('cancelling the parent demand fences activity answers and completion inside the same atomic transaction',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),detail=await act(f,manager,'checklist.activity.create',activityInput());const before=f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n;
 f.db.before=()=>f.native.prepare("UPDATE followup_tasks SET status='cancelled' WHERE id=?").run(detail.task.id);
 await assert.rejects(answerStep(f,manager,detail,0),{status:409});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,before);assert.equal(f.native.prepare('SELECT answer FROM followup_checklist_steps WHERE id=?').get(detail.checklist.rows[0].id).answer,null);
});


test('a successful activity answer cannot be replayed after its work grant is revoked',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),viewer=await f.actor('viewer-a'),detail=await act(f,manager,'checklist.activity.create',activityInput());await activityGrant(f,manager,detail.task.id);
 const update={id:detail.checklist.id,rowId:detail.checklist.rows[0].id,expectedVersion:1,answer:'yes',note:'Confirmado na atividade QA',operationKey:crypto.randomUUID()};await act(f,viewer,'checklist.activity.answer',update);
 f.native.prepare('UPDATE followup_work_grants SET revoked_at=? WHERE task_id=?').run(f.now,detail.task.id);
 await assert.rejects(act(f,viewer,'checklist.activity.answer',update),{status:403});assert.equal(f.native.prepare('SELECT version FROM followup_checklist_steps WHERE id=?').get(detail.checklist.rows[0].id).version,2);
});
