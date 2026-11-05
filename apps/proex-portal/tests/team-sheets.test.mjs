import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compile, teamScenario } from './support/work-teams-fixture.mjs';
const api=await import(compile('lib/sync/team-sheets.ts'));
const {callTeamSheetTool}=await import(compile('lib/sync/team-sheets-data.ts'));
const {configureProjectSheet,projectSheetPrincipal}=await import(compile('lib/sync/project-sheets.ts'));
const {configureSync}=await import(compile('lib/sync/control.ts'));
const workbook='SyntheticTeamWorkbook01',origin='http://127.0.0.1:5192';
async function fixture(t){
 const f=await teamScenario(t),owner=await f.actor('owner-a');
 await f.act('owner-a','team.update',{id:f.a,expectedVersion:1,userIds:['owner-a','viewer-a','other-a2']});
 f.insert('portal_users',{user_id:'platform',email:'platform@example.invalid',status:'active',created_at:f.now,updated_at:f.now});
 f.insert('members',{id:'platform-grant',user_id:'platform',email:'platform@example.invalid',role:'owner',project_id:null,organization_id:null,created_at:f.now});
 f.users.platform={userId:'platform',email:'platform@example.invalid',displayName:'Gestão sintética'};
 return{...f,owner,configure:(spreadsheetId=workbook,extra={})=>api.configureTeamSheet(f.db,owner,f.a,'project-a',{action:'configure',spreadsheetId,expectedVersion:0,...extra})};
}
async function connected(t){const f=await fixture(t);await f.configure();const issued=await api.createTeamSheetToken(f.db,f.owner,f.a,'project-a',{action:'token.create',expectedVersion:1});const principal=await api.teamSheetPrincipal(f.db,'Bearer '+issued.token,workbook);return{...f,issued,principal,call:(tool,args={})=>callTeamSheetTool(f.db,principal,tool,args,origin)};}
async function read(f){const run=await f.call('proex_sync_run_start',{requestId:crypto.randomUUID()});const page=await f.call('proex_sync_read',{table:'followup_tasks',runId:run.id});return{run,page};}

test('dedicated team projector contains only this team/project and no bodies, identities or checklists',async t=>{
 const f=await connected(t);f.native.prepare("UPDATE followup_tasks SET body='BODY_CANARY hidden@example.invalid' WHERE id=?").run(f.shared);
 const described=await f.call('proex_sync_describe'),{page}=await read(f);
 assert.equal(described.configuration.readOnly,true);assert.equal(described.configuration.teamId,f.a);assert.equal(described.schemas.tables.length,1);
 assert.equal(page.rows.length,2);assert.equal(page.readOnly,true);assert.ok(page.schema.columns.every(c=>c.editable===false));
 assert.deepEqual(new Set(page.rows.map(row=>row.title)),new Set(['Conferir materiais do evento','Artes prontas para avaliação']));
 assert.doesNotMatch(JSON.stringify(page),/BODY_CANARY|hidden@|Horizonte|reservada B|viewer-a|owner-a|other-a2/);
 assert.ok(page.rows.every(row=>row.portal_url.includes('module=demands')&&row.portal_url.includes('project=project-a')&&row.portal_url.includes('demandId=')));
 assert.ok(page.rows.every(row=>/^[a-f0-9]{64}$/.test(row._rowHash)));
 for(const tool of ['proex_sync_apply','proex_sync_configure'])await assert.rejects(f.call(tool,{}),{status:403,code:'team_sheet_read_only'});
 await assert.rejects(f.call('proex_sync_read',{table:'items',runId:'synthetic-run-id'}),{status:400});
});

