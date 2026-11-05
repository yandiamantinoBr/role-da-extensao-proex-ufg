import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, teamScenario, teamsWorkspace } from './support/work-teams-fixture.mjs';
const { isTeamsWorkspace, workTeamsApi, saveWorkTeam, TeamsApiError } = await import(compile('components/portal/work-teams-api.ts'));

test('multi-team workspace intersects tasks, counts and roster with the current project, excluding both a second project and organization', async t => {
 const f = await teamScenario(t), viewer = await f.actor('viewer-a');
 const result = await teamsWorkspace(f.db, viewer, { projectId:'project-a',teamId:f.a });
 assert.equal(result.viewerId,'viewer-a'); assert.equal(result.scope.canManage,false);
 assert.deepEqual(new Set(result.teams.map(team => team.id)), new Set([f.a,f.a2]));
 assert.ok(result.teams.every(team => team.isMine));
 assert.deepEqual(result.teams.find(team => team.id === f.a).members.map(person => person.userId),['viewer-a']);
 assert.equal(result.teams.find(team => team.id === f.a).counts.total,2);
 assert.equal(result.teams.find(team => team.id === f.a2).counts.total,1);
 assert.equal(result.teams.find(team => team.id === f.a).counts.completed,1);
 assert.equal(result.teams.find(team => team.id === f.a).counts.overdue,1);
 assert.equal(result.teams.find(team => team.id === f.a).counts.high,1);
 assert.equal(result.tasks.length,2); assert.deepEqual(result.people,[]);
 assert.doesNotMatch(JSON.stringify(result),/Horizonte|reservada B|owner-b|worker-b|@example/);
 assert.equal(isTeamsWorkspace(result),true);
});

test('organization owner sees its aggregate including organization tasks; filtering status affects the list and keeps the complete chart', async t => {
 const f = await teamScenario(t), owner = await f.actor('owner-a');
 const result = await teamsWorkspace(f.db, owner, { organizationId:'org-a',teamId:f.a,status:'completed' });
 assert.equal(result.scope.canManage,true); assert.equal(result.scope.projectId,null);
 assert.equal(result.teams.find(team => team.id === f.a).counts.total,4);
 assert.equal(result.tasks.length,1); assert.equal(result.tasks[0].status,'completed');
 assert.equal(result.teams.find(team => team.id === f.a).members.length,2);
 assert.ok(result.people.some(person => person.userId === 'other-a2'));
 assert.doesNotMatch(JSON.stringify(result),/reservada B|worker-b/);
});

test('team affiliation never grants project, organization or export access', async t => {
 const f = await teamScenario(t), outsider = await f.actor('worker-b'), viewer = await f.actor('viewer-a');
 f.insert('followup_team_members',{ id:'legacy-cross-org-affiliation',team_id:f.a,user_id:'worker-b',added_by:'owner-a',created_at:f.now });
 for (const exporting of [false,true]) {
  await assert.rejects(teamsWorkspace(f.db, outsider, { projectId:'project-a',teamId:f.a }, exporting),{status:403});
  await assert.rejects(teamsWorkspace(f.db, viewer, { organizationId:'org-a' }, exporting),{status:403});
  await assert.rejects(teamsWorkspace(f.db, viewer, { projectId:'project-b' }, exporting),{status:403});
  await assert.rejects(teamsWorkspace(f.db, viewer, { projectId:'project-a',teamId:f.b }, exporting),{status:404});
 }
 await assert.rejects(teamsWorkspace(f.db, viewer, { projectId:'project-a',organizationId:'org-b' }),{status:400});
});

test('live revocation and inactive accounts reject stale actors, including revocation after reading the exported tasks', async t => {
 for (const kind of ['membership','account','after-read']) {
  const f = await teamScenario(t), actor = await f.actor('viewer-a');
  const revoke = () => f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='viewer-a'").run(f.now);
  if (kind === 'account') f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='viewer-a'").run();
  else if (kind === 'membership') revoke();
  else f.db.afterRead = sql => { if (sql.startsWith('SELECT t.id,t.title')) { f.db.afterRead = null; revoke(); } };
  await assert.rejects(teamsWorkspace(f.db, actor, { projectId:'project-a',teamId:f.a }, true),{status:403});
 }
});

test('archiving and removing a member updates own-team projection without promoting permissions', async t => {
 const f = await teamScenario(t);
 await f.act('owner-a','team.update',{ id:f.a2,expectedVersion:1,status:'archived',userIds:['viewer-a'] });
 await f.act('owner-a','team.update',{ id:f.a,expectedVersion:1,userIds:['other-a2'] });
 const result = await teamsWorkspace(f.db, await f.actor('viewer-a'), { projectId:'project-a' });
 assert.equal(result.teams.length,1); assert.equal(result.teams[0].isMine,false); // visible because a permitted task is assigned to it
 assert.equal(result.teams[0].members.length,0);
 const owner = await teamsWorkspace(f.db,await f.actor('owner-a'),{organizationId:'org-a'});
 assert.equal(owner.teams.find(team => team.id === f.a2).status,'archived');
 assert.equal(f.native.prepare("SELECT role FROM members WHERE user_id='viewer-a'").get().role,'viewer');
});

