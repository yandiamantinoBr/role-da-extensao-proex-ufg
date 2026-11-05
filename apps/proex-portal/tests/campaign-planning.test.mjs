import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
const {planningWorkspace,planningAction}=await import(compile('lib/campaign-planning/service.ts'));
const {sessionTimeProblem,isCivilDate,isLocalTime}=await import(compile('lib/campaign-planning/contracts.ts'));
const {describePortableSchemas}=await import(compile('lib/sync/portable.ts'));
const drizzle=fileURLToPath(new URL('../drizzle/',import.meta.url)),PLANNING_TABLES=['campaign_planning','campaign_host_contexts','campaign_sessions'];

// Synthetic data only. Roles: owner-a owns org-a; viewer-a reads project-a; other-a2 is inventory
// on project-a2; manager-a manages only the primary; host-manager manages only the host;
// both-manager manages both; both-viewer reads both; owner-b/worker-b belong to org-b.
async function scenario(t){
 const f=teamFixture(t);
 const add=(name,grants)=>{f.insert('portal_users',{user_id:name,email:`${name}@example.invalid`,status:'active',created_at:f.now,updated_at:f.now});f.insert('profiles',{user_id:name,display_name:name,created_at:f.now,updated_at:f.now});
  grants.forEach(([role,project],i)=>f.insert('members',{id:`member-${name}-${i}`,user_id:name,email:`${name}@example.invalid`,role,project_id:project,organization_id:'org-a',created_at:f.now}));f.users[name]={userId:name,email:`${name}@example.invalid`,displayName:name};};
 add('manager-a',[['manager','project-a']]);add('host-manager',[['manager','project-a2']]);
 add('both-manager',[['manager','project-a'],['manager','project-a2']]);add('both-viewer',[['viewer','project-a'],['viewer','project-a2']]);
 f.insert('projects',{id:'project-a3',organization_id:'org-a',name:'Projeto arquivado',status:'archived',created_at:f.now});
 for(const [id,project] of [['campaign-a','project-a'],['campaign-b','project-b']])f.insert('campaigns',{id,project_id:project,name:`Ação sintética ${id}`,rules_text:'Regra reservada sintética',starts_at:'2026-11-10T12:00:00.000Z',ends_at:'2026-11-12T21:00:00.000Z',created_at:f.now});
 const version=(campaign='campaign-a')=>f.native.prepare('SELECT version FROM campaign_planning WHERE campaign_id=?').get(campaign)?.version??0;
 const count=sql=>f.native.prepare(sql).get().n;
 return{...f,version,count,
  read:async(who='owner-a',input={campaignId:'campaign-a'})=>planningWorkspace(f.db,await f.actor(who),input),
  write:async(input,who='owner-a')=>planningAction(f.db,await f.actor(who),{campaignId:'campaign-a',projectId:'project-a',operationKey:crypto.randomUUID(),expectedVersion:version(input.campaignId),...input})};
}
const session=(extra={})=>({action:'session.save',sessionDate:'2026-11-10',ordinal:1,label:'Manhã',...extra});
const host=(linked=true,hostProjectId='project-a2')=>({action:'host.link',hostProjectId,linked});

