import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url)),modules=new Map();
const moduleUrl=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const replacements=new Map([
 [resolve(root,'lib/session.ts'),moduleUrl('export async function getPortalUser(){return globalThis.__organizationTest?.user??null;}')],
 [resolve(root,'lib/platform.ts'),moduleUrl("export function database(){return globalThis.__organizationTest.db;} export function bucket(){return globalThis.__organizationTest.storage;} export function ownerEmail(){return undefined;} export function inviteSecret(){return 'synthetic-only-organization-invitation-secret';} export function isStandalone(){return globalThis.__organizationTest?.standalone!==false;}")],
 ['next/headers',moduleUrl('export async function headers(){return globalThis.__organizationTest?.headers??new Headers();}')],
 ['next/navigation',moduleUrl('export function redirect(){throw new Error("Unexpected redirect");}')],
]);
function compile(file){
 if(replacements.has(file))return replacements.get(file);
 file=resolve(root,file);if(replacements.has(file))return replacements.get(file);if(modules.has(file))return modules.get(file);
 if(file.endsWith('.json'))return moduleUrl(`export default ${readFileSync(file,'utf8')};`);
 let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,_quote,dependency)=>{
  if(replacements.has(dependency))return`from ${JSON.stringify(replacements.get(dependency))}`;
  if(!dependency.startsWith('.')&&!dependency.startsWith('@/'))return match;
  const target=dependency.startsWith('@/')?resolve(root,dependency.slice(2)):resolve(dirname(file),dependency);
  return`from ${JSON.stringify(compile(/\.(ts|json)$/.test(target)?target:`${target}.ts`))}`;
 });
 code=code.replace(/\s+with\s+\{\s*type:\s*['"]json['"]\s*\}/g,'');
 const url=moduleUrl(`${code}\n//# sourceURL=organization-${file.replace(root,'')}`);modules.set(file,url);return url;
}
const access=await import(compile('lib/access.ts')),organizations=await import(compile('lib/organizations.ts'));
const {portalSnapshot}=await import(compile('lib/portal-data.ts')),{projectAction,projectDetail}=await import(compile('lib/projects.ts'));
const {campaignAction}=await import(compile('lib/campaigns.ts')),{materialsAction,materialDetail}=await import(compile('lib/materials.ts'));
const {listRecords,createRecord}=await import(compile('lib/records.ts')),{reportRows}=await import(compile('lib/reports.ts'));
const orgRoute=await import(compile('app/api/organizations/route.ts')),exportRoute=await import(compile('app/api/export/route.ts'));
const calendarRoute=await import(compile('app/api/calendar/route.ts')),downloadRoute=await import(compile('app/api/files/[id]/route.ts'));
const recordDownload=await import(compile('app/api/records/files/[id]/route.ts')),mcp=await import(compile('app/mcp/route.ts'));
const {exportPortablePage,describePortableSchemas}=await import(compile('lib/sync/portable.ts'));
const {requireSyncOwner}=await import(compile('lib/sync/contracts.ts'));
const {listManagedUsers,getManagedUser,usersAction}=await import(compile('lib/users.ts'));
const migrationNames=readdirSync(`${root}drizzle`).filter(name=>name.endsWith('.sql')).sort();
const origin='https://portal.example.invalid',secret='synthetic-only-organization-invitation-secret';
function fixture(t){
 const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');
 for(const file of migrationNames)native.exec(readFileSync(`${root}drizzle/${file}`,'utf8'));
 const now=new Date().toISOString(),start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
 function insert(table,row){const columns=Object.keys(row);native.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(row));}
 const db={native,beforeBatch:null,prepare(sql){let values=[];return{bind(...args){values=args;return this;},async first(column){const row=native.prepare(sql).get(...values)??null;return column?row?.[column]??null:row;},async all(){return{results:native.prepare(sql).all(...values),success:true};},async run(){return this.execute();},execute(){const results=native.prepare(sql).all(...values);return{results,success:true,meta:{changes:Number(native.prepare('SELECT changes() AS n').get().n)}};}};},async batch(statements){if(this.beforeBatch){const hook=this.beforeBatch;this.beforeBatch=null;hook();}native.exec('BEGIN');try{const result=statements.map(statement=>statement.execute());native.exec('COMMIT');return result;}catch(error){native.exec('ROLLBACK');throw error;}}};
 function user(id,role,project=null,organizationId=null,email=`${id}@example.invalid`){insert('portal_users',{user_id:id,email,status:'active',created_at:now,updated_at:now});if(role)insert('members',{id:`member-${id}`,user_id:id,email,role,project_id:project,organization_id:organizationId,created_at:now});return{userId:id,email,displayName:id};}
 for(const suffix of ['a','b']){
  insert('organizations',{id:`org-${suffix}`,name:`ORGANIZATION ${suffix.toUpperCase()}`,slug:`organization-${suffix}`,created_at:now,updated_at:now});
  insert('projects',{id:`project-${suffix}`,organization_id:`org-${suffix}`,name:`PROJECT ${suffix.toUpperCase()}`,created_at:now,starts_at:start,ends_at:end});
  insert('items',{id:`gift-${suffix}`,project_id:`project-${suffix}`,name:`GIFT ${suffix.toUpperCase()}`,category:'gift',unit:'un',stock:100,created_at:now});
  insert('items',{id:`asset-${suffix}`,project_id:`project-${suffix}`,name:`ASSET ${suffix.toUpperCase()}`,category:'equipment',unit:'un',stock:1,created_at:now});
  for(const[kind,quantity]of[['brinde',1],['super',3]]){insert('offers',{id:`${kind}-${suffix}`,project_id:`project-${suffix}`,name:`${kind}-${suffix}`,kind,active:1});insert('offer_components',{offer_id:`${kind}-${suffix}`,item_id:`gift-${suffix}`,quantity});}
  insert('campaigns',{id:`campaign-${suffix}`,project_id:`project-${suffix}`,name:`CAMPAIGN ${suffix.toUpperCase()}`,starts_at:start,ends_at:end,status:'active',retry_limit:0,brinde_offer_id:`brinde-${suffix}`,super_offer_id:`super-${suffix}`,rules_text:'Approved rules',created_at:now});
  insert('loans',{id:`loan-${suffix}`,project_id:`project-${suffix}`,item_id:`asset-${suffix}`,action_name:`LOAN ${suffix.toUpperCase()}`,borrower_name:'PRIVATE BORROWER',starts_at:Date.now()+3600000,ends_at:Date.now()+7200000,created_by:'fixture',created_at:now});
  insert('records',{id:`record-${suffix}`,project_id:`project-${suffix}`,kind:'observation',title:`RECORD ${suffix.toUpperCase()}`,body:`Body ${suffix}`,occurred_at:now,created_by:'fixture',created_at:now});
 }
 insert('projects',{id:'legacy-project',name:'LEGACY PROJECT',created_at:now});
 insert('settings',{name:'privacyNotice',value:'Institution-approved notice',updated_at:now});
 const platform=user('platform','owner'),adminA=user('admin-a','owner',null,'org-a'),adminB=user('admin-b','owner',null,'org-b');
 const manager=user('manager-a','manager','project-a','org-a'),scholar=user('scholar-a','viewer','project-a','org-a','scholar@ufg.br'),external=user('external-a','viewer','project-a','org-a');
 const legacy=user('legacy-reader','viewer');
 const objects=new Map(),storage={reads:0,async get(key){this.reads++;const bytes=objects.get(key);return bytes?{body:bytes,size:bytes.byteLength}:null;}};
 const pdf=new TextEncoder().encode('%PDF-1.7\nSynthetic private term\n%%EOF');
 for(const suffix of ['a','b']){const key=`private-document-${suffix}`;objects.set(key,pdf);insert('documents',{id:`document-${suffix}`,loan_id:`loan-${suffix}`,project_id:`project-${suffix}`,object_key:key,name:'term.pdf',mime:'application/pdf',size:pdf.byteLength,created_by:'fixture',created_at:now});const recordKey=`private-record-${suffix}`;objects.set(recordKey,pdf);insert('record_attachments',{id:`attachment-${suffix}`,record_id:`record-${suffix}`,project_id:`project-${suffix}`,object_key:recordKey,name:'record.pdf',mime:'application/pdf',size:pdf.byteLength,operation_key:`attachment-operation-${suffix}`,created_by:'fixture',created_at:now});}
 function observe(who){globalThis.__organizationTest={db,storage,user:who,standalone:true,headers:new Headers()};}
 t.after(()=>{native.close();delete globalThis.__organizationTest;});observe(adminA);
 return{native,db,insert,user,platform,adminA,adminB,manager,scholar,external,legacy,observe,storage,now};
}
const acting=(f,user)=>access.getActor(f.db,user);
const post=input=>new Request(`${origin}/api/organizations`,{method:'POST',headers:{Origin:origin,'X-Proex-Action':'1','Content-Type':'application/json'},body:JSON.stringify(input)});
const projectInput=organizationId=>({organizationId,name:'New project',status:'active',color:'#54216C',prizesEnabled:false,operationKey:crypto.randomUUID()});

test('organization administrators, project managers, scholars and external people see only assigned organizations and projects',async t=>{
 const f=fixture(t);
 for(const[user,suffix]of[[f.adminA,'a'],[f.adminB,'b'],[f.manager,'a'],[f.scholar,'a'],[f.external,'a']]){
  const actor=await acting(f,user),snapshot=await portalSnapshot(f.db,actor);
  const other=suffix==='a'?'b':'a';
  assert.deepEqual(snapshot.projects.map(project=>project.id),[`project-${suffix}`]);assert.deepEqual(snapshot.organizations.map(org=>org.id),[`org-${suffix}`]);
  assert.ok(!JSON.stringify(snapshot).includes(`PROJECT ${other.toUpperCase()}`));assert.ok(!JSON.stringify(snapshot).includes(`admin-${other}@example.invalid`));
  assert.equal((await projectDetail(f.db,actor,`project-${suffix}`)).project.organization_id,`org-${suffix}`);await assert.rejects(projectDetail(f.db,actor,`project-${other}`),{status:404});
  assert.throws(()=>access.requireCapability(actor,'organization.manage',null),{status:403});
 }
 assert.deepEqual(access.accessibleProjects(await acting(f,f.legacy)),['legacy-project']);
 assert.equal(access.accessibleProjects(await acting(f,f.platform)),null);
});

test('organizations are created by platform administration, use CAS, and local admins cannot manage a different organization',async t=>{
 const f=fixture(t),admin=await acting(f,f.adminA),platform=await acting(f,f.platform);
 await assert.rejects(organizations.organizationAction(f.db,admin,'organization.create',{name:'Forbidden',slug:'forbidden'}),{status:403});
 await assert.rejects(organizations.organizationAction(f.db,admin,'organization.update',{organizationId:'org-b',name:'Forbidden',expectedVersion:1}),{status:403});
 const created=await organizations.organizationAction(f.db,platform,'organization.create',{name:'New organization',slug:'new-organization'});assert.ok(created.organization.id);
 const updated=await organizations.organizationAction(f.db,admin,'organization.update',{organizationId:'org-a',name:'Organization A revised',expectedVersion:1});assert.equal(updated.organization.version,2);
 await assert.rejects(organizations.organizationAction(f.db,admin,'organization.update',{organizationId:'org-a',name:'Stale overwrite',expectedVersion:1}),{status:409});
 f.db.beforeBatch=()=>f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now,f.adminA.userId);
 await assert.rejects(organizations.organizationAction(f.db,admin,'organization.update',{organizationId:'org-a',name:'Revoked overwrite',expectedVersion:2}),{status:403});
 assert.equal(f.native.prepare("SELECT name FROM organizations WHERE id='org-a'").get().name,'Organization A revised');
});

