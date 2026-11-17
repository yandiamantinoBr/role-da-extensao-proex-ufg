import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Convite a partir do pré-cadastro (17/11): situação do convite por pessoa, convidar, reenviar, cancelar, expirar,
// aceitar e quem não pode convidar. Dados sintéticos; nenhum contato real.
const {directoryWorkspace,directoryAction}=await import(compile('lib/directory/service.ts'));
const access=await import(compile('lib/access.ts'));
const {invitationShareLink}=await import(compile('lib/invitation-link.ts'));
const {inviteMessage,whatsappShareHref}=await import(compile('lib/invite-message.ts'));
const origin='https://portal.example.test',secret='segredo-sintetico-de-teste-com-mais-de-32-caracteres';
const CONTACT='convidada@example.invalid';

async function fixture(t){
 const f=teamFixture(t);
 const person=(await directoryAction(f.db,await f.actor('owner-a'),{action:'person.create',organizationId:'org-a',name:'Pessoa Convidada',position:'Apoio',sector:'Setor sintético',contact:CONTACT,status:'pending',operationKey:crypto.randomUUID()})).person;
 const state=async()=>(await directoryWorkspace(f.db,await f.actor('owner-a'),{organizationId:'org-a'})).people.find(p=>p.id===person.id).invite;
 const invite=async(who='owner-a',input={})=>access.accessAction(f.db,await f.actor(who),'invite.create',{email:CONTACT,role:'viewer',projectId:'project-a',operationKey:crypto.randomUUID(),...input},origin,secret);
 const revoke=async id=>access.accessAction(f.db,await f.actor('owner-a'),'invite.revoke',{id,operationKey:crypto.randomUUID()},origin);
 return{...f,person,state,invite,revoke};
}

test('not invited, then sent with dates and project; resend keeps one valid link; cancel turns it off',async t=>{
 const f=await fixture(t);
 assert.equal((await f.state()).state,'none');
 const first=await f.invite();
 const sent=await f.state();
 assert.equal(sent.state,'pending');assert.equal(sent.inviteId,first.id);assert.equal(sent.role,'viewer');assert.equal(sent.projectId,'project-a');assert.ok(sent.projectName);
 assert.ok(Date.parse(sent.sentAt)<=Date.now());assert.ok(Date.parse(sent.expiresAt)>Date.now());
 // Resend = a new link, then the previous one is cancelled (only the hash is stored, so the old link cannot be shown again).
 const second=await f.invite();await f.revoke(first.id);
 const resent=await f.state();assert.equal(resent.state,'pending');assert.equal(resent.inviteId,second.id);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM invites WHERE email=? AND revoked_at IS NULL AND accepted_at IS NULL').get(CONTACT).n,1,'only one valid link');
 await f.revoke(second.id);
 assert.equal((await f.state()).state,'cancelled');
});

test('an expired invite shows as expired; accepting shows "already has access" and the link stops working',async t=>{
 const f=await fixture(t);
 const old=await f.invite();
 f.native.prepare('UPDATE invites SET expires_at=? WHERE id=?').run(new Date(Date.now()-60000).toISOString(),old.id);
 assert.equal((await f.state()).state,'expired');
 const fresh=await f.invite();
 f.insert('portal_users',{user_id:'guest',email:CONTACT,status:'active',created_at:f.now,updated_at:f.now});
 f.insert('profiles',{user_id:'guest',display_name:'Pessoa Convidada',created_at:f.now,updated_at:f.now});
 f.users.guest={userId:'guest',email:CONTACT,displayName:'Pessoa Convidada'};
 const token=new URL(fresh.inviteUrl).searchParams.get('token');
 await access.accessAction(f.db,await f.actor('guest'),'invite.accept',{token},origin);
 const accepted=await f.state();assert.equal(accepted.state,'member');assert.equal(accepted.inviteId,null);
 await assert.rejects(access.accessAction(f.db,await f.actor('guest'),'invite.accept',{token},origin),{status:409});
});

test('someone without permission cannot invite or see the pre-registration; another organization sees nothing of it',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.invite('viewer-a'),e=>e.status===403);
 await assert.rejects(directoryWorkspace(f.db,await f.actor('viewer-a'),{organizationId:'org-a'}),{status:403});
 // The same e-mail invited in another organization does not change this organization's view.
 await access.accessAction(f.db,await f.actor('owner-b'),'invite.create',{email:CONTACT,role:'viewer',projectId:'project-b',operationKey:crypto.randomUUID()},origin,secret);
 assert.equal((await f.state()).state,'none');
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM invites WHERE created_by='viewer-a'").get().n,0);
});

test('the ready message carries the name, what the person will access and a link whose code stays after "#"',()=>{
 const url=invitationShareLink(`${origin}/convite?token=${'a'.repeat(43)}`,origin);
 assert.match(url,/\/convite#token=/);assert.doesNotMatch(url,/\?token=/,'the code never goes in the query string');
 const message=inviteMessage({name:'Pessoa Convidada',roleLabel:'Leitor de relatórios',scopeLabel:'Projeto sintético',url,expiresAt:'2099-03-10T15:00:00.000Z'});
 assert.match(message,/^Olá, Pessoa Convidada! Você recebeu um convite para o Portal PROEX UFG como leitor de relatórios, em Projeto sintético\./);
 assert.match(message,/vale até 10\/03\/2099 às 12:00, horário de Brasília/);assert.ok(message.includes(url));assert.match(message,/O link é pessoal/);
 const wa=whatsappShareHref(message);assert.ok(wa.startsWith('https://wa.me/?text='));assert.equal(decodeURIComponent(wa.slice('https://wa.me/?text='.length)),message);
});

test('the screens never log the invite code and the share actions are wired in both places',()=>{
 for(const file of ['../components/portal/directory-invite.tsx','../components/portal/team-invite-share.tsx','../components/portal/directory-panel.tsx']){
  const source=readFileSync(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/console\.(log|info|warn|error)/,`${file} does not log`);
 }
 const share=readFileSync(new URL('../components/portal/team-invite-share.tsx',import.meta.url),'utf8');
 for(const label of ['Enviar por e-mail','Compartilhar no WhatsApp','Copiar mensagem','Copiar link','Mostrar QR code'])assert.ok(share.includes(label),label);
 const dialog=readFileSync(new URL('../components/portal/directory-invite.tsx',import.meta.url),'utf8');
 assert.match(dialog,/invitationShareLink\(String\(created\.inviteUrl\)/,'the link shown and shared is the fragment form');
});
