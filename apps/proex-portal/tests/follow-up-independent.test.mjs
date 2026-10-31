import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {gzipSync} from 'node:zlib';import {join,sep} from 'node:path';
import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {resolve,dirname} from 'node:path';import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
function compile(file){file=resolve(root,file);if(cache.has(file))return cache.get(file);let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;code=code.replace(/from (['"])(\.[^'"]+)\1/g,(_m,_q,name)=>`from ${JSON.stringify(compile(resolve(dirname(file),name+'.ts')))}`);const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,url);return url;}
const {getActor}=await import(compile('lib/access.ts'));
const {followupAction,followupList,followupDetail,followupCatalog,notificationInbox}=await import(compile('lib/follow-up/service.ts'));

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

test('independent: delegated grant does not preserve operational checklist powers after inventory role is demoted before commit',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),worker=await f.actor('worker-a');
 let detail=await act(f,manager,'checklist.create',{projectId:'project-a',title:'Independent demotion conference',rows:[{itemId:'item-a',size:'M',expected:5}],userIds:['worker-a'],operationKey:crypto.randomUUID()});
 await act(f,manager,'task.worker.grant',{id:detail.task.id,userId:'worker-a',confirmed:true,operationKey:crypto.randomUUID()});
 detail=await act(f,worker,'checklist.count',{id:detail.checklist.id,rowId:detail.checklist.rows[0].id,expectedVersion:1,counted:4,damaged:1,operationKey:crypto.randomUUID()});
 f.db.before=()=>f.native.prepare("UPDATE members SET role='viewer' WHERE user_id='worker-a'").run();
 await assert.rejects(act(f,worker,'checklist.complete',{id:detail.checklist.id,expectedVersion:2,createFollowups:true,operationKey:crypto.randomUUID()}),error=>error.status===403||error.code==='followup_manager_review');
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_checklist_actions').get().n,0);
 assert.equal(f.native.prepare('SELECT status FROM followup_checklists WHERE id=?').get(detail.checklist.id).status,'open');
});
test('independent: grant issuer demotion is effective without revoked_at, including at the commit boundary',async t=>{
 for(const timing of ['before-read','before-commit']) {
  const f=fixture(t),manager=await f.actor('manager-a'),viewer=await f.actor('viewer-a');
  const task=await act(f,manager,'task.create',create({userIds:['viewer-a']}));
  await act(f,manager,'task.worker.grant',{id:task.task.id,userId:'viewer-a',confirmed:true,operationKey:crypto.randomUUID()});
  const demote=()=>f.native.prepare("UPDATE members SET role='viewer' WHERE user_id='manager-a'").run();
  if(timing==='before-read')demote();else f.db.before=demote;
  const receipts=f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n;
  await assert.rejects(act(f,viewer,'task.work',{id:task.task.id,status:'completed',expectedVersion:1,operationKey:crypto.randomUUID()}),{status:403});
  assert.equal(f.native.prepare('SELECT status FROM followup_tasks WHERE id=?').get(task.task.id).status,'open');
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,receipts);
  assert.equal(f.native.prepare("SELECT revoked_at FROM members WHERE user_id='manager-a'").get().revoked_at,null);
 }
});

test('independent: same-organization team members, forged actor capabilities and grants never authorize a second project',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a'),viewer=await f.actor('viewer-a');
 f.insert('projects',{id:'private-project-a2',organization_id:'org-a',name:'Private A2',created_at:f.now});
 f.insert('portal_users',{user_id:'private-a2',email:'private-a2@example.invalid',status:'active',created_at:f.now,updated_at:f.now});
 f.insert('profiles',{user_id:'private-a2',display_name:'Private A2 staff',created_at:f.now,updated_at:f.now});
 f.insert('members',{id:'member-private-a2',user_id:'private-a2',email:'private-a2@example.invalid',role:'viewer',project_id:'private-project-a2',organization_id:'org-a',created_at:f.now});
 f.users['private-a2']={userId:'private-a2',email:'private-a2@example.invalid',displayName:'Private A2 staff'};
 const stranger=await f.actor('private-a2'),team=await act(f,admin,'team.create',{organizationId:'org-a',name:'Shared team',userIds:['viewer-a','private-a2'],operationKey:crypto.randomUUID()});
 const task=await act(f,admin,'task.create',create({userIds:[],teamIds:[team.teamId]}));
 const catalog=await followupCatalog(f.db,viewer,{projectId:'project-a'});
 assert.ok(!JSON.stringify(catalog).includes('private-a2'));assert.ok(!JSON.stringify(catalog).includes('Private A2'));
 assert.equal((await notificationInbox(f.db,stranger)).unread,0);assert.equal((await followupList(f.db,stranger)).tasks.length,0);
 await assert.rejects(act(f,admin,'task.worker.grant',{id:task.task.id,userId:'private-a2',confirmed:true,operationKey:crypto.randomUUID()}),{status:409});
 const forged={...stranger,members:admin.members,capabilities:admin.capabilities,organizations:admin.organizations,organizationProjects:admin.organizationProjects};
 await assert.rejects(followupDetail(f.db,forged,task.task.id),{status:404});
 await assert.rejects(act(f,forged,'task.create',create()),{status:403});
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_work_grants').get().n,0);
});