test('an organization admin creates only own projects; SQL rejects forged scope maps, cross-organization parents and transfers',async t=>{
 const f=fixture(t),admin=await acting(f,f.adminA),platform=await acting(f,f.platform);
 const created=await projectAction(f.db,admin,'project.create',projectInput('org-a'));assert.equal(created.project.organization_id,'org-a');
 await assert.rejects(projectAction(f.db,admin,'project.create',projectInput('org-b')),{status:403});
 await assert.rejects(projectAction(f.db,admin,'project.update',{id:'project-a',expectedVersion:1,organizationId:'org-b'}),{status:400});
 assert.throws(()=>f.native.prepare("UPDATE projects SET organization_id='org-b' WHERE id='project-a'").run(),/organization_transfer/);
 assert.throws(()=>f.native.prepare("UPDATE projects SET parent_id='project-b' WHERE id='project-a'").run(),/organization_parent/);
 const forged={...admin,organizationProjects:{'org-a':['project-a','project-b']}};
 await assert.rejects(campaignAction(f.db,forged,'campaign.status',{id:'campaign-b',status:'closed'}),{status:403});
 await assert.rejects(materialsAction(f.db,forged,'stock.move',{itemId:'gift-b',delta:1,kind:'receive',note:'forbidden',operationKey:crypto.randomUUID()}));
 assert.equal(f.native.prepare("SELECT status FROM campaigns WHERE id='campaign-b'").get().status,'active');
 assert.equal((await projectDetail(f.db,platform,'project-b')).project.organization_id,'org-b');
});

