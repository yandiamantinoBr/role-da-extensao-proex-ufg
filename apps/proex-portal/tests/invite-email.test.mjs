import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// E-mail do convite pela fila de avisos (MailApp), 17/11. Dados sintéticos; nenhum e-mail real sai.
const access=await import(compile('lib/access.ts'));
const inv=await import(compile('lib/invites/invite-email.ts'));
const email=await import(compile('lib/follow-up/email.ts')),tokenApi=await import(compile('lib/follow-up/email-tokens.ts'));
const origin='https://portal.example.test',secret='segredo-sintetico-de-teste-com-mais-de-32-caracteres',GUEST='convidada@example.invalid';

async function fixture(t,{ready=true}={}){
 const f=teamFixture(t),owner=await f.actor('owner-a'),sender='owner-a@example.invalid';
 const token=await tokenApi.createEmailDispatchToken(f.db,owner,{organizationId:'org-a'}),principal=await tokenApi.emailDispatcherFromToken(f.db,'Bearer '+token.token);
 await email.configureEmail(f.db,owner,{organizationId:'org-a',enabled:true,senderEmail:sender,expectedVersion:0,dailyLimit:50,personDailyLimit:3,eventLimit:100,intervalSeconds:60,senderConfirmed:true},origin);
 if(ready)await inv.recordInviteEmailSupport(f.db,'org-a');
 const invite=await access.accessAction(f.db,owner,'invite.create',{email:GUEST,role:'viewer',projectId:'project-a',operationKey:crypto.randomUUID()},origin,secret);
 const code=new URL(invite.inviteUrl).searchParams.get('token'),link=`${origin}/convite#token=${code}`;
 const common={organizationId:'org-a',installerEmail:sender};
 return{...f,owner,principal,invite,code,link,common,
  status:async(who='owner-a')=>inv.inviteEmailStatus(f.db,await f.actor(who),{inviteId:invite.id}),
  queue:async(who='owner-a',url=link)=>inv.queueInviteEmail(f.db,await f.actor(who),{inviteId:invite.id,url},secret),
  claim:(now=Date.now())=>inv.claimInviteEmail(f.db,principal,{...common,remainingQuota:100},origin,now)};
}

test('without a working queue the button is not offered and queueing is refused with the reason',async t=>{
 const f=await fixture(t,{ready:false});
 assert.deepEqual(await f.status(),{available:false,status:null});
 await assert.rejects(f.queue(),e=>e.status===409&&e.code==='invite_email_unavailable'&&/ainda não está ligado/.test(e.message));
 // A script that declared support long ago no longer counts.
 await inv.recordInviteEmailSupport(f.db,'org-a',Date.now()-3*24*3600000);assert.equal((await f.status()).available,false);
 await inv.recordInviteEmailSupport(f.db,'org-a');assert.equal((await f.status()).available,true);
 // E-mail turned off in Configurações: off again.
 f.native.prepare("UPDATE followup_email_configuration SET enabled=0 WHERE organization_id='org-a'").run();assert.equal((await f.status()).available,false);
});

test('queued by its creator, sent once by MailApp with the fixed text and the personal link, and the code is erased',async t=>{
 const f=await fixture(t);
 assert.deepEqual(await f.status(),{available:true,status:null});
 await assert.rejects(f.queue('owner-a',`${origin}/convite#token=${'x'.repeat(43)}`),e=>e.code==='invite_email_link');
 assert.deepEqual(await f.queue(),{queued:true,status:'queued'});
 assert.equal((await f.queue()).duplicate,true,'asking again does not queue a second e-mail');
 const row=f.native.prepare('SELECT * FROM invite_email_queue').get();
 assert.ok(row.id.startsWith('iv-'));assert.ok(row.code_cipher);assert.ok(!row.code_cipher.includes(f.code),'the code is stored encrypted');
 const claimed=await f.claim();assert.ok(claimed.claim);
 const message=await inv.beginInviteEmail(f.db,f.principal,{...f.common,id:claimed.claim.id,claimToken:claimed.claim.claimToken,remainingQuota:100},origin,secret);
 assert.equal(message.to,GUEST);assert.equal(message.subject,'PROEX · Convite para o portal');
 assert.equal(message.body,inv.inviteEmailBody(origin,f.code));assert.ok(message.body.endsWith(`/convite#token=${f.code}`));assert.ok(message.body.length<800);
 const ack=await inv.acknowledgeInviteEmail(f.db,f.principal,{...f.common,id:claimed.claim.id,claimToken:claimed.claim.claimToken,acceptanceToken:message.acceptanceToken},origin);
 assert.equal(ack.status,'accepted');
 const after=f.native.prepare('SELECT status,code_cipher FROM invite_email_queue').get();assert.equal(after.status,'accepted');assert.equal(after.code_cipher,null,'erased after MailApp accepted');
 assert.equal((await f.status()).status,'accepted');
 assert.deepEqual((await f.claim(Date.now()+120000)).claim,null,'never sent twice');
});

test('a cancelled invite is never sent and its code is erased; others cannot queue or read the status',async t=>{
 const f=await fixture(t);
 await f.queue();
 await access.accessAction(f.db,f.owner,'invite.revoke',{id:f.invite.id,operationKey:crypto.randomUUID()},origin);
 assert.equal((await f.claim()).claim,null);
 assert.deepEqual({...f.native.prepare('SELECT status,code_cipher FROM invite_email_queue').get()},{status:'cancelled',code_cipher:null});
 await assert.rejects(f.status('viewer-a'),e=>e.status===403);
 await assert.rejects(f.queue('owner-b'),e=>e.status===403);
 await assert.rejects(inv.inviteEmailStatus(f.db,null,{inviteId:f.invite.id}),e=>e.status===401);
});

test('the dispatch route records the script support and routes iv- ids; the screen hides the button without the queue',()=>{
 const route=readFileSync(new URL('../app/api/follow-up/email/route.ts',import.meta.url),'utf8');
 assert.match(route,/kinds\.includes\('invite'\)\)\{await recordInviteEmailSupport/);
 for(const step of ['beginInviteEmail','acknowledgeInviteEmail','recoverInviteEmail','reconcileInviteEmail'])assert.match(route,new RegExp(`isInviteEmailId\\(input\\.id\\)\\?await ${step}`));
 const share=readFileSync(new URL('../components/portal/team-invite-share.tsx',import.meta.url),'utf8');
 assert.match(share,/emailButton && <button/);assert.match(share,/emailState === 'off' && <p/);assert.doesNotMatch(share,/mailto:|emailShareHref/);
});
