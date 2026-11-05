import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,nativeFixture} from './support/traffic-fixture.mjs';

const cache=new Map(),load=file=>import(compile(file,new Map(),cache));
const {DEFAULT_ASSISTANT_CONFIG,newAssistantConfig,validateConfig}=await load('lib/assistant/contracts.ts');
const {assistantStatus,configureAssistant,manageAssistantGrant,loadAssistantSettings}=await load('lib/assistant/settings.ts');
const {prepareAssistantPlan,applyAssistantPlan}=await load('lib/assistant/service.ts');
const {transcribeSpeech}=await load('lib/assistant/speech.ts');
const {interpretDocument}=await load('lib/importer/assistant.ts');
const {parseImportDocument}=await load('lib/importer/parse.ts');
const {prepareTaskTriage,applyTaskTriage,taskTriageAvailable}=await load('lib/follow-up/triage.ts');
const {followupAction}=await load('lib/follow-up/service.ts');
const secret='synthetic-usage-policy-session-secret-no-real-access',key='synthetic-usage-policy-provider-key';
const project='project-fixture',org='org_proex';
const usageDenied=error=>error?.code==='assistant_usage_forbidden';
const authorityDenied=error=>['assistant_usage_forbidden','assistant_forbidden','speech_forbidden','triage_stale','document_ai_forbidden'].includes(error?.code);

async function fixture(t,scope='organization') {
 const f=nativeFixture();t.after(()=>f.close());
 const owner=f.owner(),now=new Date().toISOString();
 f.native.prepare("INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at)VALUES('operator','operator@example.invalid','active',0,?,?)").run(now,now);
 f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at)VALUES('operator-member','operator','operator@example.invalid','manager',?,?,?)").run(project,org,now);
 const operator={userId:'operator',email:'operator@example.invalid',displayName:'Synthetic operator',members:[],capabilities:[]};
 f.native.prepare("INSERT INTO items(id,project_id,name,category,unit,created_at,updated_at)VALUES('usage-item',?,'Caneta','consumption','unidade',?,?)").run(project,now,now);
 await configureAssistant(f.db,owner,{organizationId:org,expectedRevision:0,config:{...DEFAULT_ASSISTANT_CONFIG,enabled:true,documentEnabled:true,jevEnabled:true,sttEnabled:true,sttProvider:'deepgram',usageScope:scope},deepseekKey:key,typesafeKey:key,deepgramKey:key},secret);
 const task=(await followupAction(f.db,owner,'task.create',{organizationId:org,projectId:project,title:'Conferir material',operationKey:crypto.randomUUID()})).task;
 const originalPrepare=f.db.prepare.bind(f.db),originalBatch=f.db.batch.bind(f.db);
 let afterRead=null,beforeBatch=null;
 function decorate(statement,sql){
  statement.sql=sql;const bind=statement.bind.bind(statement),first=statement.first.bind(statement);
  statement.bind=(...values)=>decorate(bind(...values),sql);
  statement.first=async(...args)=>{const value=await first(...args);if(afterRead?.pattern.test(sql)){const callback=afterRead.callback;afterRead=null;callback();}return value;};
  return statement;
 }
 f.db.prepare=sql=>decorate(originalPrepare(sql),sql);
 f.db.batch=async statements=>{if(beforeBatch&&statements.some(s=>beforeBatch.pattern.test(s.sql))){const callback=beforeBatch.callback;beforeBatch=null;callback();}return originalBatch(statements);};
 return {...f,owner,operator,task,afterRead(pattern,callback){afterRead={pattern,callback};},beforeBatch(pattern,callback){beforeBatch={pattern,callback};}};
}
function policy(f,user='operator',scope='private',revision=false){f.native.prepare(`UPDATE ai_organization_settings SET config_json=json_set(config_json,'$.usageScope',?,'$.usageUserId',?),revision=revision+? WHERE organization_id=?`).run(scope,scope==='private'?user:null,Number(revision),org);}
const operation=()=>({projectId:project,request:'Consultar caneta para a oficina.',consent:true,operationKey:crypto.randomUUID()});
const speechInput=()=>({projectId:project,expectedProvider:'deepgram',consent:true,operationKey:crypto.randomUUID(),mime:'audio/wav',bytes:wave()});
const triageInput=f=>({id:f.task.id,expectedVersion:f.task.version,context:'Conferir material antes do evento de amanhã.',consent:true,operationKey:crypto.randomUUID()});
const documentContext={organizationId:org,projectId:project,itemId:null,kind:'project'};
const documentInput=()=>({content:'Nome: Projeto sintético',format:'text',base:parseImportDocument('project','Nome: Projeto sintético','text')[0],consent:true,operationKey:crypto.randomUUID()});
function wave(){const bytes=new Uint8Array(44+32000),view=new DataView(bytes.buffer);for(const[from,value]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])bytes.set(new TextEncoder().encode(value),from);for(const[from,value]of [[4,bytes.length-8],[16,16],[24,16000],[28,32000],[40,32000]])view.setUint32(from,value,true);for(const[from,value]of [[20,1],[22,1],[32,2],[34,16]])view.setUint16(from,value,true);for(let i=44;i<bytes.length;i+=2)view.setInt16(i,1000*Math.sin(i*.1),true);return bytes;}
function fake(hook){let calls=0;return{get calls(){return calls;},fetcher:async(url,init)=>{calls++;await hook?.();const body=String(url).includes('deepgram')?null:JSON.parse(init.body);if(String(url).includes('typesafe')){const answer=choice=>({type:'choice',choice,confidence:.99,probabilities:{[choice]:.99}});return Response.json({model:'jev-1.14.0',usage:{input_tokens:100},answers:body.questions.urgency?{urgency:answer('high'),importance:answer('medium')}:{faithful:answer('supported')}});}if(String(url).includes('deepgram'))return Response.json({metadata:{duration:1,model_info:{synthetic:{arch:'nova-3',version:'synthetic'}}},results:{channels:[{alternatives:[{transcript:'Consultar caneta.'}]}]}});const proposal=body.messages[0].content.includes('documental')?{fields:[{key:'name',value:'Projeto sintético',quote:'Nome: Projeto sintético'}]}:{intent:'stock.query',itemId:'usage-item',quantity:0,title:'Consultar caneta',body:'Consulta do saldo',evidence:[{source:'request',quote:'Consultar caneta'}]};return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(proposal)}}],usage:{prompt_tokens:100,completion_tokens:100}});}};}