test('institutional or external invitations and organization-wide legacy roles never inherit another organization',async t=>{
 const f=fixture(t),admin=await acting(f,f.adminA);
 for(const recipient of ['invited@ufg.br','invited@example.invalid']){
  const user=f.user(crypto.randomUUID(),null,null,null,recipient),before=await acting(f,user);
  const invitation=await access.accessAction(f.db,admin,'invite.create',{email:recipient,role:'viewer',projectId:null,organizationId:'org-a',globalAccess:true,operationKey:crypto.randomUUID()},origin,secret);
  await access.accessAction(f.db,before,'invite.accept',{token:new URL(invitation.inviteUrl).searchParams.get('token')},origin);
  const actor=await acting(f,user);assert.deepEqual(access.accessibleProjects(actor),['project-a']);assert.throws(()=>access.requireCapability(actor,'reports.read','project-b'),{status:403});
  assert.equal(f.native.prepare('SELECT organization_id FROM members WHERE user_id=?').get(user.userId).organization_id,'org-a');
 }
 await assert.rejects(access.accessAction(f.db,admin,'invite.create',{email:'forbidden@example.invalid',role:'manager',projectId:'project-b',operationKey:crypto.randomUUID()},origin,secret),{status:403});
 await assert.rejects(access.accessAction(f.db,admin,'invite.create',{email:'forbidden@example.invalid',role:'viewer',organizationId:'org-b',globalAccess:true,operationKey:crypto.randomUUID()},origin,secret),{status:403});
});