test('lists paginate, export rereads all rows, and strict inputs and malformed response bodies fail closed', async t => {
 const f = await teamScenario(t), owner = await f.actor('owner-a');
 for (let index=0;index<54;index++) await f.act('owner-a','task.create',{projectId:'project-a',title:`Demanda ${index}`,teamIds:[f.a]});
 const first = await teamsWorkspace(f.db,owner,{projectId:'project-a',teamId:f.a});
 assert.equal(first.tasks.length,6);assert.equal(first.nextOffset,6);assert.equal(first.hasMore,true);
 const second = await teamsWorkspace(f.db,owner,{projectId:'project-a',teamId:f.a,offset:54});
 assert.equal(second.tasks.length,2);assert.equal(second.nextOffset,null);
 const exported = await teamsWorkspace(f.db,owner,{projectId:'project-a',teamId:f.a,offset:50},true);
 assert.equal(exported.tasks.length,56); assert.equal(exported.hasMore,false);
 await assert.rejects(teamsWorkspace(f.db,owner,{projectId:'project-a',status:'wrong'}),{status:400});
 await assert.rejects(teamsWorkspace(f.db,owner,{projectId:'project-a',offset:null}),{status:400});
 assert.equal(isTeamsWorkspace({...exported,teams:[{...exported.teams[0],counts:{...exported.teams[0].counts,total:-1}}]}),false);
 assert.equal(isTeamsWorkspace({...exported,tasks:[{...exported.tasks[0],status:'unknown'}]}),false);
});

test('client refuses wrong viewer/context, permission errors and responses arriving after cancellation', async t => {
 const f = await teamScenario(t), response = await teamsWorkspace(f.db,await f.actor('viewer-a'),{projectId:'project-a',teamId:f.a});
 const query = new URLSearchParams({organizationId:'org-a',projectId:'project-a',teamId:f.a});
 const fetch = t.mock.method(globalThis,'fetch',async()=>Response.json(response));
 assert.equal((await workTeamsApi(query,'viewer-a')).viewerId,'viewer-a');
 await assert.rejects(workTeamsApi(query,'owner-a'),{status:403});
 await assert.rejects(workTeamsApi(new URLSearchParams({organizationId:'org-b',projectId:'project-a',teamId:f.a}),'viewer-a'),{status:403});
 for(const status of [401,403]) { fetch.mock.mockImplementation(async()=>Response.json({error:'Acesso sintético revogado.'},{status})); await assert.rejects(workTeamsApi(query,'viewer-a'),error=>error instanceof TeamsApiError&&error.status===status); }
 const controller = new AbortController();fetch.mock.mockImplementation(async()=>({ok:true,status:200,json:async()=>{controller.abort();return response;}}));
 await assert.rejects(workTeamsApi(query,'viewer-a',controller.signal),{name:'AbortError'});
});

test('team writes retain the existing CSRF/CAS/idempotency contract and reject missing receipts', async t => {
 let sent;
 const fetch = t.mock.method(globalThis,'fetch',async(url,init)=>{sent={url,init};return Response.json({teamId:'synthetic-team'});});
 const input = {action:'team.update',organizationId:'org-a',id:'synthetic-team',expectedVersion:7,operationKey:'synthetic-operation',name:'Equipe',userIds:['synthetic-person']};
 assert.deepEqual(await saveWorkTeam(input),{teamId:'synthetic-team'});
 assert.equal(sent.url,'/api/follow-up');assert.equal(sent.init.headers['X-Proex-Action'],'1');assert.equal(sent.init.credentials,'same-origin');assert.deepEqual(JSON.parse(sent.init.body),input);
 fetch.mock.mockImplementation(async()=>Response.json({}));await assert.rejects(saveWorkTeam(input),{status:502});
 fetch.mock.mockImplementation(async()=>Response.json({error:'Sem permissão.'},{status:403}));await assert.rejects(saveWorkTeam(input),{status:403});
});

test('losing affiliation or the sole visible assignment during a read discards the complete team response and export', async t => {
 for(const kind of ['affiliation','assignment','roster']) for(const exporting of [false,true]) {
  const f=await teamScenario(t);
  const team=await f.act('owner-a','team.create',{organizationId:'org-a',name:'Equipe temporária de revisão',userIds:kind==='assignment'?['owner-a']:['viewer-a','owner-a']});
  if(kind==='assignment')await f.act('owner-a','task.create',{projectId:'project-a',title:'Único vínculo visível',teamIds:[team.teamId]});
  let fired=false;
  f.db.afterRead=sql=>{
   if(fired||!sql.startsWith(kind==='roster'?'SELECT tm.team_id':'SELECT team.id'))return;
   fired=true;
   if(kind==='assignment')f.native.prepare('UPDATE followup_assignees SET removed_at=? WHERE team_id=?').run(f.now,team.teamId);
   else f.native.prepare('UPDATE followup_team_members SET removed_at=? WHERE team_id=? AND user_id=?').run(f.now,team.teamId,kind==='roster'?'owner-a':'viewer-a');
  };
  await assert.rejects(teamsWorkspace(f.db,await f.actor('viewer-a'),{projectId:'project-a',teamId:team.teamId},exporting),{status:403,code:'team_access_changed'});
  assert.equal(fired,true);
 }
});
