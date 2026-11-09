import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Dados sintéticos; todo transporte é falso. Nenhuma chamada sai da máquina.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-catalog-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { DEFAULT_ASSISTANT_CONFIG } = await import(compile('assistant/contracts'));
const { configureAssistant } = await import(compile('assistant/service'));
const { manageAssistantCredential, assistantCredentialVault } = await import(compile('assistant/credential-vault'));
const { safeBaseUrl, validateModel, defaultCatalog, compareEstimate } = await import(compile('assistant/model-catalog'));
const { catalogView, manageCatalog, loadCatalog } = await import(compile('assistant/model-catalog-store'));
const { compareModels } = await import(compile('assistant/model-compare'));
const { roleChat, roleStatus } = await import(compile('assistant/role'));
const { roleEstimate, roleConversationBytes } = await import(compile('assistant/role-contracts'));

const secret = 'test-only-catalog-auth-secret-no-production-access';
const keys = { current: 'synthetic-only-independent-key-for-catalog-tests-0' };
const CUSTOM_KEY = 'sk-CANARIO-custom-provider-0000-AB12';
const ANTHROPIC_KEY = 'sk-ant-CANARIO-anthropic-0000-CD34';
const PNG = (() => { const h = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(h, 0); h.writeUInt32BE(13, 8); h.write('IHDR', 12, 'ascii'); h.writeUInt32BE(320, 16); h.writeUInt32BE(240, 20); return 'data:image/png;base64,' + Buffer.concat([h, Buffer.alloc(99, 7)]).toString('base64'); })();

function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString();
  native.prepare("INSERT INTO projects(id,name,description,scope,created_at) VALUES('project-a','Projeto A','','external',?)").run(now);
  const actors = {};
  for (const [role, project] of [['owner', null], ['member', 'project-a']]) {
    const userId = `${role}-qa`, email = `${role}@example.test`, memberRole = role === 'owner' ? 'owner' : 'inventory';
    native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
    native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(userId, userId, email, memberRole, project, now);
    actors[role] = { userId, email, displayName: role, capabilities: [], members: [{ id: userId, user_id: userId, email, role: memberRole, project_id: project, revoked_at: null, created_at: now }] };
  }
  const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  return { native, db, actors };
}
const view = f => catalogView(f.db, f.actors.owner, 'org_proex', secret, keys);
const act = async (f, body) => manageCatalog(f.db, f.actors.owner, { organizationId: 'org_proex', expected: (await view(f)).stamp, ...body }, secret, keys);
async function baseSettings(f) {
  const vault = await manageAssistantCredential(f.db, f.actors.owner, { action: 'save', organizationId: 'org_proex', provider: 'deepseek', expectedRevision: 0, label: 'DeepSeek teste', secret: 'test-only-fake-deepseek-key-0001' }, secret, keys);
  return vault.revision;
}
async function addCustom(f) {
  await act(f, { action: 'provider.save', provider: { id: 'meu-servico', label: 'Meu serviço', kind: 'openai_chat', baseUrl: 'https://api.exemplo-ia.com.br/v1' } });
  await act(f, { action: 'model.save', model: { id: 'meu-modelo', providerId: 'meu-servico', model: 'modelo-x-mini', label: 'Modelo X mini', capabilities: ['text', 'vision'], price: { inputPerM: 0.5, outputPerM: 2 }, source: { url: 'https://exemplo-ia.com.br/precos', readAt: '2026-11-09' } } });
  await act(f, { action: 'key.save', providerId: 'meu-servico', label: 'Chave do meu serviço', secret: CUSTOM_KEY });
}

test('base URLs: only public https hosts, no IPs, ports, credentials or internal names', () => {
  assert.equal(safeBaseUrl('https://integrate.api.nvidia.com/v1/'), 'https://integrate.api.nvidia.com/v1');
  for (const bad of ['http://api.x.com', 'https://127.0.0.1/v1', 'https://localhost/v1', 'https://api.x.com:8443', 'https://user:pass@api.x.com', 'https://[::1]/', 'https://metadata.google.internal/', 'https://intranet/v1', 'https://api.x.com/v1?key=1', 'ftp://api.x.com', 'https://169.254.169.254/latest'])
    assert.throws(() => safeBaseUrl(bad), error => error.code === 'catalog_invalid', bad);
});

