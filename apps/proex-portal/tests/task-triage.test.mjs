import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {compile,nativeFixture,root} from './support/traffic-fixture.mjs';

const {prepareTaskTriage,applyTaskTriage}=await import(compile('lib/follow-up/triage.ts'));
const {followupAction}=await import(compile('lib/follow-up/service.ts'));
const {configureAssistant}=await import(compile('lib/assistant/settings.ts'));
const {migrateAssistantCredentials}=await import(compile('lib/assistant/credential-migration.ts'));
const {DEFAULT_ASSISTANT_CONFIG}=await import(compile('lib/assistant/contracts.ts'));
const key='synthetic-only-typesafe-credential', secret='test-only-triage-session-secret-at-least-32';
const now=Date.parse('2026-11-04T02:30:00Z');
async function fixture(t,config={}) {
 const f=nativeFixture();
 t.after(()=>f.close());
 const owner=f.owner();
 const org=f.native.prepare("SELECT organization_id FROM projects WHERE id='project-fixture'").get().organization_id;
 await configureAssistant(f.db,owner,{organizationId:org,expectedRevision:0,
  config:{...DEFAULT_ASSISTANT_CONFIG,enabled:true,jevEnabled:true,...config},
  deepseekKey:'synthetic-only-text-provider',typesafeKey:key},secret);
 const created=await followupAction(f.db,owner,'task.create',{
  action:'task.create',organizationId:org,projectId:'project-fixture',title:'Título que o provedor não recebe',
  body:'Detalhe interno protegido',dueAt:'2026-11-04',operationKey:crypto.randomUUID(),
 });
 return {...f,owner,org,task:created.task};
}
const context='É necessário conferir o material antes do evento de amanhã. Sem a conferência, a abertura não pode ocorrer.';
const prepareInput=(f,extra={})=>({id:f.task.id,expectedVersion:f.task.version,context,consent:true,operationKey:crypto.randomUUID(),...extra});
function fake(overrides={},hook) {
 const calls=[];
 const fetcher=async (endpoint,init)=>{
  calls.push({endpoint,body:JSON.parse(init.body)});
  assert.equal(endpoint,'https://api.typesafe.ai/v1/systemone');
  assert.equal(init.headers.Authorization,'Bearer '+key);
  assert.equal(init.redirect,'error');
  await hook?.();
  const answer=(choice,confidence=0.97,probability=0.97)=>({type:'choice',choice,confidence,probabilities:{[choice]:probability}});
  return Response.json({model:'jev-1.14.0',usage:{input_tokens:420},answers:{urgency:answer('high'),importance:answer('medium')},...overrides});
 };
 return {fetcher,calls};
}
const prepare=(f,source,input=prepareInput(f),actor=f.owner)=>prepareTaskTriage(f.db,actor,input,secret,{now,fetcher:source.fetcher});
const apply=(f,proposal,extra={},actor=f.owner,at=now)=>applyTaskTriage(f.db,actor,
 {action:'task.triage.apply',id:f.task.id,expectedVersion:f.task.version,proposalId:proposal.proposalId,confirmed:true,...extra},at);

test('triage sends only the opted-in context, produces no mutation until confirmation and audits a single CAS write',async t=>{
 const f=await fixture(t),source=fake(),input=prepareInput(f);
 assert.equal(f.task.importance,null);
 const proposal=await prepare(f,source,input);
 assert.deepEqual(proposal.proposal,{urgency:'high',importance:'medium'});
 assert.equal(source.calls.length,1);
 assert.deepEqual(source.calls[0].body.state,{summary:context,dueDate:'2026-11-04',today:'2026-11-03'});
 assert.equal(f.native.prepare('SELECT priority,importance,version FROM followup_tasks WHERE id=?').get(f.task.id).importance,null);
 assert.deepEqual(await prepare(f,source,input),proposal);
 assert.equal(source.calls.length,1);
 await assert.rejects(apply(f,proposal,{confirmed:false}),{code:'triage_confirmation'});
 const saved=await apply(f,proposal);
 assert.equal(saved.task.priority,'high');
 assert.equal(saved.task.importance,'medium');
 assert.equal(saved.task.version,2);
 assert.equal(saved.task.body,'Detalhe interno protegido');
 assert.deepEqual(saved.task.assignees,[]);
 assert.equal(saved.history[0].snapshot.importance,'medium');
 assert.match(saved.history[0].snapshot.progressNote,/confirmada por uma pessoa/);
 assert.equal((await apply(f,proposal)).task.version,2);
 const entries=f.native.prepare("SELECT action,details FROM audit WHERE action LIKE 'task.triage.%' ORDER BY action").all();
 assert.deepEqual(entries.map(row=>row.action),['task.triage.apply','task.triage.prepare']);
 assert.ok(!JSON.stringify(entries).includes(context));
 const usage=f.native.prepare('SELECT status,model,reserved_tokens,reserved_usd_micros,input_tokens FROM ai_task_triage_calls').get();
 assert.deepEqual({...usage},{status:'applied',model:'jev-1.14.0',reserved_tokens:4096,reserved_usd_micros:173,input_tokens:420});
});

