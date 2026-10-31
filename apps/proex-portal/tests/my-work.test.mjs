import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {resolve,dirname,join,sep} from 'node:path';import ts from 'typescript';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createArchive,validateArchive} from '../platform-node/backup-format.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
function compile(file){file=resolve(root,file);if(cache.has(file))return cache.get(file);let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;code=code.replace(/from (['"])(\.[^'"]+)\1/g,(_m,_q,name)=>`from ${JSON.stringify(compile(resolve(dirname(file),name+'.ts')))}`);const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,url);return url;}
const {getActor}=await import(compile('lib/access.ts'));
const {followupAction,followupList}=await import(compile('lib/follow-up/service.ts'));
const {serverWorkClock,workDayFromServerTimestamp}=await import(compile('lib/follow-up/time.ts'));
const {exportPortablePage,describePortableSchemas}=await import(compile('lib/sync/portable.ts'));
const {myWork}=await import(compile('lib/my-work/service.ts'));
const {responsibilityAction,responsibilityList,responsibilityDetail,responsibilityCatalog}=await import(compile('lib/responsibilities/service.ts'));
const {isMyWorkResponse,isResponsibilityResult,isResponsibilityList,isResponsibilityCatalog}=await import(compile('lib/my-work/contracts.ts'));
function fixture(t){const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(root+'drizzle').filter(n=>n.endsWith('.sql')).sort())native.exec(readFileSync(root+'drizzle/'+name,'utf8'));t.after(()=>native.close());const now=new Date().toISOString();
 const insert=(table,row)=>{const cols=Object.keys(row);native.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));};
 for(const suffix of ['a','b']){insert('organizations',{id:`org-${suffix}`,name:`Organization ${suffix}`,slug:`org-${suffix}`,created_at:now,updated_at:now});insert('projects',{id:`project-${suffix}`,organization_id:`org-${suffix}`,name:`Project ${suffix}`,created_at:now});insert('items',{id:`item-${suffix}`,project_id:`project-${suffix}`,name:suffix==='a'?'Coletes P/M/G':'Private organization B item',category:'distribution',unit:'un',stock:40,created_at:now});insert('campaigns',{id:`campaign-${suffix}`,project_id:`project-${suffix}`,name:`Event ${suffix}`,starts_at:now,ends_at:new Date(Date.now()+86400000).toISOString(),status:'active',created_at:now});}
 const users={};function user(name,role,project,org){insert('portal_users',{user_id:name,email:name+'@example.invalid',status:'active',created_at:now,updated_at:now});insert('profiles',{user_id:name,display_name:name,created_at:now,updated_at:now});insert('members',{id:'member-'+name,user_id:name,email:name+'@example.invalid',role,project_id:project,organization_id:org,created_at:now});return users[name]={userId:name,email:name+'@example.invalid',displayName:name};}
 user('platform','owner',null,null);user('admin-a','owner',null,'org-a');user('admin-b','owner',null,'org-b');user('manager-a','manager','project-a','org-a');user('viewer-a','viewer','project-a','org-a');user('worker-a','inventory','project-a','org-a');user('worker-b','inventory','project-b','org-b');
 const db={native,reads:0,before:null,fail:null,prepare(sql){let values=[];return{sql,bind(...args){values=args;return this;},async first(){db.reads++;return native.prepare(sql).get(...values)??null;},async all(){db.reads++;return{results:native.prepare(sql).all(...values)};},async run(){return this.execute();},execute(){if(db.fail?.test(sql)){db.fail=null;throw new Error('synthetic storage failure');}const results=native.prepare(sql).all(...values);return{results,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(this.before){const hook=this.before;this.before=null;hook();}native.exec('BEGIN');try{const results=statements.map(s=>s.execute());native.exec('COMMIT');return results;}catch(error){native.exec('ROLLBACK');throw error;}}};
 return{db,native,users,insert,now,actor:name=>getActor(db,users[name])};
}
const save=(extra={})=>({action:'responsibility.save',projectId:'project-a',area:'materials',itemId:'item-a',expectedVersion:0,userIds:['worker-a'],teamIds:[],operationKey:crypto.randomUUID(),...extra});
const responsibility=(f,actor,input)=>responsibilityAction(f.db,actor,input.action,input);
async function team(f,users,name='Comunicação'){const result=await followupAction(f.db,await f.actor('admin-a'),'team.create',{action:'team.create',organizationId:'org-a',name,userIds:users,operationKey:crypto.randomUUID()});return result.teamId;}
function task(f,{id=crypto.randomUUID(),user='worker-a',teams=[],status='open',due=null,createdBy='manager-a',project='project-a',...extra}={}){f.insert('followup_tasks',{id,organization_id:project==='project-b'?'org-b':'org-a',project_id:project,title:'Demanda sintética '+id,priority:'high',status,due_at:due,created_by:createdBy,created_at:f.now,updated_at:f.now,...extra});if(user)f.insert('followup_assignees',{id:crypto.randomUUID(),task_id:id,user_id:user,created_at:f.now});for(const teamId of teams)f.insert('followup_assignees',{id:crypto.randomUUID(),task_id:id,team_id:teamId,created_at:f.now});return id;}

test('explicit responsibility assignments overlap without granting access; viewer labels remain domain-private',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),worker=await f.actor('worker-a'),viewer=await f.actor('viewer-a'),a=await team(f,['worker-a','viewer-a']),b=await team(f,['worker-a'],'TI');
 const created=await responsibility(f,manager,save({userIds:['worker-a','viewer-a'],teamIds:[a,b]}));assert.ok(isResponsibilityResult(created));assert.equal(created.responsibility.version,1);
 const work=await myWork(f.db,worker);assert.ok(isMyWorkResponse(work));assert.equal(work.totals.responsibilities.total,1);assert.equal(work.responsibilities.items[0].assignmentVia,'both');assert.equal(work.responsibilities.items[0].target.name,'Coletes P/M/G');
 const restricted=await myWork(f.db,viewer);assert.equal(restricted.responsibilities.items[0].canEdit,false);assert.deepEqual(restricted.responsibilities.items[0].target,{kind:'materials',id:null,name:null,canOpen:false,href:null});
 await assert.rejects(responsibility(f,viewer,save({expectedVersion:1})),{status:403});assert.equal(f.native.prepare("SELECT role FROM members WHERE user_id='viewer-a'").get().role,'viewer');assert.equal(f.native.prepare("SELECT stock FROM items WHERE id='item-a'").get().stock,40);
 assert.equal((await myWork(f.db,await f.actor('worker-b'))).totals.responsibilities.total,0);await assert.rejects(responsibilityDetail(f.db,await f.actor('worker-b'),created.responsibility.id),{status:404});
});

test('personal work never infers assignments from creation, borrower, documentary responsibility or permission',async t=>{
 const f=fixture(t),worker=await f.actor('worker-a');task(f,{user:null,createdBy:'worker-a'});
 f.native.prepare("UPDATE items SET responsible_reference='worker-a' WHERE id='item-a'").run();
 const work=await myWork(f.db,worker);assert.equal(work.totals.tasks.total,0);assert.equal(work.tasks.items.length,0);assert.equal(work.totals.responsibilities.total,0);assert.ok(isMyWorkResponse(work));
});

test('contextual entity links follow the primary area, including a task linked to both a loan and its material',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),viewer=await f.actor('viewer-a');
 f.native.prepare("UPDATE items SET category='equipment',stock=1 WHERE id='item-a'").run();
 f.insert('loans',{id:'loan-a',project_id:'project-a',item_id:'item-a',action_name:'Retirada sintética',borrower_name:'Pessoa sintética',starts_at:Date.now(),ends_at:Date.now()+3600000,status:'reserved',created_by:'manager-a',created_at:f.now});
 task(f,{id:'multiple-references',user:'manager-a',item_id:'item-a',loan_id:'loan-a',campaign_id:'campaign-a'});
 const work=await myWork(f.db,manager),target=work.tasks.items[0].target;assert.equal(target.kind,'loans');assert.equal(target.id,'loan-a');assert.equal(target.name,'Retirada sintética');assert.equal(target.href,'/?module=loans&project=project-a&loanId=loan-a');assert.equal(new URL(target.href,'https://portal.example.invalid').searchParams.has('itemId'),false);
 for(const [area,extra,param,value] of [['materials',{itemId:'item-a'},'itemId','item-a'],['loans',{itemId:null,loanId:'loan-a'},'loanId','loan-a'],['campaigns',{itemId:null,campaignId:'campaign-a'},'campaignId','campaign-a'],['projects',{itemId:null},'detailProject','project-a']]){const saved=await responsibility(f,manager,save({area,...extra,userIds:['viewer-a']}));const url=new URL(saved.responsibility.target.href,'https://portal.example.invalid');assert.equal(url.searchParams.get(param),value);assert.equal(saved.responsibility.target.id,value);if(area!=='projects'){const restricted=await responsibilityDetail(f.db,viewer,saved.responsibility.id);assert.equal(restricted.responsibility.target.href,null);assert.equal(restricted.responsibility.target.name,null);assert.equal(restricted.responsibility.target.id,null);}}
 const general=await responsibility(f,manager,save({itemId:null}));assert.equal(general.responsibility.target.id,null);assert.equal(general.responsibility.target.href,'/?module=materials&project=project-a');
});

