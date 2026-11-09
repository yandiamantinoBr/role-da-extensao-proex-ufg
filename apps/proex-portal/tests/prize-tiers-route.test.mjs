import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// The real route module over the real service and migrated SQLite; only platform/session wiring is substituted.
const code=ts.transpileModule(readFileSync(new URL('../app/api/prize-tiers/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const modules={'@/lib/errors':await import(compile('lib/errors.ts')),'@/lib/http':await import(compile('lib/http.ts')),'@/lib/rate-limit':await import(compile('lib/rate-limit.ts')),'@/lib/prize-tiers/service':await import(compile('lib/prize-tiers/service.ts')),'@/lib/access':await import(compile('lib/access.ts'))};
const ORIGIN='https://portal.invalid',URL_BASE=`${ORIGIN}/api/prize-tiers`;
function fixture(t){
 const f=teamFixture(t);let calls=0,current='owner-a';
 f.insert('campaigns',{id:'campaign-a',project_id:'project-a',name:'Dinâmica sintética reservada',starts_at:'2026-11-10T12:00:00.000Z',ends_at:'2026-11-13T21:00:00.000Z',created_at:f.now});
 f.insert('items',{id:'item-a',project_id:'project-a',name:'Pasta sintética',category:'gift',unit:'unidade',created_at:f.now});
 f.insert('offers',{id:'offer-a',project_id:'project-a',name:'Pasta transparente',kind:'super'});f.insert('offer_components',{offer_id:'offer-a',item_id:'item-a',quantity:1});
 const mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,URL,Response,require:name=>modules[name]??(name==='@/lib/platform'?{database:()=>{calls++;return f.db;}}:name==='@/lib/session'?{getPortalUser:async()=>current?f.users[current]:null}:{})});
 return{...f,route:mod.exports,calls:()=>calls,as:who=>{current=who;}};
}
const headers={Origin:ORIGIN,'Content-Type':'application/json','X-Proex-Action':'1'};
const post=(f,body,extra={})=>f.route.POST(new Request(URL_BASE,{method:'POST',headers:{...headers,...extra},body:typeof body==='string'?body:JSON.stringify(body)}));
const move=(extra={})=>({action:'tier.set',campaignId:'campaign-a',expectedVersion:0,offerId:'offer-a',tier:'super_super',operationKey:'route-tier-01',...extra});

test('POST requires same-origin JSON with the action header before any storage access; responses are private',async t=>{
 for(const bad of [{Origin:'https://other.invalid'},{'X-Proex-Action':'0'},{'Content-Type':'text/plain'}]){
  const f=fixture(t),response=await post(f,move(),bad);assert.equal(response.status,403);assert.equal(f.calls(),0);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 }
 const f=fixture(t);assert.equal((await post(f,JSON.stringify({padding:'x'.repeat(17*1024)}))).status,413);assert.equal(f.calls(),0);
});

test('GET validates the query, writes nothing and hides the dynamic from other organizations and anonymous users',async t=>{
 for(const query of ['','campaignId=a&x=1','campaignId=a&campaignId=b']){const f=fixture(t);assert.equal((await f.route.GET(new Request(`${URL_BASE}?${query}`))).status,400);assert.equal(f.calls(),0);}
 const f=fixture(t),changes=f.native.prepare('SELECT total_changes() n').get().n;
 const ok=await f.route.GET(new Request(`${URL_BASE}?campaignId=campaign-a`));assert.equal(ok.status,200);const body=await ok.json();
 assert.equal(body.version,0);assert.equal(body.superSuperPercent,25);assert.equal(body.options[0].name,'Pasta transparente');
 assert.equal(f.native.prepare('SELECT total_changes() n').get().n,changes);
 f.as('owner-b');const denied=await f.route.GET(new Request(`${URL_BASE}?campaignId=campaign-a`));assert.equal(denied.status,403);assert.doesNotMatch(await denied.text(),/reservada|Pasta|project-a/);
 f.as(null);assert.equal((await f.route.GET(new Request(`${URL_BASE}?campaignId=campaign-a`))).status,401);
});

test('POST end to end: move, replay, stale version and a viewer refused',async t=>{
 const f=fixture(t);
 const first=await post(f,move());assert.equal(first.status,200);assert.equal((await first.json()).version,1);
 const replay=await post(f,move());assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
 assert.equal((await post(f,move({operationKey:'route-tier-02',tier:'super'}))).status,409);
 f.as('viewer-a');assert.equal((await post(f,move({operationKey:'route-tier-03',expectedVersion:1,tier:'super'}))).status,403);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_prize_history').get().n,1);
});