test('independent: every account state and issuer state fences delegated work and lost-reply replay',async t=>{
 for(const subject of ['viewer-a','manager-a'])for(const state of ['blocked','pending','anonymized']) {
  const f=fixture(t),manager=await f.actor('manager-a'),viewer=await f.actor('viewer-a');
  const task=await act(f,manager,'task.create',create({userIds:['viewer-a']}));
  await act(f,manager,'task.worker.grant',{id:task.task.id,userId:'viewer-a',confirmed:true,operationKey:crypto.randomUUID()});
  const input={id:task.task.id,status:'in_progress',expectedVersion:1,note:'Synthetic progress',operationKey:crypto.randomUUID()};
  await act(f,viewer,'task.work',input);
  const change=state==='blocked'?"status='blocked'":state==='pending'?'activation_pending=1':'anonymized_at=?';
  f.native.prepare(`UPDATE portal_users SET ${change} WHERE user_id=?`).run(...(state==='anonymized'?[f.now,subject]:[subject]));
  const receipts=f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n;
  for(const attempt of [input,{...input,expectedVersion:2,operationKey:crypto.randomUUID()}])await assert.rejects(act(f,viewer,'task.work',attempt),e=>[403,404].includes(e.status));
  assert.equal(f.native.prepare('SELECT version FROM followup_tasks WHERE id=?').get(task.task.id).version,2);
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,receipts);
 }
});

test('independent: partial discrepancy task failures roll back children, links, receipts, notices and completion; retry creates one per row',async t=>{
 const f=fixture(t),actor=await f.actor('worker-a');
 let detail=await act(f,actor,'checklist.create',{projectId:'project-a',title:'Independent atomic discrepancy',rows:[{itemId:'item-a',size:'P',expected:5},{itemId:'item-a',size:'M',expected:5}],operationKey:crypto.randomUUID()});
 for(const row of detail.checklist.rows)detail=await act(f,actor,'checklist.count',{id:detail.checklist.id,rowId:row.id,expectedVersion:detail.checklist.version,counted:3,damaged:1,operationKey:crypto.randomUUID()});
 const before={tasks:f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,notices:f.native.prepare('SELECT COUNT(*) n FROM followup_notifications').get().n,receipts:f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n};
 const input={id:detail.checklist.id,expectedVersion:3,createFollowups:true,operationKey:crypto.randomUUID()};
 f.db.fail=/INSERT INTO followup_checklist_actions/;await assert.rejects(act(f,actor,'checklist.complete',input));
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_checklist_actions').get().n,0);
 for(const [name,table] of [['tasks','followup_tasks'],['notices','followup_notifications'],['receipts','mutation_keys']])assert.equal(f.native.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,before[name]);
 assert.equal(f.native.prepare('SELECT status FROM followup_checklists WHERE id=?').get(detail.checklist.id).status,'open');
 const completed=await act(f,actor,'checklist.complete',input);assert.equal(completed.checklist.followups.length,2);
 const replay=await act(f,actor,'checklist.complete',input);assert.equal(replay.duplicate,true);assert.equal(replay.checklist.followups.length,2);
 assert.deepEqual({...f.native.prepare("SELECT stock,reserved FROM items WHERE id='item-a'").get()},{stock:40,reserved:0});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);
});

test('independent: action payloads reject privilege and scope fields, oversized rosters, invalid counts and date rollover',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a');
 for(const extra of [{role:'owner'},{createdBy:'platform'},{version:999},{title:'a'.repeat(161)},{body:'x'.repeat(4001)},{dueAt:'2026-02-30'},{userIds:Array(21).fill('worker-a')},{teamIds:Array(9).fill('team')},{title:'bad\u0000title'}])await assert.rejects(act(f,manager,'task.create',create(extra)),{status:400});
 await assert.rejects(act(f,manager,'checklist.create',{projectId:'project-a',rows:[{itemId:'item-a',expected:-1}],operationKey:crypto.randomUUID()}),{status:400});
 const input=create(),task=await act(f,manager,'task.create',input);
 await assert.rejects(act(f,manager,'task.create',{...input,title:'Different payload, same key'}),{status:409});
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,1);assert.equal(task.task.version,1);
});
test('independent: team name-only update preserves membership when the roster field is omitted',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a');
 const team=await act(f,admin,'team.create',{organizationId:'org-a',name:'Original team',userIds:['worker-a','viewer-a'],operationKey:crypto.randomUUID()});
 await act(f,admin,'team.update',{id:team.teamId,name:'Renamed team',expectedVersion:1,operationKey:crypto.randomUUID()});
 assert.deepEqual(f.native.prepare('SELECT user_id FROM followup_team_members WHERE team_id=? AND removed_at IS NULL ORDER BY user_id').all(team.teamId).map(r=>r.user_id),['viewer-a','worker-a']);
});

