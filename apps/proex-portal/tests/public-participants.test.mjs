import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';

// Actual Better Auth + canonical sessions + public/private API handlers + migrated SQLite.
// Only transport identity/bindings, outbound email and the response timing floor are isolated.
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=mkdtempSync(join(tmpdir(),'proex-public-participants-')),compiled=new Map();
writeFileSync(join(temporary,'package.json'),' {"type":"module"}');symlinkSync(new URL('../node_modules/',import.meta.url),join(temporary,'node_modules'),process.platform==='win32'?'junction':'dir');
function write(name,code){const target=resolve(temporary,name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,code);return pathToFileURL(target).href;}
const replacements=new Map([
 [resolve(root,'lib/platform.ts'),write('fixtures/platform.mjs',`export function database(){return globalThis.__publicTest.db;} export function bucket(){return{async get(){return null},async delete(){}}} export function ownerEmail(){return undefined;} export function inviteSecret(){return globalThis.__publicTest.runtimeEnv.BETTER_AUTH_SECRET;} export function participantEmailEnvironment(){return globalThis.__publicTest.runtime.email;} export function setupToken(){return undefined;} export function isStandalone(){return true;}`)],
 [resolve(root,'app/chatgpt-auth.ts'),write('fixtures/native.mjs','export async function getChatGPTUser(){return globalThis.__publicTest.native??null;}')],
 ['next/headers',write('fixtures/headers.mjs','export async function headers(){return globalThis.__publicTest.headers;}')],
 ['next/navigation',write('fixtures/navigation.mjs','export function redirect(){throw new Error("unexpected_redirect")}')],
 [resolve(root,'lib/public-response.ts'),write('fixtures/time.mjs','export async function waitForPublicEnvelope(){}')],
]);
function compile(file){file=resolve(root,file);if(replacements.has(file))return replacements.get(file);if(compiled.has(file))return compiled.get(file);const destination=resolve(temporary,relative(root,file).replace(/\.ts$/,'.mjs'));mkdirSync(dirname(destination),{recursive:true});const uri=pathToFileURL(destination).href;compiled.set(file,uri);if(file.endsWith('.json')){writeFileSync(destination,`export default ${readFileSync(file,'utf8')};`);return uri;}let output=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 output=output.replace(/from (['"])([^'"]+)\1/g,(match,_quote,dependency)=>{if(replacements.has(dependency))return`from ${JSON.stringify(replacements.get(dependency))}`;if(!dependency.startsWith('.')&&!dependency.startsWith('@/'))return match;let target=dependency.startsWith('@/')?resolve(root,dependency.slice(2)):resolve(dirname(file),dependency);if(!/\.(ts|json)$/.test(target))target+='.ts';if(file===resolve(root,'lib/session.ts')&&target===resolve(root,'lib/password-auth.ts'))return`from ${JSON.stringify(pathToFileURL(resolve(temporary,'fixtures/configured-auth.mjs')).href)}`;return`from ${JSON.stringify(compile(target))}`;}).replace(/\s+with\s+\{\s*type:\s*['"]json['"]\s*\}/g,'');writeFileSync(destination,output);return uri;}
const authModule=compile('lib/password-auth.ts');write('fixtures/configured-auth.mjs',`import{passwordAuth as actual}from ${JSON.stringify(authModule)};export function passwordAuth(db,options={}){return actual(db,{...options,runtimeEnv:globalThis.__publicTest.runtimeEnv});}`);
const service=await import(compile('lib/public-participants.ts')),access=await import(compile('lib/access.ts')),session=await import(compile('lib/session.ts')),{passwordAuth}=await import(authModule);
const participants=await import(compile('app/api/participants/route.ts')),adminRoute=await import(compile('app/api/participants/admin/route.ts')),account=await import(compile('app/api/account/route.ts'));
const portal=await import(compile('app/api/portal/route.ts')),units=await import(compile('app/api/units/route.ts')),organizations=await import(compile('app/api/organizations/route.ts')),events=await import(compile('app/api/events/[id]/route.ts'));
const {usersAction}=await import(compile('lib/users.ts'));
const {reportRows}=await import(compile('lib/reports.ts')),{calendarEntries}=await import(compile('lib/calendar.ts')),{requireSyncOwner}=await import(compile('lib/sync/contracts.ts'));
after(()=>rmSync(temporary,{recursive:true,force:true}));
const origin='https://portal.example.test',password='Frase sintética de participante 2026!',notice='Aviso sintético aprovado somente para testes isolados: e-mail e nome para participação, retenção institucional e canal de atendimento do responsável. Nenhuma coleta real está autorizada por este texto.';
function fixture(t){
 const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync(resolve(root,'drizzle')).filter(file=>file.endsWith('.sql')).sort())native.exec(readFileSync(resolve(root,'drizzle',file),'utf8'));
 const hooks={},db={prepare(sql){let values=[];return{bind(...args){values=args;return this;},async first(column){const row=native.prepare(sql).get(...values)??null;return column?row?.[column]??null:row;},async all(){return{success:true,results:native.prepare(sql).all(...values)};},async raw(){const statement=native.prepare(sql);statement.setReturnArrays(true);return statement.all(...values);},execute(){const statement=native.prepare(sql);if(statement.columns().length){const results=statement.all(...values);return{success:true,results,meta:{changes:/^\s*SELECT\b/i.test(sql)?0:Number(native.prepare('SELECT changes() n').get().n)}};}const result=statement.run(...values);return{success:true,results:[],meta:{changes:Number(result.changes)}};},async run(){return this.execute();}};},async batch(statements){if(hooks.beforeBatch)await hooks.beforeBatch(statements);native.exec('BEGIN IMMEDIATE');try{const result=statements.map(statement=>statement.execute());native.exec('COMMIT');return result;}catch(error){native.exec('ROLLBACK');throw error;}}};
 const now=new Date().toISOString(),insert=(table,row)=>{const columns=Object.keys(row);native.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(row));};
 insert('portal_users',{user_id:'platform',email:'owner@example.test',status:'active',created_at:now,updated_at:now});insert('members',{id:'platform-owner',user_id:'platform',email:'owner@example.test',role:'owner',project_id:null,created_at:now});
 const runtimeEnv={BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:'only-synthetic-auth-secret-long-enough-2026'},runtime={secret:runtimeEnv.BETTER_AUTH_SECRET,email:{provider:'resend',apiKey:'only-synthetic-dedicated-email-key',from:'participant@example.test',domainId:'synthetic-domain',origin}},messages=[],providerCalls=[];
 const context=globalThis.__publicTest={db,runtime,runtimeEnv,headers:new Headers(),native:null};
 const previousFetch=globalThis.fetch;let providerStatus='verified',tracking=false,failSending=false;
 globalThis.fetch=async(url,init={})=>{providerCalls.push({url:String(url),method:init.method??'GET'});assert.ok(String(url).startsWith('https://api.resend.com/'),'email adapter must use the fixed official host');if(String(url).includes('/domains/'))return Response.json({id:'synthetic-domain',name:'example.test',status:providerStatus,capabilities:{sending:'enabled'},open_tracking:tracking,click_tracking:tracking});if(String(url).endsWith('/emails')){if(failSending)return Response.json({error:'provider secret detail'},{status:503});messages.push(JSON.parse(init.body));return Response.json({id:`synthetic-message-${messages.length}`});}throw new Error('unexpected_provider_endpoint');};
 t.after(()=>{globalThis.fetch=previousFetch;delete globalThis.__publicTest;native.close();});
 const owner=()=>access.getActor(db,{userId:'platform',email:'owner@example.test',displayName:'Synthetic platform owner'});
 async function enable({eligibility=''}={}){let config=await service.participantAdministration(db,await owner(),runtime);config=await service.configureParticipants(db,await owner(),runtime,{action:'configure',expectedVersion:config.config.version,enabled:false,notice,noticeApproved:true,eligibility,eligibilityApproved:!!eligibility});config=await service.configureParticipants(db,await owner(),runtime,{action:'verifySender',expectedVersion:config.config.version});return service.configureParticipants(db,await owner(),runtime,{action:'configure',expectedVersion:config.config.version,enabled:true,notice,noticeApproved:true,eligibility,eligibilityApproved:!!eligibility});}
 function request(input,options={}){const headers=new Headers({Origin:options.origin??origin,'Content-Type':'application/json','X-Proex-Action':'1','cf-connecting-ip':options.ip??'192.0.2.7'});if(options.cookie)headers.set('Cookie',options.cookie);context.headers=headers;return new Request(`${origin}/api/participants`,{method:'POST',headers,body:JSON.stringify(input)});}
 const post=(input,options)=>participants.POST(request(input,options));
 async function start(email='person@example.test',purpose='signup',extra={}){return post({action:'request',email,purpose,noticeAccepted:true,eligibilityConfirmed:false,returnTo:'/events/event-public',...extra});}
 const token=()=>new URL(messages.at(-1).text.match(/https:\/\/\S+/)[0]).hash.slice('#token='.length);
 async function complete(proof=token(),extra={}){return post({action:'complete',token:proof,name:'Synthetic participant',password,noticeAccepted:true,eligibilityConfirmed:false,...extra});}
 async function enroll(email='person@example.test'){assert.equal((await start(email)).status,202);const response=await complete();assert.equal(response.status,200);return native.prepare('SELECT * FROM portal_users WHERE email=?').get(email);}
 async function login(email='person@example.test',secret=password){const response=await account.POST(request({action:'login',identifier:email,password:secret,returnTo:'/events/event-public'}));if(response.status!==200)return{response,cookie:null};const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');context.headers=new Headers({Cookie:cookie});return{response,cookie};}
 function seedEvent(){insert('projects',{id:'private-project',name:'PRIVATE PROJECT A',created_at:now});insert('items',{id:'gift',project_id:'private-project',name:'Synthetic gift',category:'gift',unit:'un',stock:100,created_at:now});for(const[kind,quantity]of[['brinde',1],['super',3]]){insert('offers',{id:kind,project_id:'private-project',name:kind,kind,active:1});insert('offer_components',{offer_id:kind,item_id:'gift',quantity});}insert('settings',{name:'privacyNotice',value:notice,updated_at:now});insert('campaigns',{id:'event-public',project_id:'private-project',name:'Synthetic public event',starts_at:new Date(Date.now()-60000).toISOString(),ends_at:new Date(Date.now()+3600000).toISOString(),status:'active',retry_limit:0,brinde_offer_id:'brinde',super_offer_id:'super',rules_text:'Synthetic published rules',created_at:now});}
 return{native,db,hooks,context,runtime,runtimeEnv,messages,providerCalls,insert,now,owner,enable,request,post,start,token,complete,enroll,login,seedEvent,setProviderStatus(value){providerStatus=value;},setTracking(value){tracking=value;},failSending(){failSending=true;}};
}

test('public registration defaults closed and cannot be enabled by manual domain claims or missing infrastructure',async t=>{
 const f=fixture(t);assert.equal((await(await participants.GET(new Request(origin))).json()).available,false);assert.equal((await f.start()).status,503);assert.equal(f.messages.length,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM participant_email_challenges').get().n,0);
 await assert.rejects(service.configureParticipants(f.db,await f.owner(),f.runtime,{action:'configure',expectedVersion:1,enabled:true,notice,noticeApproved:true,eligibility:'',eligibilityApproved:false}),{status:409});
 f.setProviderStatus('pending');await assert.rejects(service.configureParticipants(f.db,await f.owner(),f.runtime,{action:'verifySender',expectedVersion:1}),{status:503});f.setProviderStatus('verified');f.setTracking(true);await assert.rejects(service.configureParticipants(f.db,await f.owner(),f.runtime,{action:'verifySender',expectedVersion:1}),{status:503});
 assert.equal(f.messages.length,0);assert.equal(f.native.prepare('SELECT sender_verified_at FROM public_participant_config').get().sender_verified_at,null);
});

test('verified public signup uses hashed single-use proof and real Better Auth/canonical session without grants or private catalogs',async t=>{
 const f=fixture(t);f.seedEvent();await f.enable();assert.equal((await f.start('public@ufg.br')).status,202);const proof=f.token();
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM participant_accounts').get().n,0);assert.ok(!JSON.stringify(f.native.prepare('SELECT * FROM participant_email_challenges').get()).includes(proof));assert.ok(f.messages[0].text.includes('#token='));assert.ok(!f.messages[0].text.includes('?token='));
 const inspected=await f.post({action:'inspect',token:proof});assert.equal(inspected.status,200);assert.deepEqual(Object.keys(await inspected.json()).sort(),['eligibility','notice','purpose']);assert.equal((await f.complete(proof)).status,200);assert.equal((await f.complete(proof)).status,400);
 const user=f.native.prepare("SELECT * FROM portal_users WHERE email='public@ufg.br'").get();assert.equal(f.native.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(user.user_id).n,0);assert.equal(f.native.prepare("SELECT email_verified,role FROM auth_user WHERE email='public@ufg.br'").get().email_verified,1);assert.equal(f.native.prepare('SELECT email FROM participant_email_challenges WHERE used_at IS NOT NULL').get().email,'');
 const {cookie,response}=await f.login('public@ufg.br');assert.equal(response.status,200);assert.match(response.headers.get('Set-Cookie'),/HttpOnly/i);assert.match(response.headers.get('Set-Cookie'),/Secure/i);
 const canonical=await session.getPortalUser();assert.equal(canonical.userId,user.user_id);const actor=await access.getActor(f.db,canonical);assert.deepEqual(actor.capabilities,[]);assert.equal((await portal.GET()).status,403);assert.equal((await units.GET(new Request(`${origin}/api/units`))).status,403);assert.deepEqual((await(await organizations.GET(new Request(origin))).json()).organizations,[]);assert.deepEqual((await reportRows(f.db,actor,{dataset:'projects'})).rows,[]);await assert.rejects(calendarEntries(f.db,actor,{range:{from:'2026-01-01',to:'2027-01-01'}}),{status:403});await assert.rejects(requireSyncOwner(f.db,actor),{status:403});
 f.context.headers=new Headers({Cookie:cookie});const event=await events.GET(new Request(origin),{params:Promise.resolve({id:'event-public'})});assert.equal((await event.json()).authenticated,true);const body=await(await participants.GET(new Request(`${origin}/api/participants?self=1`))).json();assert.equal(body.account.email,'public@ufg.br');assert.deepEqual(body.participations,[]);
});

test('email proof requests are anti-enumeration for existing staff/public/absent recovery and recipient throttling',async t=>{
 const f=fixture(t);await f.enable();const first=await f.start('owner@example.test');const absent=await f.start('absent@example.test','recovery');assert.equal(first.status,202);assert.deepEqual(await first.json(),await absent.json());assert.equal(f.messages.length,0);
 await f.enroll();const again=await f.start();const staffRecovery=await f.start('owner@example.test','recovery');assert.deepEqual(await again.json(),await staffRecovery.json());assert.equal(f.messages.length,1);
 const failed=await f.start('another@example.test');const envelope=await failed.json();for(let i=0;i<5;i++){const response=await f.start('another@example.test');assert.equal(response.status,202);assert.deepEqual(await response.json(),envelope);}assert.equal(f.messages.filter(message=>message.to[0]==='another@example.test').length,3);
 const data=JSON.stringify(envelope);for(const value of [f.runtime.email.apiKey,f.runtime.secret,f.token(),'another@example.test'])assert.ok(!data.includes(value));
});

test('recovery only changes verified participant credentials and revokes all previous sessions',async t=>{
 const f=fixture(t);await f.enable();const user=await f.enroll(),signed=await f.login(),second=await f.login();assert.ok(signed.cookie);assert.ok(second.cookie);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM auth_session').get().n,2);await f.start('person@example.test','recovery');const proof=f.token(),newPassword='Outra frase sintética segura 2026!';assert.equal((await f.complete(proof,{password:newPassword})).status,200);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM auth_session').get().n,0);f.context.headers=new Headers({Cookie:signed.cookie});assert.equal(await session.getPortalUser(),null);f.context.headers=new Headers({Cookie:second.cookie});assert.equal(await session.getPortalUser(),null);assert.equal((await f.login('person@example.test',password)).response.status,401);assert.equal((await f.login('person@example.test',newPassword)).response.status,200);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(user.user_id).n,0);
});

test('a newly granted team role, blocked/pending/anonymized account or expired token prevents public recovery atomically',async t=>{
 for(const condition of ['team','blocked','pending','anonymized','expired'])await t.test(condition,async t=>{const f=fixture(t);await f.enable();const user=await f.enroll();await f.start('person@example.test','recovery');const proof=f.token(),before=f.native.prepare("SELECT password FROM auth_account WHERE provider_id='credential'").get().password;
  if(condition==='team')f.insert('members',{id:'explicit-team',user_id:user.user_id,email:user.email,role:'viewer',project_id:null,created_at:f.now});if(condition==='blocked')f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(user.user_id);if(condition==='pending')f.native.prepare('UPDATE portal_users SET activation_pending=1 WHERE user_id=?').run(user.user_id);if(condition==='anonymized')f.native.prepare('UPDATE portal_users SET anonymized_at=? WHERE user_id=?').run(f.now,user.user_id);if(condition==='expired')f.native.prepare('UPDATE participant_email_challenges SET expires_at=0 WHERE used_at IS NULL').run();
  assert.equal((await f.complete(proof,{password:'Tentativa inválida de nova senha 2026!'})).status,400);assert.equal(f.native.prepare("SELECT password FROM auth_account WHERE provider_id='credential'").get().password,before);
 });
});

test('duplicate verification, stale settings and an in-flight revocation leave no partial account or password state',async t=>{
 const f=fixture(t);await f.enable();await f.start();const proof=f.token();const results=await Promise.all([f.complete(proof),f.complete(proof)]);assert.deepEqual(results.map(response=>response.status).sort(),[200,400]);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM participant_accounts').get().n,1);
 await f.start('person@example.test','recovery');const recovery=f.token();
 // Simulate a real account transition at the transaction boundary, after proof lookup/hash.
 const batch=f.db.batch.bind(f.db);f.hooks.beforeBatch=null;let revoke=true;f.db.batch=async statements=>{if(revoke&&statements.length>3){revoke=false;f.native.prepare("UPDATE portal_users SET status='blocked' WHERE email='person@example.test'").run();}return batch(statements);};
 const before=f.native.prepare("SELECT password FROM auth_account WHERE provider_id='credential'").get().password;assert.equal((await f.complete(recovery,{password:'Nova frase que será recusada 2026!'})).status,400);assert.equal(f.native.prepare("SELECT password FROM auth_account WHERE provider_id='credential'").get().password,before);
 f.db.batch=batch;await f.start('fresh@example.test');const stale=f.token();f.native.prepare('UPDATE public_participant_config SET enabled=0,version=version+1').run();assert.equal((await f.complete(stale)).status,503);assert.equal(f.native.prepare("SELECT COUNT(*) n FROM auth_user WHERE email='fresh@example.test'").get().n,0);
});

test('campaign participation uses the participant canonical account, preserves concurrent idempotency and blocks revoked accounts',async t=>{
 const f=fixture(t);f.seedEvent();await f.enable();const user=await f.enroll(),signed=await f.login();const key=crypto.randomUUID(),context={params:Promise.resolve({id:'event-public'})};
 const draw=operationKey=>events.POST(f.request({action:'draw',modality:'wheel',operationKey},{cookie:signed.cookie}),context);const results=await Promise.all([draw(key),draw(key)]);assert.ok(results.every(response=>response.status===200));const bodies=await Promise.all(results.map(response=>response.json()));assert.equal(bodies[0].attempt.id,bodies[1].attempt.id);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM participations WHERE identity_id=?').get(user.user_id).n,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM attempts').get().n,1);
 f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(user.user_id);assert.equal((await draw(key)).status,403);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM attempts').get().n,1);
});