test('sensitive or unapproved requests never reserve or dispatch, and an explicit low confidence result abstains',async t=>{
 const f=await fixture(t),source=fake({answers:{
  urgency:{type:'choice',choice:'high',confidence:0.83,probabilities:{high:0.91}},
  importance:{type:'choice',choice:'high',confidence:0.97,probabilities:{high:0.97}},
 }});
 await assert.rejects(prepare(f,source,prepareInput(f,{consent:false})),{code:'triage_consent'});
 for(const fragment of ['Contato: fake@example.invalid','Abrir https://example.invalid','Chave pxs_synthetic_only_not_a_key','Telefone (62) 99999-8888']){
  await assert.rejects(prepare(f,source,prepareInput(f,{context:fragment})),{code:'triage_sensitive'});
 }
 assert.equal(source.calls.length,0);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_task_triage_calls').get().n,0);
 const input=prepareInput(f);
 assert.deepEqual(await prepare(f,source,input),{status:'abstained'});
 assert.deepEqual(await prepare(f,source,input),{status:'abstained'});
 assert.equal(source.calls.length,1);
 assert.equal(f.native.prepare('SELECT importance FROM followup_tasks').get().importance,null);
});

test('budget and concurrent replay admit at most one dispatch, plus authorization fences before result and apply',async t=>{
 const f=await fixture(t,{dailyCalls:1}),source=fake(),input=prepareInput(f);
 const results=await Promise.allSettled([prepare(f,source,input),prepare(f,source,input)]);
 const proposal=results.find(item=>item.status==='fulfilled').value;
 assert.equal(proposal.status,'ready');
 assert.equal(source.calls.length,1);
 await assert.rejects(prepare(f,source),{code:'triage_budget'});
 const other={...f.owner,userId:'not-a-member'};
 await assert.rejects(prepare(f,source,prepareInput(f),other),{code:'triage_forbidden'});
 await assert.rejects(apply(f,proposal,{},other),{code:'triage_forbidden'});
 await assert.rejects(apply(f,proposal,{},f.owner,now+11*60000),{code:'triage_stale'});
 f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id=?").run(new Date(now).toISOString(),f.owner.userId);
 await assert.rejects(apply(f,proposal),{code:'triage_forbidden'});
 assert.equal(f.native.prepare('SELECT importance FROM followup_tasks').get().importance,null);
});

test('a changed task or config prevents application; the manual path remains usable and preserves legacy null',async t=>{
 const f=await fixture(t),source=fake();
 const proposal=await prepare(f,source);
 const manual=await followupAction(f.db,f.owner,'task.update',{
  action:'task.update',id:f.task.id,expectedVersion:1,importance:'low',operationKey:crypto.randomUUID(),
 });
 assert.equal(manual.task.importance,'low');
 await assert.rejects(apply(f,proposal),{code:'triage_stale'});
 const refreshed={...f,task:manual.task};
 const latest=await prepare(refreshed,source);
 f.native.prepare('UPDATE ai_organization_settings SET revision=revision+1 WHERE organization_id=?').run(f.org);
 await assert.rejects(apply(refreshed,latest),{code:'triage_stale'});
 assert.equal(f.native.prepare('SELECT importance FROM followup_tasks').get().importance,'low');
});

test('a revoked actor during dispatch never sees the proposal and the measured reservation is kept',async t=>{
 const f=await fixture(t);
 const source=fake({},()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id=?").run(new Date(now).toISOString(),f.owner.userId));
 await assert.rejects(prepare(f,source),{code:'triage_stale'});
 assert.equal(source.calls.length,1);
 const call=f.native.prepare('SELECT status,input_tokens,proposal_json FROM ai_task_triage_calls').get();
 assert.deepEqual({...call},{status:'failed',input_tokens:420,proposal_json:null});
 assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);
});

test('dedicated v2 credentials work after reciphering through the bridge',async t=>{
 const f=await fixture(t),source=fake(),keys={current:'synthetic-only-dedicated-triage-test-key'};
 const receipt=await migrateAssistantCredentials(f.db,f.owner,{},secret,keys);
 assert.equal(receipt.migrated,1);
 assert.equal(receipt.remaining,0);
 await assert.rejects(prepare(f,source),{code:'assistant_credentials_unavailable'});
 assert.equal(source.calls.length,0);
 const proposal=await prepareTaskTriage(f.db,f.owner,prepareInput(f),secret,{now,fetcher:source.fetcher,keys});
 assert.deepEqual(proposal.proposal,{urgency:'high',importance:'medium'});
 assert.equal(source.calls.length,1);
 assert.equal((await apply(f,proposal)).task.importance,'medium');
});

test('HTTP pilot is off by default and keeps the manual path, CSRF and no-store',async t=>{
 const f=await fixture(t);
 const fixtures=new Map([
  [resolve(root,'lib/platform.ts'),"export function database(){return globalThis.__triageTest.db;} export function inviteSecret(){return globalThis.__triageTest.secret;} export function taskTriageEnabled(){return false;} export function assistantCredentialKeys(){return {};}"],
  [resolve(root,'lib/session.ts'),"export async function getPortalUser(){return globalThis.__triageTest.owner;}"],
 ]);
 globalThis.__triageTest={...f,secret};
 t.after(()=>delete globalThis.__triageTest);
 const route=await import(compile('app/api/follow-up/triage/route.ts',fixtures));
 const url='https://portal.example.invalid/api/follow-up/triage';
 const status=await route.GET(new Request(url+'?id='+encodeURIComponent(f.task.id)));
 assert.deepEqual(await status.json(),{enabled:false});
 assert.equal(status.headers.get('Cache-Control'),'private, no-store');
 const request=(origin)=>new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Proex-Action':'1'},body:JSON.stringify(prepareInput(f))});
 assert.equal((await route.POST(request('https://other.example.invalid'))).status,403);
 assert.equal((await route.POST(request('https://portal.example.invalid'))).status,503);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_task_triage_calls').get().n,0);
});
