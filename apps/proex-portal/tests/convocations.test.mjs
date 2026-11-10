import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Real services over every SQLite migration. People, enrollments and projects are synthetic.
const {convocationAction,convocationDetail,listConvocations}=await import(compile('lib/convocations/service.ts'));
const {convocationGuestAction}=await import(compile('lib/convocations/guest.ts'));
const {convocationInbox,materialize}=await import(compile('lib/convocations/notices.ts'));
const key=()=>crypto.randomUUID();
const secret=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const future=(hours)=>new Date(Date.now()+hours*3_600_000).toISOString();

async function fixture(t){
 const f=teamFixture(t);
 // A manager of the invited project "Horizonte" (project-a2) and a viewer of the convocation's own project.
 const now=f.now;
 f.insert('portal_users',{user_id:'mgr-a2',email:'mgr-a2@example.invalid',status:'active',created_at:now,updated_at:now});
 f.insert('profiles',{user_id:'mgr-a2',display_name:'Gestão Horizonte',created_at:now,updated_at:now});
 f.insert('members',{id:'member-mgr-a2',user_id:'mgr-a2',email:'mgr-a2@example.invalid',role:'manager',project_id:'project-a2',organization_id:'org-a',created_at:now});
 f.users['mgr-a2']={userId:'mgr-a2',email:'mgr-a2@example.invalid',displayName:'Gestão Horizonte'};
 const run=async(who,action,input)=>convocationAction(f.db,await f.actor(who),action,{operationKey:key(),...input});
 const created=(await run('owner-a','convocation.create',{projectId:'project-a',title:'UFG nos Parques',edition:'Parque sintético',location:'Parque Exemplo',eventDate:'2026-11-22',responseDeadline:future(30),
  shifts:[{label:'Manhã',startsAt:'08:00',endsAt:'12:00'},{label:'Tarde',startsAt:'13:00',endsAt:'17:00'}],projectIds:['project-a','project-a2']})).convocation;
 const invite=await run('owner-a','convocation.invite.create',{convocationId:created.id,label:'Bolsistas',expiresAt:future(48),maxUses:3});
 const detail=async(who)=>convocationDetail(f.db,await f.actor(who),created.id);
 const shifts=(await detail('owner-a')).shifts;
 const guest=(input={})=>convocationGuestAction(f.db,{action:'respond',inviteToken:invite.token,editToken:secret(),name:'Pessoa Bolsista Exemplo',enrollment:'202600001',projectId:'project-a',shiftIds:[shifts[0].id],response:'yes',consent:true,...input},'203.0.113.10');
 return{...f,run,convocation:created,invite,detail,shifts,guest};
}

test('a manager creates a convocation and a limited invite; the token is shown once and stored only as a hash',async t=>{
 const f=await fixture(t);
 assert.equal(f.convocation.status,'open');assert.match(f.invite.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(f.invite.path,`/convocacao#c=${f.invite.token}`);
 const row=f.native.prepare('SELECT token_hash,use_count,max_uses FROM convocation_invites').get();assert.equal(row.token_hash.length,64);assert.notEqual(row.token_hash,f.invite.token);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM convocation_events WHERE kind IN('created','invite_created')").get().n,2);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action LIKE 'convocation.%'").get().n,2);
 await assert.rejects(f.run('viewer-a','convocation.create',{projectId:'project-a',title:'Sem permissão',eventDate:'2026-11-22',shifts:[{label:'A',startsAt:'08:00',endsAt:'09:00'}],projectIds:['project-a']}),e=>e.status===403);
 await assert.rejects(f.run('owner-a','convocation.create',{projectId:'project-a',title:'Projeto de fora',eventDate:'2026-11-22',shifts:[{label:'A',startsAt:'08:00',endsAt:'09:00'}],projectIds:['project-b']}),e=>e.code==='convocation_project_scope');
});