test('complete SQL counts, attention union and real status filters remain correct beyond 50 rows and overlapping teams',async t=>{
 const f=fixture(t),worker=await f.actor('worker-a'),a=await team(f,['worker-a']),b=await team(f,['worker-a'],'TI'),today=new Date(Date.now()-10800000).toISOString().slice(0,10);
 for(let i=0;i<67;i++)task(f,{id:'task-'+String(i).padStart(3,'0'),teams:[a,b],status:i<7?'completed':i<17?'blocked':i<27?'in_progress':'open',due:i<17?'2001-01-01':today});
 const work=await myWork(f.db,worker,{limit:20});assert.ok(isMyWorkResponse(work));assert.deepEqual(work.totals.tasks,{total:67,pending:60,attention:10,overdue:10,dueToday:50,inProgress:10,blocked:10,completed:7,cancelled:0});assert.equal(work.tasks.total,60);assert.equal(work.tasks.items.length,20);assert.equal(work.tasks.hasMore,true);
 const all=await myWork(f.db,worker,{status:'all',limit:50,taskOffset:50});assert.equal(all.tasks.items.length,17);assert.equal(all.tasks.total,67);assert.equal(all.tasks.hasMore,false);assert.deepEqual(all.totals,work.totals);
 for(const [status,total] of [['attention',10],['overdue',10],['due_today',50],['in_progress',10],['blocked',10],['open',40],['completed',7],['cancelled',0]]){const filtered=await myWork(f.db,worker,{status});assert.equal(filtered.tasks.total,total,status);assert.equal(filtered.tasks.items.length,Math.min(20,total),status);assert.deepEqual(filtered.totals,work.totals);}
 for(const assignment of ['direct','team'])assert.equal((await myWork(f.db,worker,{assignment})).totals.tasks.total,67);
 assert.equal(work.areas.reduce((n,a)=>n+a.taskCounts.total,0),67);
 const counts=f.native.prepare('SELECT (SELECT COUNT(*) FROM audit) audit,(SELECT COUNT(*) FROM mutation_keys) receipts,(SELECT COUNT(*) FROM followup_notifications) notices').get();await myWork(f.db,worker);assert.deepEqual(f.native.prepare('SELECT (SELECT COUNT(*) FROM audit) audit,(SELECT COUNT(*) FROM mutation_keys) receipts,(SELECT COUNT(*) FROM followup_notifications) notices').get(),counts);
});

