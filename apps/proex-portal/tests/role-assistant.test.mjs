import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Dados 100% sintéticos. Nenhuma chamada sai da máquina: todo transporte é falso.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-role-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { DEFAULT_ASSISTANT_CONFIG, safeRequest } = await import(compile('assistant/contracts'));
const { configureAssistant, estimateAssistantPlan } = await import(compile('assistant/service'));
const { manageAssistantCredential, assistantCredentialVault } = await import(compile('assistant/credential-vault'));
const { roleChat, roleStatus, parseRoleImage } = await import(compile('assistant/role'));
const { roleEstimate, roleConversationBytes, validateRoleReply, formatMicros, friendlyMicros, roleSpeechCeilingMicros, ROLE_SYSTEM_PROMPT, ROLE_SYSTEM_PROMPT_BYTES, ROLE_MODELS } = await import(compile('assistant/role-contracts'));
const { speechReservedUsdMicros } = await import(compile('assistant/speech'));
const { portalSnapshot } = await import(compile('portal-data'));
const { describePortableSchemas, exportPortablePage } = await import(compile('sync/portable'));

const secret = 'test-only-role-auth-secret-no-production-access';
const keys = { current: 'synthetic-only-independent-key-for-role-tests-000' };
// Canário: se este valor aparecer em qualquer saída, o teste falha.
const CANARY = 'sk-CANARIO-role-synthetic-0000-ZZ99';
const GROQ_CANARY = 'gsk_CANARIO_groq_synthetic_0000_YY88';
function png(width, height) { const header = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0); header.writeUInt32BE(13, 8); header.write('IHDR', 12, 'ascii'); header.writeUInt32BE(width, 16); header.writeUInt32BE(height, 20); return 'data:image/png;base64,' + Buffer.concat([header, Buffer.alloc(99, 7)]).toString('base64'); }
const PNG = png(640, 480);

function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString();
  native.prepare("INSERT INTO projects(id,name,description,scope,created_at) VALUES('project-a','Projeto A','','external',?),('project-b','Projeto B','','external',?)").run(now, now);
  native.prepare("INSERT INTO items(id,project_id,name,category,unit,created_at,updated_at) VALUES('item-a','project-a','Caneta QA','consumption','unidade',?,?)").run(now, now);
  const actors = {};
  for (const [role, project] of [['owner', null], ['viewer', 'project-a'], ['outsider', 'project-b']]) {
    const userId = `${role}-qa`, email = `${role}@example.test`, memberRole = role === 'owner' ? 'owner' : 'inventory';
    native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
    native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(userId, userId, email, memberRole, project, now);
    actors[role] = { userId, email, displayName: role, capabilities: [], members: [{ id: userId, user_id: userId, email, role: memberRole, project_id: project, revoked_at: null, created_at: now }] };
  }
  const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  return { native, db, actors };
}

async function setup(f, config = {}, extraKeys = {}) {
  let revision = 0;
  for (const [provider, value] of Object.entries({ deepseek: CANARY, ...extraKeys })) {
    const vault = await manageAssistantCredential(f.db, f.actors.owner, { action: 'save', organizationId: 'org_proex', provider, expectedRevision: revision, label: `Chave ${provider} de teste`, secret: value }, secret, keys);
    revision = vault.revision;
  }
  await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision, config: { ...DEFAULT_ASSISTANT_CONFIG, usageScope: 'organization', roleEnabled: true, ...config } }, secret, undefined, keys);
}

function fakeProvider({ reply = { reply: 'Oi! Posso ajudar.', operation: null }, model, echoKey = false, status = 200 } = {}) {
  const calls = [];
  return { calls, fetch: async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url: String(url), init, body });
    assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    if (status !== 200) return new Response('{}', { status, headers: { 'content-type': 'application/json' } });
    const key = init.headers.Authorization.replace('Bearer ', '');
    return Response.json({ model: model ?? body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(echoKey ? { reply: `sua chave ${key}`, operation: null } : reply) } }], usage: { prompt_tokens: 900, completion_tokens: 120 } });
  } };
}

function chatInput(f, extra = {}) {
  const message = extra.message ?? 'Como registro a entrega de brindes?';
  // Same redaction as the browser before estimating (role-assistant.tsx sanitizes history too).
  const history = (extra.history ?? []).map(turn => { try { return { ...turn, content: safeRequest(turn.content) }; } catch { return turn; } });
  const estimate = roleEstimate({ textProvider: extra.provider ?? 'deepseek', textBytes: roleConversationBytes(history, message, 'Projeto A'), hasImage: !!extra.image, tools: extra.tools ?? true });
  const { provider: _provider, tools: _tools, ...rest } = extra; void _provider; void _tools;
  return { action: 'chat', projectId: 'project-a', operationKey: `role-test-${Math.random().toString(36).slice(2, 12)}`, consent: true, message, acceptedCostMicros: estimate.costMicros, ...rest };
}