test('token purpose, file, management and affiliation are independent boundaries',async t=>{
 const f=await connected(t),viewer=await f.actor('viewer-a');
 assert.match(f.issued.token,/^pxt_[A-Za-z0-9_-]{43}$/);
 const persisted=f.native.prepare('SELECT * FROM team_sheet_tokens WHERE id=?').get(f.issued.id);assert.notEqual(persisted.token_hash,f.issued.token);assert.equal(persisted.token_hash.length,64);
 for(const prefix of ['pxp_','pxs_','pxm_'])await assert.rejects(api.teamSheetPrincipal(f.db,'Bearer '+prefix+'a'.repeat(43),workbook),{status:401});
 await assert.rejects(projectSheetPrincipal(f.db,'Bearer '+f.issued.token,workbook),{status:401});
 await assert.rejects(api.teamSheetPrincipal(f.db,'Bearer '+f.issued.token,'OtherSyntheticWorkbook'),{status:403});
 await assert.rejects(api.createTeamSheetToken(f.db,viewer,f.a,'project-a',{action:'token.create',expectedVersion:1}),{status:403});
 await assert.rejects(api.teamSheetStatus(f.db,await f.actor('owner-b'),f.a,'project-a'),{status:403});
 await assert.rejects(api.teamSheetStatus(f.db,f.owner,f.a,'project-b'),{status:403});
 await assert.rejects(f.call('proex_sync_read',{table:'followup_tasks',projectId:'project-a2',runId:'synthetic-run-id'}),{status:400});
});

test('rename keeps retained affiliations and key; removal/re-entry never revives the old key',async t=>{
 const f=await connected(t),old=f.native.prepare("SELECT id FROM followup_team_members WHERE team_id=? AND user_id='owner-a' AND removed_at IS NULL").get(f.a).id;
 await f.act('owner-a','team.update',{id:f.a,expectedVersion:2,name:'Equipe renomeada'});
 assert.equal(f.native.prepare("SELECT id FROM followup_team_members WHERE team_id=? AND user_id='owner-a' AND removed_at IS NULL").get(f.a).id,old);
 assert.equal((await api.teamSheetPrincipal(f.db,'Bearer '+f.issued.token,workbook)).teamMemberId,old);
 await f.act('owner-a','team.update',{id:f.a,expectedVersion:3,userIds:['viewer-a','other-a2']});
 await assert.rejects(api.teamSheetPrincipal(f.db,'Bearer '+f.issued.token,workbook),{status:403});
 await f.act('owner-a','team.update',{id:f.a,expectedVersion:4,userIds:['owner-a','viewer-a','other-a2']});
 assert.notEqual(f.native.prepare("SELECT id FROM followup_team_members WHERE team_id=? AND user_id='owner-a' AND removed_at IS NULL").get(f.a).id,old);
 await assert.rejects(api.teamSheetPrincipal(f.db,'Bearer '+f.issued.token,workbook),{status:403});
 assert.ok(f.native.prepare('SELECT revoked_at FROM team_sheet_tokens WHERE id=?').get(f.issued.id).revoked_at);
});

test('revocation during page read and immediately before its receipt never acknowledges a successful sync',async t=>{
 for(const kind of ['read','receipt','grant']){
  const f=await connected(t),run=await f.call('proex_sync_run_start',{requestId:crypto.randomUUID()});
  if(kind==='read'){
   let fired=false;f.db.afterRead=sql=>{if(!fired&&sql.startsWith('SELECT t.id _rowKey')){fired=true;f.native.prepare('UPDATE followup_team_members SET removed_at=? WHERE id=?').run(f.now,f.principal.teamMemberId);}};
   await assert.rejects(f.call('proex_sync_read',{table:'followup_tasks',runId:run.id}),{status:403});
  }else{
   const page=await f.call('proex_sync_read',{table:'followup_tasks',runId:run.id});
   const original=f.db.batch.bind(f.db);let fired=false;f.db.batch=async statements=>{if(!fired){fired=true;if(kind==='grant')f.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(f.now,f.principal.memberId);else f.native.prepare('UPDATE followup_team_members SET removed_at=? WHERE id=?').run(f.now,f.principal.teamMemberId);}return original(statements);};
   await assert.rejects(f.call('proex_sync_run_finish',{id:run.id,status:'completed',exportedCount:page.total,readbackVerified:true,tablesVerified:1,snapshotDigest:page.digest}),{status:403});
  }
  assert.notEqual(f.native.prepare('SELECT status FROM team_sheet_runs WHERE id=?').get(run.id).status,'completed');
 }
});

