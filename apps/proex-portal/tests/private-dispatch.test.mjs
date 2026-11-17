import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {resolve,dirname} from 'node:path';import ts from 'typescript';


const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
function compile(file){file=resolve(root,file);if(cache.has(file))return cache.get(file);let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;code=code.replace(/from (['"])(\.[^'"]+)\1/g,(_m,_q,name)=>`from ${JSON.stringify(compile(resolve(dirname(file),name+'.ts')))}`);const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,url);return url;}
// Demandas privadas e Despachos (pedido de 17/11/2026). Dados sintéticos: nenhum nome real.

const {getActor}=await import(compile('lib/access.ts'));
const {followupAction,followupList,followupDetail,notificationInbox}=await import(compile('lib/follow-up/service.ts'));
const {dispatchWorkspace,leadershipRoster}=await import(compile('lib/follow-up/private.ts'));
const {followupReportRows}=await import(compile('lib/follow-up/reports.ts'));
const {exportPortablePage}=await import(compile('lib/sync/portable.ts'));
const {activityFeed}=await import(compile('lib/activity.ts'));
const {calendarEntries,calendarRange}=await import(compile('lib/calendar.ts'));
const {teamsWorkspace}=await import(compile('lib/follow-up/teams.ts'));

function fixture(t){const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(root+'drizzle').filter(n=>n.endsWith('.sql')).sort())native.exec(readFileSync(root+'drizzle/'+name,'utf8'));t.after(()=>native.close());const now=new Date().toISOString();
 const insert=(table,row)=>{const cols=Object.keys(row);native.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));};
 for(const suffix of ['a','b']){insert('organizations',{id:`org-${suffix}`,name:`Organization ${suffix}`,slug:`org-${suffix}`,created_at:now,updated_at:now});insert('projects',{id:`project-${suffix}`,organization_id:`org-${suffix}`,name:`Project ${suffix}`,created_at:now});insert('items',{id:`item-${suffix}`,project_id:`project-${suffix}`,name:suffix==='a'?'Coletes P/M/G':'Private organization B item',category:'distribution',unit:'un',stock:40,created_at:now});insert('campaigns',{id:`campaign-${suffix}`,project_id:`project-${suffix}`,name:`Event ${suffix}`,starts_at:now,ends_at:new Date(Date.now()+86400000).toISOString(),status:'active',created_at:now});}
 const users={};function user(name,role,project,org){insert('portal_users',{user_id:name,email:name+'@example.invalid',status:'active',created_at:now,updated_at:now});insert('profiles',{user_id:name,display_name:name,created_at:now,updated_at:now});insert('members',{id:'member-'+name,user_id:name,email:name+'@example.invalid',role,project_id:project,organization_id:org,created_at:now});return users[name]={userId:name,email:name+'@example.invalid',displayName:name};}
 user('platform','owner',null,null);user('admin-a','owner',null,'org-a');user('admin-b','owner',null,'org-b');user('manager-a','manager','project-a','org-a');user('viewer-a','viewer','project-a','org-a');user('worker-a','inventory','project-a','org-a');user('worker-b','inventory','project-b','org-b');
 const db={native,reads:0,before:null,fail:null,prepare(sql){let values=[];return{sql,bind(...args){values=args;return this;},async first(){db.reads++;return native.prepare(sql).get(...values)??null;},async all(){db.reads++;return{results:native.prepare(sql).all(...values)};},async run(){return this.execute();},execute(){if(db.fail?.test(sql)){db.fail=null;throw new Error('synthetic storage failure');}const results=native.prepare(sql).all(...values);return{results,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(this.before){const hook=this.before;this.before=null;hook();}native.exec('BEGIN');try{const results=statements.map(s=>s.execute());native.exec('COMMIT');return results;}catch(error){native.exec('ROLLBACK');throw error;}}};
 return{db,native,users,insert,now,actor:name=>getActor(db,users[name])};
}

// Duas pessoas sintéticas despacham entre si: "staff-a" (coordenação administrativa) e "chief-a" (Pró-Reitoria).
function people(f){
 for(const [name,role] of [['staff-a','operator'],['chief-a','manager'],['peer-a','viewer']]){
  f.insert('portal_users',{user_id:name,email:name+'@example.invalid',status:'active',created_at:f.now,updated_at:f.now});
  f.insert('profiles',{user_id:name,display_name:'Pessoa '+name,created_at:f.now,updated_at:f.now});
  f.insert('members',{id:'member-'+name,user_id:name,email:name+'@example.invalid',role,project_id:'project-a',organization_id:'org-a',created_at:f.now});
  f.users[name]={userId:name,email:name+'@example.invalid',displayName:'Pessoa '+name};
 }
}
const key=()=>crypto.randomUUID();
const act=(f,actor,action,input)=>followupAction(f.db,actor,action,{action,...input});
const SECRET='Assinatura do termo sigiloso QA';
async function dispatch(f,extra={}){
 const staff=await f.actor('staff-a');
 return act(f,staff,'dispatch.create',{organizationId:'org-a',visibility:'participants',participantIds:['chief-a'],title:SECRET,body:'Detalhe reservado',kind:'signature',documentKind:'term',urgency:'immediate',dueAt:'2026-11-18',documentRef:'SEI 0000.000000/2026-00',onAgenda:true,operationKey:key(),...extra});
}
const listIds=async(f,actor,input={organizationId:'org-a'})=>(await followupList(f.db,actor,input)).tasks.map(task=>task.id);

test('two people dispatch privately; general and organization admins see it nowhere in Demandas', async t => {
 const f=fixture(t);people(f);
 const created=await dispatch(f);
 const [staff,chief,admin,platform,manager,peer]=await Promise.all(['staff-a','chief-a','admin-a','platform','manager-a','peer-a'].map(name=>f.actor(name)));
 for(const actor of [staff,chief]){
  assert.ok((await listIds(f,actor)).includes(created.taskId));
  const detail=await followupDetail(f.db,actor,created.taskId);
  assert.equal(detail.task.privacy,'participants');
  assert.equal(detail.task.dispatch.kind,'signature');
  assert.deepEqual(detail.task.participants.map(p=>p.userId).sort(),['chief-a','staff-a']);
 }
 for(const actor of [admin,platform,manager,peer]){
  assert.ok(!(await listIds(f,actor)).includes(created.taskId),'a lista não mostra');
  assert.ok(!(await listIds(f,actor,{organizationId:'org-a',search:'sigiloso'})).length,'nem a busca');
  await assert.rejects(followupDetail(f.db,actor,created.taskId),{status:404},'nem a ficha por ID forjado');
  assert.ok(!JSON.stringify(await notificationInbox(f.db,actor)).includes(SECRET),'nem o sino');
 }
 assert.ok(JSON.stringify(await notificationInbox(f.db,chief)).includes(SECRET),'a outra pessoa recebe o aviso');
 const panel=await dispatchWorkspace(f.db,staff,{organizationId:'org-a',withUserId:'chief-a'});
 assert.deepEqual(panel.tasks.map(task=>task.id),[created.taskId]);
 assert.equal(panel.counts.open,1); assert.equal(panel.counts.needsCounterpart,1);
 const adminPanel=await dispatchWorkspace(f.db,admin,{organizationId:'org-a',withUserId:'chief-a'});
 assert.deepEqual(adminPanel.tasks,[]); assert.equal(adminPanel.counts.open,0);
 const audit=f.native.prepare('SELECT details FROM audit WHERE entity_id=?').all(created.taskId);
 assert.ok(audit.length>0 && audit.every(row=>!row.details.includes(SECRET)),'a auditoria registra sem o título');
});

test('a private demand never reaches reports, exports, activity, agenda or the readable backup, even for admins', async t => {
 const f=fixture(t);people(f);
 await dispatch(f);
 const [admin,platform,staff]=await Promise.all(['admin-a','platform','staff-a'].map(name=>f.actor(name)));
 for(const actor of [admin,platform]){
  const report=await followupReportRows(f.db,actor,'demands',{organizationId:'org-a'},100);
  assert.ok(report.rows.length>=0 && !JSON.stringify(report).includes(SECRET),'relatórios e exportações');
  const feed=await activityFeed(f.db,actor,{organizationId:'org-a',types:'demands'});
  assert.ok(!JSON.stringify(feed).includes(SECRET),'Início e histórico');
  const agenda=await calendarEntries(f.db,actor,{category:'deadlines',range:calendarRange('2026-11-01','2026-11-30')});
  assert.ok(!JSON.stringify(agenda).includes(SECRET),'Agenda e .ics');
 }
 void staff;
 const backup=await exportPortablePage(f.db,platform,{table:'followup_tasks'});
 assert.ok(!JSON.stringify(backup).includes(SECRET),'cópia legível e espelho de planilha');
});

test('only the author changes people; nobody joins by forged id; removal cuts access at once', async t => {
 const f=fixture(t);people(f);
 const created=await dispatch(f);
 const [staff,chief,admin,peer]=await Promise.all(['staff-a','chief-a','admin-a','peer-a'].map(name=>f.actor(name)));
 await assert.rejects(act(f,peer,'dispatch.update',{id:created.taskId,expectedVersion:1,participantIds:['chief-a','peer-a'],operationKey:key()}),{status:404},'quem não participa não se inclui');
 await assert.rejects(act(f,admin,'dispatch.update',{id:created.taskId,expectedVersion:1,participantIds:['admin-a'],operationKey:key()}),{status:404},'nem a administração');
 await assert.rejects(act(f,chief,'dispatch.update',{id:created.taskId,expectedVersion:1,participantIds:['chief-a','peer-a'],operationKey:key()}),{status:403},'só o autor muda as pessoas');
 await assert.rejects(act(f,admin,'task.update',{id:created.taskId,title:'Tentativa',expectedVersion:1,operationKey:key()}),{status:404},'a edição comum não alcança a privada');
 await assert.rejects(act(f,staff,'task.update',{id:created.taskId,title:'Tentativa',expectedVersion:1,operationKey:key()}),{status:409,code:'followup_private_task'});
 const moved=await act(f,chief,'dispatch.update',{id:created.taskId,expectedVersion:1,status:'in_progress',holderUserId:'staff-a',operationKey:key()});
 assert.equal(moved.taskId,created.taskId,'quem participa avança a situação');
 const open=await followupDetail(f.db,chief,created.taskId); assert.equal(open.task.status,'in_progress');
 // O autor tira a outra pessoa e inclui uma terceira: o acesso muda na hora, mesmo para quem já estava com a tela aberta.
 await act(f,staff,'dispatch.update',{id:created.taskId,expectedVersion:2,participantIds:['peer-a'],holderUserId:'peer-a',operationKey:key()});
 await assert.rejects(followupDetail(f.db,chief,created.taskId),{status:404});
 assert.ok(!(await listIds(f,chief)).includes(created.taskId));
 assert.ok(!JSON.stringify(await notificationInbox(f.db,chief)).includes(SECRET),'o aviso antigo some do sino');
 assert.ok((await listIds(f,peer)).includes(created.taskId));
});

test('"Gestão superior" sees group demands; leaving the group cuts access; only admins manage the group', async t => {
 const f=fixture(t);people(f);
 const [staff,chief,admin,peer]=await Promise.all(['staff-a','chief-a','admin-a','peer-a'].map(name=>f.actor(name)));
 await assert.rejects(act(f,staff,'leadership.add',{organizationId:'org-a',userId:'staff-a',operationKey:key()}),{status:403},'só a administração mantém o grupo');
 await act(f,admin,'leadership.add',{organizationId:'org-a',userId:'chief-a',operationKey:key()});
 assert.deepEqual((await leadershipRoster(f.db,staff,'org-a')).members.map(m=>m.userId),['chief-a']);
 const created=await dispatch(f,{visibility:'leadership',participantIds:[]});
 assert.ok((await listIds(f,chief)).includes(created.taskId),'quem está no grupo vê');
 assert.ok((await listIds(f,staff)).includes(created.taskId),'quem criou vê');
 for(const actor of [admin,peer])assert.ok(!(await listIds(f,actor)).includes(created.taskId),'o restante, mesmo com acesso ao projeto ou à organização, não vê');
 const group=await dispatchWorkspace(f.db,chief,{organizationId:'org-a',group:'1'});
 assert.deepEqual(group.tasks.map(task=>task.id),[created.taskId]);
 await assert.rejects(dispatchWorkspace(f.db,staff,{organizationId:'org-a',group:'1'}),{status:403});
 await act(f,admin,'leadership.remove',{organizationId:'org-a',userId:'chief-a',operationKey:key()});
 await assert.rejects(followupDetail(f.db,chief,created.taskId),{status:404},'quem saiu do grupo deixa de ver');
});

test('dispatch input stays inside the organization and the privacy row cannot be deleted', async t => {
 const f=fixture(t);people(f);
 await assert.rejects(dispatch(f,{participantIds:['worker-b']}),{status:409},'pessoa de outra organização não entra');
 await assert.rejects(dispatch(f,{participantIds:[]}),{status:400},'"só as pessoas escolhidas" precisa de alguém além do autor');
 await assert.rejects(dispatch(f,{documentRef:'javascript:alert(1)'}),{status:400});
 const created=await dispatch(f);
 assert.throws(()=>f.native.prepare('DELETE FROM followup_task_privacy WHERE task_id=?').run(created.taskId),/followup_privacy_immutable/);
});

test('a forged id answers the same for a private demand and a nonexistent one (no existence oracle)', async t => {
 const f=fixture(t);people(f);
 const created=await dispatch(f);
 const outcome=async(actor,action,taskId)=>{try{await act(f,actor,action,{id:taskId,expectedVersion:1,status:'in_progress',userId:'worker-a',allowCoverage:true,operationKey:key()});return 'ok';}catch(error){return `${error.status}:${error.code}`;}};
 for(const name of ['platform','admin-a','manager-a','viewer-a']){
  const actor=await f.actor(name);
  for(const action of ['task.work','task.worker.coverage','task.worker.revoke']){
   const privateAnswer=await outcome(actor,action,created.taskId), missingAnswer=await outcome(actor,action,crypto.randomUUID());
   assert.equal(privateAnswer,missingAnswer,`${name} · ${action}: mesma resposta para ID privado e inexistente`);
   assert.doesNotMatch(privateAnswer,/followup_private_task/);
  }
 }
 const staff=await f.actor('staff-a');
 assert.equal(await outcome(staff,'task.work',created.taskId),'409:followup_private_task','quem participa é orientado a usar Despachos');
});

test('nobody adds themselves to "Gestão superior", not even the administration', async t => {
 const f=fixture(t);people(f);
 const [admin,platform]=await Promise.all(['admin-a','platform'].map(name=>f.actor(name)));
 await assert.rejects(act(f,admin,'leadership.add',{organizationId:'org-a',userId:'admin-a',operationKey:key()}),{status:403});
 await assert.rejects(act(f,platform,'leadership.add',{organizationId:'org-a',userId:'platform',operationKey:key()}),{status:403});
 await act(f,platform,'leadership.add',{organizationId:'org-a',userId:'admin-a',operationKey:key()});
 assert.deepEqual((await leadershipRoster(f.db,admin,'org-a')).members.map(m=>m.userId),['admin-a'],'outra pessoa da administração inclui');
});

test('even if a private demand ended up with a project and a team, it never makes that team visible (defesa em profundidade)', async t => {
 const f=fixture(t);people(f);
 // Hoje a demanda privada nasce sem projeto e sem equipe (e o banco não deixa mudar o projeto depois). Aqui ela é gravada
 // direto no banco já com projeto e equipe, como um caminho futuro faria, para provar que as leituras de Equipes não dependem disso.
 f.insert('followup_teams',{id:'team-hidden',organization_id:'org-a',name:'Equipe só da privada',status:'active',version:1,created_by:'admin-a',created_at:f.now,updated_at:f.now});
 f.insert('followup_tasks',{id:'task-hidden',organization_id:'org-a',project_id:'project-a',title:SECRET,body:'',priority:'high',status:'open',version:1,created_by:'staff-a',created_at:f.now,updated_at:f.now});
 f.insert('followup_task_privacy',{task_id:'task-hidden',visibility:'participants',created_by:'staff-a',created_at:f.now,updated_at:f.now});
 f.insert('followup_task_participants',{id:'part-hidden',task_id:'task-hidden',user_id:'staff-a',added_by:'staff-a',created_at:f.now});
 f.insert('followup_assignees',{id:'assign-hidden',task_id:'task-hidden',team_id:'team-hidden',created_at:f.now});
 const manager=await f.actor('manager-a');
 const workspace=await teamsWorkspace(f.db,manager,{organizationId:'org-a',projectId:'project-a'});
 assert.ok(!JSON.stringify(workspace).includes('Equipe só da privada'),'a equipe não aparece por causa da demanda privada');
 assert.ok(!JSON.stringify(workspace).includes(SECRET));
});