test('team removal, account blocks, membership revocation and scope revocation immediately remove personal work',async t=>{
 for(const kind of ['team','blocked','membership','responsibility','archived']){const f=fixture(t),worker=await f.actor('worker-a'),manager=await f.actor('manager-a'),a=await team(f,['worker-a']);const made=await responsibility(f,manager,save({userIds:[],teamIds:[a]}));task(f,{user:null,teams:[a]});assert.equal((await myWork(f.db,worker)).totals.responsibilities.total,1);
 if(kind==='team')f.native.prepare('UPDATE followup_team_members SET removed_at=? WHERE team_id=?').run(f.now,a);
 if(kind==='blocked')f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='worker-a'").run();
 if(kind==='membership')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='worker-a'").run(f.now);
 if(kind==='archived')f.native.prepare("UPDATE organizations SET status='archived' WHERE id='org-a'").run();
 if(kind==='responsibility')await responsibility(f,manager,{action:'responsibility.revoke',id:made.responsibility.id,expectedVersion:1,operationKey:crypto.randomUUID()});
 const work=await myWork(f.db,worker);assert.equal(work.totals.responsibilities.total,0,kind);if(kind!=='responsibility')assert.equal(work.totals.tasks.total,0,kind);
 }
});

test('responsibility scope, subjects, CAS, replay, rollback and reactivation remain explicit and atomic',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a');for(const extra of [{itemId:'item-b'},{area:'loans',itemId:'item-a'},{userIds:['worker-b']},{teamIds:['missing-team']}])await assert.rejects(responsibility(f,manager,save(extra)));
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM work_responsibility_scopes').get().n,0);
 const input=save(),first=await responsibility(f,manager,input);assert.equal((await responsibility(f,manager,input)).duplicate,true);
 await assert.rejects(responsibility(f,manager,save()),{status:409});
 const revoked=await responsibility(f,manager,{action:'responsibility.revoke',id:first.responsibility.id,expectedVersion:1,operationKey:crypto.randomUUID()});assert.equal(revoked.responsibility.status,'revoked');assert.deepEqual(revoked.responsibility.assignees,[]);
 const reactivated=await responsibility(f,manager,save({expectedVersion:2,userIds:['viewer-a']}));assert.equal(reactivated.responsibility.id,first.responsibility.id);assert.equal(reactivated.responsibility.version,3);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM work_responsibility_history').get().n,3);
 const claims=f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n;f.db.before=()=>f.native.prepare("UPDATE members SET role='viewer' WHERE user_id='manager-a'").run();await assert.rejects(responsibility(f,manager,save({expectedVersion:3})),{status:403});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,claims);await assert.rejects(responsibility(f,manager,input),{status:403});
});

