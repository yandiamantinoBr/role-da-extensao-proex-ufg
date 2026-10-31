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
  [resolve(root, 'lib/platform.ts'), dataModule('export function database(){return globalThis.__recordsDb;} export function bucket(){return globalThis.__recordsBucket;}')],
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
const records = await import(compile('lib/records.ts'));
const route = await import(compile('app/api/records/route.ts'));
const download = await import(compile('app/api/records/files/[id]/route.ts'));
const { listRecords, createRecord, uploadRecordAttachment, recordAttachment, validatedRecordFile, readRecordForm, requireRecordMutation, MAX_RECORD_FILE_BYTES } = records;

function fixture() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString();
  for (const id of ['project-a', 'project-b']) native.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run(id, id, now);
  native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('asset-a','project-a','Projector','equipment','unidade',1,?),('asset-b','project-b','Other asset','equipment','unidade',1,?)").run(now, now);
  const clock = Date.now();
  native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,starts_at,ends_at,created_by,created_at) VALUES('loan-a','project-a','asset-a','Test activity','Private borrower',?,?,?,?)")
    .run(clock + 86400000, clock + 90000000, 'test', now);
  const prepare = sql => {
    let values = [];
    return {
      sql,
      bind(...args) { values = args; return this; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
      async run() { const result = native.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
      execute() { const result = native.prepare(sql).all(...values); return { success: true, results: result, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; },
    };
  };
  const db = { native, prepare, async batch(statements) { native.exec('BEGIN'); try { const result = statements.map(statement => statement.execute()); native.exec('COMMIT'); return result; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  const objects = new Map();
  const storage = {
    objects, puts: 0, deletes: 0, onPut: null,
    async put(key, value, options) { this.puts++; objects.set(key, { bytes: new Uint8Array(value), mime: options?.httpMetadata?.contentType }); await this.onPut?.(); },
    async delete(key) { this.deletes++; objects.delete(key); },
    async get(key) { const value = objects.get(key); return value ? { size: value.bytes.length, body: value.bytes } : null; },
  };
  return { db, storage };
}
function principal(db, role, project = 'project-a') {
  const userId = crypto.randomUUID(), now = new Date().toISOString();
  const member = { id: crypto.randomUUID(), user_id: userId, email: `${role}@example.invalid`, role, project_id: project, revoked_at: null, created_at: now };
  db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(member));
  db.native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(userId, member.email, 'active', now, now);
  return { userId, email: member.email, displayName: role, members: [member], capabilities: [] };
}
const input = overrides => ({ projectId: 'project-a', kind: 'observation', title: 'Activity record', body: 'Operational notes', occurredAt: '2026-10-20T10:00:00-03:00', operationKey: crypto.randomUUID(), ...overrides });
const pdf = new TextEncoder().encode('%PDF-1.7\nTest document\n%%EOF');
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6qdsAAAAASUVORK5CYII=', 'base64'));
const file = (recordId, overrides = {}) => ({ recordId, bytes: pdf, name: 'term.pdf', declaredMime: 'application/pdf', operationKey: crypto.randomUUID(), ...overrides });
const count = (db, table) => db.native.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
function transport(db, storage, actor) { globalThis.__recordsDb = db; globalThis.__recordsBucket = storage; globalThis.__recordsUser = actor ? { userId: actor.userId, email: actor.email, displayName: actor.displayName, hasPassword: false } : null; }

 test('record creation uses real project roles, validates links and is idempotent under concurrency', async () => {
  const { db } = fixture();
  try {
    const manager = principal(db, 'manager'), payload = input({ itemId: 'asset-a' });
    const [first, replay] = await Promise.all([createRecord(db, manager, payload), createRecord(db, manager, payload)]);
    assert.equal(first.id, replay.id);
    assert.equal(first.record.occurred_at, '2026-10-20T13:00:00.000Z');
    assert.deepEqual(first.record.attachments, []);
    assert.equal(count(db, 'records'), 1);
    assert.equal(count(db, 'audit'), 1);
    await assert.rejects(createRecord(db, manager, { ...payload, title: 'Altered meaning' }), error => error.code === 'operation_changed');
    await assert.rejects(createRecord(db, manager, input({ itemId: 'asset-b' })), error => error.code === 'project_mismatch');
    await assert.rejects(createRecord(db, manager, input({ projectId: 'project-b' })), error => error.status === 403);
    const operator = principal(db, 'operator');
    await assert.rejects(createRecord(db, operator, input({})), error => error.status === 403);
  } finally { db.native.close(); }
});

test('GET separates loan notes, inventory notes and project observations across scopes', async () => {
  const { db } = fixture();
  try {
    const owner = principal(db, 'owner', null);
    await createRecord(db, owner, input({ title: 'Project note' }));
    const loan = await createRecord(db, owner, input({ kind: 'loan', loanId: 'loan-a', title: 'Private loan note' }));
    await createRecord(db, owner, input({ kind: 'maintenance', itemId: 'asset-a', title: 'Inventory note' }));
    await createRecord(db, owner, input({ projectId: 'project-b', title: 'Other project note' }));
    // A record linked to a loan stays private even if somebody labels it as a project observation.
    await createRecord(db, owner, input({ loanId: 'loan-a', title: 'Also private' }));
    const viewer = principal(db, 'viewer'), inventory = principal(db, 'inventory'), loans = principal(db, 'loans');
    assert.deepEqual((await listRecords(db, viewer)).records.map(row => row.title), ['Project note']);
    assert.deepEqual((await listRecords(db, inventory)).records.map(row => row.title), ['Inventory note']);
    const loanRows = (await listRecords(db, loans)).records;
    assert.deepEqual(loanRows.map(row => row.title).sort(), ['Also private', 'Private loan note']);
    assert.ok(loanRows.some(row => row.id === loan.id));
    await assert.rejects(listRecords(db, viewer, { projectId: 'project-b' }), error => error.status === 403);
    assert.equal((await listRecords(db, owner)).records.length, 5);
  } finally { db.native.close(); }
});

test('dates and intervals are strict, listings use date bounds and never exceed 100 records', async () => {
  const { db } = fixture();
  try {
    const manager = principal(db, 'manager');
    await assert.rejects(createRecord(db, manager, input({ occurredAt: '2026-02-30T10:00:00Z' })), error => error.code === 'invalid_date');
    await assert.rejects(createRecord(db, manager, input({ startsAt: '2026-10-20T10:00:00Z' })), error => error.code === 'invalid_interval');
    await assert.rejects(createRecord(db, manager, input({ startsAt: '2026-10-21T10:00:00Z', endsAt: '2026-10-20T10:00:00Z' })), error => error.code === 'invalid_interval');
    const insert = db.native.prepare("INSERT INTO records(id,project_id,kind,title,body,occurred_at,created_by,created_at) VALUES(?,'project-a','observation','Test','','2026-10-20T13:00:00.000Z',?,'2026-10-20T13:00:00.000Z')");
    for (let i = 0; i < 105; i++) insert.run(crypto.randomUUID(), manager.userId);
    const listed = await listRecords(db, manager, { limit: 1000, from: '2026-10-20T00:00:00Z', to: '2026-10-21T00:00:00Z' });
    assert.equal(listed.records.length, 100);
    assert.equal(listed.limit, 100);
    assert.equal(listed.truncated, true);
    assert.equal((await listRecords(db, manager, { from: '2026-10-21T00:00:00Z' })).records.length, 0);
    await assert.rejects(listRecords(db, manager, { from: '2026-10-21T00:00:00Z', to: '2026-10-20T00:00:00Z' }), error => error.code === 'invalid_interval');
  } finally { db.native.close(); }
});

test('revocation and blocking are checked from SQL rather than stale actor capabilities', async () => {
  const { db } = fixture();
  try {
    const manager = principal(db, 'manager');
    await createRecord(db, manager, input({}));
    db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), manager.members[0].id);
    await assert.rejects(createRecord(db, manager, input({})), error => error.status === 403);
    assert.equal((await listRecords(db, manager)).records.length, 0);
    const other = principal(db, 'manager');
    db.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(other.userId);
    await assert.rejects(createRecord(db, other, input({})), error => error.status === 403);
    assert.equal((await listRecords(db, other)).records.length, 0);
  } finally { db.native.close(); }
});

test('an audit failure rolls back the record and its mobile idempotency claim', async () => {
  const { db } = fixture();
  try {
    const manager = principal(db, 'manager');
    db.native.exec("CREATE TRIGGER test_record_audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'audit_failure'); END");
    await assert.rejects(createRecord(db, manager, input({})));
    assert.equal(count(db, 'records'), 0);
    assert.equal(count(db, 'mutation_keys'), 0);
  } finally { db.native.close(); }
});

test('attachments are private, scoped, content-bound and idempotent under concurrent upload', async () => {
  const { db, storage } = fixture();
  try {
    const manager = principal(db, 'manager'), record = await createRecord(db, manager, input({})), payload = file(record.id);
    const [first, replay] = await Promise.all([uploadRecordAttachment(db, storage, manager, payload), uploadRecordAttachment(db, storage, manager, payload)]);
    assert.equal(first.attachment.id, replay.attachment.id);
    assert.equal(count(db, 'record_attachments'), 1);
    assert.equal(storage.objects.size, 1);
    assert.equal(Object.hasOwn(first.attachment, 'object_key'), false);
    assert.equal(Object.hasOwn((await listRecords(db, manager)).records[0].attachments[0], 'object_key'), false);
    const puts = storage.puts;
    await uploadRecordAttachment(db, storage, manager, payload);
    assert.equal(storage.puts, puts);
    await assert.rejects(uploadRecordAttachment(db, storage, manager, { ...payload, bytes: new TextEncoder().encode('%PDF-1.7\nAltered bytes\n%%EOF') }), error => error.code === 'operation_changed');
    const outsider = principal(db, 'manager', 'project-b');
    await assert.rejects(recordAttachment(db, outsider, first.attachment.id), error => error.status === 403);
    const viewer = principal(db, 'viewer');
    assert.equal((await recordAttachment(db, viewer, first.attachment.id)).id, first.attachment.id);
    await assert.rejects(uploadRecordAttachment(db, storage, viewer, file(record.id)), error => error.status === 403);
  } finally { db.native.close(); }
});

test('loan attachment download requires loan permission even for project viewers', async () => {
  const { db, storage } = fixture();
  try {
    const manager = principal(db, 'manager'), record = await createRecord(db, manager, input({ kind: 'loan', loanId: 'loan-a' }));
    const uploaded = await uploadRecordAttachment(db, storage, manager, file(record.id));
    const viewer = principal(db, 'viewer');
    await assert.rejects(recordAttachment(db, viewer, uploaded.attachment.id), error => error.status === 403);
    const loans = principal(db, 'loans');
    assert.equal((await recordAttachment(db, loans, uploaded.attachment.id)).id, uploaded.attachment.id);
  } finally { db.native.close(); }
});

test('failed attachment audit and access revoked during storage upload leave no dangling R2 objects', async () => {
  const { db, storage } = fixture();
  try {
    const manager = principal(db, 'manager'), record = await createRecord(db, manager, input({}));
    const beforeClaims = count(db, 'mutation_keys');
    db.native.exec("CREATE TRIGGER test_attachment_audit_failure BEFORE INSERT ON audit WHEN NEW.action='record.attachment' BEGIN SELECT RAISE(ABORT,'audit_failure'); END");
    await assert.rejects(uploadRecordAttachment(db, storage, manager, file(record.id)));
    assert.equal(storage.objects.size, 0);
    assert.equal(count(db, 'record_attachments'), 0);
    assert.equal(count(db, 'mutation_keys'), beforeClaims);
    db.native.exec('DROP TRIGGER test_attachment_audit_failure');
    storage.onPut = async () => db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), manager.members[0].id);
    await assert.rejects(uploadRecordAttachment(db, storage, manager, file(record.id)));
    assert.equal(storage.objects.size, 0);
    assert.equal(count(db, 'record_attachments'), 0);
  } finally { db.native.close(); }
});