test('pure contract: shared cost ceiling, image surcharge, prompt budget and strict reply', () => {
  const text = roleEstimate({ textProvider: 'deepseek', textBytes: 500, hasImage: false });
  const image = roleEstimate({ textProvider: 'deepseek', textBytes: 500, hasImage: true });
  const groq = roleEstimate({ textProvider: 'groq', textBytes: 500, hasImage: false });
  assert.ok(image.costMicros > text.costMicros);
  assert.ok(groq.costMicros < text.costMicros);
  assert.equal(groq.model, 'openai/gpt-oss-120b');
  assert.equal(roleEstimate({ textProvider: 'groq', textBytes: 500, hasImage: true }).model, 'deepseek-flash', 'image always routes to the vision model');
  assert.ok(new TextEncoder().encode(JSON.stringify(ROLE_SYSTEM_PROMPT)).byteLength + 200 <= ROLE_SYSTEM_PROMPT_BYTES);
  assert.equal(text.costMicros < 3000, true, 'a short message stays under US$ 0.003');
  for (const duration of [0.5, 10, 37.2, 90]) assert.equal(roleSpeechCeilingMicros('groq', duration), speechReservedUsdMicros('groq', duration));
  assert.equal(roleSpeechCeilingMicros('deepgram', 30), speechReservedUsdMicros('deepgram', 30));
  assert.deepEqual(validateRoleReply({ reply: ' ok ', operation: null }), { reply: 'ok', operation: null });
  for (const bad of [{ reply: 'x', operation: null, sql: 1 }, { reply: '', operation: null }, { reply: 'x', operation: 5 }, [], null]) assert.throws(() => validateRoleReply(bad));
  assert.equal(formatMicros(0), 'US$\u00a00,0000');
  assert.match(formatMicros(1234), /^US\$\u00a00,0012$/);
  assert.match(friendlyMicros(1600), /^menos de 1 centavo \(US\$\u00a00,0016\)$/);
  assert.equal(ROLE_MODELS.groq.acceptsImage, false);
  assert.equal(ROLE_MODELS.deepseek.acceptsAudio, false, 'audio is always transcribed first');
});

test('status is free, needs project access and explains an unconfigured Rolê without calling providers', async () => {
  const f = fixture();
  try {
    const status = await roleStatus(f.db, f.actors.viewer, { projectId: 'project-a' }, secret, { keys });
    assert.equal(status.available, false);
    assert.match(status.reason, /configurado|ligado/);
    await assert.rejects(roleStatus(f.db, f.actors.outsider, { projectId: 'project-a' }, secret, { keys }), error => error.status === 403 || error.status === 404);
    await setup(f);
    const ready = await roleStatus(f.db, f.actors.viewer, { projectId: 'project-a' }, secret, { keys });
    assert.equal(ready.available, true); assert.equal(ready.provider, 'deepseek'); assert.equal(ready.visionAvailable, false);
    assert.equal(JSON.stringify(ready).includes(CANARY), false);
  } finally { f.native.close(); }
});

