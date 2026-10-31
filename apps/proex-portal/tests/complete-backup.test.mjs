import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import ts from 'typescript';
import { BACKUP_LIMITS, BackupError, createArchive, decryptArchive, encryptArchive, sha256, validateArchive } from '../platform-node/backup-format.mjs';
import { readEncryptedBackup, rejectConfiguredRuntime, restoreDestination, restoreEncryptedBackup, RESTORE_PREFIX } from '../platform-node/backup-restore.mjs';
import { backupFixture, migrations } from './support/backup-fixture.mjs';

const password = 'Synthetic recovery phrase 2026!';
const base = realpathSync(tmpdir()), temporary = mkdtempSync(join(base, 'proex-backup-tests-')), restored = [];
after(() => { for (const folder of [...restored, temporary]) if (dirname(folder) === base && /^(proex-backup-tests-|proex-isolated-restore-)/.test(folder.slice(base.length + 1))) rmSync(folder, { recursive: true, force: true }); });
writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
symlinkSync(new URL('../node_modules/', import.meta.url), join(temporary, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
for (const name of ['store', 'backup-service']) {
  const source = ts.transpileModule(readFileSync(new URL(`../platform-node/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeFileSync(join(temporary, `${name}.js`), source);
}
writeFileSync(join(temporary, 'backup-format.mjs'), readFileSync(new URL('../platform-node/backup-format.mjs', import.meta.url)));
const { fileStores } = await import(pathToFileURL(join(temporary, 'store.js')).href);
const { completeBackupService } = await import(pathToFileURL(join(temporary, 'backup-service.js')).href);
const artifact = fixture => createArchive(fixture.capture(), { migrations, ownerId: fixture.actor.userId, codeRevision: 'a'.repeat(40) });
function rewriteManifest(bytes, edit) { const length = bytes.readUInt32BE(0), manifest = JSON.parse(bytes.subarray(4, 4 + length)); edit(manifest); const text = Buffer.from(JSON.stringify(manifest)), size = Buffer.alloc(4); size.writeUInt32BE(text.length); return Buffer.concat([size, text, bytes.subarray(4 + length)]); }

test('authenticated encrypted backup roundtrips full SQLite identity state and all objects including orphans', async () => {
  const f = backupFixture(); let clear;
  try {
    const source = artifact(f), a = await encryptArchive(source.bytes, password), b = await encryptArchive(source.bytes, password);
    assert.notDeepEqual(a, b, 'fresh nonce and salt prevent deterministic files');
    assert.equal(a.includes(Buffer.from('synthetic-only-private-state')), false);
    clear = await decryptArchive(a, password); const parsed = validateArchive(clear, { migrations });
    assert.equal(parsed.objects.length, 4); assert.equal(parsed.manifest.sqlite.references, 3);
    assert.equal(parsed.manifest.source.snapshotVersion, 7); assert.ok(parsed.manifest.sqlite.migrations.every(item => /^[a-f0-9]{64}$/.test(item.sha256)));
    const raw = gunzipSync(parsed.snapshot), db = new DatabaseSync(':memory:'); db.deserialize(raw);
    try { assert.equal(db.prepare('SELECT secret FROM backup_test_private').get().secret, 'synthetic-only-private-state'); assert.equal(db.prepare('SELECT COUNT(*) n FROM members').get().n, 1); }
    finally { db.close(); raw.fill(0); }
    for (const object of parsed.objects) assert.equal(sha256(object.data), sha256(f.objects.find(item => item.key === object.key).data));
  } finally { clear?.fill(0); f.close(); }
});

test('wrong phrase, changed ciphertext/tag/header, truncation and hostile KDF parameters fail closed', async () => {
  const f = backupFixture();
  try {
    const encrypted = await encryptArchive(artifact(f).bytes, password);
    await assert.rejects(decryptArchive(encrypted, 'Another synthetic phrase 2026!'), error => error instanceof BackupError && error.code === 'backup_authentication');
    for (const offset of [encrypted.length - 1, encrypted.length - 25, 20]) { const changed = Buffer.from(encrypted); changed[offset] ^= 1; await assert.rejects(decryptArchive(changed, password), BackupError); }
    await assert.rejects(decryptArchive(encrypted.subarray(0, -16), password), BackupError);
    const headerLength = encrypted.readUInt32BE(8), header = JSON.parse(encrypted.subarray(12, 12 + headerLength)); header.N = 1073741824;
    const data = Buffer.from(JSON.stringify(header)), length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    await assert.rejects(decryptArchive(Buffer.concat([encrypted.subarray(0, 8), length, data, encrypted.subarray(12 + headerLength)]), password), error => error.code === 'backup_invalid');
  } finally { f.close(); }
});

test('internal hashes, traversal, duplicate objects, migrations and missing attachments are checked after decryption', async () => {
  const f = backupFixture();
  try {
    const source = artifact(f).bytes;
    assert.equal(validateArchive(source, { migrations: migrations.map(item => ({ ...item, sql: item.sql.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') })) }).objects.length, 4, 'Windows and Linux checkout line endings preserve migration identity');
    const changed = Buffer.from(source); changed[changed.length - 1] ^= 1;
    assert.throws(() => validateArchive(changed, { migrations }), /inventário/);
    assert.throws(() => validateArchive(rewriteManifest(source, m => { m.objects[0].storageId = '../outside'; }), { migrations }), BackupError);
    assert.throws(() => validateArchive(source, { migrations: migrations.map((item, index) => index ? item : { ...item, sql: item.sql + '\n-- modified' }) }), BackupError);
    const capture = f.capture(); capture.objects = capture.objects.filter(object => object.key !== f.objects[0].key);
    assert.throws(() => createArchive(capture, { migrations }), error => error.code === 'backup_objects');
    const duplicate = f.capture(); duplicate.objects.push(duplicate.objects[0]); assert.throws(() => createArchive(duplicate, { migrations }), BackupError);
    const badFile = f.capture(); badFile.objects[0].data = Buffer.from('wrong file, same or different size'); assert.throws(() => createArchive(badFile, { migrations }), BackupError);
  } finally { f.close(); }
});

test('SQLite corruption, foreign-key violations, zip bombs and size/count limits never yield a backup', () => {
  const f = backupFixture();
  try {
    const bad = f.capture(); bad.snapshot.data = gzipSync(Buffer.from('not SQLite')); assert.throws(() => createArchive(bad, { migrations }), BackupError);
    f.native.exec('PRAGMA foreign_keys=OFF'); f.native.prepare("INSERT INTO project_calls(call_id,project_id) VALUES('missing-call','project-fixture')").run();
    assert.throws(() => artifact(f), error => error.code === 'backup_sqlite');
    const bomb = f.capture(); bomb.snapshot.data = gzipSync(Buffer.alloc(BACKUP_LIMITS.sqliteBytes + 1)); assert.throws(() => createArchive(bomb), BackupError);
    const many = f.capture(); many.objects = Array(BACKUP_LIMITS.objects + 1).fill(f.objects[0]); assert.throws(() => createArchive(many), BackupError);
  } finally { f.close(); }
});

test('capture authority and post-encryption revocation reject project roles, blocked and revoked accounts', async () => {
  for (const update of ["UPDATE members SET role='manager',project_id='project-fixture'", "UPDATE members SET revoked_at='2026-10-31'", "UPDATE portal_users SET status='blocked'", 'UPDATE portal_users SET activation_pending=1']) {
    const f = backupFixture(); f.native.exec(update); let captures = 0;
    try { const service = completeBackupService({ backup: { authoritySnapshot: async () => f.snapshot(), capture: async () => { captures++; return f.capture(); } } }, migrations);
      await assert.rejects(service.createEncrypted(f.actor.userId, password), error => error.code === 'backup_forbidden'); assert.equal(captures, 0);
    } finally { f.close(); }
  }
  const f = backupFixture();
  try { const service = completeBackupService({ backup: { authoritySnapshot: async () => f.snapshot(), capture: async () => { const captured = f.capture(); f.native.exec("UPDATE members SET revoked_at='2026-10-31'"); return captured; } } }, migrations);
    await assert.rejects(service.createEncrypted(f.actor.userId, password), error => error.code === 'backup_forbidden');
  } finally { f.close(); }
});

test('organization owners cannot capture the platform, including demotion during capture', async () => {
  for (const duringCapture of [false, true]) {
    const f = backupFixture(); f.native.exec('ALTER TABLE members ADD COLUMN organization_id TEXT'); let captures = 0;
    if (!duringCapture) f.native.exec("UPDATE members SET organization_id='synthetic-org'");
    try {
      const service = completeBackupService({ backup: { authoritySnapshot: async () => f.snapshot(), capture: async () => { captures++; const captured = f.capture(); f.native.exec("UPDATE members SET organization_id='synthetic-org'"); return captured; } } }, migrations);
      await assert.rejects(service.createEncrypted(f.actor.userId, password), error => error.code === 'backup_forbidden');
      assert.equal(captures, duringCapture ? 1 : 0);
    } finally { f.close(); }
  }
});

test('restore dry-run writes nothing, and successful restore is new, isolated, usable and complete', async () => {
  const f = backupFixture(); const destination = join(base, RESTORE_PREFIX + 'synthetic-' + Date.now()); restored.push(destination);
  try {
    const encrypted = await encryptArchive(artifact(f).bytes, password);
    const report = await restoreEncryptedBackup(encrypted, password, { dryRun: true, destination, migrations });
    assert.equal(report.verified, true); assert.equal(report.objects, 4); assert.equal(existsSync(destination), false);
    const saved = await restoreEncryptedBackup(encrypted, password, { destination, migrations });
    assert.equal(saved.directory, destination); assert.equal(JSON.parse(readFileSync(join(destination, 'ISOLATED-RESTORE.json'))).ready, true);
    const disk = fileStores(join(destination, 'data'));
    for (const object of f.objects) { const found = await disk.objects.get(object.key); assert.equal(sha256(found.data), sha256(object.data)); }
    const reexport = await disk.backup.capture(BACKUP_LIMITS); assert.equal(reexport.objects.length, 4); assert.ok(reexport.objects.every(object => object.key === null));
    assert.equal(validateArchive(createArchive(reexport, { migrations }).bytes, { migrations }).objects.length, 4);
    await assert.rejects(restoreEncryptedBackup(encrypted, password, { destination, migrations }), error => error.code === 'backup_destination');
  } finally { f.close(); }
});

test('restore refuses remote/production targets, symlinks, existing destinations and configured provider runtimes', () => {
  for (const destination of ['https://production.invalid/restore', 'postgresql://production.invalid/db', resolve('production'), join(base, 'production'), temporary, '\\\\server\\share\\restore']) assert.throws(() => restoreDestination(destination));
  for (const environment of [{ PROEX_DATABASE_URL: 'DO-NOT-READ' }, { PROEX_DATA_DIR: 'production' }, { VERCEL: '1' }]) assert.throws(() => rejectConfiguredRuntime(environment));
  assert.doesNotThrow(() => rejectConfiguredRuntime({ PATH: '' }));
  const link = join(base, RESTORE_PREFIX + 'symlink-' + Date.now()); restored.push(link); symlinkSync(temporary, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => restoreDestination(link));
  assert.throws(() => readEncryptedBackup('https://production.invalid/file.proexbackup'));
});

test('local disk capture includes opaque orphan files and bounds bytes before reading data', async () => {
  const f = backupFixture(), directory = join(temporary, 'disk');
  try { const disk = fileStores(directory); await disk.snapshots.commit(0, f.snapshot().data); for (const object of f.objects) await disk.objects.put(object.key, object.data, object.contentType);
    const capture = await disk.backup.capture(BACKUP_LIMITS); assert.equal(capture.objects.length, 4); assert.ok(capture.objects.every(object => object.key === null));
    await assert.rejects(disk.backup.authoritySnapshot({ ...BACKUP_LIMITS, totalBytes: 1 }), error => error.code === 'backup_limit');
    await assert.rejects(disk.backup.capture({ ...BACKUP_LIMITS, totalBytes: 1 }), error => error.code === 'backup_limit');
    writeFileSync(join(directory, 'objects', 'unexpected.tmp'), 'synthetic'); await assert.rejects(disk.backup.capture(BACKUP_LIMITS), error => error.code === 'backup_source');
  } finally { f.close(); }
});

test('offline CLIs use stdin, emit no phrase, create only encrypted output and dry-run independently', () => {
  const f = backupFixture(), source = join(temporary, 'cli-data'), output = join(temporary, 'cli.proexbackup'); mkdirSync(source); mkdirSync(join(source, 'objects'));
  writeFileSync(join(source, 'version'), '7'); writeFileSync(join(source, 'portal.sqlite.gz'), f.snapshot().data);
  for (const object of f.objects) { writeFileSync(join(source, 'objects', object.storageId), object.data); writeFileSync(join(source, 'objects', object.storageId + '.type'), object.contentType); }
  const environment = Object.fromEntries(['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const run = (script, args) => spawnSync(process.execPath, [fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), ...args], { input: password + '\n', encoding: 'utf8', env: environment, windowsHide: true });
  try {
    const created = run('create-backup.mjs', ['--local-data', source, '--output', output]); assert.equal(created.status, 0, created.stderr); assert.equal(created.stdout.includes(password), false); assert.equal(created.stderr.includes(password), false);
    assert.equal(JSON.parse(created.stdout).encrypted, true); assert.deepEqual(readdirSync(source).sort(), ['objects', 'portal.sqlite.gz', 'version']);
    const dry = run('restore-backup.mjs', ['--input', output, '--dry-run']); assert.equal(dry.status, 0, dry.stderr); assert.equal(JSON.parse(dry.stdout).verified, true); assert.equal(dry.stdout.includes(password), false);
    const rejected = run('restore-backup.mjs', ['--input', output, '--password', password]); assert.notEqual(rejected.status, 0); assert.equal(rejected.stderr.includes(password), false);
    const overwrite = run('create-backup.mjs', ['--local-data', source, '--output', output]); assert.notEqual(overwrite.status, 0);
  } finally { f.close(); }
});

test('Postgres capture keeps all reads in one read-only repeatable-read transaction and preflights bounds', async () => {
  const f = backupFixture(), queries = []; let rejectLarge = false, concurrentWrite = false;
  const live = f.capture();
  globalThis.__backupPostgres = () => {
    const sql = (value, ...parameters) => {
      if (typeof value === 'string') return { identifier: value };
      const query = value.join('?');
      if (query.includes('CASE WHEN octet_length(data)')) return Promise.resolve([{ version: String(live.snapshot.version), bytes: live.snapshot.data.byteLength, data: live.snapshot.data.byteLength <= parameters[0] ? live.snapshot.data : null }]);
      throw new Error('capture query escaped its transaction');
    };
    sql.begin = async (options, task) => {
      assert.equal(options, 'isolation level repeatable read read only');
      const view = structuredClone(live);
      const tx = async strings => {
        const query = strings.join('?'); queries.push(query);
        if (query.startsWith('set local')) return [];
        if (query.includes('count(*)')) {
          live.snapshot.version = 8; live.objects[0].data = Buffer.from('concurrent replacement'); concurrentWrite = true;
          return [{ count: rejectLarge ? '10001' : String(view.objects.length), bytes: String(view.objects.reduce((sum, object) => sum + object.data.byteLength, 0)), largest: Math.max(...view.objects.map(object => object.data.byteLength)) }];
        }
        if (query.includes('select octet_length')) return [{ bytes: view.snapshot.data.byteLength }];
        if (query.includes('select version,data')) return [{ version: String(view.snapshot.version), data: view.snapshot.data }];
        if (query.includes('select key,content_type')) return view.objects.map(object => ({ key: object.key, content_type: object.contentType, size: object.data.byteLength, data: object.data }));
        throw new Error('unexpected synthetic query');
      };
      return task(tx);
    };
    return sql;
  };
  const mocked = readFileSync(join(temporary, 'store.js'), 'utf8').replace(/import postgres from ['"]postgres['"];?/, 'const postgres = globalThis.__backupPostgres;');
  writeFileSync(join(temporary, 'store-mocked.js'), mocked);
  try {
    const { postgresStores } = await import(pathToFileURL(join(temporary, 'store-mocked.js')).href);
    const stores = postgresStores('synthetic-url'), captured = await stores.backup.capture(BACKUP_LIMITS);
    assert.equal(concurrentWrite, true); assert.equal(captured.snapshot.version, 7);
    assert.equal(sha256(captured.objects[0].data), sha256(f.objects[0].data));
    assert.equal(validateArchive(createArchive(captured, { migrations }).bytes, { migrations }).objects.length, 4);
    rejectLarge = true; queries.length = 0;
    await assert.rejects(stores.backup.capture(BACKUP_LIMITS), error => error.code === 'backup_limit');
    assert.equal(queries.some(query => query.includes('select version,data') || query.includes('select key,content_type')), false, 'oversized source is rejected before loading private bytes');
    assert.equal((await stores.backup.authoritySnapshot(BACKUP_LIMITS)).version, 8, 'authority uses the current committed snapshot, not the captured version');
    await assert.rejects(stores.backup.authoritySnapshot({ ...BACKUP_LIMITS, totalBytes: 1 }), error => error.code === 'backup_limit');
  } finally { f.close(); delete globalThis.__backupPostgres; }
});