test('model validation refuses pasted keys, missing capabilities and absurd prices', () => {
  const providers = defaultCatalog().providers;
  const ok = validateModel({ id: 'x-1', providerId: 'openai', model: 'gpt-6-luna', label: 'Luna', capabilities: ['text', 'bogus'], price: { inputPerM: '0.1', outputPerM: 0.5 } }, providers);
  assert.deepEqual(ok.capabilities, ['text']); assert.equal(ok.price.inputPerM, 0.1);
  assert.throws(() => validateModel({ id: 'x-2', providerId: 'openai', model: 'gpt', label: 'sk-abcdefghijklmnopqrstuv', capabilities: ['text'] }, providers), /chave/);
  assert.throws(() => validateModel({ id: 'x-3', providerId: 'openai', model: 'gpt', label: 'Ok', capabilities: [] }, providers));
  assert.throws(() => validateModel({ id: 'x-4', providerId: 'openai', model: 'gpt', label: 'Ok', capabilities: ['text'], price: { inputPerM: 5000 } }, providers));
  assert.throws(() => validateModel({ id: 'x-5', providerId: 'nao-existe', model: 'gpt', label: 'Ok', capabilities: ['text'] }, providers));
});

test('catalog: owner-only, compare-and-swap, defaults editable and builtin providers protected', async () => {
  const f = fixture();
  try {
    await assert.rejects(catalogView(f.db, f.actors.member, 'org_proex', secret, keys), error => error.status === 403);
    await assert.rejects(manageCatalog(f.db, f.actors.member, { action: 'model.delete', organizationId: 'org_proex', expected: '', modelId: 'deepseek-flash' }, secret, keys), error => error.status === 403);
    const first = await view(f);
    assert.ok(first.catalog.models.some(model => model.id === 'openai-gpt-6-luna'), 'study defaults present');
    await act(f, { action: 'model.delete', modelId: 'openai-gpt-5-6-luna' });
    await assert.rejects(manageCatalog(f.db, f.actors.owner, { action: 'model.delete', organizationId: 'org_proex', expected: first.stamp, modelId: 'deepseek-flash' }, secret, keys), error => error.code === 'catalog_changed', 'stale stamp');
    await assert.rejects(act(f, { action: 'provider.delete', providerId: 'deepseek' }), error => error.code === 'catalog_builtin');
    await assert.rejects(act(f, { action: 'provider.save', provider: { id: 'openai', label: 'X', kind: 'openai_chat', baseUrl: 'https://api.x.com' } }), error => error.code === 'catalog_invalid');
    const edited = await act(f, { action: 'model.save', replaceId: 'deepseek-flash', model: { ...first.catalog.models.find(model => model.id === 'deepseek-flash'), price: { inputPerM: 0.15, outputPerM: 0.6 } } });
    assert.equal(edited.catalog.models.find(model => model.id === 'deepseek-flash').price.inputPerM, 0.15);
    assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action LIKE 'assistant.catalog.%'").get().n, 2);
  } finally { f.native.close(); }
});

test('provider keys live only in the encrypted vault; catalog, view, audit and history show the hint only', async () => {
  const f = fixture();
  try {
    await baseSettings(f);
    await addCustom(f);
    const shown = await view(f);
    const provider = shown.catalog.providers.find(entry => entry.id === 'meu-servico');
    assert.equal(provider.hasKey, true); assert.equal(provider.key.mask, 'sk-…AB12');
    const settingsText = JSON.stringify(f.native.prepare('SELECT * FROM settings').all());
    const auditText = JSON.stringify(f.native.prepare('SELECT * FROM audit').all());
    const vault = await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys);
    for (const text of [settingsText, auditText, JSON.stringify(shown), JSON.stringify(vault)]) assert.equal(text.includes(CUSTOM_KEY) || text.includes(CUSTOM_KEY.slice(3, -4)), false);
    assert.ok(vault.history.some(entry => entry.provider === 'p:meu-servico' && entry.mask === 'sk-…AB12'));
    await assert.rejects(act(f, { action: 'provider.delete', providerId: 'meu-servico' }), error => error.code === 'catalog_in_use');
    await assert.rejects(act(f, { action: 'key.save', providerId: 'deepseek', label: 'x', secret: CUSTOM_KEY }), error => error.code === 'catalog_key_builtin');
    // Saving a builtin key afterwards keeps the custom key inside the same ciphertext.
    const revision = (await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys)).revision;
    await manageAssistantCredential(f.db, f.actors.owner, { action: 'save', organizationId: 'org_proex', provider: 'groq', expectedRevision: revision, label: 'Groq teste', secret: 'gsk_test_only_fake_groq_0001' }, secret, keys);
    assert.equal((await view(f)).catalog.providers.find(entry => entry.id === 'meu-servico').hasKey, true);
  } finally { f.native.close(); }
});

