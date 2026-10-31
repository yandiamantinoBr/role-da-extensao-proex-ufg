import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Compile the server modules into an isolated directory. No bundler, native auth, or D1 mock
// authorizes anyone: actual SQLite executes every conditional statement and transaction below.
const temporary = mkdtempSync(join(tmpdir(), 'proex-access-'));
writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
for (const name of ['access', 'errors', 'database', 'mutations']) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from '(\.\/[^']+)'/g, (_, file) => `from '${file}.js'`);
  writeFileSync(join(temporary, `${name}.js`), output);
}
after(() => rmSync(temporary, { recursive: true, force: true }));
const { getActor, requireCapability, accessibleProjects, accessAction: callAccessAction, writeAudit } =
  await import(pathToFileURL(join(temporary, 'access.js')).href);
const INVITE_SECRET = 'fixture-only-proex-invitation-secret-32-characters';
// Request fixtures supply a client operation id and a separate server-only secret.
function accessAction(db, actor, action, input, origin, secret = INVITE_SECRET) {
  const request = action === 'invite.create' && input.operationKey === undefined ? { ...input, operationKey: crypto.randomUUID() } : input;
  return callAccessAction(db, actor, action, request, origin, secret);
}

const ownerUser = { userId: 'owner-a', email: 'owner@example.test', displayName: 'Responsável A' };
const memberUser = { userId: 'member-a', email: 'member@example.test', displayName: 'Pessoa da equipe' };
const origin = 'https://portal.example.test';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrationDirectory = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDirectory), 'utf8'));
  }
  sqlite.exec(`INSERT INTO projects(id,name,description,created_at) VALUES ('role','Rolê','',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    INSERT INTO projects(id,name,description,created_at) VALUES ('other','Outro projeto','',strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
  const database = {
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
        const results = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  function seed(user, role, projectId = null, revokedAt = null) {
    const id = crypto.randomUUID();
    sqlite.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, user.userId, user.email, role, projectId, revokedAt, new Date().toISOString());
    return id;
  }
  function accountState(user, status = 'active', pending = 0) {
    const now = new Date().toISOString();
    sqlite.prepare(`INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,activation_pending=excluded.activation_pending`)
      .run(user.userId, user.email, status, pending, now, now);
  }
  return { sqlite, db: database, seed, accountState };
}

async function owner(f) { return getActor(f.db, ownerUser, ownerUser.email); }
function tokenOf(invite) { return new URL(invite.inviteUrl).searchParams.get('token'); }
function rejected(promise, code, status) {
  return assert.rejects(promise, (error) => error.code === code && (status === undefined || error.status === status));
}
function closeAfter(t, fixture) { t.after(() => fixture.sqlite.close()); return fixture; }

test('bootstrap requires the configured verified native email and happens only once', async (t) => {
  const f = closeAfter(t, fixture());
  assert.equal(await getActor(f.db, null, ownerUser.email), null);
  const ordinary = await getActor(f.db, memberUser, ownerUser.email);
  assert.deepEqual(ordinary.members, []);
  const first = await owner(f);
  const second = await owner(f);
  assert.equal(first.members.length, 1);
  assert.equal(second.members[0].id, first.members[0].id);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE action='owner.bootstrap'").get().n, 1);
  assert.equal(accessibleProjects(first), null);
  requireCapability(first, 'projects.manage', null);
});

test('changing bootstrap email or logging in cannot resurrect a revoked owner', async (t) => {
  const f = closeAfter(t, fixture());
  const initial = await owner(f);
  const secondUser = { ...ownerUser, userId: 'owner-b', email: 'second@example.test' };
  f.seed(secondUser, 'owner');
  const second = await getActor(f.db, secondUser);
  await accessAction(f.db, second, 'member.revoke', { id: initial.members[0].id }, origin);
  assert.equal((await owner(f)).members.length, 0);
  const changed = await getActor(f.db, memberUser, memberUser.email);
  assert.equal(changed.members.length, 0);
});

test('scopes distinguish presence checks, project checks and global administration', async (t) => {
  const f = closeAfter(t, fixture());
  f.seed(memberUser, 'manager', 'role');
  const actor = await getActor(f.db, memberUser);
  requireCapability(actor, 'campaigns.manage');
  requireCapability(actor, 'campaigns.manage', 'role');
  assert.throws(() => requireCapability(actor, 'campaigns.manage', 'other'), { status: 403 });
  assert.throws(() => requireCapability(actor, 'campaigns.manage', null), { status: 403 });
  assert.throws(() => requireCapability(actor, 'projects.manage', 'role'), { status: 403 });
  assert.throws(() => requireCapability(actor, 'reports.export_identifiable', 'role'), { status: 403 });
  assert.deepEqual(accessibleProjects(actor, 'inventory.manage'), ['role']);
  assert.deepEqual(accessibleProjects(actor, 'unknown'), []);
});

test('literal role permissions do not trust a forged capabilities array', async (t) => {
  const f = closeAfter(t, fixture());
  f.seed(memberUser, 'viewer', 'role');
  const actor = await getActor(f.db, memberUser);
  actor.capabilities = ['organization.manage', 'inventory.manage', 'reports.export_identifiable'];
  requireCapability(actor, 'reports.read', 'role');
  for (const capability of actor.capabilities) {
    assert.throws(() => requireCapability(actor, capability, 'role'), { status: 403 });
  }
  assert.deepEqual(accessibleProjects(actor, 'inventory.manage'), []);
});

test('revoked and malformed stored membership rows grant no capabilities', async (t) => {
  const f = closeAfter(t, fixture());
  const id = f.seed(memberUser, 'operator', 'role');
  const before = await getActor(f.db, memberUser);
  requireCapability(before, 'participation.operate', 'role');
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), id);
  const afterRevoke = await getActor(f.db, memberUser);
  assert.throws(() => requireCapability(afterRevoke, 'participation.operate', 'role'), { status: 403 });
  f.sqlite.prepare('UPDATE members SET revoked_at=NULL,created_at=? WHERE id=?').run('not-a-time', id);
  assert.equal((await getActor(f.db, memberUser)).members.length, 0);
});

test('operational roles have separate permissions', async (t) => {
  const f = closeAfter(t, fixture());
  const expected = {
    operator: ['participation.operate', 'inventory.deliver'],
    inventory: ['inventory.read', 'inventory.manage'],
    loans: ['loans.read', 'loans.manage', 'loans.checkout'],
    viewer: ['reports.read'],
  };
  for (const [role, capabilities] of Object.entries(expected)) {
    const user = { ...memberUser, userId: role };
    f.seed(user, role, 'role');
    const actor = await getActor(f.db, user);
    assert.deepEqual(actor.capabilities.sort(), capabilities.sort());
    assert.throws(() => requireCapability(actor, 'access.invite', 'role'), { status: 403 });
  }
});

test('owner creates a manual seven-day invitation without persisting its raw token', async (t) => {
  const f = closeAfter(t, fixture());
  const actor = await owner(f);
  const result = await accessAction(f.db, actor, 'invite.create', {
    email: ' MEMBER@EXAMPLE.TEST ', role: 'operator', projectId: 'role',
  }, origin);
  assert.equal(result.delivery, 'manual');
  assert.match(tokenOf(result), /^[A-Za-z0-9_-]{43}$/);
  const invitation = f.sqlite.prepare('SELECT * FROM invites WHERE id=?').get(result.id);
  assert.equal(invitation.email, memberUser.email);
  assert.match(invitation.token_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(invitation).includes(tokenOf(result)), false);
  assert.ok(Date.parse(result.expiresAt) - Date.now() > 6.9 * 86400000);
  assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM audit').all()).includes(tokenOf(result)), false);
});

test('global invitations require an explicit boolean confirmation and only a current owner can grant them', async t => {
  const f = closeAfter(t, fixture()), administrator = await owner(f);
  const input = { email: 'external@example.invalid', role: 'viewer', projectId: null };
  for (const confirmation of [undefined, false, 'true', 1]) {
    await rejected(accessAction(f.db, administrator, 'invite.create', { ...input, globalAccess: confirmation }, origin), 'global_scope_confirmation_required', 400);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 0);
  const global = await accessAction(f.db, administrator, 'invite.create', { ...input, globalAccess: true }, origin);
  assert.equal(f.sqlite.prepare('SELECT project_id FROM invites WHERE id=?').get(global.id).project_id, null);
  f.seed(memberUser, 'manager', 'role');
  const manager = await getActor(f.db, memberUser);
  await assert.rejects(accessAction(f.db, manager, 'invite.create', { ...input, globalAccess: true }, origin), { status: 403 });
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(), administrator.userId);
  await rejected(accessAction(f.db, administrator, 'invite.create', { ...input, globalAccess: true }, origin), 'access_changed', 403);
});

test('institutional and external email addresses grant only the invited project role', async t => {
  const f = closeAfter(t, fixture()), administrator = await owner(f);
  for (const recipient of ['scholar@ufg.br', 'external@example.invalid']) {
    const invitation = await accessAction(f.db, administrator, 'invite.create', { email: recipient, role: 'viewer', projectId: 'role' }, origin);
    const user = { userId: crypto.randomUUID(), email: recipient, displayName: 'Pessoa convidada' };
    const before = await getActor(f.db, user);
    assert.deepEqual(accessibleProjects(before), []);
    await accessAction(f.db, before, 'invite.accept', { token: tokenOf(invitation) }, origin);
    const after = await getActor(f.db, user);
    assert.deepEqual(accessibleProjects(after), ['role']);
    requireCapability(after, 'reports.read', 'role');
    assert.throws(() => requireCapability(after, 'reports.read', 'other'), { status: 403 });
    assert.throws(() => requireCapability(after, 'organization.manage', null), { status: 403 });
  }
});

test('repeated and simultaneous invite creation recovers the same link with one claim and audit', async t => {
  const f = closeAfter(t, fixture()), actor = await owner(f);
  const input = { email: memberUser.email, role: 'viewer', projectId: 'role', operationKey: crypto.randomUUID() };
  const [first, second] = await Promise.all([
    accessAction(f.db, actor, 'invite.create', input, origin),
    accessAction(f.db, actor, 'invite.create', input, origin),
  ]);
  assert.equal(first.id, second.id); assert.equal(first.inviteUrl, second.inviteUrl); assert.equal(first.expiresAt, second.expiresAt);
  const replay = await accessAction(f.db, actor, 'invite.create', input, origin);
  assert.equal(replay.inviteUrl, first.inviteUrl); assert.equal(replay.replayed, true);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE action='invite.create'").get().n, 1);
  const persisted = JSON.stringify([f.sqlite.prepare('SELECT * FROM invites').all(), f.sqlite.prepare('SELECT * FROM mutation_keys').all(), f.sqlite.prepare('SELECT * FROM audit').all()]);
  for (const secret of [tokenOf(first), INVITE_SECRET, input.operationKey]) assert.equal(persisted.includes(secret), false);
});

test('invite creation binds its operation key to normalized recipient, role and project', async t => {
  const f = closeAfter(t, fixture()), actor = await owner(f);
  const input = { email: memberUser.email, role: 'viewer', projectId: 'role', operationKey: crypto.randomUUID() };
  const first = await accessAction(f.db, actor, 'invite.create', input, origin);
  assert.equal((await accessAction(f.db, actor, 'invite.create', { ...input, email: ` ${memberUser.email.toUpperCase()} ` }, origin)).inviteUrl, first.inviteUrl);
  for (const changed of [{ role: 'operator' }, { email: 'another@example.test' }, { projectId: 'other' }]) {
    await rejected(accessAction(f.db, actor, 'invite.create', { ...input, ...changed }, origin), 'operation_changed', 409);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 1);
});

test('invite HMAC is separated by actor even when operation keys and recipient coincide', async t => {
  const f = closeAfter(t, fixture()), firstActor = await owner(f);
  const secondUser = { ...ownerUser, userId: 'owner-b', email: 'second@example.test' };
  f.seed(secondUser, 'owner');
  const secondActor = await getActor(f.db, secondUser);
  const input = { email: memberUser.email, role: 'viewer', projectId: 'role', operationKey: 'shared-operation-key' };
  const first = await accessAction(f.db, firstActor, 'invite.create', input, origin);
  const second = await accessAction(f.db, secondActor, 'invite.create', input, origin);
  assert.notEqual(tokenOf(first), tokenOf(second)); assert.notEqual(first.id, second.id);
});

test('invite creation requires an operation key and a server-only configured secret', async t => {
  const f = closeAfter(t, fixture()), actor = await owner(f);
  const input = { email: memberUser.email, role: 'viewer', projectId: 'role', operationKey: crypto.randomUUID() };
  await rejected(callAccessAction(f.db, actor, 'invite.create', input, origin), 'invites_unavailable', 503);
  await rejected(callAccessAction(f.db, actor, 'invite.create', input, origin, 'short'), 'invites_unavailable', 503);
  await rejected(callAccessAction(f.db, actor, 'invite.create', { ...input, operationKey: undefined }, origin, INVITE_SECRET), 'invalid_operation_key', 400);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n, 0);
});

for (const condition of ['revoked', 'accepted', 'expired']) {
  test(`invite creation never reissues a ${condition} link during replay`, async t => {
    const f = closeAfter(t, fixture()), actor = await owner(f);
    const input = { email: memberUser.email, role: 'viewer', projectId: 'role', operationKey: crypto.randomUUID() };
    const invite = await accessAction(f.db, actor, 'invite.create', input, origin);
    if (condition === 'revoked') await accessAction(f.db, actor, 'invite.revoke', { id: invite.id }, origin);
    if (condition === 'accepted') await accessAction(f.db, await getActor(f.db, memberUser), 'invite.accept', { token: tokenOf(invite) }, origin);
    if (condition === 'expired') f.sqlite.prepare('UPDATE invites SET expires_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), invite.id);
    await rejected(accessAction(f.db, actor, 'invite.create', input, origin), condition === 'accepted' ? 'invite_used' : condition === 'revoked' ? 'invite_revoked' : 'invite_expired', 409);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE action='invite.create'").get().n, 1);
  });
}

test('secret rotation cannot regenerate a different token for an already claimed operation', async t => {
  const f = closeAfter(t, fixture()), actor = await owner(f);
  const input = { email: memberUser.email, role: 'viewer', projectId: 'role', operationKey: crypto.randomUUID() };
  await accessAction(f.db, actor, 'invite.create', input, origin);
  await rejected(accessAction(f.db, actor, 'invite.create', input, origin, `${INVITE_SECRET}-rotated`), 'invite_replay_unavailable', 409);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 1);
});

for (const failure of ['claim', 'audit']) {
  test(`failed invite ${failure} rolls back the invitation, mutation claim and audit together`, async t => {
    const f = closeAfter(t, fixture()), actor = await owner(f);
    const input = { email: memberUser.email, role: 'viewer', projectId: 'role', operationKey: crypto.randomUUID() };
    f.sqlite.exec(failure === 'claim'
      ? "CREATE TRIGGER fail_invite_commit BEFORE INSERT ON mutation_keys BEGIN SELECT RAISE(ABORT,'forced_invite_failure'); END"
      : "CREATE TRIGGER fail_invite_commit BEFORE INSERT ON audit WHEN NEW.action='invite.create' BEGIN SELECT RAISE(ABORT,'forced_invite_failure'); END");
    await assert.rejects(accessAction(f.db, actor, 'invite.create', input, origin), /forced_invite_failure/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE action='invite.create'").get().n, 0);
    f.sqlite.exec('DROP TRIGGER fail_invite_commit');
    assert.ok((await accessAction(f.db, actor, 'invite.create', input, origin)).inviteUrl);
  });
}

test('simultaneous reuse with different invite data creates one invitation and rejects the conflicting request', async t => {
  const f = closeAfter(t, fixture()), actor = await owner(f);
  const input = { email: memberUser.email, role: 'viewer', projectId: 'role', operationKey: crypto.randomUUID() };
  const results = await Promise.allSettled([
    accessAction(f.db, actor, 'invite.create', input, origin),
    accessAction(f.db, actor, 'invite.create', { ...input, role: 'operator' }, origin),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'operation_changed');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n, 1);
});

test('a previously created link cannot be recovered by a blocked, pending or revoked stale issuer', async t => {
  const f = closeAfter(t, fixture()), actor = await owner(f);
  const input = { email: memberUser.email, role: 'viewer', projectId: 'role', operationKey: crypto.randomUUID() };
  await accessAction(f.db, actor, 'invite.create', input, origin);
  f.accountState(ownerUser, 'blocked');
  await rejected(accessAction(f.db, actor, 'invite.create', input, origin), 'access_changed', 403);
  f.accountState(ownerUser, 'active', 1);
  await rejected(accessAction(f.db, actor, 'invite.create', input, origin), 'access_changed', 403);
  f.accountState(ownerUser, 'active', 0);
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), actor.members[0].id);
  await rejected(accessAction(f.db, actor, 'invite.create', input, origin), 'access_changed', 403);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE action='invite.create'").get().n, 1);
});

test('only owner may invite managers or grant global scope; managers stay in their project', async (t) => {
  const f = closeAfter(t, fixture());
  await owner(f);
  f.seed(memberUser, 'manager', 'role');
  const actor = await getActor(f.db, memberUser);
  for (const role of ['operator', 'inventory', 'loans', 'viewer']) {
    const result = await accessAction(f.db, actor, 'invite.create', {
      email: 'recipient@example.test', role, projectId: 'role',
    }, origin);
    assert.ok(result.id);
  }
  await rejected(accessAction(f.db, actor, 'invite.create', {
    email: 'recipient@example.test', role: 'manager', projectId: 'role',
  }, origin), 'delegation_forbidden', 403);
  for (const projectId of ['other', null]) {
    await assert.rejects(accessAction(f.db, actor, 'invite.create', {
      email: 'recipient@example.test', role: 'operator', projectId,
    }, origin), { status: 403 });
  }
});

test('unsupported owner invites and invalid origins do not create a record', async (t) => {
  const f = closeAfter(t, fixture());
  const actor = await owner(f);
  await rejected(accessAction(f.db, actor, 'invite.create', {
    email: memberUser.email, role: 'owner', projectId: null,
  }, origin), 'invalid_invite', 400);
  await rejected(accessAction(f.db, actor, 'invite.create', {
    email: memberUser.email, role: 'viewer', projectId: 'role',
  }, 'javascript:alert(1)'), 'invalid_origin', 400);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 0);
});

test('native authenticated account without any membership can accept its invitation', async (t) => {
  const f = closeAfter(t, fixture());
  const invite = await accessAction(f.db, await owner(f), 'invite.create', {
    email: memberUser.email, role: 'operator', projectId: 'role',
  }, origin);
  const unprivileged = await getActor(f.db, memberUser);
  assert.equal(unprivileged.members.length, 0);
  const result = await accessAction(f.db, unprivileged, 'invite.accept', { token: tokenOf(invite) }, origin);
  assert.equal(result.accepted, true);
  const refreshed = await getActor(f.db, memberUser);
  requireCapability(refreshed, 'participation.operate', 'role');
  assert.throws(() => requireCapability(refreshed, 'participation.operate', 'other'), { status: 403 });
});

test('acceptance requires the expected verified email, not a form value', async (t) => {
  const f = closeAfter(t, fixture());
  const invite = await accessAction(f.db, await owner(f), 'invite.create', {
    email: memberUser.email, role: 'viewer', projectId: 'role',
  }, origin);
  const wrong = await getActor(f.db, { ...memberUser, userId: 'wrong', email: 'wrong@example.test' });
  await rejected(accessAction(f.db, wrong, 'invite.accept', {
    token: tokenOf(invite), email: memberUser.email, role: 'owner', projectId: null,
  }, origin), 'email_mismatch', 403);
  assert.equal(f.sqlite.prepare('SELECT accepted_at FROM invites WHERE id=?').get(invite.id).accepted_at, null);
});

test('replay and simultaneous acceptance of one token create exactly one active membership', async (t) => {
  const f = closeAfter(t, fixture());
  const invite = await accessAction(f.db, await owner(f), 'invite.create', {
    email: memberUser.email, role: 'viewer', projectId: 'role',
  }, origin);
  const recipient = await getActor(f.db, memberUser);
  const results = await Promise.allSettled([
    accessAction(f.db, recipient, 'invite.accept', { token: tokenOf(invite) }, origin),
    accessAction(f.db, recipient, 'invite.accept', { token: tokenOf(invite) }, origin),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=? AND revoked_at IS NULL').get(memberUser.userId).n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE action='invite.accept'").get().n, 1);
  await rejected(accessAction(f.db, recipient, 'invite.accept', { token: tokenOf(invite) }, origin), 'invite_used', 409);
});

test('two invitations racing for the same account and scope cannot create two memberships', async (t) => {
  const f = closeAfter(t, fixture());
  const actor = await owner(f);
  const invites = [];
  for (const role of ['viewer', 'operator']) invites.push(await accessAction(f.db, actor, 'invite.create', {
    email: memberUser.email, role, projectId: 'role',
  }, origin));
  const recipient = await getActor(f.db, memberUser);
  const results = await Promise.allSettled(invites.map((invite) => accessAction(f.db, recipient, 'invite.accept', {
    token: tokenOf(invite),
  }, origin)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=? AND revoked_at IS NULL').get(memberUser.userId).n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites WHERE accepted_at IS NOT NULL').get().n, 1);
});

test('revoked and expired invites cannot be accepted', async (t) => {
  const f = closeAfter(t, fixture());
  const actor = await owner(f);
  for (const condition of ['revoked', 'expired', 'invalid-time']) {
    const invite = await accessAction(f.db, actor, 'invite.create', {
      email: memberUser.email, role: 'viewer', projectId: 'role',
    }, origin);
    if (condition === 'revoked') await accessAction(f.db, actor, 'invite.revoke', { id: invite.id }, origin);
    else f.sqlite.prepare('UPDATE invites SET expires_at=? WHERE id=?').run(
      condition === 'expired' ? new Date(Date.now() - 1000).toISOString() : 'zzzz', invite.id,
    );
    await rejected(accessAction(f.db, await getActor(f.db, memberUser), 'invite.accept', {
      token: tokenOf(invite),
    }, origin), condition === 'revoked' ? 'invite_revoked' : 'invite_expired', 409);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(memberUser.userId).n, 0);
});

test('acceptance rechecks the issuing manager in SQL after revocation', async (t) => {
  const f = closeAfter(t, fixture());
  await owner(f);
  const managerId = f.seed(memberUser, 'manager', 'role');
  const manager = await getActor(f.db, memberUser);
  const user = { ...memberUser, userId: 'recipient', email: 'recipient@example.test' };
  const invite = await accessAction(f.db, manager, 'invite.create', {
    email: user.email, role: 'operator', projectId: 'role',
  }, origin);
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), managerId);
  await rejected(accessAction(f.db, await getActor(f.db, user), 'invite.accept', {
    token: tokenOf(invite),
  }, origin), 'invite_not_accepted', 409);
  assert.equal(f.sqlite.prepare('SELECT accepted_at FROM invites WHERE id=?').get(invite.id).accepted_at, null);
});

test('conditional SQL rejects invitation creation with a stale revoked actor snapshot', async (t) => {
  const f = closeAfter(t, fixture());
  await owner(f);
  const id = f.seed(memberUser, 'manager', 'role');
  const stale = await getActor(f.db, memberUser);
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), id);
  await rejected(accessAction(f.db, stale, 'invite.create', {
    email: 'recipient@example.test', role: 'operator', projectId: 'role',
  }, origin), 'access_changed', 403);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 0);
});

for (const issuerRole of ['owner', 'manager']) {
  for (const condition of ['blocked', 'pending']) {
    test(`${condition} ${issuerRole} cannot leave an existing invitation acceptable`, async t => {
      const f = closeAfter(t, fixture()), ownerActor = await owner(f);
      if (issuerRole === 'manager') f.seed(memberUser, 'manager', 'role');
      const issuerUser = issuerRole === 'owner' ? ownerUser : memberUser;
      const issuer = issuerRole === 'owner' ? ownerActor : await getActor(f.db, issuerUser);
      const recipientUser = { userId: 'recipient', email: 'recipient@example.test', displayName: 'Destinatário' };
      const invite = await accessAction(f.db, issuer, 'invite.create', {
        email: recipientUser.email, role: 'viewer', projectId: 'role',
      }, origin);
      const recipient = await getActor(f.db, recipientUser);
      // Account state changes after the invite and actor snapshots exist. Memberships remain active.
      f.accountState(issuerUser, condition === 'blocked' ? 'blocked' : 'active', condition === 'pending' ? 1 : 0);
      await rejected(accessAction(f.db, recipient, 'invite.accept', { token: tokenOf(invite) }, origin), 'invite_not_accepted', 409);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(recipientUser.userId).n, 0);
      assert.equal(f.sqlite.prepare('SELECT accepted_at FROM invites WHERE id=?').get(invite.id).accepted_at, null);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM audit WHERE action='invite.accept'").get().n, 0);
      f.accountState(issuerUser, 'active', 0);
      assert.equal((await accessAction(f.db, recipient, 'invite.accept', { token: tokenOf(invite) }, origin)).accepted, true);
    });

    test(`stale ${condition} ${issuerRole} cannot create or revoke invites or memberships`, async t => {
      const f = closeAfter(t, fixture()), ownerActor = await owner(f);
      if (issuerRole === 'manager') f.seed(memberUser, 'manager', 'role');
      const issuerUser = issuerRole === 'owner' ? ownerUser : memberUser;
      const issuer = issuerRole === 'owner' ? ownerActor : await getActor(f.db, issuerUser);
      const targetUser = { userId: 'operator', email: 'operator@example.test', displayName: 'Operador' };
      const targetMember = f.seed(targetUser, 'operator', 'role');
      const inviteInput = { email: 'recipient@example.test', role: 'viewer', projectId: 'role' };
      const invite = await accessAction(f.db, issuer, 'invite.create', inviteInput, origin);
      const originalAudits = f.sqlite.prepare('SELECT COUNT(*) n FROM audit').get().n;
      f.accountState(issuerUser, condition === 'blocked' ? 'blocked' : 'active', condition === 'pending' ? 1 : 0);
      await rejected(accessAction(f.db, issuer, 'invite.create', inviteInput, origin), 'access_changed', 403);
      await rejected(accessAction(f.db, issuer, 'invite.revoke', { id: invite.id }, origin), 'access_changed', 409);
      await rejected(accessAction(f.db, issuer, 'member.revoke', { id: targetMember }, origin), 'member_not_revoked', 409);
      assert.equal(f.sqlite.prepare('SELECT revoked_at FROM members WHERE id=?').get(targetMember).revoked_at, null);
      assert.equal(f.sqlite.prepare('SELECT revoked_at FROM invites WHERE id=?').get(invite.id).revoked_at, null);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n, 1);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit').get().n, originalAudits);
    });
  }
}

test('invite acceptance checks issuer account state again inside its SQL batch', async t => {
  const f = closeAfter(t, fixture()), issuer = await owner(f);
  const invite = await accessAction(f.db, issuer, 'invite.create', {
    email: memberUser.email, role: 'viewer', projectId: 'role',
  }, origin);
  const recipient = await getActor(f.db, memberUser);
  f.db.beforeBatch = () => f.accountState(ownerUser, 'blocked');
  await rejected(accessAction(f.db, recipient, 'invite.accept', { token: tokenOf(invite) }, origin), 'invite_not_accepted', 409);
  assert.equal(f.sqlite.prepare('SELECT accepted_at FROM invites WHERE id=?').get(invite.id).accepted_at, null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(memberUser.userId).n, 0);
});

test('revoking a used invitation does not silently revoke its accepted membership', async (t) => {
  const f = closeAfter(t, fixture());
  const actor = await owner(f);
  const invite = await accessAction(f.db, actor, 'invite.create', {
    email: memberUser.email, role: 'operator', projectId: 'role',
  }, origin);
  await accessAction(f.db, await getActor(f.db, memberUser), 'invite.accept', { token: tokenOf(invite) }, origin);
  await rejected(accessAction(f.db, actor, 'invite.revoke', { id: invite.id }, origin), 'invite_used', 409);
  assert.equal((await getActor(f.db, memberUser)).members.length, 1);
});

test('member revocation is project scoped and managers cannot revoke managers or owners', async (t) => {
  const f = closeAfter(t, fixture());
  const ownerActor = await owner(f);
  const managerId = f.seed(memberUser, 'manager', 'role');
  const manager = await getActor(f.db, memberUser);
  const lower = { ...memberUser, userId: 'operator' };
  const ownId = f.seed(lower, 'operator', 'role');
  const otherId = f.seed(lower, 'operator', 'other');
  await assert.rejects(accessAction(f.db, manager, 'member.revoke', { id: otherId }, origin), { status: 403 });
  await rejected(accessAction(f.db, manager, 'member.revoke', { id: managerId }, origin), 'forbidden', 403);
  await assert.rejects(accessAction(f.db, manager, 'member.revoke', { id: ownerActor.members[0].id }, origin), { status: 403 });
  await accessAction(f.db, manager, 'member.revoke', { id: ownId }, origin);
  assert.equal((await getActor(f.db, lower)).members.length, 1);
  assert.deepEqual(accessibleProjects(await getActor(f.db, lower)), ['other']);
});

test('the last actual global owner is protected in SQL, including concurrent mutual revocation', async (t) => {
  const f = closeAfter(t, fixture());
  const first = await owner(f);
  await rejected(accessAction(f.db, first, 'member.revoke', { id: first.members[0].id }, origin), 'member_not_revoked', 409);
  const secondUser = { ...ownerUser, userId: 'owner-b', email: 'second@example.test' };
  f.seed(secondUser, 'owner');
  const second = await getActor(f.db, secondUser);
  const results = await Promise.allSettled([
    accessAction(f.db, first, 'member.revoke', { id: second.members[0].id }, origin),
    accessAction(f.db, second, 'member.revoke', { id: first.members[0].id }, origin),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(DISTINCT user_id) n FROM members WHERE role='owner' AND revoked_at IS NULL").get().n, 1);
});

test('a new invite after revocation creates a fresh membership and preserves the old history', async (t) => {
  const f = closeAfter(t, fixture());
  const actor = await owner(f);
  const oldId = f.seed(memberUser, 'operator', 'role');
  await accessAction(f.db, actor, 'member.revoke', { id: oldId }, origin);
  const invite = await accessAction(f.db, actor, 'invite.create', {
    email: memberUser.email, role: 'viewer', projectId: 'role',
  }, origin);
  const accepted = await accessAction(f.db, await getActor(f.db, memberUser), 'invite.accept', {
    token: tokenOf(invite),
  }, origin);
  assert.notEqual(accepted.memberId, oldId);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(memberUser.userId).n, 2);
  assert.equal((await getActor(f.db, memberUser)).members[0].role, 'viewer');
});

test('failed audit causes SQL transaction rollback of membership and invitation acceptance', async (t) => {
  const f = closeAfter(t, fixture());
  const invite = await accessAction(f.db, await owner(f), 'invite.create', {
    email: memberUser.email, role: 'viewer', projectId: 'role',
  }, origin);
  f.sqlite.exec(`CREATE TRIGGER audit_failure BEFORE INSERT ON audit
    WHEN NEW.action='invite.accept' BEGIN SELECT RAISE(ABORT,'simulated_audit_failure'); END;`);
  await assert.rejects(accessAction(f.db, await getActor(f.db, memberUser), 'invite.accept', {
    token: tokenOf(invite),
  }, origin), /simulated_audit_failure/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(memberUser.userId).n, 0);
  assert.equal(f.sqlite.prepare('SELECT accepted_at FROM invites WHERE id=?').get(invite.id).accepted_at, null);
});

test('audit utility removes credential-like and contact values', async (t) => {
  const f = closeAfter(t, fixture());
  const actor = await owner(f);
  await writeAudit(f.db, actor, 'test.audit', 'item-1', 'role', {
    quantity: 2, token: 'secret-value', url: 'https://x.test/?token=secret-value',
    contact: 'person@example.test', nested: { password: 'secret-value' },
  });
  const details = f.sqlite.prepare("SELECT details FROM audit WHERE action='test.audit'").get().details;
  assert.equal(details.includes('secret-value'), false);
  assert.equal(details.includes('person@example.test'), false);
  assert.equal(JSON.parse(details).quantity, 2);
});
