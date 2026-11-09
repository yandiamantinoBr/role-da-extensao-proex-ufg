import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {compile,nativeFixture,root} from './support/traffic-fixture.mjs';

const cache=new Map(),load=file=>import(compile(file,new Map(),cache));
const {DEFAULT_ASSISTANT_CONFIG,PROVIDERS,validateConfig}=await load('lib/assistant/contracts.ts');
const {configureAssistant}=await load('lib/assistant/settings.ts');
const {assistantCredentialVault,manageAssistantCredential}=await load('lib/assistant/credential-vault.ts');
const {decryptProviderCredentials,encryptProviderCredentials}=await load('lib/assistant/crypto.ts');
const {prepareAssistantPlan,applyAssistantPlan}=await load('lib/assistant/service.ts');
const {generationBody,providerGenerationBody,generateProposal,providerEndpoint}=await load('lib/assistant/provider.ts');
const {openAiGenerationBody,generateOpenAiJson}=await load('lib/assistant/openai-provider.ts');
const {aiReservation}=await load('lib/assistant/admission.ts');
const {testAssistantConnection}=await load('lib/assistant/connection.ts');
const {probeConnection,connectionEndpoint}=await load('lib/assistant/connection-provider.ts');
const {interpretDocument}=await load('lib/importer/assistant.ts');
const {previewImport,applyImport}=await load('lib/importer/service.ts');
const {parseImportDocument}=await load('lib/importer/parse.ts');
const secret='synthetic-openai-auth-secret-at-least-thirty-two-bytes';
const keys={current:'synthetic-openai-dedicated-vault-secret-at-least-thirty-two'};
const providerKey='sk-synthetic-openai-provider-key-only-for-unit-tests';
const projectId='project-fixture',organizationId='org_proex';
const providers=['deepseek','typesafe','deepgram','groq','openai'];
const code=name=>error=>error?.code===name;
const denied=error=>[401,403,409,503].includes(error?.status);
const query=()=>({projectId,request:'Registrar entrada de 10 canetas para a oficina.',operationKey:crypto.randomUUID(),consent:true});
const proposal=(changes={})=>({intent:'stock.receive',itemId:'openai-item',quantity:10,title:'Entrada de canetas',body:'Canetas conferidas pela equipe',evidence:[{source:'request',quote:'entrada de 10 canetas'}],...changes});
function response(value=proposal(),changes={}){return{object:'response',model:'gpt-5.6-luna',status:'completed',error:null,incomplete_details:null,output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200},...changes};}
function fake({value=proposal(),changes={},hook,expectedKey=providerKey}={}){const requests=[];return{requests,fetcher:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.headers.Authorization,'Bearer '+expectedKey);assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.method,'POST');assert.ok(init.signal);await hook?.();return Response.json(response(value,changes));}};}

async function fixture(t){
 const f=nativeFixture();t.after(()=>f.close());const owner=f.owner(),now=new Date().toISOString();
 f.native.prepare("INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at)VALUES('openai-operator','openai-operator@example.invalid','active',0,?,?)").run(now,now);
 f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at)VALUES('openai-member','openai-operator','openai-operator@example.invalid','inventory',?,?,?)").run(projectId,organizationId,now);
 f.native.prepare("INSERT INTO items(id,project_id,name,category,unit,created_at,updated_at)VALUES('openai-item',?,'Caneta sintética','consumption','unidade',?,?)").run(projectId,now,now);
 const operator={userId:'openai-operator',email:'openai-operator@example.invalid',displayName:'Operador sintético',members:[],capabilities:[]};
 const revision=(org=organizationId)=>f.native.prepare('SELECT revision FROM ai_organization_settings WHERE organization_id=?').get(org)?.revision??0;
 const save=(provider='openai',value=providerKey,org=organizationId)=>manageAssistantCredential(f.db,owner,{action:'save',provider,organizationId:org,label:'Credencial de teste '+provider,secret:value,expectedRevision:revision(org)},secret,keys);
 async function configure(changes={},org=organizationId){return configureAssistant(f.db,owner,{action:'configure',organizationId:org,expectedRevision:revision(org),config:{...DEFAULT_ASSISTANT_CONFIG,textProvider:'openai',usageScope:'organization',enabled:true,...changes}},secret,undefined,keys);}
 const originalPrepare=f.db.prepare.bind(f.db),originalBatch=f.db.batch.bind(f.db);let batchHook=null;
 function decorate(statement,sql){const bind=statement.bind.bind(statement);statement.sql=sql;statement.bind=(...args)=>decorate(bind(...args),sql);return statement;}
 f.db.prepare=sql=>decorate(originalPrepare(sql),sql);
 f.db.batch=async statements=>{if(batchHook&&statements.some(s=>batchHook.pattern.test(s.sql))){const action=batchHook.action;batchHook=null;action();}return originalBatch(statements);};
 return{...f,owner,operator,revision,save,configure,beforeBatch(pattern,action){batchHook={pattern,action};}};
}