function routeModule(){
 let source=ts.transpileModule(readFileSync(root+'app/api/follow-up/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const inline=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
 source=source.replace(/from (['"])@\/lib\/([^'"]+)\1/g,(_m,_q,name)=>`from ${JSON.stringify(name==='platform'?inline('export function database(){return globalThis.__followupReview.db}'):name==='session'?inline('export async function getPortalUser(){return globalThis.__followupReview.user}'):compile('lib/'+name+'.ts'))}`);
 return import(inline(source));
}
const route=await routeModule();

test('independent: HTTP boundary honors the trusted session adapter, enforces CSRF, JSON shape and the streamed 64KiB limit',async t=>{
 const f=fixture(t);globalThis.__followupReview={db:f.db,user:f.users['manager-a']};t.after(()=>delete globalThis.__followupReview);
 const url='https://portal.example.invalid/api/follow-up',headers={Origin:'https://portal.example.invalid','X-Proex-Action':'1','Content-Type':'application/json'};
 for(const changed of [{Origin:'https://attacker.example.invalid'},{Origin:'null'},{'X-Proex-Action':''},{'Content-Type':'text/plain'}]){
  const response=await route.POST(new Request(url,{method:'POST',headers:{...headers,...changed},body:JSON.stringify({action:'task.create',...create()})}));
  assert.equal(response.status,403);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 }
 for(const body of ['[]','null','{bad-json','{}'])assert.equal((await route.POST(new Request(url,{method:'POST',headers,body}))).status,400);
 const big=JSON.stringify({action:'task.create',...create(),body:'x'.repeat(65*1024)});
 assert.equal((await route.POST(new Request(url,{method:'POST',headers,body:big}))).status,413);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,0);
 globalThis.__followupReview.user=null;
 assert.equal((await route.GET(new Request(url+'?view=inbox'))).status,401);
 globalThis.__followupReview.user=f.users['manager-a'];
 const created=await route.POST(new Request(url,{method:'POST',headers,body:JSON.stringify({action:'task.create',...create()})}));assert.equal(created.status,200);const detail=await created.json();
 globalThis.__followupReview.user=f.users['worker-b'];
 const denied=await route.GET(new Request(url+'?view=detail&id='+detail.task.id));assert.equal(denied.status,404);assert.ok(!JSON.stringify(await denied.json()).includes('Recontagem'));
});

test('independent: maximum valid teams/direct assignees bound fanout, dedupe repeated calls and never add application access',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a'),allUsers=[];
 for(let i=0;i<820;i++){
  const user='synthetic-recipient-'+i;allUsers.push(user);
  f.insert('portal_users',{user_id:user,email:user+'@example.invalid',status:'active',created_at:f.now,updated_at:f.now});
  f.insert('members',{id:'member-'+user,user_id:user,email:user+'@example.invalid',role:'viewer',project_id:'project-a',organization_id:'org-a',created_at:f.now});
 }
 const teamIds=[];for(let i=0;i<8;i++)teamIds.push((await act(f,admin,'team.create',{organizationId:'org-a',name:'Synthetic team '+i,userIds:allUsers.slice(i*100,i*100+100),operationKey:crypto.randomUUID()})).teamId);
 const members=f.native.prepare('SELECT COUNT(*) n FROM members').get().n,input=create({teamIds,userIds:allUsers.slice(800)}),started=performance.now();
 const task=await act(f,admin,'task.create',input),elapsed=performance.now()-started;
 const count=f.native.prepare('SELECT COUNT(*) n FROM followup_notifications WHERE task_id=?').get(task.task.id).n;assert.equal(count,821);
 assert.equal((await act(f,admin,'task.create',input)).duplicate,true);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_notifications WHERE task_id=?').get(task.task.id).n,821);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM members').get().n,members);
 await assert.rejects(act(f,admin,'team.create',{organizationId:'org-a',name:'Too many',userIds:allUsers.slice(0,101),operationKey:crypto.randomUUID()}),{status:400});
 t.diagnostic(JSON.stringify({fanoutRecipients:count,maximumTeamMembers:800,directAssignees:20,creator:1,taskCreateMs:Number(elapsed.toFixed(2)),database:'synthetic SQLite memory; no snapshot persistence/network timing'}));
});
test('independent: a 50-task page bounds authoritative metadata round trips without downloads or writes',async t=>{
 const f=fixture(t),admin=await f.actor('admin-a');
 for(let i=0;i<55;i++)f.insert('followup_tasks',{id:'performance-task-'+i,organization_id:'org-a',project_id:'project-a',title:'Synthetic performance task '+i,created_by:'admin-a',created_at:f.now,updated_at:f.now});
 const runtime=resolve(root,'.sites-runtime');mkdirSync(runtime,{recursive:true});const folder=mkdtempSync(join(runtime,'review-followup-'));
 const path=join(folder,'seed.sqlite');f.native.prepare('VACUUM INTO ?').run(path);
 const data=gzipSync(readFileSync(path)),counts={version:0,load:0,commit:0};
 const {SnapshotD1}=await import(compile('platform-node/d1.ts'));
 const store={async version(){counts.version++;return 1;},async load(){counts.load++;return {version:1,data};},async commit(){counts.commit++;throw new Error('GET must not commit');}};
 const db=new SnapshotD1(store,[],join(folder,'reader.sqlite'));
 t.after(()=>{db.close();assert.ok(resolve(folder).startsWith(runtime+sep));rmSync(folder,{recursive:true,force:true});});
 await db.prepare('SELECT 1').first();for(const key of Object.keys(counts))counts[key]=0;
 const start=performance.now(),page=await followupList(db,admin,{projectId:'project-a'}),elapsed=performance.now()-start;
 assert.equal(page.tasks.length,50);assert.equal(page.hasMore,true);assert.equal(counts.load,0);assert.equal(counts.commit,0);
 t.diagnostic(JSON.stringify({benchmark:'followup-authoritative-adapter',tasks:50,...counts,elapsedMs:Number(elapsed.toFixed(2)),limitation:'Synthetic in-process store; version call count is real, no network latency simulated'}));
 assert.ok(counts.version<=5,`One page used ${counts.version} serial authoritative metadata round trips; batch scoped reads instead of one execution per task`);
});
test('independent: client transport never treats an interrupted or malformed success body as valid domain data',async t=>{
 const {followupApi}=await import(compile('components/portal/follow-up-api.ts')),original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original;});
 for(const failure of [new SyntaxError('synthetic truncated JSON'),new DOMException('synthetic aborted body','AbortError')]){
  globalThis.fetch=async()=>({ok:true,json:async()=>{throw failure;}});
  await assert.rejects(followupApi('view=detail&id=synthetic-task'));
 }
});
test('independent: successful JSON must carry the requested domain view instead of an empty object',async t=>{
 const {followupApi}=await import(compile('components/portal/follow-up-api.ts')),original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original;});globalThis.fetch=async()=>({ok:true,json:async()=>({})});
 for(const view of ['catalog','detail&id=synthetic-task','inbox','tasks'])await assert.rejects(followupApi('view='+view));
});

