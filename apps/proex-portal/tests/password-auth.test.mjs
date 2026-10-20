import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Real Better Auth, password hashing, Drizzle queries and migrated SQLite. Only
// the Cloudflare/Next transport and the already-trusted native identity boundary
// are replaced. These synthetic fixtures never write to a deployed database.
const temporary = mkdtempSync(join(tmpdir(), 'proex-password-auth-'));
writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
symlinkSync(new URL('../node_modules/', import.meta.url), join(temporary, 'node_modules'), 'dir');
const replacements = new Map([
  ['@/db/auth-schema', './auth-schema.js'],
  ['@/app/chatgpt-auth', './native-auth.js'],
  ['next/headers', './request-headers.js'],
]);
function compile(source, target) {
  let output = ts.transpileModule(readFileSync(new URL(source, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of replacements) output = output.replaceAll(`'${from}'`, `'${to}'`);
  output = output.replace(/from '(?:@\/lib\/|\.\/)([^']+)'/g, (_, name) => `from './${name.endsWith('.js') ? name : `${name}.js`}'`);
  if (target === 'session') output = output.replace("from './password-auth.js'", "from './configured-auth.js'");
  writeFileSync(join(temporary, `${target}.js`), output);
}
compile('../db/auth-schema.ts', 'auth-schema');
for (const name of ['password-auth', 'session', 'access', 'database', 'errors', 'http', 'rate-limit', 'mutations']) compile(`../lib/${name}.ts`, name);
compile('../app/api/account/route.ts', 'account-route');
compile('../app/api/auth/[...all]/route.ts', 'auth-route');
writeFileSync(join(temporary, 'request-headers.js'), 'export async function headers(){return globalThis.__proexPasswordTestContext.headers;}');
writeFileSync(join(temporary, 'native-auth.js'), 'export async function getChatGPTUser(){return globalThis.__proexPasswordTestContext.native ?? null;}');
writeFileSync(join(temporary, 'platform.js'), 'export function database(){return globalThis.__proexPasswordTestContext.db;} export function ownerEmail(){return globalThis.__proexPasswordTestContext.ownerEmail;}');
writeFileSync(join(temporary, 'configured-auth.js'), `
 import {passwordAuth as actual} from './password-auth.js';
 export function passwordAuth(db,options={}){return actual(db,{...options,runtimeEnv:globalThis.__proexPasswordTestContext.runtimeEnv});}
`);
after(() => {
  delete globalThis.__proexPasswordTestContext;
  rmSync(temporary, { recursive: true, force: true });
});
const { passwordAuth } = await import(pathToFileURL(join(temporary, 'password-auth.js')).href);
const { getPortalUser, ensureNativePrincipal } = await import(pathToFileURL(join(temporary, 'session.js')).href);
const { getActor, requireCapability, accessAction } = await import(pathToFileURL(join(temporary, 'access.js')).href);
const { POST: accountPost } = await import(pathToFileURL(join(temporary, 'account-route.js')).href);
const { GET: authGet } = await import(pathToFileURL(join(temporary, 'auth-route.js')).href);
const origin = 'https://portal.example.test';
const originalPassword = 'Uma frase de teste 2026!';

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  const hooks = {};
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
  }
  function prepare(sql, parameters = []) {
    return {
      bind(...values) { return prepare(sql, values); },
      async first(column) {
        const row = sqlite.prepare(sql).get(...parameters);
        if (hooks.afterFirst) await hooks.afterFirst(sql, parameters, row);
        return column ? row?.[column] ?? null : row ?? null;
      },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...parameters), meta: {} }; },
      async raw() {
        const statement = sqlite.prepare(sql);
        statement.setReturnArrays(true);
        return statement.all(...parameters);
      },
      async run() { return this.execute(); },
      execute() {
        const result = sqlite.prepare(sql).run(...parameters);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
    };
  }
  const db = {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        hooks.afterBatch?.();
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const runtimeEnv = { BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID() };
  const context = { db, runtimeEnv, headers: new Headers(), native: null, ownerEmail: undefined };
  globalThis.__proexPasswordTestContext = context;
  t.after(() => {
    if (globalThis.__proexPasswordTestContext === context) delete globalThis.__proexPasswordTestContext;
    sqlite.close();
  });
  function seedPrincipal(id, email, { status = 'active', pending = 0, role = 'viewer' } = {}) {
    const now = new Date().toISOString();
    sqlite.prepare('INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(id, email, status, pending, now, now);
    sqlite.prepare('INSERT INTO profiles(user_id,display_name,version,created_at,updated_at) VALUES(?,?,1,?,?)')
      .run(id, `Perfil ${id}`, now, now);
    sqlite.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,NULL,NULL,?)')
      .run(crypto.randomUUID(), id, email, role, now);
  }
  function alias(authUserId, canonicalId) {
    sqlite.prepare("INSERT INTO identity_aliases(provider,subject,user_id,created_at) VALUES('password',?,?,?)")
      .run(authUserId, canonicalId, new Date().toISOString());
  }
  return { sqlite, db, runtimeEnv, context, seedPrincipal, alias, hooks };
}