test('reports, CSV, calendar JSON/ICS and both private file routes remain inside the organization',async t=>{
 const f=fixture(t),admin=await acting(f,f.adminA);
 for(const dataset of ['projects','materials','movements','loans','records','campaigns']){
  assert.deepEqual((await reportRows(f.db,admin,{dataset,organizationId:'org-b'})).rows,[]);
  assert.ok(!(JSON.stringify((await reportRows(f.db,admin,{dataset})).rows)).includes('PROJECT B'));
 }
 f.observe(f.adminA);
 for(const kind of ['participations','stock','loans']){
  const response=await exportRoute.GET(new Request(`${origin}/api/export?kind=${kind}&organizationId=org-b`));assert.equal(response.status,200);assert.ok(!(await response.text()).includes('PROJECT B'));
  assert.equal((await exportRoute.GET(new Request(`${origin}/api/export?kind=${kind}&projectId=project-b`))).status,403);
 }
 for(const format of ['json','ics']){
  const response=await calendarRoute.GET(new Request(`${origin}/api/calendar?from=2026-10-01&to=2026-11-30&format=${format}`));assert.equal(response.status,200);assert.ok(!(await response.text()).includes('PROJECT B'));
  assert.equal((await calendarRoute.GET(new Request(`${origin}/api/calendar?from=2026-10-01&to=2026-11-30&category=loans&projectId=project-b&format=${format}`))).status,403);
 }
 for(const[route,own,foreign]of[[downloadRoute,'document-a','document-b'],[recordDownload,'attachment-a','attachment-b']]){
  assert.equal((await route.GET(new Request(`${origin}/api/file`),{params:Promise.resolve({id:own})})).status,200);
  const reads=f.storage.reads;assert.equal((await route.GET(new Request(`${origin}/api/file`),{params:Promise.resolve({id:foreign})})).status,403);assert.equal(f.storage.reads,reads);
 }
 assert.equal((await materialDetail(f.db,admin,'gift-a')).item.project_id,'project-a');await assert.rejects(materialDetail(f.db,admin,'gift-b'));
 await assert.rejects(listRecords(f.db,admin,{projectId:'project-b'}),{status:403});
});