test('HTTP boundaries reject forged native claims, CSRF, oversized/privileged payloads and failed delivery proofs',async t=>{
 const f=fixture(t);await f.enable();f.context.headers=new Headers({'oai-authenticated-user-id':'platform','oai-authenticated-user-email':'owner@example.test'});assert.equal((await participants.GET(new Request(`${origin}/api/participants?self=1`))).status,401);assert.equal((await adminRoute.GET()).status,401);
 assert.equal((await f.post({action:'request',email:'person@example.test',purpose:'signup',noticeAccepted:true,role:'owner'})).status,400);assert.equal((await f.post({action:'request'},{origin:'https://hostile.invalid'})).status,403);assert.equal((await f.post({action:'complete',token:'a'.repeat(64),password:'x'.repeat(5000)})).status,413);assert.equal((await f.start('person@example.test','signup',{noticeAccepted:false})).status,400);assert.equal(f.messages.length,0);
 f.failSending();const response=await f.start();assert.equal(response.status,202);assert.ok(!(await response.text()).includes('provider secret'));assert.equal(f.native.prepare('SELECT provider_accepted_at FROM participant_email_challenges').get().provider_accepted_at,null);
});

test('criteria are optional; only explicitly configured approved criteria add a consent requirement',async t=>{
 const f=fixture(t);await f.enable({eligibility:'Critério sintético definido oficialmente para esta ação de teste.'});assert.equal((await f.start()).status,400);assert.equal((await f.start('person@example.test','signup',{eligibilityConfirmed:true})).status,202);assert.equal((await f.complete(f.token())).status,400);assert.equal((await f.complete(f.token(),{eligibilityConfirmed:true})).status,200);
});