test('OpenAI body is Responses-only, reviewed model, stateless, no tools/reasoning and strict JSON per capability',()=>{
 const config={...DEFAULT_ASSISTANT_CONFIG,textProvider:'openai'},legacy=generationBody(config,'Consultar estoque.',[]);
 const body=providerGenerationBody(config,legacy);
 assert.deepEqual(body,openAiGenerationBody(config,legacy));assert.equal(body.model,'gpt-5.6-luna');assert.equal(body.store,false);assert.equal(body.stream,false);assert.equal(body.background,false);assert.deepEqual(body.tools,[]);assert.equal(body.tool_choice,'none');assert.equal(body.parallel_tool_calls,false);assert.deepEqual(body.reasoning,{effort:'none'});assert.equal(body.input[0].role,'developer');assert.equal(body.input[1].role,'user');
 assert.equal(body.text.format.strict,true);assert.equal(body.text.format.schema.additionalProperties,false);assert.equal(body.text.format.name,'proex_operation');
 assert.equal(providerGenerationBody(config,legacy,'document').text.format.name,'proex_document');
 assert.equal(providerEndpoint('openai'),'https://api.openai.com/v1/responses');
 for(const bad of ['https://api.openai.com/v1/chat/completions','https://api.openai.com.evil.invalid/v1/responses','http://127.0.0.1/private','https://api.openai.com:8443/v1/responses'])assert.throws(()=>providerEndpoint('openai',bad),code('assistant_endpoint'));
 for(const openaiModel of ['gpt-5','unknown-model','gpt-5.6-luna-preview'])assert.throws(()=>validateConfig({...config,openaiModel}),code('assistant_model'));
 assert.throws(()=>openAiGenerationBody(config,{messages:[{role:'user',content:'missing system'}]}),code('assistant_model'));
});

test('OpenAI parser rejects refusal, tools, incomplete output, unknown model, malformed usage and reflected keys',async()=>{
 const config={...DEFAULT_ASSISTANT_CONFIG,textProvider:'openai'},body=openAiGenerationBody(config,generationBody(config,'Consultar estoque.',[]));
 const variants=[{model:'unreviewed-model'},{object:'chat.completion'},{status:'incomplete'},{incomplete_details:{reason:'max_output_tokens'}},{error:{message:'synthetic rejection'}},{output:[]},{output:[{type:'function_call',name:'do_anything',arguments:'{}'}]},{output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'No.'}]}]},{output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{}'},{type:'output_text',text:'{}'}]}]},{output:[{type:'message',role:'user',status:'completed',content:[{type:'output_text',text:'{}'}]}]},{usage:{input_tokens:-1,output_tokens:100,total_tokens:99}},{usage:{input_tokens:1.5,output_tokens:100,total_tokens:101.5}},{usage:{input_tokens:100,output_tokens:100,total_tokens:300}},{usage:{input_tokens:100,output_tokens:1201,total_tokens:1301}},{usage:{input_tokens:100,output_tokens:100}},{echo:providerKey}];
 for(const changes of variants)await assert.rejects(generateOpenAiJson(config,providerKey,body,new AbortController().signal,async()=>Response.json(response(proposal(),changes))),code('assistant_provider_schema'));
 for(const property of ['error','incomplete_details'])for(const invalid of [false,0,'',undefined])await assert.rejects(generateOpenAiJson(config,providerKey,body,new AbortController().signal,async()=>Response.json(response(proposal(),{[property]:invalid}))),code('assistant_provider_schema'));
 for(const content of ['{broken',JSON.stringify({apiKey:providerKey})])await assert.rejects(generateOpenAiJson(config,providerKey,body,new AbortController().signal,async()=>Response.json(response(proposal(),{output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:content}]}]}))),code('assistant_provider_schema'));
});