test('organization admin creation/revocation is explicit, local, replay-safe and preserves a remaining administrator',async t=>{
 const f=fixture(t),admin=await acting(f,f.adminA),platform=await acting(f,f.platform);
 await assert.rejects(organizations.organizationAction(f.db,admin,'organization.admin.grant',{organizationId:'org-a',userId:f.manager.userId}),{status:400});
 await assert.rejects(organizations.organizationAction(f.db,admin,'organization.admin.grant',{organizationId:'org-a',userId:f.adminB.userId,confirmed:true}),{status:404});
 const grant=await organizations.organizationAction(f.db,admin,'organization.admin.grant',{organizationId:'org-a',userId:f.manager.userId,confirmed:true});assert.equal(grant.member.organization_id,'org-a');
 const repeated=await organizations.organizationAction(f.db,admin,'organization.admin.grant',{organizationId:'org-a',userId:f.manager.userId,confirmed:true});assert.equal(repeated.member.id,grant.member.id);
 await organizations.organizationAction(f.db,admin,'organization.admin.revoke',{organizationId:'org-a',memberId:grant.member.id,confirmed:true});
 await assert.rejects(organizations.organizationAction(f.db,platform,'organization.admin.revoke',{organizationId:'org-a',memberId:'member-admin-a',confirmed:true}),{status:409});
 assert.equal((await acting(f,f.platform)).members.find(member=>member.role==='owner').organization_id,null);
});

