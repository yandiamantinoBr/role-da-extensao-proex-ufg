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
  [resolve(root, 'lib/session.ts'), dataModule('export async function getPortalUser(){return globalThis.__recordsUser??null;}')],
  [resolve(root, 'lib/platform.ts'), dataModule('export function database(){return globalThis.__attachmentDb;} export function bucket(){return globalThis.__attachmentBucket;}')],
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
const service = await import(compile('lib/sync/attachments.ts'));
const download = await import(compile('app/api/sync/files/[token]/route.ts'));
const {listSyncAttachments,createAttachmentTicket,consumeAttachmentTicket,acknowledgeAttachmentExport,acknowledgeAttachmentCleanup}=service;
function fixture() {
  const native=new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(name=>name.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`,'utf8'));
  const now=new Date().toISOString();
  native.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run('project-a','Project',now);
  const member={id:'owner-membership',user_id:'owner-a',email:'owner@example.invalid',role:'owner',project_id:null,revoked_at:null,created_at:now};
  native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(member));
  for(const id of ['owner-a','source-a'])native.prepare('INSERT INTO portal_users(user_id,status,created_at,updated_at) VALUES(?,?,?,?)').run(id,'active',now,now);
  const actor={userId:'owner-a',email:member.email,displayName:'Owner',members:[member],capabilities:[]};
  let beforeBatch;
  const db={native,prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(column){const row=native.prepare(sql).get(...args);return column?row?.[column]??null:row??null;},async all(){return {success:true,results:native.prepare(sql).all(...args)};},async run(){const result=native.prepare(sql).run(...args);return {success:true,results:[],meta:{changes:Number(result.changes)}};},execute(){const result=native.prepare(sql).all(...args);return {success:true,results:result,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(beforeBatch){const hook=beforeBatch;beforeBatch=undefined;hook();}native.exec('BEGIN');try{const rows=statements.map(statement=>statement.execute());native.exec('COMMIT');return rows;}catch(error){native.exec('ROLLBACK');throw error;}},beforeBatch(hook){beforeBatch=hook;}};
  const objects=new Map();
  const storage={objects,reads:0,onRead:null,async get(key){this.reads++;const value=objects.get(key);await this.onRead?.();return value?{size:value.length,body:new Response(new Uint8Array(value)).body}:null;}};
  const bytes=new TextEncoder().encode('%PDF-1.7\nprivate original\n%%EOF');
  native.prepare("INSERT INTO records(id,project_id,kind,title,body,occurred_at,created_by,created_at) VALUES('record-a','project-a','material','Private title','','2026-10-23T00:00:00Z','source-a',?)").run(now);
  native.prepare("INSERT INTO record_attachments(id,record_id,project_id,object_key,name,mime,size,operation_key,created_by,created_at) VALUES('attachment-a','record-a','project-a','private-r2-key','private-photo-name.pdf','application/pdf',?,'upload-a','source-a',?)").run(bytes.length,now);
  storage.objects.set('private-r2-key',bytes);
  native.prepare("INSERT INTO profiles(user_id,display_name,avatar_key,mime,created_at,updated_at) VALUES('source-a','Private name','avatar-r2-key','image/png',?,?)").run(now,now);
  storage.objects.set('avatar-r2-key',new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]));
  return {db,storage,actor,bytes,now,close(){native.close();}};
}
const ticketInput={kind:'record',id:'attachment-a',origin:'https://portal.example.invalid'};
function token(ticket){return new URL(ticket.url).pathname.split('/').at(-1);}
async function copied(f,kind='record',id='attachment-a'){
 const ticket=await createAttachmentTicket(f.db,f.actor,{...ticketInput,kind,id});
 const copy=await consumeAttachmentTicket(f.db,f.storage,token(ticket));
 return {kind,id,driveFileId:'drive-file-0001',driveUrl:'https://drive.google.com/file/d/drive-file-0001/view',contentHash:copy.contentHash,size:copy.size,privateConfirmed:true,readbackVerified:true};
}

test('attachment inventory is owner-only, paginated and excludes names, contacts, R2 keys and deleted sources',async()=>{
 const f=fixture();try{
  const first=await listSyncAttachments(f.db,f.actor,{limit:1});assert.equal(first.attachments[0].kind,'avatar');assert.equal(first.attachments[0].size,null);
  const second=await listSyncAttachments(f.db,f.actor,{limit:1,after:first.nextCursor});assert.equal(second.attachments[0].id,'attachment-a');assert.equal(second.nextCursor,null);
  assert.doesNotMatch(JSON.stringify([first,second]),/private-r2|Private name|private-photo-name|owner@example/);
  await assert.rejects(listSyncAttachments(f.db,{...f.actor,userId:'forged-owner'}),error=>error.status===403);
  f.db.native.prepare("UPDATE record_attachments SET deleted_at=? WHERE id='attachment-a'").run(f.now);
  assert.equal((await listSyncAttachments(f.db,f.actor)).attachments.length,1);
  f.db.native.prepare("UPDATE portal_users SET anonymized_at=? WHERE user_id='source-a'").run(f.now);
  assert.equal((await listSyncAttachments(f.db,f.actor)).attachments.length,0);
 }finally{f.close();}
});

test('tickets store only SHA256, expire after a minute and permit exactly one concurrent bounded download',async()=>{
 const f=fixture();try{
  const ticket=await createAttachmentTicket(f.db,f.actor,ticketInput), raw=token(ticket);
  assert.match(raw,/^[a-f0-9]{64}$/);assert.ok(Date.parse(ticket.expiresAt)-Date.now()<=60000);
  const stored=f.db.native.prepare('SELECT * FROM sync_attachment_tickets').get();assert.notEqual(stored.token_hash,raw);assert.doesNotMatch(JSON.stringify(stored),new RegExp(raw));
  const results=await Promise.allSettled([consumeAttachmentTicket(f.db,f.storage,raw),consumeAttachmentTicket(f.db,f.storage,raw)]);
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.storage.reads,1);
  const result=results.find(row=>row.status==='fulfilled').value;assert.deepEqual(result.bytes,f.bytes);assert.match(result.contentHash,/^[a-f0-9]{64}$/);
  assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='sync.attachment.download'").get().n,1);
  const expired=await createAttachmentTicket(f.db,f.actor,ticketInput);f.db.native.prepare("UPDATE sync_attachment_tickets SET expires_at='2000-01-01T00:00:00.000Z' WHERE used_at IS NULL").run();
  await assert.rejects(consumeAttachmentTicket(f.db,f.storage,token(expired)),error=>error.code==='ticket_expired');
 }finally{f.close();}
});

test('a revoked or blocked owner cannot use a previously issued ticket, including revocation during R2 reads',async()=>{
 const f=fixture();try{
  const ticket=await createAttachmentTicket(f.db,f.actor,ticketInput);
  f.db.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='owner-a'").run();
  await assert.rejects(consumeAttachmentTicket(f.db,f.storage,token(ticket)),error=>error.status===403);assert.equal(f.storage.reads,0);
  f.db.native.prepare("UPDATE portal_users SET status='active' WHERE user_id='owner-a'").run();
  f.storage.onRead=()=>f.db.native.prepare("UPDATE members SET revoked_at=? WHERE id='owner-membership'").run(f.now);
  await assert.rejects(consumeAttachmentTicket(f.db,f.storage,token(ticket)),error=>error.status===403);
  assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='sync.attachment.download'").get().n,0);
 }finally{f.close();}
});

test('source anonymization during storage reads suppresses bytes and leaves no export proof',async()=>{
 const f=fixture();try{
  const ticket=await createAttachmentTicket(f.db,f.actor,ticketInput);
  f.storage.onRead=()=>f.db.native.prepare("UPDATE portal_users SET anonymized_at=? WHERE user_id='source-a'").run(f.now);
  await assert.rejects(consumeAttachmentTicket(f.db,f.storage,token(ticket)),error=>error.code==='attachment_not_found');
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM audit').get().n,0);
 }finally{f.close();}
});

test('export ACK requires a real hash receipt, private Drive permissions and native readback, and retries create one audit',async()=>{
 const f=fixture();try{
  const input=await copied(f);
  await assert.rejects(acknowledgeAttachmentExport(f.db,f.actor,{...input,privateConfirmed:false}),error=>error.code==='private_copy_required');
  await assert.rejects(acknowledgeAttachmentExport(f.db,f.actor,{...input,driveUrl:'https://drive.google.com/file/d/another-file/view'}),error=>error.code==='invalid_drive_url');
  await assert.rejects(acknowledgeAttachmentExport(f.db,f.actor,{...input,contentHash:'a'.repeat(64)}),error=>error.code==='attachment_receipt_required');
  const first=await acknowledgeAttachmentExport(f.db,f.actor,input),retry=await acknowledgeAttachmentExport(f.db,f.actor,input);
  assert.equal(first.export.id,retry.export.id);assert.equal(retry.duplicate,true);
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_attachment_exports').get().n,1);
  assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='sync.attachment.export'").get().n,1);
  await assert.rejects(acknowledgeAttachmentExport(f.db,f.actor,{...input,driveFileId:'another-file-0002',driveUrl:'https://drive.google.com/file/d/another-file-0002/view'}),error=>error.code==='attachment_export_exists');
 }finally{f.close();}
});

test('late avatar ACK after anonymization records the external copy and reopens privacy cleanup; confirmed removal is separately audited',async()=>{
 const f=fixture();try{
  const input=await copied(f,'avatar','source-a');
  f.db.native.prepare("UPDATE portal_users SET anonymized_at=? WHERE user_id='source-a'").run(f.now);
  f.db.native.prepare("UPDATE profiles SET avatar_key=NULL,mime=NULL,display_name='Anonimizado' WHERE user_id='source-a'").run();
  f.db.native.prepare("INSERT INTO privacy_requests(id,user_id,status,requested_at,completed_at) VALUES('request-a','source-a','completed',?,?)").run(f.now,f.now);
  const result=await acknowledgeAttachmentExport(f.db,f.actor,input);
  assert.equal(f.db.native.prepare("SELECT status FROM privacy_requests WHERE id='request-a'").get().status,'cleanup_pending');
  assert.equal(f.db.native.prepare("SELECT completed_at FROM privacy_requests WHERE id='request-a'").get().completed_at,null);
  const pending=await listSyncAttachments(f.db,f.actor);assert.equal(pending.attachments.length,0);assert.equal(pending.cleanupPendingExports[0].exportId,result.export.id);assert.equal(pending.cleanupPendingExports[0].url,input.driveUrl);assert.doesNotMatch(JSON.stringify(pending),/private-r2|Private name/);
  await assert.rejects(acknowledgeAttachmentCleanup(f.db,f.actor,{exportId:result.export.id,reason:'Verified deletion'}),error=>error.code==='cleanup_confirmation_required');
  await acknowledgeAttachmentCleanup(f.db,f.actor,{exportId:result.export.id,confirmedDeleted:true,reason:'Exclusão confirmada no Drive privado'});
  const replay=await acknowledgeAttachmentCleanup(f.db,f.actor,{exportId:result.export.id,confirmedDeleted:true,reason:'Exclusão confirmada no Drive privado'});
  assert.equal(replay.duplicate,true);
  const audit=f.db.native.prepare("SELECT actor_id,details FROM audit WHERE action='sync.attachment.cleanup'").all();assert.equal(audit.length,1);assert.equal(audit[0].actor_id,f.actor.userId);
  assert.equal(f.db.native.prepare("SELECT status FROM privacy_requests WHERE id='request-a'").get().status,'cleanup_pending','only privacy service may confirm complete cleanup of every copy');
 }finally{f.close();}
});

test('ticket route serves protected no-store bytes with checksum and suppresses repeat requests',async()=>{
 const f=fixture();try{
  globalThis.__attachmentDb=f.db;globalThis.__attachmentBucket=f.storage;
  const ticket=await createAttachmentTicket(f.db,f.actor,ticketInput),raw=token(ticket);
  const response=await download.GET(new Request(ticket.url),{params:Promise.resolve({token:raw})});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.match(response.headers.get('Content-Security-Policy'),/sandbox/);assert.match(response.headers.get('Content-Disposition'),/^attachment;/);assert.match(response.headers.get('X-Proex-Content-SHA256'),/^[a-f0-9]{64}$/);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes);
  assert.equal((await download.GET(new Request(ticket.url),{params:Promise.resolve({token:raw})})).status,410);
 }finally{f.close();delete globalThis.__attachmentDb;delete globalThis.__attachmentBucket;}
});


test('changed avatars update the existing private Drive file and audit a new checksum without creating another copy',async()=>{
 const f=fixture();try{
  const first=await copied(f,'avatar','source-a');await acknowledgeAttachmentExport(f.db,f.actor,first);
  f.storage.objects.set('avatar-r2-key',new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,42]));
  const next=await copied(f,'avatar','source-a');assert.notEqual(next.contentHash,first.contentHash);
  const result=await acknowledgeAttachmentExport(f.db,f.actor,next);assert.equal(result.duplicate,false);assert.equal(result.export.drive_file_id,first.driveFileId);assert.equal(result.export.content_hash,next.contentHash);
  assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM sync_attachment_exports').get().n,1);assert.equal(f.db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='sync.attachment.export'").get().n,2);
 }finally{f.close();}
});
