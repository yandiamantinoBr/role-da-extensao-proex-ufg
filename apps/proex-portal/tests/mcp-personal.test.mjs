import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import { root, nativeFixture } from './support/traffic-fixture.mjs';

const modules = new Map(), url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
function compile(file) {
  file = resolve(root, file); if (modules.has(file)) return modules.get(file);
  if (file === resolve(root, 'lib/platform.ts')) return url('export function database(){return globalThis.__mcpPersonalRoute.db;}');
  if (file === resolve(root, 'lib/session.ts')) return url('export async function getPortalUser(){return globalThis.__mcpPersonalRoute.user;}');
  if (file.endsWith('.json')) return url(`export default ${readFileSync(file, 'utf8')};`);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(@\/[^'"]+|\.{1,2}\/[^'"]+)\1/g, (_match, _quote, dep) => { let target = dep.startsWith('@/') ? resolve(root, dep.slice(2)) : resolve(dirname(file), dep); if (!/\.(ts|json)$/.test(target)) target += '.ts'; return `from ${JSON.stringify(compile(target))}`; }).replace(/\s+with\s+\{\s*type:\s*['"]json['"]\s*\}/g, '');
  const value = url(code); modules.set(file, value); return value;
}
const tokens = await import(compile('lib/mcp/tokens.ts')), transport = await import(compile('lib/mcp/transport.ts'));
const management = await import(compile('app/api/mcp/tokens/route.ts')), endpoint = await import(compile('app/api/mcp/route.ts'));
const origin = 'https://synthetic-mcp.example.invalid', version = '2026-07-28';
const input = extra => ({ action: 'create', label: 'Synthetic MCP', projectIds: ['project-fixture'], scopes: ['project.summary', 'tasks.read'], requestId: crypto.randomUUID(), ...extra });
function fixture(t) {
  const f = nativeFixture(), owner = f.owner(), at = new Date().toISOString(); t.after(() => f.close());
  f.native.prepare("INSERT INTO projects(id,name,description,created_at) VALUES('project-other','Other private project','must-not-leak',?)").run(at);
  f.native.prepare("INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES('member-a','member-a@example.invalid','active',0,?,?)").run(at, at);
  f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES('member-a-role','member-a','member-a@example.invalid','inventory','project-fixture',?)").run(at);
  const member = { userId: 'member-a', email: 'member-a@example.invalid', displayName: 'Synthetic member', members: [], capabilities: [] };
  return { ...f, owner, member, async issue(extra = {}, actor = owner) { return tokens.manageMcpToken(f.db, actor, input(extra)); } };
}
function request(token, method, params = {}, override = {}) {
  const body = { jsonrpc: '2.0', id: 7, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientCapabilities': {} } }, ...override.body };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': version, 'Mcp-Method': method, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(['tools/call', 'resources/read'].includes(method) ? { 'Mcp-Name': params.name ?? params.uri } : {}), ...override.headers };
  return new Request(`${origin}/api/mcp`, { method: 'POST', headers, body: override.raw ?? JSON.stringify(body) });
}
async function rpc(f, token, method, params = {}, override) { const response = await transport.personalMcp(request(token, method, params, override), f.db); return { status: response.status, body: await response.json(), headers: response.headers }; }

test('personal MCP is one-purpose, hashed, project-explicit, bounded and owned by the current account', async t => {
  const f = fixture(t), issued = await f.issue({}, f.member), stored = f.native.prepare('SELECT * FROM mcp_personal_tokens').get();
  assert.match(issued.token, /^pxm_[\w-]{43}$/); assert.match(stored.token_hash, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(stored).includes(issued.token));
  assert.ok(Math.abs(Date.parse(issued.expiresAt) - Date.parse(stored.created_at) - 7 * 86400000) < 5);
  for (const extra of [{ projectIds: [] }, { projectIds: ['*'] }, { projectIds: ['project-other'] }, { projectIds: Array(21).fill('project-fixture') }, { scopes: ['sync.manage'] }, { scopes: ['project.summary', 'project.summary'] }, { days: 31 }, { days: 0 }, { userId: f.owner.userId }]) await assert.rejects(f.issue(extra, f.member));
  const listed = await tokens.listMcpTokens(f.db, f.member); assert.equal(listed.tokens.length, 1); assert.deepEqual(listed.projects.map(row => row.id), ['project-fixture']);
  assert.equal(JSON.stringify(listed).includes(stored.token_hash), false); assert.equal(JSON.stringify(listed).includes(issued.token), false);
  await assert.rejects(tokens.manageMcpToken(f.db, f.owner, { action: 'revoke', id: issued.id }), error => error.status === 404);
});

test('MCP 2026 discovery, tools and project resources work without legacy handshake, provider calls or database writes', async t => {
  const f = fixture(t), issued = await f.issue(), at = new Date().toISOString();
  const org = f.native.prepare("SELECT organization_id FROM projects WHERE id='project-fixture'").get().organization_id;
  for (let n = 0; n < 30; n++) f.native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,created_by,created_at,updated_at) VALUES(?,?,'project-fixture',?,'private-body-not-exported','owner-fixture',?,?)").run('task-' + n, org, `Task ${String(n).padStart(2,'0')}`, at, at);
  f.resetStats(); const originalFetch = globalThis.fetch; let egress = 0; globalThis.fetch = () => { egress++; throw new Error('Unexpected network'); }; t.after(() => { globalThis.fetch = originalFetch; });
  const discovery = await rpc(f, null, 'server/discover'); assert.equal(discovery.status, 200); assert.equal(discovery.body.result.resultType, 'complete'); assert.deepEqual(discovery.body.result.supportedVersions, [version]);
  const list = await rpc(f, issued.token, 'tools/list'); assert.equal(list.status, 200); assert.deepEqual(list.body.result.tools.map(tool => tool.name), ['proex_project_summary', 'proex_tasks_list']); assert.ok(list.body.result.tools.every(tool => tool.annotations.readOnlyHint && tool.inputSchema.additionalProperties === false));
  const resources = await rpc(f, issued.token, 'resources/list'); assert.equal(resources.body.result.resources.length, 2); assert.ok(resources.body.result.resources.every(resource => !resource.name.includes('Other')));
  const summary = await rpc(f, issued.token, 'resources/read', { uri: 'proex://projects/project-fixture/summary' }); assert.equal(summary.status, 200); assert.equal(JSON.parse(summary.body.result.contents[0].text).id, 'project-fixture');
  const tasks = await rpc(f, issued.token, 'tools/call', { name: 'proex_tasks_list', arguments: { projectId: 'project-fixture', limit: 10 } }); assert.equal(tasks.body.result.structuredContent.tasks.length, 10); assert.equal(tasks.body.result.structuredContent.nextOffset, 10); assert.equal(tasks.body.result.structuredContent.hasMore, true); assert.ok(!JSON.stringify(tasks).includes('private-body-not-exported'));
  const page = await rpc(f, issued.token, 'tools/call', { name: 'proex_tasks_list', arguments: { projectId: 'project-fixture', offset: 25 } }); assert.equal(page.body.result.structuredContent.tasks.length, 5); assert.equal(page.body.result.structuredContent.hasMore, false); assert.equal(page.body.result.structuredContent.nextOffset, null);
  assert.equal(f.stats.commits, 0); assert.equal(egress, 0); assert.equal(list.headers.get('Cache-Control'), 'private, no-store');
});

test('schemas, metadata/header mirrors, JSON framing and unsupported versions fail closed', async t => {
  const f = fixture(t), { token } = await f.issue();
  for (const [override, status, code] of [
    [{ headers: { 'Mcp-Method': 'tools/call' } }, 400, -32020],
    [{ headers: { 'MCP-Protocol-Version': '2025-11-25' } }, 400, -32020],
    [{ body: { params: {} } }, 400, -32602],
    [{ body: { params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-11-25', 'io.modelcontextprotocol/clientCapabilities': {} } } } }, 400, -32022],
    [{ body: { id: null } }, 400, -32600], [{ raw: '{' }, 400, -32700], [{ raw: '[]' }, 400, -32600], [{ raw: ' '.repeat(8193) }, 413, -32600],
    [{ headers: { Accept: 'application/json' } }, 406, -32600], [{ headers: { Accept: 'application/json;q=0,text/event-stream' } }, 406, -32600], [{ headers: { Origin: 'https://hostile.invalid' } }, 403, 1003],
  ]) { const result = await rpc(f, token, 'tools/list', {}, override); assert.equal(result.status, status); assert.equal(result.body.error.code, code); }
  assert.equal((await rpc(f, token, 'tools/list', {}, {headers:{Accept:'APPLICATION/JSON, TEXT/EVENT-STREAM',Authorization:'bearer '+token}})).status,200);
  const legacy = await rpc(f, token, 'initialize'); assert.equal(legacy.status, 404); assert.equal(legacy.body.error.code, -32601);
  const mirrored = await rpc(f, token, 'tools/call', { name: 'proex_project_summary', arguments: { projectId: 'project-fixture' } }, { headers: { 'Mcp-Name': '=?base64?cHJvZXhfcHJvamVjdF9zdW1tYXJ5?=' } }); assert.equal(mirrored.status, 200);
  for (const args of [{ projectId: 'project-other' }, { projectId: 'project-fixture', sql: 'SELECT * FROM portal_users' }, { projectId: 'project-fixture', limit: 26 }, { projectId: 'project-fixture', offset: -1 }, { projectId: 'project-fixture', limit: null }, { projectId: 'project-fixture', offset: null }]) assert.ok((await rpc(f, token, 'tools/call', { name: 'proex_tasks_list', arguments: args })).status >= 400);
  for (const uri of ['file:///secrets', 'https://evil.invalid', 'proex://projects/project-other/summary', 'proex://projects/project-fixture/summary?x=1']) assert.ok((await rpc(f, token, 'resources/read', { uri })).status >= 400);
});

test('token scopes do not authorize sync/admin actions, foreign projects, cookie/header impersonation or other key purposes', async t => {
  const f = fixture(t), { token } = await f.issue({ scopes: ['project.summary'] });
  assert.equal((await rpc(f, token, 'tools/list')).body.result.tools.length, 1);
  assert.equal((await rpc(f, token, 'tools/call', { name: 'proex_tasks_list', arguments: { projectId: 'project-fixture' } })).status, 403);
  for (const name of ['proex_sync_apply', 'proex_sync_read', 'proex_catalog_seed', 'execute_sql']) assert.ok((await rpc(f, token, 'tools/call', { name, arguments: { projectId: 'project-fixture' } })).status >= 400);
  for (const other of [undefined, 'pxs_' + 'a'.repeat(43), 'sk-' + 'b'.repeat(43), 'pxm_' + 'c'.repeat(43)]) assert.equal((await rpc(f, other, 'tools/list', {}, { headers: { Cookie: 'synthetic-session', 'oai-authenticated-user-id': f.owner.userId } })).status, 401);
});

test('empty task resources and final tool pages return no cursor, and null never becomes an integer default', async t => {
  const f = fixture(t), { token } = await f.issue({ scopes: ['tasks.read'] });
  const resource = await rpc(f, token, 'resources/read', { uri: 'proex://projects/project-fixture/tasks' });
  const value = JSON.parse(resource.body.result.contents[0].text); assert.deepEqual(value.tasks, []); assert.equal(value.hasMore, false); assert.equal(value.nextOffset, null);
  for (const args of [{ projectId: 'project-fixture' }, { projectId: 'project-fixture', offset: 50000, limit: 1 }]) {
    const result = await rpc(f, token, 'tools/call', { name: 'proex_tasks_list', arguments: args }); assert.equal(result.body.result.structuredContent.hasMore, false); assert.equal(result.body.result.structuredContent.nextOffset, null);
  }
  for (const field of ['limit', 'offset']) { const result = await rpc(f, token, 'tools/call', { name: 'proex_tasks_list', arguments: { projectId: 'project-fixture', [field]: null } }); assert.equal(result.status, 400); assert.equal(result.body.error.code, -32602); }
});

test('expiry, revocation, account blocking and membership changes invalidate existing MCP credentials', async t => {
  for (const scenario of ['expiry', 'revoke', 'block', 'pending', 'anonymized', 'membership']) {
    const f = fixture(t), issued = await f.issue({}, f.member);
    if (scenario === 'expiry') f.native.prepare("UPDATE mcp_personal_tokens SET created_at='2020-01-01T00:00:00.000Z',expires_at='2020-01-02T00:00:00.000Z'").run();
    if (scenario === 'revoke') await tokens.manageMcpToken(f.db, f.member, { action: 'revoke', id: issued.id });
    if (scenario === 'block') f.native.exec("UPDATE portal_users SET status='blocked' WHERE user_id='member-a'");
    if (scenario === 'pending') f.native.exec("UPDATE portal_users SET activation_pending=1 WHERE user_id='member-a'");
    if (scenario === 'anonymized') f.native.exec("UPDATE portal_users SET anonymized_at='2026-01-01' WHERE user_id='member-a'");
    if (scenario === 'membership') f.native.exec("UPDATE members SET revoked_at='2026-01-01' WHERE id='member-a-role'");
    assert.ok((await rpc(f, issued.token, 'tools/list')).status >= 400, scenario);
  }
});

test('creation and returned content are fenced against revocation races; duplicate submission never stores two credentials', async t => {
  const f = fixture(t), create = input(), issued = await tokens.manageMcpToken(f.db, f.member, create);
  await assert.rejects(tokens.manageMcpToken(f.db, f.member, create), error => error.status === 409);
  const base = f.db.prepare;
  f.db.prepare = sql => {
    const wrap = statement => ({ ...statement, bind: (...values) => wrap(statement.bind(...values)), async first(column) { const value = await statement.first(column); if (sql.startsWith('SELECT p.id,p.name,p.short_name')) f.native.prepare('UPDATE mcp_personal_tokens SET revoked_at=? WHERE id=?').run(new Date().toISOString(), issued.id); return value; } });
    return wrap(base(sql));
  };
  const result = await rpc(f, issued.token, 'tools/call', { name: 'proex_project_summary', arguments: { projectId: 'project-fixture' } }); assert.equal(result.status, 401); assert.ok(!JSON.stringify(result).includes('Synthetic project'));
  f.db.prepare = base;
  const batch = f.db.batch; f.db.batch = async statements => { f.native.exec("UPDATE members SET revoked_at='2026-01-01' WHERE id='member-a-role'"); return batch(statements); };
  await assert.rejects(f.issue({}, f.member), error => error.status === 403); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mcp_personal_tokens').get().n, 1);
});

test('account API isolates token management and requires a live session plus CSRF protection', async t => {
  const f = fixture(t); globalThis.__mcpPersonalRoute = { db: f.db, user: null }; t.after(() => { delete globalThis.__mcpPersonalRoute; });
  assert.equal((await management.GET()).status, 401);
  globalThis.__mcpPersonalRoute.user = f.owner;
  const payload = input();
  const post = (value, headers = {}) => management.POST(new Request(origin + '/api/mcp/tokens', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Proex-Action': '1', ...headers }, body: JSON.stringify(value) }));
  assert.equal((await post(payload, { Origin: 'https://hostile.invalid' })).status, 403);
  assert.equal((await post(payload, { 'X-Proex-Action': '' })).status, 403);
  const response = await post(payload), issued = await response.json(); assert.equal(response.status, 200); assert.match(issued.token, /^pxm_/); assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  globalThis.__mcpPersonalRoute.user = f.member;
  const list = await (await management.GET()).json(); assert.equal(list.tokens.length, 0);
  assert.equal((await post({ action: 'revoke', id: issued.id })).status, 404);
  assert.equal(endpoint.GET().status, 405); assert.equal(endpoint.DELETE().status, 405);
  assert.equal((await endpoint.POST(request(null, 'tools/list'))).status, 401, 'a browser session is not a canonical MCP credential');
});

test('daily issuance is bounded, revocation does not reset the budget, and portable tables never expose MCP tokens', async t => {
  const f = fixture(t);
  for (let n = 0; n < 20; n++) { const issued = await f.issue(); if (n === 0) await tokens.manageMcpToken(f.db, f.owner, { action: 'revoke', id: issued.id }); }
  await assert.rejects(f.issue(), error => error.code === 'mcp_token_limit');
  const old = new Date(Date.now() - 2 * 86400000).toISOString(), future = new Date(Date.now() + 5 * 86400000).toISOString();
  f.native.prepare('UPDATE mcp_personal_tokens SET created_at=?,expires_at=?').run(old, future);
  await f.issue(); // fills the twentieth active slot despite the reset daily window
  await assert.rejects(f.issue(), error => error.code === 'mcp_token_limit');
  const historic = f.native.prepare("INSERT INTO mcp_personal_tokens(id,user_id,label,token_hash,scope_json,projects_json,request_id,expires_at,revoked_at,created_at) VALUES(?,'owner-fixture','Old revoked',?,'[\"project.summary\"]','[\"project-fixture\"]',?,?,?,?)");
  for (let n = 0; n < 110; n++) historic.run('historic-' + n, '0'.repeat(60) + String(n).padStart(4,'0'), crypto.randomUUID(), future, new Date().toISOString(), new Date().toISOString());
  const own = await tokens.listMcpTokens(f.db, f.owner); assert.equal(own.tokens.length, 100); assert.equal(own.tokens.filter(token => !token.revokedAt).length, 20, 'every active credential remains revocable even after a large history');
  const { exportPortablePage, describePortableSchemas } = await import(compile('lib/sync/portable.ts'));
  assert.equal(describePortableSchemas().tables.some(table => table.table === 'mcp_personal_tokens'), false);
  await assert.rejects(exportPortablePage(f.db, f.owner, { table: 'mcp_personal_tokens' }));
});