test('Sheets/MCP stay platform-only, and forged native headers do not authenticate the standalone runtime',async t=>{
 const f=fixture(t),admin=await acting(f,f.adminA),platform=await acting(f,f.platform);
 await assert.rejects(requireSyncOwner(f.db,admin),{status:403});await assert.rejects(exportPortablePage(f.db,admin,{table:'projects'}),{status:403});
 const exported=await exportPortablePage(f.db,platform,{table:'projects'});assert.ok(exported.rows.every(row=>row.organization_id));
 const schema=describePortableSchemas();assert.equal(schema.tables.find(table=>table.table==='organizations').mode,'read_only');assert.equal(schema.tables.find(table=>table.table==='projects').columns.find(column=>column.name==='organization_id').editable,false);
 const request=new Request(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':f.platform.userId,'oai-authenticated-user-email':f.platform.email},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'proex_sync_read',arguments:{table:'projects'}}})});
 globalThis.__organizationTest.headers=request.headers;
 const denied=await(await mcp.POST(request)).json();assert.equal(denied.result.isError,true);
 globalThis.__organizationTest.standalone=false;globalThis.__organizationTest.headers=new Headers({'oai-authenticated-user-id':f.adminA.userId,'oai-authenticated-user-email':f.adminA.email});
 const localAdmin=await(await mcp.POST(request)).json();assert.equal(localAdmin.result.isError,true);
});

test('organization HTTP actions enforce CSRF, expose own management detail and never trust claimed owner headers',async t=>{
 const f=fixture(t);f.observe(f.adminA);
 const listed=await orgRoute.GET(new Request(`${origin}/api/organizations`));assert.equal(listed.status,200);assert.equal(listed.headers.get('Cache-Control'),'private, no-store');
 const body=await listed.json();assert.deepEqual(body.organizations.map(row=>row.id),['org-a']);assert.equal(body.organizations[0].canManage,true);
 const detail=await orgRoute.GET(new Request(`${origin}/api/organizations?organizationId=org-a`));assert.equal(detail.status,200);assert.ok((await detail.json()).members.every(member=>member.organization_id==='org-a'));
 assert.equal((await orgRoute.GET(new Request(`${origin}/api/organizations?organizationId=org-b`,{headers:{'oai-authenticated-user-id':f.platform.userId}}))).status,403);
 const hostile=new Request(`${origin}/api/organizations`,{method:'POST',headers:{Origin:'https://hostile.invalid','X-Proex-Action':'1','Content-Type':'application/json'},body:JSON.stringify({action:'organization.create',name:'Hostile',slug:'hostile'})});
 assert.equal((await orgRoute.POST(hostile)).status,403);
 assert.equal((await orgRoute.POST(post({action:'organization.update',organizationId:'org-b',expectedVersion:1,name:'Unauthorized'}))).status,403);
 f.observe(null);assert.equal((await orgRoute.GET(new Request(`${origin}/api/organizations`))).status,401);
});

test('revoked organization admins cannot read cached snapshots/reports or leave project/record/stock effects',async t=>{
 const f=fixture(t),admin=await acting(f,f.adminA);
 f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now,f.adminA.userId);
 assert.deepEqual((await reportRows(f.db,admin,{dataset:'projects'})).rows,[]);
 assert.deepEqual((await portalSnapshot(f.db,admin)).projects,[]);
 assert.deepEqual((await portalSnapshot(f.db,admin)).organizations,[]);
 await assert.rejects(projectDetail(f.db,admin,'project-a'),{status:404});
 await assert.rejects(createRecord(f.db,admin,{projectId:'project-a',kind:'observation',title:'Denied',body:'Denied',occurredAt:f.now,operationKey:crypto.randomUUID()}));
 await assert.rejects(materialsAction(f.db,admin,'stock.move',{itemId:'gift-a',delta:1,kind:'receive',note:'Denied',operationKey:crypto.randomUUID()}),{status:403});
 await assert.rejects(projectAction(f.db,admin,'project.create',projectInput('org-a')));
 assert.equal(f.native.prepare("SELECT stock FROM items WHERE id='gift-a'").get().stock,100);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM records WHERE title='Denied'").get().n,0);
});

test('organization management flags use current authority after a cached administrator is demoted',async t=>{
 const f=fixture(t),admin=await acting(f,f.adminA);
 assert.equal((await organizations.listOrganizations(f.db,admin))[0].canManage,true);
 f.native.prepare("UPDATE members SET role='viewer' WHERE id='member-admin-a'").run();
 const listed=await organizations.listOrganizations(f.db,admin),snapshot=await portalSnapshot(f.db,admin);
 assert.deepEqual(listed.map(org=>[org.id,org.canManage]),[['org-a',false]]);
 assert.deepEqual(snapshot.organizations.map(org=>[org.id,org.canManage]),[['org-a',false]]);
});

test('an organization owner never substitutes a revoked platform grant for global type writes or receipts',async t=>{
 const f=fixture(t);
 f.insert('members',{id:'platform-local',user_id:f.platform.userId,email:f.platform.email,role:'owner',project_id:null,organization_id:'org_proex',created_at:f.now});
 const actor=await acting(f,f.platform),input={key:'global_type',label:'Global type',operationKey:crypto.randomUUID()};
 const created=await projectAction(f.db,actor,'project.type.create',input);
 f.native.prepare("UPDATE members SET revoked_at=? WHERE id='member-platform'").run(f.now);
 await assert.rejects(projectAction(f.db,actor,'project.type.create',input),{status:403});
 await assert.rejects(projectAction(f.db,actor,'project.type.create',{key:'denied_type',label:'Denied type',operationKey:crypto.randomUUID()}));
 await assert.rejects(projectAction(f.db,actor,'project.type.update',{id:created.id,label:'Denied edit',expectedVersion:1,operationKey:crypto.randomUUID()}));
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM project_types WHERE key='denied_type'").get().n,0);
 assert.equal(f.native.prepare('SELECT label,version FROM project_types WHERE id=?').get(created.id).label,'Global type');
 assert.equal(f.native.prepare('SELECT label,version FROM project_types WHERE id=?').get(created.id).version,1);
});