test('OpenAI transport bounds actual bytes/content type, rejects redirect/error/abort, and never retries',async()=>{
 const config={...DEFAULT_ASSISTANT_CONFIG,textProvider:'openai'},body=openAiGenerationBody(config,generationBody(config,'Consultar estoque.',[]));let calls=0;
 const cases=[()=>new Response('',{status:302,headers:{Location:'http://127.0.0.1/private'}}),()=>new Response('<html>no</html>',{headers:{'Content-Type':'text/html'}}),()=>Response.json({error:'synthetic failure'},{status:429}),()=>new Response('{invalid',{headers:{'Content-Type':'application/json'}}),()=>new Response('x'.repeat(128*1024+1),{headers:{'Content-Type':'application/json'}}),()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':String(128*1024+1)}})];
 for(const create of cases)await assert.rejects(generateOpenAiJson(config,providerKey,body,new AbortController().signal,async(_url,init)=>{calls++;assert.equal(init.redirect,'error');return create();}),error=>[502,503].includes(error?.status));
 assert.equal(calls,cases.length);
 const controller=new AbortController();await assert.rejects(generateOpenAiJson(config,providerKey,body,controller.signal,async()=>{calls++;controller.abort();return Response.json(response());}),code('assistant_provider_unavailable'));assert.equal(calls,cases.length+1);
});

test('legacy configuration still routes to DeepSeek and missing explicit OpenAI never falls back',async()=>{
 const config=validateConfig({enabled:true}),body=generationBody(config,'Consultar estoque.',[]);let calls=0;
 assert.equal(config.textProvider,'deepseek');assert.deepEqual(providerGenerationBody(config,body),body);
 const result=await generateProposal(config,{deepseek:'synthetic-deepseek-key',typesafe:''},body,new AbortController().signal,async(url)=>{calls++;assert.equal(url,PROVIDERS.deepseek.endpoint);return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(proposal())}}],usage:{prompt_tokens:100,completion_tokens:100}});});assert.equal(result.returnedModel,'deepseek-flash');
 await assert.rejects(generateProposal({...config,textProvider:'openai'},{deepseek:'synthetic-deepseek-key',typesafe:''},body,new AbortController().signal,async()=>{calls++;return Response.json(response());}),code('assistant_unavailable'));assert.equal(calls,1);
});

test('OpenAI vault roundtrip preserves four existing providers, masks every secret and starts disabled/private',async t=>{
 const f=await fixture(t);
 for(const name of providers)await f.save(name,name==='openai'?providerKey:'synthetic-key-for-'+name);
 const vault=await assistantCredentialVault(f.db,f.owner,organizationId,secret,keys),row=f.native.prepare('SELECT * FROM ai_organization_settings WHERE organization_id=?').get(organizationId);
 assert.equal(vault.keys.length,5);assert.equal(vault.keys.find(e=>e.provider==='openai').status,'active');assert.match(vault.keys.find(e=>e.provider==='openai').mask,/…/);
 const decrypted=await decryptProviderCredentials(secret,row.credentials_ciphertext,organizationId,keys);for(const name of providers)assert.equal(decrypted[name],name==='openai'?providerKey:'synthetic-key-for-'+name);
 const config=JSON.parse(row.config_json);assert.equal(config.usageScope,'private');assert.equal(config.usageUserId,f.owner.userId);for(const name of ['enabled','documentEnabled','jevEnabled','sttEnabled'])assert.equal(config[name],false);
 const exposed=JSON.stringify({vault,audit:f.native.prepare('SELECT details FROM audit').all()});for(const value of [providerKey,keys.current,row.credentials_ciphertext,...providers.filter(p=>p!=='openai').map(p=>'synthetic-key-for-'+p)])assert.equal(exposed.includes(value),false);
 await assert.rejects(manageAssistantCredential(f.db,f.operator,{action:'save',organizationId,provider:'openai',label:'Sem permissão',secret:providerKey,expectedRevision:f.revision()},secret,keys),code('assistant_key_admin'));
 await assert.rejects(manageAssistantCredential(f.db,f.owner,{action:'save',organizationId,provider:'openai',label:'Versão antiga',secret:'synthetic-stale-openai-key',expectedRevision:0},secret,keys),code('assistant_configuration_changed'));
 assert.equal(f.native.prepare('SELECT credentials_ciphertext FROM ai_organization_settings').get().credentials_ciphertext,row.credentials_ciphertext);
});

test('explicit OpenAI prepares once with provenance and confirms through inventory once, never mutating during preview',async t=>{
 const f=await fixture(t);await f.save();await f.configure();const provider=fake(),input=query();
 const preview=await prepareAssistantPlan(f.db,f.operator,input,secret,{keys,fetcher:provider.fetcher});assert.equal(provider.requests.length,1);assert.equal(f.native.prepare('SELECT count(*) n FROM stock_movements').get().n,0);assert.equal(preview.plan.provenance.provider,'openai');assert.equal(preview.plan.provenance.model,'gpt-5.6-luna');assert.equal(preview.plan.provenance.returnedModel,'gpt-5.6-luna');
 await prepareAssistantPlan(f.db,f.operator,input,secret,{keys,fetcher:provider.fetcher});assert.equal(provider.requests.length,1);
 const confirmed=await applyAssistantPlan(f.db,f.operator,{planToken:preview.planToken,confirmed:true},secret,undefined,keys);assert.ok(confirmed.movementId);
 const replay=await applyAssistantPlan(f.db,f.operator,{planToken:preview.planToken,confirmed:true},secret,undefined,keys);assert.equal(replay.replayed,true);
 assert.equal(f.native.prepare('SELECT count(*) n FROM stock_movements').get().n,1);assert.equal(f.native.prepare("SELECT stock FROM items WHERE id='openai-item'").get().stock,10);
 const details=f.native.prepare("SELECT details FROM audit WHERE action='assistant.plan'").get().details;assert.equal(JSON.parse(details).provider,'openai');assert.equal(details.includes(providerKey),false);
});