test('the invite reveals only public data; answering needs consent; the use limit, expiry and revocation are enforced atomically',async t=>{
 const f=await fixture(t);
 const view=await convocationGuestAction(f.db,{action:'inspect',inviteToken:f.invite.token},'203.0.113.10');
 assert.equal(view.convocation.title,'UFG nos Parques');assert.equal(view.convocation.accepting,true);assert.deepEqual(view.convocation.projects.map(p=>p.id).sort(),['project-a','project-a2']);
 assert.ok(!JSON.stringify(view).includes('enrollment'),'no guest data in the public view');
 await assert.rejects(f.guest({consent:false}),e=>e.code==='convocation_consent');
 await assert.rejects(f.guest({projectId:'project-b'}),e=>e.code==='convocation_project_scope');
 const editToken=secret(),first=await f.guest({editToken});assert.equal(first.guest.response,'yes');
 const replay=await f.guest({editToken});assert.equal(replay.duplicate,true);
 await f.guest({name:'Outra Pessoa Exemplo',enrollment:'202600002',response:'maybe'});await f.guest({name:'Terceira Pessoa',enrollment:'202600003',response:'no',shiftIds:[]});
 assert.equal(f.native.prepare('SELECT use_count FROM convocation_invites').get().use_count,3);
 await assert.rejects(f.guest({name:'Quarta Pessoa',enrollment:'202600004'}),e=>e.code==='convocation_invite_closed');
 const later=await f.run('owner-a','convocation.invite.create',{convocationId:f.convocation.id,expiresAt:future(2),maxUses:10});
 await f.run('owner-a','convocation.invite.revoke',{inviteId:later.invite.id});
 await assert.rejects(convocationGuestAction(f.db,{action:'respond',inviteToken:later.token,editToken:secret(),name:'Pessoa Revogada',enrollment:'202600005',projectId:'project-a',shiftIds:[f.shifts[0].id],response:'yes',consent:true},'203.0.113.11'),e=>e.code==='convocation_invite_closed');
 assert.throws(()=>f.native.prepare('UPDATE convocation_invites SET use_count=0').run(),/convocation_invite_identity/);
 assert.throws(()=>f.native.prepare("UPDATE convocation_invites SET expires_at='2000-01-01T00:00:00Z'").run(),/convocation_invite_identity/);
});

test('the guest reaches only their own answer through the personal link and can change or delete it; nothing else',async t=>{
 const f=await fixture(t);const mine=secret(),other=secret();
 await f.guest({editToken:mine});await f.guest({editToken:other,name:'Outra Pessoa Exemplo',enrollment:'202600099',projectId:'project-a2'});
 const own=await convocationGuestAction(f.db,{action:'inspect',editToken:mine},'203.0.113.10');
 assert.equal(own.guest.name,'Pessoa Bolsista Exemplo');assert.ok(!JSON.stringify(own).includes('Outra Pessoa'),'never other people');
 const changed=await convocationGuestAction(f.db,{action:'update',editToken:mine,name:'Pessoa Bolsista Exemplo',enrollment:'202600001',projectId:'project-a2',shiftIds:[f.shifts[1].id],response:'maybe',expectedVersion:1},'203.0.113.10');
 assert.equal(changed.guest.response,'maybe');assert.deepEqual(changed.guest.shiftIds,[f.shifts[1].id]);
 await assert.rejects(convocationGuestAction(f.db,{action:'update',editToken:mine,name:'X Y Z',enrollment:'202600001',projectId:'project-a2',shiftIds:[],response:'yes',expectedVersion:1},'203.0.113.10'),e=>e.status===409||e.status===400);
 await assert.rejects(convocationGuestAction(f.db,{action:'inspect',editToken:secret()},'203.0.113.10'),e=>e.code==='convocation_guest_not_found');
 // A guest has no portal identity: every internal read needs a session.
 await assert.rejects(listConvocations(f.db,null),e=>e.status===401);await assert.rejects(convocationDetail(f.db,null,f.convocation.id),e=>e.status===401);
 await convocationGuestAction(f.db,{action:'forget',editToken:mine,confirmed:true},'203.0.113.10');
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM convocation_guests').get().n,1);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM convocation_events WHERE details LIKE '%Pessoa%' OR details LIKE '%2026000%'").get().n,0,'the event log keeps no personal data');
});