test('new defaults are private and off while absent policy in legacy JSON remains organization-scoped',async t=>{
 assert.equal(newAssistantConfig('owner').usageScope,'private');assert.equal(newAssistantConfig('owner').usageUserId,'owner');
 for(const field of ['enabled','documentEnabled','jevEnabled','sttEnabled'])assert.equal(newAssistantConfig('owner')[field],false);
 const legacy={...DEFAULT_ASSISTANT_CONFIG};delete legacy.usageScope;delete legacy.usageUserId;
 assert.equal(validateConfig(legacy).usageScope,'organization');assert.equal(validateConfig(legacy).usageUserId,null);
 const f=await fixture(t);f.native.prepare("UPDATE ai_organization_settings SET config_json=json_remove(config_json,'$.usageScope','$.usageUserId')").run();
 assert.equal((await loadAssistantSettings(f.db,secret,org,false,undefined,f.operator.userId)).config.usageScope,'organization');
 assert.equal((await assistantStatus(f.db,f.operator,secret,org)).organizations[0].canUseAi,true);
});

test('first configuration without policy stays private to its caller and cannot assign another user',async t=>{
 const f=nativeFixture();t.after(()=>f.close());const owner=f.owner();
 const config={...DEFAULT_ASSISTANT_CONFIG};delete config.usageScope;delete config.usageUserId;
 const initial=await assistantStatus(f.db,owner,secret,org);assert.equal(initial.config.usageScope,'private');assert.equal(initial.config.enabled,false);
 await configureAssistant(f.db,owner,{organizationId:org,expectedRevision:0,config},secret);
 let saved=JSON.parse(f.native.prepare('SELECT config_json FROM ai_organization_settings').get().config_json);assert.equal(saved.usageUserId,owner.userId);
 await configureAssistant(f.db,owner,{organizationId:org,expectedRevision:1,config:{...saved,usageUserId:'someone-else'}},secret);
 saved=JSON.parse(f.native.prepare('SELECT config_json FROM ai_organization_settings').get().config_json);assert.equal(saved.usageUserId,owner.userId);
 await configureAssistant(f.db,owner,{organizationId:org,expectedRevision:2,config:{...saved,usageScope:'organization',usageUserId:'someone-else'}},secret);
 assert.equal(JSON.parse(f.native.prepare('SELECT config_json FROM ai_organization_settings').get().config_json).usageUserId,null);
});