test('a lost DB response after attachment commit preserves the referenced object and recovers replay', async () => {
  const { db, storage } = fixture();
  try {
    const manager = principal(db, 'manager'), record = await createRecord(db, manager, input({})), batch = db.batch.bind(db);
    let fail = true;
    db.batch = async statements => { const result = await batch(statements); if (fail) { fail = false; throw new Error('lost_response_after_commit'); } return result; };
    const result = await uploadRecordAttachment(db, storage, manager, file(record.id));
    assert.ok(result.attachment.id);
    assert.equal(storage.objects.size, 1);
    assert.equal(storage.deletes, 0);
    assert.equal(count(db, 'record_attachments'), 1);
  } finally { db.native.close(); }
});

test('file validation rejects executable names, mismatches, SVG, incomplete images and oversized content', () => {
  assert.equal(validatedRecordFile(file('record', { bytes: png, name: 'photo.png', declaredMime: 'image/png' })).mime, 'image/png');
  for (const overrides of [
    { name: 'script.svg.pdf' }, { declaredMime: 'image/png' }, { name: 'term.png' },
    { bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), name: 'photo.svg', declaredMime: 'image/svg+xml' },
    { bytes: png.subarray(0, 33), name: 'photo.png', declaredMime: 'image/png' },
    { bytes: new Uint8Array(MAX_RECORD_FILE_BYTES + 1) },
  ]) assert.throws(() => validatedRecordFile(file('record', overrides)), error => error.status === 415 || error.status === 413);
});

