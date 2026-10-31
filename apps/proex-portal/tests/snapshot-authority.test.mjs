import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';

// Actual SnapshotD1, migrations, Better Auth/Drizzle, canonical session resolver,
// scoped reports and attachment route. The shared store is a synthetic CAS store;
// only Next/platform/native transport bindings are isolated. No clock or sleep.
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=mkdtempSync(join(tmpdir(),'proex-snapshot-authority-')),compiled=new Map(),opened=[];
writeFileSync(join(temporary,'package.json'),'{"type":"module"}');symlinkSync(new URL('../node_modules/',import.meta.url),join(temporary,'node_modules'),process.platform==='win32'?'junction':'dir');
function write(name,code){const path=join(temporary,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,code);return pathToFileURL(path).href;}
const replacements=new Map([
 [resolve(root,'lib/platform.ts'),write('fixtures/platform.mjs','export function database(){return globalThis.__snapshotAuthority.db;} export function ownerEmail(){return undefined;} export function bucket(){return globalThis.__snapshotAuthority.storage;}')],
 [resolve(root,'app/chatgpt-auth.ts'),write('fixtures/native.mjs','export async function getChatGPTUser(){return null;}')],
 ['next/headers',write('fixtures/headers.mjs','export async function headers(){return globalThis.__snapshotAuthority.headers;}')],
]);
function compile(source){source=resolve(root,source);if(replacements.has(source))return replacements.get(source);if(compiled.has(source))return compiled.get(source);const target=resolve(temporary,relative(root,source).replace(/\.ts$/,'.mjs'));mkdirSync(dirname(target),{recursive:true});const uri=pathToFileURL(target).href;compiled.set(source,uri);let code=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,_quote,dependency)=>{if(replacements.has(dependency))return`from ${JSON.stringify(replacements.get(dependency))}`;if(!dependency.startsWith('.')&&!dependency.startsWith('@/'))return match;const path=dependency.startsWith('@/')?resolve(root,dependency.slice(2)):resolve(dirname(source),dependency),file=path.endsWith('.ts')?path:`${path}.ts`;if(source===resolve(root,'lib/session.ts')&&file===resolve(root,'lib/password-auth.ts'))return`from ${JSON.stringify(pathToFileURL(join(temporary,'fixtures/configured-auth.mjs')).href)}`;return`from ${JSON.stringify(compile(file))}`;});writeFileSync(target,code);return uri;}
const authModule=compile('lib/password-auth.ts');write('fixtures/configured-auth.mjs',`import{passwordAuth as actual}from ${JSON.stringify(authModule)};export function passwordAuth(db,options={}){return actual(db,{...options,runtimeEnv:globalThis.__snapshotAuthority.runtimeEnv});}`);
const {SnapshotD1}=await import(compile('platform-node/d1.ts')),{passwordAuth}=await import(authModule),{getActor}=await import(compile('lib/access.ts')),{getPortalUser}=await import(compile('lib/session.ts')),{reportRows}=await import(compile('lib/reports.ts'));
const {GET:download}=await import(compile('app/api/files/[id]/route.ts'));
after(()=>{for(const db of opened)db.close();delete globalThis.__snapshotAuthority;rmSync(temporary,{recursive:true,force:true});});
const migrations=readdirSync(resolve(root,'drizzle')).filter(file=>file.endsWith('.sql')).sort().map(name=>({name,sql:readFileSync(resolve(root,'drizzle',name),'utf8')}));
let fixtureNumber=0;
function sharedStore(){let snapshot=null;const counts={A:{version:0,load:0,commit:0,loadedBytes:0},B:{version:0,load:0,commit:0,loadedBytes:0}};let unavailable=false;return{counts,setUnavailable(value){unavailable=value;},store(label){return{async version(){counts[label].version++;if(unavailable&&label==='A')throw new Error('synthetic authoritative version unavailable');return snapshot?.version??0;},async load(){counts[label].load++;if(!snapshot)return null;counts[label].loadedBytes+=snapshot.data.byteLength;return{version:snapshot.version,data:snapshot.data.slice()};},async commit(expected,data){counts[label].commit++;if((snapshot?.version??0)!==expected)return null;snapshot={version:expected+1,data:data.slice()};return snapshot.version;}};},reset(){for(const label of ['A','B'])counts[label]={version:0,load:0,commit:0,loadedBytes:0};}};}
async function fixture(t){
 const remote=sharedStore(),folder=join(temporary,`fixture-${fixtureNumber++}`);mkdirSync(folder,{recursive:true});
 // The old TTL cannot accidentally expire between warming and revocation. The
 // compatibility argument must never re-enable stale authorization after the fix.
 const A=new SnapshotD1(remote.store('A'),migrations,join(folder,'a.sqlite'),10**12),B=new SnapshotD1(remote.store('B'),migrations,join(folder,'b.sqlite'),10**12);opened.push(A,B);t.after(()=>{A.close();B.close();});
 const now=new Date().toISOString(),user={userId:'canonical-reader',email:'reader@example.invalid',displayName:'Synthetic reader'},runtimeEnv={BETTER_AUTH_URL:'https://snapshot.example.invalid',BETTER_AUTH_SECRET:'synthetic-snapshot-session-secret-2026-only'};
 let beforeObject=null,served=0;const bytes=new TextEncoder().encode('%PDF-1.7\nSYNTHETIC PRIVATE ATTACHMENT\n%%EOF');
 globalThis.__snapshotAuthority={db:A,runtimeEnv,headers:new Headers(),storage:{async get(){if(beforeObject){const action=beforeObject;beforeObject=null;await action();}return{size:bytes.byteLength,get body(){served++;return bytes;}};}}};
 await A.batch([
  A.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").bind(user.userId,user.email,now,now),
  A.prepare("INSERT INTO projects(id,name,description,created_at) VALUES('project-a','SYNTHETIC PRIVATE PROJECT','Private description',?)").bind(now),
  A.prepare("INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES('reader-grant',?,?,'manager','project-a',?)").bind(user.userId,user.email,now),
  A.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('asset-a','project-a','Synthetic asset','equipment','un',1,?)").bind(now),
  A.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,starts_at,ends_at,created_by,created_at) VALUES('loan-a','project-a','asset-a','Synthetic loan','Synthetic borrower',?,?,?,?)").bind(Date.now()+3600000,Date.now()+7200000,user.userId,now),
  A.prepare("INSERT INTO documents(id,loan_id,project_id,object_key,name,mime,size,created_by,created_at) VALUES('document-a','loan-a','project-a','synthetic-private-object','synthetic.pdf','application/pdf',?,?,?)").bind(bytes.byteLength,user.userId,now),
 ]);
 const auth=await passwordAuth(A,{runtimeEnv}),created=await auth.api.createUser({body:{email:user.email,name:user.displayName,password:'Synthetic snapshot password 2026!',role:'user'}});
 await A.prepare("INSERT INTO identity_aliases(provider,subject,user_id,created_at) VALUES('password',?,?,?)").bind(created.user.id,user.userId,now).run();
 const response=await auth.api.signInEmail({body:{email:user.email,password:'Synthetic snapshot password 2026!'},asResponse:true});assert.equal(response.status,200);const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');globalThis.__snapshotAuthority.headers=new Headers({Cookie:cookie});
 await B.prepare('SELECT 1').all();await getPortalUser();const actor=await getActor(A,user);assert.equal(actor.members.length,1);assert.equal((await reportRows(A,actor,{dataset:'projects'})).rows.length,1);remote.reset();
 return{A,B,remote,user,actor,credentialId:created.user.id,now,beforeObject(action){beforeObject=action;},served:()=>served};
}