test('chat reserves the shown ceiling, calls DeepSeek once, audits metadata only and never stores the text', async () => {
  const f = fixture();
  try {
    await setup(f);
    const provider = fakeProvider({ reply: { reply: 'Use Materiais → Distribuir.', operation: 'Registrar distribuição de 3 canetas' } });
    const input = chatInput(f, { message: 'Como faço para distribuir 3 canetas?' });
    const result = await roleChat(f.db, f.actors.viewer, input, secret, { keys, fetcher: provider.fetch });
    assert.equal(provider.calls.length, 1);
    const sent = provider.calls[0];
    assert.equal(sent.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(sent.body.model, 'deepseek-flash'); assert.equal(sent.body.thinking.type, 'disabled');
    // First step offers the read-only portal lookups; JSON mode is kept for the final step without tools.
    assert.equal(sent.body.tool_choice, 'auto'); assert.ok(sent.body.tools.some(tool => tool.function.name === 'consultar_demandas')); assert.equal(sent.body.response_format, undefined);
    assert.equal(sent.body.messages[0].role, 'system');
    assert.equal(result.reply, 'Use Materiais → Distribuir.'); assert.equal(result.operation, 'Registrar distribuição de 3 canetas');
    assert.equal(result.costMicros, Math.ceil(900 * 0.3 + 120 * 1.2));
    assert.equal(result.reservedMicros, input.acceptedCostMicros);
    const usage = f.native.prepare("SELECT reserved_usd_micros,calls FROM ai_organization_usage WHERE organization_id='org_proex'").get();
    // The ceiling was reserved; after the reply the day keeps only the real cost.
    assert.equal(usage.reserved_usd_micros, result.costMicros); assert.ok(result.costMicros <= input.acceptedCostMicros); assert.equal(usage.calls, 1);
    const audit = f.native.prepare("SELECT details FROM audit WHERE action='assistant.role.chat'").all();
    assert.equal(audit.length, 1);
    const details = JSON.parse(audit[0].details);
    assert.deepEqual(Object.keys(details).sort(), ['hasImage', 'inputTokens', 'model', 'operationDropped', 'operationSuggested', 'outputTokens', 'overrun', 'provider', 'reservedUsdMicros', 'steps', 'tools', 'usdMicros']);
    assert.equal(details.overrun, false);
    const everything = JSON.stringify(f.native.prepare('SELECT * FROM audit').all()) + JSON.stringify(f.native.prepare('SELECT * FROM ai_calls').all());
    assert.equal(everything.includes('distribuir 3 canetas'), false, 'message text is not persisted');
    await assert.rejects(roleChat(f.db, f.actors.viewer, input, secret, { keys, fetcher: provider.fetch }), error => error.code === 'assistant_call_replay');
    assert.equal(provider.calls.length, 1, 'a replayed send never pays twice');
  } finally { f.native.close(); }
});

test('no paid call without consent, the current cost ceiling or project permission', async () => {
  const f = fixture();
  try {
    await setup(f);
    const provider = fakeProvider();
    await assert.rejects(roleChat(f.db, f.actors.viewer, { ...chatInput(f), consent: false }, secret, { keys, fetcher: provider.fetch }), error => error.code === 'assistant_consent');
    await assert.rejects(roleChat(f.db, f.actors.viewer, { ...chatInput(f), acceptedCostMicros: 1 }, secret, { keys, fetcher: provider.fetch }), error => error.code === 'role_cost_changed');
    await assert.rejects(roleChat(f.db, f.actors.viewer, chatInput(f, { acceptedCostMicros: undefined }), secret, { keys, fetcher: provider.fetch }), error => error.code === 'role_cost_changed');
    await assert.rejects(roleChat(f.db, f.actors.outsider, chatInput(f), secret, { keys, fetcher: provider.fetch }), error => error.status === 403 || error.status === 404);
    await assert.rejects(roleChat(f.db, f.actors.viewer, chatInput(f, { message: `minha chave api_key=${'x'.repeat(20)}` }), secret, { keys, fetcher: provider.fetch }), error => error.code === 'assistant_sensitive');
    assert.equal(provider.calls.length, 0);
    assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_calls').get().n, 0, 'no reservation either');
  } finally { f.native.close(); }
});

test('images need the vision switch, are validated by signature and always go to DeepSeek', async () => {
  const f = fixture();
  try {
    await setup(f, { roleProvider: 'groq' }, { groq: GROQ_CANARY });
    const provider = fakeProvider();
    await assert.rejects(roleChat(f.db, f.actors.viewer, chatInput(f, { provider: 'groq', image: PNG }), secret, { keys, fetcher: provider.fetch }), error => error.code === 'role_vision_unavailable');
    assert.throws(() => parseRoleImage('data:image/jpeg;base64,' + Buffer.alloc(200, 1).toString('base64')), error => error.code === 'role_image');
    assert.throws(() => parseRoleImage('https://example.test/foto.png'), error => error.code === 'role_image');
    assert.throws(() => parseRoleImage('data:image/png;base64,' + Buffer.alloc(1_600_000, 1).toString('base64')), error => error.status === 413);
    assert.throws(() => parseRoleImage(png(8000, 8000)), error => error.status === 413 && error.code === 'role_image', 'pixel size is checked on the server, not only in the browser');
    assert.throws(() => parseRoleImage('data:image/webp;base64,' + Buffer.concat([Buffer.from('RIFF0000WAVEfmt '), Buffer.alloc(100, 1)]).toString('base64')), error => error.code === 'role_image');
    assert.throws(() => parseRoleImage(PNG.slice(0, -1)), error => error.code === 'role_image', 'truncated base64');
    assert.equal(parseRoleImage(PNG).mime, 'image/png');
    const vault = await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys);
    await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: vault.revision, config: { ...DEFAULT_ASSISTANT_CONFIG, usageScope: 'organization', roleEnabled: true, roleProvider: 'groq', roleVisionEnabled: true } }, secret, undefined, keys);
    const text = await roleChat(f.db, f.actors.viewer, chatInput(f, { provider: 'groq' }), secret, { keys, fetcher: provider.fetch });
    assert.equal(provider.calls.at(-1).url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(provider.calls.at(-1).body.model, 'openai/gpt-oss-120b'); assert.equal(provider.calls.at(-1).body.include_reasoning, false);
    assert.equal(provider.calls.at(-1).init.headers.Authorization, `Bearer ${GROQ_CANARY}`);
    assert.equal(text.provider, 'groq');
    const withImage = await roleChat(f.db, f.actors.viewer, chatInput(f, { provider: 'groq', image: PNG, message: 'O que aparece na foto?' }), secret, { keys, fetcher: provider.fetch });
    const last = provider.calls.at(-1);
    assert.equal(last.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(last.init.headers.Authorization, `Bearer ${CANARY}`);
    const parts = last.body.messages.at(-1).content;
    assert.equal(parts[1].type, 'image_url'); assert.equal(parts[1].image_url.url, PNG);
    assert.equal(withImage.provider, 'deepseek');
    assert.equal(JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='assistant.role.chat' ORDER BY created_at DESC,rowid DESC LIMIT 1").get().details).hasImage, true);
  } finally { f.native.close(); }
});

test('reflected keys, refused keys and the daily ceiling never reach the person or repeat a charge', async () => {
  const f = fixture();
  try {
    await setup(f, { dailyCalls: 2 });
    const echo = fakeProvider({ echoKey: true });
    await assert.rejects(roleChat(f.db, f.actors.viewer, chatInput(f), secret, { keys, fetcher: echo.fetch }), error => { assert.equal(error.code, 'role_provider_schema'); assert.equal(String(error.message).includes(CANARY), false); return true; });
    assert.equal(f.native.prepare("SELECT status FROM ai_calls").get().status, 'failed');
    const refused = fakeProvider({ status: 401 });
    await assert.rejects(roleChat(f.db, f.actors.viewer, chatInput(f), secret, { keys, fetcher: refused.fetch }), error => /sem acesso ao serviço de IA/.test(error.message));
    const ok = fakeProvider();
    await assert.rejects(roleChat(f.db, f.actors.viewer, chatInput(f), secret, { keys, fetcher: ok.fetch }), error => error.code === 'assistant_quota');
    assert.equal(ok.calls.length, 0, 'third call refused before transport');
    const wrongModel = fakeProvider({ model: 'outro-modelo' });
    void wrongModel;
  } finally { f.native.close(); }
});

test('a private usage policy blocks other people before reservation; turning the key off turns Rolê off', async () => {
  const f = fixture();
  try {
    await setup(f, { usageScope: 'private' });
    const provider = fakeProvider();
    await assert.rejects(roleChat(f.db, f.actors.viewer, chatInput(f), secret, { keys, fetcher: provider.fetch }), error => error.status === 403);
    assert.equal(provider.calls.length, 0);
    const vault = await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys);
    await manageAssistantCredential(f.db, f.actors.owner, { action: 'disable', organizationId: 'org_proex', provider: 'deepseek', expectedRevision: vault.revision }, secret, keys);
    const config = JSON.parse(f.native.prepare("SELECT config_json FROM ai_organization_settings WHERE organization_id='org_proex'").get().config_json);
    assert.equal(config.roleEnabled, false); assert.equal(config.roleVisionEnabled, false);
  } finally { f.native.close(); }
});