test('panel scope: the convocation team sees everyone; an invited project manager sees only their project; others nothing',async t=>{
 const f=await fixture(t);
 await f.guest();await f.guest({name:'Pessoa Horizonte',enrollment:'202600010',projectId:'project-a2',response:'no',shiftIds:[]});
 const full=await f.detail('owner-a');assert.equal(full.scope,'full');assert.equal(full.guests.length,2);assert.equal(full.permissions.canManage,true);assert.equal(full.invites.length,1);
 const viewer=await f.detail('viewer-a');assert.equal(viewer.scope,'full');assert.equal(viewer.permissions.canManage,false);assert.deepEqual(viewer.invites,[]);
 const scoped=await f.detail('mgr-a2');assert.equal(scoped.scope,'projects');assert.deepEqual(scoped.guests.map(g=>g.projectId),['project-a2']);assert.deepEqual(scoped.projects.map(p=>p.id),['project-a2']);
 await assert.rejects(f.detail('other-a2'),e=>e.status===403);await assert.rejects(f.detail('owner-b'),e=>e.status===403);
 const list=await listConvocations(f.db,await f.actor('mgr-a2'));assert.equal(list.convocations[0].scope,'projects');assert.deepEqual(list.convocations[0].counts,{yes:0,maybe:0,no:1});
 await assert.rejects(f.run('mgr-a2','convocation.invite.create',{convocationId:f.convocation.id,expiresAt:future(5),maxUses:5}),e=>e.status===403);
});

test('"tal projeto não respondeu", bell items for responsibles and managers, receipts clear new answers',async t=>{
 const f=await fixture(t);
 let inbox=await convocationInbox(f.db,await f.actor('owner-a'));assert.equal(inbox.items.length,1);assert.deepEqual(inbox.items[0].silentProjects.sort(),['Projeto Aurora','Projeto Horizonte']);
 await f.guest();
 inbox=await convocationInbox(f.db,await f.actor('owner-a'));assert.equal(inbox.items[0].newResponses,1);assert.deepEqual(inbox.items[0].silentProjects,['Projeto Horizonte']);assert.equal(inbox.unread,1);
 const manager=await convocationInbox(f.db,await f.actor('mgr-a2'));assert.deepEqual(manager.items[0].silentProjects,['Projeto Horizonte']);assert.equal(manager.items[0].newResponses,0,'answers from another project are not theirs');
 await f.run('owner-a','convocation.seen',{convocationId:f.convocation.id});
 inbox=await convocationInbox(f.db,await f.actor('owner-a'));assert.equal(inbox.items[0].newResponses,0);
 assert.deepEqual((await convocationInbox(f.db,await f.actor('viewer-a'))).items,[],'a report viewer is not notified');
 await f.run('owner-a','convocation.preference',{kind:'digest',channel:'bell',enabled:false});
 await assert.rejects(f.run('owner-a','convocation.preference',{kind:'digest',channel:'whatsapp',enabled:true}),e=>e.code==='channel_unavailable');
});

test('e-mail notices are queued once per key for responsibles and invited-project managers, never for others',async t=>{
 const f=await fixture(t);await f.guest();
 const now=Date.parse('2026-11-21T15:00:00.000Z');
 f.native.prepare('UPDATE convocations SET response_deadline=?,version=version+1 WHERE id=?').run(new Date(now+12*3_600_000).toISOString(),f.convocation.id);
 await f.db.batch(materialize(f.db,'org-a',now));await f.db.batch(materialize(f.db,'org-a',now+60_000));
 const rows=f.native.prepare('SELECT kind,user_id FROM convocation_email_queue ORDER BY kind,user_id').all().map(r=>`${r.kind}:${r.user_id}`);
 // Older answers (more than 6 h before `now`) do not create "new answer" e-mails; the second run adds nothing.
 assert.deepEqual(rows,['digest:mgr-a2','digest:owner-a','reminder:mgr-a2','reminder:owner-a']);
});

