import {test,after} from 'node:test';
import assert from 'node:assert/strict';

import {compile,nativeFixture} from './support/traffic-fixture.mjs';
const email=await import(compile('lib/follow-up/email.ts'));
const tokenApi=await import(compile('lib/follow-up/email-tokens.ts'));
const fixtures=[];after(()=>{for(const f of fixtures)f.close();delete globalThis.__emailRoute;});
const origin='https://synthetic.invalid',sender='sender@example.test';
function code(expected){return error=>error.code===expected;}
async function fixture({enable=true,optin=true,task=true}={}){const f=nativeFixture();fixtures.push(f);const owner=f.owner(),at=new Date().toISOString(),org=f.native.prepare("SELECT organization_id FROM projects WHERE id='project-fixture'").get().organization_id;
 const user={userId:'recipient-fixture',email:'recipient@example.test',displayName:'Synthetic recipient',members:[],capabilities:[]};f.native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(user.userId,user.email,at,at);f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES('recipient-member',?,?,'viewer','project-fixture',?,?)").run(user.userId,user.email,org,at);
 const token=await tokenApi.createEmailDispatchToken(f.db,owner,{organizationId:org}),principal=await tokenApi.emailDispatcherFromToken(f.db,'Bearer '+token.token),common={organizationId:org,installerEmail:sender};const configure=(extra={})=>email.configureEmail(f.db,owner,{organizationId:org,enabled:enable,senderEmail:sender,expectedVersion:0,dailyLimit:50,personDailyLimit:3,eventLimit:100,intervalSeconds:60,senderConfirmed:true,...extra},origin);await configure();if(optin)await email.emailPreference(f.db,user,{organizationId:org,enabled:true});
 function notify(key='task:1',taskId='task-email'){const at=new Date(Date.now()+1).toISOString();if(!f.native.prepare('SELECT 1 FROM followup_tasks WHERE id=?').get(taskId)){f.native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,created_by,created_at,updated_at) VALUES(?,?,'project-fixture','PRIVATE TASK TITLE','PRIVATE BODY',?,?,?)").run(taskId,org,owner.userId,at,at);f.native.prepare('INSERT INTO followup_assignees(id,task_id,user_id,created_at) VALUES(?,?,?,?)').run(crypto.randomUUID(),taskId,user.userId,at);}const id=crypto.randomUUID();f.native.prepare('INSERT INTO followup_notifications(id,task_id,user_id,cause_key,created_at) VALUES(?,?,?,?,?)').run(id,taskId,user.userId,key,at);return id;}
 if(task)notify();return{...f,owner,user,org,principal,token:token.token,common,configure,notify};}
const claim=(f,extra={},now)=>email.claimEmail(f.db,f.principal,{...f.common,remainingQuota:100,...extra},origin,now);
const begin=(f,c,extra={},now)=>email.beginEmail(f.db,f.principal,{...f.common,id:c.id,claimToken:c.claimToken,remainingQuota:100,...extra},origin,now);
const ack=(f,c,m,extra={})=>email.acknowledgeEmail(f.db,f.principal,{...f.common,id:c.id,claimToken:c.claimToken,acceptanceToken:m.acceptanceToken,...extra},origin);
test('independent: two concurrent acceptance receipts record one acceptance event and identify the replay',async()=>{
 const f=await fixture(),c=(await claim(f)).claim,m=await begin(f,c);
 const results=await Promise.all([ack(f,c,m),ack(f,c,m)]);
 assert.ok(results.every(result=>result.status==='accepted'));
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='followup.email.accepted'").get().n,1);
 assert.equal(results.filter(result=>result.replayed).length,1);
});
function afterSendingCommit(f,change){
 const sql=new WeakMap(),prepare=f.db.prepare.bind(f.db),batch=f.db.batch.bind(f.db);let armed=true;
 function track(statement,source){sql.set(statement,source);const bind=statement.bind;statement.bind=(...args)=>track(bind(...args),source);return statement;}
 f.db.prepare=source=>track(prepare(source),source);
 f.db.batch=async statements=>{const result=await batch(statements);if(armed&&statements.some(statement=>/SET status='sending'/.test(sql.get(statement)??''))){armed=false;change();}return result;};
}

test('independent: the final release fence withholds the address after recipient, issuer or consent changes following durable begin',async()=>{
 for(const subject of ['recipient','issuer','consent']){
  const f=await fixture(),c=(await claim(f)).claim;
  afterSendingCommit(f,()=>f.native.exec(subject==='recipient'?"UPDATE members SET revoked_at='2026-10-31' WHERE id='recipient-member'":subject==='issuer'?"UPDATE members SET revoked_at='2026-10-31' WHERE id='member-fixture'":"UPDATE followup_email_preferences SET enabled=0"));
  await assert.rejects(begin(f,c),code('email_recipient_changed'));
  assert.equal(f.native.prepare('SELECT status FROM followup_email_queue').get().status,'uncertain');
  assert.equal(f.native.prepare("SELECT reserved FROM followup_email_usage WHERE bucket='organization'").get().reserved,1);
  assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='followup.email.accepted'").get().n,0);
 }
});

test('independent: accepted cannot be asserted before durable begin or with another message receipt',async()=>{
 const f=await fixture(),c=(await claim(f)).claim;
 await assert.rejects(ack(f,c,{acceptanceToken:'A'.repeat(43)}),code('email_claim_changed'));
 assert.equal(f.native.prepare('SELECT status FROM followup_email_queue').get().status,'claimed');
 const message=await begin(f,c);f.notify('task:2','task-email-second');
 const next=(await claim(f,{},Date.now()+61000)).claim,nextMessage=await begin(f,next,{},Date.now()+61000);
 await assert.rejects(ack(f,next,message),code('email_claim_changed'));
 await assert.rejects(ack(f,c,nextMessage),code('email_claim_changed'));
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM followup_email_queue WHERE status='accepted'").get().n,0);
 await ack(f,c,message);assert.equal((await ack(f,c,message)).replayed,true);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM followup_email_queue WHERE status='accepted'").get().n,1);
});

test('independent: rotated scoped credentials recover only metadata and never reopen uncertain sends',async()=>{
 const f=await fixture(),c=(await claim(f)).claim;await begin(f,c);
 const replacement=await tokenApi.createEmailDispatchToken(f.db,f.owner,{organizationId:f.org});
 await tokenApi.revokeEmailDispatchToken(f.db,f.owner,{organizationId:f.org,id:f.principal.tokenId});
 await assert.rejects(email.recoverEmail(f.db,f.principal,{...f.common,id:c.id,claimToken:c.claimToken},origin),code('email_access_changed'));
 const fresh=await tokenApi.emailDispatcherFromToken(f.db,'Bearer '+replacement.token),input={...f.common,id:c.id,claimToken:c.claimToken};
 const recovered=await email.recoverEmail(f.db,fresh,input,origin);assert.deepEqual(recovered,{status:'uncertain'});
 assert.ok(!JSON.stringify(recovered).includes(f.user.email));
 await assert.rejects(email.beginEmail(f.db,fresh,{...input,remainingQuota:100},origin),code('email_claim_changed'));
 assert.equal((await email.claimEmail(f.db,fresh,{...f.common,remainingQuota:100},origin,Date.now()+121000)).claim,null);
});