async function createAccount(f, email = 'pessoa@example.test') {
  const auth = await passwordAuth(f.db, { runtimeEnv: f.runtimeEnv });
  const { user } = await auth.api.createUser({ body: { email, password: originalPassword, name: 'Pessoa de teste', role: 'user' } });
  return { auth, user };
}
function cookieFrom(response) {
  const values = response.headers.getSetCookie();
  assert.ok(values.length, 'authentication response must carry its Set-Cookie headers');
  return values.map(value => value.split(';')[0]).join('; ');
}
async function signIn(auth, email, password = originalPassword) {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  assert.equal(response.status, 200);
  return { response, cookie: cookieFrom(response) };
}
async function recovery(f, email) {
  let captured;
  const auth = await passwordAuth(f.db, { runtimeEnv: f.runtimeEnv, captureReset: (url, token) => { captured = { url, token }; } });
  await auth.api.requestPasswordReset({ body: { email, redirectTo: `${origin}/redefinir-senha` } });
  assert.ok(captured?.token);
  return { auth, ...captured };
}
function status(error, expected) { return Number(error?.statusCode ?? error?.status) === expected; }
async function accountRequest(f, input, { cookie, omitHeader, requestOrigin = origin } = {}) {
  const headers = new Headers({ Origin: requestOrigin, 'Content-Type': 'application/json', 'X-Proex-Action': '1' });
  if (cookie) headers.set('Cookie', cookie);
  if (omitHeader) headers.delete(omitHeader);
  const request = new Request(`${origin}/api/account`, { method: 'POST', headers, body: JSON.stringify(input) });
  f.context.headers = request.headers;
  return accountPost(request);
}

test('configuration fails closed and permits HTTP only with an explicit local development option', async t => {
  const f = fixture(t);
  for (const url of [undefined, '', 'not a url', 'http://portal.example.test', `${origin}/api/auth`, `${origin}?key=x`, 'https://name:secret@portal.example.test', `${origin}#fragment`]) {
    await assert.rejects(passwordAuth(f.db, { runtimeEnv: { ...f.runtimeEnv, BETTER_AUTH_URL: url } }), error => error.code === 'password_auth_unavailable');
  }
  for (const secret of [undefined, '', 'too-short']) {
    await assert.rejects(passwordAuth(f.db, { runtimeEnv: { ...f.runtimeEnv, BETTER_AUTH_SECRET: secret } }), error => error.code === 'password_auth_unavailable');
  }
  await assert.rejects(passwordAuth(f.db, { runtimeEnv: { ...f.runtimeEnv, BETTER_AUTH_URL: 'http://terminal.local:4173' } }));
  await assert.rejects(passwordAuth(f.db, { runtimeEnv: { ...f.runtimeEnv, BETTER_AUTH_URL: 'http://evil.terminal.local:4173' }, allowInsecureDevelopment: true }));
  const local = await passwordAuth(f.db, { runtimeEnv: { ...f.runtimeEnv, BETTER_AUTH_URL: 'http://terminal.local:4173' }, allowInsecureDevelopment: true });
  assert.equal((await local.$context).baseURL, 'http://terminal.local:4173/api/auth');
});

