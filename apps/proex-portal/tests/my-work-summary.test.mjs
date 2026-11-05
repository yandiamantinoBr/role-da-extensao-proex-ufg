import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {compile,teamScenario} from './support/work-teams-fixture.mjs';
const {myWorkSummary}=await import(compile('lib/my-work/summary.ts'));
const {myWork}=await import(compile('lib/my-work/service.ts'));
const {isMyWorkSummary}=await import(compile('lib/my-work/summary-contract.ts'));
const {responsibilityAction}=await import(compile('lib/responsibilities/service.ts'));

async function fixture(t){
 const f=await teamScenario(t),owner=await f.actor('owner-a'),viewer=await f.actor('viewer-a');
 await f.act('owner-a','task.update',{id:f.shared,expectedVersion:1,userIds:['viewer-a'],teamIds:[f.a,f.a2]});
 await responsibilityAction(f.db,owner,'responsibility.save',{action:'responsibility.save',projectId:'project-a',area:'projects',expectedVersion:0,userIds:['viewer-a'],teamIds:[f.a,f.a2],operationKey:crypto.randomUUID()});
 return{...f,owner,viewer};
}
function beforeFinal(f,change){const original=f.db.batch.bind(f.db);let calls=0;f.db.batch=async statements=>{if(++calls===2)change();return original(statements);};return()=>calls;}

test('summary uses the same explicit-assignment counts across organizations/projects without a private list or double counting',async t=>{
 const f=await fixture(t),full=await myWork(f.db,f.viewer,{projectId:'project-a'}),summary=await myWorkSummary(f.db,f.viewer,{projectId:'project-a'});
 assert.equal(isMyWorkSummary(summary),true);assert.deepEqual(summary.tasks,Object.fromEntries(['total','pending','attention','dueToday','inProgress','completed'].map(k=>[k,full.totals.tasks[k]])));assert.equal(summary.tasks.total,2);assert.equal(summary.responsibilities.active,1);
 assert.deepEqual(Object.keys(summary).sort(),['version','viewerId','asOf','today','timeZone','scope','tasks','responsibilities'].sort());
 assert.doesNotMatch(JSON.stringify(summary),/Conferir|Artes|name|title|body|assignees|example.invalid|project-a2|org-b|taskId|itemId/);
 assert.deepEqual((await myWorkSummary(f.db,f.viewer,{organizationId:'org-a'})).tasks,summary.tasks);
 await assert.rejects(myWorkSummary(f.db,f.viewer,{projectId:'project-b'}),{status:403});await assert.rejects(myWorkSummary(f.db,f.viewer,{organizationId:'org-b'}),{status:403});
 const other=await myWorkSummary(f.db,await f.actor('worker-b'));assert.equal(other.tasks.total,1);assert.equal(other.responsibilities.active,0);
});

test('valid empty assignments remain distinct from missing or lost authority',async t=>{
 const f=await fixture(t),summary=await myWorkSummary(f.db,f.owner,{projectId:'project-a'});assert.equal(summary.tasks.total,0);assert.equal(summary.responsibilities.active,0);assert.equal(isMyWorkSummary(summary),true);
 await assert.rejects(myWorkSummary(f.db,null),{status:401});
 f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='viewer-a'").run(f.now);await assert.rejects(myWorkSummary(f.db,f.viewer,{projectId:'project-a'}),{status:403});
});

