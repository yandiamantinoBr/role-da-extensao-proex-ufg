import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
const {directoryWorkspace,directoryDetail,directoryAction}=await import(compile('lib/directory/service.ts'));
const {PROEX_TEAM}=await import(compile('lib/catalog/proex-team.ts'));
async function fixture(t){const f=teamFixture(t);return{...f,read:async(who='owner-a',organizationId='org-a')=>directoryWorkspace(f.db,await f.actor(who),{organizationId}),detail:async(personId,who='owner-a',organizationId='org-a')=>directoryDetail(f.db,await f.actor(who),{organizationId,personId}),write:async(input,who='owner-a')=>directoryAction(f.db,await f.actor(who),{organizationId:'org-a',operationKey:crypto.randomUUID(),...input})};}
const create=(patch={})=>({action:'person.create',name:'Pessoa de exemplo',position:'Apoio à organização',sector:'Área de exemplo',contact:'apoio@example.invalid',status:'pending',...patch});
const update=(person,patch={})=>({action:'person.update',personId:person.id,expectedVersion:person.version,name:person.name,position:person.position,sector:person.sector,contact:person.contact,status:person.status,...patch});

test('empty migration and read create no directory, authentication, invitation, membership or notification',async t=>{
 const f=await fixture(t),before=f.native.prepare('SELECT total_changes() n').get().n;assert.deepEqual((await f.read()).people,[]);assert.equal(f.native.prepare('SELECT total_changes() n').get().n,before);
 const tables=['portal_users','auth_user','identity_aliases','profiles','invites','members','followup_assignees','followup_notifications','work_responsibility_assignees','followup_team_members'];const count=()=>tables.map(table=>f.native.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n),old=count();
 const saved=await f.write(create());assert.deepEqual(count(),old);assert.equal(saved.person.status,'pending');assert.equal(saved.person.sourceKind,'manual');assert.equal(saved.person.version,1);assert.equal(saved.history.length,1);assert.ok(!('userId'in saved.person));
 assert.deepEqual(JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='directory.person.create'").get().details),{version:1,status:'pending',sourceKind:'manual'});
});
test('only current institutional administration sees private people or history, including negative project/team/AI grants',async t=>{
 const f=await fixture(t),saved=await f.write(create());f.native.prepare("UPDATE members SET role='manager' WHERE user_id='viewer-a'").run();
 for(const who of ['viewer-a','owner-b','worker-b']){await assert.rejects(f.read(who),{status:403});await assert.rejects(f.detail(saved.person.id,who),{status:403});await assert.rejects(f.write(create(),who),{status:403});}
 await assert.rejects(directoryWorkspace(f.db,null,{organizationId:'org-a'}),{status:401});await assert.rejects(f.detail(saved.person.id,'owner-b','org-b'),{status:404});
 f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='owner-a'").run();await assert.rejects(f.read(),{status:401});
});
test('preparing an official reference is explicit, retains source dates and leaves doubtful contacts under review without automatic correction',async t=>{
 const f=await fixture(t),entry=PROEX_TEAM.find(person=>person.contactStatus==='needs-review');const saved=await f.write({action:'official.prepare',referenceId:entry.id});
 assert.equal(saved.person.contact,entry.email);assert.equal(saved.person.contactStatus,'review');assert.equal(saved.person.status,'review');assert.equal(saved.person.sourceKind,'official');assert.match(saved.person.checkedOn,/^2026-/);
 await assert.rejects(f.write({action:'official.prepare',referenceId:entry.id}),{status:409,code:'directory_exists'});
 await assert.rejects(f.write(update(saved.person,{status:'pending'})),{status:400,code:'directory_review'});
 const archived=await f.write(update(saved.person,{status:'archived'}));assert.equal(archived.person.status,'archived');assert.equal(archived.person.contact,entry.email);
 const corrected=await f.write(update(archived.person,{contact:'corrigido@example.invalid',status:'pending'}));assert.equal(corrected.person.contactStatus,'entered');assert.equal(corrected.person.adapted,true);assert.equal(corrected.person.sourceUrl,saved.person.sourceUrl);assert.equal(corrected.history.at(-1).person.contact,entry.email);
 const actual=PROEX_TEAM.find(person=>person.contactStatus==='published'),published=await f.write({action:'official.prepare',referenceId:actual.id});assert.equal(published.person.contactStatus,'published');assert.equal(published.person.status,'pending');
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM invites').get().n,0);
});
test('edits are versioned, preserve history and archive reversibly without creating a linked account state',async t=>{
 const f=await fixture(t),first=await f.write(create()),second=await f.write(update(first.person,{name:'Nome atualizado',status:'review'}));assert.equal(second.person.version,2);assert.equal(second.history[1].person.name,first.person.name);
 const archived=await f.write(update(second.person,{status:'archived'}));assert.equal(archived.person.version,3);const restored=await f.write(update(archived.person,{status:'pending'}));assert.equal(restored.person.version,4);
 await assert.rejects(f.write(update(restored.person,{status:'linked'})),{status:400});await assert.rejects(f.write(update(restored.person,{userId:'viewer-a'})),{status:400});
 assert.throws(()=>f.native.prepare('DELETE FROM directory_people WHERE id=?').run(first.person.id),/directory_archive_required/);assert.throws(()=>f.native.prepare("UPDATE directory_people_history SET snapshot_json='{}' WHERE person_id=?").run(first.person.id),/directory_history_immutable/);
 assert.throws(()=>f.native.prepare("UPDATE directory_people SET organization_id='org-b',version=version+1 WHERE id=?").run(first.person.id),/directory_identity_immutable/);
 assert.throws(()=>f.native.prepare('UPDATE directory_people SET version=version WHERE id=?').run(first.person.id),/directory_version_changed/);
});
test('CAS and idempotency reject conflicting intents; replay never repeats audit/history or crosses actor/organization',async t=>{
 const f=await fixture(t),input=create({operationKey:'stable-create-01'}),first=await f.write(input),replay=await f.write(input);assert.equal(replay.person.id,first.person.id);assert.equal(replay.duplicate,true);assert.equal(replay.history.length,1);
 await assert.rejects(f.write({...input,name:'Outro conteúdo'}),{status:409});const result=await Promise.allSettled([f.write(update(first.person,{position:'Opção A'})),f.write(update(first.person,{position:'Opção B'}))]);assert.equal(result.filter(row=>row.status==='fulfilled').length,1);assert.equal(result.find(row=>row.status==='rejected').reason.status,409);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action LIKE 'directory.%'").get().n,2);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM directory_people_history').get().n,2);
 await assert.rejects(f.write({...update(first.person),organizationId:'org-b'},'owner-b'),{status:404});
});
test('revocation at commit rolls back the whole write; revocation after commit hides receipt and replay',async t=>{
 for(const timing of ['before','after']){const f=await fixture(t),actor=await f.actor('owner-a'),batch=f.db.batch;f.db.batch=async statements=>{if(timing==='before')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner-a'").run(f.now);const result=await batch(statements);if(timing==='after')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner-a'").run(f.now);return result;};
  const input={organizationId:'org-a',operationKey:'stable-revocation-01',...create()};await assert.rejects(directoryAction(f.db,actor,input),{status:403});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM directory_people').get().n,timing==='before'?0:1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM directory_people_history').get().n,timing==='before'?0:1);await assert.rejects(directoryAction(f.db,actor,input),{status:403});
 }
});
test('late revocation/content edits are fenced and do not return a stale private snapshot',async t=>{
 for(const change of ['revoke','block','organization','edit']){const f=await fixture(t),saved=await f.write(create());let fired=false;f.db.afterRead=sql=>{if(fired||!sql.startsWith('WITH caller AS'))return;fired=true;if(change==='revoke')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner-a'").run(f.now);if(change==='block')f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='owner-a'").run();if(change==='organization')f.native.prepare("UPDATE organizations SET status='archived' WHERE id='org-a'").run();if(change==='edit')f.native.prepare("UPDATE directory_people SET name='Nome concorrente',version=version+1 WHERE id=?").run(saved.person.id);};await assert.rejects(f.read(),{status:change==='edit'?409:403});assert.equal(fired,true);}
});
test('malformed fields, source spoofing, projected identities and limit overflow are rejected without partial history',async t=>{
 const f=await fixture(t);for(const patch of [{name:''},{name:'a'.repeat(161)},{contact:'nome\n@example.invalid'},{status:'linked'},{sourceKind:'official'},{userId:'viewer-a'},{operationKey:''}])await assert.rejects(f.write(create(patch)),{status:400});
 await assert.rejects(f.write({action:'official.prepare',referenceId:'unknown'}),{status:404});
 for(let n=0;n<500;n++)f.insert('directory_people',{id:`synthetic-${n}`,organization_id:'org-a',name:`Pessoa ${n}`,contact_status:'entered',source_kind:'manual',checked_on:'2026-11-06',created_by:'owner-a',created_at:f.now,updated_at:f.now});
 await assert.rejects(f.write(create()),{status:409,code:'directory_limit'});assert.equal((await f.read()).people.length,500);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM directory_people_history').get().n,0);assert.deepEqual(f.native.prepare('PRAGMA foreign_key_check').all(),[]);
});