test('controlled account creation stores a salted scrypt hash and never assigns a PROEX role', async t => {
  const f = fixture(t), { auth, user } = await createAccount(f);
  assert.equal(user.role, 'user');
  assert.equal(user.emailVerified, false);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members').get().n, 0);
  const stored = f.sqlite.prepare('SELECT password FROM auth_account WHERE user_id=?').get(user.id).password;
  assert.match(stored, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.ok(!stored.includes(originalPassword));
  await assert.rejects(auth.api.createUser({ body: { email: 'elevado@example.test', password: originalPassword, name: 'Elevado', role: 'admin' } }));
  // The upstream administrative API enforces a maximum only. Portal onboarding
  // validates the minimum before calling it; regular reset/change APIs enforce it.
  await assert.rejects(auth.api.createUser({ body: { email: 'longa@example.test', password: 'a'.repeat(129), name: 'Longa', role: 'user' } }));
  await assert.rejects(auth.api.signUpEmail({ body: { email: 'livre@example.test', password: originalPassword, name: 'Sem convite' } }));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_user').get().n, 1);
});

test('server-only createUser does not make the HTTP admin endpoint accessible', async t => {
  const f = fixture(t), { auth, user } = await createAccount(f);
  const anonymous = await auth.handler(new Request(`${origin}/api/auth/admin/create-user`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
    body: JSON.stringify({ email: 'fora@example.test', password: originalPassword, name: 'Fora', role: 'user' }),
  }));
  assert.equal(anonymous.status, 401);
  const { cookie } = await signIn(auth, user.email);
  const ordinary = await auth.handler(new Request(`${origin}/api/auth/admin/create-user`, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.2' },
    body: JSON.stringify({ email: 'outro@example.test', password: originalPassword, name: 'Outro', role: 'user' }),
  }));
  assert.equal(ordinary.status, 403);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_user').get().n, 1);
});

test('login uses secure HttpOnly cookies and database revocation is effective immediately', async t => {
  const f = fixture(t), { auth, user } = await createAccount(f);
  const { response, cookie } = await signIn(auth, user.email);
  const setCookie = response.headers.getSetCookie().join(';');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.ok(!setCookie.includes('session_data'), 'a cached identity must not replace fresh database sessions');
  assert.equal((await auth.api.getSession({ headers: new Headers({ cookie }) })).user.id, user.id);
  await assert.rejects(auth.api.signInEmail({ body: { email: user.email, password: 'Uma senha incorreta 2026!' } }), error => status(error, 401));
  f.sqlite.prepare('DELETE FROM auth_session WHERE user_id=?').run(user.id);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie }) }), null);
});

test('only a scoped recovery instance can issue a hashed reset credential with a 30 minute expiry', async t => {
  const f = fixture(t), { auth, user } = await createAccount(f);
  await assert.rejects(auth.api.requestPasswordReset({ body: { email: user.email } }), error => error.body?.code === 'RESET_PASSWORD_DISABLED');
  const before = Date.now(), captured = await recovery(f, user.email);
  const stored = f.sqlite.prepare('SELECT * FROM auth_verification').get();
  assert.equal(stored.value, user.id);
  assert.ok(!stored.identifier.includes(captured.token));
  assert.ok(stored.expires_at >= before + 29 * 60 * 1000);
  assert.ok(stored.expires_at <= Date.now() + 30 * 60 * 1000);
  assert.equal(new URL(captured.url).origin, origin);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_session').get().n, 0);
});