test('partial revocation cannot silently turn all/org totals into an all-clear zero when a second project grant remains',async t=>{
 for(const scope of [{},{organizationId:'org-a'}]){
  const f=await fixture(t);f.insert('members',{id:'viewer-second-grant',user_id:'viewer-a',email:'viewer-a@example.invalid',role:'viewer',organization_id:'org-a',project_id:'project-a2',created_at:f.now});const viewer=await f.actor('viewer-a');
  beforeFinal(f,()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE id='member-viewer-a'").run(f.now));
  await assert.rejects(myWorkSummary(f.db,viewer,scope),{status:403,code:'my_work_summary_forbidden'});assert.equal(f.native.prepare("SELECT revoked_at FROM members WHERE id='viewer-second-grant'").get().revoked_at,null);
 }
});

test('last batch rejects account, organization, grant, affiliation and project-scope changes',async t=>{
 for(const kind of ['account','organization','grant','affiliation','project']){
  const f=await fixture(t),calls=beforeFinal(f,()=>{
   if(kind==='account')f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='viewer-a'").run();
   if(kind==='organization')f.native.prepare("UPDATE organizations SET status='archived' WHERE id='org-a'").run();
   if(kind==='grant')f.native.prepare("UPDATE members SET revoked_at=? WHERE id='member-viewer-a'").run(f.now);
   if(kind==='affiliation')f.native.prepare("UPDATE followup_team_members SET removed_at=? WHERE user_id='viewer-a'").run(f.now);
   if(kind==='project')f.native.prepare("UPDATE projects SET status='archived' WHERE id='project-a'").run();
  });
  await assert.rejects(myWorkSummary(f.db,f.viewer,{projectId:'project-a'}),{status:403});assert.equal(calls(),2);
 }
});

test('assignments changing between snapshots discard the old totals instead of returning a misleading zero',async t=>{
 const f=await fixture(t);beforeFinal(f,()=>f.native.prepare("UPDATE followup_assignees SET removed_at=? WHERE task_id=?").run(f.now,f.shared));
 await assert.rejects(myWorkSummary(f.db,f.viewer,{projectId:'project-a'}),{status:409,code:'my_work_summary_changed'});
});

test('strict summary contract rejects invalid scopes, private extras, malformed dates and impossible counts',async t=>{
 const f=await fixture(t),summary=await myWorkSummary(f.db,f.viewer,{organizationId:'org-a',projectId:'project-a'});assert.equal(summary.scope.organizationId,'org-a');
 for(const input of [{projectId:'../x'},{projectId:'project-a',organizationId:'org-b'},{userId:'owner-a'},{limit:20},{status:'all'}])await assert.rejects(myWorkSummary(f.db,f.viewer,input));
 for(const invalid of [{...summary,title:'private'},{...summary,today:'2026-99-99'},{...summary,today:'2026-02-31'},{...summary,tasks:{...summary.tasks,pending:-1}},{...summary,tasks:{...summary.tasks,attention:summary.tasks.pending+1}},{...summary,scope:{...summary.scope,title:'private'}}])assert.equal(isMyWorkSummary(invalid),false);
});

test('summary performs only aggregate/select reads and changes no receipt, notification or audit',async t=>{
 const f=await fixture(t),sql=[],original=f.db.prepare.bind(f.db),before=f.native.prepare('SELECT (SELECT COUNT(*) FROM audit) a,(SELECT COUNT(*) FROM mutation_keys) m,(SELECT COUNT(*) FROM followup_notifications) n').get();
 f.db.prepare=query=>{sql.push(query);return original(query);};const summary=await myWorkSummary(f.db,f.viewer,{projectId:'project-a'});
 assert.equal(sql.length,6);assert.ok(sql.every(q=>/^(SELECT|WITH)\b/.test(q)));assert.ok(sql.every(q=>!q.includes('t.title')&&!q.includes('t.body')&&!q.includes('display_name')&&!q.includes('profile')));assert.ok(new TextEncoder().encode(JSON.stringify(summary)).length<900);
 assert.deepEqual(f.native.prepare('SELECT (SELECT COUNT(*) FROM audit) a,(SELECT COUNT(*) FROM mutation_keys) m,(SELECT COUNT(*) FROM followup_notifications) n').get(),before);
});


test('aggregate totals stay complete beyond the six-row page and the response remains bounded',async t=>{
 const f=await fixture(t);for(let index=0;index<180;index++)await f.act('owner-a','task.create',{projectId:'project-a',title:'Private synthetic title '+index,body:'PRIVATE_BODY_CANARY '.repeat(20),status:index%9===0?'completed':'open',priority:'medium',userIds:['viewer-a'],teamIds:[f.a,f.a2]});
 const start=performance.now(),summary=await myWorkSummary(f.db,f.viewer,{projectId:'project-a'}),elapsedMs=performance.now()-start;
 const full=await myWork(f.db,f.viewer,{projectId:'project-a',limit:6});assert.equal(full.tasks.items.length,6);assert.equal(summary.tasks.total,182);assert.equal(summary.tasks.pending,full.totals.tasks.pending);assert.equal(summary.responsibilities.active,full.totals.responsibilities.total);
 const bytes=Buffer.byteLength(JSON.stringify(summary));assert.ok(bytes<900);assert.doesNotMatch(JSON.stringify(summary),/PRIVATE_BODY_CANARY|synthetic title/);t.diagnostic(JSON.stringify({benchmark:'personal-summary-two-strong-snapshots',tasks:182,sqlStatements:6,bytes,elapsedMs:Number(elapsedMs.toFixed(2)),writes:0,limitation:'synthetic in-process SQLite; no production or network timing'}));
});


test('HTTP summary derives identity from the session, refuses extra fields and keeps both success/error private',async t=>{
 const f=await fixture(t);globalThis.__personalSummaryQA={db:f.db,user:f.users['viewer-a']};t.after(()=>delete globalThis.__personalSummaryQA);
 let source=readFileSync(new URL('../app/api/my-work/summary/route.ts',import.meta.url),'utf8').replace(/import\s*\{database\}[^;]+;/,'const database=()=>globalThis.__personalSummaryQA.db;').replace(/import\s*\{getPortalUser\}[^;]+;/,'const getPortalUser=async()=>globalThis.__personalSummaryQA.user;');
 source=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from (['"])@\/([^'"]+)\1/g,(_m,_q,file)=>`from ${JSON.stringify(compile(file+'.ts'))}`);
 const route=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));assert.equal(route.POST,undefined);
 for(const [query,status] of [['?projectId=project-a',200],['?projectId=project-a&userId=owner-a',400],['?projectId=project-b',403],['?status=all',400]]){
  const response=await route.GET(new Request('http://127.0.0.1:5193/api/my-work/summary'+query));assert.equal(response.status,status);assert.match(response.headers.get('Cache-Control'),/private, no-store/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');if(status===200){const data=await response.json();assert.equal(data.viewerId,'viewer-a');assert.equal(isMyWorkSummary(data),true);}
 }
 globalThis.__personalSummaryQA.user=null;const denied=await route.GET(new Request('http://127.0.0.1:5193/api/my-work/summary'));assert.equal(denied.status,401);assert.match(denied.headers.get('Cache-Control'),/private, no-store/);
});