test('closing stops answers; purging deletes every guest answer and keeps an anonymous log; the history is immutable',async t=>{
 const f=await fixture(t);const token=secret();await f.guest({editToken:token});
 let c=(await f.detail('owner-a')).convocation;
 await f.run('owner-a','convocation.update',{id:c.id,expectedVersion:c.version,status:'closed'});
 await assert.rejects(f.guest({name:'Depois do Encerramento',enrollment:'202600020'}),e=>e.code==='convocation_invite_closed');
 await assert.rejects(convocationGuestAction(f.db,{action:'update',editToken:token,name:'Pessoa Bolsista Exemplo',enrollment:'202600001',projectId:'project-a',shiftIds:[f.shifts[0].id],response:'no',expectedVersion:1},'203.0.113.10'),e=>e.code==='convocation_closed');
 c=(await f.detail('owner-a')).convocation;
 await assert.rejects(f.run('owner-a','convocation.purge',{id:c.id,expectedVersion:c.version}),e=>e.status===400);
 const purged=await f.run('owner-a','convocation.purge',{id:c.id,expectedVersion:c.version,confirmed:true});assert.equal(purged.removed,1);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM convocation_guests').get().n,0);assert.ok(f.native.prepare('SELECT purged_at FROM convocations').get().purged_at);
 assert.throws(()=>f.native.prepare('DELETE FROM convocation_events').run(),/convocation_event_immutable/);
 assert.throws(()=>f.native.prepare('DELETE FROM convocations').run(),/convocation_immutable/);
 await assert.rejects(f.run('owner-a','convocation.update',{id:c.id,expectedVersion:c.version+1,title:'Nova vida'}),e=>e.code==='convocation_purged');
});

test('editing keeps answered shifts and projects; renaming and adding work',async t=>{
 const f=await fixture(t);await f.guest();
 const c=(await f.detail('owner-a')).convocation;
 await assert.rejects(f.run('owner-a','convocation.update',{id:c.id,expectedVersion:c.version,shifts:[{id:f.shifts[1].id,label:'Tarde',startsAt:'13:00',endsAt:'17:00'}]}),e=>e.code==='convocation_shift_in_use');
 await assert.rejects(f.run('owner-a','convocation.update',{id:c.id,expectedVersion:c.version,projectIds:['project-a2']}),e=>e.code==='convocation_project_in_use');
 const updated=(await f.run('owner-a','convocation.update',{id:c.id,expectedVersion:c.version,shifts:[{id:f.shifts[0].id,label:'Manhã cedo',startsAt:'07:30',endsAt:'12:00'},{label:'Noite',startsAt:'18:00',endsAt:'21:00'}]})).convocation;
 assert.equal(updated.version,c.version+1);const shifts=(await f.detail('owner-a')).shifts;assert.deepEqual(shifts.map(s=>s.label),['Manhã cedo','Noite']);
});

test('the personal link reaches one convocation only and expires with the retention period; the panel warns the team',async t=>{
 const f=await fixture(t);const token=secret();await f.guest({editToken:token});
 const own=await convocationGuestAction(f.db,{action:'inspect',editToken:token},'203.0.113.10');assert.equal(own.guest.linkExpiresOn,'2027-05-21','event date + 180 days');
 // Retention already over: the link stops working (read, edit) and the team sees the warning.
 f.native.prepare("UPDATE convocations SET event_date='2026-01-10',retention_days=30,version=version+1").run();
 await assert.rejects(convocationGuestAction(f.db,{action:'inspect',editToken:token},'203.0.113.10'),e=>e.status===410&&e.code==='convocation_link_expired');
 await assert.rejects(convocationGuestAction(f.db,{action:'update',editToken:token,name:'Pessoa Bolsista Exemplo',enrollment:'202600001',projectId:'project-a',shiftIds:[f.shifts[0].id],response:'no',expectedVersion:1},'203.0.113.10'),e=>e.code==='convocation_link_expired');
 const detail=await f.detail('owner-a');assert.equal(detail.convocation.retentionExpired,true);assert.equal(detail.convocation.retentionEndsOn,'2026-02-09');
 assert.equal((await listConvocations(f.db,await f.actor('owner-a'))).convocations[0].retentionExpired,true);
 // After the purge the link no longer finds anything.
 const c=detail.convocation;await f.run('owner-a','convocation.purge',{id:c.id,expectedVersion:c.version,confirmed:true});
 await assert.rejects(convocationGuestAction(f.db,{action:'inspect',editToken:token},'203.0.113.10'),e=>e.code==='convocation_guest_not_found');
});
