import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// The real route module runs against the real service, errors, JSON bounding and rate limiter
// over migrated SQLite. Only platform/session wiring is substituted. Synthetic data only.
const code=ts.transpileModule(readFileSync(new URL('../app/api/campaign-planning/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const modules={'@/lib/errors':await import(compile('lib/errors.ts')),'@/lib/http':await import(compile('lib/http.ts')),'@/lib/rate-limit':await import(compile('lib/rate-limit.ts')),'@/lib/campaign-planning/service':await import(compile('lib/campaign-planning/service.ts'))};
const ORIGIN='https://portal.invalid',URL_BASE=`${ORIGIN}/api/campaign-planning`;
function fixture(t){
 const f=teamFixture(t);let calls=0,current='owner-a';
 f.insert('portal_users',{user_id:'host-manager',email:'host-manager@example.invalid',status:'active',created_at:f.now,updated_at:f.now});
 f.insert('members',{id:'member-host-manager',user_id:'host-manager',email:'host-manager@example.invalid',role:'manager',project_id:'project-a2',organization_id:'org-a',created_at:f.now});
 f.users['host-manager']={userId:'host-manager',email:'host-manager@example.invalid',displayName:'host-manager'};
 f.insert('campaigns',{id:'campaign-a',project_id:'project-a',name:'Ação sintética reservada',starts_at:'2026-11-10T12:00:00.000Z',ends_at:'2026-11-12T21:00:00.000Z',created_at:f.now});
 const mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,URL,Response,require:name=>modules[name]??(name==='@/lib/platform'?{database:()=>{calls++;return f.db;}}:name==='@/lib/session'?{getPortalUser:async()=>current?f.users[current]:null}:name==='@/lib/access'?{getActor:modules.access.getActor}:{})});
 return{...f,route:mod.exports,calls:()=>calls,as:who=>{current=who;}};
}
modules.access=await import(compile('lib/access.ts'));
const headers={Origin:ORIGIN,'Content-Type':'application/json','X-Proex-Action':'1'};
const post=(f,body,extra={})=>f.route.POST(new Request(URL_BASE,{method:'POST',headers:{...headers,...extra},body:typeof body==='string'?body:JSON.stringify(body)}));
const session=(extra={})=>({action:'session.save',campaignId:'campaign-a',projectId:'project-a',expectedVersion:0,operationKey:'route-operation-01',sessionDate:'2026-11-10',ordinal:1,label:'Manhã',startsAt:null,endsAt:null,...extra});

test('POST requires exact same-origin JSON and the action header before any storage access; every response is private',async t=>{
 for(const bad of [{Origin:'https://other.invalid'},{Origin:null},{'X-Proex-Action':'0'},{'Content-Type':'text/plain'}]){
  const f=fixture(t),h={...headers,...bad};for(const [k,v] of Object.entries(h))if(v===null)delete h[k];
  const response=await f.route.POST(new Request(URL_BASE,{method:'POST',headers:h,body:'{}'}));
  assert.equal(response.status,403);assert.equal(f.calls(),0);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 }
 const f=fixture(t),large=await post(f,JSON.stringify({padding:'x'.repeat(17*1024)}));assert.equal(large.status,413);assert.equal(f.calls(),0);
 assert.equal((await post(f,'[1]')).status,400);
});

test('GET validates the query before storage, performs no writes and denies host-only and anonymous readers without metadata',async t=>{
 for(const query of ['','campaignId=a&unexpected=x','campaignId=a&campaignId=b','campaignId=a&projectId=x&projectId=y']){const f=fixture(t),response=await f.route.GET(new Request(`${URL_BASE}?${query}`));assert.equal(response.status,400);assert.equal(f.calls(),0);}
 const f=fixture(t),changes=f.native.prepare('SELECT total_changes() n').get().n;
 const ok=await f.route.GET(new Request(`${URL_BASE}?campaignId=campaign-a&projectId=project-a`));assert.equal(ok.status,200);assert.equal(ok.headers.get('Cache-Control'),'private, no-store');
 const body=await ok.json();assert.equal(body.version,0);assert.equal(body.primaryProjectId,'project-a');assert.deepEqual(body.sessions,[]);
 for(let i=0;i<70;i++)await f.route.GET(new Request(`${URL_BASE}?campaignId=campaign-a`));
 assert.equal(f.native.prepare('SELECT total_changes() n').get().n,changes);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM portal_rate_limits').get().n,0);
 f.as('host-manager');const denied=await f.route.GET(new Request(`${URL_BASE}?campaignId=campaign-a`));assert.equal(denied.status,403);assert.doesNotMatch(await denied.text(),/reservada|project-a|Aurora/);
 f.as(null);assert.equal((await f.route.GET(new Request(`${URL_BASE}?campaignId=campaign-a`))).status,401);
});

test('POST end to end: create, lost-reply replay, changed payload, stale CAS, tentative/confirmed rules and rate limit',async t=>{
 const f=fixture(t);
 const created=await post(f,session());assert.equal(created.status,200);const receipt=await created.json();assert.equal(receipt.version,1);assert.equal(receipt.duplicate,false);
 const replay=await(await post(f,session())).json();assert.equal(replay.duplicate,true);assert.equal(replay.entityId,receipt.entityId);
 const changed=await post(f,session({label:'Outra'}));assert.equal(changed.status,409);assert.equal((await changed.json()).code,'operation_changed');
 const stale=await post(f,session({operationKey:'route-operation-02',ordinal:2}));assert.equal(stale.status,409);assert.equal((await stale.json()).code,'planning_conflict');
 const confirmed=await post(f,session({operationKey:'route-operation-03',expectedVersion:1,ordinal:2,status:'confirmed'}));assert.equal(confirmed.status,400);
 f.as('host-manager');assert.equal((await post(f,session({operationKey:'route-operation-04',expectedVersion:1,ordinal:3}))).status,403);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_sessions').get().n,1);
 f.as('owner-a');
 // Invalid, replayed and conflicting attempts write nothing, so only the one applied action was counted.
 for(let i=0;i<60;i++)assert.equal((await post(f,{})).status,400);
 const bucket=createHash('sha256').update('campaign-planning:owner-a').digest('hex');
 assert.equal(f.native.prepare('SELECT count n FROM portal_rate_limits WHERE bucket_key=?').get(bucket).n,1);
 f.native.prepare('UPDATE portal_rate_limits SET count=60 WHERE bucket_key=?').run(bucket);
 const changes=f.native.prepare('SELECT total_changes() n').get().n;
 const last=await post(f,session({operationKey:'route-operation-05',expectedVersion:1,ordinal:5}));assert.equal(last.status,429);
 assert.equal(f.native.prepare('SELECT total_changes() n').get().n,changes,'a full bucket refuses with reads only');
 const body=await last.json();assert.equal(body.code,'rate_limited');assert.doesNotMatch(JSON.stringify(body),/owner-a|@example/);
});