test('Rolê with a catalog model: generic OpenAI-compatible endpoint, catalog price, lenient JSON and plain-text fallback', async () => {
  const f = fixture();
  try {
    let revision = await baseSettings(f);
    await addCustom(f);
    revision = (await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys)).revision;
    await assert.rejects(configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision, config: { ...DEFAULT_ASSISTANT_CONFIG, usageScope: 'organization', roleEnabled: true, roleModel: 'groq-whisper-turbo' } }, secret, undefined, keys), error => error.code === 'assistant_model', 'a voice model cannot chat');
    await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision, config: { ...DEFAULT_ASSISTANT_CONFIG, usageScope: 'organization', roleEnabled: true, roleModel: 'meu-modelo', roleVisionEnabled: true, roleVisionModel: 'meu-modelo' } }, secret, undefined, keys);
    const status = await roleStatus(f.db, f.actors.member, { projectId: 'project-a' }, secret, { keys });
    assert.equal(status.available, true); assert.equal(status.textPricing.label, 'Modelo X mini'); assert.equal(status.visionAvailable, true);
    const calls = [];
    const fetcher = async (url, init) => { calls.push({ url: String(url), init, body: JSON.parse(init.body) }); return Response.json({ model: 'modelo-x-mini-2026', choices: [{ message: { content: calls.length === 1 ? 'Claro! {"reply":"Use Materiais.","operation":null}' : 'Resposta sem JSON.' } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }); };
    const message = 'Como registro uma saída?';
    const estimate = roleEstimate({ textProvider: 'deepseek', textBytes: roleConversationBytes([], message, 'Projeto A'), hasImage: false, text: status.textPricing });
    const first = await roleChat(f.db, f.actors.member, { action: 'chat', projectId: 'project-a', operationKey: 'catalog-role-0001', consent: true, message, acceptedCostMicros: estimate.costMicros }, secret, { keys, fetcher });
    assert.equal(calls[0].url, 'https://api.exemplo-ia.com.br/v1/chat/completions');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${CUSTOM_KEY}`); assert.equal(calls[0].init.redirect, 'error');
    assert.equal(calls[0].body.model, 'modelo-x-mini');
    assert.equal(first.reply, 'Use Materiais.'); assert.equal(first.costMicros, Math.ceil(1000 * 0.5 + 100 * 2));
    const imageEstimate = roleEstimate({ textProvider: 'deepseek', textBytes: roleConversationBytes([], 'E esta foto?', 'Projeto A'), hasImage: true, vision: status.visionPricing });
    const second = await roleChat(f.db, f.actors.member, { action: 'chat', projectId: 'project-a', operationKey: 'catalog-role-0002', consent: true, message: 'E esta foto?', image: PNG, acceptedCostMicros: imageEstimate.costMicros }, secret, { keys, fetcher });
    assert.equal(second.reply, 'Resposta sem JSON.'); assert.equal(second.operation, null);
    assert.equal(calls[1].body.messages.at(-1).content[1].type, 'image_url');
    await assert.rejects(configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: (await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys)).revision, config: { ...DEFAULT_ASSISTANT_CONFIG, roleEnabled: true, roleModel: 'meu-modelo' } }, secret, undefined, keys).then(() => act(f, { action: 'model.delete', modelId: 'meu-modelo' })), error => error.code === 'catalog_in_use');
  } finally { f.native.close(); }
});

test('Anthropic format: x-api-key header, /v1/messages, base64 image block, key echo withheld', async () => {
  const f = fixture();
  try {
    await baseSettings(f);
    await act(f, { action: 'key.save', providerId: 'anthropic', label: 'Anthropic teste', secret: ANTHROPIC_KEY });
    const revision = (await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys)).revision;
    await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision, config: { ...DEFAULT_ASSISTANT_CONFIG, usageScope: 'organization', roleEnabled: true, roleModel: 'anthropic-claude-haiku-5-5', roleVisionEnabled: true, roleVisionModel: 'anthropic-claude-haiku-5-5' } }, secret, undefined, keys);
    const status = await roleStatus(f.db, f.actors.member, { projectId: 'project-a' }, secret, { keys });
    let echo = false; const calls = [];
    const fetcher = async (url, init) => { calls.push({ url: String(url), init, body: JSON.parse(init.body) }); return Response.json({ model: 'claude-haiku-5-5', content: [{ type: 'text', text: echo ? `chave ${ANTHROPIC_KEY}` : '{"reply":"Olá!","operation":null}' }], usage: { input_tokens: 500, output_tokens: 40 } }); };
    const estimate = roleEstimate({ textProvider: 'deepseek', textBytes: roleConversationBytes([], 'Foto?', 'Projeto A'), hasImage: true, vision: status.visionPricing });
    const result = await roleChat(f.db, f.actors.member, { action: 'chat', projectId: 'project-a', operationKey: 'catalog-anthropic-1', consent: true, message: 'Foto?', image: PNG, acceptedCostMicros: estimate.costMicros }, secret, { keys, fetcher });
    assert.equal(result.reply, 'Olá!');
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages'); assert.equal(calls[0].init.headers['x-api-key'], ANTHROPIC_KEY);
    assert.equal(calls[0].body.messages.at(-1).content[1].type, 'image'); assert.equal(calls[0].body.messages.at(-1).content[1].source.type, 'base64');
    echo = true;
    await assert.rejects(roleChat(f.db, f.actors.member, { action: 'chat', projectId: 'project-a', operationKey: 'catalog-anthropic-2', consent: true, message: 'Foto?', image: PNG, acceptedCostMicros: estimate.costMicros }, secret, { keys, fetcher }), error => { assert.equal(String(error.message).includes(ANTHROPIC_KEY), false); return true; });
  } finally { f.native.close(); }
});

test('comparison: owner-only, consent and ceiling first, one failure isolated, usage reserved and audited without the prompt', async () => {
  const f = fixture();
  try {
    await baseSettings(f);
    await addCustom(f);
    const revision = (await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys)).revision;
    await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision, config: { ...DEFAULT_ASSISTANT_CONFIG, usageScope: 'organization' } }, secret, undefined, keys);
    const prompt = 'Extraia em JSON a quantidade: saíram 12 canetas.';
    const { catalog } = await loadCatalog(f.db, 'org_proex');
    const total = compareEstimate(['deepseek-flash', 'meu-modelo'].map(id => catalog.models.find(model => model.id === id)), prompt).total;
    const input = { action: 'compare', organizationId: 'org_proex', modelIds: ['deepseek-flash', 'meu-modelo'], prompt, consent: true, acceptedCostMicros: total };
    let calls = 0;
    const fetcher = async url => { calls++; if (String(url).includes('exemplo-ia')) return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }); return Response.json({ model: 'deepseek-flash', choices: [{ message: { content: '{"quantidade":12}' } }], usage: { prompt_tokens: 80, completion_tokens: 10 } }); };
    await assert.rejects(compareModels(f.db, f.actors.member, input, secret, keys, { fetcher }), error => error.status === 403);
    await assert.rejects(compareModels(f.db, f.actors.owner, { ...input, consent: false }, secret, keys, { fetcher }), error => error.code === 'assistant_consent');
    await assert.rejects(compareModels(f.db, f.actors.owner, { ...input, acceptedCostMicros: 1 }, secret, keys, { fetcher }), error => error.code === 'role_cost_changed');
    assert.equal(calls, 0);
    const result = await compareModels(f.db, f.actors.owner, input, secret, keys, { fetcher });
    assert.equal(calls, 2);
    assert.equal(result.results[0].text, '{"quantidade":12}'); assert.ok(result.results[1].error);
    assert.equal(f.native.prepare("SELECT reserved_usd_micros r FROM ai_organization_usage").get().r, total);
    const audit = f.native.prepare("SELECT details FROM audit WHERE action='assistant.compare'").get().details;
    assert.equal(audit.includes('canetas'), false); assert.equal(JSON.parse(audit).models.length, 2);
  } finally { f.native.close(); }
});

test('Artificial Analysis scores: needs its key, matches catalog models by API name, keeps only the index', async () => {
  const f = fixture();
  try {
    await baseSettings(f);
    await assert.rejects(act(f, { action: 'scores.refresh' }), error => error.code === 'catalog_key');
    await act(f, { action: 'key.save', providerId: 'artificialanalysis', label: 'AA', secret: 'aa_test_only_fake_reference_key_0001' });
    const fetcher = async (url, init) => { assert.equal(String(url), 'https://artificialanalysis.ai/api/v2/language/models'); assert.equal(init.headers['x-api-key'], 'aa_test_only_fake_reference_key_0001');
      return Response.json({ data: [{ slug: 'gpt-6-luna', name: 'GPT-6 Luna', evaluations: { artificial_analysis_intelligence_index: 28 }, pricing: { price_1m_input_tokens: 0.1 } }, { slug: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', evaluations: { artificial_analysis_intelligence_index: 33 } }] }); };
    const result = await manageCatalog(f.db, f.actors.owner, { action: 'scores.refresh', organizationId: 'org_proex', expected: (await view(f)).stamp }, secret, keys, { fetcher });
    assert.equal(result.refreshed.matched, 3, 'DeepSeek Flash, its NVIDIA copy and GPT-6 Luna');
    assert.equal(result.catalog.models.find(model => model.id === 'nvidia-deepseek-v4-1-flash').score.value, 33);
    assert.equal(result.catalog.models.find(model => model.id === 'openai-gpt-6-luna').score.value, 28);
    assert.equal(result.catalog.models.find(model => model.id === 'deepseek-flash').score.source, 'Artificial Analysis');
  } finally { f.native.close(); }
});

// ---- Revisão de segurança (2026-11-09): achados P1/P2 corrigidos.
test('SEGURANÇA P1: only the administração geral picks catalog models for the Rolê; test-only models never receive real chats', async () => {
  const f = fixture();
  try {
    const now = new Date().toISOString();
    f.native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES('orgowner-qa','orgowner@example.test','active',?,?)").run(now, now);
    f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES('orgowner-qa','orgowner-qa','orgowner@example.test','owner',NULL,'org_proex',?)").run(now);
    const orgOwner = { userId: 'orgowner-qa', email: 'orgowner@example.test', displayName: 'orgowner', capabilities: [], members: [{ id: 'orgowner-qa', user_id: 'orgowner-qa', email: 'orgowner@example.test', role: 'owner', project_id: null, organization_id: 'org_proex', revoked_at: null, created_at: now }] };
    await baseSettings(f);
    await addCustom(f);
    let revision = (await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys)).revision;
    await assert.rejects(configureAssistant(f.db, orgOwner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision, config: { ...DEFAULT_ASSISTANT_CONFIG, roleEnabled: true, roleModel: 'meu-modelo' } }, secret, undefined, keys), error => error.code === 'catalog_admin');
    await act(f, { action: 'key.save', providerId: 'nvidia', label: 'NVIDIA teste', secret: 'nvapi-test-only-fake-nvidia-key-0000-EF56' });
    revision = (await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys)).revision;
    await assert.rejects(configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision, config: { ...DEFAULT_ASSISTANT_CONFIG, roleEnabled: true, roleModel: 'nvidia-deepseek-v4-1-flash' } }, secret, undefined, keys), error => error.code === 'assistant_model');
    assert.equal((await view(f)).catalog.models.find(model => model.id === 'nvidia-deepseek-v4-1-flash').testOnly, true);
  } finally { f.native.close(); }
});

test('SEGURANÇA P2: a model in use cannot be swapped by editing it; paid models need a real price; masks and labels never carry the key', async () => {
  const f = fixture();
  try {
    await baseSettings(f);
    await addCustom(f);
    const revision = (await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys)).revision;
    await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision, config: { ...DEFAULT_ASSISTANT_CONFIG, roleEnabled: true, roleModel: 'meu-modelo' } }, secret, undefined, keys);
    const current = (await view(f)).catalog.models.find(model => model.id === 'meu-modelo');
    await assert.rejects(act(f, { action: 'model.save', replaceId: 'meu-modelo', model: { ...current, model: 'outro-modelo-caro' } }), error => error.code === 'catalog_in_use');
    await assert.rejects(act(f, { action: 'model.save', replaceId: 'meu-modelo', model: { ...current, id: 'renomeado' } }), error => error.code === 'catalog_in_use');
    const repriced = await act(f, { action: 'model.save', replaceId: 'meu-modelo', model: { ...current, price: { inputPerM: 0.6, outputPerM: 2.4 } } });
    assert.equal(repriced.catalog.models.find(model => model.id === 'meu-modelo').price.inputPerM, 0.6, 'price corrections stay allowed');
    await assert.rejects(act(f, { action: 'model.save', model: { id: 'gratis', providerId: 'openai', model: 'gpt-6.1-terra', label: 'Terra grátis?', capabilities: ['text'], price: { inputPerM: 0, outputPerM: 0 } } }), error => error.code === 'catalog_invalid');
    await act(f, { action: 'model.save', model: { id: 'gratis-teste', providerId: 'nvidia', model: 'algum/modelo', label: 'Teste grátis', capabilities: ['text'], testOnly: true } });
    const shortKey = 'abcdef123456';
    await act(f, { action: 'key.save', providerId: 'anthropic', label: 'Anthropic', secret: shortKey });
    assert.equal((await view(f)).catalog.providers.find(provider => provider.id === 'anthropic').key.mask, '…••••', 'short keys are fully hidden');
    await assert.rejects(act(f, { action: 'key.save', providerId: 'nace', label: 'minha chave 0000-AB12-xyz', secret: 'test-only-fake-nace-0000-AB12-xyz' }), error => error.code === 'catalog_key');
  } finally { f.native.close(); }
});

test('SEGURANÇA P2: when a provider already charged, the cost still counts against the daily limit', async () => {
  const f = fixture();
  try {
    await baseSettings(f);
    await addCustom(f);
    const revision = (await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys)).revision;
    await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision, config: { ...DEFAULT_ASSISTANT_CONFIG, usageScope: 'organization', roleEnabled: true, roleModel: 'meu-modelo' } }, secret, undefined, keys);
    const status = await roleStatus(f.db, f.actors.member, { projectId: 'project-a' }, secret, { keys });
    const estimate = roleEstimate({ textProvider: 'deepseek', textBytes: roleConversationBytes([], 'Oi', 'Projeto A'), hasImage: false, text: status.textPricing });
    const fetcher = async () => Response.json({ model: 'modelo-x-mini', choices: [{ message: { content: '' } }], usage: { prompt_tokens: 50000, completion_tokens: 700 } });
    await assert.rejects(roleChat(f.db, f.actors.member, { action: 'chat', projectId: 'project-a', operationKey: 'charged-failure-1', consent: true, message: 'Oi', acceptedCostMicros: estimate.costMicros }, secret, { keys, fetcher }), error => error.code === 'generic_provider_schema');
    const charged = Math.ceil(50000 * 0.5 + 700 * 2);
    assert.equal(f.native.prepare('SELECT reserved_usd_micros r FROM ai_organization_usage').get().r, charged, 'reservation raised to the real charge');
  } finally { f.native.close(); }
});

test('SEGURANÇA P3: a deleted provider id cannot be recreated to inherit a stored key; base URL with trailing dot is refused', async () => {
  const f = fixture();
  try {
    await baseSettings(f);
    await act(f, { action: 'provider.save', provider: { id: 'temporario', label: 'Temporário', kind: 'openai_chat', baseUrl: 'https://api.temporario-ia.com/v1' } });
    await act(f, { action: 'key.save', providerId: 'temporario', label: 'Temp', secret: 'sk-test-only-fake-temp-key-0000-GH78' });
    await assert.rejects(act(f, { action: 'provider.delete', providerId: 'temporario' }), error => error.code === 'catalog_in_use');
    await act(f, { action: 'key.remove', providerId: 'temporario' });
    await act(f, { action: 'provider.delete', providerId: 'temporario' });
    assert.throws(() => safeBaseUrl('https://localhost./v1'), error => error.code === 'catalog_invalid');
  } finally { f.native.close(); }
});
