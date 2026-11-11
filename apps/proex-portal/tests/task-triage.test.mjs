import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {compile,nativeFixture,root} from './support/traffic-fixture.mjs';

const {prepareTaskTriage,applyTaskTriage,taskTriageAvailable,taskTriageState,triageReserveMicros}=await import(compile('lib/follow-up/triage.ts'));
const {TRIAGE_CURRENCY}=await import(compile('lib/follow-up/triage-contract.ts'));
const {followupAction}=await import(compile('lib/follow-up/service.ts'));
const {configureAssistant}=await import(compile('lib/assistant/settings.ts'));
const {prepareAssistantPlan}=await import(compile('lib/assistant/service.ts'));
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
  ...(config.enabled===false?{}:{deepseekKey:'synthetic-only-text-provider'}),typesafeKey:key},secret);
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
 for(const fragment of ['Contato: fake@example.invalid','Abrir https://example.invalid','Chave pxs_synthetic_only_not_a_key',
  'pxm_synthetic_only_not_a_key','pxp_synthetic_only_not_a_key','pxt_synthetic_only_not_a_key','gsk_synthetic_only_not_a_key',
  'Telefone (62) 99999-8888','Telefone (62) 9 9999-9999','Documento 123 456 789 09','Documento 12.345.678/0001-99',
  'Acesse sigaa.example.test/consulta','Use ftp://example.invalid/registro']){
  await assert.rejects(prepare(f,source,prepareInput(f,{context:fragment})),{code:'triage_sensitive'});
 }
 assert.equal(source.calls.length,0);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_task_triage_calls').get().n,0);
 const input=prepareInput(f,{context:'Conferir o material até 2026-11-04, conforme a demanda CGA-2026-042.'});
 assert.deepEqual(await prepare(f,source,input),{status:'abstained'});
 assert.deepEqual(await prepare(f,source,input),{status:'abstained'});
 assert.equal(source.calls.length,1);
 assert.equal(f.native.prepare('SELECT importance FROM followup_tasks').get().importance,null);
});

test('triage shares the assistant quota and resets at midnight in Brasília',async t=>{
 const f=await fixture(t,{dailyCalls:2}),source=fake();
 const before=Date.parse('2026-11-04T02:59:59.999Z'),after=before+1;
 let textCalls=0;
 await assert.rejects(prepareAssistantPlan(f.db,f.owner,{
  action:'prepare',projectId:'project-fixture',request:'Consultar material para o evento.',consent:true,operationKey:crypto.randomUUID(),
 },secret,{now:before,fetcher:async()=>{
  textCalls++;
  return Response.json({error:'synthetic outage'},{status:503});
 }}),{code:'assistant_provider_unavailable'});
 assert.equal(textCalls,1);
 const triageAt=at=>prepareTaskTriage(f.db,f.owner,prepareInput(f),secret,{now:at,fetcher:source.fetcher});
 await assert.rejects(triageAt(before),{code:'triage_budget'});
 assert.equal(source.calls.length,0);
 assert.equal((await triageAt(after)).status,'ready');
 assert.equal(source.calls[0].body.state.today,'2026-11-04');
 const reservations=f.native.prepare('SELECT day,calls FROM ai_organization_usage ORDER BY day').all();
 assert.deepEqual(reservations.map(row=>({...row})),[{day:'2026-11-03',calls:2},{day:'2026-11-04',calls:1}]);
});