test('OpenAI admission measures the actual Responses schema/body and uses selected provider integer quota prices',async t=>{
 const f=await fixture(t);await f.save();await f.configure({dailyCalls:1});const provider=fake();await prepareAssistantPlan(f.db,f.operator,query(),secret,{keys,fetcher:provider.fetcher});
 const config=JSON.parse(f.native.prepare('SELECT config_json FROM ai_organization_settings').get().config_json),bytes=new TextEncoder().encode(JSON.stringify(provider.requests[0].body)).byteLength+2048,reservation=aiReservation(config,bytes);
 const usage=f.native.prepare('SELECT * FROM ai_organization_usage').get(),plan=JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='assistant.plan'").get().details);assert.equal(usage.calls,1);
 // The admission reserved the measured ceiling; after a valid reply the day keeps only the confirmed use.
 assert.equal(plan.reservedUsdMicros,Math.ceil(bytes*.25+config.maxOutputTokens*1.2));assert.equal(plan.reservedUsdMicros,reservation.cost);
 assert.equal(usage.reserved_tokens,plan.inputTokens+plan.outputTokens+plan.jevTokens);assert.ok(usage.reserved_tokens<reservation.tokens);
 assert.equal(usage.reserved_usd_micros,Math.ceil(plan.inputTokens*.25+plan.outputTokens*1.2));assert.equal(usage.reserved_usd_micros,plan.usdMicros);assert.ok(usage.reserved_ms<config.timeoutMs);
 await assert.rejects(prepareAssistantPlan(f.db,f.operator,query(),secret,{keys,fetcher:provider.fetcher}),code('assistant_quota'));assert.equal(provider.requests.length,1);
});

test('each OpenAI daily ceiling rejects before transport and unknown failure retains the reservation',async t=>{
 for(const setting of [{dailyUsdMicros:1000},{dailyTokens:1000},{dailyMs:1000}]){const f=await fixture(t);await f.save();await f.configure(setting);const provider=fake();await assert.rejects(prepareAssistantPlan(f.db,f.operator,query(),secret,{keys,fetcher:provider.fetcher}),code('assistant_quota'));assert.equal(provider.requests.length,0);}
 const f=await fixture(t);await f.save();await f.configure();let calls=0;const input=query();const fetcher=async()=>{calls++;throw new Error('synthetic network outage');};await assert.rejects(prepareAssistantPlan(f.db,f.operator,input,secret,{keys,fetcher}),code('assistant_provider_unavailable'));await assert.rejects(prepareAssistantPlan(f.db,f.operator,input,secret,{keys,fetcher}),code('assistant_call_failed'));assert.equal(calls,1);assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);
});

test('private policy, cross-organization scope and separate OpenAI credentials prevent unintended model use',async t=>{
 const f=await fixture(t);await f.save();await f.configure({usageScope:'private'});const deniedProvider=fake();await assert.rejects(prepareAssistantPlan(f.db,f.operator,query(),secret,{keys,fetcher:deniedProvider.fetcher}),code('assistant_usage_forbidden'));assert.equal(deniedProvider.requests.length,0);
 const now=new Date().toISOString(),otherKey='sk-synthetic-openai-organization-b-key';f.native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at)VALUES('openai-org-b','Org B','openai-org-b',?,?)").run(now,now);f.native.prepare("INSERT INTO projects(id,name,organization_id,created_at)VALUES('openai-project-b','Project B','openai-org-b',?)").run(now);
 await f.save('openai',otherKey,'openai-org-b');await f.configure({},'openai-org-b');
 await assert.rejects(prepareAssistantPlan(f.db,f.operator,{...query(),projectId:'openai-project-b'},secret,{keys,fetcher:deniedProvider.fetcher}),denied);
 const provider=fake({expectedKey:otherKey,value:proposal({itemId:'unknown'})});await assert.rejects(prepareAssistantPlan(f.db,f.owner,{...query(),projectId:'openai-project-b'},secret,{keys,fetcher:provider.fetcher}),code('assistant_scope'));assert.equal(provider.requests.length,1);
 assert.equal(f.native.prepare('SELECT count(*) n FROM ai_organization_usage WHERE organization_id=?').get(organizationId).n,0);assert.equal(f.native.prepare("SELECT calls FROM ai_organization_usage WHERE organization_id='openai-org-b'").get().calls,1);
});