test('independent: actual client helper, HTTP route and SQLite services agree on create, detail, list, catalog and inbox DTOs',async t=>{
 const f=fixture(t),{followupApi}=await import(compile('components/portal/follow-up-api.ts')),original=globalThis.fetch;
 globalThis.__followupReview={db:f.db,user:f.users['manager-a']};
 t.after(()=>{globalThis.fetch=original;delete globalThis.__followupReview;});
 globalThis.fetch=async(url,init={})=>{
  const request=new Request(new URL(url,'https://portal.example.invalid'),{...init,headers:{Origin:'https://portal.example.invalid',...init.headers}});
  return init.method==='POST'?route.POST(request):route.GET(request);
 };
 const created=await followupApi('',{action:'task.create',...create()});assert.ok(created.task.id);
 const detail=await followupApi('view=detail&id='+created.task.id);assert.equal(detail.task.id,created.task.id);
 const list=await followupApi('view=tasks&projectId=project-a');assert.equal(list.tasks.length,1);
 const catalog=await followupApi('view=catalog&projectId=project-a');assert.ok(catalog.projects.some(project=>project.id==='project-a'));
 const inbox=await followupApi('view=inbox');assert.equal(inbox.unread,1);
 globalThis.__followupReview.user=f.users['admin-a'];
 const team=await followupApi('',{action:'team.create',organizationId:'org-a',name:'Synthetic client team',userIds:[],operationKey:crypto.randomUUID()});assert.ok(team.teamId);
 globalThis.__followupReview.user=f.users['worker-b'];await assert.rejects(followupApi('view=detail&id='+created.task.id));
});