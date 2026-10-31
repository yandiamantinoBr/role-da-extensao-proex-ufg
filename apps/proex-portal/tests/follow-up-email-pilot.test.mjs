import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {compile,root,nativeFixture} from './support/traffic-fixture.mjs';
const email=await import(compile('lib/follow-up/email.ts')),tokens=await import(compile('lib/follow-up/email-tokens.ts'));
const fixtures=[];after(()=>{for(const f of fixtures)f.close();delete globalThis.__pilotRoute;});
const origin='https://synthetic.invalid';
const code=value=>error=>error.code===value;
async function fixture({enabled=true,optin=true,assigned=true}={}){
 const f=nativeFixture();fixtures.push(f);const owner=f.owner(),org=f.native.prepare("SELECT organization_id FROM projects WHERE id='project-fixture'").get().organization_id,at=new Date().toISOString();
 const other={userId:'other-pilot-user',email:'other@example.invalid'};
 f.native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(other.userId,other.email,at,at);
 f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES('other-pilot-member',?,?,'viewer','project-fixture',?,?)").run(other.userId,other.email,org,at);
 await email.configureEmail(f.db,owner,{organizationId:org,enabled,senderEmail:owner.email,expectedVersion:0,dailyLimit:50,personDailyLimit:3,eventLimit:100,intervalSeconds:60,senderConfirmed:true},origin);
 if(optin)await email.emailPreference(f.db,owner,{organizationId:org,enabled:true});await email.emailPreference(f.db,other,{organizationId:org,enabled:true});
 const token=await tokens.createEmailDispatchToken(f.db,owner,{organizationId:org,expiresDays:30}),principal=await tokens.emailDispatcherFromToken(f.db,'Bearer '+token.token),common={organizationId:org,installerEmail:owner.email,remainingQuota:100};
 function notify(user,key,offset){const stamp=new Date(Date.now()+offset).toISOString(),task='pilot-task-'+key,id='pilot-notice-'+key;f.native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,created_by,created_at,updated_at) VALUES(?,?,'project-fixture','PRIVATE TEST TITLE',?,?,?)").run(task,org,owner.userId,stamp,stamp);if(user!==owner||assigned)f.native.prepare('INSERT INTO followup_assignees(id,task_id,user_id,created_at) VALUES(?,?,?,?)').run(crypto.randomUUID(),task,user.userId,stamp);f.native.prepare('INSERT INTO followup_notifications(id,task_id,user_id,cause_key,created_at) VALUES(?,?,?,?,?)').run(id,task,user.userId,'task:1',stamp);return{id,task};}
 const otherNotice=notify(other,'other',1),ownNotice=notify(owner,'own',2);
 return{...f,owner,other,org,token,principal,common,ownNotice,otherNotice};
}
const claim=(f,extra={})=>email.claimPilotEmail(f.db,f.principal,{...f.common,...extra},origin);
const begin=(f,c,extra={})=>email.beginPilotEmail(f.db,f.principal,{...f.common,id:c.id,claimToken:c.claimToken,...extra},origin);
function race(f,pattern,change,after=false){const prepare=f.db.prepare.bind(f.db),batch=f.db.batch.bind(f.db);let hit=false;f.db.prepare=function wrap(sql,values=[]){const statement=prepare(sql).bind(...values);return{...statement,sql,bind:(...args)=>wrap(sql,args)};};f.db.batch=async statements=>{const matched=!hit&&statements.some(s=>pattern.test(s.sql??''));if(matched){hit=true;if(!after)change();}const result=await batch(statements);if(matched&&after)change();return result;};return()=>assert.equal(hit,true,'race checkpoint reached');}
function queueOther(f){const at=new Date(Date.now()-1000).toISOString();f.native.prepare('INSERT INTO followup_email_queue(id,notification_id,organization_id,task_id,user_id,event_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('queued-other',f.otherNotice.id,f.org,f.otherNotice.task,f.other.userId,'task:1',at,at);}
function substitute(f){f.native.prepare('UPDATE followup_email_queue SET user_id=?,task_id=?,notification_id=? WHERE user_id=?').run(f.other.userId,f.otherNotice.task,f.otherNotice.id,f.owner.userId);}

test('pilot selects only its live issuer even when another opted-in person is older and already queued; normal dispatch remains normal',async()=>{
 const f=await fixture();queueOther(f);const old=(await email.claimEmail(f.db,f.principal,f.common,origin)).claim;assert.ok(old);assert.equal(f.native.prepare('SELECT user_id FROM followup_email_queue WHERE id=?').get(old.id).user_id,f.other.userId);
 await email.recoverEmail(f.db,f.principal,{organizationId:f.org,installerEmail:f.owner.email,id:old.id,claimToken:old.claimToken},origin);
 const c=(await claim(f)).claim;assert.ok(c);assert.equal(f.native.prepare('SELECT user_id FROM followup_email_queue WHERE id=?').get(c.id).user_id,f.owner.userId);assert.equal(f.native.prepare('SELECT status FROM followup_email_queue WHERE id=?').get(old.id).status,'queued');
 const message=await begin(f,c);assert.equal(message.to,f.owner.email);assert.equal(message.senderEmail,f.owner.email);assert.ok(!JSON.stringify(message).includes(f.other.email));assert.ok(!JSON.stringify(message).includes('PRIVATE'));assert.equal((await email.acknowledgeEmail(f.db,f.principal,{organizationId:f.org,installerEmail:f.owner.email,id:c.id,claimToken:c.claimToken,acceptanceToken:message.acceptanceToken},origin)).status,'accepted');
});
test('pilot does not enqueue or release anybody when its own consent/assignment is absent, or when server is off',async()=>{
 for(const options of [{optin:false},{assigned:false}]){const f=await fixture(options);assert.equal((await claim(f)).claim,null);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_email_queue').get().n,0);}
 const f=await fixture({enabled:false});await assert.rejects(claim(f),code('email_disabled'));assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_email_queue').get().n,0);
});
test('pilot rejects a normal claim for another recipient, caller-supplied recipients and a mismatched sender account',async()=>{
 const f=await fixture();queueOther(f);const c=(await email.claimEmail(f.db,f.principal,f.common,origin)).claim;await assert.rejects(begin(f,c),code('email_recipient_changed'));assert.equal(f.native.prepare('SELECT status FROM followup_email_queue WHERE id=?').get(c.id).status,'claimed');
 for(const key of ['recipient','userId','to','selfOnly'])await assert.rejects(claim(f,{[key]:f.other.userId}),code('email_invalid'));
 const g=await fixture();g.native.prepare('UPDATE followup_email_configuration SET sender_email=?').run(g.other.email);g.common.installerEmail=g.other.email;await assert.rejects(claim(g),code('email_recipient_changed'));
});
test('pilot does not touch an expired claim owned by another recipient',async()=>{
 const f=await fixture();queueOther(f);const other=(await email.claimEmail(f.db,f.principal,f.common,origin)).claim;assert.equal(f.native.prepare('SELECT user_id FROM followup_email_queue WHERE id=?').get(other.id).user_id,f.other.userId);f.native.prepare('UPDATE followup_email_queue SET claim_expires_at=0 WHERE id=?').run(other.id);const before=f.native.prepare('SELECT * FROM followup_email_queue WHERE id=?').get(other.id);assert.ok((await claim(f)).claim);assert.deepEqual(f.native.prepare('SELECT * FROM followup_email_queue WHERE id=?').get(other.id),before);
});
test('recipient substitution immediately before the sending transaction is rejected atomically',async()=>{
 const f=await fixture(),c=(await claim(f)).claim,hit=race(f,/SET status='sending'/,()=>substitute(f));await assert.rejects(begin(f,c),code('email_recipient_changed'));hit();assert.equal(f.native.prepare('SELECT status FROM followup_email_queue').get().status,'claimed');assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_email_usage').get().n,0);
});
test('the final self fence withholds an address if its recipient is substituted after durable sending',async()=>{
 const f=await fixture(),c=(await claim(f)).claim,hit=race(f,/SET status='sending'/,()=>substitute(f),true);await assert.rejects(begin(f,c),code('email_recipient_changed'));hit();assert.equal(f.native.prepare('SELECT status FROM followup_email_queue').get().status,'uncertain');
});
test('pilot rechecks role, consent, canonical address and assignment at the atomic begin boundary',async()=>{
 for(const sql of ["UPDATE members SET revoked_at='2099-01-01' WHERE id='member-fixture'","UPDATE followup_email_preferences SET enabled=0 WHERE user_id='owner-fixture'","UPDATE portal_users SET email='changed@example.invalid' WHERE user_id='owner-fixture'","UPDATE followup_assignees SET removed_at='2099-01-01' WHERE user_id='owner-fixture'"]){const f=await fixture(),c=(await claim(f)).claim,hit=race(f,/SET status='sending'/,()=>f.native.exec(sql));await assert.rejects(begin(f,c),error=>['email_access_changed','email_recipient_changed'].includes(error.code));hit();assert.equal(f.native.prepare("SELECT COUNT(*) n FROM followup_email_queue WHERE status='sending'").get().n,0);}
});
test('pilot shares quotas, admits one racing begin, and uses the same idempotent ACK and uncertain recovery',async()=>{
 const f=await fixture(),c=(await claim(f)).claim,outcomes=await Promise.allSettled([begin(f,c),begin(f,c)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(f.native.prepare('SELECT reserved FROM followup_email_usage ORDER BY bucket').all().map(r=>r.reserved),[1,1,1]);await assert.rejects(begin(f,c),code('email_claim_changed'));assert.equal((await email.recoverEmail(f.db,f.principal,{organizationId:f.org,installerEmail:f.owner.email,id:c.id,claimToken:c.claimToken},origin)).status,'uncertain');assert.equal((await claim(f)).claim,null);
 const g=await fixture(),d=(await claim(g)).claim;g.native.exec("UPDATE followup_email_configuration SET daily_limit=1");g.native.prepare("INSERT INTO followup_email_usage(organization_id,day,bucket,reserved) VALUES(?,?,'organization',1)").run(g.org,new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date()));await assert.rejects(begin(g,d),code('email_quota'));assert.equal(g.native.prepare('SELECT status FROM followup_email_queue').get().status,'claimed');
});
const mocks=new Map([[resolve(root,'lib/platform.ts'),'export function database(){return globalThis.__pilotRoute.db;}'],[resolve(root,'lib/session.ts'),'export async function getPortalUser(){return globalThis.__pilotRoute.actor;}'],[resolve(root,'lib/follow-up/email-platform.ts'),`export function followupEmailOrigin(){return ${JSON.stringify(origin)};}`]]),route=await import(compile('app/api/follow-up/email/route.ts',mocks));
test('HTTP pilot actions are bearer-only and fixed self scope cannot be enlarged by request fields',async()=>{
 const f=await fixture();globalThis.__pilotRoute={db:f.db,actor:f.owner};const req=(body,bearer=true)=>new Request(origin+'/api/follow-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Proex-Action':'1',...(bearer?{Authorization:'Bearer '+f.token.token}:{})},body:JSON.stringify(body)});
 assert.equal((await route.POST(req({action:'dispatch.pilot.claim',...f.common},false))).status,403);assert.equal((await route.POST(req({action:'dispatch.pilot.claim',...f.common,userId:f.other.userId}))).status,400);const response=await route.POST(req({action:'dispatch.pilot.claim',...f.common}));assert.equal(response.status,200);const {claim:c}=await response.json();const result=await route.POST(req({action:'dispatch.pilot.begin',...f.common,...c}));assert.equal(result.status,400,'expiresAt is not accepted as an extra field');const good=await route.POST(req({action:'dispatch.pilot.begin',...f.common,id:c.id,claimToken:c.claimToken}));assert.equal(good.status,200);assert.equal((await good.json()).to,f.owner.email);
});
