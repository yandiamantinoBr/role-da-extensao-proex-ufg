import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// On the Node target every commit rewrites the whole SQLite snapshot. The per-person rate count of
// these routes must ride in the action's own batch: one commit per allowed action, none when refused.
// Real routes, services, rate limiter and migrated SQLite; only platform/session wiring is replaced.
const shared={'@/lib/errors':await import(compile('lib/errors.ts')),'@/lib/http':await import(compile('lib/http.ts')),'@/lib/rate-limit':await import(compile('lib/rate-limit.ts')),'@/lib/access':await import(compile('lib/access.ts'))};
const services={
 'prize-tiers':{'@/lib/prize-tiers/service':await import(compile('lib/prize-tiers/service.ts'))},
 'campaign-planning':{'@/lib/campaign-planning/service':await import(compile('lib/campaign-planning/service.ts'))},
 'follow-up/transfer':{'@/lib/follow-up/transfer':await import(compile('lib/follow-up/transfer.ts'))},
};
const ORIGIN='https://portal.invalid',headers={Origin:ORIGIN,'Content-Type':'application/json','X-Proex-Action':'1'};

/** Counts operations that changed rows, like the snapshot uploader would (tests/support/traffic-fixture.mjs). */
function countCommits(f){
 const stats={commits:0},total=()=>Number(f.native.prepare('SELECT total_changes() n').get().n);
 const counted=async task=>{const before=total(),result=await task();if(total()!==before)stats.commits++;return result;};
 const prepare=f.db.prepare.bind(f.db),batch=f.db.batch.bind(f.db);
 f.db.prepare=sql=>{const statement=prepare(sql);for(const method of ['first','all','run']){const original=statement[method].bind(statement);statement[method]=(...args)=>counted(()=>original(...args));}return statement;};
 f.db.batch=statements=>counted(()=>batch(statements));
 return stats;
}
function route(t,name,setup=()=>{}){
 const f=teamFixture(t);let current='owner-a';const extra=setup(f)??{};
 const code=ts.transpileModule(readFileSync(new URL(`../app/api/${name}/route.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const modules={...shared,...services[name]},mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,URL,Response,require:dependency=>modules[dependency]??(dependency==='@/lib/platform'?{database:()=>f.db}:dependency==='@/lib/session'?{getPortalUser:async()=>current?f.users[current]:null}:{})});
 const post=body=>mod.exports.POST(new Request(`${ORIGIN}/api/${name}`,{method:'POST',headers,body:JSON.stringify(body)}));
 const bucket=prefix=>createHash('sha256').update(`${prefix}:owner-a`).digest('hex');
 const rateCount=prefix=>f.native.prepare('SELECT count n FROM portal_rate_limits WHERE bucket_key=?').get(bucket(prefix))?.n??0;
 return{...f,...extra,post,bucket,rateCount};
}
const campaign=f=>f.insert('campaigns',{id:'campaign-a',project_id:'project-a',name:'Dinâmica sintética',starts_at:'2026-11-10T12:00:00.000Z',ends_at:'2026-11-13T21:00:00.000Z',created_at:f.now});
const prizeSetup=f=>{campaign(f);
 f.insert('items',{id:'item-a',project_id:'project-a',name:'Pasta sintética',category:'gift',unit:'unidade',created_at:f.now});
 f.insert('offers',{id:'offer-a',project_id:'project-a',name:'Pasta transparente',kind:'super'});f.insert('offer_components',{offer_id:'offer-a',item_id:'item-a',quantity:1});};
const tier=(extra={})=>({action:'tier.set',campaignId:'campaign-a',expectedVersion:0,offerId:'offer-a',tier:'super_super',operationKey:'batch-tier-01',...extra});
const session=(extra={})=>({action:'session.save',campaignId:'campaign-a',projectId:'project-a',expectedVersion:0,operationKey:'batch-session-01',sessionDate:'2026-11-10',ordinal:1,label:'Manhã',startsAt:null,endsAt:null,...extra});

test('prize tiers: an allowed action is one commit that holds both the change and the rate count',async t=>{
 const f=route(t,'prize-tiers',prizeSetup),stats=countCommits(f);
 const first=await f.post(tier());assert.equal(first.status,200);assert.equal((await first.json()).version,1);
 assert.equal(stats.commits,1);assert.equal(f.rateCount('prize-tiers'),1);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_prize_history').get().n,1);
 const second=await f.post(tier({operationKey:'batch-tier-02',expectedVersion:1,tier:'super'}));assert.equal(second.status,200);
 assert.equal(stats.commits,2);assert.equal(f.rateCount('prize-tiers'),2);
 // A replay or a stale version writes nothing and is not counted.
 assert.equal((await (await f.post(tier())).json()).duplicate,true);
 assert.equal((await f.post(tier({operationKey:'batch-tier-03',tier:'brinde'}))).status,409);
 assert.equal(stats.commits,2);assert.equal(f.rateCount('prize-tiers'),2);
});

test('campaign planning: an allowed action is one commit that holds both the change and the rate count',async t=>{
 const f=route(t,'campaign-planning',campaign),stats=countCommits(f);
 const created=await f.post(session());assert.equal(created.status,200);assert.equal((await created.json()).version,1);
 assert.equal(stats.commits,1);assert.equal(f.rateCount('campaign-planning'),1);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_sessions').get().n,1);
 assert.equal((await f.post(session({operationKey:'batch-session-02',expectedVersion:1,ordinal:2}))).status,200);
 assert.equal(stats.commits,2);assert.equal(f.rateCount('campaign-planning'),2);
});

test('demand transfer: an allowed transfer is one commit that holds both the move and the rate count',async t=>{
 const f=route(t,'follow-up/transfer');
 const task=await f.act('owner-a','task.create',{projectId:'project-a',title:'Separar brindes',priority:'medium',userIds:['viewer-a']});
 const stats=countCommits(f),move={taskId:task.task.id,targetProjectId:'project-a2',expectedVersion:1,reason:'Criada no projeto errado.',operationKey:'batch-transfer-01',confirmed:true};
 const moved=await f.post(move);assert.equal(moved.status,200);assert.equal((await moved.json()).version,2);
 assert.equal(stats.commits,1);assert.equal(f.rateCount('followup-transfer'),1);
 assert.equal(f.native.prepare('SELECT project_id FROM followup_tasks WHERE id=?').get(task.task.id).project_id,'project-a2');
});

test('a full bucket refuses before the action with reads only, and the bucket recovers after the window',async t=>{
 const f=route(t,'prize-tiers',prizeSetup),stats=countCommits(f),now=Date.now();
 t.mock.method(Date,'now',()=>now);
 f.native.prepare('INSERT INTO portal_rate_limits(bucket_key,count,reset_at) VALUES(?,60,?)').run(f.bucket('prize-tiers'),now+60000);
 for(let i=0;i<5;i++){const refused=await f.post(tier({operationKey:`batch-full-${i}`}));assert.equal(refused.status,429);assert.equal((await refused.json()).code,'rate_limited');}
 assert.equal(stats.commits,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_prize_history').get().n,0);
 t.mock.method(Date,'now',()=>now+60000);
 assert.equal((await f.post(tier({operationKey:'batch-full-ok'}))).status,200);
 assert.equal(stats.commits,1);assert.equal(f.rateCount('prize-tiers'),1);
});

test('a bucket filled by a concurrent request between the check and the commit rolls the whole action back',async t=>{
 const f=route(t,'campaign-planning',campaign),stats=countCommits(f);
 // The pre-check reads 0; a parallel request then fills the bucket before this batch commits.
 f.db.afterRead=sql=>{if(sql.includes('FROM portal_rate_limits WHERE reset_at>?')){f.db.afterRead=null;f.native.prepare('INSERT INTO portal_rate_limits(bucket_key,count,reset_at) VALUES(?,60,?)').run(f.bucket('campaign-planning'),Date.now()+60000);}};
 const raced=await f.post(session());assert.equal(raced.status,429);assert.equal((await raced.json()).code,'rate_limited');
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_sessions').get().n,0);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_planning').get().n,0);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,0);
 // The only counted commit is the simulated concurrent request's own write.
 assert.equal(f.rateCount('campaign-planning'),60);assert.equal(stats.commits,1);
});
