import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
 if (modules.has(name)) return modules.get(name);
 if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
 let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
 source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
 const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-assistant-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { DEFAULT_ASSISTANT_CONFIG, validateProposal } = await import(compile('assistant/contracts'));
const { configureAssistant, assistantStatus, prepareAssistantPlan, applyAssistantPlan } = await import(compile('assistant/service'));
const { providerEndpoint } = await import(compile('assistant/provider'));
const { encryptCredentials, decryptCredentials, verifyPlan } = await import(compile('assistant/crypto'));
const { portalSnapshot } = await import(compile('portal-data'));
const { describePortableSchemas, exportPortablePage } = await import(compile('sync/portable'));
const { syncStatus } = await import(compile('sync/control'));
const { listSyncAttachments } = await import(compile('sync/attachments'));
const { startReviewedDictation } = await import(compile('assistant/dictation'));
const { manageAssistantGrant } = await import(compile('assistant/settings'));
const { transcribeSpeech, validateSpeechAudio, speechEndpoint, SPEECH_ENDPOINT } = await import(compile('assistant/speech'));
const { encodeSpeechWav, prepareSpeechWav } = await import(compile('../components/portal/speech-audio'));
const secret = 'test-only-assistant-auth-secret-no-production-access';
const key = 'test-only-fake-provider-credential';
function fixture() {
 const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
 for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
 const now = new Date().toISOString(); native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('unit-synthetic','Outra org','outra-org',?,?)").run(now,now);
 native.prepare("INSERT INTO projects(id,name,description,scope,created_at) VALUES('project-a','Projeto A','','external',?),('project-b','Projeto B','','external',?)").run(now, now);
 native.prepare("INSERT INTO items(id,project_id,name,category,unit,created_at,updated_at) VALUES('item-a','project-a','Caneta QA','consumption','unidade',?,?),('item-b','project-b','Outro material','consumption','unidade',?,?)").run(now, now, now, now);
 const actors = {};
 for (const [role, project] of [['owner', null], ['manager', 'project-a'], ['inventory', 'project-a'], ['viewer', 'project-a']]) {
  const userId = `${role}-qa`, email = `${role}@example.test`;
  native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
  native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(userId, userId, email, role, project, now);
  actors[role] = { userId, email, displayName: role, capabilities: [], members: [{ id: userId, user_id: userId, email, role, project_id: project, revoked_at: null, created_at: now }] };
 }
 let failReceipt = false, beforeStockBatch = null, beforeOtherBatch = null;
 const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { if (failReceipt && /UPDATE ai_plans SET status='applied'/.test(sql)) { failReceipt = false; throw new Error('synthetic_receipt_failure'); } const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { if(beforeOtherBatch&&statements.some(statement=>beforeOtherBatch.pattern.test(statement.sql))){const hook=beforeOtherBatch.callback;beforeOtherBatch=null;hook();} if (beforeStockBatch && statements.some(statement => /INSERT INTO stock_movements/.test(statement.sql))) { const hook = beforeStockBatch; beforeStockBatch = null; hook(); } native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
 return { native, db, actors, failReceiptOnce() { failReceipt = true; }, raceStockOnce(callback) { beforeStockBatch = callback; }, raceBatch(pattern,callback){beforeOtherBatch={pattern,callback};} };
}
const configInput = (config = {}, extra = {}) => ({ action: 'configure', organizationId: 'org_proex', expectedRevision: 0, config: { ...DEFAULT_ASSISTANT_CONFIG, enabled: true, ...config }, deepseekKey: key, ...extra });
const request = (extra = {}) => ({ action: 'prepare', projectId: 'project-a', request: 'Registrar entrada de 10 canetas recebidas para a oficina.', consent: true, operationKey: 'test-only-assistant-call-1', ...extra });
const proposal = (extra = {}) => ({ intent: 'stock.receive', itemId: 'item-a', quantity: 10, title: 'Entrada de canetas', body: 'Canetas recebidas para a oficina', evidence: [{ source: 'request', quote: 'entrada de 10 canetas' }], ...extra });
function fakeProvider(overrides = {}) { let calls = 0; return { get calls() { return calls; }, fetch: async (url, init) => { calls++; assert.equal(init.redirect, 'error'); assert.ok(init.signal); assert.match(init.headers.Authorization, /^Bearer test-only/); const body = JSON.parse(init.body); if (String(url).includes('typesafe')) return Response.json({ model: body.model, answers: { faithful: { type: 'choice', choice: 'supported', confidence: 0.99, probabilities: { supported: 0.99, review: 0.01 }, ...overrides.decision } }, usage: { input_tokens: 500 } }); assert.equal(body.thinking.type, 'disabled'); assert.equal(body.response_format.type, 'json_object'); return Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal(overrides.proposal)) } }], usage: { prompt_tokens: 500, completion_tokens: 100 }, ...overrides.response }); } }; }
const confirm = preview => ({ action: 'apply', planToken: preview.planToken, confirmed: true });
const code = expected => error => error?.code === expected;