test('reset is single use, expires, changes credentials and revokes every previous session', async t => {
  const f = fixture(t), { auth, user } = await createAccount(f);
  const first = await signIn(auth, user.email), second = await signIn(auth, user.email);
  const captured = await recovery(f, user.email), newPassword = 'Uma nova frase de teste 2026!';
  await assert.rejects(captured.auth.api.resetPassword({ body: { token: captured.token, newPassword: 'curta' } }));
  await captured.auth.api.resetPassword({ body: { token: captured.token, newPassword } });
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_session').get().n, 0);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: first.cookie }) }), null);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: second.cookie }) }), null);
  await assert.rejects(captured.auth.api.resetPassword({ body: { token: captured.token, newPassword: originalPassword } }));
  await assert.rejects(auth.api.signInEmail({ body: { email: user.email, password: originalPassword } }));
  await signIn(auth, user.email, newPassword);
  const expired = await recovery(f, user.email);
  f.sqlite.prepare('UPDATE auth_verification SET expires_at=?').run(Date.now() - 1000);
  await assert.rejects(expired.auth.api.resetPassword({ body: { token: expired.token, newPassword: originalPassword } }));
});

test('concurrent redemption of one reset token has exactly one winner', async t => {
  const f = fixture(t), { user } = await createAccount(f), captured = await recovery(f, user.email);
  const result = await Promise.allSettled([
    captured.auth.api.resetPassword({ body: { token: captured.token, newPassword: 'Primeira senha concorrente 2026!' } }),
    captured.auth.api.resetPassword({ body: { token: captured.token, newPassword: 'Segunda senha concorrente 2026!' } }),
  ]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(result.filter(item => item.status === 'rejected').length, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_verification').get().n, 0);
});

test('changing a password rotates the current cookie and revokes all old sessions', async t => {
  const f = fixture(t), { auth, user } = await createAccount(f);
  const first = await signIn(auth, user.email), second = await signIn(auth, user.email);
  const changed = await auth.api.changePassword({
    body: { currentPassword: originalPassword, newPassword: 'Senha alterada em perfil 2026!', revokeOtherSessions: true },
    headers: new Headers({ cookie: first.cookie }), asResponse: true,
  });
  assert.equal(changed.status, 200);
  const replacement = cookieFrom(changed);
  assert.notEqual(replacement, first.cookie);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: first.cookie }) }), null);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: second.cookie }) }), null);
  assert.equal((await auth.api.getSession({ headers: new Headers({ cookie: replacement }) })).user.id, user.id);
});

test('portal identity resolves the canonical alias and never links an account by matching email', async t => {
  const f = fixture(t), { auth, user } = await createAccount(f);
  const legacyId = 'legacy-owner-preserved';
  f.seedPrincipal(legacyId, user.email, { role: 'owner' });
  f.context.ownerEmail = user.email;
  const { cookie } = await signIn(auth, user.email);
  f.context.headers = new Headers({ cookie });
  assert.equal(await getPortalUser(), null, 'same-email memberships are not proof of a canonical identity');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM identity_aliases').get().n, 0);
  f.alias(user.id, legacyId);
  const canonical = await getPortalUser();
  assert.equal(canonical.userId, legacyId);
  assert.equal(canonical.credentialId, user.id);
  assert.notEqual(canonical.userId, user.id);
  assert.equal(canonical.source, 'password');
  assert.equal(canonical.hasPassword, true);
  assert.equal((await getActor(f.db, canonical)).members[0].user_id, legacyId);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members').get().n, 1);
});