test('catalog and target-specific lists bind actor/project and disclose only eligible minimal names',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),worker=await f.actor('worker-a');await responsibility(f,manager,save());await responsibility(f,manager,save({itemId:null}));
 const catalog=await responsibilityCatalog(f.db,manager,{projectId:'project-a'});assert.ok(isResponsibilityCatalog(catalog));assert.equal(catalog.viewerId,'manager-a');assert.equal(catalog.projectId,'project-a');assert.ok(!JSON.stringify(catalog).includes('@example.invalid'));assert.ok(!JSON.stringify(catalog).includes('worker-b'));
 const none=await responsibilityCatalog(f.db,worker,{projectId:'project-a'});assert.equal(none.canManage,false);assert.deepEqual(none.people,[]);assert.deepEqual(none.items,[]);
 const list=await responsibilityList(f.db,manager,{projectId:'project-a',area:'materials',target:'area',status:'all'});assert.ok(isResponsibilityList(list));assert.equal(list.items.length,1);assert.equal(list.items[0].item_id,null);
 const entity=await responsibilityList(f.db,manager,{projectId:'project-a',area:'materials',itemId:'item-a'});assert.equal(entity.items.length,1);assert.equal(entity.items[0].item_id,'item-a');
});

test('a changed assignee and an audit failure roll back the complete responsibility transaction',async t=>{
 for(const failure of ['subject','audit']){const f=fixture(t),manager=await f.actor('manager-a');if(failure==='subject')f.db.before=()=>f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='worker-a'").run();else f.db.fail=/INSERT INTO audit/;
 await assert.rejects(responsibility(f,manager,save()));for(const table of ['work_responsibility_scopes','work_responsibility_assignees','work_responsibility_history','mutation_keys'])assert.equal(f.native.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table);
 }
});

test('concurrent retries and lost replies preserve one designating revision and revalidate management on recovery',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),input=save();const both=await Promise.all([responsibility(f,manager,input),responsibility(f,manager,input)]);assert.equal(both[0].responsibility.id,both[1].responsibility.id);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM work_responsibility_history').get().n,1);
 const execute=f.db.batch.bind(f.db);let lose=true;f.db.batch=async statements=>{const result=await execute(statements);if(lose){lose=false;throw new Error('lost synthetic response');}return result;};const saved=await responsibility(f,manager,save({area:'projects',itemId:null}));assert.equal(saved.duplicate,true);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM work_responsibility_scopes').get().n,2);
 lose=true;f.db.batch=async statements=>{const result=await execute(statements);if(lose){lose=false;f.native.prepare("UPDATE members SET role='viewer' WHERE user_id='manager-a'").run();throw new Error('lost synthetic response');}return result;};await assert.rejects(responsibility(f,manager,save({area:'campaigns',itemId:null,campaignId:'campaign-a'})),{status:403});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM work_responsibility_scopes').get().n,3);
});