test('multipart parsing enforces one file, bounded bodies and explicit same-origin actions', async () => {
  const form = new FormData(); form.set('recordId', 'record-test'); form.set('operationKey', 'record-form-0001'); form.set('file', new File([pdf], 'term.pdf', { type: 'application/pdf' }));
  const request = new Request('https://portal.example.invalid/api/records', { method: 'POST', body: form, headers: { Origin: 'https://portal.example.invalid', 'X-Proex-Action': '1' } });
  requireRecordMutation(request, 'form');
  assert.equal((await readRecordForm(request)).recordId, 'record-test');
  assert.throws(() => requireRecordMutation(new Request('https://portal.example.invalid/api/records', { method: 'POST', headers: { Origin: 'https://attacker.example.invalid', 'X-Proex-Action': '1', 'Content-Type': 'application/json' } }), 'json'), error => error.status === 403);
  const duplicate = new FormData(); duplicate.set('recordId', 'record-test'); duplicate.set('operationKey', 'record-form-0002'); duplicate.append('file', new File([pdf], 'first.pdf')); duplicate.append('file', new File([pdf], 'second.pdf'));
  await assert.rejects(readRecordForm(new Request('https://portal.example.invalid/api/records', { method: 'POST', body: duplicate })), error => error.status === 400);
  await assert.rejects(readRecordForm(new Request('https://portal.example.invalid/api/records', { method: 'POST', body: 'x', headers: { 'Content-Length': String(MAX_RECORD_FILE_BYTES * 2), 'Content-Type': 'multipart/form-data; boundary=test' } })), error => error.status === 413);
});