test('pending or blocked canonical accounts cannot use an otherwise valid password session', async t => {
  const f = fixture(t), { auth, user } = await createAccount(f);
  f.seedPrincipal('pending-user', user.email, { pending: 1 });
  f.alias(user.id, 'pending-user');
  f.context.headers = new Headers({ cookie: (await signIn(auth, user.email)).cookie });
  assert.equal(await getPortalUser(), null);
  f.sqlite.prepare("UPDATE portal_users SET activation_pending=0,status='blocked' WHERE user_id='pending-user'").run();
  await assert.rejects(getPortalUser(), error => error.code === 'account_blocked');
  f.sqlite.prepare("UPDATE portal_users SET status='active' WHERE user_id='pending-user'").run();
  f.sqlite.prepare("UPDATE members SET revoked_at=? WHERE user_id='pending-user'").run(new Date().toISOString());
  const actor = await getActor(f.db, await getPortalUser());
  assert.deepEqual(actor.members, []);
  assert.throws(() => requireCapability(actor, 'reports.read'), error => error.status === 403);
});

test('native identity is a one-time bridge and stops substituting for a linked password account', async t => {
  const f = fixture(t), { user } = await createAccount(f);
  const native = { userId: 'native-existing-user', email: user.email, displayName: 'Pessoa anterior' };
  f.seedPrincipal(native.userId, native.email);
  f.context.native = native;
  assert.equal((await ensureNativePrincipal()).userId, native.userId);
  assert.equal(await getPortalUser(), null, 'native proof is confined to the explicit migration endpoint');
  f.alias(user.id, native.userId);
  assert.equal(await getPortalUser(), null, 'native cookies must not bypass the configured password');
  f.context.native = null;
  f.context.headers = new Headers({ cookie: 'proex.session_token=forged-value' });
  assert.equal(await getPortalUser(), null);
});

test('account endpoint rejects cross-origin or incomplete requests before issuing credentials', async t => {
  const f = fixture(t);
  for (const options of [{ requestOrigin: 'https://another.example.test' }, { omitHeader: 'Origin' }, { omitHeader: 'X-Proex-Action' }, { omitHeader: 'Content-Type' }]) {
    const response = await accountRequest(f, { action: 'activateInvite', token: 'x'.repeat(43), password: originalPassword, name: 'Pessoa' }, options);
    assert.equal(response.status, 403);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal(response.headers.getSetCookie().length, 0);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_user').get().n, 0);
});

test('account login admits only an active canonical registration and preserves the login cookie', async t => {
  const f = fixture(t), { user } = await createAccount(f);
  const input = { action: 'login', email: user.email, password: originalPassword };
  assert.equal((await accountRequest(f, input)).status, 401);
  f.seedPrincipal('admitted-user', user.email, { pending: 1 });
  f.alias(user.id, 'admitted-user');
  assert.equal((await accountRequest(f, input)).status, 401);
  f.sqlite.prepare("UPDATE portal_users SET activation_pending=0,status='blocked'").run();
  assert.equal((await accountRequest(f, input)).status, 401);
  f.sqlite.prepare("UPDATE portal_users SET status='active'").run();
  f.context.ownerEmail = user.email;
  const admitted = await accountRequest(f, input);
  assert.equal(admitted.status, 200);
  assert.match(admitted.headers.get('Cache-Control'), /no-store/);
  f.context.headers = new Headers({ cookie: cookieFrom(admitted) });
  assert.equal((await getPortalUser()).userId, 'admitted-user');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM members WHERE role='owner'").get().n, 0, 'a typed password email is never native bootstrap proof');
});

test('invitation activation derives the grant from its stored token and safely repeats after success', async t => {
  const f = fixture(t);
  f.seedPrincipal('inviting-owner', 'owner@example.test', { role: 'owner' });
  const owner = await getActor(f.db, { userId: 'inviting-owner', email: 'owner@example.test', displayName: 'Responsável' });
  const invite = await accessAction(f.db, owner, 'invite.create', { email: 'convidada@example.test', role: 'viewer', operationKey: crypto.randomUUID() }, origin, f.runtimeEnv.BETTER_AUTH_SECRET);
  const token = new URL(invite.inviteUrl).searchParams.get('token');
  const input = { action: 'activateInvite', token, name: 'Pessoa convidada', password: originalPassword, role: 'owner', userId: owner.userId, projectId: 'invented' };
  const response = await accountRequest(f, input);
  assert.equal(response.status, 200);
  f.context.headers = new Headers({ cookie: cookieFrom(response) });
  const canonical = await getPortalUser();
  assert.ok(canonical);
  assert.notEqual(canonical.userId, owner.userId);
  const assigned = f.sqlite.prepare('SELECT * FROM members WHERE user_id=?').all(canonical.userId);
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].role, 'viewer');
  assert.equal(assigned[0].project_id, null);
  assert.equal(f.sqlite.prepare('SELECT accepted_by FROM invites WHERE id=?').get(invite.id).accepted_by, canonical.userId);
  assert.equal(f.sqlite.prepare('SELECT activation_pending FROM portal_users WHERE user_id=?').get(canonical.userId).activation_pending, 0);
  const repeated = await accountRequest(f, input);
  assert.equal(repeated.status, 200);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(canonical.userId).n, 1);
  assert.equal((await accountRequest(f, { ...input, password: 'Uma senha errada 2026!' })).status, 401);
});