test('admin promotion of an organization-wide legacy role preserves old history and fails atomically when target is blocked',async t=>{
 const f=fixture(t),admin=await acting(f,f.adminA);
 const target=f.user('wide-manager','manager',null,'org-a');
 const granted=await organizations.organizationAction(f.db,admin,'organization.admin.grant',{organizationId:'org-a',userId:target.userId,confirmed:true});
 assert.equal(granted.member.role,'owner');assert.ok(f.native.prepare("SELECT revoked_at FROM members WHERE id='member-wide-manager'").get().revoked_at);
 const second=f.user('wide-target','manager',null,'org-a');f.db.beforeBatch=()=>f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(second.userId);
 await assert.rejects(organizations.organizationAction(f.db,admin,'organization.admin.grant',{organizationId:'org-a',userId:second.userId,confirmed:true}),{status:409});
 assert.equal(f.native.prepare("SELECT revoked_at FROM members WHERE id='member-wide-target'").get().revoked_at,null);
});

test('migration 0008 preserves ledgers and historical grants while bounding legacy global roles to PROEX',async t=>{
 const native=new DatabaseSync(':memory:');t.after(()=>native.close());native.exec('PRAGMA foreign_keys=ON');
 for(const file of migrationNames.filter(name=>name<'0008'))native.exec(readFileSync(`${root}drizzle/${file}`,'utf8'));
 const now='2026-10-31T00:00:00.000Z';
 native.prepare("INSERT INTO projects(id,name,created_at) VALUES('legacy','Historical project',?)").run(now);
 native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('legacy-gift','legacy','Historical item','gift','un',0,?)").run(now);
 native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES('historical-movement','legacy-gift',7,'receive','Historical receipt','historical-user',?)").run(now);
 native.prepare("INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES('old-owner','old-owner','old-owner@example.invalid','owner',NULL,NULL,?),('old-global','old-global','old-global@example.invalid','manager',NULL,NULL,?),('old-project','old-project','old-project@example.invalid','viewer','legacy',?,?)").run(now,now,now,now);
 const before=native.prepare('SELECT * FROM stock_movements').all();native.exec(readFileSync(`${root}drizzle/0008_v11_organizations.sql`,'utf8'));
 assert.deepEqual(native.prepare('SELECT * FROM stock_movements').all(),before);assert.equal(native.prepare("SELECT stock FROM items WHERE id='legacy-gift'").get().stock,7);
 assert.equal(native.prepare("SELECT organization_id FROM projects WHERE id='legacy'").get().organization_id,'org_proex');
 assert.equal(native.prepare("SELECT organization_id FROM members WHERE id='old-owner'").get().organization_id,null);
 assert.equal(native.prepare("SELECT organization_id FROM members WHERE id='old-global'").get().organization_id,'org_proex');
 assert.equal(native.prepare("SELECT revoked_at FROM members WHERE id='old-project'").get().revoked_at,now);
 assert.deepEqual(native.prepare('SELECT member_id,classification FROM organization_grant_migrations ORDER BY member_id').all().map(row=>({...row})),[{member_id:'old-global',classification:'legacy_organization'},{member_id:'old-owner',classification:'platform_owner'},{member_id:'old-project',classification:'project'}]);
 assert.throws(()=>native.prepare("DELETE FROM organization_grant_migrations WHERE member_id='old-global'").run(),/immutable/);
 assert.throws(()=>native.prepare("DELETE FROM organizations WHERE id='org_proex'").run(),/organization_has_projects/);
 assert.deepEqual(native.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.ok(native.prepare('PRAGMA foreign_key_list(projects)').all().some(key=>key.from==='organization_id'&&key.table==='organizations'));
});

test('concurrent organization administrators cannot revoke each other and remove every active local administrator',async t=>{
 const f=fixture(t),first=await acting(f,f.adminA);
 const assigned=await organizations.organizationAction(f.db,first,'organization.admin.grant',{organizationId:'org-a',userId:f.manager.userId,confirmed:true}),second=await acting(f,f.manager);
 const results=await Promise.allSettled([
  organizations.organizationAction(f.db,first,'organization.admin.revoke',{organizationId:'org-a',memberId:assigned.member.id,confirmed:true}),
  organizations.organizationAction(f.db,second,'organization.admin.revoke',{organizationId:'org-a',memberId:'member-admin-a',confirmed:true}),
 ]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM members WHERE role='owner' AND organization_id='org-a' AND revoked_at IS NULL").get().n,1);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM members WHERE role='owner' AND organization_id IS NULL AND revoked_at IS NULL").get().n,1);
});

