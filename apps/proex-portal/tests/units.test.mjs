import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const overrides = new Map([
  [resolve(root, 'lib/session.ts'), dataModule('export async function getPortalUser(){return globalThis.__unitsUser??null;}')],
  [resolve(root, 'lib/platform.ts'), dataModule('export function database(){return globalThis.__unitsDb;} export function bucket(){return globalThis.__unitsBucket;}')],
]);
const modules = new Map();
function compile(file) {
  file = resolve(root, file);
  if (overrides.has(file)) return overrides.get(file);
  if (modules.has(file)) return modules.get(file);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(resolve(dirname(file), dependency.endsWith('.ts') ? dependency : `${dependency}.ts`)))}`);
  const url = dataModule(`${code}\n//# sourceURL=${file.replace(root, '')}-under-test.mjs`);
  modules.set(file, url);
  return url;
}
const {unitsAction,listOrganizationalUnits}=await import(compile('lib/units.ts'));
const route=await import(compile('app/api/units/route.ts'));
function fixture() {
  const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(`${root}drizzle`).filter(name=>name.endsWith('.sql')).sort())native.exec(readFileSync(`${root}drizzle/${name}`,'utf8'));
  let beforeBatch,loseReply=false;
  const db={native,prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(column){const row=native.prepare(sql).get(...args);return column?row?.[column]??null:row??null;},async all(){return {success:true,results:native.prepare(sql).all(...args)};},async run(){const result=native.prepare(sql).run(...args);return {success:true,results:[],meta:{changes:Number(result.changes)}};},execute(){const result=native.prepare(sql).all(...args);return {success:true,results:result,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(beforeBatch){const hook=beforeBatch;beforeBatch=undefined;hook();}native.exec('BEGIN');let rows;try{rows=statements.map(statement=>statement.execute());native.exec('COMMIT');}catch(error){native.exec('ROLLBACK');throw error;}if(loseReply){loseReply=false;throw new Error('lost D1 reply after commit');}return rows;},beforeBatch(hook){beforeBatch=hook;},loseReply(){loseReply=true;}};
  const now=new Date().toISOString();
  native.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run('project-a','Project',now);
  function principal(id,role=null,project=null,pending=0){
    native.prepare('INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,`${id}@example.invalid`,'active',pending,now,now);
    const member=role?{id:`membership-${id}`,user_id:id,email:`${id}@example.invalid`,role,project_id:project,revoked_at:null,created_at:now}:null;
    if(member)native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(member));
    return {userId:id,email:`${id}@example.invalid`,displayName:id,members:member?[member]:[],capabilities:['organization.manage']};
  }
  const owner=principal('owner','owner'),manager=principal('manager','manager','project-a'),newUser=principal('new-user',null,null,1);
  return {db,owner,manager,newUser,principal,now,close(){native.close();}};
}
function create(f,overrides={}){return unitsAction(f.db,f.owner,'unit.create',{name:'Faculdade de Informação e Comunicação',acronym:'FIC',kind:'academic',operationKey:crypto.randomUUID(),...overrides});}
const count=(f,table)=>f.db.native.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;

test('unit creation is owner-only, normalized, idempotent under concurrent retries and recovers lost D1 replies',async()=>{
 const f=fixture();try{
  const input={name:'  Faculdade   de Informação e Comunicação ',acronym:' FIC ',kind:'academic',operationKey:'create-unit-mobile-0001'};
  const results=await Promise.all([unitsAction(f.db,f.owner,'unit.create',input),unitsAction(f.db,f.owner,'unit.create',input)]);
  assert.equal(results[0].unit.id,results[1].unit.id);assert.equal(results[0].unit.name,'Faculdade de Informação e Comunicação');assert.equal(count(f,'organizational_units'),1);assert.equal(count(f,'audit'),1);
  await assert.rejects(unitsAction(f.db,f.owner,'unit.create',{...input,name:'Other name'}),error=>error.code==='operation_changed');
  await assert.rejects(unitsAction(f.db,f.manager,'unit.create',input),error=>error.status===403);
  await assert.rejects(unitsAction(f.db,f.newUser,'unit.create',input),error=>error.status===403);
  await assert.rejects(unitsAction(f.db,null,'unit.create',input),error=>error.status===401);
  f.db.loseReply();const recovered=await create(f,{name:'Pró-Reitoria de Extensão',acronym:'PROEX',kind:'proex',operationKey:'lost-reply-unit-0001'});assert.ok(recovered.unit.id);assert.equal(count(f,'organizational_units'),2);assert.equal(count(f,'audit'),2);
 }finally{f.close();}
});

