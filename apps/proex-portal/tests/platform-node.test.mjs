import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Exercises the Node/Vercel D1 adapter over the real disk store: atomic batches,
// D1 result shapes and compare-and-set between two instances of the portal.
const temporary = mkdtempSync(join(tmpdir(), 'proex-platform-node-'));
writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
symlinkSync(new URL('../node_modules/', import.meta.url), join(temporary, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
const opened = [];
after(() => { for (const db of opened) db.close(); try { rmSync(temporary, { recursive: true, force: true }); } catch { /* Windows mantém o arquivo por instantes */ } });
for (const name of ['d1', 'store']) {
  const output = ts.transpileModule(readFileSync(new URL(`../platform-node/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from '(\.\/[^']+)'/g, (_, file) => `from '${file}.js'`);
  writeFileSync(join(temporary, `${name}.js`), output);
}
const { SnapshotD1 } = await import(pathToFileURL(join(temporary, 'd1.js')).href);
const { fileStores } = await import(pathToFileURL(join(temporary, 'store.js')).href);
const migrations = [{ name: '0000_test.sql', sql: 'CREATE TABLE notes(id TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);' }];
let counter = 0;
function instances(count, dir = join(temporary, `store-${counter++}`)) {
  mkdirSync(dir, { recursive: true });
  const { snapshots } = fileStores(dir);
  const created = Array.from({ length: count }, () => new SnapshotD1(snapshots, migrations, join(dir, `instance-${counter++}.sqlite`), 60_000));
  opened.push(...created);
  return Object.assign(created, { dir });
}

test('D1 result shapes, first(column) and changes() inside one atomic batch', async () => {
  const [db] = instances(1);
  const [insert] = await db.batch([db.prepare('INSERT INTO notes(id,body) VALUES(?,?)').bind('a', 'Olá')]);
  assert.equal(insert.meta.changes, 1);
  assert.equal(await db.prepare('SELECT body FROM notes WHERE id=?').bind('a').first('body'), 'Olá');
  assert.deepEqual((await db.prepare('SELECT id FROM notes').all()).results, [{ id: 'a' }]);
  assert.deepEqual(await db.prepare('SELECT id,body FROM notes').raw(), [['a', 'Olá']]);
  const results = await db.batch([
    db.prepare("UPDATE notes SET version=version+1 WHERE id='a' AND version=1"),
    db.prepare("SELECT CASE WHEN changes()>0 THEN 1 ELSE json_extract('[]','conflict_code') END AS ok"),
  ]);
  assert.equal(results[1].results[0].ok, 1);
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO notes(id,body) VALUES('b','x')"),
    db.prepare("UPDATE notes SET version=version+1 WHERE id='a' AND version=1"),
    db.prepare("SELECT CASE WHEN changes()>0 THEN 1 ELSE json_extract('[]','conflict_code') END"),
  ]), /conflict_code/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM notes WHERE id='b'").first('n'), 0, 'failed batch rolls back entirely');
  await assert.rejects(db.prepare('SELECT ?').bind(undefined).all(), /D1_TYPE_ERROR/);
});

test('a stale instance never overwrites another instance: it reloads and re-runs the batch', async () => {
  const pair = instances(2), [a, b] = pair;
  await a.prepare("INSERT INTO notes(id,body) VALUES('shared','v1')").run();
  assert.equal(await b.prepare("SELECT body FROM notes WHERE id='shared'").first('body'), 'v1');
  // Both instances now hold version N. A writes first; B's optimistic commit must fail and retry.
  await a.prepare("UPDATE notes SET body='from-a', version=version+1 WHERE id='shared' AND version=1").run();
  const result = await b.prepare("UPDATE notes SET body='from-b', version=version+1 WHERE id='shared' AND version=1").run();
  assert.equal(result.meta.changes, 0, 'B re-evaluated its CAS guard on the latest data');
  await b.prepare("INSERT INTO notes(id,body) VALUES('only-b','x')").run();
  const [fresh] = instances(1, pair.dir);
  assert.deepEqual((await fresh.prepare('SELECT id,body FROM notes ORDER BY id').all()).results, [{ id: 'only-b', body: 'x' }, { id: 'shared', body: 'from-a' }]);
});

test('migrations are applied once and recorded like wrangler', async () => {
  const [a, b] = instances(2);
  await a.prepare('SELECT 1').all();
  await b.prepare('SELECT 1').all();
  assert.deepEqual((await b.prepare('SELECT name FROM d1_migrations').all()).results, [{ name: '0000_test.sql' }]);
});

function unreliableInstance() {
  const dir = join(temporary, `unreliable-${counter++}`);
  const { snapshots } = fileStores(dir);
  let failure = null;
  const store = {
    version: () => snapshots.version(), load: () => snapshots.load(),
    async commit(expected, data) {
      const fail = failure; failure = null;
      if (fail === 'before') throw new Error('synthetic failure before remote commit');
      const result = await snapshots.commit(expected, data);
      if (fail === 'after') throw new Error('synthetic reply lost after remote commit');
      return result;
    },
  };
  const db = new SnapshotD1(store, migrations, join(dir, 'instance.sqlite'), 60_000);
  opened.push(db);
  return { db, dir, failNext(mode) { failure = mode; } };
}

test('a rejected remote commit never exposes or resurrects the local batch', async () => {
  const f = unreliableInstance(), { db } = f;
  await db.prepare('SELECT 1').all();
  f.failNext('before');
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO notes(id,body) VALUES('ghost-a','private fixture')"),
    db.prepare("INSERT INTO notes(id,body) VALUES('ghost-b','private fixture')"),
  ]), /before remote commit/);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM notes').first('n'), 0);
  await db.prepare("INSERT INTO notes(id,body) VALUES('persisted','confirmed')").run();
  const [fresh] = instances(1, f.dir);
  assert.deepEqual((await fresh.prepare('SELECT id FROM notes').all()).results, [{ id: 'persisted' }]);
});

test('a lost commit reply reloads the successful remote state before an idempotent retry', async () => {
  const { db, failNext } = unreliableInstance();
  await db.prepare('SELECT 1').all();
  failNext('after');
  await assert.rejects(db.prepare("INSERT INTO notes(id,body) VALUES('once','confirmed')").run(), /reply lost/);
  assert.equal(await db.prepare("SELECT body FROM notes WHERE id='once'").first('body'), 'confirmed');
  const replay = await db.prepare("INSERT INTO notes(id,body) VALUES('once','confirmed') ON CONFLICT(id) DO NOTHING").run();
  assert.equal(replay.meta.changes, 0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM notes').first('n'), 1);
});

test('failed migration persistence discards its uncertain local schema and recovers', async () => {
  for (const mode of ['before', 'after']) {
    const f = unreliableInstance(); f.failNext(mode);
    await assert.rejects(f.db.prepare('SELECT 1').all(), /synthetic/);
    assert.deepEqual((await f.db.prepare('SELECT name FROM d1_migrations').all()).results, [{ name: '0000_test.sql' }]);
    await f.db.prepare("INSERT INTO notes(id,body) VALUES('recovered','confirmed')").run();
    const [fresh] = instances(1, f.dir);
    assert.equal(await fresh.prepare('SELECT COUNT(*) AS n FROM notes').first('n'), 1);
  }
});