test('a warmed instance sees membership revocation committed by another instance before its next protected read',async t=>{
 const f=await fixture(t);await f.B.prepare("UPDATE members SET revoked_at=? WHERE id='reader-grant'").bind(f.now).run();
 const actor=await getActor(f.A,f.user);assert.equal(actor.members.length,0);assert.deepEqual((await reportRows(f.A,f.actor,{dataset:'projects'})).rows,[]);
 assert.ok(f.remote.counts.A.version>0);assert.equal(f.remote.counts.A.load,1);assert.equal(f.remote.counts.A.commit,0);
});

test('scoped report SQL denies the revoked project even when the caller retains its old actor object',async t=>{
 const f=await fixture(t);await f.B.prepare("UPDATE members SET revoked_at=? WHERE id='reader-grant'").bind(f.now).run();
 assert.deepEqual((await reportRows(f.A,f.actor,{dataset:'projects'})).rows,[]);const{loadedBytes,...calls}=f.remote.counts.A;assert.deepEqual(calls,{version:1,load:1,commit:0});assert.ok(loadedBytes>0);
});

test('a warmed canonical Better Auth session is rejected immediately after another instance blocks the account',async t=>{
 const f=await fixture(t);await f.B.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").bind(f.user.userId).run();
 await assert.rejects(getPortalUser(),error=>error.status===403);assert.equal(f.remote.counts.A.load,1);assert.equal(f.remote.counts.A.commit,0);
});

test('a warmed canonical session disappears after another instance revokes its SDK session',async t=>{
 const f=await fixture(t);await f.B.prepare('DELETE FROM auth_session WHERE user_id=?').bind(f.credentialId).run();
 assert.equal(await getPortalUser(),null);assert.equal(f.remote.counts.A.load,1);assert.equal(f.remote.counts.A.commit,0);
});

test('an attachment fence after awaiting object storage rejects a revocation from the other instance',async t=>{
 const f=await fixture(t);f.beforeObject(()=>f.B.prepare("UPDATE members SET revoked_at=? WHERE id='reader-grant'").bind(f.now).run());
 const response=await download(new Request('https://snapshot.example.invalid/api/files/document-a'),{params:Promise.resolve({id:'document-a'})});
 assert.equal(response.status,403);assert.equal(f.served(),0,'the private body is never returned after a failed authority fence');assert.equal(f.remote.counts.A.load,1);assert.equal(f.remote.counts.A.commit,0);
});

test('unchanged authoritative versions use metadata checks without payload downloads or commits',async t=>{
 const f=await fixture(t);for(let i=0;i<100;i++)assert.equal(await f.A.prepare("SELECT name FROM projects WHERE id='project-a'").first('name'),'SYNTHETIC PRIVATE PROJECT');
 assert.deepEqual(f.remote.counts.A,{version:100,load:0,commit:0,loadedBytes:0});
});

test('a metadata outage fails closed instead of serving a warmed authorization snapshot',async t=>{
 const f=await fixture(t);f.remote.setUnavailable(true);await assert.rejects(getActor(f.A,f.user),/synthetic authoritative version unavailable/);assert.equal(f.remote.counts.A.load,0);assert.equal(f.remote.counts.A.commit,0);
});
