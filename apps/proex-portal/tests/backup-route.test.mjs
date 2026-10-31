import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { compile, root } from './support/traffic-fixture.mjs';
import { backupFixture } from './support/backup-fixture.mjs';
const replacements = new Map([
  [resolve(root, 'lib/platform.ts'), 'export function database(){return globalThis.__proexBackupRoute.db;}'],
  [resolve(root, 'lib/session.ts'), 'export async function getPortalUser(){return globalThis.__proexBackupRoute.user;}'],
  [resolve(root, 'lib/backup.ts'), 'export function completeBackupBinding(){return globalThis.__proexBackupRoute.binding;}'],
]);
const route = await import(compile('app/api/backup/route.ts', replacements)), fixtures = [];
after(() => { for (const fixture of fixtures) fixture.close(); delete globalThis.__proexBackupRoute; });
const password = 'Synthetic route protection 2026!';
function fixture() {
  const f = backupFixture(); fixtures.push(f);
  const state = { db: f.db, user: f.actor, calls: 0, binding: null };
  state.binding = { limits: { totalBytes: 64 * 1024 * 1024 }, createEncrypted: async userId => { assert.equal(userId, f.actor.userId); state.calls++; return new Uint8Array(140000).fill(0x7a); } };
  globalThis.__proexBackupRoute = state; return { ...f, state };
}
function request(body = { password }, headers = {}) { return new Request('https://synthetic.invalid/api/backup', { method: 'POST', headers: { Origin: 'https://synthetic.invalid', 'Content-Type': 'application/json', 'X-Proex-Action': '1', ...headers }, body: JSON.stringify(body) }); }

test('backup is available only to a currently active global owner, never project scopes or forged roles', async () => {
  const f = fixture(); assert.equal((await route.GET()).status, 200);
  f.native.exec("UPDATE members SET role='manager',project_id='project-fixture'");
  f.state.user = { ...f.actor, capabilities: ['organization.manage'], members: [{ role: 'owner', project_id: null }] };
  assert.equal((await route.GET()).status, 403); assert.equal((await route.POST(request())).status, 403); assert.equal(f.state.calls, 0);
  f.native.exec("UPDATE members SET role='owner',project_id=NULL; UPDATE portal_users SET status='blocked'");
  assert.equal((await route.POST(request())).status, 401);
  f.state.user = null; assert.equal((await route.POST(request())).status, 401);
});
test('strict CSRF and bounded payloads prevent export before cryptography, and password is never echoed', async () => {
  const f = fixture();
  for (const headers of [{ Origin: '' }, { Origin: 'https://other.invalid' }, { 'X-Proex-Action': '' }, { 'Content-Type': 'application/json-bad' }]) assert.equal((await route.POST(request({ password }, headers))).status, 403);
  assert.equal((await route.POST(request({ password: 'short' }))).status, 400);
  assert.equal((await route.POST(request({ password, userId: 'forged-owner' }))).status, 400);
  assert.equal((await route.POST(request({ password: 'x'.repeat(5000) }))).status, 413); assert.equal(f.state.calls, 0);
  const response = await route.POST(request()); assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store'); assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Disposition'), /\.proexbackup/);
  const reader = response.body.getReader(); let blocks = 0, total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; blocks++; total += value.byteLength; }
  assert.equal(total, 140000); assert.ok(blocks > 1);
});
test('repeated exports are rate limited and unsupported runtimes do not return a fake backup', async () => {
  const f = fixture();
  for (let index = 0; index < 3; index++) { const response = await route.POST(request()); assert.equal(response.status, 200); await response.arrayBuffer(); }
  assert.equal((await route.POST(request())).status, 429); assert.equal(f.state.calls, 3);
  const unsupported = fixture(); unsupported.state.binding = null;
  assert.equal((await (await route.GET()).json()).supported, false); assert.equal((await route.POST(request())).status, 501);
});
test('revocation during encryption suppresses the response and provider exceptions expose no password', async () => {
  const f = fixture(); f.state.binding.createEncrypted = async () => { f.native.exec("UPDATE members SET revoked_at='2026-10-31'"); return new Uint8Array([1]); };
  assert.equal((await route.POST(request())).status, 403);
  const failed = fixture(); failed.state.binding.createEncrypted = async () => { throw new Error(password + ' synthetic provider detail'); };
  const log = console.error, entries = []; console.error = (...args) => entries.push(args.join(' '));
  try { const response = await route.POST(request()); assert.equal(response.status, 500); assert.equal((await response.text()).includes(password), false); assert.ok(entries.every(entry => !entry.includes(password))); }
  finally { console.error = log; }
});