test('record attachments use the same 4 MiB limit including multipart overhead', async () => {
  const limit = 4 * 1024 * 1024;
  assert.equal(MAX_RECORD_FILE_BYTES, limit);
  const atLimit = new Uint8Array(limit); atLimit.set(pdf);
  assert.equal(validatedRecordFile(file('record', { bytes: atLimit })).mime, 'application/pdf');
  for (const size of [limit, limit + 1]) {
    const bytes = new Uint8Array(size); bytes.set(pdf);
    const form = new FormData(); form.set('recordId', 'record-test'); form.set('operationKey', 'record-boundary-0001'); form.set('file', new File([bytes], 'term.pdf', { type: 'application/pdf' }));
    const request = new Request('https://portal.example.invalid/api/records', { method: 'POST', body: form });
    if (size === limit) assert.equal((await readRecordForm(request)).bytes.byteLength, limit);
    else await assert.rejects(readRecordForm(request), error => error.status === 413 && /4 MB/.test(error.message));
  }
});

test('HTTP routes use real authorization and private download headers for PDF and images', async () => {
  const { db, storage } = fixture();
  try {
    const manager = principal(db, 'manager'); transport(db, storage, manager);
    const response = await route.POST(new Request('https://portal.example.invalid/api/records', { method: 'POST', headers: { Origin: 'https://portal.example.invalid', 'X-Proex-Action': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input({}), action: 'create' }) }));
    assert.equal(response.status, 201);
    const record = (await response.json()).record;
    const pdfUpload = await uploadRecordAttachment(db, storage, manager, file(record.id));
    const pngUpload = await uploadRecordAttachment(db, storage, manager, file(record.id, { bytes: png, name: 'photo.png', declaredMime: 'image/png' }));
    for (const [upload, disposition] of [[pdfUpload, 'attachment'], [pngUpload, 'inline']]) {
      const downloaded = await download.GET(new Request('https://portal.example.invalid/file'), { params: Promise.resolve({ id: upload.attachment.id }) });
      assert.equal(downloaded.status, 200);
      assert.ok(downloaded.headers.get('Content-Disposition').startsWith(disposition));
      assert.equal(downloaded.headers.get('X-Content-Type-Options'), 'nosniff');
      assert.equal(downloaded.headers.get('Cache-Control'), 'private, no-store');
      assert.ok(downloaded.headers.get('Content-Security-Policy').includes('sandbox'));
    }
    const listed = await route.GET(new Request('https://portal.example.invalid/api/records?projectId=project-a'));
    assert.equal((await listed.json()).records.length, 1);
    transport(db, storage, null);
    assert.equal((await download.GET(new Request('https://portal.example.invalid/file'), { params: Promise.resolve({ id: pdfUpload.attachment.id }) })).status, 401);
  } finally { db.native.close(); }
});