test('initial password linking requires proof of both the native principal and an existing credential', async t => {
  const f = fixture(t), { user } = await createAccount(f);
  const native = { userId: 'native-principal-kept', email: user.email, displayName: 'Pessoa anterior' };
  f.seedPrincipal(native.userId, native.email, { role: 'owner' });
  f.context.native = native;
  const input = { action: 'initialPassword', name: 'Nome atualizado', password: 'Uma senha errada 2026!' };
  assert.equal((await accountRequest(f, input)).status, 401);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM identity_aliases WHERE provider='password'").get().n, 0);
  const response = await accountRequest(f, { ...input, password: originalPassword });
  assert.equal(response.status, 200);
  f.context.headers = new Headers({ cookie: cookieFrom(response) });
  const canonical = await getPortalUser();
  assert.equal(canonical.userId, native.userId);
  assert.equal(canonical.displayName, input.name);
  assert.equal(f.sqlite.prepare("SELECT user_id FROM identity_aliases WHERE provider='password'").get().user_id, native.userId);
  assert.equal((await accountRequest(f, { ...input, password: originalPassword })).status, 409);
});

test('account password-change response forwards the replacement cookie instead of losing the current session', async t => {
  const f = fixture(t), { auth, user } = await createAccount(f);
  f.seedPrincipal('changing-user', user.email);
  f.alias(user.id, 'changing-user');
  const first = await signIn(auth, user.email);
  const changed = await accountRequest(f, { action: 'changePassword', currentPassword: originalPassword, newPassword: 'Nova senha da equipe 2026!' }, { cookie: first.cookie });
  assert.equal(changed.status, 200);
  const replacement = cookieFrom(changed);
  f.context.headers = new Headers({ cookie: replacement });
  assert.equal((await getPortalUser()).userId, 'changing-user');
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: first.cookie }) }), null);
});