test('populated 0029 database migrates to 0030 preserving legacy rows; new tables start empty',()=>{
 const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');
 const files=readdirSync(drizzle).filter(name=>name.endsWith('.sql')&&name<='0030_campaign_planning.sql').sort();
 assert.equal(files.at(-1),'0030_campaign_planning.sql');
 for(const name of files.slice(0,-1))native.exec(readFileSync(drizzle+name,'utf8'));
 const now='2026-11-05T12:00:00.000Z';
 native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('org-x','Organização X','org-x',?,?)").run(now,now);
 native.prepare("INSERT INTO projects(id,organization_id,name,created_at) VALUES('project-x','org-x','Projeto X',?)").run(now);
 native.prepare("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,created_at) VALUES('campaign-x','project-x','Ação X','2026-11-10T12:00:00.000Z','2026-11-12T21:00:00.000Z','active',?)").run(now);
 const snapshot=()=>JSON.stringify(['organizations','projects','campaigns','members','audit','items','stock_movements','participations','offers'].map(table=>native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
 const before=snapshot();
 native.exec(readFileSync(drizzle+files.at(-1),'utf8'));
 assert.equal(snapshot(),before);
 for(const table of PLANNING_TABLES)assert.equal(native.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 assert.equal(native.prepare('PRAGMA foreign_key_check').all().length,0);
 // Legacy campaign edits keep working while no planning exists for that campaign.
 native.prepare("UPDATE campaigns SET project_id='project-x',name='Ação X revisada' WHERE id='campaign-x'").run();
 native.close();
});

test('empty workspace: GET writes nothing and exposes minimal campaign data without quantities or resources',async t=>{
 const f=await scenario(t),changes=f.count('SELECT total_changes() n');
 const view=await f.read();
 assert.equal(f.count('SELECT total_changes() n'),changes);for(const table of PLANNING_TABLES)assert.equal(f.count(`SELECT COUNT(*) n FROM ${table}`),0);
 assert.deepEqual(Object.keys(view).sort(),['asOf','campaign','campaignId','canManage','hosts','primaryProjectId','sessions','version','viewerId']);
 assert.deepEqual(Object.keys(view.campaign).sort(),['name','primaryProjectName','status']);
 assert.equal(view.version,0);assert.equal(view.canManage,true);assert.equal(view.primaryProjectId,'project-a');assert.deepEqual(view.sessions,[]);assert.deepEqual(view.hosts,[]);
 assert.doesNotMatch(JSON.stringify(view),/quantity|stock|participa|offer|rules|Regra reservada|@example|email|token|password/i);
 const viewer=await f.read('viewer-a');assert.equal(viewer.canManage,false);assert.equal(viewer.viewerId,'viewer-a');
});

test('ACL: host-only, other-project, cross-org and anonymous readers are denied without campaign metadata; owner project is validated',async t=>{
 const f=await scenario(t),members=f.native.prepare('SELECT id,role,project_id,revoked_at FROM members ORDER BY id').all();await f.write(host());
 for(const who of ['host-manager','other-a2','worker-b','owner-b'])await assert.rejects(f.read(who),{status:403,code:'planning_forbidden'});
 await assert.rejects(planningWorkspace(f.db,null,{campaignId:'campaign-a'}),{status:401});
 await assert.rejects(planningAction(f.db,null,{...session(),campaignId:'campaign-a',projectId:'project-a',expectedVersion:1,operationKey:crypto.randomUUID()}),{status:401});
 await assert.rejects(f.read('owner-a',{campaignId:'campaign-a',projectId:'project-a2'}),{status:409,code:'planning_scope_mismatch'});
 await assert.rejects(f.read('owner-a',{campaignId:'campaign-b',projectId:'project-a'}),{status:403});
 await assert.rejects(f.read('owner-a',{campaignId:'campaign-missing'}),{status:403,code:'planning_forbidden'});
 await assert.rejects(f.write({...session(),projectId:'project-a2'}),{status:409,code:'planning_scope_mismatch'});
 await assert.rejects(f.write({...session(),campaignId:'campaign-b',projectId:'project-b'}),{status:403});
 for(const who of ['viewer-a','host-manager','other-a2','owner-b'])await assert.rejects(f.write(session(),who),{status:403});
 await assert.rejects(f.write({...session(),unexpected:'x'}),{status:400});await assert.rejects(f.write({...session(),quantity:3}),{status:400});
 assert.equal(f.count('SELECT COUNT(*) n FROM campaign_sessions'),0);
 // Linking a host never grants roles: memberships are untouched (no automatic monitor/viewer users).
 assert.deepEqual(JSON.stringify(f.native.prepare('SELECT id,role,project_id,revoked_at FROM members ORDER BY id').all()),JSON.stringify(members));
});

test('host links need campaigns.manage on primary and host in the same organization; SQL guards reject invalid hosts',async t=>{
 const f=await scenario(t);
 await assert.rejects(f.write(host(),'manager-a'),{status:403,code:'planning_host_forbidden'});
 await assert.rejects(f.write(host(),'host-manager'),{status:403,code:'planning_forbidden'});
 await assert.rejects(f.write(host(true,'project-b')),{status:403,code:'planning_host_forbidden'});
 await assert.rejects(f.write(host(true,'project-a')),{status:400});
 await assert.rejects(f.write(host(true,'project-a3')),{status:409,code:'planning_host_invalid'});
 const linked=await f.write(host(),'both-manager');assert.equal(linked.version,1);assert.equal(linked.duplicate,false);
 f.insert('members',{id:'explicit-global',user_id:'owner-b',email:'owner-b@example.invalid',role:'owner',project_id:null,organization_id:null,created_at:f.now});
 await assert.rejects(f.write(host(true,'project-b'),'owner-b'),{status:403,code:'planning_host_forbidden'});
 for(const [project,expected] of [['project-b',/planning_host_invalid/],['project-a',/planning_host_invalid/],['project-a3',/planning_host_invalid/]])
  assert.throws(()=>f.native.prepare("INSERT INTO campaign_host_contexts(campaign_id,host_project_id,created_at,created_by) VALUES('campaign-a',?,?,'synthetic')").run(project,f.now),expected);
 assert.throws(()=>f.native.prepare("UPDATE campaign_host_contexts SET host_project_id='project-a3'").run(),/planning_identity_immutable/);
 assert.throws(()=>f.native.prepare('DELETE FROM campaign_host_contexts').run(),/planning_delete_forbidden/);
 assert.throws(()=>f.native.prepare("UPDATE campaigns SET project_id='project-a2' WHERE id='campaign-a'").run(),/planning_owner_immutable/);
 assert.throws(()=>f.native.prepare("UPDATE projects SET organization_id='org-b' WHERE id='project-a2'").run(),/planning_owner_immutable|organization_transfer_requires_review/);
});

test('hidden hosts are redacted: primary-only readers get no host ids, names or counts; dual readers see allowed context',async t=>{
 const f=await scenario(t);await f.write(host());
 for(const who of ['viewer-a','manager-a']){const view=await f.read(who);assert.deepEqual(view.hosts,[]);assert.doesNotMatch(JSON.stringify(view),/project-a2|Horizonte|hostCount|hidden/);}
 const dual=await f.read('both-viewer');assert.deepEqual(dual.hosts.map(h=>[h.projectId,h.projectName,h.canManage]),[['project-a2','Projeto Horizonte',false]]);
 const managing=await f.read('both-manager');assert.equal(managing.hosts[0].canManage,true);assert.equal(managing.canManage,true);
 assert.deepEqual((await f.read('owner-a')).hosts.map(h=>h.projectId),['project-a2']);
});

test('session rules: tentative may omit both times (stored NULL, never 00:00); confirmed/done need valid ordered times and real dates',async t=>{
 const f=await scenario(t);
 const created=await f.write(session({ordinal:2,startsAt:null,endsAt:null}));
 const row=f.native.prepare('SELECT starts_at,ends_at,status,version FROM campaign_sessions WHERE id=?').get(created.entityId);
 assert.deepEqual({...row},{starts_at:null,ends_at:null,status:'tentative',version:1});assert.equal(created.sessionVersion,1);
 for(const bad of [{status:'confirmed'},{status:'done'},{status:'confirmed',startsAt:'14:00',endsAt:'13:00'},{startsAt:'10:00',endsAt:'10:00'},{startsAt:'10:00'},{startsAt:'24:00',endsAt:'23:00'},{startsAt:'9:00',endsAt:'10:00'},
  {sessionDate:'2026-02-30'},{sessionDate:'2026-13-01'},{sessionDate:'2026-11-10T00:00:00Z'},{ordinal:0},{ordinal:11},{ordinal:1.5},{label:'x'.repeat(101)},{note:'n'.repeat(501)},{status:'archived'}])
  await assert.rejects(f.write(session({ordinal:3,...bad})),{status:400},JSON.stringify(bad));
 await f.write(session({ordinal:1,status:'confirmed',startsAt:'09:00',endsAt:'11:30'}));
 await f.write(session({sessionDate:'2026-11-09',ordinal:3,label:'Noite'}));
 await assert.rejects(f.write(session({ordinal:1,label:'Repetida'})),{status:409,code:'planning_slot_taken'});
 await assert.rejects(f.write({action:'session.status',id:created.entityId,expectedSessionVersion:1,status:'confirmed'}),{status:409,code:'planning_session_times'});
 assert.throws(()=>f.native.prepare("UPDATE campaign_sessions SET status='confirmed',version=version+1 WHERE id=?").run(created.entityId),/CHECK constraint failed/);
 assert.throws(()=>f.native.prepare("INSERT INTO campaign_sessions(id,campaign_id,session_date,ordinal,starts_at,ends_at,created_at,updated_at) VALUES('raw','campaign-a','2026-11-11',1,'25:00','26:00',?,?)").run(f.now,f.now),/CHECK constraint failed/);
 assert.throws(()=>f.native.prepare('DELETE FROM campaign_sessions').run(),/planning_delete_forbidden/);
 const view=await f.read('viewer-a');assert.deepEqual(view.sessions.map(s=>[s.sessionDate,s.ordinal]),[['2026-11-09',3],['2026-11-10',1],['2026-11-10',2]]);
 assert.ok(view.sessions.every(s=>!('quantity' in s)));
 assert.equal(isCivilDate('2028-02-29'),true);assert.equal(isCivilDate('2027-02-29'),false);assert.equal(isLocalTime('23:59'),true);assert.equal(isLocalTime('24:00'),false);
 assert.equal(sessionTimeProblem('tentative',null,null),null);assert.ok(sessionTimeProblem('done',null,null));
});

test('header and row CAS: stale versions roll back, no-op edits are rejected without versions, keys reject changed payloads',async t=>{
 const f=await scenario(t),input={...session(),operationKey:'stable-operation-01',expectedVersion:0};
 const first=await f.write(input),replay=await f.write(input);
 assert.equal(replay.duplicate,true);assert.equal(replay.entityId,first.entityId);assert.equal(replay.version,1);
 assert.equal(f.count("SELECT COUNT(*) n FROM audit WHERE action='campaign_planning.session.save'"),1);
 await assert.rejects(f.write({...input,label:'Outra'}),{status:409,code:'operation_changed'});
 await assert.rejects(f.write({...session({ordinal:2}),expectedVersion:0}),{status:409,code:'planning_conflict'});
 assert.equal(f.count('SELECT COUNT(*) n FROM campaign_sessions'),1);assert.equal(f.version(),1);
 const edit={...session({label:'Manhã revisada',startsAt:null,endsAt:null,status:'tentative',note:''}),id:first.entityId,expectedSessionVersion:1};
 const edited=await f.write(edit);assert.equal(edited.version,2);assert.equal(edited.sessionVersion,2);
 await assert.rejects(f.write({...edit,label:'Mais uma'}),{status:409,code:'planning_session_conflict'});
 const key=crypto.randomUUID();
 await assert.rejects(f.write({...edit,expectedSessionVersion:2,operationKey:key}),{status:409,code:'planning_unchanged'});
 assert.equal(f.version(),2);assert.equal(f.count("SELECT COUNT(*) n FROM audit WHERE action LIKE 'campaign_planning.%'"),2);
 const cancelled=await f.write({action:'session.status',id:first.entityId,expectedSessionVersion:2,status:'cancelled',operationKey:key});
 assert.equal(cancelled.version,3);assert.equal(f.count('SELECT COUNT(*) n FROM campaign_sessions'),1);
 await assert.rejects(f.write({action:'session.status',id:'missing-session',expectedSessionVersion:1,status:'cancelled'}),{status:404});
 assert.throws(()=>f.native.prepare("UPDATE campaign_planning SET version=version+2 WHERE campaign_id='campaign-a'").run(),/planning_version_step/);
 assert.throws(()=>f.native.prepare('UPDATE campaign_sessions SET label=?').run('sem versão'),/planning_version_step/);
 const actor=await f.actor('owner-a'),race=ordinal=>planningAction(f.db,actor,{campaignId:'campaign-a',projectId:'project-a',operationKey:crypto.randomUUID(),expectedVersion:3,...session({ordinal})});
 const results=await Promise.allSettled([race(5),race(6)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
});

test('link/unlink are idempotent: repeats leave version and audit intact, reactivation audits meaningful identities once',async t=>{
 const f=await scenario(t),audits=()=>f.count("SELECT COUNT(*) n FROM audit WHERE action='campaign_planning.host.link'");
 await f.write(host());assert.equal(f.version(),1);
 const again=await f.write(host());assert.equal(again.version,1);assert.equal(f.version(),1);assert.equal(audits(),1);
 await f.write(host(false));assert.equal(f.version(),2);
 const repeat=await f.write(host(false));assert.equal(repeat.version,2);assert.equal(f.version(),2);assert.equal(audits(),2);
 const reactivate={...host(),operationKey:crypto.randomUUID(),expectedVersion:2};await f.write(reactivate);assert.equal(f.version(),3);
 assert.equal((await f.write(reactivate)).duplicate,true);assert.equal(audits(),3);
 const events=f.native.prepare("SELECT details FROM audit WHERE action='campaign_planning.host.link' ORDER BY rowid").all().map(r=>JSON.parse(r.details));
 for(const event of events)assert.deepEqual(Object.keys(event).sort(),['campaignId','hostProjectId','kind','linked','version']);
 assert.deepEqual(events.map(e=>[e.linked,e.version]),[[true,1],[false,2],[true,3]]);
 assert.doesNotMatch(f.native.prepare("SELECT group_concat(details) d FROM audit WHERE action LIKE 'campaign_planning.%'").get().d,/@|Manhã|Horizonte/);
});

test('revocation between validation and commit rolls back header, key and rows; post-commit revocation hides the receipt and replay',async t=>{
 for(const kind of ['primary','host','organization']){
  const f=await scenario(t),batch=f.db.batch;
  f.db.batch=async statements=>{f.db.batch=batch;
   if(kind==='primary')f.native.prepare("UPDATE members SET revoked_at=? WHERE id='member-both-manager-0'").run(f.now);
   else if(kind==='host')f.native.prepare("UPDATE members SET revoked_at=? WHERE id='member-both-manager-1'").run(f.now);
   else f.native.prepare("UPDATE organizations SET status='archived' WHERE id='org-a'").run();
   return batch(statements);};
  await assert.rejects(f.write(host(),'both-manager'),{status:403});
  assert.equal(f.count('SELECT COUNT(*) n FROM campaign_planning'),0);assert.equal(f.count('SELECT COUNT(*) n FROM campaign_host_contexts'),0);assert.equal(f.count('SELECT COUNT(*) n FROM mutation_keys'),0);
 }
 const f=await scenario(t),stale=await f.actor('manager-a');
 f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager-a'").run(f.now);
 await assert.rejects(planningAction(f.db,stale,{campaignId:'campaign-a',projectId:'project-a',operationKey:crypto.randomUUID(),expectedVersion:0,...session()}),{status:403});
 const g=await scenario(t),actor=await g.actor('manager-a'),batch=g.db.batch;
 g.db.batch=async statements=>{const result=await batch(statements);g.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager-a'").run(g.now);return result;};
 const input={campaignId:'campaign-a',projectId:'project-a',operationKey:'receipt-revocation-01',expectedVersion:0,...session()};
 await assert.rejects(planningAction(g.db,actor,input),{status:403});
 assert.equal(g.count('SELECT COUNT(*) n FROM campaign_sessions'),1);
 await assert.rejects(planningAction(g.db,actor,input),{status:403});
 assert.equal(g.count("SELECT COUNT(*) n FROM audit WHERE action='campaign_planning.session.save'"),1);
});

test('changes between the two reads discard the response: access changes are 403, content changes are 409',async t=>{
 for(const kind of ['primary-revoked','host-hidden','org-archived','session-edited']){
  const f=await scenario(t);await f.write(host());const created=await f.write(session());
  let fired=false;f.db.afterRead=sql=>{if(fired||!sql.startsWith('WITH planning_caller'))return;fired=true;
   if(kind==='primary-revoked')f.native.prepare("UPDATE members SET revoked_at=? WHERE id='member-both-viewer-0'").run(f.now);
   else if(kind==='host-hidden')f.native.prepare("UPDATE members SET revoked_at=? WHERE id='member-both-viewer-1'").run(f.now);
   else if(kind==='org-archived')f.native.prepare("UPDATE organizations SET status='archived' WHERE id='org-a'").run();
   else f.native.prepare('UPDATE campaign_sessions SET label=?,version=version+1 WHERE id=?').run('Mudou',created.entityId);};
  await assert.rejects(f.read('both-viewer'),{status:kind==='session-edited'?409:403});assert.equal(fired,true);
 }
});

test('backup scope: complete SQLite backups carry the three tables; the curated spreadsheet export does not expose host links',async t=>{
 const f=await scenario(t);
 const tables=f.native.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'campaign_%' ORDER BY name").all().map(r=>r.name);
 for(const table of PLANNING_TABLES)assert.ok(tables.includes(table));
 const exported=describePortableSchemas().tables.map(t=>t.table);for(const table of PLANNING_TABLES)assert.equal(exported.includes(table),false);
 const columns=PLANNING_TABLES.flatMap(table=>f.native.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
 assert.doesNotMatch(columns.join(','),/quantity|stock|participant|email|token|secret|url/);
});


test('review regressions: no-op never-linked unlink leaves no header/key, archive is read-only, and partial edit cannot erase fields',async t=>{
 const f=await scenario(t);
 await assert.rejects(f.write(host(false)),{status:409,code:'planning_unchanged'});
 assert.equal(f.count('SELECT COUNT(*) n FROM campaign_planning'),0);assert.equal(f.count('SELECT COUNT(*) n FROM mutation_keys'),0);
 const created=await f.write(session({label:'Conferida',startsAt:'18:00',endsAt:'19:30',status:'confirmed',note:'Preservar'}));
 await assert.rejects(f.write({action:'session.save',id:created.entityId,expectedSessionVersion:1,sessionDate:'2026-11-10',ordinal:1,label:'Só nome'}),{status:400,code:'planning_session_fields'});
 assert.equal((await f.read()).sessions[0].note,'Preservar');assert.equal((await f.read()).sessions[0].status,'confirmed');
 f.native.prepare("UPDATE projects SET status='archived' WHERE id='project-a'").run();
 assert.equal((await f.read()).canManage,false);
 await assert.rejects(f.write(session({ordinal:2})),{status:403});await assert.rejects(f.write(host()),{status:403});
 assert.equal(f.count('SELECT COUNT(*) n FROM campaign_sessions'),1);
});

test('review regressions: host audit targets campaign and session audit retains before/after values',async t=>{
 const f=await scenario(t);await f.write(host());
 const link=f.native.prepare("SELECT entity_id,details FROM audit WHERE action='campaign_planning.host.link'").get();assert.equal(link.entity_id,'campaign-a');assert.equal(JSON.parse(link.details).hostProjectId,'project-a2');
 assert.equal(f.count("SELECT COUNT(*) n FROM audit WHERE entity_id='project-a2'"),0);
 const created=await f.write(session({label:'Antes',note:'Texto original'}));
 await f.write({...session({label:'Depois',note:'Texto revisado',startsAt:'18:00',endsAt:'19:30',status:'confirmed'}),id:created.entityId,expectedSessionVersion:1});
 const details=f.native.prepare("SELECT details FROM audit WHERE action='campaign_planning.session.save' AND json_extract(details,'$.sessionVersion')=2").get();
 const audit=JSON.parse(details.details);assert.equal(audit.before.label,'Antes');assert.equal(audit.before.note,'Texto original');assert.equal(audit.before.startsAt,null);assert.equal(audit.after.label,'Depois');assert.equal(audit.after.note,'Texto revisado');assert.equal(audit.after.startsAt,'18:00');
});

test('review regressions: same-key concurrent writes produce one row and one auditable operation',async t=>{
 const f=await scenario(t),input={...session(),expectedVersion:0,operationKey:'same-key-concurrent-review'};
 const receipts=await Promise.all([f.write(input),f.write(input)]);assert.deepEqual(receipts.map(r=>r.duplicate).sort(),[false,true]);assert.equal(receipts[0].entityId,receipts[1].entityId);assert.equal(f.count('SELECT COUNT(*) n FROM campaign_sessions'),1);assert.equal(f.count('SELECT COUNT(*) n FROM audit'),1);
 const key='same-key-host-review',hostInput={...host(),expectedVersion:1,operationKey:key};const links=await Promise.all([f.write(hostInput),f.write(hostInput)]);assert.deepEqual(links.map(r=>r.duplicate).sort(),[false,true]);assert.equal(f.version(),2);
});

test('additive repair rejects impossible institutional dates without modifying applied 0029',async t=>{
 const f=await scenario(t);
 assert.throws(()=>f.native.prepare("INSERT INTO institutional_structures(organization_id,source_issued_on,created_at,updated_at) VALUES('org-a','2026-99-01',?,?)").run(f.now,f.now),/structure_source_date_invalid/);
 f.native.prepare("INSERT INTO institutional_structures(organization_id,source_issued_on,created_at,updated_at) VALUES('org-a','2026-07-28',?,?)").run(f.now,f.now);
 assert.throws(()=>f.native.prepare("UPDATE institutional_structures SET source_issued_on='2026-02-30' WHERE organization_id='org-a'").run(),/structure_source_date_invalid/);
 assert.equal(f.native.prepare("SELECT source_issued_on FROM institutional_structures WHERE organization_id='org-a'").get().source_issued_on,'2026-07-28');
});