test('database constraints reject mismatched grants and cannot leave a null organization after INSERT OR IGNORE',async t=>{
 const f=fixture(t);
 assert.throws(()=>f.insert('members',{id:'wrong-org',user_id:f.external.userId,email:f.external.email,role:'viewer',project_id:'project-b',organization_id:'org-a',created_at:f.now}),/organization_member_mismatch/);
 assert.throws(()=>f.native.prepare("INSERT OR IGNORE INTO members(id,user_id,email,role,project_id,created_at) VALUES('duplicate-grant',?,'synthetic@example.invalid','viewer','project-a',?)").run(f.external.userId,f.now),/organization_member_required|UNIQUE/);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM members WHERE role!='owner' AND organization_id IS NULL").get().n,0);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM members WHERE user_id=? AND project_id='project-a' AND revoked_at IS NULL").get(f.external.userId).n,1);
});

test('private team details and role changes are local, and generic membership APIs preserve the last organization administrator',async t=>{
 const f=fixture(t),admin=await acting(f,f.adminA),platform=await acting(f,f.platform);
 const directory=await listManagedUsers(f.db,admin);assert.ok(directory.length);assert.ok(directory.every(person=>person.userId!==f.adminB.userId));
 await assert.rejects(getManagedUser(f.db,admin,f.adminB.userId),{status:404});
 await assert.rejects(usersAction(f.db,admin,'member.change',{memberId:'member-admin-b',role:'viewer',operationKey:crypto.randomUUID()}),{status:403});
 await assert.rejects(access.accessAction(f.db,platform,'member.revoke',{id:'member-admin-a'},origin),{status:409});
 await assert.rejects(usersAction(f.db,platform,'member.change',{memberId:'member-admin-a',role:'viewer',operationKey:crypto.randomUUID()}),{status:409});
 assert.equal(f.native.prepare("SELECT revoked_at FROM members WHERE id='member-admin-a'").get().revoked_at,null);
});

test('organization revocation immediately before new writes leaves no project, category, item, offer or movement claim',async t=>{
 for(const action of ['project.create','material.category.create','item.create','offer.create','stock.move']){
  const f=fixture(t),admin=await acting(f,f.adminA);
  const before={projects:f.native.prepare('SELECT COUNT(*) n FROM projects').get().n,items:f.native.prepare('SELECT COUNT(*) n FROM items').get().n,claims:f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,audit:f.native.prepare('SELECT COUNT(*) n FROM audit').get().n};
  const input={...projectInput('org-a'),projectId:'project-a',name:'Denied creation',label:'Denied category',coreKind:'gift',category:'gift',unit:'un',kind:action==='stock.move'?'receive':'brinde',itemId:'gift-a',delta:1,note:'Denied',components:[{itemId:'gift-a',quantity:1}]};
  f.db.beforeBatch=()=>f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now,f.adminA.userId);
  await assert.rejects(action==='project.create'?projectAction(f.db,admin,action,input):materialsAction(f.db,admin,action,input));
  assert.deepEqual({projects:f.native.prepare('SELECT COUNT(*) n FROM projects').get().n,items:f.native.prepare('SELECT COUNT(*) n FROM items').get().n,claims:f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,audit:f.native.prepare('SELECT COUNT(*) n FROM audit').get().n},before);
 }
});