test('OpenAI disable/remove never fall back to DeepSeek or enable functions merely by re-enabling a key',async t=>{
 for(const action of ['disable','remove']){const f=await fixture(t);await f.save('deepseek','synthetic-fallback-deepseek-key');await f.save();await f.configure();await manageAssistantCredential(f.db,f.owner,{action,organizationId,provider:'openai',expectedRevision:f.revision()},secret,keys);const provider=fake();await assert.rejects(prepareAssistantPlan(f.db,f.operator,query(),secret,{keys,fetcher:provider.fetcher}),code('assistant_unavailable'));assert.equal(provider.requests.length,0);if(action==='disable'){await manageAssistantCredential(f.db,f.owner,{action:'enable',organizationId,provider:'openai',expectedRevision:f.revision()},secret,keys);assert.equal(JSON.parse(f.native.prepare('SELECT config_json FROM ai_organization_settings').get().config_json).enabled,false);}}
});

test('OpenAI document interpretation uses its own strict schema and selected-provider provenance without saving a domain entity',async t=>{
 const f=await fixture(t);await f.save();await f.configure({documentEnabled:true});const content='Nome: Projeto sintético OpenAI',base=parseImportDocument('project',content,'text')[0],input={content,format:'text',base,consent:true,operationKey:crypto.randomUUID()},provider=fake({value:{fields:[{key:'name',value:'Projeto sintético OpenAI',quote:content}]}});
 const result=await interpretDocument(f.db,f.owner,{organizationId,projectId,itemId:null,kind:'project'},input,secret,{keys,fetcher:provider.fetcher});assert.equal(result.candidate.fields.name,'Projeto sintético OpenAI');assert.equal(result.provenance.provider,'openai');assert.equal(result.provenance.model,'gpt-5.6-luna');assert.equal(provider.requests[0].body.text.format.name,'proex_document');
 await interpretDocument(f.db,f.owner,{organizationId,projectId,itemId:null,kind:'project'},input,secret,{keys,fetcher:provider.fetcher});assert.equal(provider.requests.length,1);assert.equal(f.native.prepare('SELECT name FROM projects WHERE id=?').get(projectId).name,'Synthetic project');assert.equal(f.native.prepare('SELECT count(*) n FROM stock_movements').get().n,0);
});

test('a signed OpenAI document preview applies selected fields once through the normal import service',async t=>{
 const f=await fixture(t);await f.save();await f.configure({documentEnabled:true});const content='Nome: Projeto conferido OpenAI',provider=fake({value:{fields:[{key:'name',value:'Projeto conferido OpenAI',quote:content}]}});
 const preview=await previewImport(f.db,f.owner,{kind:'project',sourceMode:'document',content,format:'text',projectId,useAi:true,aiConsent:true,aiOperationKey:crypto.randomUUID()},secret,provider.fetcher,undefined,keys);
 assert.equal(preview.provenance.ai.provider,'openai');assert.equal(preview.provenance.ai.returnedModel,'gpt-5.6-luna');assert.equal(f.native.prepare('SELECT name FROM projects WHERE id=?').get(projectId).name,'Synthetic project');
 const input={reviewToken:preview.reviewToken,candidateKey:preview.candidates[0].key,selectedFields:['name'],confirmed:true,operationKey:crypto.randomUUID()};
 const result=await applyImport(f.db,f.owner,input,secret);assert.equal(result.projectId,projectId);assert.equal(f.native.prepare('SELECT name FROM projects WHERE id=?').get(projectId).name,'Projeto conferido OpenAI');
 const replay=await applyImport(f.db,f.owner,input,secret);assert.equal(replay.recordId,result.recordId);assert.equal(provider.requests.length,1);assert.equal(f.native.prepare('SELECT count(*) n FROM stock_movements').get().n,0);
});

