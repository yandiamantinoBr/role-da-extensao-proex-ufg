import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// The real route module runs against the real transfer service, errors, JSON bounding and rate
// limiter over fully migrated SQLite. Only platform/session wiring is substituted. Synthetic data only.
const code=ts.transpileModule(readFileSync(new URL('../app/api/follow-up/transfer/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const modules={'@/lib/errors':await import(compile('lib/errors.ts')),'@/lib/http':await import(compile('lib/http.ts')),'@/lib/rate-limit':await import(compile('lib/rate-limit.ts')),'@/lib/follow-up/transfer':await import(compile('lib/follow-up/transfer.ts')),'@/lib/access':await import(compile('lib/access.ts'))};
const ORIGIN='https://portal.invalid',URL_BASE=`${ORIGIN}/api/follow-up/transfer`;
async function fixture(t){
 const f=teamFixture(t);let calls=0,current='owner-a';
 const task=await f.act('owner-a','task.create',{projectId:'project-a',title:'Separar brindes',priority:'medium',userIds:['viewer-a']});
 const mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,URL,Response,require:name=>modules[name]??(name==='@/lib/platform'?{database:()=>{calls++;return f.db;}}:name==='@/lib/session'?{getPortalUser:async()=>current?f.users[current]:null}:{})});
 return{...f,route:mod.exports,calls:()=>calls,as:who=>{current=who;},taskId:task.task.id,count:sql=>f.native.prepare(sql).get().n};
}
const headers={Origin:ORIGIN,'Content-Type':'application/json','X-Proex-Action':'1'};
const post=(f,body,extra={})=>f.route.POST(new Request(URL_BASE,{method:'POST',headers:{...headers,...extra},body:typeof body==='string'?body:JSON.stringify(body)}));
const get=(f,query)=>f.route.GET(new Request(`${URL_BASE}?${query}`));
const move=(f,extra={})=>({taskId:f.taskId,targetProjectId:'project-a2',expectedVersion:1,reason:'Criada no projeto errado.',operationKey:'route-transfer-01',confirmed:true,...extra});

test('POST requires same-origin JSON and the action header before any storage access; size and shape are bounded; every response is private',async t=>{
 for(const bad of [{Origin:'https://other.invalid'},{Origin:null},{'X-Proex-Action':'0'},{'Content-Type':'text/plain'}]){
  const f=await fixture(t),h={...headers,...bad};for(const [k,v] of Object.entries(h))if(v===null)delete h[k];
  const response=await f.route.POST(new Request(URL_BASE,{method:'POST',headers:h,body:'{}'}));
  assert.equal(response.status,403);assert.equal(f.calls(),0);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 }
 const f=await fixture(t);
 assert.equal((await post(f,JSON.stringify({padding:'x'.repeat(17*1024)}))).status,413);assert.equal(f.calls(),0);
 assert.equal((await post(f,'[1]')).status,400);
 assert.equal((await post(f,move(f,{extra:'x'}))).status,400);assert.equal((await post(f,move(f,{confirmed:'true'}))).status,400);
 f.as(null);assert.equal((await post(f,move(f))).status,401);
 assert.equal(f.count('SELECT COUNT(*) n FROM followup_task_transfers'),0);
});

test('GET validates the query before storage, writes nothing and refuses non-managers without leaking names',async t=>{
 for(const query of ['','taskId=a&x=1','taskId=a&taskId=b']){const f=await fixture(t);assert.equal((await get(f,query)).status,400);assert.equal(f.calls(),0);}
 const f=await fixture(t),changes=f.count('SELECT total_changes() n');
 for(let i=0;i<70;i++){const ok=await get(f,`taskId=${f.taskId}`);assert.equal(ok.status,200);assert.equal(ok.headers.get('Cache-Control'),'private, no-store');}
 const body=await(await get(f,`taskId=${f.taskId}`)).json();
 assert.equal(body.viewerId,'owner-a');assert.equal(body.eligible,true);assert.deepEqual(body.candidates.map(c=>c.projectId),['project-a2']);
 assert.equal(f.count('SELECT total_changes() n'),changes);assert.equal(f.count('SELECT COUNT(*) n FROM portal_rate_limits'),0);
 f.as('viewer-a');const denied=await get(f,`taskId=${f.taskId}`);assert.equal(denied.status,403);assert.doesNotMatch(await denied.text(),/Horizonte|project-a2|Pessoa|@example/);
 f.as('worker-b');assert.equal((await get(f,`taskId=${f.taskId}`)).status,404);
 f.as(null);assert.equal((await get(f,`taskId=${f.taskId}`)).status,401);
});

test('POST end to end: minimal receipt, lost-reply replay, changed payload, noop, stale CAS, role refusal and rate limit',async t=>{
 const f=await fixture(t);
 f.as('other-a2');assert.equal((await post(f,move(f,{operationKey:'route-transfer-inv'}))).status,404);
 f.as('owner-a');
 const first=await post(f,move(f));assert.equal(first.status,200);const receipt=await first.json();
 assert.deepEqual(receipt,{viewerId:'owner-a',taskId:f.taskId,projectId:'project-a2',version:2,duplicate:false});
 assert.deepEqual(await(await post(f,move(f))).json(),{...receipt,duplicate:true});
 const changed=await post(f,move(f,{reason:'Outro motivo.'}));assert.equal(changed.status,409);assert.equal((await changed.json()).code,'operation_changed');
 const noop=await post(f,move(f,{operationKey:'route-transfer-02',expectedVersion:2}));assert.equal(noop.status,409);assert.equal((await noop.json()).code,'followup_transfer_noop');
 const stale=await post(f,move(f,{operationKey:'route-transfer-03',targetProjectId:'project-a'}));assert.equal(stale.status,409);assert.equal((await stale.json()).code,'followup_conflict');
 assert.equal(f.count('SELECT COUNT(*) n FROM followup_task_transfers'),1);assert.equal(f.count('SELECT version n FROM followup_tasks'),2);
 // Invalid, replayed and refused attempts write nothing, so only the one applied transfer was counted.
 for(let i=0;i<60;i++)assert.equal((await post(f,{})).status,400);
 const bucket=createHash('sha256').update('followup-transfer:owner-a').digest('hex');
 assert.equal(f.count(`SELECT count n FROM portal_rate_limits WHERE bucket_key='${bucket}'`),1);
 f.native.prepare('UPDATE portal_rate_limits SET count=60 WHERE bucket_key=?').run(bucket);
 const changes=f.count('SELECT total_changes() n');
 const last=await post(f,move(f,{operationKey:'route-transfer-05',targetProjectId:'project-a',expectedVersion:2}));assert.equal(last.status,429);
 assert.equal(f.count('SELECT total_changes() n'),changes,'a full bucket refuses with reads only');
 const body=await last.json();assert.equal(body.code,'rate_limited');assert.doesNotMatch(JSON.stringify(body),/owner-a|@example/);
});