test('uncertain DB availability after commit preserves a private object until the retry can confirm it', async () => {
  const { db, storage } = fixture();
  try {
    const manager = principal(db, 'manager'), record = await createRecord(db, manager, input({})), payload = file(record.id);
    const originalBatch = db.batch.bind(db), originalPrepare = db.prepare;
    db.batch = async statements => {
      await originalBatch(statements);
      db.prepare = () => { throw new Error('database_temporarily_unavailable'); };
      throw new Error('response_lost');
    };
    await assert.rejects(uploadRecordAttachment(db, storage, manager, payload));
    assert.equal(storage.objects.size, 1);
    assert.equal(storage.deletes, 0);
    assert.equal(count(db, 'record_attachments'), 1);
    db.prepare = originalPrepare; db.batch = originalBatch;
    const replay = await uploadRecordAttachment(db, storage, manager, payload);
    assert.equal(replay.duplicate, true);
    assert.equal(storage.puts, 1);
    assert.equal(storage.objects.size, 1);
  } finally { db.native.close(); }
});

test('chunked multipart bodies are bounded before parsing even without Content-Length', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_RECORD_FILE_BYTES + 64 * 1024 + 1)); controller.close(); } });
  const request = new Request('https://portal.example.invalid/api/records', { method: 'POST', duplex: 'half', body: stream, headers: { 'Content-Type': 'multipart/form-data; boundary=test' } });
  await assert.rejects(readRecordForm(request), error => error.status === 413);
});