test('different concurrent draw keys return a conflict and existing account block/reactivation preserves identity and history',async t=>{
 const f=fixture(t);f.seedEvent();await f.enable();const user=await f.enroll(),signed=await f.login(),context={params:Promise.resolve({id:'event-public'})};
 const draw=()=>events.POST(f.request({action:'draw',modality:'wheel',operationKey:crypto.randomUUID()},{cookie:signed.cookie}),context);
 const results=await Promise.all([draw(),draw()]);assert.deepEqual(results.map(response=>response.status).sort(),[200,409]);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM attempts').get().n,1);
 await usersAction(f.db,await f.owner(),'user.status',{userId:user.user_id,status:'blocked'});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM auth_session').get().n,0);assert.equal((await f.login()).response.status,401);
 await usersAction(f.db,await f.owner(),'user.status',{userId:user.user_id,status:'active'});assert.equal((await f.login()).response.status,200);assert.equal((await session.getPortalUser()).userId,user.user_id);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM participations WHERE identity_id=?').get(user.user_id).n,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(user.user_id).n,0);
});

test('administrative HTTP uses a real canonical owner session and cannot forge readiness or use revoked authority',async t=>{
 const f=fixture(t),auth=await passwordAuth(f.db,{runtimeEnv:f.runtimeEnv}),created=await auth.api.createUser({body:{email:'owner@example.test',password,name:'Synthetic owner',role:'user'}});
 f.insert('identity_aliases',{provider:'password',subject:created.user.id,user_id:'platform',created_at:f.now});const signed=await f.login('owner@example.test');assert.equal(signed.response.status,200);
 const response=await adminRoute.GET();assert.equal(response.status,200);const body=await response.json();assert.ok(!JSON.stringify(body).includes(f.runtime.email.apiKey));
 const forged=await adminRoute.POST(f.request({action:'configure',expectedVersion:1,enabled:true,sender_verified_at:Date.now()},{cookie:signed.cookie}));assert.equal(forged.status,400);
 const actor=await f.owner(),calls=f.providerCalls.length;f.native.prepare("UPDATE members SET revoked_at=? WHERE id='platform-owner'").run(f.now);await assert.rejects(service.configureParticipants(f.db,actor,f.runtime,{action:'verifySender',expectedVersion:1}),{status:403});assert.equal(f.providerCalls.length,calls);
});

test('public availability reads never persist visits and sender secret rotation closes stale readiness',async t=>{
 const f=fixture(t);await f.enable();const before=f.native.prepare('SELECT total_changes() n').get().n,calls=f.providerCalls.length;
 for(let i=0;i<100;i++){const response=await participants.GET(new Request(origin));assert.equal(response.status,200);assert.equal((await response.json()).available,true);}
 assert.equal(f.native.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.providerCalls.length,calls);
 f.runtime.email.apiKey='another-synthetic-rotated-dedicated-email-key';assert.equal((await(await participants.GET(new Request(origin))).json()).available,false);assert.equal(f.providerCalls.length,calls);
});