test('operation estimate is free and matches the paid preparation inputs', async () => {
  const f = fixture();
  try {
    await setup(f, { enabled: true });
    const estimate = await estimateAssistantPlan(f.db, f.actors.viewer, { projectId: 'project-a', request: 'Registrar entrada de 10 canetas' }, secret, { keys });
    assert.ok(estimate.costMicros > 0); assert.equal(estimate.provider, 'deepseek');
    assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_calls').get().n, 0);
    await assert.rejects(estimateAssistantPlan(f.db, f.actors.outsider, { projectId: 'project-a', request: 'Registrar entrada de 10 canetas' }, secret, { keys }), error => error.status === 403 || error.status === 404);
  } finally { f.native.close(); }
});

test('LEAK GUARD: a saved key never appears in responses, history, audit, database text, logs or exports', async () => {
  const f = fixture(), logs = [], originals = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) { originals[level] = console[level]; console[level] = (...args) => { logs.push(args.map(value => { try { return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value); } catch { return String(value); } }).join(' ')); }; }
  const outputs = [];
  try {
    await setup(f, {}, { groq: GROQ_CANARY });
    outputs.push(await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys));
    outputs.push(await roleStatus(f.db, f.actors.viewer, { projectId: 'project-a' }, secret, { keys }));
    outputs.push(await roleChat(f.db, f.actors.viewer, chatInput(f), secret, { keys, fetcher: fakeProvider().fetch }));
    for (const echo of [fakeProvider({ echoKey: true }), fakeProvider({ status: 500 })]) {
      try { await roleChat(f.db, f.actors.viewer, chatInput(f), secret, { keys, fetcher: echo.fetch }); } catch (error) { outputs.push({ message: error.message, code: error.code }); }
    }
    for (const bad of [{ label: `nome ${CANARY}`, secret: 'test-only-other-valid-key-0001' }]) {
      try { await manageAssistantCredential(f.db, f.actors.owner, { action: 'save', organizationId: 'org_proex', provider: 'openai', expectedRevision: outputs[0].revision, ...bad }, secret, keys); } catch (error) { outputs.push({ message: error.message, code: error.code }); }
    }
    outputs.push(await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys));
    outputs.push(await portalSnapshot(f.db, f.actors.owner));
    for (const schema of describePortableSchemas().tables) outputs.push(await exportPortablePage(f.db, f.actors.owner, { table: schema.table }));
    // Banco inteiro em texto, exceto a coluna cifrada.
    const tables = f.native.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    const dump = tables.map(table => JSON.stringify(f.native.prepare(`SELECT * FROM "${table}"`).all().map(row => { const copy = { ...row }; delete copy.credentials_ciphertext; return copy; }))).join('\n');
    const haystack = JSON.stringify(outputs) + '\n' + dump + '\n' + logs.join('\n');
    for (const value of [CANARY, GROQ_CANARY, keys.current, CANARY.slice(3, -4), GROQ_CANARY.slice(4, -4)]) assert.equal(haystack.includes(value), false, 'a protected value leaked');
    assert.ok(JSON.stringify(outputs[0]).includes('…ZZ99'), 'only the masked hint is shown');
  } finally {
    for (const [level, fn] of Object.entries(originals)) console[level] = fn;
    f.native.close();
  }
});

