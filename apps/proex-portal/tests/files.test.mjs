import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const overrides = new Map([
  [resolve(root, 'lib/session.ts'), asModule('export async function getPortalUser(){return globalThis.__filesUser??null;}')],
  [resolve(root, 'lib/platform.ts'), asModule('export function database(){return globalThis.__filesDb;} export function bucket(){return globalThis.__filesBucket;} export function ownerEmail(){return undefined;}')],
]);
const modules = new Map();
function compile(file) {
  file = resolve(root, file);
  if (overrides.has(file)) return overrides.get(file);
  if (modules.has(file)) return modules.get(file);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, _quote, dependency) => {
    if (!dependency.startsWith('.') && !dependency.startsWith('@/')) return match;
    const path = dependency.startsWith('@/') ? resolve(root, dependency.slice(2)) : resolve(dirname(file), dependency);
    return `from ${JSON.stringify(compile(path.endsWith('.ts') ? path : `${path}.ts`))}`;
  });
  const url = asModule(`${code}\n//# sourceURL=${file.replace(root, '')}-under-test.mjs`);
  modules.set(file, url); return url;
}
const route = await import(compile('app/api/files/route.ts'));
const download = await import(compile('app/api/files/[id]/route.ts'));
const pdf = new TextEncoder().encode('%PDF-1.7\nInstitutional test term\n%%EOF');
const count = (db, table) => db.native.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString(), time = Date.now();
  native.prepare("INSERT INTO projects(id,name,created_at) VALUES('project-a','Project A',?),('project-b','Project B',?)").run(now, now);
  native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('asset-a','project-a','Projector','equipment','unidade',1,?)").run(now);
  native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,starts_at,ends_at,created_by,created_at) VALUES('loan-a','project-a','asset-a','Extension event','Recipient',?,?,?,?)").run(time + 86400000, time + 90000000, 'test', now);
  const prepare = sql => {
    let values = [];
    return {
      sql, bind(...args) { values = args; return this; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
      async run() { const result = native.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
      execute() { const result = native.prepare(sql).all(...values); return { success: true, results: result, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; },
    };
  };
  const db = { native, prepare, async batch(statements) { native.exec('BEGIN'); try { const result = statements.map(statement => statement.execute()); native.exec('COMMIT'); return result; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  const objects = new Map();
  const storage = { objects, puts: 0, deletes: 0, onPut: null,
    async put(key, bytes, options) { this.puts++; objects.set(key, { bytes: new Uint8Array(bytes), mime: options?.httpMetadata?.contentType }); await this.onPut?.(); },
    async delete(key) { this.deletes++; objects.delete(key); },
    async get(key) { const object = objects.get(key); return object ? { size: object.bytes.byteLength, body: object.bytes } : null; },
  };
  return { db, storage };
}
function principal(db, role = 'loans', projectId = 'project-a') {
  const userId = crypto.randomUUID(), now = new Date().toISOString(), member = { id: crypto.randomUUID(), user_id: userId, email: `${role}@example.invalid`, role, project_id: projectId, revoked_at: null, created_at: now };
  db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(member));
  db.native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(userId, member.email, 'active', now, now);
  return { userId, email: member.email, displayName: role, hasPassword: false, member };
}
function context(db, storage, user) { globalThis.__filesDb = db; globalThis.__filesBucket = storage; globalThis.__filesUser = user; }
function request(key, { bytes = pdf, name = 'term.pdf', mime = 'application/pdf', origin = 'https://portal.example.invalid', formKey } = {}) {
  const body = new FormData(); body.set('loanId', 'loan-a'); body.set('file', new File([bytes], name, { type: mime })); if (formKey) body.set('operationKey', formKey);
  return new Request('https://portal.example.invalid/api/files', { method: 'POST', body, headers: { Origin: origin, 'X-Proex-Action': '1', ...(key ? { 'X-Operation-Key': key } : {}) } });
}

test('loan term upload stores a scoped idempotency key and content hash without exposing private storage keys', async () => {
  const { db, storage } = fixture();
  try {
    const user = principal(db); context(db, storage, user);
    const first = await route.POST(request('loan-upload-0001'));
    assert.equal(first.status, 201);
    const result = await first.json();
    assert.equal(result.loanId, 'loan-a');
    assert.equal(Object.hasOwn(result, 'object_key'), false);
    assert.equal(Object.hasOwn(result, 'content_hash'), false);
    assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
    const row = db.native.prepare('SELECT operation_key,content_hash FROM documents').get();
    assert.match(row.operation_key, /^[a-f0-9]{64}$/);
    assert.match(row.content_hash, /^[a-f0-9]{64}$/);
    const replay = await route.POST(request('loan-upload-0001'));
    assert.equal(replay.status, 201);
    assert.equal((await replay.json()).id, result.id);
    assert.equal(storage.puts, 1);
    assert.equal(count(db, 'documents'), 1);
    assert.equal(count(db, 'audit'), 1);
    const changed = await route.POST(request('loan-upload-0001', { bytes: new TextEncoder().encode('%PDF-1.7\nChanged term\n%%EOF') }));
    assert.equal(changed.status, 409);
    assert.equal(count(db, 'documents'), 1);
    const downloaded = await download.GET(new Request('https://portal.example.invalid/file'), { params: Promise.resolve({ id: result.id }) });
    assert.equal(downloaded.status, 200);
    assert.ok(downloaded.headers.get('Content-Disposition').startsWith('attachment;'));
  } finally { db.native.close(); }
});

test('concurrent identical uploads retain one document, audit and R2 object', async () => {
  const { db, storage } = fixture();
  try {
    context(db, storage, principal(db));
    const responses = await Promise.all([route.POST(request('concurrent-upload-0001')), route.POST(request('concurrent-upload-0001'))]);
    assert.ok(responses.every(response => response.status === 201));
    const values = await Promise.all(responses.map(response => response.json()));
    assert.equal(values[0].id, values[1].id);
    assert.equal(count(db, 'documents'), 1); assert.equal(count(db, 'audit'), 1); assert.equal(storage.objects.size, 1);
  } finally { db.native.close(); }
});

test('upload rechecks project role, rejects unauthenticated users and supports the explicit form operation key', async () => {
  const { db, storage } = fixture();
  try {
    context(db, storage, principal(db, 'loans', 'project-b'));
    assert.equal((await route.POST(request('outsider-upload-0001'))).status, 403);
    context(db, storage, principal(db, 'viewer'));
    assert.equal((await route.POST(request('viewer-upload-0001'))).status, 403);
    context(db, storage, null);
    assert.equal((await route.POST(request('anonymous-upload-0001'))).status, 401);
    context(db, storage, principal(db));
    assert.equal((await route.POST(request(null, { formKey: 'form-upload-0001' }))).status, 201);
    assert.equal((await route.POST(request('header-upload-0001', { formKey: 'mismatch-upload-0001' }))).status, 400);
    assert.equal(storage.puts, 1);
  } finally { db.native.close(); }
});

test('revocation while R2 stores the file rejects the operation and removes the unreferenced object', async () => {
  const { db, storage } = fixture();
  try {
    const user = principal(db); context(db, storage, user);
    storage.onPut = async () => db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), user.member.id);
    assert.equal((await route.POST(request('revoked-upload-0001'))).status, 403);
    assert.equal(count(db, 'documents'), 0); assert.equal(count(db, 'mutation_keys'), 0); assert.equal(storage.objects.size, 0);
  } finally { db.native.close(); }
});

test('audit failure rolls back the upload and claim and compensates R2 storage', async () => {
  const { db, storage } = fixture();
  try {
    context(db, storage, principal(db));
    db.native.exec("CREATE TRIGGER test_document_audit_failure BEFORE INSERT ON audit WHEN NEW.action='document.upload' BEGIN SELECT RAISE(ABORT,'test_failure'); END");
    const result = await route.POST(request('audit-upload-0001'));
    assert.ok(result.status >= 400);
    assert.equal(count(db, 'documents'), 0); assert.equal(count(db, 'mutation_keys'), 0); assert.equal(storage.objects.size, 0);
  } finally { db.native.close(); }
});

test('a lost D1 reply after upload commit preserves the document and replays its result', async () => {
  const { db, storage } = fixture();
  try {
    context(db, storage, principal(db));
    const batch = db.batch.bind(db); let fail = true;
    db.batch = async statements => { const result = await batch(statements); if (fail && statements.some(statement => statement.sql.includes('INSERT INTO documents'))) { fail = false; throw new Error('reply_lost_after_commit'); } return result; };
    const response = await route.POST(request('lost-reply-upload-0001'));
    assert.equal(response.status, 201); assert.equal(storage.objects.size, 1); assert.equal(storage.deletes, 0); assert.equal(count(db, 'documents'), 1);
    const replay = await route.POST(request('lost-reply-upload-0001'));
    assert.equal(replay.status, 201); assert.equal(storage.puts, 1);
  } finally { db.native.close(); }
});

test('uncertain D1 availability after commit preserves the object until retry confirms it', async () => {
  const { db, storage } = fixture();
  try {
    context(db, storage, principal(db));
    const batch = db.batch.bind(db), prepare = db.prepare;
    db.batch = async statements => { const result = await batch(statements); if (statements.some(statement => statement.sql.includes('INSERT INTO documents'))) { db.prepare = () => { throw new Error('database_unavailable'); }; throw new Error('reply_lost'); } return result; };
    const first = await route.POST(request('uncertain-upload-0001'));
    assert.equal(first.status, 500); assert.equal(storage.objects.size, 1); assert.equal(storage.deletes, 0); assert.equal(count(db, 'documents'), 1);
    db.prepare = prepare; db.batch = batch;
    const replay = await route.POST(request('uncertain-upload-0001'));
    assert.equal(replay.status, 201); assert.equal(storage.puts, 1); assert.equal(count(db, 'documents'), 1);
  } finally { db.native.close(); }
});

test('invalid files, origins and missing operation keys do not touch R2 or database', async () => {
  const { db, storage } = fixture();
  try {
    context(db, storage, principal(db));
    assert.equal((await route.POST(request('origin-upload-0001', { origin: 'https://attacker.example.invalid' }))).status, 403);
    assert.equal((await route.POST(request(null))).status, 400);
    assert.equal((await route.POST(request('svg-upload-0001', { bytes: new TextEncoder().encode('<svg/>'), name: 'photo.svg', mime: 'image/svg+xml' }))).status, 415);
    assert.equal((await route.POST(request('mismatch-upload-0001', { name: 'term.png' }))).status, 415);
    // Node 24's in-process FormData serializer rejects asynchronously when its
    // stream is cancelled before the final multipart boundary. Exercise the
    // received wire bytes here; the separate chunked case covers cancellation.
    const oversized = request('huge-upload-0001', { bytes: new Uint8Array(10 * 1024 * 1024 + 1) });
    const wireBody = await oversized.arrayBuffer();
    assert.equal((await route.POST(new Request(oversized.url, { method: 'POST', headers: oversized.headers, body: wireBody }))).status, 413);
    assert.equal(storage.puts, 0); assert.equal(count(db, 'documents'), 0);
  } finally { db.native.close(); }
});

test('loan documents accept 4 MiB and reject larger files before storing anything', async () => {
  const { db, storage } = fixture();
  try {
    context(db, storage, principal(db));
    const atLimit = new Uint8Array(4 * 1024 * 1024); atLimit.set(pdf);
    const accepted = await route.POST(request('boundary-upload-0001', { bytes: atLimit }));
    assert.equal(accepted.status, 201);
    assert.equal((await accepted.json()).size, atLimit.byteLength);
    const rejected = await route.POST(request('above-boundary-upload-0001', { bytes: new Uint8Array(atLimit.byteLength + 1) }));
    assert.equal(rejected.status, 413);
    assert.match((await rejected.json()).error, /4 MB/);
    assert.equal(storage.puts, 1); assert.equal(count(db, 'documents'), 1);
  } finally { db.native.close(); }
});

test('loan multipart body limit rejects declared and streamed oversized bodies without a storage write', async () => {
  const { db, storage } = fixture();
  try {
    context(db, storage, principal(db));
    const length = 4 * 1024 * 1024 + 64 * 1024 + 1;
    for (const chunked of [false, true]) {
      const body = chunked ? new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(length)); controller.close(); } }) : 'x';
      const response = await route.POST(new Request('https://portal.example.invalid/api/files', {
        method: 'POST', body, ...(chunked ? { duplex: 'half' } : {}),
        headers: { Origin: 'https://portal.example.invalid', 'X-Proex-Action': '1', 'Content-Type': 'multipart/form-data; boundary=test', ...(!chunked ? { 'Content-Length': String(length) } : {}) },
      }));
      assert.equal(response.status, 413);
      assert.match((await response.json()).error, /4 MB/);
    }
    assert.equal(storage.puts, 0); assert.equal(count(db, 'documents'), 0);
  } finally { db.native.close(); }
});