test('the final write and replay projection require management in their own SQL after asynchronous work',async t=>{
 for(const replay of [false,true]){const f=fixture(t),manager=await f.actor('manager-a'),input=save();if(replay)await responsibility(f,manager,input);const prepare=f.db.prepare.bind(f.db);let changed=false;f.db.prepare=sql=>{if(!changed&&sql.includes('assignees_json')&&sql.includes('WHERE s.id=?')){changed=true;f.native.prepare("UPDATE members SET role='viewer' WHERE user_id='manager-a'").run();}return prepare(sql);};await assert.rejects(responsibility(f,manager,input),{status:403});assert.equal(changed,true);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM work_responsibility_scopes').get().n,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM work_responsibility_history').get().n,1);}
});

test('portable Sheets scope projection is global-owner read-only while complete backups preserve all assignees and history',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a'),platform=await f.actor('platform');await responsibility(f,manager,save());
 await assert.rejects(exportPortablePage(f.db,manager,{table:'work_responsibility_scopes'}),{status:403});const page=await exportPortablePage(f.db,platform,{table:'work_responsibility_scopes'});assert.equal(page.readOnly,true);assert.equal(page.rows.length,1);assert.ok(page.schema.columns.every(c=>!c.editable));assert.equal(JSON.stringify(page.rows).includes('worker-a'),false);
 for(const name of ['work_responsibility_assignees','work_responsibility_history'])assert.equal(describePortableSchemas().tables.some(s=>s.table===name),false);
 f.native.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)');const migrations=readdirSync(root+'drizzle').filter(n=>n.endsWith('.sql')).sort().map(name=>({name,sql:readFileSync(root+'drizzle/'+name,'utf8')}));for(const row of migrations)f.native.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(row.name);
 const archive=createArchive({backend:'disk',snapshot:{version:1,data:gzipSync(f.native.serialize())},objects:[]},{migrations,ownerId:'platform'}),restored=validateArchive(archive.bytes,{migrations}),copy=new DatabaseSync(':memory:');try{copy.deserialize(gunzipSync(restored.snapshot));for(const table of ['work_responsibility_scopes','work_responsibility_assignees','work_responsibility_history'])assert.equal(copy.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,1);assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(),[]);}finally{copy.close();}
});

test('Brasília clock is server-derived and general task lists expose it additively without writes',async t=>{
 assert.deepEqual(serverWorkClock(Date.parse('2026-11-01T02:59:59.000Z')),{asOf:'2026-11-01T02:59:59.000Z',today:'2026-10-31'});assert.equal(serverWorkClock(Date.parse('2026-11-01T03:00:00.000Z')).today,'2026-11-01');
 const f=fixture(t),worker=await f.actor('worker-a');task(f);const list=await followupList(f.db,worker);assert.match(list.today,/^\d{4}-\d{2}-\d{2}$/);assert.ok(Number.isFinite(Date.parse(list.asOf)));assert.equal(f.native.prepare('SELECT COUNT(*) n FROM audit').get().n,0);
});

test('internal benchmark: personal SQL totals and both pages use one strong adapter read and zero commits',async t=>{
 const f=fixture(t),worker=await f.actor('worker-a');for(let i=0;i<120;i++)task(f,{id:'benchmark-'+i});
 const runtime=resolve(root,'.sites-runtime');mkdirSync(runtime,{recursive:true});const folder=mkdtempSync(join(runtime,'my-work-benchmark-')),file=join(folder,'seed.sqlite');f.native.prepare('VACUUM INTO ?').run(file);const data=gzipSync(readFileSync(file)),counts={version:0,load:0,commit:0};
 const {SnapshotD1}=await import(compile('platform-node/d1.ts')),store={async version(){counts.version++;return 1;},async load(){counts.load++;return{version:1,data};},async commit(){counts.commit++;throw new Error('GET cannot commit');}},db=new SnapshotD1(store,[],join(folder,'reader.sqlite'));
 t.after(()=>{db.close();assert.ok(resolve(folder).startsWith(runtime+sep));rmSync(folder,{recursive:true,force:true});});await db.prepare('SELECT 1').first();for(const key of Object.keys(counts))counts[key]=0;
 const start=performance.now(),result=await myWork(db,worker,{limit:50}),elapsed=performance.now()-start;assert.equal(result.tasks.items.length,50);assert.equal(result.tasks.total,120);assert.deepEqual(counts,{version:1,load:0,commit:0});t.diagnostic(JSON.stringify({benchmark:'my-work-strong-read',tasks:50,total:120,...counts,elapsedMs:Number(elapsed.toFixed(2)),limitation:'synthetic in-process store; no real network latency'}));
});