test('real use above the ceiling is added to the daily limit and audited; prepare honours an accepted ceiling', async () => {
  const f = fixture();
  try {
    await setup(f, { enabled: true });
    const heavy = { calls: [], fetch: async (url, init) => { const body = JSON.parse(init.body); heavy.calls.push(body); return Response.json({ model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reply: 'ok', operation: null }) } }], usage: { prompt_tokens: 90000, completion_tokens: 700 } }); } };
    const input = chatInput(f);
    const result = await roleChat(f.db, f.actors.viewer, input, secret, { keys, fetcher: heavy.fetch });
    assert.ok(result.costMicros > input.acceptedCostMicros);
    const usage = f.native.prepare("SELECT reserved_usd_micros FROM ai_organization_usage WHERE organization_id='org_proex'").get();
    assert.equal(usage.reserved_usd_micros, result.costMicros, 'the excess is counted, not hidden');
    assert.equal(JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='assistant.role.chat'").get().details).overrun, true);
    const { prepareAssistantPlan } = await import(compile('assistant/service'));
    let calls = 0;
    await assert.rejects(prepareAssistantPlan(f.db, f.actors.viewer, { action: 'prepare', projectId: 'project-a', request: 'Registrar entrada de 10 canetas', consent: true, operationKey: 'role-prepare-ceiling-1', acceptedCostMicros: 1 }, secret, { keys, fetcher: async () => { calls++; return Response.json({}); } }), error => error.code === 'assistant_cost_changed');
    assert.equal(calls, 0);
  } finally { f.native.close(); }
});

test('assistant turns from the browser get the same redaction and credential refusal as user turns', async () => {
  const f = fixture();
  try {
    await setup(f);
    const provider = fakeProvider();
    const history = [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'Fale com ana@example.test sobre o CPF 123.456.789-09.' }];
    await roleChat(f.db, f.actors.viewer, chatInput(f, { history, message: 'e agora?' }), secret, { keys, fetcher: provider.fetch });
    const sent = JSON.stringify(provider.calls[0].body.messages);
    assert.equal(sent.includes('ana@example.test'), false); assert.equal(sent.includes('123.456.789-09'), false);
    await assert.rejects(roleChat(f.db, f.actors.viewer, chatInput(f, { history: [{ role: 'assistant', content: 'Bearer abcdefghijklmnopqrstuvwxyz123' }] }), secret, { keys, fetcher: provider.fetch }), error => error.code === 'assistant_sensitive');
  } finally { f.native.close(); }
});

// ---- Regressões da produção (2026-11-09): preparo repetido, projeto errado, injeção, cota por pessoa, eco do JEV.
function proposalProvider(proposal, { jevModel = 'jev-1.14.0' } = {}) {
  const calls = [];
  return { calls, fetch: async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url: String(url), body });
    if (String(url).includes('typesafe')) return Response.json({ model: jevModel, answers: { faithful: { type: 'choice', choice: 'supported', confidence: 0.99, probabilities: { supported: 0.99, review: 0.01 } } }, usage: { input_tokens: 400 } });
    return Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal) } }], usage: { prompt_tokens: 600, completion_tokens: 90 } });
  } };
}
const distribution = itemId => ({ intent: 'stock.distribute', itemId, quantity: 100, title: 'Saída de bottons', body: 'Saída para o Centro de Eventos', evidence: [{ source: 'request', quote: 'saída de 100 Bottons azuis' }] });