test('private usage is enforced for text, speech, documents and triage without reserving or sending data',async t=>{
 const f=await fixture(t,'private'),provider=fake();
 await assert.rejects(prepareAssistantPlan(f.db,f.operator,operation(),secret,{fetcher:provider.fetcher}),usageDenied);
 await assert.rejects(transcribeSpeech(f.db,f.operator,speechInput(),secret,{fetcher:provider.fetcher}),usageDenied);
 await assert.rejects(interpretDocument(f.db,f.operator,documentContext,documentInput(),secret,{fetcher:provider.fetcher}),usageDenied);
 await assert.rejects(prepareTaskTriage(f.db,f.operator,triageInput(f),secret,{fetcher:provider.fetcher}),usageDenied);
 assert.equal(await taskTriageAvailable(f.db,f.operator,f.task.id),false);assert.equal(provider.calls,0);
 for(const table of ['ai_calls','ai_transcriptions','ai_document_calls','ai_task_triage_calls','ai_organization_usage'])assert.equal(f.native.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
});

test('the selected private user can use all four capabilities through the normal scoped services',async t=>{
 const f=await fixture(t,'private'),provider=fake();
 assert.equal((await prepareAssistantPlan(f.db,f.owner,operation(),secret,{fetcher:provider.fetcher})).plan.proposal.intent,'stock.query');
 assert.equal((await transcribeSpeech(f.db,f.owner,speechInput(),secret,{fetcher:provider.fetcher})).transcript,'Consultar caneta.');
 assert.equal((await interpretDocument(f.db,f.owner,documentContext,documentInput(),secret,{fetcher:provider.fetcher})).candidate.fields.name,'Projeto sintético');
 assert.equal((await prepareTaskTriage(f.db,f.owner,triageInput(f),secret,{fetcher:provider.fetcher})).status,'ready');
 assert.equal(await taskTriageAvailable(f.db,f.owner,f.task.id),true);
 assert.equal(f.native.prepare('SELECT count(*) n FROM stock_movements').get().n,0);
});

test('a configuration grant permits administration and diagnostics but does not grant private inference',async t=>{
 const f=await fixture(t,'private');await manageAssistantGrant(f.db,f.owner,{action:'grant.create',organizationId:org,userId:f.operator.userId});
 const status=await assistantStatus(f.db,f.operator,secret,org);assert.equal(status.canConfigure,true);assert.equal(status.available,false);assert.equal(status.organizations[0].canUseAi,false);assert.equal(status.organizations[0].usageIsMine,false);
 const provider=fake();await assert.rejects(prepareAssistantPlan(f.db,f.operator,operation(),secret,{fetcher:provider.fetcher}),usageDenied);assert.equal(provider.calls,0);
 await configureAssistant(f.db,f.operator,{organizationId:org,expectedRevision:1,config:{...status.config,usageScope:'private',usageUserId:f.owner.userId}},secret);
 const stored=JSON.parse(f.native.prepare('SELECT config_json FROM ai_organization_settings').get().config_json);assert.equal(stored.usageUserId,f.operator.userId);
 await assert.rejects(prepareAssistantPlan(f.db,f.owner,operation(),secret,{fetcher:provider.fetcher}),usageDenied);
});

test('private policy in organization A neither grants nor blocks independently authorized organization B',async t=>{
 const f=await fixture(t,'private'),now=new Date().toISOString();
 f.native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at)VALUES('org-b','Org B','org-b',?,?)").run(now,now);
 f.native.prepare("INSERT INTO projects(id,name,organization_id,created_at)VALUES('project-b','Project B','org-b',?)").run(now);
 f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at)VALUES('operator-b','operator','operator@example.invalid','manager',NULL,'org-b',?)").run(now);
 await configureAssistant(f.db,f.owner,{organizationId:'org-b',expectedRevision:0,config:{...DEFAULT_ASSISTANT_CONFIG,enabled:true},deepseekKey:key},secret);
 assert.equal((await loadAssistantSettings(f.db,secret,'org-b',false,undefined,f.operator.userId)).config.usageScope,'organization');
 await assert.rejects(loadAssistantSettings(f.db,secret,org,false,undefined,f.operator.userId),usageDenied);
 let calls=0;
 await assert.rejects(prepareAssistantPlan(f.db,f.operator,{...operation(),projectId:'project-b'},secret,{fetcher:async()=>{calls++;return Response.json({error:'synthetic unavailable'},{status:503});}}),error=>error?.code==='assistant_provider_unavailable');
 assert.equal(calls,1);assert.equal(f.native.prepare("SELECT calls FROM ai_organization_usage WHERE organization_id='org-b'").get().calls,1);
 assert.equal(f.native.prepare("SELECT count(*) n FROM ai_organization_usage WHERE organization_id=?").get(org).n,0);
});