test('credentials use authenticated encryption, cannot be decrypted after tampering or key rotation', async () => {
 const ciphertext = await encryptCredentials(secret, { deepseek: key }); assert.equal(ciphertext.includes(key), false); assert.deepEqual(await decryptCredentials(secret, ciphertext), { deepseek: key });
 await assert.rejects(decryptCredentials(secret + '-rotated', ciphertext), code('assistant_credentials_unavailable'));
 const [version, iv, bytes] = ciphertext.split('.'); await assert.rejects(decryptCredentials(secret, `${version}.${iv}.${bytes.slice(0, -2)}aa`), code('assistant_credentials_unavailable'));
});
test('only platform owner configures; no endpoint override, no plaintext echo, optimistic revision required', async () => {
 const f = fixture(); try {
  await assert.rejects(configureAssistant(f.db, f.actors.manager, configInput(), secret), code('assistant_configuration_forbidden'));
  await assert.rejects(configureAssistant(f.db, f.actors.owner, configInput({ endpoint: 'https://127.0.0.1/' }), secret), code('assistant_schema'));
  const result = await configureAssistant(f.db, f.actors.owner, configInput(), secret); assert.deepEqual(result, { ok: true, revision: 1 });
  const stored = f.native.prepare('SELECT * FROM ai_organization_settings').get(); assert.equal(stored.credentials_ciphertext.includes(key), false); assert.equal(JSON.stringify(stored).includes(key), false);
  const status = await assistantStatus(f.db, f.actors.owner, secret, 'org_proex'); assert.equal(status.available, true); assert.equal(JSON.stringify(status).includes('ciphertext'), false); assert.equal(JSON.stringify(status).includes(key), false);
  await assert.rejects(configureAssistant(f.db, f.actors.owner, configInput(), secret), code('assistant_configuration_changed'));
  if (!f.native.prepare('PRAGMA table_info(members)').all().some(row => row.name === 'organization_id')) f.native.exec('ALTER TABLE members ADD organization_id TEXT');
  f.native.prepare("UPDATE members SET organization_id='unit-synthetic' WHERE role='owner'").run();
  await assert.rejects(configureAssistant(f.db, f.actors.owner, configInput({}, { expectedRevision: 1 }), secret), code('assistant_configuration_forbidden'));
 } finally { f.native.close(); }
});
test('provider allowlist rejects SSRF, redirects, custom ports and lookalike domains before fetch', () => {
 assert.equal(providerEndpoint('deepseek'), 'https://api.deepseek.com/chat/completions');
 for (const url of ['http://127.0.0.1/', 'https://127.0.0.1/', 'https://localhost/', 'https://api.deepseek.com.evil.test/chat/completions', 'https://api.deepseek.com:8443/chat/completions', 'https://u:p@api.deepseek.com/chat/completions', 'https://api.deepseek.com/chat/completions?next=http://localhost']) assert.throws(() => providerEndpoint('deepseek', url), code('assistant_endpoint'));
 assert.throws(() => providerEndpoint('unknown'), code('assistant_endpoint'));
});
test('unconfigured and non-consenting requests make no paid calls; scope A cannot inspect project B', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch }), code('assistant_unavailable'));
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ consent: false }), secret, { fetcher: provider.fetch }), code('assistant_consent'));
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ projectId: 'project-b' }), secret, { fetcher: provider.fetch }), code('forbidden'));
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.viewer, request(), secret, { fetcher: provider.fetch }), code('forbidden'));
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ request: 'api_key=synthetic-secret' }), secret, { fetcher: provider.fetch }), code('assistant_sensitive'));
  assert.equal(provider.calls, 0);
 } finally { f.native.close(); }
});
test('fake provider proposes only; signed plan and normal inventory service apply once with audit', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
  assert.equal(preview.plan.before.stock, 0); assert.equal(preview.plan.after.stock, 10); assert.equal(preview.plan.actorId, undefined); assert.equal(preview.undoAvailable, false);
  assert.equal(f.native.prepare('SELECT stock FROM items WHERE id=?').get('item-a').stock, 0);
  const repeated = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch }); assert.equal(repeated.plan.id, preview.plan.id); assert.equal(provider.calls, 1);
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, { ...confirm(preview), confirmed: false }, secret), code('assistant_confirmation'));
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, { ...confirm(preview), proposal: proposal({ quantity: 999 }) }, secret), code('assistant_schema'));
  const result = await applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret); assert.ok(result.movementId);
  assert.equal((await applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret)).replayed, true);
  assert.equal(f.native.prepare('SELECT stock FROM items WHERE id=?').get('item-a').stock, 10); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 1);
  assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='assistant.apply'").get().n, 1);
 } finally { f.native.close(); }
});
test('tampered token, different actor, expired plan and revoked membership cannot apply', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
  const [body, signature] = preview.planToken.split('.');
  await assert.rejects(verifyPlan(secret, `${body.slice(0, -2)}aa.${signature}`, f.actors.inventory.userId), code('assistant_plan_invalid'));
  await assert.rejects(applyAssistantPlan(f.db, f.actors.manager, confirm(preview), secret), code('assistant_plan_invalid'));
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret, preview.plan.expiresAt + 1), code('assistant_plan_invalid'));
  f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='inventory-qa'").run(new Date().toISOString());
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret), code('forbidden'));
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 0);
 } finally { f.native.close(); }
});
test('project and DB payload tampering fail closed; changed stock requires fresh preview', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
  f.native.prepare("UPDATE ai_plans SET payload_json=replace(payload_json,'stock.receive','stock.consume') WHERE id=?").run(preview.plan.id);
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret), code('assistant_plan_invalid'));
  const next = await prepareAssistantPlan(f.db, f.actors.inventory, request({ operationKey: 'test-only-second-plan' }), secret, { fetcher: provider.fetch });
  f.native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at) VALUES('concurrent','item-a',1,'receive','QA','concurrent','owner-qa',?)").run(new Date().toISOString());
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(next), secret), code('assistant_stock_changed'));
 } finally { f.native.close(); }
});
test('quotas reserve before call, duplicate retries cannot pay again, unknown failures retain reservation', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput({ dailyCalls: 1 }), secret);
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: async () => { throw new Error('test-only-network-failure'); } }), code('assistant_provider_unavailable'));
  const usage = f.native.prepare('SELECT * FROM ai_organization_usage').get(); assert.equal(usage.calls, 1); assert.ok(usage.reserved_usd_micros > 0); assert.ok(usage.reserved_tokens > 0); assert.ok(usage.reserved_ms > 0);
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch }), code('assistant_call_replay'));
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ operationKey: 'test-only-second-call' }), secret, { fetcher: provider.fetch }), code('assistant_quota'));
  assert.equal(provider.calls, 0); assert.deepEqual(f.native.prepare('SELECT * FROM ai_organization_usage').get(), usage);
 } finally { f.native.close(); }
});
test('atomic stock predicate closes a concurrent change between preflight and domain transaction', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
  f.raceStockOnce(() => f.native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at) VALUES('race','item-a',1,'receive','QA','race','owner-qa',?)").run(new Date().toISOString()));
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret), code('assistant_stock_changed'));
  assert.equal(f.native.prepare('SELECT stock FROM items WHERE id=?').get('item-a').stock, 1); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 1); assert.equal(f.native.prepare("SELECT status FROM ai_plans WHERE id=?").get(preview.plan.id).status, 'ready');
 } finally { f.native.close(); }
});
test('each daily ceiling independently refuses a request before provider transport', async () => {
 for (const ceiling of [{ dailyUsdMicros: 1000 }, { dailyTokens: 1000 }, { dailyMs: 1000 }]) {
  const f = fixture(), provider = fakeProvider(); try { await configureAssistant(f.db, f.actors.owner, configInput(ceiling), secret); await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch }), code('assistant_quota')); assert.equal(provider.calls, 0); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_calls').get().n, 0); assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls, 0); } finally { f.native.close(); }
 }
});
test('revocation during provider response prevents any plan; disabling config invalidates issued plans', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: async (...args) => { const response = await provider.fetch(...args); f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='inventory-qa'").run(new Date().toISOString()); return response; } }), code('forbidden'));
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_plans').get().n, 0);
  const preview = await prepareAssistantPlan(f.db, f.actors.manager, request({ operationKey: 'test-only-manager-plan' }), secret, { fetcher: provider.fetch });
  await configureAssistant(f.db, f.actors.owner, configInput({ enabled: false }, { expectedRevision: 1 }), secret);
  await assert.rejects(applyAssistantPlan(f.db, f.actors.manager, confirm(preview), secret), code('assistant_unavailable'));
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 0);
 } finally { f.native.close(); }
});
test('read-only stock queries and operational records use scoped normal services', async () => {
 const f = fixture(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const query = fakeProvider({ proposal: { intent: 'stock.query', quantity: 0 } });
  const preview = await prepareAssistantPlan(f.db, f.actors.manager, request(), secret, { fetcher: query.fetch });
  const result = await applyAssistantPlan(f.db, f.actors.manager, confirm(preview), secret); assert.equal(result.queried, true); assert.equal(result.item.project_id, 'project-a'); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 0);
  const note = 'Registrar ocorrência: montagem concluída.', record = fakeProvider({ proposal: { intent: 'record.create', itemId: null, quantity: 0, title: 'Montagem da oficina', body: 'Montagem concluída.', evidence: [{ source: 'request', quote: 'montagem concluída' }] } });
  const second = await prepareAssistantPlan(f.db, f.actors.manager, request({ request: note, operationKey: 'test-only-record-call' }), secret, { fetcher: record.fetch });
  const saved = await applyAssistantPlan(f.db, f.actors.manager, confirm(second), secret); assert.ok(saved.recordId); assert.equal(f.native.prepare('SELECT project_id FROM records WHERE id=?').get(saved.recordId).project_id, 'project-a');
  assert.equal((await applyAssistantPlan(f.db, f.actors.manager, confirm(second), secret)).replayed, true); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM records').get().n, 1);
 } finally { f.native.close(); }
});
test('Jev is optional typed confirmation; low confidence blocks the proposal and version is pinned', async () => {
 const f = fixture(), provider = fakeProvider({ decision: { confidence: 0.4 } }); try {
  await configureAssistant(f.db, f.actors.owner, configInput({ jevEnabled: true }, { typesafeKey: key }), secret);
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch }), code('assistant_needs_review'));
  assert.equal(provider.calls, 2); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_plans').get().n, 0);
  const good = fakeProvider(), preview = await prepareAssistantPlan(f.db, f.actors.inventory, request({ operationKey: 'test-only-good-jev' }), secret, { fetcher: good.fetch });
  assert.equal(preview.plan.provenance.jevModel, 'jev-1.14.0'); assert.equal(good.calls, 2);
 } finally { f.native.close(); }
});
test('normal domain idempotency recovers a crash after movement without duplicating physical effects', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret); const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
  f.failReceiptOnce(); await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret), /synthetic_receipt_failure/);
  const recovered = await applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret); assert.ok(recovered.movementId); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 1); assert.equal(f.native.prepare('SELECT stock FROM items WHERE id=?').get('item-a').stock, 10);
 } finally { f.native.close(); }
});
test('strict schema rejects invented fields, foreign IDs, quantities and fabricated provenance', () => {
 const items = [{ id: 'item-a' }], text = request().request;
 for (const candidate of [proposal({ sql: 'SELECT 1' }), proposal({ itemId: 'item-b' }), proposal({ quantity: 999 }), proposal({ evidence: [{ source: 'request', quote: 'not in the actual request' }] }), proposal({ evidence: [{ source: 'https://evil.test/', quote: 'entrada de 10 canetas' }] })]) assert.throws(() => validateProposal(candidate, text, items));
});
test('AI secrets and internal state cannot enter portal snapshot, MCP/Sheets pages or Drive attachment manifest', async () => {
 const f = fixture(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret); const ciphertext = f.native.prepare('SELECT credentials_ciphertext FROM ai_organization_settings').get().credentials_ciphertext;
  const schemas = describePortableSchemas(), snapshot = await portalSnapshot(f.db, f.actors.owner), status = await syncStatus(f.db, f.actors.owner), attachments = await listSyncAttachments(f.db, f.actors.owner);
  for (const table of ['ai_settings', 'ai_plans', 'ai_calls', 'ai_daily_usage', 'ai_organization_settings', 'ai_configuration_grants', 'ai_organization_usage', 'ai_transcriptions']) { assert.equal(schemas.tables.some(row => row.table === table), false); await assert.rejects(exportPortablePage(f.db, f.actors.owner, { table })); }
  const pages = []; for (const schema of schemas.tables) pages.push(await exportPortablePage(f.db, f.actors.owner, { table: schema.table }));
  const exposed = JSON.stringify({ snapshot, status, attachments, pages }); for (const forbidden of [key, ciphertext, 'credentials_ciphertext', 'config_json', 'ai_settings']) assert.equal(exposed.includes(forbidden), false, forbidden);
 } finally { f.native.close(); }
});
test('browser dictation requires consent, stages final text only, and ignores events after cancellation', () => {
 let constructed = 0, instance, draft = '', listening = false;
 class FakeSpeech { static instances = []; constructor() { constructed++; FakeSpeech.instances.push(this); } start() {} stop() { this.onend(); } abort() {} }
 const options = { consent: false, onText: text => { draft += text; }, onState: value => { listening = value; }, onError: () => assert.fail('unexpected speech error') };
 assert.throws(() => startReviewedDictation(FakeSpeech, options)); assert.equal(constructed, 0);
 assert.throws(() => startReviewedDictation(undefined, { ...options, consent: true }));
 const session = startReviewedDictation(FakeSpeech, { ...options, consent: true }); instance = FakeSpeech.instances.at(-1); assert.equal(listening, true); assert.equal(instance.lang, 'pt-BR');
 instance.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'unconfirmed speech' } }] }); assert.equal(draft, '');
 instance.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'entrada de 10 canetas' } }] }); assert.equal(draft, 'entrada de 10 canetas ');
 session.abort(); assert.equal(listening, false); instance.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late ignored text' } }] }); assert.equal(draft, 'entrada de 10 canetas ');
});