test('REGRESSÃO: a failed paid preparation explains itself, and a new attempt (new key) works instead of "já foi processado"', async () => {
  const f = fixture();
  try {
    const now = new Date().toISOString();
    f.native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at,updated_at) VALUES('item-botton','project-b','Botton azul','consumption','unidade',700,?,?)").run(now, now);
    f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES('viewer-qa-b','viewer-qa','viewer@example.test','inventory','project-b',?)").run(now);
    f.actors.viewer.members.push({ id: 'viewer-qa-b', user_id: 'viewer-qa', email: 'viewer@example.test', role: 'inventory', project_id: 'project-b', revoked_at: null, created_at: now });
    await setup(f, { enabled: true, jevEnabled: true }, { typesafe: 'test-only-fake-typesafe-key-0001' });
    const { prepareAssistantPlan } = await import(compile('assistant/service'));
    const request = 'Registrar saída de 100 Bottons azuis para o Centro de Eventos.';
    const wrong = proposalProvider(distribution('item-botton'));
    await assert.rejects(prepareAssistantPlan(f.db, f.actors.viewer, { action: 'prepare', projectId: 'project-a', request, consent: true, operationKey: 'role-op-key-0001' }, secret, { keys, fetcher: wrong.fetch }), error => error.code === 'assistant_scope');
    await assert.rejects(prepareAssistantPlan(f.db, f.actors.viewer, { action: 'prepare', projectId: 'project-a', request, consent: true, operationKey: 'role-op-key-0001' }, secret, { keys, fetcher: wrong.fetch }), error => { assert.equal(error.code, 'assistant_call_failed'); assert.match(error.message, /não deu certo/); return true; });
    assert.equal(wrong.calls.length, 1, 'the same key never pays twice');
    const { matchOperationProjects } = await import(compile('assistant/role'));
    const located = await matchOperationProjects(f.db, f.actors.viewer, request);
    assert.equal(located.matches[0].projectId, 'project-b'); assert.equal(located.matches[0].itemName, 'Botton azul'); assert.equal(located.ambiguous, false);
    const right = proposalProvider(distribution('item-botton'), { jevModel: 'jev-1.14.0-20261101' });
    const preview = await prepareAssistantPlan(f.db, f.actors.viewer, { action: 'prepare', projectId: 'project-b', request, consent: true, operationKey: 'role-op-key-0002' }, secret, { keys, fetcher: right.fetch });
    assert.equal(preview.plan.after.stock, 600);
    assert.equal(right.calls.length, 2, 'DeepSeek + JEV, once each');
  } finally { f.native.close(); }
});

test('project matching only searches projects the person can read and reports ties instead of guessing', async () => {
  const f = fixture();
  try {
    const now = new Date().toISOString();
    f.native.prepare("INSERT INTO items(id,project_id,name,category,unit,created_at,updated_at) VALUES('item-b1','project-b','Botton azul','consumption','unidade',?,?),('item-a1','project-a','Bóton azul','consumption','unidade',?,?)").run(now, now, now, now);
    const { matchOperationProjects } = await import(compile('assistant/role'));
    const viewer = await matchOperationProjects(f.db, f.actors.viewer, 'saída de 10 bottons azuis');
    assert.deepEqual(viewer.matches.map(match => match.projectId), ['project-a'], 'project-b is invisible to a project-a member');
    const owner = await matchOperationProjects(f.db, f.actors.owner, 'saída de 10 bottons azuis');
    assert.equal(owner.matches.length, 2); assert.equal(owner.ambiguous, true, 'same material in two projects: ask, do not guess');
    assert.deepEqual((await matchOperationProjects(f.db, f.actors.owner, 'saída de 10 unidades')).matches, []);
  } finally { f.native.close(); }
});