test('a live policy change during credential decryption prevents text, speech, document and triage admission',async t=>{
 for(const capability of ['text','speech','document','triage']){
  const f=await fixture(t),provider=fake(),decrypt=crypto.subtle.decrypt;let once=true;
  crypto.subtle.decrypt=async function(...args){const result=await decrypt.apply(this,args);if(once){once=false;policy(f);}return result;};
  try{const attempt=capability==='text'?()=>prepareAssistantPlan(f.db,f.owner,operation(),secret,{fetcher:provider.fetcher}):capability==='speech'?()=>transcribeSpeech(f.db,f.owner,speechInput(),secret,{fetcher:provider.fetcher}):capability==='document'?()=>interpretDocument(f.db,f.owner,documentContext,documentInput(),secret,{fetcher:provider.fetcher}):()=>prepareTaskTriage(f.db,f.owner,triageInput(f),secret,{fetcher:provider.fetcher});await assert.rejects(attempt(),usageDenied);assert.equal(provider.calls,0);assert.equal(f.native.prepare('SELECT count(*) n FROM ai_organization_usage').get().n,0);}finally{crypto.subtle.decrypt=decrypt;}
 }
});

test('SQL reservation and dispatch fences enforce policy even without a revision bump',async t=>{
 for(const point of ['reserve','dispatch']){
  const f=await fixture(t),provider=fake();
  if(point==='reserve')f.beforeBatch(/INSERT INTO ai_calls/,()=>policy(f));
  else{let settingsReads=0;const observe=()=>{if(++settingsReads===2)policy(f);else f.afterRead(/^SELECT s\.\*/,observe);};f.afterRead(/^SELECT s\.\*/,observe);}
  await assert.rejects(prepareAssistantPlan(f.db,f.owner,operation(),secret,{fetcher:provider.fetcher}),authorityDenied);assert.equal(provider.calls,0);
 }
});

test('provider reply cannot be committed or returned after usage becomes private to someone else',async t=>{
 for(const capability of ['text','speech','document','triage']){
  const f=await fixture(t),provider=fake(()=>policy(f));
  const attempt=capability==='text'?()=>prepareAssistantPlan(f.db,f.owner,operation(),secret,{fetcher:provider.fetcher}):capability==='speech'?()=>transcribeSpeech(f.db,f.owner,speechInput(),secret,{fetcher:provider.fetcher}):capability==='document'?()=>interpretDocument(f.db,f.owner,documentContext,documentInput(),secret,{fetcher:provider.fetcher}):()=>prepareTaskTriage(f.db,f.owner,triageInput(f),secret,{fetcher:provider.fetcher});
  await assert.rejects(attempt(),authorityDenied);assert.equal(provider.calls,1);
  assert.equal(f.native.prepare('SELECT count(*) n FROM ai_plans').get().n,0);
  assert.equal(f.native.prepare("SELECT count(*) n FROM ai_transcriptions WHERE result_ciphertext IS NOT NULL").get().n,0);
  assert.equal(f.native.prepare("SELECT count(*) n FROM ai_document_calls WHERE result_ciphertext IS NOT NULL").get().n,0);
  assert.equal(f.native.prepare("SELECT count(*) n FROM ai_task_triage_calls WHERE proposal_json IS NOT NULL").get().n,0);
 }
});

