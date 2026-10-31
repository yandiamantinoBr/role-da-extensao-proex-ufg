import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {resolve,dirname} from 'node:path';import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
function compile(file){file=resolve(root,file);if(cache.has(file))return cache.get(file);let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;code=code.replace(/from (['"])(\.[^'"]+)\1/g,(_m,_q,name)=>`from ${JSON.stringify(compile(resolve(dirname(file),name+'.ts')))}`);const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,url);return url;}
const {getActor}=await import(compile('lib/access.ts'));
const {followupAction,notificationInbox}=await import(compile('lib/follow-up/service.ts'));
const {groupNotifications}=await import(compile('lib/follow-up/notification-groups.ts'));
function fixture(t){const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(root+'drizzle').filter(n=>n.endsWith('.sql')).sort())native.exec(readFileSync(root+'drizzle/'+name,'utf8'));t.after(()=>native.close());const now=new Date().toISOString();
 const insert=(table,row)=>{const cols=Object.keys(row);native.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));};
 for(const suffix of ['a','b']){insert('organizations',{id:`org-${suffix}`,name:`Organization ${suffix}`,slug:`org-${suffix}`,created_at:now,updated_at:now});insert('projects',{id:`project-${suffix}`,organization_id:`org-${suffix}`,name:`Project ${suffix}`,created_at:now});insert('items',{id:`item-${suffix}`,project_id:`project-${suffix}`,name:suffix==='a'?'Coletes P/M/G':'Private organization B item',category:'distribution',unit:'un',stock:40,created_at:now});insert('campaigns',{id:`campaign-${suffix}`,project_id:`project-${suffix}`,name:`Event ${suffix}`,starts_at:now,ends_at:new Date(Date.now()+86400000).toISOString(),status:'active',created_at:now});}
 const users={};function user(name,role,project,org){insert('portal_users',{user_id:name,email:name+'@example.invalid',status:'active',created_at:now,updated_at:now});insert('profiles',{user_id:name,display_name:name,created_at:now,updated_at:now});insert('members',{id:'member-'+name,user_id:name,email:name+'@example.invalid',role,project_id:project,organization_id:org,created_at:now});return users[name]={userId:name,email:name+'@example.invalid',displayName:name};}
 user('platform','owner',null,null);user('admin-a','owner',null,'org-a');user('admin-b','owner',null,'org-b');user('manager-a','manager','project-a','org-a');user('viewer-a','viewer','project-a','org-a');user('worker-a','inventory','project-a','org-a');user('worker-b','inventory','project-b','org-b');
 const db={native,reads:0,before:null,fail:null,prepare(sql){let values=[];return{sql,bind(...args){values=args;return this;},async first(){db.reads++;return native.prepare(sql).get(...values)??null;},async all(){db.reads++;return{results:native.prepare(sql).all(...values)};},async run(){return this.execute();},execute(){if(db.fail?.test(sql)){db.fail=null;throw new Error('synthetic storage failure');}const results=native.prepare(sql).all(...values);return{results,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(this.before){const hook=this.before;this.before=null;hook();}native.exec('BEGIN');try{const results=statements.map(s=>s.execute());native.exec('COMMIT');return results;}catch(error){native.exec('ROLLBACK');throw error;}}};
 return{db,native,users,insert,now,actor:name=>getActor(db,users[name])};
}
const act=(f,actor,input)=>followupAction(f.db,actor,input.action,input);
async function create(f,extra={}){return act(f,await f.actor('manager-a'),{action:'task.create',projectId:'project-a',title:'Conferência sintética',userIds:['worker-a','viewer-a'],operationKey:crypto.randomUUID(),...extra});}
function notice(f,taskId,userId,index,read_at=null){f.insert('followup_notifications',{id:`notice-${userId}-${index}`,task_id:taskId,user_id:userId,cause_key:'synthetic-'+index,created_at:new Date(Date.parse(f.now)+(index+1)*1000).toISOString(),read_at});}

test('groups contain only the 100-row authorized recent window while global unread remains complete',async t=>{
 const f=fixture(t),worker=await f.actor('worker-a'),created=await create(f);for(let i=0;i<150;i++)notice(f,created.task.id,'worker-a',i);
 const before=f.native.prepare('SELECT total_changes() n').get().n,inbox=await notificationInbox(f.db,worker);assert.equal(inbox.notifications.length,100);assert.equal(inbox.hasMore,true);assert.equal(inbox.windowLimit,100);assert.equal(inbox.unread,151);assert.equal(inbox.viewerId,'worker-a');assert.match(inbox.today,/^\d{4}-\d{2}-\d{2}$/);assert.equal(inbox.groups.length,1);assert.equal(inbox.groups[0].updates,100);assert.equal(inbox.groups[0].unread,100);assert.equal(inbox.groups[0].last_created_at,new Date(Date.parse(f.now)+150000).toISOString());assert.equal(f.native.prepare('SELECT total_changes() n').get().n,before);
 const other=await notificationInbox(f.db,await f.actor('worker-b'));assert.equal(other.groups.length,0);assert.equal(other.unread,0);
});

test('opening a group marks every eligible own task notice once while preserving other people, tasks and old read timestamps',async t=>{
 const f=fixture(t),worker=await f.actor('worker-a'),created=await create(f),other=await create(f,{title:'Outra demanda'}),stamp='2026-10-01T12:00:00Z';for(let i=0;i<5;i++)notice(f,created.task.id,'worker-a',i,i===0?stamp:null);notice(f,created.task.id,'viewer-a',0);
 let updates=0;const prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{if(sql.startsWith('UPDATE followup_notifications'))updates++;return prepare(sql);};
 const result=await act(f,worker,{action:'notification.read',taskId:created.task.id,read:true});assert.equal(updates,1);assert.equal(result.groups.find(g=>g.task_id===created.task.id).unread,0);assert.equal(result.unread,1);assert.equal(f.native.prepare('SELECT read_at FROM followup_notifications WHERE id=?').get('notice-worker-a-0').read_at,stamp);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_notifications WHERE task_id=? AND user_id=? AND read_at IS NULL').get(created.task.id,'viewer-a').n,2);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_notifications WHERE task_id=? AND user_id=? AND read_at IS NULL').get(other.task.id,'worker-a').n,1);
 await act(f,worker,{action:'notification.read',taskId:created.task.id,read:false});assert.equal((await notificationInbox(f.db,worker)).groups.find(g=>g.task_id===created.task.id).unread,6);
});

test('task-read selectors are exclusive and never accept another user or mark another recipient notices',async t=>{
 const f=fixture(t),worker=await f.actor('worker-a'),created=await create(f),id=f.native.prepare("SELECT id FROM followup_notifications WHERE user_id='worker-a'").get().id;
 for(const selectors of [{id,taskId:created.task.id},{id,all:true},{taskId:created.task.id,all:true},{id,all:false},{all:false},{},{taskId:created.task.id,userId:'viewer-a'}])await assert.rejects(act(f,worker,{action:'notification.read',read:true,...selectors}),{status:400});
 const before=f.native.prepare("SELECT COUNT(*) n FROM followup_notifications WHERE user_id='worker-a' AND read_at IS NULL").get().n;await act(f,await f.actor('worker-b'),{action:'notification.read',taskId:created.task.id,read:true});assert.equal(f.native.prepare("SELECT COUNT(*) n FROM followup_notifications WHERE user_id='worker-a' AND read_at IS NULL").get().n,before);
 await act(f,worker,{action:'notification.read',id,read:true});assert.equal(f.native.prepare('SELECT read_at FROM followup_notifications WHERE id=?').get(id).read_at!==null,true);await act(f,worker,{action:'notification.read',all:true,read:false});assert.equal((await notificationInbox(f.db,worker)).unread,before);
});

test('revoked scope, blocked account and removal from an assigned team prevent group reads at the SQL boundary',async t=>{
 for(const kind of ['membership','account','team','recipient']){const f=fixture(t),worker=await f.actor('worker-a');let created;
 if(kind==='team'){const team=await act(f,await f.actor('admin-a'),{action:'team.create',organizationId:'org-a',name:'Comunicação',userIds:['worker-a'],operationKey:crypto.randomUUID()});created=await create(f,{userIds:[],teamIds:[team.teamId]});f.native.prepare('UPDATE followup_team_members SET removed_at=? WHERE team_id=?').run(f.now,team.teamId);}
 else{created=await create(f);if(kind==='membership')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='worker-a'").run(f.now);if(kind==='account')f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='worker-a'").run();if(kind==='recipient')f.native.prepare("UPDATE followup_assignees SET removed_at=? WHERE user_id='worker-a' AND task_id=?").run(f.now,created.task.id);}
 const result=await act(f,worker,{action:'notification.read',taskId:created.task.id,read:true});assert.equal(result.unread,0,kind);assert.equal(result.groups.length,0,kind);assert.ok(f.native.prepare("SELECT COUNT(*) n FROM followup_notifications WHERE user_id='worker-a' AND task_id=? AND read_at IS NULL").get(created.task.id).n>0,kind);
 }
});

test('SQL revalidates a task-read after the request actor was resolved, including a revocation immediately before UPDATE',async t=>{
 const f=fixture(t),worker=await f.actor('worker-a'),created=await create(f),prepare=f.db.prepare.bind(f.db);let revoked=false;f.db.prepare=sql=>{if(sql.startsWith('UPDATE followup_notifications')){revoked=true;f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='worker-a'").run(f.now);}return prepare(sql);};const result=await act(f,worker,{action:'notification.read',taskId:created.task.id,read:true});assert.equal(revoked,true);assert.equal(result.groups.length,0);assert.equal(f.native.prepare("SELECT COUNT(*) n FROM followup_notifications WHERE user_id='worker-a' AND read_at IS NULL").get().n,1);
});

test('one atomic inbox snapshot suppresses every projection if access is revoked before its read batch',async t=>{
 const f=fixture(t),worker=await f.actor('worker-a');await create(f);f.db.before=()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='worker-a'").run(f.now);const inbox=await notificationInbox(f.db,worker);assert.deepEqual(inbox.notifications,[]);assert.deepEqual(inbox.groups,[]);assert.deepEqual(inbox.pending,[]);assert.equal(inbox.unread,0);assert.equal(inbox.hasMore,false);
});

test('group ordering uses the newest finite timestamp and does not manufacture an all-time group total',()=>{
 const notice=(task,created,read=null)=>({task_id:task,title:task,status:'open',priority:'medium',due_at:null,created_at:created,read_at:read});const groups=groupNotifications([notice('a','2026-10-31T13:00:00Z'),notice('a','invalid'),notice('b','2026-10-31T14:00:00Z','already-read')]);assert.deepEqual(groups.map(g=>g.task_id),['b','a']);assert.equal(groups[1].updates,2);assert.equal(groups[1].unread,2);assert.equal(groups[1].last_created_at,'2026-10-31T13:00:00Z');assert.equal(Object.hasOwn(groups[1],'total'),false);assert.equal(groupNotifications([notice('bad',{toString:null})])[0].last_created_at,null);
});
