import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
function moduleUrl(source) { return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`; }
function compile(name, dependencies = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [dependency, url] of Object.entries(dependencies)) {
    source = source.replaceAll(`from '${dependency}'`, `from ${JSON.stringify(url)}`)
      .replaceAll(`from "${dependency}"`, `from ${JSON.stringify(url)}`);
  }
  return moduleUrl(source);
}
const errors = compile('errors');
const profileModule = compile('profile', { './errors': errors, pngjs: pathToFileURL(require.resolve('pngjs')).href });
const {
  getOwnProfile, updateOwnProfile, normalizeAvatarPng, replaceOwnAvatar,
  getOwnAvatar, requireProfileMutation, readAvatarForm, MAX_AVATAR_BYTES,
} = await import(profileModule);
const user = { userId: 'canonical-user', email: 'person@example.test', displayName: 'Pessoa' };

function png(width = 2, height = 2, channel = 60) {
  return PNG.sync.write({ width, height, data: Buffer.alloc(width * height * 4, channel) });
}
function fixture(t) {
  const native = new DatabaseSync(':memory:');
  t.after(() => native.close());
  native.exec('PRAGMA foreign_keys=ON');
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    native.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  const now = new Date().toISOString();
  native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(user.userId, user.email, 'active', now, now);
  const db = {
    prepare(sql) {
      function statement(values = []) {
        return {
          bind(...parameters) { return statement(parameters); },
          async first() { return native.prepare(sql).get(...values) ?? null; },
          async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
          async run() { return this.execute(); },
          execute() {
            const info = native.prepare(sql).run(...values);
            return { success: true, results: [], meta: { changes: Number(info.changes) } };
          },
        };
      }
      return statement();
    },
    async batch(statements) {
      native.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map((statement) => statement.execute()); native.exec('COMMIT'); return result;
      } catch (error) { native.exec('ROLLBACK'); throw error; }
    },
  };
  const objects = new Map();
  let putHook = null;
  const storage = {
    async put(key, value) {
      await Promise.resolve();
      objects.set(key, new Uint8Array(value));
      if (putHook) await putHook(key);
      return {};
    },
    async delete(key) { objects.delete(key); },
  };
  return { db, native, objects, storage, onPut: (hook) => { putHook = hook; } };
}
function expectError(promise, status, code) {
  return assert.rejects(promise, (error) => error.status === status && (!code || error.code === code));
}

test('an admitted account edits its own profile without receiving organization permissions', async (t) => {
  const f = fixture(t);
  const initial = await getOwnProfile(f.db, user, false);
  assert.deepEqual(initial, { profile: { displayName: 'Pessoa', email: user.email, avatarUrl: null, version: 1 }, hasPassword: false });
  const updated = await updateOwnProfile(f.db, user, { displayName: 'Yan de Exemplo', expectedVersion: 1 }, true);
  assert.equal(updated.profile.displayName, 'Yan de Exemplo');
  assert.equal(updated.profile.version, 2);
  assert.equal(updated.hasPassword, true);
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM members').get().n, 0);
  assert.equal(JSON.stringify(updated).includes('avatar_key'), false);
});

test('profile input rejects changes to email, role, status and another user identifier', async (t) => {
  const f = fixture(t);
  for (const extra of [{ email: 'other@example.test' }, { role: 'owner' }, { status: 'active' }, { userId: 'other' }]) {
    await expectError(updateOwnProfile(f.db, user, { displayName: 'Novo nome', expectedVersion: 1, ...extra }, false), 400, 'immutable_profile_fields');
  }
  assert.equal(f.native.prepare('SELECT email FROM portal_users').get().email, user.email);
});

test('name validation and compare-and-swap prevent invalid names or lost updates', async (t) => {
  const f = fixture(t);
  await getOwnProfile(f.db, user, false);
  for (const name of ['', ' ', 'a'.repeat(81), 'Nome\nOculto', 'Nome\u0000']) {
    await expectError(updateOwnProfile(f.db, user, { displayName: name, expectedVersion: 1 }, false), 400, 'invalid_name');
  }
  const results = await Promise.allSettled([
    updateOwnProfile(f.db, user, { displayName: 'Sessão A', expectedVersion: 1 }, false),
    updateOwnProfile(f.db, user, { displayName: 'Sessão B', expectedVersion: 1 }, false),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'profile_conflict');
  assert.equal(f.native.prepare('SELECT version FROM profiles').get().version, 2);
  assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='profile.update'").get().n, 1);
});

test('an unadmitted or blocked account cannot create or change a profile', async (t) => {
  const f = fixture(t);
  await expectError(getOwnProfile(f.db, null, false), 401);
  await expectError(getOwnProfile(f.db, { ...user, userId: 'missing' }, false), 403, 'account_inactive');
  f.native.prepare("UPDATE portal_users SET status='blocked'").run();
  await expectError(updateOwnProfile(f.db, user, { displayName: 'Bloqueado', expectedVersion: 1 }, false), 403, 'account_inactive');
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM profiles').get().n, 0);
});

test('matching e-mail text never merges profile identities', async (t) => {
  const f = fixture(t);
  const now = new Date().toISOString();
  f.native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run('different-user', user.email, 'active', now, now);
  const other = { ...user, userId: 'different-user', displayName: 'Outra pessoa' };
  await getOwnProfile(f.db, other, false);
  await updateOwnProfile(f.db, user, { displayName: 'Nome próprio', expectedVersion: 1 }, false);
  assert.equal((await getOwnProfile(f.db, other, false)).profile.displayName, 'Outra pessoa');
});

test('PNG validation checks signature, byte limit and IHDR before decoding pixels', () => {
  assert.throws(() => normalizeAvatarPng(new Uint8Array(Buffer.from('<svg></svg>'))), { status: 415 });
  assert.throws(() => normalizeAvatarPng(new Uint8Array(MAX_AVATAR_BYTES + 1)), { status: 413 });
  const oversized = new Uint8Array(png());
  new DataView(oversized.buffer).setUint32(16, 100000);
  assert.throws(() => normalizeAvatarPng(oversized), { status: 400, code: 'avatar_dimensions' });
  const corrupted = new Uint8Array(png());
  corrupted[corrupted.length - 10] ^= 0xff;
  assert.throws(() => normalizeAvatarPng(corrupted), { status: 415 });
  const prepared = normalizeAvatarPng(new Uint8Array(png(32, 18)));
  const decoded = PNG.sync.read(Buffer.from(prepared));
  assert.equal(decoded.width, 32); assert.equal(decoded.height, 18);
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
test('server re-encoding removes ancillary identifying metadata', () => {
  const original = png();
  const text = Buffer.from('Author\0private-person@example.test');
  const chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length, 0); chunk.write('tEXt', 4); text.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const withMetadata = Buffer.concat([original.subarray(0, 33), chunk, original.subarray(33)]);
  const normalized = Buffer.from(normalizeAvatarPng(new Uint8Array(withMetadata)));
  assert.equal(normalized.includes(Buffer.from('private-person@example.test')), false);
  const types = [];
  for (let offset = 8; offset < normalized.length;) {
    types.push(normalized.toString('ascii', offset + 4, offset + 8)); offset += normalized.readUInt32BE(offset) + 12;
  }
  assert.equal(types.includes('tEXt'), false);
});

test('avatar upload exposes only a private self URL and cleans the previous object', async (t) => {
  const f = fixture(t);
  await getOwnProfile(f.db, user, false);
  const first = await replaceOwnAvatar(f.db, f.storage, user, new Uint8Array(png()), 1, false);
  assert.match(first.profile.avatarUrl, /^\/api\/profile\/avatar\/canonical-user\?v=2$/);
  const old = await getOwnAvatar(f.db, user, user.userId);
  assert.equal(f.objects.has(old.key), true);
  const second = await replaceOwnAvatar(f.db, f.storage, user, new Uint8Array(png(3, 3, 90)), 2, false);
  assert.equal(second.profile.version, 3);
  assert.equal(f.objects.has(old.key), false);
  assert.equal(f.objects.size, 1);
  assert.equal(JSON.stringify(second).includes('avatars/'), false);
  await expectError(getOwnAvatar(f.db, user, 'another-user'), 404, 'avatar_not_found');
});

test('concurrent avatar writes keep one version and compensate the losing object', async (t) => {
  const f = fixture(t);
  await getOwnProfile(f.db, user, false);
  const results = await Promise.allSettled([
    replaceOwnAvatar(f.db, f.storage, user, new Uint8Array(png()), 1, false),
    replaceOwnAvatar(f.db, f.storage, user, new Uint8Array(png(3, 2)), 1, false),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'profile_conflict');
  assert.equal(f.objects.size, 1);
  const stored = await getOwnAvatar(f.db, user, user.userId);
  assert.equal(f.objects.has(stored.key), true);
  assert.equal(stored.version, 2);
});

test('failed audit rolls back avatar update and deletes its unreferenced object', async (t) => {
  const f = fixture(t);
  await getOwnProfile(f.db, user, false);
  f.native.exec(`CREATE TRIGGER profile_audit_failure BEFORE INSERT ON audit WHEN NEW.action='profile.avatar'
    BEGIN SELECT RAISE(ABORT,'profile_audit_failure'); END`);
  await assert.rejects(replaceOwnAvatar(f.db, f.storage, user, new Uint8Array(png()), 1, false), /profile_audit_failure/);
  assert.equal(f.objects.size, 0);
  const profile = (await getOwnProfile(f.db, user, false)).profile;
  assert.equal(profile.version, 1); assert.equal(profile.avatarUrl, null);
});

test('a lost database response cannot delete an avatar already committed by SQL', async (t) => {
  const f = fixture(t);
  await getOwnProfile(f.db, user, false);
  const originalBatch = f.db.batch.bind(f.db);
  f.db.batch = async (statements) => {
    await originalBatch(statements);
    throw new Error('simulated_response_lost_after_commit');
  };
  const response = await replaceOwnAvatar(f.db, f.storage, user, new Uint8Array(png()), 1, false);
  const stored = await getOwnAvatar(f.db, user, user.userId);
  assert.equal(response.profile.version, 2);
  assert.equal(f.objects.has(stored.key), true);
  assert.equal(f.objects.size, 1);
});

test('account blocking during object upload denies commit and compensates storage', async (t) => {
  const f = fixture(t);
  await getOwnProfile(f.db, user, false);
  f.onPut(() => { f.native.prepare("UPDATE portal_users SET status='blocked'").run(); });
  await expectError(replaceOwnAvatar(f.db, f.storage, user, new Uint8Array(png()), 1, false), 403, 'account_inactive');
  assert.equal(f.objects.size, 0);
  assert.equal(f.native.prepare('SELECT version FROM profiles').get().version, 1);
});

test('profile mutations require same-origin action requests and the correct media type', () => {
  const make = (headers) => new Request('https://portal.example.test/api/profile', { method: 'PUT', headers });
  assert.throws(() => requireProfileMutation(make({ 'Content-Type': 'application/json' }), 'json'), { status: 403 });
  assert.throws(() => requireProfileMutation(make({ Origin: 'https://other.example.test', 'X-Proex-Action': '1', 'Content-Type': 'application/json' }), 'json'), { status: 403 });
  const headers = { Origin: 'https://portal.example.test', 'X-Proex-Action': '1', 'Content-Type': 'application/json' };
  assert.doesNotThrow(() => requireProfileMutation(make(headers), 'json'));
  assert.throws(() => requireProfileMutation(make(headers), 'form'), { status: 415 });
});

test('multipart parsing rejects extra identity fields and accepts one prepared image/version', async () => {
  const request = (extra) => {
    const form = new FormData(); form.set('file', new Blob([png()], { type: 'image/png' }), 'avatar.png');
    form.set('expectedVersion', '1'); if (extra) form.set('role', 'owner');
    return new Request('https://portal.example.test/api/profile', { method: 'POST', body: form });
  };
  const accepted = await readAvatarForm(request(false));
  assert.equal(accepted.expectedVersion, 1); assert.ok(accepted.bytes.length > 33);
  await expectError(readAvatarForm(request(true)), 400, 'immutable_profile_fields');
});

test('multipart streaming limit applies without Content-Length', async () => {
  const request = new Request('https://portal.example.test/api/profile', {
    method: 'POST', duplex: 'half', headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_AVATAR_BYTES + 64 * 1024 + 1)); controller.close(); } }),
  });
  await expectError(readAvatarForm(request), 413, 'avatar_too_large');
});
