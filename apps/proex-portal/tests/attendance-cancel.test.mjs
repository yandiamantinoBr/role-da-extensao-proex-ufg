import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

function moduleUrl(source) { return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`; }
function compile(name, dependencies = {}) {
  let source = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [dependency, url] of Object.entries(dependencies)) {
    source = source.replaceAll(`from './${dependency}'`, `from ${JSON.stringify(url)}`)
      .replaceAll(`from "./${dependency}"`, `from ${JSON.stringify(url)}`);
  }
  return moduleUrl(source);
}
const errors = compile('errors');
const database = compile('database');
const access = compile('access', { errors });
const cancellation = compile('attendance-cancel', { errors, database, access });
const campaigns = compile('campaigns', { database, errors, access });
const participation = compile('participation', { database, errors, access, campaigns });
const { getActor } = await import(access);
const { cancelAttendance } = await import(cancellation);
const { participationAction } = await import(participation);

async function fixture(t) {
  const native = new DatabaseSync(':memory:');
  t.after(() => native.close());
  native.exec('PRAGMA foreign_keys=ON');
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    native.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  const now = new Date().toISOString();
  native.prepare('INSERT INTO projects VALUES(?,?,?,?),(?,?,?,?)').run('role', 'Rolê', '', now, 'other', 'Outro', '', now);
  native.prepare('INSERT INTO members VALUES(?,?,?,?,?,?,?)')
    .run('operator-member', 'operator', 'operator@example.test', 'operator', 'role', null, now);
  native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('pin','role','Button','gift','un',10,?)").run(now);
  native.prepare("INSERT INTO offers VALUES('regular','role','Um button','brinde',1),('special','role','Três buttons','super',1)").run();
  native.exec("INSERT INTO offer_components VALUES('regular','pin',1),('special','pin',3)");
  native.prepare(`INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,retry_limit,
    brinde_offer_id,super_offer_id,rules_text,version,created_at)
    VALUES('event','role','Evento',?,?,'active',1,'regular','special','Regras fictícias',1,?)`)
    .run(new Date(Date.now() - 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString(), now);
  native.prepare(`INSERT INTO participations VALUES('participation','event','ticket:sample','ticket','physical',0,'ready',?)`).run(now);
  native.prepare(`INSERT INTO attempts VALUES('attempt','participation',1,'test-operation','pending','pending',?)`).run(now);
  native.exec(`INSERT INTO reservations VALUES
    ('regular-reservation','participation','attempt','regular','pin',1,'held'),
    ('special-reservation','participation','attempt','special','pin',3,'held')`);
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
        const result = statements.map((statement) => statement.execute());
        native.exec('COMMIT');
        return result;
      } catch (error) { native.exec('ROLLBACK'); throw error; }
    },
  };
  const actor = await getActor(db, { userId: 'operator', email: 'operator@example.test', displayName: 'Operador' });
  return { db, native, actor };
}
const input = { attemptId: 'attempt', reason: 'abandoned' };

test('cancellation releases both coverage reservations without consuming stock or inventing a result', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await cancelAttendance(f.db, f.actor, input), { cancelled: true });
  assert.deepEqual({ ...f.native.prepare('SELECT state,result FROM attempts').get() }, { state: 'cancelled', result: 'cancelled' });
  assert.equal(f.native.prepare('SELECT state FROM participations').get().state, 'cancelled');
  assert.deepEqual({ ...f.native.prepare('SELECT stock,reserved FROM items').get() }, { stock: 10, reserved: 0 });
  assert.equal(f.native.prepare("SELECT COUNT(*) n FROM reservations WHERE state='released'").get().n, 2);
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 0);
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM entitlements').get().n, 0);
  const audit = f.native.prepare("SELECT * FROM audit WHERE action='participation.cancel'").get();
  assert.equal(audit.actor_id, 'operator');
  assert.equal(audit.project_id, 'role');
  assert.deepEqual(JSON.parse(audit.details), { reason: 'abandoned' });
});

test('concurrent cancellation and replay release only once and preserve the first audit reason', async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([
    cancelAttendance(f.db, f.actor, input),
    cancelAttendance(f.db, f.actor, { ...input, reason: 'staff_error' }),
  ]);
  assert.deepEqual(results, [{ cancelled: true }, { cancelled: true }]);
  await cancelAttendance(f.db, f.actor, input);
  assert.equal(f.native.prepare('SELECT reserved FROM items').get().reserved, 0);
  const rows = f.native.prepare("SELECT * FROM audit WHERE action='participation.cancel'").all();
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].details), { reason: 'abandoned' });
});

test('another project operator cannot cancel or release inventory', async (t) => {
  const f = await fixture(t);
  f.native.prepare('INSERT INTO members VALUES(?,?,?,?,?,?,?)')
    .run('other-member', 'other-operator', 'other@example.test', 'operator', 'other', null, new Date().toISOString());
  const actor = await getActor(f.db, { userId: 'other-operator', email: 'other@example.test', displayName: 'Outro' });
  await assert.rejects(cancelAttendance(f.db, actor, input), { status: 403 });
  assert.equal(f.native.prepare('SELECT reserved FROM items').get().reserved, 4);
  assert.equal(f.native.prepare('SELECT state FROM attempts').get().state, 'pending');
});

test('a revoked in-flight actor snapshot cannot mutate the attendance', async (t) => {
  const f = await fixture(t);
  f.native.prepare('UPDATE members SET revoked_at=?').run(new Date().toISOString());
  await assert.rejects(cancelAttendance(f.db, f.actor, input), { status: 409, code: 'attendance_changed' });
  assert.equal(f.native.prepare('SELECT reserved FROM items').get().reserved, 4);
  assert.equal(f.native.prepare('SELECT state FROM attempts').get().state, 'pending');
});

test('completed results and their prizes cannot be cancelled or released', async (t) => {
  const f = await fixture(t);
  f.native.exec("UPDATE attempts SET state='done',result='super' WHERE id='attempt'");
  f.native.prepare("INSERT INTO entitlements(id,attempt_id,participation_id,offer_id,state,created_at) VALUES('prize','attempt','participation','special','reserved',?)")
    .run(new Date().toISOString());
  await assert.rejects(cancelAttendance(f.db, f.actor, input), { status: 409, code: 'attendance_not_pending' });
  assert.equal(f.native.prepare('SELECT state FROM attempts').get().state, 'done');
  assert.equal(f.native.prepare('SELECT state FROM entitlements').get().state, 'reserved');
  assert.equal(f.native.prepare('SELECT reserved FROM items').get().reserved, 4);
});

test('racing cancellation with a real physical result never releases an awarded prize', async (t) => {
  for (const cancelFirst of [true, false]) {
    const f = await fixture(t);
    const cancel = () => cancelAttendance(f.db, f.actor, input);
    const finalize = () => participationAction(f.db, f.actor, 'participation.physical', {
      attemptId: 'attempt', result: 'super',
    });
    const results = await Promise.allSettled(cancelFirst ? [cancel(), finalize()] : [finalize(), cancel()]);
    assert.ok(results.some((result) => result.status === 'fulfilled'));
    const attempt = f.native.prepare('SELECT state,result FROM attempts').get();
    const reserved = f.native.prepare('SELECT reserved FROM items').get().reserved;
    const prizes = f.native.prepare('SELECT COUNT(*) n FROM entitlements').get().n;
    if (attempt.state === 'cancelled') {
      assert.equal(attempt.result, 'cancelled');
      assert.equal(reserved, 0);
      assert.equal(prizes, 0);
    } else {
      assert.equal(attempt.state, 'done');
      assert.equal(attempt.result, 'super');
      assert.equal(reserved, 3);
      assert.equal(prizes, 1);
      await assert.rejects(cancel(), { status: 409 });
    }
  }
});

test('cancellation is terminal and does not restore another attempt', async (t) => {
  const f = await fixture(t);
  await cancelAttendance(f.db, f.actor, input);
  assert.throws(() => f.native.prepare(`INSERT INTO attempts VALUES('second','participation',2,'other-operation','pending','pending',?)`)
    .run(new Date().toISOString()), /participation_used/);
  assert.equal(f.native.prepare('SELECT attempt_count FROM participations').get().attempt_count, 1);
});

test('invalid reason and missing attendance cannot produce inventory changes', async (t) => {
  const f = await fixture(t);
  await assert.rejects(cancelAttendance(f.db, f.actor, { ...input, reason: 'free text with private data' }), { status: 400 });
  await assert.rejects(cancelAttendance(f.db, f.actor, { ...input, attemptId: 'missing' }), { status: 404 });
  assert.equal(f.native.prepare('SELECT reserved FROM items').get().reserved, 4);
});

test('a failing audit rolls back cancellation and all reservation releases', async (t) => {
  const f = await fixture(t);
  f.native.exec(`CREATE TRIGGER audit_failure BEFORE INSERT ON audit WHEN NEW.action='participation.cancel'
    BEGIN SELECT RAISE(ABORT,'simulated_audit_failure'); END`);
  await assert.rejects(cancelAttendance(f.db, f.actor, input), /simulated_audit_failure/);
  assert.equal(f.native.prepare('SELECT state FROM attempts').get().state, 'pending');
  assert.equal(f.native.prepare('SELECT reserved FROM items').get().reserved, 4);
  assert.equal(f.native.prepare('SELECT state FROM participations').get().state, 'physical_pending');
});