test('loan upload SQL rejects activation or anonymization changes after the final actor read',async()=>{
 for(const state of ['pending','anonymized']){
  const {db,storage}=fixture();
  try{
   const user=principal(db);context(db,storage,user);const batch=db.batch.bind(db);
   db.batch=async statements=>{if(statements.some(statement=>statement.sql.includes('INSERT INTO documents'))){if(state==='pending')db.native.prepare('UPDATE portal_users SET activation_pending=1 WHERE user_id=?').run(user.userId);else db.native.prepare("UPDATE portal_users SET status='active',anonymized_at=? WHERE user_id=?").run(new Date().toISOString(),user.userId);}return batch(statements);};
   assert.ok((await route.POST(request(`loan-guard-${state}-0001`))).status>=400);
   assert.equal(count(db,'documents'),0);assert.equal(count(db,'mutation_keys'),0);assert.equal(storage.objects.size,0);
  }finally{db.native.close();}
 }
});

test('failed loan compensation is durable and reopens cleanup completed during the storage upload',async()=>{
 const {db,storage}=fixture();
 try{
  const user=principal(db);context(db,storage,user);const now=new Date().toISOString(),id=crypto.randomUUID();
  storage.onPut=async()=>{
   db.native.prepare("UPDATE portal_users SET status='blocked',anonymized_at=? WHERE user_id=?").run(now,user.userId);
   db.native.prepare("INSERT INTO privacy_requests(id,user_id,status,requested_at,completed_at) VALUES(?,?,'completed',?,?)").run(id,user.userId,now,now);
  };
  storage.delete=async()=>{throw new Error('synthetic R2 deletion outage');};
  assert.equal((await route.POST(request('loan-compensation-pending-0001'))).status,401);
  assert.equal(count(db,'documents'),0);assert.equal(storage.objects.size,1);
  const queued=db.native.prepare('SELECT user_id,object_key,mime FROM private_object_deletions').get();
  assert.equal(queued.user_id,user.userId);assert.equal(queued.mime,'application/pdf');assert.ok(storage.objects.has(queued.object_key));
  const privacy=db.native.prepare('SELECT status,completed_at FROM privacy_requests WHERE id=?').get(id);
  assert.equal(privacy.status,'cleanup_pending');assert.equal(privacy.completed_at,null);
 }finally{db.native.close();}
});