test('assignment removal during projection refuses a stale snapshot even when the issuer keeps its grant and affiliation',async t=>{
 const f=await connected(t),run=await f.call('proex_sync_run_start',{requestId:crypto.randomUUID()});let fired=false;
 f.db.afterRead=sql=>{if(!fired&&sql.startsWith('SELECT t.id _rowKey')){fired=true;f.native.prepare('UPDATE followup_assignees SET removed_at=? WHERE team_id=? AND task_id=?').run(f.now,f.a,f.shared);}};
 await assert.rejects(f.call('proex_sync_read',{table:'followup_tasks',runId:run.id}),{status:409,code:'sync_snapshot_changed'});
 assert.equal(fired,true);
});

test('receipt needs matching digest, count and explicit readback; replay cannot bypass revoked credentials',async t=>{
 const f=await connected(t),{run,page}=await read(f),input={id:run.id,status:'completed',exportedCount:page.total,readbackVerified:true,tablesVerified:1,snapshotDigest:page.digest};
 assert.equal((await f.call('proex_sync_run_finish',input)).status,'completed');assert.equal((await f.call('proex_sync_run_finish',input)).duplicate,true);
 await api.revokeTeamSheetToken(f.db,f.owner,f.a,'project-a',{action:'token.revoke',id:f.issued.id});await assert.rejects(f.call('proex_sync_run_finish',input),{status:403});
 const other=await connected(t),data=await read(other);assert.equal((await other.call('proex_sync_run_finish',{id:data.run.id,status:'completed',exportedCount:data.page.total,readbackVerified:false,tablesVerified:1,snapshotDigest:data.page.digest})).status,'failed');
});

