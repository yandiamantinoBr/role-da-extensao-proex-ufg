import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Real services and migrations over SQLite; only the D1 transport is adapted.
const temporary = mkdtempSync(join(tmpdir(), 'proex-sync-tokens-'));
writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
after(() => rmSync(temporary, { recursive: true, force: true }));
for (const name of ['access', 'errors', 'database', 'mutations', 'sync/contracts', 'sync/tokens']) {
  const output = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from '(\.\.?\/[^']+)'/g, (_, file) => `from '${file}.js'`);
  mkdirSync(dirname(join(temporary, `${name}.js`)), { recursive: true });
  writeFileSync(join(temporary, `${name}.js`), output);
}
const { createSyncToken, listSyncTokens, revokeSyncToken, actorFromSyncToken } = await import(pathToFileURL(join(temporary, 'sync/tokens.js')).href);

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  const prepare = (sql, parameters = []) => ({
    bind: (...values) => prepare(sql, values),
    first: async () => sqlite.prepare(sql).get(...parameters) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...parameters) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...parameters).changes) } }),
    execute: () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...parameters).changes) } }),
  });
  const db = { prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const r = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  const person = (id, role) => {
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES(?,?,'active',0,?,?)").run(id, `${id}@example.test`, now, now);
    sqlite.prepare('INSERT INTO profiles(user_id,display_name,version,created_at,updated_at) VALUES(?,?,1,?,?)').run(id, id, now, now);
    if (role) sqlite.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,NULL,NULL,?)').run(crypto.randomUUID(), id, `${id}@example.test`, role, now);
    return { userId: id, email: `${id}@example.test`, displayName: id, members: [], capabilities: [] };
  };
  return { sqlite, db, person };
}
const rejects = (promise, status) => assert.rejects(promise, error => error.status === status);

test('only an active global owner creates sync keys, and only the hash is stored', async t => {
  const f = fixture(t), owner = f.person('owner', 'owner'), manager = f.person('manager', 'manager');
  await rejects(createSyncToken(f.db, manager, {}), 403);
  const created = await createSyncToken(f.db, owner, { label: 'Planilha da PROEX' });
  assert.match(created.token, /^pxs_[A-Za-z0-9_-]{43}$/);
  const stored = f.sqlite.prepare('SELECT * FROM sync_tokens').get();
  assert.notEqual(stored.token_hash, created.token);
  assert.equal(JSON.stringify(await listSyncTokens(f.db, owner)).includes(created.token), false);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE action='sync.token.create'").get().n, 1);
});

test('a key acts as its creator only while that person remains an active owner', async t => {
  const f = fixture(t), owner = f.person('owner', 'owner');
  const { token, id } = await createSyncToken(f.db, owner, {});
  const actor = await actorFromSyncToken(f.db, `Bearer ${token}`);
  assert.equal(actor.userId, 'owner');
  assert.ok(f.sqlite.prepare('SELECT last_used_at FROM sync_tokens WHERE id=?').get(id).last_used_at);
  await rejects(actorFromSyncToken(f.db, null), 401);
  await rejects(actorFromSyncToken(f.db, `Bearer ${token.slice(0, -1)}A`), 401);
  await rejects(actorFromSyncToken(f.db, token), 401);
  f.sqlite.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner'").run(new Date().toISOString());
  await rejects(actorFromSyncToken(f.db, `Bearer ${token}`), 403);
  f.sqlite.prepare("UPDATE members SET revoked_at=NULL WHERE user_id='owner'").run();
  f.sqlite.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='owner'").run();
  await rejects(actorFromSyncToken(f.db, `Bearer ${token}`), 401);
});

test('revoked and expired keys stop immediately; active keys are limited', async t => {
  const f = fixture(t), owner = f.person('owner', 'owner');
  const first = await createSyncToken(f.db, owner, {});
  await revokeSyncToken(f.db, owner, { id: first.id });
  await rejects(actorFromSyncToken(f.db, `Bearer ${first.token}`), 401);
  await rejects(revokeSyncToken(f.db, owner, { id: first.id }), 404);
  const second = await createSyncToken(f.db, owner, {});
  f.sqlite.prepare('UPDATE sync_tokens SET expires_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), second.id);
  await rejects(actorFromSyncToken(f.db, `Bearer ${second.token}`), 401);
  for (let i = 0; i < 5; i++) await createSyncToken(f.db, owner, {});
  await rejects(createSyncToken(f.db, owner, {}), 409);
});