function organizationActor(f, userId, role, organizationId='org_proex') {
 const at=new Date().toISOString(),email=`${userId}@example.test`;f.native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId,email,at,at);f.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES(?,?,?,?,NULL,?,?)').run(userId,userId,email,role,organizationId,at);return{userId,email,displayName:userId,members:[],capabilities:[]};
}
test('organization TI delegation is explicit, owner-controlled, revocable and never expands stock permissions',async()=>{
 const f=fixture();try{
  const ti=organizationActor(f,'synthetic-ti','viewer'),localOwner=organizationActor(f,'local-owner','owner');
  await configureAssistant(f.db,localOwner,configInput(),secret);
  await assert.rejects(configureAssistant(f.db,ti,configInput({}, {expectedRevision:1}),secret),code('assistant_configuration_forbidden'));
  await manageAssistantGrant(f.db,localOwner,{action:'grant.create',organizationId:'org_proex',userId:ti.userId});
  const status=await assistantStatus(f.db,ti,secret,'org_proex');assert.equal(status.canConfigure,true);assert.equal(status.canDelegate,false);assert.equal(status.grants,undefined);assert.equal(JSON.stringify(status).includes(key),false);
  await configureAssistant(f.db,ti,configInput({}, {expectedRevision:1}),secret);
  await assert.rejects(configureAssistant(f.db,ti,configInput({}, {organizationId:'unit-synthetic',expectedRevision:0}),secret),code('assistant_configuration_forbidden'));
  await assert.rejects(prepareAssistantPlan(f.db,ti,request(),secret,{fetcher:fakeProvider().fetch}),code('forbidden'));
  await assert.rejects(manageAssistantGrant(f.db,ti,{action:'grant.create',organizationId:'org_proex',userId:localOwner.userId}),code('assistant_configuration_forbidden'));
  const grant=f.native.prepare('SELECT id FROM ai_configuration_grants WHERE user_id=?').get(ti.userId);await manageAssistantGrant(f.db,localOwner,{action:'grant.revoke',organizationId:'org_proex',grantId:grant.id});
  await assert.rejects(configureAssistant(f.db,ti,configInput({}, {expectedRevision:2}),secret),code('assistant_configuration_forbidden'));
 }finally{f.native.close();}
});
test('revoking an issuer or grant between validation and config transaction fails without saving credentials',async()=>{
 const f=fixture();try{
  const ti=organizationActor(f,'technical-delegate','viewer'),issuer=organizationActor(f,'grant-issuer','owner');await configureAssistant(f.db,issuer,configInput(),secret);await manageAssistantGrant(f.db,issuer,{action:'grant.create',organizationId:'org_proex',userId:ti.userId});
  f.raceBatch(/UPDATE ai_organization_settings/,()=>f.native.prepare('UPDATE ai_configuration_grants SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(),ti.userId));
  await assert.rejects(configureAssistant(f.db,ti,configInput({}, {expectedRevision:1}),secret),code('assistant_configuration_forbidden'));assert.equal(f.native.prepare('SELECT revision FROM ai_organization_settings').get().revision,1);
  await manageAssistantGrant(f.db,issuer,{action:'grant.create',organizationId:'org_proex',userId:ti.userId});f.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(),issuer.userId);
  await assert.rejects(configureAssistant(f.db,ti,configInput({}, {expectedRevision:1}),secret),code('assistant_configuration_forbidden'));
 }finally{f.native.close();}
});
function wav(seconds=1){const samples=new Float32Array(Math.floor(seconds*16000));for(let i=0;i<samples.length;i++)samples[i]=.1*Math.sin(i*.1);return encodeSpeechWav({duration:seconds,length:samples.length,sampleRate:16000,numberOfChannels:1,getChannelData:()=>samples});}
const speechInput=(bytes=wav(),extra={})=>({projectId:'project-a',operationKey:'test-only-transcription-call',consent:true,mime:'audio/wav',bytes,...extra});
function fakeSpeechProvider(){let calls=0;return{get calls(){return calls;},fetch:async(url,init)=>{calls++;assert.equal(url,SPEECH_ENDPOINT);assert.equal(init.redirect,'error');assert.match(init.headers.Authorization,/^Token test-only/);assert.equal(init.headers['Content-Type'],'audio/wav');const duration=validateSpeechAudio(new Uint8Array(init.body),'audio/wav').duration;return Response.json({metadata:{duration,model_info:{'synthetic-model':{arch:'nova-3',name:'3-general-nova',version:'2026-05-13.synthetic'}}},results:{channels:[{alternatives:[{transcript:'Registrar entrada de 10 canetas.'}]}]}});}};}
test('STT accepts real bounded PCM bytes, uses official HTTP adapter and encrypts transcript recovery without storing audio',async()=>{
 const f=fixture(),provider=fakeSpeechProvider();try{
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);const result=await transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch});assert.equal(result.transcript,'Registrar entrada de 10 canetas.');assert.equal(result.provenance.duration,1);assert.equal(result.provenance.organizationId,'org_proex');
  const stored=f.native.prepare('SELECT * FROM ai_transcriptions').get();assert.equal(JSON.stringify(stored).includes('Registrar entrada'),false);assert.equal(JSON.stringify(stored).includes(key),false);assert.equal(stored.status,'complete');
  const replay=await transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch});assert.equal(replay.replayed,true);assert.equal(provider.calls,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);
  const ciphertext=f.native.prepare('SELECT credentials_ciphertext FROM ai_organization_settings').get().credentials_ciphertext;await assert.rejects(decryptCredentials(secret,ciphertext,'unit-synthetic'),code('assistant_credentials_unavailable'));
 }finally{f.native.close();}
});
test('STT rejects mismatched MIME, corrupt headers, silence, excessive duration/size and SSRF before provider cost',async()=>{
 const f=fixture(),provider=fakeSpeechProvider();try{
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);
  const broken=wav();broken[36]=0;
  const silent=wav();silent.fill(0,44);
  for(const input of [speechInput(wav(),{mime:'image/png'}),speechInput(broken),speechInput(silent),speechInput(new Uint8Array(4*1024*1024+1)),speechInput(wav(),{consent:false})])await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,input,secret,{fetcher:provider.fetch}));
  assert.throws(()=>encodeSpeechWav({duration:91,length:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(1)}));
  for(const url of ['http://127.0.0.1/','https://api.deepgram.com.evil.test/v1/listen',SPEECH_ENDPOINT+'&callback=https://localhost'])assert.throws(()=>speechEndpoint(url),code('speech_endpoint'));
  assert.equal(provider.calls,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_transcriptions').get().n,0);
 }finally{f.native.close();}
});
test('STT rechecks scope, revocation before admission, and revoked replay; abort retains quota without a second call',async()=>{
 const f=fixture(),provider=fakeSpeechProvider();try{
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(wav(),{projectId:'project-b'}),secret,{fetcher:provider.fetch}));assert.equal(provider.calls,0);
  f.raceBatch(/INSERT INTO ai_transcriptions/,()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='inventory-qa'").run(new Date().toISOString()));
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch}),code('speech_forbidden'));assert.equal(provider.calls,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_transcriptions').get().n,0);
  const abort=new AbortController();const pending=transcribeSpeech(f.db,f.actors.manager,speechInput(),secret,{signal:abort.signal,fetcher:async(_url,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new Error('synthetic abort')));abort.abort();})});await assert.rejects(pending,code('speech_provider'));assert.equal(f.native.prepare('SELECT status FROM ai_transcriptions').get().status,'failed');assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);
  await assert.rejects(transcribeSpeech(f.db,f.actors.manager,speechInput(),secret,{fetcher:provider.fetch}),code('speech_replay'));assert.equal(provider.calls,0);
 }finally{f.native.close();}
});
test('STT permission loss during response withholds transcript and quota is isolated by organization',async()=>{
 const f=fixture(),provider=fakeSpeechProvider();try{
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:async(...args)=>{const response=await provider.fetch(...args);f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='inventory-qa'").run(new Date().toISOString());return response;}}));assert.equal(f.native.prepare('SELECT result_ciphertext FROM ai_transcriptions').get().result_ciphertext,null);
  const blocked=new AbortController();blocked.abort();await assert.rejects(transcribeSpeech(f.db,f.actors.manager,speechInput(wav(),{operationKey:'test-only-aborted-before'}),secret,{signal:blocked.signal,fetcher:provider.fetch}),code('speech_aborted'));assert.equal(provider.calls,1);
  const at=new Date().toISOString();f.native.prepare("INSERT INTO projects(id,name,organization_id,created_at) VALUES('project-c','Projeto C','unit-synthetic',?)").run(at);await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{organizationId:'unit-synthetic',deepgramKey:key}),secret);await transcribeSpeech(f.db,f.actors.owner,speechInput(wav(),{projectId:'project-c'}),secret,{fetcher:provider.fetch});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_organization_usage WHERE calls=1').get().n,2);
 }finally{f.native.close();}
});
test('browser WAV conversion preserves enforced duration and canonical PCM without remote conversion',async()=>{
 const bytes=wav(),file=new File([bytes],'synthetic.wav',{type:'audio/wav'}),converted=await prepareSpeechWav(file,()=>assert.fail('canonical WAV needs no decoder'));assert.equal(converted.type,'audio/wav');assert.equal(validateSpeechAudio(new Uint8Array(await converted.arrayBuffer()),converted.type).duration,1);
 await assert.rejects(prepareSpeechWav(new File([bytes],'not-audio.svg',{type:'image/svg+xml'})));
});

