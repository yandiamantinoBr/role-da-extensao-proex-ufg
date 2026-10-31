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
 const db={native,before:null,fail:null,prepare(sql){let values=[];return{sql,bind(...args){values=args;return this;},async first(){return native.prepare(sql).get(...values)??null;},async all(){return{results:native.prepare(sql).all(...values)};},async run(){return this.execute();},execute(){if(db.fail?.test(sql)){db.fail=null;throw new Error('synthetic storage failure');}const results=native.prepare(sql).all(...values);return{results,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(this.before){const hook=this.before;this.before=null;hook();}native.exec('BEGIN');try{const results=statements.map(s=>s.execute());native.exec('COMMIT');return results;}catch(error){native.exec('ROLLBACK');throw error;}}};
 return{db,native,users,insert,now,actor:name=>getActor(db,users[name])};
}
const create=(extra={})=>({organizationId:'org-a',projectId:'project-a',title:'Recontagem de bottons',body:'Conferir a quantidade física antes de movimentar estoque.',priority:'high',dueAt:'2026-11-05',userIds:['worker-a'],operationKey:crypto.randomUUID(),...extra});
const act=(f,actor,action,input)=>followupAction(f.db,actor,action,{action,...input});

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
 const restored=validateArchive(archive.bytes,{migrations});assert.equal(restored.manifest.sqlite.tables.filter(t=>t.name.startsWith('followup_')).length,10);
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
