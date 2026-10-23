import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const temporary=mkdtempSync(join(tmpdir(),'proex-team-'));writeFileSync(join(temporary,'package.json'),'{"type":"module"}');
function compile(source,target){let code=ts.transpileModule(readFileSync(new URL(source,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;code=code.replace(/from '(?:\.\.\/)+(?:lib\/)?([^']+)'/g,(_match,name)=>`from './${name}.js'`).replace(/from '\.\/([^']+)'/g,(_match,name)=>`from './${name.endsWith('.js')?name:`${name}.js`}'`);writeFileSync(join(temporary,`${target}.js`),code);}
for(const name of ['access','users','errors','database','mutations'])compile(`../lib/${name}.ts`,name);
compile('../app/api/team/[id]/route.ts','team-route');compile('../app/api/team/[id]/avatar/route.ts','avatar-route');
writeFileSync(join(temporary,'session.js'),'export async function getPortalUser(){return globalThis.__proexTeam.user;}');
writeFileSync(join(temporary,'platform.js'),'export function database(){return globalThis.__proexTeam.db;}export function bucket(){return globalThis.__proexTeam.storage;}');
after(()=>{rmSync(temporary,{recursive:true,force:true});delete globalThis.__proexTeam;});
const {GET:teamGet}=await import(pathToFileURL(join(temporary,'team-route.js')).href),{GET:avatarGet}=await import(pathToFileURL(join(temporary,'avatar-route.js')).href);
function fixture(t){
 const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())native.exec(readFileSync(new URL(`../drizzle/${name}`,import.meta.url),'utf8'));t.after(()=>native.close());
 const now=new Date().toISOString();for(const id of ['a','b'])native.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run(id,id,now);
 function principal(id,role,projectId){native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,\'active\',?,?)').run(id,`${id}@example.test`,now,now);native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(`member-${id}`,id,`${id}@example.test`,role,projectId,now);native.prepare('INSERT INTO profiles(user_id,display_name,avatar_key,mime,version,phone,registration_type,registration_number,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?,?,?)').run(id,`Pessoa ${id}`,`private/avatar-${id}`,'image/png','PRIVATE PHONE','student',`PRIVATE ENROLLMENT ${id}`,now,now);return {userId:id,email:`${id}@example.test`,displayName:`Pessoa ${id}`};}
 const manager=principal('manager','manager','a'),target=principal('target','viewer','a'),other=principal('other','viewer','b'),viewer=principal('viewer','viewer','a');
 function prepare(sql,values=[]){return {bind(...args){return prepare(sql,args);},async first(){return native.prepare(sql).get(...values)??null;},async all(){return {results:native.prepare(sql).all(...values)};}};}
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);const storage={onGet:null,async get(){await this.onGet?.();return {size:bytes.length,body:bytes};}};
 const state={db:{prepare},storage,user:manager};globalThis.__proexTeam=state;
 return {native,manager,target,other,viewer,state,storage,bytes};
}
const request=(id,project='a')=>new Request(`https://portal.example.test/api/team/${id}?projectId=${project}`),context=id=>({params:Promise.resolve({id})});

test('private team HTTP detail is scoped and never returns credentials, CPF or storage keys',async t=>{
 const f=fixture(t),response=await teamGet(request('target'),context('target'));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
 const body=await response.json();assert.equal(body.person.registrationNumber,'PRIVATE ENROLLMENT target');assert.equal(body.person.phone,'PRIVATE PHONE');assert.ok(!JSON.stringify(body).includes('private/avatar-'));for(const key of ['cpf','lookupHash','password','subjects'])assert.ok(!Object.hasOwn(body.person,key));
 assert.equal((await teamGet(request('other'),context('other'))).status,404);
 f.state.user=f.viewer;assert.equal((await teamGet(request('target'),context('target'))).status,403);
 f.state.user=null;assert.equal((await teamGet(request('target'),context('target'))).status,401);
});

test('team avatar uses private PNG headers and rechecks manager revocation after R2',async t=>{
 const f=fixture(t),response=await avatarGet(request('target'),context('target'));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.match(response.headers.get('Content-Security-Policy'),/sandbox/);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes);
 f.storage.onGet=async()=>f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(),f.manager.userId);
 const revoked=await avatarGet(request('target'),context('target'));assert.equal(revoked.status,403);assert.equal(revoked.headers.get('Cache-Control'),'private, no-store');assert.ok(!(await revoked.text()).includes('private/avatar-'));
});

test('team avatar cannot disclose an object fetched before target anonymization or avatar replacement',async t=>{
 const f=fixture(t);f.storage.onGet=async()=>f.native.prepare('UPDATE portal_users SET anonymized_at=? WHERE user_id=?').run(new Date().toISOString(),f.target.userId);
 assert.equal((await avatarGet(request('target'),context('target'))).status,404);
 f.native.prepare('UPDATE portal_users SET anonymized_at=NULL WHERE user_id=?').run(f.target.userId);
 f.storage.onGet=async()=>f.native.prepare("UPDATE profiles SET avatar_key='private/new-avatar',version=version+1 WHERE user_id=?").run(f.target.userId);
 assert.equal((await avatarGet(request('target'),context('target'))).status,409);
});