test('triage uses only the opted-in TypeSafe credential and works without a DeepSeek key',async t=>{
 const f=await fixture(t,{enabled:false}),source=fake();
 assert.equal(await taskTriageAvailable(f.db,f.owner,f.task.id),true);
 const proposal=await prepare(f,source);
 assert.equal(proposal.status,'ready');
 assert.equal(source.calls.length,1);
 assert.equal((await apply(f,proposal)).task.importance,'medium');
 await configureAssistant(f.db,f.owner,{organizationId:f.org,expectedRevision:1,config:DEFAULT_ASSISTANT_CONFIG},secret);
 assert.equal(await taskTriageAvailable(f.db,f.owner,f.task.id),false);
 await assert.rejects(prepare(f,source,prepareInput(f,{expectedVersion:2})),{code:'triage_disabled'});
 assert.equal(source.calls.length,1);
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

// Triagem roteada: com decisionModel escolhido, a mesma regra da conferência (dados sintéticos, provedor falso).
const {manageCatalog,catalogView,catalogSettingName}=await import(compile('lib/assistant/model-catalog-store.ts'));
const routedKey='synthetic-only-perplexity-credential', ROUTED='https://api.perplexity.ai/v1/systemone', STANDARD='https://api.typesafe.ai/v1/systemone';
// Nome que o aviso e a autorização mostram para o modelo escolhido; a tela devolve esse nome ao pedir a triagem.
const ROUTED_NAME='Decider v1.2 (Perplexity)';
async function routedFixture(t) {
 const f=await fixture(t),keys={current:'synthetic-only-dedicated-triage-routing-key'};
 await migrateAssistantCredentials(f.db,f.owner,{},secret,keys);
 const stamp=(await catalogView(f.db,f.owner,f.org,secret,keys)).stamp;
 await manageCatalog(f.db,f.owner,{organizationId:f.org,expected:stamp,action:'key.save',providerId:'perplexity',label:'Chave sintética',secret:routedKey},secret,keys);
 const revision=f.native.prepare('SELECT revision FROM ai_organization_settings WHERE organization_id=?').get(f.org).revision;
 await configureAssistant(f.db,f.owner,{organizationId:f.org,expectedRevision:revision,config:{...DEFAULT_ASSISTANT_CONFIG,enabled:true,jevEnabled:true,decisionModel:'perplexity-decider-v1-2'}},secret,undefined,keys);
 const calls=[],answer=(choice)=>({type:'choice',choice,confidence:0.97,probabilities:{[choice]:0.97}});
 const source=chosen=>async (endpoint,init)=>{
  const body=JSON.parse(init.body); calls.push({endpoint,model:body.model,auth:init.headers.Authorization});
  if(endpoint===ROUTED){const early=await chosen(); if(early)return early;}
  return Response.json({model:body.model,usage:{input_tokens:420},answers:{urgency:answer('high'),importance:answer('medium')}});
 };
 const triage=(chosen,shown={destinationName:ROUTED_NAME})=>prepareTaskTriage(f.db,f.owner,prepareInput(f,shown),secret,{now,fetcher:source(chosen),keys});
 const fallbacks=()=>f.native.prepare("SELECT details FROM audit WHERE action='assistant.route.fallback'").all().map(row=>JSON.parse(row.details));
 const call=()=>({...f.native.prepare('SELECT status,model,reserved_tokens,reserved_usd_micros,input_tokens FROM ai_task_triage_calls').get()});
 return {...f,keys,calls,triage,fallbacks,call};
}

test('routed triage: the chosen catalog model answers alone and the call row names it',async t=>{
 const f=await routedFixture(t),proposal=await f.triage(()=>null);
 assert.deepEqual(proposal.proposal,{urgency:'high',importance:'medium'});
 assert.deepEqual(f.calls,[{endpoint:ROUTED,model:'pplx-decider-v1.2',auth:'Bearer '+routedKey}]);
 // Reserva pelo maior preço (o do padrão, 0,042): os mesmos 173 de sempre.
 assert.deepEqual(f.call(),{status:'ready',model:'pplx-decider-v1.2',reserved_tokens:4096,reserved_usd_micros:173,input_tokens:420});
 assert.deepEqual(f.fallbacks(),[]);
});

test('routed triage: a refusal falls back once with an audit line; a timeout never reaches a second provider',async t=>{
 const refused=await routedFixture(t);
 const proposal=await refused.triage(()=>new Response('{}',{status:429,headers:{'content-type':'application/json'}}));
 assert.equal(proposal.status,'ready');
 assert.deepEqual(refused.calls,[{endpoint:ROUTED,model:'pplx-decider-v1.2',auth:'Bearer '+routedKey},{endpoint:STANDARD,model:'jev-1.14.0',auth:'Bearer '+key}]);
 assert.deepEqual(refused.fallbacks(),[{task:'decision',model:'perplexity-decider-v1-2',name:ROUTED_NAME,reason:'O serviço recusou o pedido (código 429).'}]);
 assert.deepEqual(refused.call(),{status:'ready',model:'jev-1.14.0',reserved_tokens:4096,reserved_usd_micros:173,input_tokens:420});

 const doubtful=await routedFixture(t);
 await assert.rejects(doubtful.triage(()=>{throw new DOMException('synthetic timeout','TimeoutError');}));
 assert.deepEqual(doubtful.calls.map(call=>call.endpoint),[ROUTED]);
 assert.deepEqual(doubtful.fallbacks(),[]);
 assert.equal(doubtful.call().status,'failed');

 // Status 500 ou 503 não é recusa certa (o serviço pode ter processado): sem segunda chamada.
 for(const status of [408,500,503]){
  const unsure=await routedFixture(t);
  await assert.rejects(unsure.triage(()=>new Response('{}',{status,headers:{'content-type':'application/json'}})));
  assert.deepEqual(unsure.calls.map(call=>call.endpoint),[ROUTED],String(status));
  assert.deepEqual(unsure.fallbacks(),[]);
  assert.equal(unsure.call().status,'failed');
 }
});

test('routed triage: the chosen model may answer with a version suffix; the default path still requires the exact name',async t=>{
 const reply=model=>Response.json({model,usage:{input_tokens:420},answers:{urgency:{type:'choice',choice:'high',confidence:0.97,probabilities:{high:0.97}},importance:{type:'choice',choice:'medium',confidence:0.97,probabilities:{medium:0.97}}}});
 for(const suffix of ['-20261101','+build7']){
  const f=await routedFixture(t),proposal=await f.triage(()=>reply('pplx-decider-v1.2'+suffix));
  assert.deepEqual(proposal.proposal,{urgency:'high',importance:'medium'},suffix);
  assert.deepEqual(f.calls.map(call=>call.endpoint),[ROUTED]);
  assert.equal(f.call().model,'pplx-decider-v1.2','the call row keeps the catalog model name');
 }
 // Outro modelo (ou prefixo sem separador) continua recusado, sem segunda chamada.
 for(const other of ['pplx-decider-v1.20','synthetic-other-model']){
  const f=await routedFixture(t);
  await assert.rejects(f.triage(()=>reply(other)),error=>error?.code==='triage_provider_schema');
  assert.deepEqual(f.calls.map(call=>call.endpoint),[ROUTED]);
 }
 // Padrão (sem modelo escolhido): só o nome exato, como sempre.
 const plain=await fixture(t);
 await assert.rejects(prepareTaskTriage(plain.db,plain.owner,prepareInput(plain),secret,{now,fetcher:async()=>reply('jev-1.14.0-20261101')}),error=>error?.code==='triage_provider_schema');
});

// Teto mostrado na tela da triagem = reserva feita pelo servidor, com e sem modelo de decisão escolhido.
async function triageStatus(t,f,keys) {
 const fixtures=new Map([
  [resolve(root,'lib/platform.ts'),"export function database(){return globalThis.__triageTest.db;} export function inviteSecret(){return globalThis.__triageTest.secret;} export function taskTriageEnabled(){return true;} export function assistantCredentialKeys(){return globalThis.__triageTest.keys;}"],
  [resolve(root,'lib/session.ts'),"export async function getPortalUser(){return globalThis.__triageTest.owner;}"],
 ]);
 globalThis.__triageTest={...f,secret,keys};
 t.after(()=>delete globalThis.__triageTest);
 const route=await import(compile('app/api/follow-up/triage/route.ts',fixtures));
 return async()=>(await route.GET(new Request('https://portal.example.invalid/api/follow-up/triage?id='+encodeURIComponent(f.task.id)))).json();
}
test('triage ceiling: without a chosen decision model the screen gets only the availability and the reservation stays the same',async t=>{
 const f=await fixture(t),status=await triageStatus(t,f,undefined);
 assert.equal(triageReserveMicros(),173);
 assert.deepEqual(await taskTriageState(f.db,f.owner,f.task.id,secret),{enabled:true});
 assert.deepEqual(await status(),{enabled:true},'same answer as before the routing existed');
 await prepare(f,fake());
 assert.equal(f.native.prepare('SELECT reserved_usd_micros n FROM ai_task_triage_calls').get().n,173);
});
test('triage ceiling: with a chosen decision model the screen gets exactly what the server reserves',async t=>{
 const f=await routedFixture(t),status=await triageStatus(t,f,f.keys);
 // Escolhido mais barato que o padrão: vale o maior, os mesmos 173.
 assert.deepEqual(await taskTriageState(f.db,f.owner,f.task.id,secret,f.keys),{enabled:true,reserveUsdMicros:173,destinationName:ROUTED_NAME});
 assert.deepEqual(await status(),{enabled:true,reserveUsdMicros:173,destinationName:ROUTED_NAME});
 // Escolhido mais caro (preço sintético gravado direto no catálogo): a tela recebe o teto do escolhido.
 const name=catalogSettingName(f.org),stored=JSON.parse(f.native.prepare('SELECT value FROM settings WHERE name=?').get(name).value);
 f.native.prepare('UPDATE settings SET value=? WHERE name=?').run(JSON.stringify({...stored,models:stored.models.map(model=>model.id==='perplexity-decider-v1-2'?{...model,price:{...model.price,inputPerM:0.5}}:model)}),name);
 const shown=await status();
 assert.deepEqual(shown,{enabled:true,reserveUsdMicros:2048,destinationName:ROUTED_NAME});
 assert.deepEqual(await taskTriageState(f.db,f.owner,f.task.id,secret,f.keys),shown);
 assert.match(TRIAGE_CURRENCY.format(shown.reserveUsdMicros/1_000_000),/^US\$\s0,002048$/,'the text the screen shows');
 await f.triage(()=>null);
 assert.equal(f.call().reserved_usd_micros,shown.reserveUsdMicros,'the server reserved the number the screen showed');
 assert.equal(f.call().model,'pplx-decider-v1.2');
});
test('triage ceiling: a chosen model that cannot answer leaves the number of the default on screen',async t=>{
 const f=await routedFixture(t),status=await triageStatus(t,f,f.keys);
 const name=catalogSettingName(f.org),stored=JSON.parse(f.native.prepare('SELECT value FROM settings WHERE name=?').get(name).value);
 f.native.prepare('UPDATE settings SET value=? WHERE name=?').run(JSON.stringify({...stored,models:stored.models.map(model=>model.id==='perplexity-decider-v1-2'?{...model,enabled:false,price:{...model.price,inputPerM:0.5}}:model)}),name);
 assert.deepEqual(await status(),{enabled:true});
 await f.triage(()=>null);
 assert.equal(f.call().reserved_usd_micros,173);assert.equal(f.call().model,'jev-1.14.0');
});

// Destino da triagem: a autorização vale só para o modelo que a tela mostrou.
test('triage destination: with a chosen model the request must name the model the screen showed, or nothing is sent or reserved',async t=>{
 const f=await routedFixture(t),untouched=()=>({calls:f.calls.length,rows:f.native.prepare('SELECT COUNT(*) n FROM ai_task_triage_calls').get().n,
  usage:f.native.prepare('SELECT COALESCE(SUM(calls),0) calls,COALESCE(SUM(reserved_usd_micros),0) micros,COALESCE(SUM(reserved_tokens),0) tokens FROM ai_organization_usage').get()});
 const before=untouched();
 assert.deepEqual({...before,usage:{...before.usage}},{calls:0,rows:0,usage:{calls:0,micros:0,tokens:0}});
 // Ausente, vazio (a tela mostrou só o padrão), outro modelo, quase igual e valor que não é texto: tudo recusado antes de qualquer envio.
 for(const shown of [{},{destinationName:''},{destinationName:'JEV 1.14 (TypeSafe)'},{destinationName:ROUTED_NAME+' '},{destinationName:ROUTED_NAME.toLowerCase()},{destinationName:7},{destinationName:null}]){
  await assert.rejects(f.triage(()=>null,shown),error=>error.code==='triage_destination'&&error.status===409&&error.message==='O modelo que recebe este resumo mudou. Confira o aviso e autorize de novo.',JSON.stringify(shown));
  assert.deepEqual(untouched(),before,'no provider call, no call row and no reservation: '+JSON.stringify(shown));
 }
 assert.deepEqual(f.fallbacks(),[]);
 // Com o nome que o servidor informou, segue: uma chamada, ao modelo escolhido.
 const proposal=await f.triage(()=>null,{destinationName:(await taskTriageState(f.db,f.owner,f.task.id,secret,f.keys)).destinationName});
 assert.equal(proposal.status,'ready');
 assert.deepEqual(f.calls,[{endpoint:ROUTED,model:'pplx-decider-v1.2',auth:'Bearer '+routedKey}]);
 assert.equal(f.call().reserved_usd_micros,173);
});
test('triage destination: without a chosen model, or with one that cannot answer, the field is ignored and the default path is unchanged',async t=>{
 // Sem modelo escolhido: qualquer valor (ou nenhum) dá a mesma chamada ao padrão.
 const plain=await fixture(t);
 assert.deepEqual(await taskTriageState(plain.db,plain.owner,plain.task.id,secret),{enabled:true});
 const bodies=[];
 for(const shown of [{},{destinationName:''},{destinationName:ROUTED_NAME},{destinationName:7}]){
  const source=fake(),proposal=await prepare(plain,source,prepareInput(plain,shown));
  assert.equal(proposal.status,'ready',JSON.stringify(shown));assert.equal(source.calls.length,1);bodies.push(JSON.stringify(source.calls[0].body));
 }
 assert.equal(new Set(bodies).size,1,'the provider receives the same body whatever the field says');
 assert.deepEqual(plain.native.prepare('SELECT DISTINCT reserved_usd_micros n,model FROM ai_task_triage_calls').all().map(row=>({...row})),[{n:173,model:'jev-1.14.0'}]);
 // Modelo escolhido que não pode responder (desligado no catálogo): não há destino novo para nomear.
 const off=await routedFixture(t),name=catalogSettingName(off.org),stored=JSON.parse(off.native.prepare('SELECT value FROM settings WHERE name=?').get(name).value);
 off.native.prepare('UPDATE settings SET value=? WHERE name=?').run(JSON.stringify({...stored,models:stored.models.map(model=>model.id==='perplexity-decider-v1-2'?{...model,enabled:false}:model)}),name);
 assert.deepEqual(await taskTriageState(off.db,off.owner,off.task.id,secret,off.keys),{enabled:true});
 assert.equal((await off.triage(()=>null,{})).status,'ready');
 assert.deepEqual(off.calls.map(call=>call.endpoint),[STANDARD]);
});
