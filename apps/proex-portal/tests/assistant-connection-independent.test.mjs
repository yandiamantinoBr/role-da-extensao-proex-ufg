import {test,after} from 'node:test';
import assert from 'node:assert/strict';

import {compile,nativeFixture} from './support/traffic-fixture.mjs';
const service=await import(compile('lib/assistant/connection.ts')),settings=await import(compile('lib/assistant/settings.ts')),contracts=await import(compile('lib/assistant/contracts.ts'));
const secret='test-only-connection-security-secret-at-least-32',keys={deepseek:'test-only-deepseek-connection-key',typesafe:'test-only-typesafe-connection-key',deepgram:'test-only-deepgram-connection-key'},fixtures=[];
after(()=>{for(const f of fixtures)f.close();delete globalThis.__connectionRoute;});
const code=value=>error=>error.code===value;
async function fixture(){const f=nativeFixture();fixtures.push(f);const owner=f.owner(),org=f.native.prepare("SELECT organization_id FROM projects WHERE id='project-fixture'").get().organization_id,now=new Date().toISOString(),ti={userId:'connection-ti',email:'ti@example.test',displayName:'TI synthetic',members:[],capabilities:[]};f.native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(ti.userId,ti.email,now,now);f.native.prepare("INSERT INTO members(id,user_id,email,role,organization_id,project_id,created_at) VALUES('connection-ti-member',?,?,'viewer',?,'project-fixture',?)").run(ti.userId,ti.email,org,now);await settings.configureAssistant(f.db,owner,{organizationId:org,config:contracts.DEFAULT_ASSISTANT_CONFIG,expectedRevision:0,deepseekKey:keys.deepseek,typesafeKey:keys.typesafe,deepgramKey:keys.deepgram},secret);await settings.manageAssistantGrant(f.db,owner,{action:'grant.create',organizationId:org,userId:ti.userId});return{...f,owner,org,ti};}
function input(f,provider='deepseek',extra={}){return{organizationId:f.org,expectedRevision:1,provider,operationKey:crypto.randomUUID(),consent:true,...extra};}
const json=(value,status=200)=>Response.json(value,{status});
function fake(overrides={}){const calls=[];return{calls,fetch:async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);if(overrides.handle)return overrides.handle(url,options);if(url==='https://api.deepseek.com/user/balance'){assert.equal(options.headers.Authorization,'Bearer '+keys.deepseek);return json({is_available:true,balance_infos:[{currency:'USD',total_balance:'PRIVATE_BALANCE'}]});}if(url==='https://api.deepseek.com/models')return json({object:'list',data:[{id:'deepseek-flash',object:'model'}]});if(url==='https://api.typesafe.ai/v1/models'){assert.equal(options.headers.Authorization,'Bearer '+keys.typesafe);return json({models:[{name:'jev-1.14.0',description:'synthetic',release_date:'2026-10-14'}]});}if(url==='https://api.deepgram.com/v1/auth/token'){assert.equal(options.headers.Authorization,'Token '+keys.deepgram);return json({api_key_id:'PRIVATE_KEY_IDENTIFIER',scopes:['usage:write']});}throw new Error('Unexpected egress');}};}
test('independent: a revoked TI grant or blocked issuer during the metadata wait cannot persist success or replay egress',async()=>{
 for(const change of ["UPDATE ai_configuration_grants SET revoked_at='2026-10-31'","UPDATE portal_users SET status='blocked' WHERE user_id='owner-fixture'"]){
  const f=await fixture(),request=input(f,'typesafe'),provider=fake({handle:async()=>{await Promise.resolve();f.native.exec(change);return json({models:[{name:'jev-1.14.0'}]});}});
  await assert.rejects(service.testAssistantConnection(f.db,f.ti,request,secret,{fetcher:provider.fetch}),code('assistant_configuration_forbidden'));
  assert.equal(provider.calls.length,1);assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='assistant.connection.result'").get().n,0);
  await assert.rejects(service.testAssistantConnection(f.db,f.ti,request,secret,{fetcher:provider.fetch}));assert.equal(provider.calls.length,1);
 }
});

test('independent: configuration rotation while a metadata call is waiting invalidates its receipt without another call',async()=>{
 const f=await fixture(),request=input(f,'typesafe'),provider=fake({handle:async()=>{
  await settings.configureAssistant(f.db,f.owner,{organizationId:f.org,config:contracts.DEFAULT_ASSISTANT_CONFIG,expectedRevision:1},secret);
  return json({models:[{name:'jev-1.14.0'}]});
 }});
 await assert.rejects(service.testAssistantConnection(f.db,f.ti,request,secret,{fetcher:provider.fetch}),code('assistant_configuration_changed'));
 assert.equal(provider.calls.length,1);assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='assistant.connection.result'").get().n,0);
 await assert.rejects(service.testAssistantConnection(f.db,f.ti,request,secret,{fetcher:provider.fetch}),code('assistant_configuration_changed'));
 assert.equal(provider.calls.length,1);const current=await service.assistantConnectionStatus(f.db,f.ti,f.org);assert.equal(current.revision,2);assert.deepEqual(current.checks,[]);
});

test('independent: uncertain transport persists a sanitized reusable receipt and status polling never writes or redispatches',async()=>{
 const f=await fixture(),request=input(f,'typesafe'),provider=fake({handle:()=>{throw new Error('PRIVATE REMOTE ERROR '+keys.typesafe);}});
 const first=await service.testAssistantConnection(f.db,f.ti,request,secret,{fetcher:provider.fetch});assert.equal(first.outcome,'unavailable');
 const replay=await service.testAssistantConnection(f.db,f.ti,request,secret,{fetcher:provider.fetch});assert.equal(replay.replayed,true);assert.equal(replay.id,first.id);assert.equal(provider.calls.length,1);
 f.resetStats();const status=await service.assistantConnectionStatus(f.db,f.ti,f.org);assert.equal(status.checks[0].id,first.id);assert.equal(f.stats.commits,0);assert.equal(provider.calls.length,1);
 assert.ok(!JSON.stringify(status).includes('PRIVATE REMOTE'));assert.ok(!JSON.stringify(status).includes(keys.typesafe));
});

test('independent: actual streamed bytes override a small declared length and cancel an oversized provider body',async()=>{
 const f=await fixture(),request=input(f,'typesafe');let cancelled=false;
 const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"models":[],"padding":"'));controller.enqueue(new Uint8Array(32768));controller.enqueue(new TextEncoder().encode('"}'));},cancel(){cancelled=true;}});
 const provider=fake({handle:()=>new Response(body,{headers:{'Content-Type':'application/json','Content-Length':'1'}})});
 const receipt=await service.testAssistantConnection(f.db,f.ti,request,secret,{fetcher:provider.fetch});assert.equal(receipt.outcome,'invalid_response');assert.equal(receipt.authenticationChecked,false);assert.equal(cancelled,true);assert.equal(provider.calls.length,1);
 assert.equal((await service.testAssistantConnection(f.db,f.ti,request,secret,{fetcher:provider.fetch})).replayed,true);assert.equal(provider.calls.length,1);
});