test('document-only OpenAI and DeepSeek allow preview/replay/apply while operations stay off and disabling documents invalidates pending confirmation',async t=>{
 for(const textProvider of ['openai','deepseek']){
  const f=await fixture(t),key=textProvider==='openai'?providerKey:'synthetic-document-only-deepseek-key';await f.save(textProvider,key);await f.configure({textProvider,enabled:false,documentEnabled:true});
  let calls=0;const name=`Projeto documental ${textProvider}`,content='Nome: '+name;
  const fields={fields:[{key:'name',value:name,quote:content}]};
  const fetcher=async(url,init)=>{calls++;assert.equal(init.headers.Authorization,'Bearer '+key);assert.equal(init.redirect,'error');assert.equal(url,PROVIDERS[textProvider].endpoint);if(textProvider==='openai')return Response.json(response(fields));return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(fields)}}],usage:{prompt_tokens:100,completion_tokens:100}});};
  await assert.rejects(prepareAssistantPlan(f.db,f.owner,query(),secret,{keys,fetcher}),code('assistant_unavailable'));assert.equal(calls,0);
  const input={kind:'project',sourceMode:'document',content,format:'text',projectId,useAi:true,aiConsent:true,aiOperationKey:crypto.randomUUID()};
  const preview=await previewImport(f.db,f.owner,input,secret,fetcher,undefined,keys);assert.equal(preview.provenance.ai.provider,textProvider);assert.equal(f.native.prepare('SELECT name FROM projects WHERE id=?').get(projectId).name,'Synthetic project');
  await previewImport(f.db,f.owner,input,secret,fetcher,undefined,keys);assert.equal(calls,1);
  const confirmation={reviewToken:preview.reviewToken,candidateKey:preview.candidates[0].key,selectedFields:['name'],confirmed:true,operationKey:crypto.randomUUID()};
  const applied=await applyImport(f.db,f.owner,confirmation,secret),replayed=await applyImport(f.db,f.owner,confirmation,secret);assert.equal(applied.recordId,replayed.recordId);assert.equal(f.native.prepare('SELECT name FROM projects WHERE id=?').get(projectId).name,name);assert.equal(calls,1);
  const pending=await previewImport(f.db,f.owner,{...input,aiOperationKey:crypto.randomUUID()},secret,fetcher,undefined,keys),version=f.native.prepare('SELECT version FROM projects WHERE id=?').get(projectId).version;
  await f.configure({textProvider,enabled:false,documentEnabled:false});
  await assert.rejects(applyImport(f.db,f.owner,{reviewToken:pending.reviewToken,candidateKey:pending.candidates[0].key,selectedFields:['name'],confirmed:true,operationKey:crypto.randomUUID()},secret),code('document_ai_forbidden'));
  assert.equal(f.native.prepare('SELECT version FROM projects WHERE id=?').get(projectId).version,version);assert.equal(f.native.prepare('SELECT count(*) n FROM stock_movements').get().n,0);assert.equal(calls,2);
 }
});

test('OpenAI dispatch checks policy after awaited decryption and rejects provider usage exceeding its reservation',async t=>{
 const f=await fixture(t);await f.save();await f.configure();const provider=fake(),decrypt=crypto.subtle.decrypt;let once=true;
 crypto.subtle.decrypt=async function(...args){const value=await decrypt.apply(this,args);if(once){once=false;f.native.prepare("UPDATE ai_organization_settings SET config_json=json_set(config_json,'$.usageScope','private','$.usageUserId',?)").run(f.owner.userId);}return value;};
 try{await assert.rejects(prepareAssistantPlan(f.db,f.operator,query(),secret,{keys,fetcher:provider.fetcher}),code('assistant_usage_forbidden'));assert.equal(provider.requests.length,0);assert.equal(f.native.prepare('SELECT count(*) n FROM ai_organization_usage').get().n,0);}finally{crypto.subtle.decrypt=decrypt;}
 const g=await fixture(t);await g.save();await g.configure();const oversized=fake({changes:{usage:{input_tokens:100000,output_tokens:100,total_tokens:100100}}});await assert.rejects(prepareAssistantPlan(g.db,g.operator,query(),secret,{keys,fetcher:oversized.fetcher}),code('assistant_usage'));assert.equal(oversized.requests.length,1);assert.equal(g.native.prepare('SELECT count(*) n FROM ai_plans').get().n,0);
});

