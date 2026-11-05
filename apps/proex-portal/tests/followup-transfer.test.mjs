import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
const {transferPreview,transferTask}=await import(compile('lib/follow-up/transfer.ts'));
const {followupDetail,followupAction}=await import(compile('lib/follow-up/service.ts'));
const {describePortableSchemas}=await import(compile('lib/sync/portable.ts'));
const drizzle=fileURLToPath(new URL('../drizzle/',import.meta.url));

// Synthetic data only. org-a: project-a (source), project-a2 (destination), project-a3 (archived).
// owner-a owns org-a; both-mgr manages a and a2; manager-a manages only a; host-mgr manages only a2;
// both-inv is inventory on a and a2; viewer-a reads a; worker-b/owner-b live in org-b.
async function scenario(t){
 const f=teamFixture(t),hooks={before:null,after:null};
 f.insert('projects',{id:'project-a3',organization_id:'org-a',name:'Projeto Arquivado',status:'archived',created_at:f.now});
 const person=(name,rows)=>{f.insert('portal_users',{user_id:name,email:`${name}@example.invalid`,status:'active',created_at:f.now,updated_at:f.now});f.insert('profiles',{user_id:name,display_name:`Pessoa ${name}`,created_at:f.now,updated_at:f.now});
  rows.forEach(([role,project],i)=>f.insert('members',{id:`member-${name}-${i}`,user_id:name,email:`${name}@example.invalid`,role,project_id:project,organization_id:'org-a',created_at:f.now}));f.users[name]={userId:name,email:`${name}@example.invalid`,displayName:name};};
 person('both-mgr',[['manager','project-a'],['manager','project-a2']]);person('manager-a',[['manager','project-a']]);person('host-mgr',[['manager','project-a2']]);person('both-inv',[['inventory','project-a'],['inventory','project-a2']]);
 f.insert('items',{id:'item-a',project_id:'project-a',name:'Brinde sintético',category:'distribution',unit:'un',stock:40,created_at:f.now});
 f.insert('campaigns',{id:'campaign-b',project_id:'project-b',name:'Ação B',starts_at:f.now,ends_at:f.now,created_at:f.now});
 const db={prepare:sql=>f.db.prepare(sql),async batch(statements){if(hooks.before){const h=hooks.before;hooks.before=null;h();}const result=await f.db.batch(statements);if(hooks.after){const h=hooks.after;hooks.after=null;h();}return result;}};
 const count=sql=>f.native.prepare(sql).get().n;
 const created=await f.act('owner-a','task.create',{projectId:'project-a',title:'Separar brindes CONPEEX',body:'Contar camisetas e canecas.',priority:'high',dueAt:'2026-11-20',userIds:['viewer-a','both-inv']});
 const updated=await f.act('owner-a','task.update',{id:created.task.id,expectedVersion:1,status:'in_progress'});
 const taskId=created.task.id,row=()=>f.native.prepare('SELECT * FROM followup_tasks WHERE id=?').get(taskId);
 const move=async(who,extra={})=>transferTask(db,await f.actor(who),{taskId,targetProjectId:'project-a2',expectedVersion:row().version,reason:'Criada no projeto errado.',operationKey:crypto.randomUUID(),confirmed:true,...extra});
 const preview=async who=>transferPreview(db,await f.actor(who),taskId);
 const revoke=(name,project)=>f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=? AND project_id IS ?').run(f.now,name,project);
 assert.equal(updated.task.version,2);
 return{...f,db,hooks,count,taskId,row,move,preview,revoke};
}
const unchanged=(f,fn)=>async()=>{const before=f.count('SELECT total_changes() n');await fn();assert.equal(f.count('SELECT total_changes() n'),before);};