test('all four commit transactions recheck the policy after the provider reply and decryption waits',async t=>{
 for(const capability of ['text','speech','document','triage']){
  const f=await fixture(t),provider=fake();
  const pattern=capability==='text'?/INSERT INTO ai_plans/:capability==='speech'?/UPDATE ai_transcriptions SET status='complete'/:capability==='document'?/UPDATE ai_document_calls SET status='complete'/:/UPDATE ai_task_triage_calls SET status=/;
  f.beforeBatch(pattern,()=>policy(f));
  const attempt=capability==='text'?()=>prepareAssistantPlan(f.db,f.owner,operation(),secret,{fetcher:provider.fetcher}):capability==='speech'?()=>transcribeSpeech(f.db,f.owner,speechInput(),secret,{fetcher:provider.fetcher}):capability==='document'?()=>interpretDocument(f.db,f.owner,documentContext,documentInput(),secret,{fetcher:provider.fetcher}):()=>prepareTaskTriage(f.db,f.owner,triageInput(f),secret,{fetcher:provider.fetcher});
  await assert.rejects(attempt(),authorityDenied);
  assert.equal(f.native.prepare('SELECT count(*) n FROM ai_plans').get().n,0);
  assert.equal(f.native.prepare('SELECT count(*) n FROM ai_transcriptions WHERE result_ciphertext IS NOT NULL').get().n,0);
  assert.equal(f.native.prepare('SELECT count(*) n FROM ai_document_calls WHERE result_ciphertext IS NOT NULL').get().n,0);
  assert.equal(f.native.prepare('SELECT count(*) n FROM ai_task_triage_calls WHERE proposal_json IS NOT NULL').get().n,0);
 }
});

test('saved text and triage proposals cannot be applied or replayed after a policy change',async t=>{
 const f=await fixture(t),provider=fake(),input=operation();
 const preview=await prepareAssistantPlan(f.db,f.owner,input,secret,{fetcher:provider.fetcher});
 const triage=await prepareTaskTriage(f.db,f.owner,triageInput(f),secret,{fetcher:provider.fetcher});policy(f);
 await assert.rejects(applyAssistantPlan(f.db,f.owner,{planToken:preview.planToken,confirmed:true},secret),usageDenied);
 await assert.rejects(prepareAssistantPlan(f.db,f.owner,input,secret,{fetcher:provider.fetcher}),usageDenied);
 await assert.rejects(applyTaskTriage(f.db,f.owner,{id:f.task.id,expectedVersion:f.task.version,proposalId:triage.proposalId,confirmed:true}),authorityDenied);
 assert.equal(f.native.prepare('SELECT version FROM followup_tasks WHERE id=?').get(f.task.id).version,1);
});

test('atomic text and triage apply fences close a policy change after initial validation',async t=>{
 for(const capability of ['text','triage']){
  const f=await fixture(t),provider=fake();
  if(capability==='text'){
   const preview=await prepareAssistantPlan(f.db,f.owner,operation(),secret,{fetcher:provider.fetcher});f.beforeBatch(/UPDATE ai_plans SET status='applied'/,()=>policy(f));
   await assert.rejects(applyAssistantPlan(f.db,f.owner,{planToken:preview.planToken,confirmed:true},secret),authorityDenied);assert.equal(f.native.prepare('SELECT status FROM ai_plans').get().status,'ready');
  }else{
   const preview=await prepareTaskTriage(f.db,f.owner,triageInput(f),secret,{fetcher:provider.fetcher});f.beforeBatch(/UPDATE ai_task_triage_calls SET status='applied'/,()=>policy(f));
   await assert.rejects(applyTaskTriage(f.db,f.owner,{id:f.task.id,expectedVersion:f.task.version,proposalId:preview.proposalId,confirmed:true}),authorityDenied);assert.equal(f.native.prepare('SELECT version FROM followup_tasks WHERE id=?').get(f.task.id).version,1);
  }
 }
});

test('a private usage change in the physical stock transaction rolls back the movement and preserves the plan',async t=>{
 const f=await fixture(t),provider=fake(),request={...operation(),request:'Registrar entrada de 10 canetas.'};
 const fetcher=async(url,init)=>{const response=await provider.fetcher(url,init);if(String(url).includes('typesafe'))return response;return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({intent:'stock.receive',itemId:'usage-item',quantity:10,title:'Entrada de canetas',body:'Canetas conferidas',evidence:[{source:'request',quote:'entrada de 10 canetas'}]})}}],usage:{prompt_tokens:100,completion_tokens:100}});};
 const preview=await prepareAssistantPlan(f.db,f.owner,request,secret,{fetcher});
 f.beforeBatch(/INSERT INTO stock_movements/,()=>policy(f));
 await assert.rejects(applyAssistantPlan(f.db,f.owner,{planToken:preview.planToken,confirmed:true},secret),authorityDenied);
 assert.equal(f.native.prepare('SELECT count(*) n FROM stock_movements').get().n,0);
 assert.equal(f.native.prepare("SELECT stock FROM items WHERE id='usage-item'").get().stock,0);
 assert.equal(f.native.prepare('SELECT status FROM ai_plans').get().status,'ready');
});