test('soft-deleted record attachments cannot be listed, downloaded or restored by an upload replay', async()=>{
 const {db,storage}=fixture();
 try{
  const manager=principal(db,'manager'),record=await createRecord(db,manager,input({})),payload=file(record.id);
  const uploaded=await uploadRecordAttachment(db,storage,manager,payload);
  db.native.prepare('UPDATE record_attachments SET deleted_at=? WHERE id=?').run(new Date().toISOString(),uploaded.attachment.id);
  assert.deepEqual((await listRecords(db,manager)).records[0].attachments,[]);
  await assert.rejects(recordAttachment(db,manager,uploaded.attachment.id),error=>error.code==='attachment_not_found');
  await assert.rejects(uploadRecordAttachment(db,storage,manager,payload),error=>error.code==='attachment_not_found');
  assert.equal(storage.puts,1);assert.equal(count(db,'record_attachments'),1);
 }finally{db.native.close();}
});

test('pending and anonymized accounts cannot use stale roles to read or mutate private records',async()=>{
 for(const state of ['pending','anonymized']){
  const {db,storage}=fixture();
  try{
   const manager=principal(db,'manager'),record=await createRecord(db,manager,input({}));
   const uploaded=await uploadRecordAttachment(db,storage,manager,file(record.id));
   if(state==='pending')db.native.prepare('UPDATE portal_users SET activation_pending=1 WHERE user_id=?').run(manager.userId);
   else db.native.prepare("UPDATE portal_users SET status='active',anonymized_at=? WHERE user_id=?").run(new Date().toISOString(),manager.userId);
   assert.equal((await listRecords(db,manager)).records.length,0);
   await assert.rejects(createRecord(db,manager,input({})),error=>error.code==='access_changed');
   await assert.rejects(recordAttachment(db,manager,uploaded.attachment.id),error=>error.code==='access_changed');
   await assert.rejects(uploadRecordAttachment(db,storage,manager,file(record.id)),error=>error.code==='access_changed');
   assert.equal(storage.puts,1);assert.equal(count(db,'records'),1);
  }finally{db.native.close();}
 }
});

test('activation and anonymization changes during R2 upload prevent the attachment commit and compensate its object',async()=>{
 for(const state of ['pending','anonymized']){
  const {db,storage}=fixture();
  try{
   const manager=principal(db,'manager'),record=await createRecord(db,manager,input({}));
   storage.onPut=async()=>{if(state==='pending')db.native.prepare('UPDATE portal_users SET activation_pending=1 WHERE user_id=?').run(manager.userId);else db.native.prepare("UPDATE portal_users SET status='active',anonymized_at=? WHERE user_id=?").run(new Date().toISOString(),manager.userId);};
   await assert.rejects(uploadRecordAttachment(db,storage,manager,file(record.id)));
   assert.equal(storage.objects.size,0);assert.equal(count(db,'record_attachments'),0);
   assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='record.attachment'").get().n,0);
  }finally{db.native.close();}
 }
});

test('failed compensation after a late anonymized record upload is queued and reopens completed privacy cleanup',async()=>{
 const {db,storage}=fixture();
 try{
  const manager=principal(db,'manager'),record=await createRecord(db,manager,input({})),requestId=crypto.randomUUID(),now=new Date().toISOString();
  storage.onPut=async()=>{
   db.native.prepare("UPDATE portal_users SET status='active',anonymized_at=? WHERE user_id=?").run(now,manager.userId);
   db.native.prepare("INSERT INTO privacy_requests(id,user_id,status,requested_at,completed_at) VALUES(?,?,'completed',?,?)").run(requestId,manager.userId,now,now);
  };
  storage.delete=async()=>{throw new Error('synthetic R2 deletion outage');};
  await assert.rejects(uploadRecordAttachment(db,storage,manager,file(record.id)));
  assert.equal(count(db,'record_attachments'),0);assert.equal(storage.objects.size,1);
  const queued=db.native.prepare('SELECT user_id,object_key,mime FROM private_object_deletions').get();
  assert.equal(queued.user_id,manager.userId);assert.equal(queued.mime,'application/pdf');assert.ok(storage.objects.has(queued.object_key));
  const request=db.native.prepare('SELECT status,completed_at FROM privacy_requests WHERE id=?').get(requestId);
  assert.equal(request.status,'cleanup_pending');assert.equal(request.completed_at,null);
 }finally{db.native.close();}
});