test('revocation, private policy and selected-key disable during an OpenAI reply withhold all proposals',async t=>{
 for(const change of ['membership','policy','key']){const f=await fixture(t);await f.save();await f.configure();const provider=fake({hook:async()=>{if(change==='membership')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='openai-operator'").run(new Date().toISOString());else if(change==='policy')f.native.prepare("UPDATE ai_organization_settings SET config_json=json_set(config_json,'$.usageScope','private','$.usageUserId',?)").run(f.owner.userId);else await manageAssistantCredential(f.db,f.owner,{action:'disable',organizationId,provider:'openai',expectedRevision:f.revision()},secret,keys);}});
  await assert.rejects(prepareAssistantPlan(f.db,f.operator,query(),secret,{keys,fetcher:provider.fetcher}),denied);assert.equal(provider.requests.length,1);assert.equal(f.native.prepare('SELECT count(*) n FROM ai_plans').get().n,0);assert.equal(f.native.prepare('SELECT status FROM ai_calls').get().status,'failed');assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);
 }
});

test('OpenAI policy is checked at admission, persistence and physical application, including response recovery',async t=>{
 for(const point of ['admission','commit','apply']){const f=await fixture(t);await f.save();await f.configure();const provider=fake(),input=query();const flip=()=>f.native.prepare("UPDATE ai_organization_settings SET config_json=json_set(config_json,'$.usageScope','private','$.usageUserId',?)").run(f.owner.userId);
  if(point==='admission')f.beforeBatch(/INSERT INTO ai_calls/,flip);if(point==='commit')f.beforeBatch(/INSERT INTO ai_plans/,flip);
  if(point==='apply'){const preview=await prepareAssistantPlan(f.db,f.operator,input,secret,{keys,fetcher:provider.fetcher});f.beforeBatch(/INSERT INTO stock_movements/,flip);await assert.rejects(applyAssistantPlan(f.db,f.operator,{planToken:preview.planToken,confirmed:true},secret,undefined,keys),denied);assert.equal(f.native.prepare('SELECT count(*) n FROM stock_movements').get().n,0);await assert.rejects(prepareAssistantPlan(f.db,f.operator,input,secret,{keys,fetcher:provider.fetcher}),code('assistant_usage_forbidden'));}
  else{await assert.rejects(prepareAssistantPlan(f.db,f.operator,input,secret,{keys,fetcher:provider.fetcher}),denied);assert.equal(f.native.prepare('SELECT count(*) n FROM ai_plans').get().n,0);assert.equal(provider.requests.length,point==='admission'?0:1);}
 }
});

test('OpenAI diagnostics query only the exact model metadata and refuse mismatched or reflected responses',async()=>{
 assert.equal(connectionEndpoint('openai'),'https://api.openai.com/v1/models/gpt-5.6-luna');let calls=0;
 const run=create=>probeConnection('openai',providerKey,'gpt-5.6-luna',new AbortController().signal,async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/models/gpt-5.6-luna');assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer '+providerKey);return create();});
 assert.equal((await run(()=>Response.json({object:'model',id:'gpt-5.6-luna'}))).outcome,'authenticated');
 for(const bad of [{object:'model',id:'another-model'},{object:'list',data:[]},{object:'model',id:'gpt-5.6-luna',privateEcho:providerKey}])assert.equal((await run(()=>Response.json(bad))).outcome,'invalid_response');
 assert.equal((await run(()=>Response.json({error:'synthetic denied'},{status:401}))).outcome,'rejected');assert.equal((await run(()=>new Response('',{status:302,headers:{Location:'http://127.0.0.1/private'}}))).outcome,'unavailable');assert.equal(calls,6);
});

test('OpenAI diagnostic is explicit, idempotent, scoped and creates no inference quota or domain change',async t=>{
 const f=await fixture(t);await f.save();let calls=0;const input={organizationId,provider:'openai',expectedRevision:f.revision(),operationKey:crypto.randomUUID(),consent:true};
 const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/models/gpt-5.6-luna');assert.equal(init.method,'GET');assert.equal(init.body,undefined);return Response.json({object:'model',id:'gpt-5.6-luna'});};
 await assert.rejects(testAssistantConnection(f.db,f.owner,{...input,consent:false},secret,{keys,fetcher}),code('assistant_consent'));
 await assert.rejects(testAssistantConnection(f.db,f.operator,input,secret,{keys,fetcher}),code('assistant_configuration_forbidden'));assert.equal(calls,0);
 const receipt=await testAssistantConnection(f.db,f.owner,input,secret,{keys,fetcher});assert.equal(receipt.outcome,'authenticated');assert.equal(receipt.modelListed,true);assert.equal(receipt.inferenceTested,false);
 const replay=await testAssistantConnection(f.db,f.owner,input,secret,{keys,fetcher});assert.equal(replay.replayed,true);assert.equal(calls,1);
 for(const table of ['ai_calls','ai_plans','ai_organization_usage','stock_movements'])assert.equal(f.native.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
 assert.equal(JSON.stringify({receipt,audit:f.native.prepare('SELECT details FROM audit').all()}).includes(providerKey),false);
});

test('OpenAI diagnostic withholds a result after administrator revocation or configuration change during metadata response',async t=>{
 for(const change of ['revoked','revision']){const f=await fixture(t);await f.save();let calls=0;
  const fetcher=async()=>{calls++;if(change==='revoked')f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(),f.owner.userId);else f.native.prepare('UPDATE ai_organization_settings SET revision=revision+1 WHERE organization_id=?').run(organizationId);return Response.json({object:'model',id:'gpt-5.6-luna'});};
  await assert.rejects(testAssistantConnection(f.db,f.owner,{organizationId,provider:'openai',expectedRevision:f.revision(),operationKey:crypto.randomUUID(),consent:true},secret,{keys,fetcher}),denied);assert.equal(calls,1);assert.equal(f.native.prepare("SELECT count(*) n FROM audit WHERE action='assistant.connection.result'").get().n,0);assert.equal(f.native.prepare('SELECT count(*) n FROM ai_organization_usage').get().n,0);
 }
});