test('master/project/team file collisions are refused in both directions, including direct SQL',async t=>{
 for(const kind of ['master-first','team-first-master','project-first','team-first-project','team-second']){
  const f=await fixture(t),platform=await f.actor('platform');
  const master=()=>configureSync(f.db,platform,{spreadsheetId:workbook,folderId:'SyntheticFolder0001',attachmentsFolderId:'SyntheticFolder0002'});
  const project=()=>configureProjectSheet(f.db,f.owner,'project-a',{spreadsheetId:workbook,expectedVersion:0});
  if(kind==='master-first'){await master();await assert.rejects(f.configure(),{status:409});}
  if(kind==='project-first'){await project();await assert.rejects(f.configure(),{status:409});}
  if(kind.startsWith('team-first')||kind==='team-second'){
   await f.configure();
   if(kind==='team-first-master')await assert.rejects(master(),{status:409});
   if(kind==='team-first-project')await assert.rejects(project(),{status:409});
   if(kind==='team-second')await assert.rejects(api.configureTeamSheet(f.db,f.owner,f.a2,'project-a',{action:'configure',spreadsheetId:workbook,expectedVersion:0}),{status:409});
   assert.throws(()=>f.native.prepare('INSERT INTO settings(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run('sync.google_sheets.configuration',JSON.stringify({spreadsheetId:workbook})),/team_sheet_file_collision/);
  }
 }
});

test('switching workbook invalidates old tokens, and the migration aborts clearly before modifying collided legacy data',async t=>{
 const f=await connected(t);await f.configure('SyntheticTeamWorkbook02',{expectedVersion:1});await assert.rejects(api.teamSheetPrincipal(f.db,'Bearer '+f.issued.token,workbook),{status:403});
 const native=new DatabaseSync(':memory:');t.after(()=>native.close());native.exec('CREATE TABLE project_sheet_connections(spreadsheet_id TEXT);CREATE TABLE settings(name TEXT,value TEXT);');
 native.prepare('INSERT INTO project_sheet_connections VALUES(?)').run(workbook);native.prepare('INSERT INTO settings VALUES(?,?)').run('sync.google_sheets.configuration',JSON.stringify({spreadsheetId:workbook}));
 assert.throws(()=>native.exec(readFileSync(new URL('../drizzle/0028_team_sheet_channels.sql',import.meta.url),'utf8')),/legacy_master_project_workbook_collision/);
 assert.equal(native.prepare('SELECT spreadsheet_id FROM project_sheet_connections').get().spreadsheet_id,workbook);assert.equal(native.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='team_sheet_connections'").get().n,0);
});


test('final atomic read/receipt boundary rejects assignment loss after the last preliminary projection',async t=>{
 for(const kind of ['read','receipt']){
  const f=await connected(t),run=await f.call('proex_sync_run_start',{requestId:crypto.randomUUID()});
  const page=kind==='receipt'?await f.call('proex_sync_read',{table:'followup_tasks',runId:run.id}):null;
  const original=f.db.batch.bind(f.db);let fired=false;
  f.db.batch=async statements=>{if(!fired){fired=true;f.native.prepare('UPDATE followup_assignees SET removed_at=? WHERE team_id=? AND task_id=?').run(f.now,f.a,f.shared);}return original(statements);};
  const operation=kind==='read'?f.call('proex_sync_read',{table:'followup_tasks',runId:run.id}):f.call('proex_sync_run_finish',{id:run.id,status:'completed',exportedCount:page.total,readbackVerified:true,tablesVerified:1,snapshotDigest:page.digest});
  await assert.rejects(operation,{status:409,code:'sync_snapshot_changed'});assert.equal(fired,true);
  assert.notEqual(f.native.prepare('SELECT status FROM team_sheet_runs WHERE id=?').get(run.id).status,'completed');
 }
});

test('structural workbook isolation also guards setting renames and the master/project pair',async t=>{
 const team=await connected(t);
 team.native.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?)').run('synthetic.placeholder',JSON.stringify({spreadsheetId:workbook}),team.now);
 assert.throws(()=>team.native.prepare('UPDATE settings SET name=? WHERE name=?').run('sync.google_sheets.configuration','synthetic.placeholder'),/team_sheet_file_collision/);
 const master=await fixture(t);await configureSync(master.db,await master.actor('platform'),{spreadsheetId:workbook,folderId:'SyntheticFolder0001',attachmentsFolderId:'SyntheticFolder0002'});
 assert.throws(()=>master.native.prepare("INSERT INTO project_sheet_connections(id,project_id,spreadsheet_id,label,enabled,version,created_by,created_at,updated_at) VALUES('direct','project-a',?,'Planilha',1,1,'owner-a',?,?)").run(workbook,master.now,master.now),/project_sheet_master_forbidden/);
 const project=await fixture(t);await configureProjectSheet(project.db,project.owner,'project-a',{spreadsheetId:workbook,expectedVersion:0});
 project.native.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?)').run('synthetic.placeholder',JSON.stringify({spreadsheetId:workbook}),project.now);
 assert.throws(()=>project.native.prepare('UPDATE settings SET name=? WHERE name=?').run('sync.google_sheets.configuration','synthetic.placeholder'),/sync_project_workbook/);
});


test('completed receipt replay revalidates the projected set atomically after its read',async t=>{
 const f=await connected(t),{run,page}=await read(f),args={id:run.id,status:'completed',exportedCount:page.total,readbackVerified:true,tablesVerified:1,snapshotDigest:page.digest};
 await f.call('proex_sync_run_finish',args);let fired=false;f.db.afterRead=sql=>{if(!fired&&sql.startsWith('SELECT t.id _rowKey')){fired=true;f.native.prepare('UPDATE followup_assignees SET removed_at=? WHERE team_id=? AND task_id=?').run(f.now,f.a,f.shared);}};
 await assert.rejects(f.call('proex_sync_run_finish',args),{status:409,code:'sync_snapshot_changed'});assert.equal(fired,true);
});