test('0031 applies over 0000..0030, keeps foreign keys and every original scope validation; ordinary scope UPDATE stays blocked',async t=>{
 const files=readdirSync(drizzle).filter(n=>n.endsWith('.sql')).sort();assert.match(files.at(-1),/^0031_followup_task_transfers\.sql$/);
 const native=new DatabaseSync(':memory:');t.after(()=>native.close());native.exec('PRAGMA foreign_keys=ON');for(const name of files)native.exec(readFileSync(drizzle+name,'utf8'));
 assert.equal(native.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(native.prepare('PRAGMA foreign_key_check').all().length,0);
 const triggers=native.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (tbl_name='followup_tasks' OR tbl_name='followup_task_transfers') ORDER BY name").all().map(r=>r.name);
 assert.deepEqual(triggers,['followup_task_scope_insert','followup_task_scope_update','followup_task_transfer_delete','followup_task_transfer_insert','followup_task_transfer_settle','followup_task_transfer_update']);
 const f=await scenario(t);
 assert.throws(()=>f.native.prepare("UPDATE followup_tasks SET project_id='project-a2' WHERE id=?").run(f.taskId),/followup_scope_immutable/);
 assert.throws(()=>f.native.prepare("UPDATE followup_tasks SET project_id='project-a2',version=version+1 WHERE id=?").run(f.taskId),/followup_scope_immutable/);
 assert.throws(()=>f.native.prepare("UPDATE followup_tasks SET organization_id='org-b' WHERE id=?").run(f.taskId),/followup_scope_immutable/);
 assert.throws(()=>f.native.prepare("UPDATE followup_tasks SET campaign_id='campaign-b' WHERE id=?").run(f.taskId),/followup_reference_mismatch/);
 assert.throws(()=>f.native.prepare("UPDATE followup_tasks SET project_id=NULL WHERE id=?").run(f.taskId),/followup_scope_immutable/);
 // A forged pending receipt is never reusable: any unrelated task update voids it first.
 const receipt=(id,extra={})=>f.native.prepare(`INSERT INTO followup_task_transfers(id,task_id,organization_id,source_project_id,dest_project_id,from_version,to_version,actor_id,reason,operation_hash,fingerprint,created_at,state,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id,f.taskId,'org-a',extra.source??'project-a',extra.dest??'project-a2',extra.from??2,(extra.from??2)+1,extra.actor??'owner-a','Motivo',(id+'h').padEnd(64,'0'),'f'.repeat(64),f.now,extra.state??'pending',extra.state&&extra.state!=='pending'?f.now:null);
 assert.throws(()=>receipt('r-applied',{state:'applied'}),/followup_transfer_invalid/);
 assert.throws(()=>receipt('r-stale',{from:1}),/followup_transfer_conflict/);
 assert.throws(()=>receipt('r-org',{dest:'project-b'}),/followup_transfer_scope/);
 assert.throws(()=>receipt('r-archived',{dest:'project-a3'}),/followup_transfer_scope/);
 assert.throws(()=>receipt('r-viewer',{actor:'viewer-a'}),/followup_transfer_forbidden/);
 receipt('r-forged');assert.throws(()=>receipt('r-second'),/UNIQUE constraint failed/);
 assert.throws(()=>f.native.prepare("UPDATE followup_task_transfers SET state='applied',applied_at=? WHERE id='r-forged'").run(f.now),/followup_transfer_immutable/);
 assert.throws(()=>f.native.prepare("UPDATE followup_task_transfers SET reason='outro' WHERE id='r-forged'").run(),/followup_transfer_immutable/);
 f.native.prepare("UPDATE followup_tasks SET title=title WHERE id=?").run(f.taskId);
 assert.equal(f.native.prepare("SELECT state FROM followup_task_transfers WHERE id='r-forged'").get().state,'void');
 assert.throws(()=>f.native.prepare("UPDATE followup_tasks SET project_id='project-a2',version=3 WHERE id=?").run(f.taskId),/followup_scope_immutable/);
 assert.throws(()=>f.native.prepare("UPDATE followup_task_transfers SET state='pending',applied_at=NULL WHERE id='r-forged'").run(),/followup_transfer_immutable|CHECK constraint/);
 assert.throws(()=>f.native.prepare("DELETE FROM followup_task_transfers").run(),/followup_transfer_immutable/);
 assert.equal(f.row().project_id,'project-a');
 // Receipts are host-database audit data: never part of the curated portable export.
 assert.equal(describePortableSchemas().tables.map(x=>x.table).includes('followup_task_transfers'),false);
});

test('a simple task moves in place: same id, fields, history, assignees and attributions; only project/version/updatedAt change',async t=>{
 const f=await scenario(t),before=f.row(),history=f.native.prepare('SELECT * FROM followup_history WHERE task_id=? ORDER BY version').all(f.taskId),assignees=f.native.prepare('SELECT * FROM followup_assignees WHERE task_id=? ORDER BY id').all(f.taskId);
 const view=await f.preview('owner-a');
 assert.deepEqual(Object.keys(view).sort(),['assignments','candidates','eligible','reason','source','taskId','version','viewerId']);
 assert.equal(view.eligible,true);assert.deepEqual(view.source,{projectId:'project-a',name:'Projeto Aurora'});assert.deepEqual(view.assignments,{people:2,teams:0});
 assert.deepEqual(view.candidates,[{projectId:'project-a2',name:'Projeto Horizonte',assigneesWithoutAccess:1}]);
 assert.doesNotMatch(JSON.stringify(view),/viewer-a|both-inv|@example|Pessoa|project-b|project-a3|reservad/);
 const result=await f.move('owner-a');
 assert.deepEqual(result,{viewerId:'owner-a',taskId:f.taskId,projectId:'project-a2',version:3,duplicate:false});
 const after=f.row();
 for(const [key,value] of Object.entries(before))if(!['project_id','version','updated_at'].includes(key))assert.deepEqual(after[key],value,key);
 assert.equal(after.organization_id,'org-a');assert.equal(after.project_id,'project-a2');assert.equal(after.version,3);
 const newHistory=f.native.prepare('SELECT * FROM followup_history WHERE task_id=? ORDER BY version').all(f.taskId);
 assert.deepEqual(newHistory.slice(0,history.length),history);assert.equal(newHistory.length,history.length+1);
 const snap=JSON.parse(newHistory.at(-1).snapshot_json);assert.equal(snap.title,before.title);assert.equal(snap.status,'in_progress');assert.equal(snap.dueAt,before.due_at);
 assert.equal(snap.transfer.fromProjectId,'project-a');assert.equal(snap.transfer.toProjectId,'project-a2');assert.equal(snap.transfer.reason,'Criada no projeto errado.');
 assert.deepEqual(f.native.prepare('SELECT * FROM followup_assignees WHERE task_id=? ORDER BY id').all(f.taskId),assignees);
 const receipt=f.native.prepare('SELECT * FROM followup_task_transfers WHERE task_id=?').all(f.taskId);assert.equal(receipt.length,1);
 assert.equal(receipt[0].state,'applied');assert.equal(receipt[0].from_version,2);assert.equal(receipt[0].to_version,3);assert.equal(receipt[0].source_project_id,'project-a');
 assert.equal(after.updated_at,receipt[0].created_at);assert.equal(receipt[0].applied_at,receipt[0].created_at);assert.equal(receipt[0].actor_id,'owner-a');
 const audits=f.native.prepare("SELECT project_id,organization_id,details FROM audit WHERE entity_id=? AND action LIKE 'followup.task.transfer_%' ORDER BY action").all(f.taskId);
 assert.deepEqual(audits.map(a=>[a.project_id,a.organization_id]),[['project-a2','org-a'],['project-a','org-a']]);
 for(const a of audits){assert.doesNotMatch(a.details,/errado|Pessoa|@example|viewer-a/);assert.equal(JSON.parse(a.details).transferId,receipt[0].id);}
 assert.equal(f.count("SELECT stock n FROM items WHERE id='item-a'"),40);assert.equal(f.count('SELECT COUNT(*) n FROM members'),11);
 // Live policy: the source-only viewer no longer sees the task; the inventory holder of both still does.
 await assert.rejects(followupDetail(f.db,await f.actor('viewer-a'),f.taskId),{status:404});
 assert.equal((await followupDetail(f.db,await f.actor('both-inv'),f.taskId)).task.project_id,'project-a2');
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n,1);
});

test('pending e-mails are invalidated, sent ones preserved; new in-app notices only reach currently authorized recipients and never become e-mail',async t=>{
 const f=await scenario(t),notes=f.native.prepare('SELECT id,user_id,cause_key FROM followup_notifications WHERE task_id=? ORDER BY user_id,cause_key').all(f.taskId);
 const of=(user)=>notes.find(n=>n.user_id===user);assert.ok(of('viewer-a')&&of('both-inv'));
 const queue=(n,status)=>f.insert('followup_email_queue',{id:`q-${n.id}`,notification_id:n.id,organization_id:'org-a',task_id:f.taskId,user_id:n.user_id,event_key:n.cause_key,status,created_at:f.now,updated_at:f.now});
 queue(of('viewer-a'),'queued');queue(of('both-inv'),'accepted');
 const oldNotes=f.native.prepare('SELECT * FROM followup_notifications WHERE task_id=? ORDER BY id').all(f.taskId);
 await f.move('owner-a');
 assert.equal(f.native.prepare('SELECT status FROM followup_email_queue WHERE id=?').get(`q-${of('viewer-a').id}`).status,'cancelled');
 assert.equal(f.native.prepare('SELECT status FROM followup_email_queue WHERE id=?').get(`q-${of('both-inv').id}`).status,'accepted');
 const fresh=f.native.prepare("SELECT user_id FROM followup_notifications WHERE task_id=? AND cause_key='task:3' ORDER BY user_id").all(f.taskId).map(r=>r.user_id);
 assert.ok(fresh.includes('both-inv'));assert.equal(fresh.includes('viewer-a'),false);
 assert.deepEqual(f.native.prepare('SELECT * FROM followup_notifications WHERE task_id=? AND id IN (SELECT value FROM json_each(?)) ORDER BY id').all(f.taskId,JSON.stringify(oldNotes.map(n=>n.id))),oldNotes);
 assert.equal(f.count(`SELECT COUNT(*) n FROM followup_notifications n WHERE task_id='${f.taskId}' AND NOT EXISTS(SELECT 1 FROM followup_email_queue q WHERE q.notification_id=n.id)`),0);
 assert.equal(f.count(`SELECT COUNT(*) n FROM followup_email_queue WHERE task_id='${f.taskId}' AND status IN ('queued','claimed','sending')`),0);
});

test('task-only work grants survive as rows, but a grantor without management at the destination can no longer authorize work there',async t=>{
 const f=await scenario(t);
 await f.act('manager-a','task.worker.grant',{id:f.taskId,userId:'both-inv',confirmed:true});
 await f.act('owner-a','task.worker.grant',{id:f.taskId,userId:'viewer-a',confirmed:true});
 const before=f.count('SELECT COUNT(*) n FROM followup_work_grants');
 await f.move('owner-a');
 assert.equal(f.count('SELECT COUNT(*) n FROM followup_work_grants'),before);
 assert.notEqual(f.native.prepare("SELECT revoked_at FROM followup_work_grants WHERE user_id='both-inv'").get().revoked_at,null);
 assert.equal(f.native.prepare("SELECT revoked_at FROM followup_work_grants WHERE user_id='viewer-a'").get().revoked_at,null);
 assert.equal((await followupDetail(f.db,await f.actor('both-inv'),f.taskId)).task.canWork,false);
 await assert.rejects(followupDetail(f.db,await f.actor('viewer-a'),f.taskId),{status:404});
});

test('blocked moves write nothing: checklist, linked resource, organization task, cross-org, archived, same project and stale CAS',async t=>{
 const f=await scenario(t);
 await unchanged(f,async()=>{
  await assert.rejects(f.move('owner-a',{targetProjectId:'project-a'}),{status:409,code:'followup_transfer_noop'});
  await assert.rejects(f.move('owner-a',{targetProjectId:'project-b'}),{status:403});
  await assert.rejects(f.move('owner-a',{targetProjectId:'project-a3'}),{status:403});
  await assert.rejects(f.move('owner-a',{targetProjectId:'missing-project'}),{status:403});
  await assert.rejects(f.move('owner-a',{expectedVersion:1}),{status:409,code:'followup_conflict'});
  await assert.rejects(f.move('owner-a',{confirmed:false}),{status:400});
  await assert.rejects(f.move('owner-a',{reason:'x'.repeat(501)}),{status:400});
  await assert.rejects(f.move('owner-a',{organizationId:'org-a'}),{status:400});
 })();
 f.native.prepare("UPDATE followup_tasks SET item_id='item-a' WHERE id=?").run(f.taskId);
 assert.equal((await f.preview('owner-a')).reason,'linked_resource');
 await unchanged(f,async()=>assert.rejects(f.move('owner-a'),{status:409,code:'followup_transfer_linked'}))();
 f.native.prepare('UPDATE followup_tasks SET item_id=NULL WHERE id=?').run(f.taskId);
 f.insert('followup_checklists',{id:'checklist-1',organization_id:'org-a',project_id:'project-a',task_id:f.taskId,title:'Roteiro',kind:'activity',created_by:'owner-a',created_at:f.now,updated_at:f.now});
 const view=await f.preview('owner-a');assert.equal(view.eligible,false);assert.equal(view.reason,'checklist');assert.deepEqual(view.candidates,[]);
 await unchanged(f,async()=>assert.rejects(f.move('owner-a'),{status:409,code:'followup_transfer_linked'}))();
 const org=await f.act('owner-a','task.create',{organizationId:'org-a',title:'Planejamento geral'});
 assert.equal((await transferPreview(f.db,await f.actor('owner-a'),org.task.id)).reason,'organization_scope');
 await assert.rejects(transferTask(f.db,await f.actor('owner-a'),{taskId:org.task.id,targetProjectId:'project-a2',expectedVersion:1,reason:'Teste',operationKey:crypto.randomUUID(),confirmed:true}),{status:409});
 assert.equal(f.count('SELECT COUNT(*) n FROM followup_task_transfers'),0);
});

test('only live owner/manager on BOTH sides with an active account may preview or move; inventory, viewer, host-only and source-only are refused',async t=>{
 const f=await scenario(t);
 for(const who of ['viewer-a','both-inv'])await assert.rejects(f.preview(who),{status:403});
 await assert.rejects(f.preview('host-mgr'),{status:404});await assert.rejects(f.preview('worker-b'),{status:404});
 const sourceOnly=await f.preview('manager-a');assert.equal(sourceOnly.eligible,false);assert.equal(sourceOnly.reason,'no_candidates');assert.deepEqual(sourceOnly.candidates,[]);
 for(const who of ['viewer-a','both-inv','manager-a','host-mgr','worker-b','owner-b'])await assert.rejects(f.move(who),r=>[403,404].includes(r.status));
 assert.equal((await f.preview('both-mgr')).candidates.length,1);
 // Account fences: a member row without an active portal account never manages a transfer.
 f.native.prepare("UPDATE portal_users SET activation_pending=1 WHERE user_id='both-mgr'").run();
 await assert.rejects(f.move('both-mgr'),r=>[403,404].includes(r.status));
 f.native.prepare("UPDATE portal_users SET activation_pending=0 WHERE user_id='both-mgr'").run();
 f.insert('members',{id:'member-ghost',user_id:'ghost-mgr',email:'ghost@example.invalid',role:'owner',project_id:null,organization_id:'org-a',created_at:f.now});
 const ghost={userId:'ghost-mgr',email:'ghost@example.invalid',displayName:'ghost',members:[],capabilities:[]};
 await assert.rejects(transferPreview(f.db,ghost,f.taskId),{status:403});
 await assert.rejects(transferTask(f.db,ghost,{taskId:f.taskId,targetProjectId:'project-a2',expectedVersion:2,reason:'Teste',operationKey:crypto.randomUUID(),confirmed:true}),{status:403});
 assert.equal(f.count('SELECT COUNT(*) n FROM followup_task_transfers'),0);assert.equal(f.row().project_id,'project-a');
 assert.equal(f.count("SELECT COUNT(*) n FROM members WHERE role IN ('owner','manager')"),7);
 const ok=await f.move('both-mgr');assert.equal(ok.projectId,'project-a2');
});

test('idempotency: lost reply replays the captured receipt; changed payload 409; replay after losing source or destination access 403',async t=>{
 const f=await scenario(t),key=crypto.randomUUID(),input={operationKey:key,expectedVersion:2};
 const [a,b]=await Promise.all([f.move('both-mgr',input),f.move('both-mgr',input)]);
 assert.deepEqual([a.duplicate,b.duplicate].sort(),[false,true]);assert.equal(a.version,3);assert.equal(b.version,3);
 assert.equal(f.count('SELECT COUNT(*) n FROM followup_task_transfers'),1);assert.equal(f.row().version,3);
 assert.deepEqual(await f.move('both-mgr',input),{viewerId:'both-mgr',taskId:f.taskId,projectId:'project-a2',version:3,duplicate:true});
 await assert.rejects(f.move('both-mgr',{...input,reason:'Outro motivo.'}),{status:409,code:'operation_changed'});
 await assert.rejects(f.move('owner-a',{...input,expectedVersion:2}),{status:409});
 f.revoke('both-mgr','project-a');
 await assert.rejects(f.move('both-mgr',input),{status:403});
 assert.equal(f.count('SELECT COUNT(*) n FROM followup_task_transfers'),1);
});

test('concurrent moves with different keys: exactly one wins by CAS; no pending receipt survives',async t=>{
 const f=await scenario(t);
 const results=await Promise.allSettled([f.move('owner-a',{expectedVersion:2}),f.move('both-mgr',{expectedVersion:2})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 assert.equal(f.row().version,3);assert.equal(f.count('SELECT COUNT(*) n FROM followup_task_transfers'),1);
 assert.equal(f.count("SELECT COUNT(*) n FROM followup_task_transfers WHERE state<>'applied'"),0);
 assert.equal(f.count('SELECT COUNT(*) n FROM followup_history WHERE task_id=(SELECT id FROM followup_tasks)'),3);
});

test('revocation between validation and commit rolls everything back; after commit the DTO is withheld and replay is refused',async t=>{
 const f=await scenario(t),snapshot=()=>JSON.stringify(['followup_tasks','followup_history','audit','followup_notifications','followup_email_queue','followup_task_transfers','followup_work_grants'].map(table=>f.native.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
 for(const [name,project] of [['both-mgr','project-a2'],['both-mgr','project-a']]){
  const before=snapshot();f.hooks.before=()=>f.revoke(name,project);
  await assert.rejects(f.move('both-mgr'),{status:403});assert.equal(snapshot(),before);
  f.native.prepare('UPDATE members SET revoked_at=NULL WHERE user_id=?').run(name);
 }
 f.hooks.before=()=>f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='both-mgr'").run();
 const before=snapshot();await assert.rejects(f.move('both-mgr'),{status:403});assert.equal(snapshot(),before);
 f.native.prepare("UPDATE portal_users SET status='active' WHERE user_id='both-mgr'").run();
 const key=crypto.randomUUID();f.hooks.after=()=>f.revoke('both-mgr','project-a2');
 await assert.rejects(f.move('both-mgr',{operationKey:key}),{status:403});
 assert.equal(f.row().project_id,'project-a2');assert.equal(f.count("SELECT COUNT(*) n FROM followup_task_transfers WHERE state='applied'"),1);
 await assert.rejects(f.move('both-mgr',{operationKey:key,expectedVersion:2}),{status:403});
});

test('preview is read-only and a revocation between its two snapshots yields 403 instead of a stale ACL',async t=>{
 const f=await scenario(t);
 await unchanged(f,async()=>{for(let i=0;i<5;i++)await f.preview('owner-a');})();
 assert.equal(f.count('SELECT COUNT(*) n FROM portal_rate_limits'),0);
 let reads=0;const original=f.db.prepare;
 // Revoke right after the first read of the preview.
 const flagged=await f.actor('both-mgr');
 f.db.prepare=sql=>{const s=original(sql);const first=s.first.bind(s);s.first=async()=>{const r=await first();if(++reads===1)f.revoke('both-mgr','project-a');return r;};return s;};
 await assert.rejects(transferPreview(f.db,flagged,f.taskId),r=>[403,404].includes(r.status));
});


test('final review: archived source is an explicit read-only blocker and a move returns a conflict',async t=>{
 const f=await scenario(t);f.native.prepare("UPDATE projects SET status='archived' WHERE id='project-a'").run();
 const preview=await f.preview('owner-a');assert.equal(preview.eligible,false);assert.equal(preview.reason,'inactive_source');assert.deepEqual(preview.candidates,[]);
 await assert.rejects(f.move('owner-a'),{status:409,code:'followup_transfer_inactive_source'});assert.equal(f.row().project_id,'project-a');assert.equal(f.count('SELECT COUNT(*) n FROM followup_task_transfers'),0);
});

test('final review: simultaneous same-key moves return one immutable receipt and a duplicate response',async t=>{
 const f=await scenario(t),input={operationKey:'same-key-transfer-review',expectedVersion:2};
 const receipts=await Promise.all([f.move('both-mgr',input),f.move('both-mgr',input)]);assert.deepEqual(receipts.map(r=>r.duplicate).sort(),[false,true]);assert.equal(receipts[0].taskId,receipts[1].taskId);assert.equal(receipts[0].version,3);assert.equal(receipts[1].version,3);assert.equal(f.count('SELECT COUNT(*) n FROM followup_task_transfers'),1);assert.equal(f.count("SELECT COUNT(*) n FROM followup_task_transfers WHERE state='pending'"),0);
});

test('final review: even direct receipt insertion requires current management on both projects',async t=>{
 const f=await scenario(t);
 assert.throws(()=>f.insert('followup_task_transfers',{id:'forged-source-only-review',task_id:f.taskId,organization_id:'org-a',source_project_id:'project-a',dest_project_id:'project-a2',from_version:2,to_version:3,actor_id:'manager-a',reason:'Motivo operacional',operation_hash:'f'.repeat(64),fingerprint:'a'.repeat(64),state:'pending',created_at:f.now}),/followup_transfer_forbidden/);
 assert.equal(f.count('SELECT COUNT(*) n FROM followup_task_transfers'),0);
});

test('final review: a delegation revocation racing with transfer audits the task current project',async t=>{
 const f=await scenario(t);const granted=await f.act('owner-a','task.worker.grant',{id:f.taskId,userId:'viewer-a',confirmed:true}),grant=granted.workGrants.find(g=>g.userId==='viewer-a');assert.ok(grant);
 let injected=false;const racingDb={prepare:sql=>f.db.prepare(sql),async batch(statements){if(!injected){injected=true;await f.move('owner-a');}return f.db.batch(statements);}};
 await followupAction(racingDb,await f.actor('owner-a'),'task.worker.revoke',{id:f.taskId,grantId:grant.id,confirmed:true,operationKey:crypto.randomUUID()});
 const audit=f.native.prepare("SELECT project_id FROM audit WHERE action='task.worker.revoke' AND entity_id=?").get(f.taskId);assert.equal(audit.project_id,'project-a2');assert.equal(f.row().project_id,'project-a2');
});


test('a grant racing with transfer cannot retain a source-only issuer and can be retried in the new context',async t=>{
 const f=await scenario(t);let injected=false;const racingDb={prepare:sql=>f.db.prepare(sql),async batch(statements){if(!injected){injected=true;await f.move('owner-a');}return f.db.batch(statements);}};
 const input={id:f.taskId,userId:'both-inv',confirmed:true,operationKey:'grant-transfer-race-review'};
 await assert.rejects(followupAction(racingDb,await f.actor('both-mgr'),'task.worker.grant',input),{status:409,code:'followup_assignee'});assert.equal(f.row().project_id,'project-a2');assert.equal(f.count('SELECT COUNT(*) n FROM followup_work_grants'),0);
 await followupAction(f.db,await f.actor('both-mgr'),'task.worker.grant',input);
 const grant=f.native.prepare('SELECT grantor_member_id FROM followup_work_grants WHERE task_id=?').get(f.taskId);assert.equal(grant.grantor_member_id,'member-both-mgr-1');
 const audit=f.native.prepare("SELECT project_id FROM audit WHERE action='task.worker.grant' AND entity_id=?").get(f.taskId);assert.equal(audit.project_id,'project-a2');
});
