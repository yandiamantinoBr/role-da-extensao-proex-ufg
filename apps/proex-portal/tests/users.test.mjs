import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Exercise real services and migrations with SQLite transactions; no UI or provider mocks grant access.
const temporary = mkdtempSync(join(tmpdir(), 'proex-users-'));
writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
for (const name of ['access', 'errors', 'users', 'database', 'mutations']) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from '(\.\/[^']+)'/g, (_, file) => `from '${file}.js'`);
  writeFileSync(join(temporary, `${name}.js`), output);
}
after(() => rmSync(temporary, { recursive: true, force: true }));
const { getActor, requireCapability, accessAction } = await import(pathToFileURL(join(temporary, 'access.js')).href);
const { usersAction, listManagedUsers } = await import(pathToFileURL(join(temporary, 'users.js')).href);

const OWNER = { userId: 'native-owner', email: 'owner@example.test', displayName: 'Responsável' };
const OTHER_OWNER = { userId: 'native-other-owner', email: 'other-owner@example.test', displayName: 'Outro responsável' };
const MANAGER = { userId: 'native-manager', email: 'manager@example.test', displayName: 'Gestor' };
const MEMBER = { userId: 'native-member', email: 'member@example.test', displayName: 'Pessoa da equipe' };

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  const directory = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='portal_users'").get(),
    'The real canonical-identity migration must be generated before running users tests.');
  const now = new Date().toISOString();
  sqlite.prepare('INSERT INTO projects(id,name,description,created_at) VALUES(?,?,?,?)').run('role', 'Rolê', '', now);
  sqlite.prepare('INSERT INTO projects(id,name,description,created_at) VALUES(?,?,?,?)').run('other', 'Outro', '', now);
  const db = {
    beforeBatch: null,
    prepare(sql) {
      function statement(parameters = []) {
        return {
          bind(...values) { return statement(values); },
          async first() { return sqlite.prepare(sql).get(...parameters) ?? null; },
          async all() { return { success: true, results: sqlite.prepare(sql).all(...parameters) }; },
          async run() { return this.execute(); },
          execute() {
            const result = sqlite.prepare(sql).run(...parameters);
            return { success: true, results: [], meta: { changes: Number(result.changes) } };
          },
        };
      }
      return statement();
    },
    async batch(statements) {
      if (this.beforeBatch) { const hook = this.beforeBatch; this.beforeBatch = null; hook(); }
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  function account(user, status = 'active') {
    sqlite.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(user.userId, user.email, status, now, now);
    sqlite.prepare('INSERT INTO profiles(user_id,display_name,avatar_key,mime,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(user.userId, user.displayName, 'avatars/private-object-key', 'image/png', 1, now, now);
  }
  function member(user, role, projectId = null, revokedAt = null) {
    const id = crypto.randomUUID();
    sqlite.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, user.userId, user.email, role, projectId, revokedAt, now);
    return id;
  }
  function session(user, providerId, provider = 'password') {
    const ms = Date.now(), id = crypto.randomUUID();
    sqlite.prepare('INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(providerId, 'Nome da autenticação', `${providerId}@example.test`, 0, ms, ms);
    sqlite.prepare('INSERT INTO identity_aliases(provider,subject,user_id,created_at) VALUES(?,?,?,?)')
      .run(provider, providerId, user.userId, now);
    sqlite.prepare('INSERT INTO auth_session(id,expires_at,token,created_at,updated_at,user_id) VALUES(?,?,?,?,?,?)')
      .run(id, ms + 3600000, `secret-session-${id}`, ms, ms, providerId);
    return id;
  }
  async function actor(user) { return getActor(db, user); }
  function auditCount(action) { return sqlite.prepare('SELECT COUNT(*) n FROM audit WHERE action=?').get(action).n; }
  account(OWNER); const ownerMemberId = member(OWNER, 'owner');
  return { sqlite, db, account, member, session, actor, auditCount, ownerMemberId };
}
function rejected(promise, code, status) {
  return assert.rejects(promise, error => error.code === code && (status === undefined || error.status === status));
}
function change(memberId, role, operationKey = crypto.randomUUID()) { return { memberId, role, operationKey }; }

test('dispatch ignores other actions and rejects unauthenticated or malformed requests', async t => {
  const f = fixture(t), actor = await f.actor(OWNER);
  assert.equal(await usersAction(f.db, null, 'profile.update', {}), null);
  await rejected(usersAction(f.db, null, 'user.status', {}), 'unauthenticated', 401);
  await rejected(usersAction(f.db, actor, 'user.status', { userId: MEMBER.userId, status: 'deleted' }), 'invalid_user_status', 400);
  await rejected(usersAction(f.db, actor, 'member.change', { memberId: 'bad/id', role: 'viewer' }), 'invalid_member_change', 400);
  f.account(MEMBER); const id = f.member(MEMBER, 'operator', 'role');
  await rejected(usersAction(f.db, actor, 'member.change', change(id, 'owner')), 'invalid_member_change', 400);
  await rejected(usersAction(f.db, actor, 'member.change', { memberId: id, role: 'viewer', operationKey: 'x' }), 'invalid_operation', 400);
});

test('blocking a canonical account revokes only its password aliases and preserves history and email', async t => {
  const f = fixture(t); f.account(MEMBER); const memberId = f.member(MEMBER, 'operator', 'role');
  f.session(MEMBER, 'auth-member-one'); f.session(MEMBER, 'auth-member-two');
  const nativeSession = f.session(MEMBER, 'auth-other-provider', 'chatgpt');
  const ownerSession = f.session(OWNER, 'auth-owner');
  const result = await usersAction(f.db, await f.actor(OWNER), 'user.status', {
    userId: MEMBER.userId, status: 'blocked', email: 'attacker@example.test', role: 'owner',
  });
  assert.equal(result.status, 'blocked'); assert.equal(result.changed, true);
  assert.equal(f.sqlite.prepare('SELECT status FROM portal_users WHERE user_id=?').get(MEMBER.userId).status, 'blocked');
  assert.equal(f.sqlite.prepare('SELECT email FROM portal_users WHERE user_id=?').get(MEMBER.userId).email, MEMBER.email);
  assert.equal(f.sqlite.prepare('SELECT revoked_at FROM members WHERE id=?').get(memberId).revoked_at, null);
  assert.deepEqual(f.sqlite.prepare('SELECT id FROM auth_session ORDER BY id').all().map(row => row.id), [nativeSession, ownerSession].sort());
  assert.equal(f.auditCount('user.status'), 1);
});

test('a repeated block removes later sessions without duplicate status audit; unblock requires a new login', async t => {
  const f = fixture(t); f.account(MEMBER); const actor = await f.actor(OWNER);
  await usersAction(f.db, actor, 'user.status', { userId: MEMBER.userId, status: 'blocked' });
  f.session(MEMBER, 'auth-new-session');
  const repeat = await usersAction(f.db, actor, 'user.status', { userId: MEMBER.userId, status: 'blocked' });
  assert.equal(repeat.changed, false); assert.equal(f.auditCount('user.status'), 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_session').get().n, 0);
  f.session(MEMBER, 'auth-another-session');
  await usersAction(f.db, actor, 'user.status', { userId: MEMBER.userId, status: 'active' });
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_session').get().n, 0);
  assert.equal(f.auditCount('user.status'), 2);
});

test('project managers and forged capability arrays cannot block a global account', async t => {
  const f = fixture(t); f.account(MANAGER); f.member(MANAGER, 'manager', 'role'); f.account(MEMBER);
  const actor = await f.actor(MANAGER); actor.capabilities.push('organization.manage');
  await rejected(usersAction(f.db, actor, 'user.status', { userId: MEMBER.userId, status: 'blocked' }), 'forbidden', 403);
  assert.equal(f.sqlite.prepare('SELECT status FROM portal_users WHERE user_id=?').get(MEMBER.userId).status, 'active');
});

test('a global owner cannot block their own account', async t => {
  const f = fixture(t); f.account(OTHER_OWNER); f.member(OTHER_OWNER, 'owner');
  await rejected(usersAction(f.db, await f.actor(OWNER), 'user.status', { userId: OWNER.userId, status: 'blocked' }), 'self_block_forbidden', 409);
  assert.equal(f.auditCount('user.status'), 0);
});

test('concurrent mutual blocks preserve one active owner and reject the now-blocked actor', async t => {
  const f = fixture(t); f.account(OTHER_OWNER); f.member(OTHER_OWNER, 'owner');
  const [first, second] = await Promise.all([f.actor(OWNER), f.actor(OTHER_OWNER)]);
  const results = await Promise.allSettled([
    usersAction(f.db, first, 'user.status', { userId: OTHER_OWNER.userId, status: 'blocked' }),
    usersAction(f.db, second, 'user.status', { userId: OWNER.userId, status: 'blocked' }),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(DISTINCT m.user_id) n FROM members m JOIN portal_users u ON u.user_id=m.user_id WHERE m.role='owner' AND m.revoked_at IS NULL AND u.status='active'").get().n, 1);
});

test('a stale revoked or blocked owner cannot change another account status', async t => {
  const f = fixture(t); f.account(MEMBER); const actor = await f.actor(OWNER);
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), f.ownerMemberId);
  await rejected(usersAction(f.db, actor, 'user.status', { userId: MEMBER.userId, status: 'blocked' }), 'user_not_found', 404);
  f.sqlite.prepare('UPDATE members SET revoked_at=NULL WHERE id=?').run(f.ownerMemberId);
  f.sqlite.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(OWNER.userId);
  await rejected(usersAction(f.db, actor, 'user.status', { userId: MEMBER.userId, status: 'blocked' }), 'user_not_found', 404);
  assert.equal(f.auditCount('user.status'), 0);
});

test('membership changes keep canonical identity, email and stored project while retaining revoked history', async t => {
  const f = fixture(t); f.account(MEMBER); const oldId = f.member(MEMBER, 'operator', 'role');
  const result = await usersAction(f.db, await f.actor(OWNER), 'member.change', {
    ...change(oldId, 'viewer'), userId: 'forged-account', email: 'forged@example.test', projectId: 'other',
  });
  assert.notEqual(result.memberId, oldId);
  const original = f.sqlite.prepare('SELECT * FROM members WHERE id=?').get(oldId);
  const current = f.sqlite.prepare('SELECT * FROM members WHERE id=?').get(result.memberId);
  assert.ok(original.revoked_at); assert.equal(original.role, 'operator');
  assert.equal(current.user_id, MEMBER.userId); assert.equal(current.email, MEMBER.email);
  assert.equal(current.project_id, 'role'); assert.equal(current.role, 'viewer');
  assert.equal(current.revoked_at, null); assert.equal(f.auditCount('member.change'), 1);
  const refreshed = await f.actor(MEMBER);
  requireCapability(refreshed, 'reports.read', 'role');
  assert.throws(() => requireCapability(refreshed, 'participation.operate', 'role'), { status: 403 });
});

test('manager changes only subordinate roles in its own project and cannot widen scope', async t => {
  const f = fixture(t); f.account(MANAGER); f.member(MANAGER, 'manager', 'role');
  f.account(MEMBER); const own = f.member(MEMBER, 'operator', 'role');
  const other = f.member(MEMBER, 'viewer', 'other');
  const global = f.member(MEMBER, 'viewer');
  const managerTarget = f.member({ ...MEMBER, userId: 'another-manager' }, 'manager', 'role');
  const actor = await f.actor(MANAGER);
  for (const input of [change(other, 'inventory'), change(global, 'inventory'), change(managerTarget, 'operator'), change(f.ownerMemberId, 'viewer'), change(own, 'manager')]) {
    await assert.rejects(usersAction(f.db, actor, 'member.change', input), error => error.status === 403);
  }
  const result = await usersAction(f.db, actor, 'member.change', change(own, 'inventory'));
  assert.equal(result.role, 'inventory'); assert.equal(f.auditCount('member.change'), 1);
});

test('only an owner can assign manager or change a global membership', async t => {
  const f = fixture(t); f.account(MEMBER); const id = f.member(MEMBER, 'viewer');
  const result = await usersAction(f.db, await f.actor(OWNER), 'member.change', change(id, 'manager'));
  assert.equal(f.sqlite.prepare('SELECT project_id FROM members WHERE id=?').get(result.memberId).project_id, null);
  assert.equal(result.role, 'manager');
});

test('the last active owner cannot be demoted and a blocked owner does not count as a replacement', async t => {
  const f = fixture(t), actor = await f.actor(OWNER);
  await rejected(usersAction(f.db, actor, 'member.change', change(f.ownerMemberId, 'viewer')), 'member_not_changed', 409);
  f.account(OTHER_OWNER, 'blocked'); f.member(OTHER_OWNER, 'owner');
  await rejected(usersAction(f.db, actor, 'member.change', change(f.ownerMemberId, 'viewer')), 'member_not_changed', 409);
  assert.equal(f.sqlite.prepare('SELECT revoked_at FROM members WHERE id=?').get(f.ownerMemberId).revoked_at, null);
  assert.equal(f.auditCount('member.change'), 0);
  f.sqlite.prepare("UPDATE portal_users SET status='active',activation_pending=1 WHERE user_id=?").run(OTHER_OWNER.userId);
  await rejected(usersAction(f.db, actor, 'member.change', change(f.ownerMemberId, 'viewer')), 'member_not_changed', 409);
  f.sqlite.prepare('UPDATE portal_users SET activation_pending=0 WHERE user_id=?').run(OTHER_OWNER.userId);
  const result = await usersAction(f.db, actor, 'member.change', change(f.ownerMemberId, 'viewer'));
  assert.equal(result.role, 'viewer');
});

test('a legacy owner without a canonical row still counts until first native login materializes it', async t => {
  const f = fixture(t); f.member(OTHER_OWNER, 'owner');
  const result = await usersAction(f.db, await f.actor(OWNER), 'member.change', change(f.ownerMemberId, 'viewer'));
  assert.equal(result.role, 'viewer');
});

test('existing member.revoke guard excludes blocked and pending owners but preserves legacy owner semantics', async t => {
  const f = fixture(t); f.account(OTHER_OWNER, 'blocked'); f.member(OTHER_OWNER, 'owner');
  const actor = await f.actor(OWNER), revoke = () => accessAction(f.db, actor, 'member.revoke', { id: f.ownerMemberId }, 'https://portal.example.test');
  await rejected(revoke(), 'member_not_revoked', 409);
  f.sqlite.prepare("UPDATE portal_users SET status='active',activation_pending=1 WHERE user_id=?").run(OTHER_OWNER.userId);
  await rejected(revoke(), 'member_not_revoked', 409);
  f.sqlite.prepare('DELETE FROM portal_users WHERE user_id=?').run(OTHER_OWNER.userId);
  assert.equal((await revoke()).revoked, true);
});

test('an account waiting for activation cannot manage users even with a stale owner snapshot', async t => {
  const f = fixture(t); f.account(MEMBER); const id = f.member(MEMBER, 'operator', 'role');
  const actor = await f.actor(OWNER);
  f.sqlite.prepare('UPDATE portal_users SET activation_pending=1 WHERE user_id=?').run(OWNER.userId);
  assert.deepEqual(await listManagedUsers(f.db, actor), []);
  await rejected(usersAction(f.db, actor, 'user.status', { userId: MEMBER.userId, status: 'blocked' }), 'user_not_found', 404);
  await rejected(usersAction(f.db, actor, 'member.change', change(id, 'viewer')), 'member_not_changed', 409);
  assert.equal(f.auditCount('member.change'), 0);
});

test('same-role operations return the existing membership and bind the idempotency key', async t => {
  const f = fixture(t); f.account(MEMBER); const id = f.member(MEMBER, 'viewer', 'role');
  const actor = await f.actor(OWNER), input = change(id, 'viewer');
  const first = await usersAction(f.db, actor, 'member.change', input);
  const repeated = await usersAction(f.db, actor, 'member.change', input);
  assert.equal(first.memberId, id); assert.equal(first.changed, false);
  assert.equal(repeated.memberId, id); assert.equal(repeated.changed, false);
  await rejected(usersAction(f.db, actor, 'member.change', { ...input, role: 'operator' }), 'operation_conflict', 409);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(MEMBER.userId).n, 1);
  assert.equal(f.auditCount('member.change'), 1);
});

test('concurrent owner demotions preserve an active global owner', async t => {
  const f = fixture(t); f.account(OTHER_OWNER); const otherId = f.member(OTHER_OWNER, 'owner');
  const [first, second] = await Promise.all([f.actor(OWNER), f.actor(OTHER_OWNER)]);
  const results = await Promise.allSettled([
    usersAction(f.db, first, 'member.change', change(otherId, 'viewer')),
    usersAction(f.db, second, 'member.change', change(f.ownerMemberId, 'viewer')),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(DISTINCT m.user_id) n FROM members m JOIN portal_users u ON u.user_id=m.user_id WHERE m.role='owner' AND m.revoked_at IS NULL AND u.status='active'").get().n, 1);
});

test('replay and concurrent submission create one new membership and one audit receipt', async t => {
  const f = fixture(t); f.account(MEMBER); const id = f.member(MEMBER, 'operator', 'role');
  const actor = await f.actor(OWNER), input = change(id, 'viewer');
  const [first, second] = await Promise.all([
    usersAction(f.db, actor, 'member.change', input), usersAction(f.db, actor, 'member.change', input),
  ]);
  assert.equal(first.memberId, second.memberId);
  const third = await usersAction(f.db, actor, 'member.change', input);
  assert.equal(third.memberId, first.memberId); assert.equal(third.replayed, true);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(MEMBER.userId).n, 2);
  assert.equal(f.auditCount('member.change'), 1);
  await rejected(usersAction(f.db, actor, 'member.change', { ...input, role: 'loans' }), 'operation_conflict', 409);
});

test('two different changes racing for one membership cannot revoke or duplicate the replacement', async t => {
  const f = fixture(t); f.account(MEMBER); const id = f.member(MEMBER, 'operator', 'role');
  const actor = await f.actor(OWNER);
  const outcomes = await Promise.allSettled([
    usersAction(f.db, actor, 'member.change', change(id, 'viewer')),
    usersAction(f.db, actor, 'member.change', change(id, 'inventory')),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=? AND revoked_at IS NULL').get(MEMBER.userId).n, 1);
  assert.equal(f.auditCount('member.change'), 1);
});

test('revocation immediately before the batch invalidates a stale manager', async t => {
  const f = fixture(t); f.account(MANAGER); const managerId = f.member(MANAGER, 'manager', 'role');
  f.account(MEMBER); const memberId = f.member(MEMBER, 'operator', 'role');
  const actor = await f.actor(MANAGER);
  f.db.beforeBatch = () => f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), managerId);
  await rejected(usersAction(f.db, actor, 'member.change', change(memberId, 'viewer')), 'member_not_changed', 409);
  assert.equal(f.sqlite.prepare('SELECT revoked_at FROM members WHERE id=?').get(memberId).revoked_at, null);
  assert.equal(f.auditCount('member.change'), 0);
});

test('failed membership audit rolls back old revocation and the replacement', async t => {
  const f = fixture(t); f.account(MEMBER); const id = f.member(MEMBER, 'operator', 'role');
  f.sqlite.exec("CREATE TRIGGER reject_users_audit BEFORE INSERT ON audit WHEN NEW.action='member.change' BEGIN SELECT RAISE(ABORT,'forced_audit_failure'); END");
  await assert.rejects(usersAction(f.db, await f.actor(OWNER), 'member.change', change(id, 'viewer')), /forced_audit_failure/);
  assert.equal(f.sqlite.prepare('SELECT revoked_at FROM members WHERE id=?').get(id).revoked_at, null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(MEMBER.userId).n, 1);
});

test('failed account audit rolls back status and keeps the previous sessions', async t => {
  const f = fixture(t); f.account(MEMBER); f.session(MEMBER, 'auth-member');
  f.sqlite.exec("CREATE TRIGGER reject_users_audit BEFORE INSERT ON audit WHEN NEW.action='user.status' BEGIN SELECT RAISE(ABORT,'forced_audit_failure'); END");
  await assert.rejects(usersAction(f.db, await f.actor(OWNER), 'user.status', { userId: MEMBER.userId, status: 'blocked' }), /forced_audit_failure/);
  assert.equal(f.sqlite.prepare('SELECT status FROM portal_users WHERE user_id=?').get(MEMBER.userId).status, 'active');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_session').get().n, 1);
});

test('failed session revocation rolls back both status and its audit', async t => {
  const f = fixture(t); f.account(MEMBER); f.session(MEMBER, 'auth-member');
  f.sqlite.exec("CREATE TRIGGER reject_session_delete BEFORE DELETE ON auth_session BEGIN SELECT RAISE(ABORT,'forced_session_failure'); END");
  await assert.rejects(usersAction(f.db, await f.actor(OWNER), 'user.status', { userId: MEMBER.userId, status: 'blocked' }), /forced_session_failure/);
  assert.equal(f.sqlite.prepare('SELECT status FROM portal_users WHERE user_id=?').get(MEMBER.userId).status, 'active');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_session').get().n, 1);
  assert.equal(f.auditCount('user.status'), 0);
});

test('managed users directory filters both accounts and memberships and excludes credential secrets', async t => {
  const f = fixture(t); f.account(MANAGER); f.member(MANAGER, 'manager', 'role');
  f.account(MEMBER); f.member(MEMBER, 'operator', 'role'); f.member(MEMBER, 'manager', 'other');
  const outsider = { userId: 'native-outsider', email: 'outsider@example.test', displayName: 'Outro projeto' };
  const unlinked = { userId: 'native-unlinked', email: 'unlinked@example.test', displayName: 'Sem vínculo' };
  f.account(outsider); f.member(outsider, 'viewer', 'other'); f.account(unlinked);
  f.session(MEMBER, 'auth-hidden-subject');
  const scoped = await listManagedUsers(f.db, await f.actor(MANAGER));
  assert.deepEqual(scoped.map(user => user.userId).sort(), [MANAGER.userId, MEMBER.userId].sort());
  const managedMember = scoped.find(user => user.userId === MEMBER.userId);
  assert.equal(managedMember.displayName, MEMBER.displayName); assert.equal(managedMember.hasPassword, true);
  assert.deepEqual(managedMember.members.map(member => member.project_id), ['role']);
  const global = await listManagedUsers(f.db, await f.actor(OWNER));
  assert.ok(global.some(user => user.userId === unlinked.userId && user.members.length === 0));
  const encoded = JSON.stringify(global);
  for (const secret of ['auth-hidden-subject', 'secret-session-', 'avatars/private-object-key', 'token', 'avatar_key']) assert.equal(encoded.includes(secret), false);
});

test('directory SQL rejects stale revoked or blocked managers and viewer access', async t => {
  const f = fixture(t); f.account(MANAGER); const id = f.member(MANAGER, 'manager', 'role');
  f.account(MEMBER); f.member(MEMBER, 'viewer', 'role');
  const actor = await f.actor(MANAGER);
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), id);
  assert.deepEqual(await listManagedUsers(f.db, actor), []);
  f.sqlite.prepare('UPDATE members SET revoked_at=NULL WHERE id=?').run(id);
  f.sqlite.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(MANAGER.userId);
  assert.deepEqual(await listManagedUsers(f.db, actor), []);
  await rejected(listManagedUsers(f.db, await f.actor(MEMBER)), 'forbidden', 403);
});