test('simultaneous invite activations grant access to the persisted canonical alias', { timeout: 15000 }, async t => {
  const f = fixture(t), { user } = await createAccount(f, 'race@example.test');
  f.seedPrincipal('race-inviting-owner', 'owner@example.test', { role: 'owner' });
  const owner = await getActor(f.db, { userId: 'race-inviting-owner', email: 'owner@example.test', displayName: 'Responsável' });
  const invite = await accessAction(f.db, owner, 'invite.create', { email: user.email, role: 'viewer', operationKey: crypto.randomUUID() }, origin, f.runtimeEnv.BETTER_AUTH_SECRET);
  const token = new URL(invite.inviteUrl).searchParams.get('token');
  let initialReads = 0, releaseAliasReads, releaseFirstStatus, firstStatusUser, secondStatusUser;
  const aliasReads = new Promise(resolve => { releaseAliasReads = resolve; });
  const firstStatus = new Promise(resolve => { releaseFirstStatus = resolve; });
  f.hooks.afterFirst = async (sql, parameters, row) => {
    // Force both requests to observe a missing alias before either inserts it.
    if (/SELECT user_id FROM identity_aliases WHERE provider='password' AND subject=\?/.test(sql)
      && !row && initialReads < 2) {
      initialReads++;
      if (initialReads === 2) releaseAliasReads();
      await aliasReads;
    }
    if (/SELECT status FROM portal_users WHERE user_id=\?/.test(sql)) {
      if (!firstStatusUser) {
        firstStatusUser = parameters[0];
        await firstStatus;
      } else {
        secondStatusUser = parameters[0];
        // Correct code adopts the persisted alias before any grant. Old code
        // continued with its discarded new id; allow that request to win first.
        if (secondStatusUser === firstStatusUser) releaseFirstStatus();
      }
    }
  };
  f.hooks.afterBatch = () => {
    const accepted = f.sqlite.prepare('SELECT accepted_by FROM invites WHERE id=?').get(invite.id)?.accepted_by;
    if (secondStatusUser && accepted === secondStatusUser) releaseFirstStatus();
  };
  const input = { action: 'activateInvite', token, name: 'Pessoa concorrente', password: originalPassword };
  const results = await Promise.all([accountRequest(f, input), accountRequest(f, input)]);
  assert.equal(initialReads, 2);
  assert.ok(results.some(response => response.status === 200));
  assert.ok(results.every(response => [200, 409].includes(response.status)));
  const alias = f.sqlite.prepare("SELECT user_id FROM identity_aliases WHERE provider='password' AND subject=?").get(user.id);
  const accepted = f.sqlite.prepare('SELECT accepted_by FROM invites WHERE id=?').get(invite.id);
  assert.equal(accepted.accepted_by, alias.user_id);
  assert.equal(f.sqlite.prepare('SELECT activation_pending FROM portal_users WHERE user_id=?').get(alias.user_id).activation_pending, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(alias.user_id).n, 1);
  f.context.headers = new Headers({ cookie: cookieFrom(results.find(response => response.status === 200)) });
  assert.equal((await getPortalUser()).userId, alias.user_id);
});

test('blocking an account during password verification prevents a new usable session', async t => {
  const f = fixture(t), { user } = await createAccount(f);
  f.seedPrincipal('blocked-during-login', user.email);
  f.alias(user.id, 'blocked-during-login');
  let blocked = false, scheduled = false, timer;
  t.after(() => clearTimeout(timer));
  f.hooks.afterFirst = async (sql, _parameters, row) => {
    if (!scheduled && row?.status === 'active' && /FROM auth_user a JOIN identity_aliases/.test(sql)) {
      scheduled = true;
      // Scrypt runs asynchronously. An administrator's block can commit after
      // admission was read and before the successful hash check creates a session.
      timer = setTimeout(() => {
        f.sqlite.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='blocked-during-login'").run();
        f.sqlite.prepare('DELETE FROM auth_session WHERE user_id=?').run(user.id);
        blocked = true;
      }, 0);
    }
  };
  const response = await accountRequest(f, { action: 'login', email: user.email, password: originalPassword });
  assert.equal(blocked, true);
  assert.equal(response.status, 403);
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_session WHERE user_id=?').get(user.id).n, 0);
});

test('HTTP auth wrapper keeps session responses private and hides signup, reset issuance and admin APIs', async t => {
  const f = fixture(t), { auth, user } = await createAccount(f);
  const { cookie } = await signIn(auth, user.email);
  const listed = await authGet(new Request(`${origin}/api/auth/list-sessions`, { headers: { Cookie: cookie, 'cf-connecting-ip': '192.0.2.3' } }));
  assert.equal(listed.status, 200);
  assert.match(listed.headers.get('Cache-Control'), /private/);
  assert.match(listed.headers.get('Cache-Control'), /no-store/);
  for (const path of ['sign-up/email', 'sign-in/email', 'admin/create-user', 'request-password-reset']) {
    const response = await authGet(new Request(`${origin}/api/auth/${path}`));
    assert.equal(response.status, 404);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
});
