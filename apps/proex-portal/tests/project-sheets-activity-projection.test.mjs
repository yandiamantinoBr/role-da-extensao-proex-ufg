import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
function compile(file){file=resolve(root,file);if(cache.has(file))return cache.get(file);let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;code=code.replace(/from (['"])(\.[^'"]+)\1/g,(_m,_q,name)=>`from ${JSON.stringify(compile(resolve(dirname(file),name+'.ts')))}`);const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,url);return url;}
const {getActor}=await import(compile('lib/access.ts'));
const {followupAction}=await import(compile('lib/follow-up/service.ts'));
const {configureProjectSheet,createProjectSheetToken,projectSheetPrincipal}=await import(compile('lib/sync/project-sheets.ts'));
const {exportProjectSheetPage,callProjectSheetTool}=await import(compile('lib/sync/project-sheets-data.ts'));
const {describePortableSchemas,exportPortablePage}=await import(compile('lib/sync/portable.ts'));
function fixture(t){const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(root+'drizzle').filter(n=>n.endsWith('.sql')).sort())native.exec(readFileSync(root+'drizzle/'+name,'utf8'));t.after(()=>native.close());const now=new Date().toISOString();
 const insert=(table,row)=>{const cols=Object.keys(row);native.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));};
 for(const suffix of ['a','b']){insert('organizations',{id:`org-${suffix}`,name:`Organization ${suffix}`,slug:`org-${suffix}`,created_at:now,updated_at:now});insert('projects',{id:`project-${suffix}`,organization_id:`org-${suffix}`,name:`Project ${suffix}`,created_at:now});insert('items',{id:`item-${suffix}`,project_id:`project-${suffix}`,name:suffix==='a'?'Coletes P/M/G':'Private organization B item',category:'distribution',unit:'un',stock:40,created_at:now});insert('campaigns',{id:`campaign-${suffix}`,project_id:`project-${suffix}`,name:`Event ${suffix}`,starts_at:now,ends_at:new Date(Date.now()+86400000).toISOString(),status:'active',created_at:now});}
 const users={};function user(name,role,project,org){insert('portal_users',{user_id:name,email:name+'@example.invalid',status:'active',created_at:now,updated_at:now});insert('profiles',{user_id:name,display_name:name,created_at:now,updated_at:now});insert('members',{id:'member-'+name,user_id:name,email:name+'@example.invalid',role,project_id:project,organization_id:org,created_at:now});return users[name]={userId:name,email:name+'@example.invalid',displayName:name};}
 user('platform','owner',null,null);user('admin-a','owner',null,'org-a');user('admin-b','owner',null,'org-b');user('manager-a','manager','project-a','org-a');user('viewer-a','viewer','project-a','org-a');user('worker-a','inventory','project-a','org-a');user('worker-b','inventory','project-b','org-b');
 const db={native,reads:0,before:null,fail:null,prepare(sql){let values=[];return{sql,bind(...args){values=args;return this;},async first(){db.reads++;return native.prepare(sql).get(...values)??null;},async all(){db.reads++;return{results:native.prepare(sql).all(...values)};},async run(){return this.execute();},execute(){if(db.fail?.test(sql)){db.fail=null;throw new Error('synthetic storage failure');}const results=native.prepare(sql).all(...values);return{results,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(this.before){const hook=this.before;this.before=null;hook();}native.exec('BEGIN');try{const results=statements.map(s=>s.execute());native.exec('COMMIT');return results;}catch(error){native.exec('ROLLBACK');throw error;}}};
 return{db,native,users,insert,now,actor:name=>getActor(db,users[name])};
}

test('activity checklist details remain private with Sheets opt-in off and with summary opt-in on',async t=>{
 const f=fixture(t),manager=await f.actor('manager-a');
 const detail=await followupAction(f.db,manager,'checklist.activity.create',{action:'checklist.activity.create',projectId:'project-a',organizationId:'org-a',title:'Resumo público na planilha da equipe',body:'PRIVATE_ACTIVITY_BODY_SENTINEL',rows:[{label:'PRIVATE_STEP_LABEL_SENTINEL'}],userIds:[],teamIds:[],operationKey:crypto.randomUUID()});
 await followupAction(f.db,manager,'checklist.activity.answer',{action:'checklist.activity.answer',id:detail.checklist.id,rowId:detail.checklist.rows[0].id,expectedVersion:1,answer:'no',note:'PRIVATE_STEP_NOTE_SENTINEL',operationKey:crypto.randomUUID()});
 const masterSchema=describePortableSchemas().tables.find(table=>table.table==='followup_checklists');
 assert.match(masterSchema.label,/materiais e atividades/);
 const masterPage=await exportPortablePage(f.db,await f.actor('platform'),{table:'followup_checklists'});
 assert.equal(masterPage.rows.find(row=>row.id===detail.checklist.id).kind,'activity');
 assert.ok(!JSON.stringify(masterPage).includes('PRIVATE_STEP_NOTE_SENTINEL'));
 const spreadsheetId='synthetic_activity_projection_workbook';
 const connect=async(includeTasks,expectedVersion)=>{
  const configuration={spreadsheetId,label:'Planilha da atividade',expectedVersion,...(includeTasks===undefined?{}:{includeTasks})};
  await configureProjectSheet(f.db,manager,'project-a',configuration);
  const key=await createProjectSheetToken(f.db,manager,'project-a',{scope:'read',label:'Conector de QA',expectedVersion:expectedVersion+1});
  return projectSheetPrincipal(f.db,'Bearer '+key.token,spreadsheetId);
 };
 const off=await connect(undefined,0);assert.equal(off.includeTasks,false);
 const offDescription=await callProjectSheetTool(f.db,off,'proex_sync_describe',{});assert.equal(offDescription.schemas.tables.length,8);assert.ok(!offDescription.schemas.tables.some(schema=>schema.table==='followup_tasks'));
 await assert.rejects(exportProjectSheetPage(f.db,off,{table:'followup_tasks'}),error=>error.code==='sync_invalid_table');
 for(const table of ['followup_checklist_steps','followup_checklists','followup_history'])await assert.rejects(exportProjectSheetPage(f.db,off,{table}),error=>error.code==='sync_invalid_table');
 const checkPrivate=serialized=>{for(const sentinel of ['PRIVATE_ACTIVITY_BODY_SENTINEL','PRIVATE_STEP_LABEL_SENTINEL','PRIVATE_STEP_NOTE_SENTINEL','activityChecklistChange','followup_checklist_steps'])assert.ok(!serialized.includes(sentinel),sentinel+' must not be projected');};
 for(const schema of offDescription.schemas.tables)checkPrivate(JSON.stringify(await exportProjectSheetPage(f.db,off,{table:schema.table})));
 const on=await connect(true,1);assert.equal(on.includeTasks,true);const onDescription=await callProjectSheetTool(f.db,on,'proex_sync_describe',{});assert.equal(onDescription.schemas.tables.length,9);
 const tasks=await exportProjectSheetPage(f.db,on,{table:'followup_tasks'});assert.equal(tasks.rows.find(row=>row.id===detail.task.id).title,'Resumo público na planilha da equipe');
 assert.ok(!Object.hasOwn(tasks.rows.find(row=>row.id===detail.task.id),'body'));
 for(const schema of onDescription.schemas.tables)checkPrivate(JSON.stringify(await exportProjectSheetPage(f.db,on,{table:schema.table})));
 for(const table of ['followup_checklist_steps','followup_checklists','followup_history'])await assert.rejects(exportProjectSheetPage(f.db,on,{table}),error=>error.code==='sync_invalid_table');
});