function freezeInitialMisses(f,pattern){const original=f.db.prepare.bind(f.db);let reads=0,release;const barrier=new Promise(resolve=>{release=resolve;});f.db.prepare=sql=>{const statement=original(sql);if(!pattern.test(sql))return statement;return{...statement,bind(...values){statement.bind(...values);return this;},async first(){const result=await statement.first();if(++reads<=2){if(reads===2)release();await barrier;}return result;}};};}
test('concurrent identical paid prepares own one admission even when the second insert is refused at the daily ceiling',async()=>{
 for(const dailyCalls of [1,2]){const f=fixture(),provider=fakeProvider();try{await configureAssistant(f.db,f.actors.owner,configInput({dailyCalls}),secret);freezeInitialMisses(f,/SELECT fingerprint,status,plan_id FROM ai_calls/);const results=await Promise.allSettled([prepareAssistantPlan(f.db,f.actors.inventory,request(),secret,{fetcher:provider.fetch}),prepareAssistantPlan(f.db,f.actors.inventory,request(),secret,{fetcher:provider.fetch})]);assert.ok(results.some(result=>result.status==='fulfilled'));assert.equal(provider.calls,1);assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_calls').get().n,1);for(const result of results)if(result.status==='rejected')assert.equal(result.reason.code,'assistant_call_replay');}finally{f.native.close();}}
});
test('concurrent identical speech requests cannot reuse another reservation nonce or exceed dailyCalls=1',async()=>{
 for(const dailyCalls of [1,2]){const f=fixture(),provider=fakeSpeechProvider();try{await configureAssistant(f.db,f.actors.owner,configInput({dailyCalls,sttEnabled:true},{deepgramKey:key}),secret);freezeInitialMisses(f,/SELECT \* FROM ai_transcriptions WHERE id=/);const results=await Promise.allSettled([transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch}),transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch})]);assert.ok(results.some(result=>result.status==='fulfilled'));assert.equal(provider.calls,1);assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_transcriptions').get().n,1);for(const result of results)if(result.status==='rejected')assert.equal(result.reason.code,'speech_replay');}finally{f.native.close();}}
});