test('unit metadata enforces CAS and idempotent updates without broadening any project grant',async()=>{
 const f=fixture();try{
  const unit=(await create(f)).unit;
  const input={id:unit.id,expectedVersion:1,name:'Faculdade revisada',operationKey:'rename-unit-mobile-0001'};
  const revised=await unitsAction(f.db,f.owner,'unit.update',input);assert.equal(revised.unit.version,2);
  assert.equal((await unitsAction(f.db,f.owner,'unit.update',input)).duplicate,true);
  await unitsAction(f.db,f.owner,'unit.update',{id:unit.id,expectedVersion:2,acronym:'FIC-UFG'});
  assert.equal((await unitsAction(f.db,f.owner,'unit.update',input)).unit.version,3,'a retry remains safe even after a later independent revision');
  await assert.rejects(unitsAction(f.db,f.owner,'unit.update',{id:unit.id,expectedVersion:1,name:'Stale change'}),error=>error.code==='unit_changed');
  const race=await Promise.allSettled([unitsAction(f.db,f.owner,'unit.update',{id:unit.id,expectedVersion:3,name:'Winner one'}),unitsAction(f.db,f.owner,'unit.update',{id:unit.id,expectedVersion:3,name:'Winner two'})]);
  assert.equal(race.filter(row=>row.status==='fulfilled').length,1);assert.equal(race.find(row=>row.status==='rejected').reason.code,'unit_changed');assert.equal(f.db.native.prepare('SELECT version FROM organizational_units WHERE id=?').get(unit.id).version,4);
  assert.equal(count(f,'members'),2);assert.equal(f.db.native.prepare("SELECT project_id FROM members WHERE user_id='manager'").get().project_id,'project-a');
 }finally{f.close();}
});

test('revocation, blocking, pending activation and anonymization defeat stale owners, including a race immediately before the batch',async()=>{
 const f=fixture();try{
  const unit=(await create(f)).unit;
  f.db.beforeBatch(()=>f.db.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner'").run(f.now));
  await assert.rejects(unitsAction(f.db,f.owner,'unit.update',{id:unit.id,expectedVersion:1,name:'Denied race',operationKey:'denied-unit-race-0001'}),error=>error.status===403);
  assert.equal(f.db.native.prepare('SELECT version FROM organizational_units WHERE id=?').get(unit.id).version,1);assert.equal(count(f,'audit'),1);assert.equal(count(f,'mutation_keys'),1);
  f.db.native.prepare("UPDATE members SET revoked_at=NULL WHERE user_id='owner'").run();
  for(const [column,value,reset]of[['status','blocked','active'],['activation_pending',1,0],['anonymized_at',f.now,null]]){
   f.db.native.prepare(`UPDATE portal_users SET ${column}=? WHERE user_id='owner'`).run(value);
   await assert.rejects(create(f,{operationKey:crypto.randomUUID()}),error=>error.status===403);
   f.db.native.prepare(`UPDATE portal_users SET ${column}=? WHERE user_id='owner'`).run(reset);
  }
  assert.equal(count(f,'organizational_units'),1);
 }finally{f.close();}
});

test('safe unit directory works for admitted people without memberships and retains only their own archived unit',async()=>{
 const f=fixture();try{
  const one=(await create(f)).unit,two=(await create(f,{name:'Órgão externo',acronym:'EXT',kind:'external'})).unit;
  for(const unit of [one,two])await unitsAction(f.db,f.owner,'unit.update',{id:unit.id,expectedVersion:1,status:'archived'});
  const active=(await create(f,{name:'PROEX',acronym:'PROEX',kind:'proex'})).unit;
  f.db.native.prepare('INSERT INTO profiles(user_id,display_name,unit_id,phone,registration_type,registration_number,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(f.newUser.userId,'Private name',one.id,'private telephone','student','private registration',f.now,f.now);
  const listed=await listOrganizationalUnits(f.db,f.newUser);assert.deepEqual(new Set(listed.map(row=>row.id)),new Set([one.id,active.id]));assert.doesNotMatch(JSON.stringify(listed),/Private name|private telephone|private registration/);
  await assert.rejects(listOrganizationalUnits(f.db,f.manager,{includeArchived:true}),error=>error.status===403);
  assert.equal((await listOrganizationalUnits(f.db,f.owner,{includeArchived:true})).length,3);
  f.db.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(f.newUser.userId);
  await assert.rejects(listOrganizationalUnits(f.db,f.newUser),error=>error.code==='account_inactive');
 }finally{f.close();}
});

test('unit inputs are bounded and a failed audit rolls back the unit and its idempotency receipt',async()=>{
 const f=fixture();try{
  for(const overrides of [{name:'x'.repeat(201)},{name:'Invalid\nname'},{kind:'inherited-admin'},{status:'deleted'},{projectId:'project-a'}])await assert.rejects(create(f,overrides),error=>error.status===400);
  assert.equal(count(f,'organizational_units'),0);
  f.db.native.exec("CREATE TRIGGER test_unit_audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'audit_failed'); END");
  await assert.rejects(create(f));assert.equal(count(f,'organizational_units'),0);assert.equal(count(f,'mutation_keys'),0);
  assert.equal(await unitsAction({},null,'other.action',{}),null);
 }finally{f.close();}
});

test('GET unit route exposes the safe organizationalUnits contract with private cache headers',async()=>{
 const f=fixture();try{
  await create(f);globalThis.__unitsDb=f.db;globalThis.__unitsUser={userId:f.newUser.userId,email:f.newUser.email,displayName:f.newUser.displayName};
  const response=await route.GET(new Request('https://portal.example.invalid/api/units'));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal((await response.json()).organizationalUnits.length,1);
  assert.equal((await route.GET(new Request('https://portal.example.invalid/api/units?includeArchived=1'))).status,403);
  assert.equal((await route.GET(new Request('https://portal.example.invalid/api/units?includeArchived=true'))).status,400);
  globalThis.__unitsUser=null;assert.equal((await route.GET(new Request('https://portal.example.invalid/api/units'))).status,401);
 }finally{f.close();delete globalThis.__unitsDb;delete globalThis.__unitsUser;}
});