test('concurrent identical OpenAI operations own one reservation and never dispatch a second request',async t=>{
 const f=await fixture(t);await f.save();await f.configure({dailyCalls:1});const provider=fake(),input=query();const result=await Promise.allSettled([prepareAssistantPlan(f.db,f.operator,input,secret,{keys,fetcher:provider.fetcher}),prepareAssistantPlan(f.db,f.operator,input,secret,{keys,fetcher:provider.fetcher})]);assert.ok(result.some(value=>value.status==='fulfilled'));assert.equal(provider.requests.length,1);assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);assert.equal(f.native.prepare('SELECT count(*) n FROM ai_calls').get().n,1);
});

test('migration0027 rebuild preserves four populated providers, exact nine-column PK/FK metadata and encrypted settings',async()=>{
 const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');try{
  for(const migration of readdirSync(root+'drizzle').filter(name=>name.endsWith('.sql')&&name<'0027').sort())native.exec(readFileSync(root+'drizzle/'+migration,'utf8'));
  const at='2026-11-05T12:00:00.000Z',cipher=await encryptProviderCredentials(secret,{deepseek:'synthetic-deepseek-preserved',typesafe:'synthetic-typesafe-preserved',deepgram:'synthetic-deepgram-preserved',groq:'synthetic-groq-preserved'},organizationId,keys);
  native.prepare('INSERT INTO ai_organization_settings(organization_id,revision,config_json,credentials_ciphertext,updated_by,updated_at)VALUES(?,7,?,?,?,?)').run(organizationId,JSON.stringify(DEFAULT_ASSISTANT_CONFIG),cipher,'synthetic-owner',at);
  for(const provider of providers.filter(p=>p!=='openai'))native.prepare('INSERT INTO ai_provider_credential_metadata(organization_id,provider,label,mask,state,created_at,created_by,updated_at,updated_by)VALUES(?,?,?,?,?,?,?,?,?)').run(organizationId,provider,'Preservar '+provider,'…tail',provider==='groq'?'disabled':'active',at,'original-owner',at,'last-owner');
  const metadata=native.prepare('SELECT * FROM ai_provider_credential_metadata ORDER BY provider').all(),settings=native.prepare('SELECT * FROM ai_organization_settings').all(),columns=native.prepare('PRAGMA table_info(ai_provider_credential_metadata)').all(),fk=native.prepare('PRAGMA foreign_key_list(ai_provider_credential_metadata)').all(),tables=native.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const migration=readFileSync(root+'drizzle/0027_openai_organization_credentials.sql','utf8');
  native.exec('BEGIN');native.exec(migration);native.exec('ROLLBACK');assert.deepEqual(native.prepare('SELECT * FROM ai_provider_credential_metadata ORDER BY provider').all(),metadata);assert.deepEqual(native.prepare('SELECT * FROM ai_organization_settings').all(),settings);assert.equal(native.prepare("SELECT count(*) n FROM sqlite_master WHERE name='ai_provider_credential_metadata_openai'").get().n,0);assert.throws(()=>native.prepare('UPDATE ai_provider_credential_metadata SET provider=? WHERE provider=?').run('openai','groq'),/CHECK/);
  native.exec('BEGIN');native.exec(migration);native.exec('COMMIT');assert.equal(columns.length,9);assert.deepEqual(columns.map(c=>c.name),['organization_id','provider','label','mask','state','created_at','created_by','updated_at','updated_by']);assert.deepEqual(columns.filter(c=>c.pk).map(c=>[c.name,c.pk]),[['organization_id',1],['provider',2]]);
  assert.deepEqual(native.prepare('PRAGMA table_info(ai_provider_credential_metadata)').all(),columns);assert.deepEqual(native.prepare('PRAGMA foreign_key_list(ai_provider_credential_metadata)').all(),fk);assert.deepEqual(native.prepare('SELECT * FROM ai_provider_credential_metadata ORDER BY provider').all(),metadata);assert.deepEqual(native.prepare('SELECT * FROM ai_organization_settings').all(),settings);assert.deepEqual(native.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),tables);assert.deepEqual(native.prepare('PRAGMA foreign_key_check').all(),[]);
  native.prepare('INSERT INTO ai_provider_credential_metadata(organization_id,provider,label,mask,state,created_at,created_by,updated_at,updated_by)VALUES(?,?,?,?,?,?,?,?,?)').run(organizationId,'openai','Texto OpenAI','…tail','active',at,'synthetic-owner',at,'synthetic-owner');assert.throws(()=>native.prepare('UPDATE ai_provider_credential_metadata SET provider=? WHERE provider=?').run('unreviewed','openai'),/CHECK/);assert.throws(()=>native.prepare('UPDATE ai_provider_credential_metadata SET state=? WHERE provider=?').run('unknown','openai'),/CHECK/);
 }finally{native.close();}
});