test('final plan persistence checks revocation and configuration atomically before exposing its snapshot',async()=>{
 for(const change of ['revoked','configuration']){const f=fixture(),provider=fakeProvider();try{await configureAssistant(f.db,f.actors.owner,configInput(),secret);f.raceBatch(/INSERT INTO ai_plans/,()=>{if(change==='revoked')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='inventory-qa'").run(new Date().toISOString());else f.native.prepare("UPDATE ai_organization_settings SET revision=revision+1,config_json=json_set(config_json,'$.enabled',0)").run();});await assert.rejects(prepareAssistantPlan(f.db,f.actors.inventory,request(),secret,{fetcher:provider.fetch}),code('assistant_forbidden'));assert.equal(provider.calls,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_plans').get().n,0);assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='assistant.plan'").get().n,0);assert.equal(f.native.prepare('SELECT status FROM ai_calls').get().status,'failed');}finally{f.native.close();}}
});

test('expired transcription recovery erases its ciphertext on next organization use and never repeats a paid call',async()=>{
 const f=fixture(),provider=fakeSpeechProvider();try{await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);const now=Date.now();await transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch,now});assert.ok(f.native.prepare('SELECT result_ciphertext FROM ai_transcriptions').get().result_ciphertext);await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch,now:now+3600001}),code('speech_replay'));assert.equal(f.native.prepare('SELECT result_ciphertext FROM ai_transcriptions').get().result_ciphertext,null);assert.equal(provider.calls,1);}finally{f.native.close();}
});


test('every operational provider dispatch rechecks live SQL after awaited settings decryption',async()=>{
 for(const dispatch of [1,2])for(const mode of ['revoke','revision']){const f=fixture();try{await configureAssistant(f.db,f.actors.owner,configInput({jevEnabled:dispatch===2},{...(dispatch===2?{typesafeKey:'test-only-typesafe-provider-credential'}:{})}),secret);const original=f.db.prepare.bind(f.db);let reads=0;f.db.prepare=sql=>{const statement=original(sql),first=statement.first.bind(statement);statement.first=async(...args)=>{const row=await first(...args);if(/^SELECT s\.\*/.test(sql)&&++reads===(dispatch===2?3:2)){if(mode==='revoke')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager-qa'").run(new Date().toISOString());else f.native.prepare('UPDATE ai_organization_settings SET revision=revision+1').run();}return row;};return statement;};const p=fakeProvider();await assert.rejects(prepareAssistantPlan(f.db,f.actors.manager,request({operationKey:crypto.randomUUID()}),secret,{fetcher:p.fetch}),{code:'assistant_forbidden'});assert.equal(p.calls,dispatch-1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_plans').get().n,0);}finally{f.native.close();}}
});