test('0017 upgrades existing tables without modifying any row and enforces immutable targets and project references',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(root+'drizzle').filter(n=>n.endsWith('.sql')&&!n.startsWith('0017')).sort())db.exec(readFileSync(root+'drizzle/'+name,'utf8'));
 db.prepare("INSERT INTO projects(id,name,created_at) VALUES('upgrade','Original project','2026-10-31')").run();db.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('original-item','upgrade','Preserved material','gift','un',13,'2026-10-31')").run();
 const before=new Map(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({name})=>[name,db.prepare(`SELECT * FROM "${name}"`).all().map(r=>JSON.stringify(r)).sort()]));db.exec(readFileSync(root+'drizzle/0017_work_responsibilities.sql','utf8'));
 for(const [name,rows] of before)assert.deepEqual(db.prepare(`SELECT * FROM "${name}"`).all().map(r=>JSON.stringify(r)).sort(),rows,name);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.throws(()=>db.prepare("INSERT INTO work_responsibility_scopes(id,organization_id,project_id,area,item_id,target_key,created_by,created_at,updated_at) VALUES('bad','org_proex','upgrade','loans','original-item','original-item','synthetic','2026-10-31','2026-10-31')").run());
 db.prepare("INSERT INTO work_responsibility_scopes(id,organization_id,project_id,area,created_by,created_at,updated_at) VALUES('good','org_proex','upgrade','projects','synthetic','2026-10-31','2026-10-31')").run();assert.throws(()=>db.prepare("UPDATE work_responsibility_scopes SET area='materials' WHERE id='good'").run(),/responsibility_scope_immutable/);
});

test('HTTP wrappers agree with real services, reject forged actors, preserve privacy headers and enforce mutation origin',async t=>{
 const f=fixture(t);globalThis.__workQa={db:f.db,user:f.users['manager-a']};t.after(()=>{delete globalThis.__workQa;});
 const route=file=>{let code=readFileSync(resolve(root,file),'utf8').replace(/import \{ database \} from [^;]+;/,"const database=()=>globalThis.__workQa.db;").replace(/import \{ getPortalUser \} from [^;]+;/,"const getPortalUser=async()=>globalThis.__workQa.user;");code=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from (['"])@\/([^'"]+)\1/g,(_m,_q,file)=>`from ${JSON.stringify(compile(file+'.ts'))}`);return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));};
 const r=await route('app/api/responsibilities/route.ts'),m=await route('app/api/my-work/route.ts'),origin='https://portal.example.invalid',input=save();
 const request=(path,body,headers={})=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'X-Proex-Action':'1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const denied=await r.POST(request('/api/responsibilities',input,{Origin:'https://other.example.invalid'}));assert.equal(denied.status,403);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM work_responsibility_scopes').get().n,0);
 const saved=await r.POST(request('/api/responsibilities',input));assert.equal(saved.status,200);assert.ok(isResponsibilityResult(await saved.json()));assert.equal(saved.headers.get('Cache-Control'),'private, no-store');assert.equal(saved.headers.get('X-Content-Type-Options'),'nosniff');
 const list=await r.GET(new Request(origin+'/api/responsibilities?projectId=project-a&limit=1'));assert.ok(isResponsibilityList(await list.json()));
 globalThis.__workQa.user=f.users['worker-a'];const work=await m.GET(new Request(origin+'/api/my-work?userId=worker-b&today=1900-01-01'));const dto=await work.json();assert.equal(work.status,200);assert.ok(isMyWorkResponse(dto));assert.equal(dto.viewerId,'worker-a');assert.notEqual(dto.today,'1900-01-01');assert.equal(dto.totals.responsibilities.total,1);
 f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='worker-a'").run();assert.equal((await m.GET(new Request(origin+'/api/my-work'))).status,401);
});


test('portal refresh dates use the server instant in Brasília, including midnight and invalid timestamps',()=>{
 assert.equal(workDayFromServerTimestamp('2026-11-01T02:59:59.999Z'),'2026-10-31');
 assert.equal(workDayFromServerTimestamp('2026-11-01T03:00:00.000Z'),'2026-11-01');
 for(const value of [undefined,null,0,'','invalid'])assert.equal(workDayFromServerTimestamp(value),'');
});
