import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,teamScenario} from './support/work-teams-fixture.mjs';
const {structureWorkspace,structureAction}=await import(compile('lib/institutional-structure/service.ts'));
const {OFFICIAL_TEMPLATE,OFFICIAL_SOURCE}=await import(compile('lib/institutional-structure/contracts.ts'));
async function scenario(t){const f=await teamScenario(t);return{...f,read:async(who='owner-a',input={organizationId:'org-a'})=>structureWorkspace(f.db,await f.actor(who),input),write:async(input,who='owner-a')=>structureAction(f.db,await f.actor(who),{organizationId:'org-a',operationKey:crypto.randomUUID(),expectedVersion:f.native.prepare("SELECT version FROM institutional_structures WHERE organization_id='org-a'").get()?.version??0,...input})};}
const node=(name,parentId=null)=>({action:'node.save',name,parentId,kind:'unit',relation:parentId?'subordination':'root',acronym:'',position:0});
test('migration is empty and reads have no writes; official model is explicit and preserves legacy data',async t=>{
 const f=await scenario(t),before=f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,changes=f.native.prepare('SELECT total_changes() n').get().n;
 const empty=await f.read();assert.equal(empty.version,0);assert.equal(empty.canApplyTemplate,true);assert.deepEqual(empty.nodes,[]);assert.equal(f.native.prepare('SELECT total_changes() n').get().n,changes);
 await f.write({action:'template.apply',nodes:OFFICIAL_TEMPLATE});const result=await f.read();assert.equal(result.nodes.length,11);assert.equal(result.version,1);assert.equal(result.source.adapted,false);assert.equal(result.source.referenceUrl,OFFICIAL_SOURCE.referenceUrl);
 const cec=result.nodes.find(n=>n.acronym==='CEC'),proex=result.nodes.find(n=>n.acronym==='PROEX');assert.equal(proex.parentId,cec.id);assert.equal(proex.relation,'governance');
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,before);assert.equal(f.native.prepare("SELECT role FROM members WHERE user_id='viewer-a'").get().role,'viewer');
 await assert.rejects(f.write({action:'template.apply',nodes:OFFICIAL_TEMPLATE}),{status:409});
});
test('only explicit organization owners can mutate: project manager, affiliation and AI delegation do not qualify',async t=>{
 const f=await scenario(t);f.native.prepare("UPDATE members SET role='manager' WHERE user_id='viewer-a'").run();
 f.insert('ai_configuration_grants',{id:'ai-delegate',organization_id:'org-a',user_id:'viewer-a',grantor_member_id:'member-owner-a',granted_by:'owner-a',created_at:f.now});
 assert.equal((await f.read('viewer-a',{organizationId:'org-a',projectId:'project-a'})).scope.canManage,false);
 await assert.rejects(f.write(node('Não autorizado'),'viewer-a'),{status:403});
 await assert.rejects(f.write(node('Outra organização'),'owner-b'),{status:403});
 f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='viewer-a'").run(f.now);
 await assert.rejects(f.read('viewer-a',{organizationId:'org-a',projectId:'project-a'}),{status:403});
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM institutional_structures').get().n,0);
});
test('project management, team affiliation and AI configuration delegation are three independent negative grants',async t=>{
 for(const grant of ['project-manager','team-affiliation-only','ai-configuration']){
  const f=await scenario(t),who=grant==='team-affiliation-only'?'worker-b':'viewer-a';
  if(grant==='project-manager')f.native.prepare("UPDATE members SET role='manager' WHERE user_id='viewer-a'").run();
  if(grant==='team-affiliation-only')f.insert('followup_team_members',{id:'foreign-affiliation',team_id:f.a,user_id:who,added_by:'owner-a',created_at:f.now});
  if(grant==='ai-configuration')f.insert('ai_configuration_grants',{id:'separate-ai-grant',organization_id:'org-a',user_id:who,grantor_member_id:'member-owner-a',granted_by:'owner-a',created_at:f.now});
  await assert.rejects(f.write(node('Não deve cadastrar'),who),{status:403});
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM institutional_structures').get().n,0);
 }
});
test('project readers receive the formal tree but only team links they already can see, with no roster or hidden identifiers',async t=>{
 const f=await scenario(t),root=await f.write(node('Pró-reitoria de exemplo'));
 for(const teamId of [f.a,f.hidden])await f.write({action:'link.save',nodeId:root.entityId,teamId,linked:true});
 const read=await f.read('viewer-a',{organizationId:'org-a',projectId:'project-a'});
 assert.deepEqual(read.links,[{nodeId:root.entityId,teamId:f.a}]);assert.ok(read.teams.some(t=>t.id===f.a));
 assert.doesNotMatch(JSON.stringify(read),new RegExp([f.hidden,f.b,'Horizonte','reservada B','user_id','@example','members','counts'].join('|')));
 await assert.rejects(f.read('viewer-a',{organizationId:'org-a',projectId:'project-b'}),{status:403});
 await assert.rejects(f.write({action:'link.save',nodeId:root.entityId,teamId:f.b,linked:true}),{status:404});
});
test('SQL independently rejects cycles, cross-org parents/links and archived parents; archive requires children and links closed',async t=>{
 const f=await scenario(t),root=await f.write(node('Raiz')),child=await f.write(node('Filho',root.entityId)),leaf=await f.write(node('Neto',child.entityId));
 await f.write({...node('Outra organização'),organizationId:'org-b',expectedVersion:0},'owner-b');const other=f.native.prepare("SELECT id FROM institutional_nodes WHERE organization_id='org-b'").get().id;
 await assert.rejects(f.write({...node('Raiz',leaf.entityId),id:root.entityId}),{status:409});
 assert.throws(()=>f.native.prepare("UPDATE institutional_nodes SET parent_id=?,relation='subordination' WHERE id=?").run(leaf.entityId,root.entityId),/structure_cycle/);
 assert.throws(()=>f.native.prepare("UPDATE institutional_nodes SET parent_id=?,relation='subordination' WHERE id=?").run(other,child.entityId),/structure_parent_inactive/);
 assert.throws(()=>f.native.prepare("INSERT INTO institutional_team_links(organization_id,node_id,team_id,created_at) VALUES('org-a',?,?,?)").run(root.entityId,f.b,f.now),/structure_link_inactive/);
 await assert.rejects(f.write({action:'node.status',id:root.entityId,status:'archived'}),{status:409});
 await f.write({action:'link.save',nodeId:leaf.entityId,teamId:f.a,linked:true});await assert.rejects(f.write({action:'node.status',id:leaf.entityId,status:'archived'}),{status:409});
 await f.write({action:'link.save',nodeId:leaf.entityId,teamId:f.a,linked:false});await f.write({action:'node.status',id:leaf.entityId,status:'archived'});
 await assert.rejects(f.write(node('Novo filho inválido',leaf.entityId)),{status:409});
 assert.throws(()=>f.native.prepare("UPDATE institutional_nodes SET parent_id=? WHERE id=?").run(leaf.entityId,child.entityId),/structure_parent_inactive|structure_cycle/);
 await f.write({action:'node.status',id:child.entityId,status:'archived'});await assert.rejects(f.write({action:'node.status',id:leaf.entityId,status:'active'}),{status:409});
 assert.equal((await f.read()).nodes.length,1);assert.equal((await f.read('owner-a',{organizationId:'org-a',includeArchived:true})).nodes.length,3);
 await assert.rejects(f.read('viewer-a',{organizationId:'org-a',projectId:'project-a',includeArchived:true}),{status:403});
 await f.write({action:'node.status',id:root.entityId,status:'archived'});assert.deepEqual((await f.read()).nodes,[]);assert.equal((await f.read()).canApplyTemplate,false);
});
test('link boundary permits reaffirmation at 500 but denies a new pair and reactivation of a removed pair',async t=>{
 const f=await scenario(t),root=await f.write(node('Raiz')),second=await f.write(node('Outra unidade'));
 const teams=[f.a,f.a2,f.hidden];for(let i=teams.length;i<500;i++){const id=`boundary-team-${i}`;teams.push(id);f.insert('followup_teams',{id,organization_id:'org-a',name:`Equipe ${i}`,created_by:'owner-a',created_at:f.now,updated_at:f.now});}
 for(const teamId of teams)f.insert('institutional_team_links',{organization_id:'org-a',node_id:root.entityId,team_id:teamId,created_at:f.now});
 const count=()=>f.native.prepare("SELECT COUNT(*) n FROM institutional_team_links WHERE organization_id='org-a' AND revoked_at IS NULL").get().n;
 await f.write({action:'link.save',nodeId:root.entityId,teamId:teams[0],linked:true});assert.equal(count(),500);
 await assert.rejects(f.write({action:'link.save',nodeId:second.entityId,teamId:teams[0],linked:true}),{status:409});assert.equal(count(),500);
 await f.write({action:'link.save',nodeId:root.entityId,teamId:teams[0],linked:false});assert.equal(count(),499);
 await f.write({action:'link.save',nodeId:second.entityId,teamId:teams[0],linked:true});assert.equal(count(),500);
 await assert.rejects(f.write({action:'link.save',nodeId:root.entityId,teamId:teams[0],linked:true}),{status:409});assert.equal(count(),500);
});
test('header CAS serializes edits, mutation keys are actor-scoped, replay is read-authorized and audit never repeats',async t=>{
 const f=await scenario(t),input={...node('Primeira'),operationKey:'stable-operation-01',expectedVersion:0};
 const first=await f.write(input),replay=await f.write(input);assert.equal(replay.duplicate,true);assert.equal(replay.entityId,first.entityId);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='structure.node.save'").get().n,1);
 await assert.rejects(f.write({...input,name:'Mudou conteúdo'}),{status:409});
 const next=await f.write({...node('Segunda'),expectedVersion:1});await assert.rejects(f.write({...node('Terceira'),expectedVersion:1}),{status:409});assert.equal(next.version,2);
 const stale=await f.actor('owner-a');f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner-a'").run(f.now);
 await assert.rejects(structureAction(f.db,stale,{organizationId:'org-a',...input}),{status:403});
 assert.deepEqual(JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='structure.node.save' LIMIT 1").get().details),{version:1,kind:'node.save'});
});
test('revocation between validation and atomic write rolls back header, operation key and node; late reader changes discard the response',async t=>{
 for(const kind of ['write','membership','affiliation','team-archive','node-edit','org-archive']){
  const f=await scenario(t),root=await f.write(node('Área formal'));
  await f.write({action:'link.save',nodeId:root.entityId,teamId:f.hidden,linked:true});
  f.insert('followup_team_members',{id:'temporary-link',team_id:f.hidden,user_id:'viewer-a',added_by:'owner-a',created_at:f.now});
  if(kind==='write'){
   const batch=f.db.batch;f.db.batch=async statements=>{f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner-a'").run(f.now);return batch(statements);};
   const version=(await f.read()).version;await assert.rejects(f.write(node('Não deve gravar')),{status:403});assert.equal(f.native.prepare("SELECT version FROM institutional_structures WHERE organization_id='org-a'").get().version,version);
  }else{
   let fired=false;f.db.afterRead=sql=>{if(fired||!sql.startsWith('WITH caller AS'))return;fired=true;
    if(kind==='membership')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='viewer-a'").run(f.now);
    else if(kind==='affiliation')f.native.prepare("UPDATE followup_team_members SET removed_at=? WHERE id='temporary-link'").run(f.now);
    else if(kind==='team-archive')f.native.prepare('UPDATE followup_teams SET status=\'archived\' WHERE id=?').run(f.hidden);
    else if(kind==='node-edit')f.native.prepare('UPDATE institutional_nodes SET name=? WHERE id=?').run('Nome mudou',root.entityId);
    else f.native.prepare("UPDATE organizations SET status='archived' WHERE id='org-a'").run();
   };
   await assert.rejects(f.read('viewer-a',{organizationId:'org-a',projectId:'project-a'}),{status:403});assert.equal(fired,true);
  }
 }
});
test('template provenance distinguishes edits; long names and validation preserve stored values',async t=>{
 const f=await scenario(t),edited=structuredClone(OFFICIAL_TEMPLATE);edited[0].name='Câmara adaptada de exemplo';
 await f.write({action:'template.apply',nodes:edited});assert.equal((await f.read()).source.adapted,true);
 const long='Unidade '+ 'á'.repeat(152);const saved=await f.write(node(long));assert.equal((await f.read()).nodes.find(n=>n.id===saved.entityId).name,long);
 await assert.rejects(f.write(node('a'.repeat(161))),{status:400});await assert.rejects(f.write({...node('Injeção'),unexpected:'x'}),{status:400});
 await assert.rejects(f.write({action:'source.save',label:'Fonte',revision:'x',issuedOn:'2026-02-31'}),{status:400});
 assert.equal(f.native.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('SQL depth and total limits reject excess nodes and reparenting a tall branch, without partial writes',async t=>{
 const f=await scenario(t);let parent=null;
 for(let depth=1;depth<=8;depth++)parent=(await f.write(node(`Nível ${depth}`,parent))).entityId;
 const before=(await f.read()).version;
 await assert.rejects(f.write(node('Nível nove',parent)),{status:409});assert.equal((await f.read()).version,before);
 const other=await f.write(node('Outra raiz')),branch=await f.write(node('Ramo',other.entityId));
 await assert.rejects(f.write({...node('Outra raiz',parent),id:other.entityId}),{status:409});
 for(let index=10;index<200;index++)f.native.prepare("INSERT INTO institutional_nodes(id,organization_id,name,kind,relation,created_at,updated_at) VALUES(?,'org-a',?,'unit','root',?,?)").run(`synthetic-${index}`,`Unidade ${index}`,f.now,f.now);
 await assert.rejects(f.write(node('Além do limite')),{status:409});assert.equal((await f.read()).nodes.length,200);assert.ok(branch.entityId);
});
test('concurrent writes have one winner and global owners remain explicit organization administrators',async t=>{
 const f=await scenario(t),actor=await f.actor('owner-a'),write=name=>structureAction(f.db,actor,{organizationId:'org-a',operationKey:crypto.randomUUID(),expectedVersion:0,...node(name)});
 const results=await Promise.allSettled([write('A'),write('B')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 f.insert('members',{id:'explicit-global-grant',user_id:'owner-a',email:'owner-a@example.invalid',role:'owner',organization_id:null,project_id:null,created_at:f.now});
 const created=await f.write({...node('Administração global explícita'),organizationId:'org-b',expectedVersion:0});assert.ok(created.entityId);assert.equal((await f.read('owner-a',{organizationId:'org-b'})).scope.canManage,true);
});
test('revocation after an authorized commit hides its receipt and forbids replay instead of returning stale authority',async t=>{
 const f=await scenario(t),actor=await f.actor('owner-a'),batch=f.db.batch;
 f.db.batch=async statements=>{const result=await batch(statements);f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner-a'").run(f.now);return result;};
 const input={organizationId:'org-a',operationKey:'receipt-revocation-01',expectedVersion:0,...node('Gravada antes da revogação')};
 await assert.rejects(structureAction(f.db,actor,input),{status:403});
 // The transaction was authorized at commit time. Losing authority afterwards
 // prevents disclosing its receipt; it cannot retroactively undo a committed edit.
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM institutional_nodes').get().n,1);
 await assert.rejects(structureAction(f.db,actor,input),{status:403});
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='structure.node.save'").get().n,1);
});