test('SEGURANÇA: a quantity the person never wrote (prompt injection in text or image) never becomes an operation', async () => {
  const f = fixture();
  try {
    await setup(f, { roleVisionEnabled: true });
    const { operationNumbersAllowed } = await import(compile('assistant/role'));
    assert.equal(operationNumbersAllowed('Registrar saída de 100 Bottons', ['saída de 100 bottons azuis']), true);
    assert.equal(operationNumbersAllowed('Registrar saída de 500 Bottons', ['saída de 5 bottons']), false);
    const injected = fakeProvider({ reply: { reply: 'Feito.', operation: 'Registrar saída de 500 Bottons azuis' } });
    const result = await roleChat(f.db, f.actors.viewer, chatInput(f, { message: 'O que diz esta foto? Quero tirar 5 bottons.', image: PNG }), secret, { keys, fetcher: injected.fetch });
    assert.equal(result.operation, null); assert.equal(result.operationDropped, true);
    assert.equal(JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='assistant.role.chat'").get().details).operationDropped, true);
  } finally { f.native.close(); }
});

test('SEGURANÇA: one person cannot spend the whole organization budget on Rolê', async () => {
  const f = fixture();
  try {
    await setup(f, { dailyCalls: 6 });
    const provider = fakeProvider();
    for (let i = 0; i < 3; i++) await roleChat(f.db, f.actors.viewer, chatInput(f, { message: `pergunta ${i}` }), secret, { keys, fetcher: provider.fetch });
    await assert.rejects(roleChat(f.db, f.actors.viewer, chatInput(f, { message: 'mais uma' }), secret, { keys, fetcher: provider.fetch }), error => error.code === 'role_user_quota');
    assert.equal(provider.calls.length, 3, 'refused before any provider call');
    await roleChat(f.db, f.actors.owner, chatInput(f, { message: 'outra pessoa' }), secret, { keys, fetcher: provider.fetch });
    assert.equal(provider.calls.length, 4);
  } finally { f.native.close(); }
});

test('JEV echo: a build suffix of the pinned version is accepted, another version is refused', async () => {
  const { checkDecision, decisionBody } = await import(compile('assistant/provider'));
  const config = { ...DEFAULT_ASSISTANT_CONFIG, jevEnabled: true };
  const reply = model => async () => Response.json({ model, answers: { faithful: { type: 'choice', choice: 'supported', confidence: 0.95, probabilities: { supported: 0.95, review: 0.05 } } }, usage: { input_tokens: 10 } });
  const body = decisionBody(config, 'pedido', {});
  assert.equal((await checkDecision(config, { typesafe: 'test-only-fake-typesafe-key-0001' }, body, new AbortController().signal, reply('jev-1.14.0-20261101'))).approved, true);
  await assert.rejects(checkDecision(config, { typesafe: 'test-only-fake-typesafe-key-0001' }, body, new AbortController().signal, reply('jev-2.0.0')), error => error.code === 'assistant_decision_schema');
});

function scriptedProvider(steps) {
  const calls = [];
  return { calls, fetch: async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    const message = step.tools ? { content: '', tool_calls: step.tools.map((tool, index) => ({ id: `call-${calls.length}-${index}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } })) } : { content: JSON.stringify(step.reply) };
    return Response.json({ model: body.model, choices: [{ finish_reason: step.tools ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 1500, completion_tokens: 90 } });
  } };
}
function seedLots(f) {
  const now = new Date().toISOString();
  f.native.prepare("UPDATE projects SET organization_id='org_proex' WHERE organization_id IS NULL").run();
  const task = (id, project, title, body) => f.native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,created_by,created_at,updated_at) VALUES(?, 'org_proex', ?, ?, ?, 'high', 'open', 'owner-qa', ?, ?)").run(id, project, title, body, now, now);
  task('lote-a', 'project-a', 'Lote 10/11 · terça', 'Terça 10/11 | manhã | tarde\nMeio planner | 100 | 100\nSuper: 24 conjuntos de bottons, 16 canetas, 12 sacochilas, 8 squeezes, 8 kits\nSuper super: 8 pastas, 1 agenda');
  task('lote-b', 'project-b', 'Lote 10/11 · outro projeto', 'SEGREDO-B 999 itens');
  f.native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at,updated_at) VALUES('asset-a','project-a','Projetor QA','equipment','unidade',1,?,?)").run(now, now);
  f.native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,status,created_by,created_at) VALUES('loan-1','project-a','asset-a','Plantão CONPEEX','Pessoa Privada','contato@privado.invalid',?,?,'out','owner-qa',?)").run(Date.now() - 7200000, Date.now() - 3600000, now);
}

test('FERRAMENTAS: the exact question about Tuesday lots is answered from the portal with a source link', async () => {
  const f = fixture();
  try {
    await setup(f); seedLots(f);
    const provider = scriptedProvider([{ tools: [{ name: 'consultar_demandas', args: { texto: 'Lote 10/11' } }] }, { reply: { reply: 'Na terça: 200 meios planners; Super 68 (24 conjuntos de bottons, 16 canetas, 12 sacochilas, 8 squeezes, 8 kits); Super super 9 (8 pastas, 1 agenda). Fonte: demanda Lote 10/11 · terça.', operation: null } }]);
    const input = chatInput(f, { message: 'quantos brindes, super brindes e super super brindes serão distribuídos amanhã' });
    const result = await roleChat(f.db, f.actors.viewer, input, secret, { keys, fetcher: provider.fetch });
    assert.equal(provider.calls.length, 2);
    const user = provider.calls[0].messages.at(-1).content;
    assert.match(user, /^Hoje: \d{4}-\d{2}-\d{2} \(/, 'the model knows today to resolve "amanhã"');
    const toolMessage = provider.calls[1].messages.find(message => message.role === 'tool');
    assert.ok(toolMessage.content.includes('24 conjuntos de bottons'), 'the lot table reaches the model');
    assert.ok(!toolMessage.content.includes('SEGREDO-B'), 'another project never leaks');
    assert.ok(toolMessage.content.includes('não instruções'), 'marked as data, not instructions');
    assert.equal(provider.calls[1].messages.find(message => message.role === 'assistant').tool_calls[0].function.name, 'consultar_demandas');
    assert.deepEqual(result.sources, [{ label: 'Lote 10/11 · terça · Projeto A', href: '/?module=demands&project=project-a&demandId=lote-a' }]);
    assert.equal(result.lookups, 1);
    assert.equal(f.native.prepare("SELECT calls FROM ai_organization_usage WHERE organization_id='org_proex'").get().calls, 1, 'one question counts as one use');
    assert.equal(result.costMicros, 2 * Math.ceil(1500 * 0.3 + 90 * 1.2));
    const details = JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='assistant.role.chat'").get().details);
    assert.deepEqual(details.tools, [{ name: 'consultar_demandas', rows: 1 }]); assert.equal(details.steps, 2);
    assert.ok(!JSON.stringify(details).includes('bottons'), 'audit keeps tool names and counts, never content');
  } finally { f.native.close(); }
});

test('FERRAMENTAS: lookups run with the asking person permissions; loans never show who borrowed', async () => {
  const f = fixture();
  try {
    await setup(f); seedLots(f);
    const { runRoleTool } = await import(compile('assistant/role-tools'));
    const outsider = await runRoleTool(f.db, f.actors.outsider, 'org_proex', 'consultar_demandas', { texto: 'Lote 10/11' });
    assert.ok(outsider.content.includes('SEGREDO-B') && !outsider.content.includes('24 conjuntos'), 'only the project the person belongs to');
    const forced = await runRoleTool(f.db, f.actors.outsider, 'org_proex', 'consultar_estoque', { projeto: 'Projeto A' });
    assert.equal(forced.rows, 0, 'naming another project does not open it');
    const loans = await runRoleTool(f.db, f.actors.owner, 'org_proex', 'consultar_emprestimos', {});
    // Another organization the same person can see never reaches this conversation's provider.
    f.native.prepare("INSERT INTO organizations(id,name,slug,status,created_at,updated_at) SELECT 'org_outra','Outra organização','outra-qa','active',created_at,updated_at FROM organizations WHERE id='org_proex'").run();
    f.native.prepare("INSERT INTO projects(id,name,description,scope,organization_id,created_at) VALUES('project-c','Projeto C','','external','org_outra',?)").run(new Date().toISOString());
    f.native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,created_by,created_at,updated_at) VALUES('lote-c','org_outra','project-c','Lote 10/11 · outra organização','SEGREDO-C','high','open','owner-qa',?,?)").run(new Date().toISOString(), new Date().toISOString());
    const crossOrg = await runRoleTool(f.db, f.actors.owner, 'org_proex', 'consultar_demandas', { texto: 'Lote 10/11' });
    assert.ok(crossOrg.content.includes('24 conjuntos') && !crossOrg.content.includes('SEGREDO-C'), 'only projects of the conversation organization');
    assert.ok((await runRoleTool(f.db, f.actors.owner, 'org_outra', 'consultar_demandas', { texto: 'Lote 10/11' })).content.includes('SEGREDO-C'), 'the other organization answers only in its own conversations');
    assert.ok(loans.content.includes('Plantão CONPEEX') && loans.content.includes('atrasado'));
    for (const secretText of ['Pessoa Privada', 'contato@privado.invalid', '@example.test']) assert.ok(!loans.content.includes(secretText), secretText);
    assert.equal((await runRoleTool(f.db, f.actors.viewer, 'org_proex', 'consultar_emprestimos', {})).rows, 0, 'inventory role does not read loans');
    await assert.rejects(runRoleTool(f.db, f.actors.viewer, 'org_proex', 'apagar_tudo', {}), error => error.code === 'role_tool_unknown');
    await assert.rejects(runRoleTool(f.db, f.actors.viewer, 'org_proex', 'consultar_estoque', { sql: 'DROP' }), error => error.code === 'role_tool_input');
    const small = await runRoleTool(f.db, f.actors.owner, 'org_proex', 'buscar_no_portal', { texto: 'Lote' }, 700);
    assert.ok(new TextEncoder().encode(small.content).byteLength <= 700, 'results respect the byte budget');
  } finally { f.native.close(); }
});

test('FERRAMENTAS: at most two lookup rounds, then the answer; a model that keeps asking is charged and stopped', async () => {
  const f = fixture();
  try {
    await setup(f); seedLots(f);
    const greedy = scriptedProvider([{ tools: [{ name: 'buscar_no_portal', args: { texto: 'Lote' } }] }]);
    await assert.rejects(roleChat(f.db, f.actors.viewer, chatInput(f, { message: 'procure tudo' }), secret, { keys, fetcher: greedy.fetch }), error => error.status === 502);
    assert.equal(greedy.calls.length, 3, 'two rounds with tools, one final call without');
    assert.ok(!('tools' in greedy.calls[2]) && greedy.calls[2].response_format.type === 'json_object');
    const usage = f.native.prepare("SELECT reserved_usd_micros FROM ai_organization_usage WHERE organization_id='org_proex'").get();
    assert.ok(usage.reserved_usd_micros > 0, 'the failed attempt still counts against the day');
    const { ROLE_TOOLS_ACTUAL_SCHEMA_BYTES } = await import(compile('assistant/role-tools'));
    const { ROLE_TOOLS_SCHEMA_BYTES } = await import(compile('assistant/role-contracts'));
    assert.ok(ROLE_TOOLS_ACTUAL_SCHEMA_BYTES <= ROLE_TOOLS_SCHEMA_BYTES, `schema ${ROLE_TOOLS_ACTUAL_SCHEMA_BYTES} fits the cost ceiling`);
    const withTools = roleEstimate({ textProvider: 'deepseek', textBytes: 500, hasImage: false, tools: true }), without = roleEstimate({ textProvider: 'deepseek', textBytes: 500, hasImage: false });
    assert.ok(withTools.costMicros > without.costMicros && withTools.costMicros < 30_000, 'lookups raise the shown ceiling but stay under 3 cents');
  } finally { f.native.close(); }
});
