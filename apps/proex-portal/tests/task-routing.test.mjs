// Roteamento por tarefa (documento, conferência/triagem, voz) para modelos do catálogo.
// Tudo aqui é sintético: chaves falsas, provedores falsos, banco em memória. Nenhuma chamada real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
 const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-task-routing-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { DEFAULT_ASSISTANT_CONFIG, TASK_MODEL_KEYS } = await import(compile('assistant/contracts'));
const { configureAssistant, assistantStatus, estimateAssistantPlan, prepareAssistantPlan, applyAssistantPlan } = await import(compile('assistant/service'));
const { manageAssistantCredential } = await import(compile('assistant/credential-vault'));
const { catalogView, manageCatalog } = await import(compile('assistant/model-catalog-store'));
const { transcribeSpeech, validateSpeechAudio, SPEECH_ENDPOINT } = await import(compile('assistant/speech'));
const { roleStatus } = await import(compile('assistant/role'));
const { previewImport } = await import(compile('importer/service'));
const { CONFIG_FIELDS } = await import(compile('assistant/quota'));
const { encodeSpeechWav } = await import(compile('../components/portal/speech-audio'));

const secret = 'test-only-assistant-auth-secret-no-production-access';
const key = 'test-only-fake-provider-credential';
const keys = { current: 'synthetic-only-independent-key-for-task-routing-tests' };
const FAKE = { deepseek: key, typesafe: 'test-only-fake-typesafe-credential', deepgram: 'test-only-fake-deepgram-credential', groq: 'test-only-fake-groq-credential', openai: 'test-only-fake-openai-credential', perplexity: 'test-only-fake-perplexity-credential', nace: 'test-only-fake-nace-credential' };
const DEEPSEEK = 'https://api.deepseek.com/chat/completions', TYPESAFE = 'https://api.typesafe.ai/v1/systemone';
const PERPLEXITY = 'https://api.perplexity.ai/v1/systemone', NACE = 'https://console.nace.ai/v1/systemone';
const OPENAI = 'https://api.openai.com/v1/chat/completions', GROQ_AUDIO = 'https://api.groq.com/openai/v1/audio/transcriptions';
const sha = text => createHash('sha256').update(text).digest('hex');
const code = expected => error => error?.code === expected;

function fixture(t) {
 const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON'); t.after(() => native.close());
 for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
 const now = new Date().toISOString(); native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('unit-synthetic','Outra org','outra-org',?,?)").run(now, now);
 native.prepare("INSERT INTO projects(id,name,description,scope,created_at) VALUES('project-a','Projeto A','','external',?),('project-b','Projeto B','','external',?)").run(now, now);
 native.prepare("INSERT INTO items(id,project_id,name,category,unit,created_at,updated_at) VALUES('item-a','project-a','Caneta QA','consumption','unidade',?,?),('item-b','project-b','Outro material','consumption','unidade',?,?)").run(now, now, now, now);
 const actors = {};
 for (const [role, project] of [['owner', null], ['manager', 'project-a'], ['inventory', 'project-a'], ['viewer', 'project-a']]) {
  const userId = `${role}-qa`, email = `${role}@example.test`;
  native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
  native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(userId, userId, email, role, project, now);
  actors[role] = { userId, email, displayName: role, capabilities: [], members: [{ id: userId, user_id: userId, email, role, project_id: project, revoked_at: null, created_at: now }] };
 }
 const sql = [];
 const db = { prepare(text) { sql.push(text); let values = []; return { sql: text, bind(...args) { values = args; return this; }, async first() { return native.prepare(text).get(...values) ?? null; }, async all() { return { results: native.prepare(text).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(text).run(...values).changes) } }; }, execute() { const results = native.prepare(text).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
 return { native, db, actors, sql };
}
/** Dona só da organização: pode configurar a IA, mas não é a administração geral. */
function organizationOwner(f) {
 const at = new Date().toISOString(), userId = 'orgowner-qa', email = 'orgowner@example.test';
 f.native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, at, at);
 f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES(?,?,?,'owner',NULL,'org_proex',?)").run(userId, userId, email, at);
 return { userId, email, displayName: 'orgowner', capabilities: [], members: [{ id: userId, user_id: userId, email, role: 'owner', project_id: null, organization_id: 'org_proex', revoked_at: null, created_at: at }] };
}

const revision = f => Number(f.native.prepare("SELECT revision FROM ai_organization_settings WHERE organization_id='org_proex'").get()?.revision ?? 0);
const storedConfig = f => JSON.parse(f.native.prepare("SELECT config_json FROM ai_organization_settings WHERE organization_id='org_proex'").get().config_json);
const usage = f => ({ ...f.native.prepare('SELECT calls,reserved_usd_micros,reserved_tokens,reserved_ms FROM ai_organization_usage').get() });
const settled = f => { const { calls, reserved_usd_micros, reserved_tokens } = usage(f); return { calls, reserved_usd_micros, reserved_tokens }; };
const auditActions = f => f.native.prepare('SELECT action FROM audit ORDER BY rowid').all().map(row => row.action);
const fallbacks = f => f.native.prepare("SELECT actor_id,details FROM audit WHERE action='assistant.route.fallback' ORDER BY rowid").all().map(row => ({ actor: row.actor_id, ...JSON.parse(row.details) }));
const configChangesOf = f => f.native.prepare("SELECT details FROM audit WHERE action='assistant.configure' ORDER BY rowid").all().map(row => JSON.parse(row.details).changes);
const stock = f => f.native.prepare("SELECT stock FROM items WHERE id='item-a'").get().stock;

// Chaves no cofre (provedores revisados) e no catálogo (provedores p:), sempre pela administração geral.
const saveVault = (f, provider) => manageAssistantCredential(f.db, f.actors.owner, { action: 'save', organizationId: 'org_proex', provider, expectedRevision: revision(f), label: 'Chave sintética', secret: FAKE[provider] }, secret, keys);
const catalog = async (f, body) => manageCatalog(f.db, f.actors.owner, { organizationId: 'org_proex', expected: (await catalogView(f.db, f.actors.owner, 'org_proex', secret, keys)).stamp, ...body }, secret, keys);
const saveCatalogKey = (f, providerId) => catalog(f, { action: 'key.save', providerId, label: 'Chave sintética', secret: FAKE[providerId] });
const configure = (f, config = {}, actor = f.actors.owner) => configureAssistant(f.db, actor, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision(f), config: { ...DEFAULT_ASSISTANT_CONFIG, enabled: true, ...config } }, secret, undefined, keys);
/** Conferência ligada com um modelo de decisão do catálogo escolhido (Perplexity, formato JEV). */
async function decisionSetup(f, model = 'perplexity-decider-v1-2', providerId = 'perplexity') {
 await saveVault(f, 'deepseek'); await saveVault(f, 'typesafe'); await saveCatalogKey(f, providerId);
 await configure(f, { jevEnabled: true, decisionModel: model });
}

const request = (extra = {}) => ({ action: 'prepare', projectId: 'project-a', request: 'Registrar entrada de 10 canetas recebidas para a oficina.', consent: true, operationKey: 'test-only-assistant-call-1', ...extra });
const proposal = () => ({ intent: 'stock.receive', itemId: 'item-a', quantity: 10, title: 'Entrada de canetas', body: 'Canetas recebidas para a oficina', evidence: [{ source: 'request', quote: 'entrada de 10 canetas' }] });
const confirm = preview => ({ action: 'apply', planToken: preview.planToken, confirmed: true });
const jevAnswer = model => Response.json({ model, answers: { faithful: { type: 'choice', choice: 'supported', confidence: 0.99, probabilities: { supported: 0.99, review: 0.01 } } }, usage: { input_tokens: 500 } });
const refusal = status => new Response(JSON.stringify({ error: 'synthetic refusal' }), { status, headers: { 'content-type': 'application/json' } });
/**
 * Provedores falsos. Anota cada chamada (endereço, chave, corpo, resumo do corpo e a reserva do dia naquele instante).
 * DeepSeek e TypeSafe respondem como hoje; qualquer outro endereço é respondido por `chosen`.
 */
function providers(f, chosen = () => refusal(500), text = proposal()) {
 const calls = [];
 return { calls, urls: () => calls.map(call => call.url), fetch: async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url: String(url), auth: init.headers.Authorization, body, sha256: sha(init.body), length: init.body.length, inflight: usage(f) });
  if (String(url) === DEEPSEEK) return Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(text) } }], usage: { prompt_tokens: 500, completion_tokens: text === null ? 0 : text.fields ? 200 : 100 } });
  if (String(url) === TYPESAFE) return jevAnswer(body.model);
  return chosen(body, String(url), init);
 } };
}

// ---------------------------------------------------------------------------------------------
// a) Com as três chaves vazias nada muda. Os números abaixo foram tirados do código de antes do
//    roteamento (commit 95f527a) rodando este mesmo cenário; não vêm das funções novas.
// ---------------------------------------------------------------------------------------------
const DEEPSEEK_CALL = { url: DEEPSEEK, length: 1389, sha256: '263db68d7cec8f646f3a16135da1a04895d768a7915058d4d8b872b995d6b066' };
const TYPESAFE_CALL = { url: TYPESAFE, length: 722, sha256: '1e6d6897ed431fe2f0ab3c662fa0e8c0863ad95be23000627e0f6d1057d02123' };
const BEFORE_ROUTING = {
 'sem conferência': { config: {}, extra: {}, estimate: { costMicros: 2477, calls: 1, provider: 'deepseek', model: 'deepseek-flash', jev: false }, calls: [DEEPSEEK_CALL],
  inflight: { calls: 1, reserved_usd_micros: 2477, reserved_tokens: 4654, reserved_ms: 12000 }, settled: { calls: 1, reserved_usd_micros: 270, reserved_tokens: 600 }, jevModel: null },
 'com conferência': { config: { jevEnabled: true }, extra: { typesafeKey: key }, estimate: { costMicros: 3378, calls: 2, provider: 'deepseek', model: 'deepseek-flash', jev: true }, calls: [DEEPSEEK_CALL, TYPESAFE_CALL],
  inflight: { calls: 2, reserved_usd_micros: 3378, reserved_tokens: 26108, reserved_ms: 12000 }, settled: { calls: 2, reserved_usd_micros: 291, reserved_tokens: 1100 }, jevModel: 'jev-1.14.0' },
};
for (const [name, fixed] of Object.entries(BEFORE_ROUTING)) test(`a) chaves vazias, ${name}: preparar e confirmar fazem as mesmas chamadas e reservam o mesmo custo de antes`, async t => {
 const f = fixture(t), provider = providers(f);
 for (const taskKey of TASK_MODEL_KEYS) assert.equal(DEFAULT_ASSISTANT_CONFIG[taskKey], '', `${taskKey} começa vazio`);
 await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: 0, config: { ...DEFAULT_ASSISTANT_CONFIG, enabled: true, ...fixed.config }, deepseekKey: key, ...fixed.extra }, secret);
 assert.deepEqual(await estimateAssistantPlan(f.db, f.actors.inventory, { projectId: 'project-a', request: request().request }, secret), fixed.estimate);
 const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
 assert.deepEqual(provider.calls.map(({ url, length, sha256 }) => ({ url, length, sha256 })), fixed.calls, 'mesmos endereços, mesmo corpo, mesma contagem');
 for (const call of provider.calls) { assert.equal(call.auth, `Bearer ${key}`); assert.deepEqual(call.inflight, fixed.inflight, 'reserva do dia no momento do envio'); }
 assert.deepEqual(settled(f), fixed.settled, 'acerto depois da resposta');
 assert.equal(preview.plan.provenance.provider, 'deepseek'); assert.equal(preview.plan.provenance.model, 'deepseek-flash'); assert.equal(preview.plan.provenance.jevModel, fixed.jevModel);
 await applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret);
 assert.equal(stock(f), 10); assert.deepEqual(settled(f), fixed.settled, 'confirmar não chama provedor nem muda a reserva'); assert.equal(provider.calls.length, fixed.calls.length);
 assert.deepEqual(auditActions(f), ['assistant.configure', 'assistant.plan', 'stock.move', 'assistant.apply'], 'mesma auditoria: nenhuma linha de roteamento');
 assert.equal(f.sql.some(text => /FROM settings WHERE name/.test(text)), false, 'com as chaves vazias o catálogo nem é lido');
});

function wav(seconds = 1) { const samples = new Float32Array(Math.floor(seconds * 16000)); for (let i = 0; i < samples.length; i++) samples[i] = .1 * Math.sin(i * .1); return encodeSpeechWav({ duration: seconds, length: samples.length, sampleRate: 16000, numberOfChannels: 1, getChannelData: () => samples }); }
const speechInput = (extra = {}) => ({ projectId: 'project-a', operationKey: 'test-only-transcription-call', consent: true, mime: 'audio/wav', bytes: wav(), ...extra });
/** Voz falsa: Deepgram (áudio cru) e formulário de áudio no formato OpenAI (Groq). `groq` pode trocar a resposta do formulário. */
function speechProviders(groq = () => Response.json({ text: 'Texto para revisão humana.' })) {
 const calls = [];
 return { calls, urls: () => calls.map(call => call.url), fetch: async (url, init) => {
  const form = init.body instanceof FormData;
  calls.push({ url: String(url), auth: init.headers.Authorization, model: form ? init.body.get('model') : null, fields: form ? [...init.body.keys()] : null });
  if (form) return groq(String(url), init);
  const duration = validateSpeechAudio(new Uint8Array(init.body), 'audio/wav').duration;
  return Response.json({ metadata: { duration, model_info: { 'synthetic-model': { arch: 'nova-3', name: '3-general-nova', version: '2026-05-13.synthetic' } } }, results: { channels: [{ alternatives: [{ transcript: 'Registrar entrada de 10 canetas.' }] }] } });
 } };
}

test('a) chaves vazias, voz: o áudio vai ao mesmo provedor, com a mesma reserva de antes (Deepgram 500, Groq 112)', async t => {
 const deepgram = fixture(t), first = speechProviders();
 await configureAssistant(deepgram.db, deepgram.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: 0, config: { ...DEFAULT_ASSISTANT_CONFIG, enabled: true, sttEnabled: true }, deepseekKey: key, deepgramKey: key }, secret);
 const heard = await transcribeSpeech(deepgram.db, deepgram.actors.inventory, speechInput(), secret, { fetcher: first.fetch });
 assert.deepEqual(first.calls, [{ url: SPEECH_ENDPOINT, auth: `Token ${key}`, model: null, fields: null }]);
 assert.equal(heard.provenance.provider, 'deepgram'); assert.equal(heard.provenance.model, 'nova-3'); assert.equal(usage(deepgram).reserved_usd_micros, 500);
 assert.deepEqual(auditActions(deepgram), ['assistant.configure', 'assistant.transcribe']);
 assert.equal(deepgram.sql.some(text => /FROM settings WHERE name/.test(text)), false, 'com a chave vazia o catálogo nem é lido');

 const groq = fixture(t), second = speechProviders();
 await saveVault(groq, 'groq');
 await configureAssistant(groq.db, groq.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision(groq), config: { ...DEFAULT_ASSISTANT_CONFIG, sttProvider: 'groq', sttEnabled: true } }, secret, undefined, keys);
 const typed = await transcribeSpeech(groq.db, groq.actors.inventory, speechInput({ expectedProvider: 'groq' }), secret, { fetcher: second.fetch, keys });
 assert.deepEqual(second.calls, [{ url: GROQ_AUDIO, auth: `Bearer ${FAKE.groq}`, model: 'whisper-large-v3-turbo', fields: ['file', 'model', 'language', 'response_format'] }]);
 assert.equal(typed.provenance.provider, 'groq'); assert.equal(usage(groq).reserved_usd_micros, 112); assert.deepEqual(fallbacks(groq), []);
});

// ---------------------------------------------------------------------------------------------
// b) Modelo escolhido sem chave: cai no padrão antes de enviar, uma chamada só, com o motivo na auditoria.
// ---------------------------------------------------------------------------------------------
test('b) modelo de conferência escolhido sem chave: a conferência vai só ao padrão e a queda fica na auditoria', async t => {
 const f = fixture(t), provider = providers(f);
 await decisionSetup(f);
 await catalog(f, { action: 'key.remove', providerId: 'perplexity' });
 assert.equal(storedConfig(f).decisionModel, 'perplexity-decider-v1-2', 'a escolha continua gravada; só a chave saiu');
 assert.deepEqual(await estimateAssistantPlan(f.db, f.actors.inventory, { projectId: 'project-a', request: request().request }, secret, { keys }), BEFORE_ROUTING['com conferência'].estimate);
 assert.deepEqual(fallbacks(f), [], 'prever o custo não grava auditoria');
 const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch, keys });
 assert.deepEqual(provider.calls.map(({ url, length, sha256 }) => ({ url, length, sha256 })), [DEEPSEEK_CALL, TYPESAFE_CALL], 'uma chamada de conferência, ao padrão, com o corpo de sempre');
 assert.equal(provider.calls[1].auth, `Bearer ${FAKE.typesafe}`);
 assert.deepEqual(fallbacks(f), [{ actor: 'inventory-qa', task: 'decision', model: 'perplexity-decider-v1-2', name: DECIDER, reason: 'Falta a chave do provedor deste modelo.' }]);
 assert.equal(preview.plan.provenance.jevModel, 'jev-1.14.0'); assert.deepEqual(settled(f), BEFORE_ROUTING['com conferência'].settled);
 assert.equal(JSON.stringify(f.native.prepare('SELECT details FROM audit').all()).includes('test-only-fake'), false, 'nenhuma chave na auditoria');
});

// ---------------------------------------------------------------------------------------------
// c) O escolhido recusa com certeza (400, 401, 402, 403, 404, 413, 415, 422, 429): uma chamada a ele, uma ao
//    padrão, cobrança só do que respondeu. Outro status de erro (408, 5xx) fica em d): sem segunda chamada.
// ---------------------------------------------------------------------------------------------
for (const status of [400, 401, 402, 403, 404, 413, 415, 422, 429]) test(`c) o modelo escolhido recusa com o código ${status}: uma chamada a ele, uma ao padrão, e o acerto usa o preço do padrão`, async t => {
 const f = fixture(t), provider = providers(f, () => refusal(status));
 await decisionSetup(f);
 const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request({ decisionDestination: DECIDER }), secret, { fetcher: provider.fetch, keys });
 assert.deepEqual(provider.urls(), [DEEPSEEK, PERPLEXITY, TYPESAFE]);
 const [, chosen, standard] = provider.calls;
 assert.equal(chosen.auth, `Bearer ${FAKE.perplexity}`); assert.equal(chosen.body.model, 'pplx-decider-v1.2');
 assert.equal(standard.auth, `Bearer ${FAKE.typesafe}`); assert.equal(standard.sha256, TYPESAFE_CALL.sha256, 'o padrão recebe o corpo de sempre');
 assert.deepEqual(fallbacks(f), [{ actor: 'inventory-qa', task: 'decision', model: 'perplexity-decider-v1-2', name: DECIDER, reason: `O serviço recusou o pedido (código ${status}).${status === 401 || status === 403 ? ' Confira a chave na aba Chaves.' : ''}` }]);
 assert.equal(preview.plan.provenance.jevModel, 'jev-1.14.0');
 assert.deepEqual(settled(f), { calls: 2, reserved_usd_micros: 291, reserved_tokens: 1100 }, 'cobrado como DeepSeek + TypeSafe; a recusa não custa nem conta outra chamada');
 await applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret, Date.now(), keys);
 assert.equal(stock(f), 10);
});

test('c) quando o escolhido responde, o padrão não é chamado e o acerto usa o preço do escolhido', async t => {
 const f = fixture(t), provider = providers(f, body => jevAnswer(body.model));
 await decisionSetup(f);
 const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request({ decisionDestination: DECIDER }), secret, { fetcher: provider.fetch, keys });
 assert.deepEqual(provider.urls(), [DEEPSEEK, PERPLEXITY]); assert.deepEqual(fallbacks(f), []);
 assert.equal(provider.calls[1].length, TYPESAFE_CALL.length - 'jev-1.14.0'.length + 'pplx-decider-v1.2'.length, 'mesmo corpo JEV, só o nome do modelo muda');
 assert.equal(preview.plan.provenance.jevModel, 'pplx-decider-v1.2');
 // 500 tokens de entrada a 0,3 + 100 de saída a 1,2 (DeepSeek) + 500 tokens a 0,02 (escolhido) = 280. No padrão seriam 291.
 assert.deepEqual(settled(f), { calls: 2, reserved_usd_micros: 280, reserved_tokens: 1100 });
});

// ---------------------------------------------------------------------------------------------
// d) Prazo, rede, formato ruim ou status de erro sem recusa certa (408, 5xx) no escolhido: nenhuma segunda
//    chamada (o serviço pode ter processado e cobrado).
// ---------------------------------------------------------------------------------------------
const DOUBTFUL = {
 'status 408 (prazo no serviço)': { chosen: () => refusal(408), code: 'assistant_provider_unavailable' },
 'status 500': { chosen: () => refusal(500), code: 'assistant_provider_unavailable' },
 'status 502': { chosen: () => refusal(502), code: 'assistant_provider_unavailable' },
 'status 503': { chosen: () => refusal(503), code: 'assistant_provider_unavailable' },
 'status 504': { chosen: () => refusal(504), code: 'assistant_provider_unavailable' },
 'tempo esgotado': { chosen: () => { throw new DOMException('synthetic timeout', 'TimeoutError'); }, code: 'assistant_provider_unavailable' },
 'falha de rede': { chosen: () => { throw new TypeError('synthetic network failure'); }, code: 'assistant_provider_unavailable' },
 'resposta que não é JSON': { chosen: () => new Response('<html>synthetic</html>', { status: 200, headers: { 'content-type': 'text/html' } }), code: 'assistant_provider_unavailable' },
 'JSON quebrado': { chosen: () => new Response('{"model":', { status: 200, headers: { 'content-type': 'application/json' } }), code: 'assistant_provider_schema' },
 'modelo inesperado na resposta': { chosen: () => jevAnswer('synthetic-other-model'), code: 'assistant_decision_schema' },
 'decisão sem o formato esperado': { chosen: body => Response.json({ model: body.model, answers: {}, usage: { input_tokens: 500 } }), code: 'assistant_schema' },
};
for (const [name, doubt] of Object.entries(DOUBTFUL)) test(`d) ${name} no modelo escolhido: o erro sobe e não há segunda chamada`, async t => {
 const f = fixture(t), provider = providers(f, doubt.chosen);
 await decisionSetup(f);
 await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ decisionDestination: DECIDER }), secret, { fetcher: provider.fetch, keys }), code(doubt.code));
 assert.deepEqual(provider.urls(), [DEEPSEEK, PERPLEXITY], 'o padrão não recebe nada');
 assert.deepEqual(fallbacks(f), []);
 assert.equal(f.native.prepare('SELECT status FROM ai_calls').get().status, 'failed');
 assert.equal(usage(f).reserved_usd_micros, 3378, 'a reserva preventiva fica contando no dia');
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_plans').get().n, 0); assert.equal(stock(f), 0);
 // A mesma tentativa não é repetida sozinha.
 await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ decisionDestination: DECIDER }), secret, { fetcher: provider.fetch, keys }), code('assistant_call_failed'));
 assert.equal(provider.calls.length, 2);
});

// ---------------------------------------------------------------------------------------------
// e) O custo previsto e a reserva usam o preço do modelo escolhido.
// ---------------------------------------------------------------------------------------------
const EXPENSIVE = 'Decisor caro (sintético) (Nace)';
test('e) custo previsto e reserva usam o preço do modelo escolhido; o acerto também, quando ele responde', async t => {
 const f = fixture(t), provider = providers(f, body => jevAnswer(body.model));
 await saveVault(f, 'deepseek'); await saveVault(f, 'typesafe'); await saveCatalogKey(f, 'nace');
 await catalog(f, { action: 'model.save', model: { id: 'decisor-caro', providerId: 'nace', model: 'drex-caro', label: 'Decisor caro (sintético)', capabilities: ['decision'], price: { inputPerM: 0.5, outputPerM: 0 }, source: { url: 'https://precos.example.invalid/', readAt: '2026-11-10' } } });
 await configure(f, { jevEnabled: true });
 const input = { projectId: 'project-a', request: request().request };
 assert.equal((await estimateAssistantPlan(f.db, f.actors.inventory, input, secret, { keys })).costMicros, 3378, 'antes da escolha: o previsto de sempre');
 await configure(f, { jevEnabled: true, decisionModel: 'decisor-caro' });
 // 2.476,2 (DeepSeek, como antes) + 21.454 tokens de conferência a 0,5 = 13.203,2, arredondado para cima.
 assert.deepEqual(await estimateAssistantPlan(f.db, f.actors.inventory, input, secret, { keys }), { costMicros: 13204, calls: 2, provider: 'deepseek', model: 'deepseek-flash', jev: true, decisionDestination: EXPENSIVE });
 // Quem aceitou o valor antigo é avisado antes de qualquer envio.
 await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ acceptedCostMicros: 3378, decisionDestination: EXPENSIVE }), secret, { fetcher: provider.fetch, keys }), code('assistant_cost_changed'));
 assert.equal(provider.calls.length, 0);
 const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request({ acceptedCostMicros: 13204, decisionDestination: EXPENSIVE }), secret, { fetcher: provider.fetch, keys });
 assert.deepEqual(provider.urls(), [DEEPSEEK, NACE]);
 for (const call of provider.calls) assert.deepEqual(call.inflight, { calls: 2, reserved_usd_micros: 13204, reserved_tokens: 26108, reserved_ms: 12000 }, 'reserva em voo igual ao previsto');
 assert.equal(provider.calls[1].auth, `Bearer ${FAKE.nace}`); assert.equal(provider.calls[1].body.model, 'drex-caro'); assert.equal(preview.plan.provenance.jevModel, 'drex-caro');
 // 150 + 120 (DeepSeek) + 500 tokens a 0,5 (escolhido) = 520.
 assert.deepEqual(settled(f), { calls: 2, reserved_usd_micros: 520, reserved_tokens: 1100 }); assert.deepEqual(fallbacks(f), []);
});

test('e) modelo escolhido mais barato não reduz o previsto: a reserva é o maior preço, porque o pedido pode terminar no padrão', async t => {
 const f = fixture(t);
 await decisionSetup(f);
 assert.equal((await estimateAssistantPlan(f.db, f.actors.inventory, { projectId: 'project-a', request: request().request }, secret, { keys })).costMicros, 3378);
});

// ---------------------------------------------------------------------------------------------
// f) Só a administração geral troca as chaves; a troca aparece no histórico de antes e depois.
// ---------------------------------------------------------------------------------------------
test('f) só a administração geral escolhe o modelo por tarefa, a escolha é validada e fica no histórico de antes e depois', async t => {
 const f = fixture(t), local = organizationOwner(f), base = { jevEnabled: true, sttEnabled: true, documentEnabled: true };
 for (const provider of ['deepseek', 'typesafe', 'deepgram', 'groq', 'openai']) await saveVault(f, provider);
 await saveCatalogKey(f, 'perplexity');
 await configure(f, base);
 for (const taskKey of TASK_MODEL_KEYS) assert.ok(CONFIG_FIELDS.some(field => field.key === taskKey && field.kind === 'text'), `${taskKey} entra no histórico`);
 const chosen = { decisionModel: 'perplexity-decider-v1-2', documentModel: 'openai-gpt-5-6-luna', speechModel: 'groq-whisper-turbo' };
 // Quem configura a organização, mas não é a administração geral, muda limites e não muda modelos.
 await configure(f, { ...base, dailyCalls: DEFAULT_ASSISTANT_CONFIG.dailyCalls + 1 }, local);
 for (const [taskKey, model] of Object.entries(chosen)) await assert.rejects(configure(f, { ...base, [taskKey]: model }, local), error => error?.code === 'catalog_admin' && error.status === 403);
 await assert.rejects(configure(f, { ...base, ...chosen }, f.actors.manager));
 assert.deepEqual(TASK_MODEL_KEYS.map(taskKey => storedConfig(f)[taskKey]), [undefined, undefined, undefined], 'sem escolha, as chaves nem são gravadas');
 // A administração geral só grava escolha que existe, serve para a tarefa e tem chave.
 await assert.rejects(configure(f, { ...base, decisionModel: 'modelo-que-nao-existe' }), code('assistant_model'));
 await assert.rejects(configure(f, { ...base, decisionModel: 'deepseek-flash' }), code('assistant_model'));
 await assert.rejects(configure(f, { ...base, documentModel: 'perplexity-decider-v1-2' }), code('assistant_model'));
 await assert.rejects(configure(f, { ...base, speechModel: 'openai-gpt-5-6-luna' }), code('assistant_model'));
 await assert.rejects(configure(f, { ...base, decisionModel: 'nace-drex-max-v1-1' }), code('assistant_credentials'));
 await configure(f, { ...base, ...chosen });
 const added = configChangesOf(f).at(-1);
 for (const [field, after] of Object.entries(chosen)) assert.deepEqual(added.find(change => change.field === field), { field, before: '', after });
 // Uma tela que ainda não conhece as chaves (não as envia) não desfaz a escolha, nem precisa ser a administração geral.
 const older = Object.fromEntries(Object.entries({ ...DEFAULT_ASSISTANT_CONFIG, enabled: true, ...base, dailyCalls: DEFAULT_ASSISTANT_CONFIG.dailyCalls + 2 }).filter(([name]) => !TASK_MODEL_KEYS.includes(name)));
 await configureAssistant(f.db, local, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision(f), config: older }, secret, undefined, keys);
 assert.deepEqual(Object.fromEntries(TASK_MODEL_KEYS.map(taskKey => [taskKey, storedConfig(f)[taskKey]])), chosen);
 assert.deepEqual(configChangesOf(f).at(-1).map(change => change.field), ['dailyCalls']);
 // Desfazer também é só da administração geral, e também fica no histórico.
 await assert.rejects(configure(f, { ...base, ...chosen, speechModel: '' }, local), code('catalog_admin'));
 await configure(f, { ...base, ...chosen, decisionModel: '' });
 assert.deepEqual(configChangesOf(f).at(-1).find(change => change.field === 'decisionModel'), { field: 'decisionModel', before: 'perplexity-decider-v1-2', after: '' });
 assert.equal(JSON.stringify(f.native.prepare('SELECT details FROM audit').all()).includes('test-only-fake'), false, 'nenhuma chave no histórico');
});

// ---------------------------------------------------------------------------------------------
// g) Voz: o consentimento nomeia um destino só; depois de enviado nunca há segundo provedor.
// ---------------------------------------------------------------------------------------------
async function speechSetup(f) {
 for (const provider of ['deepseek', 'deepgram', 'groq']) await saveVault(f, provider);
 await configure(f, { sttEnabled: true, speechModel: 'groq-whisper-turbo' });
}
const ROUTED_SPEECH = 'catalog:groq-whisper-turbo';

test('g) voz no modelo escolhido: o consentimento precisa nomear o destino e o áudio vai só a ele', async t => {
 const f = fixture(t), provider = speechProviders();
 await speechSetup(f);
 // O portal mostra o destino real antes de a pessoa autorizar.
 const status = await assistantStatus(f.db, f.actors.owner, secret, 'org_proex', undefined, keys), organization = status.organizations.find(entry => entry.id === 'org_proex');
 assert.equal(organization.sttProvider, 'deepgram'); assert.equal(organization.sttRoute, ROUTED_SPEECH);
 assert.equal((await roleStatus(f.db, f.actors.inventory, { projectId: 'project-a' }, secret, { keys })).speech.route, ROUTED_SPEECH);
 // Consentimento dado para o provedor padrão não vale para o modelo escolhido: nada é enviado.
 const speechChanged = error => error?.code === 'speech_provider_changed' && error.status === 409 && error.message === 'O serviço que transcreve o áudio mudou. Nada foi enviado. Confira o aviso, autorize e envie de novo.';
 await assert.rejects(transcribeSpeech(f.db, f.actors.inventory, speechInput(), secret, { fetcher: provider.fetch, keys }), speechChanged);
 await assert.rejects(transcribeSpeech(f.db, f.actors.inventory, speechInput({ expectedProvider: 'groq' }), secret, { fetcher: provider.fetch, keys }), speechChanged);
 assert.equal(provider.calls.length, 0);
 const result = await transcribeSpeech(f.db, f.actors.inventory, speechInput({ expectedProvider: ROUTED_SPEECH }), secret, { fetcher: provider.fetch, keys });
 assert.deepEqual(provider.calls, [{ url: GROQ_AUDIO, auth: `Bearer ${FAKE.groq}`, model: 'whisper-large-v3-turbo', fields: ['file', 'model', 'language', 'response_format'] }]);
 assert.equal(result.transcript, 'Texto para revisão humana.'); assert.equal(result.provenance.provider, ROUTED_SPEECH); assert.equal(result.provenance.model, 'whisper-large-v3-turbo');
 assert.equal(usage(f).reserved_usd_micros, 112, 'reserva pelo preço por hora do modelo escolhido');
 assert.equal(JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='assistant.transcribe'").get().details).provider, ROUTED_SPEECH);
 assert.deepEqual(fallbacks(f), []);
 assert.equal((await transcribeSpeech(f.db, f.actors.inventory, speechInput({ expectedProvider: ROUTED_SPEECH }), secret, { fetcher: provider.fetch, keys })).replayed, true);
 assert.equal(provider.calls.length, 1, 'repetir o mesmo envio não chama provedor de novo');
});

const SPEECH_FAILURES = {
 'recusa com HTTP 500': () => refusal(500),
 'recusa com HTTP 429': () => refusal(429),
 'falha de rede': () => { throw new TypeError('synthetic network failure'); },
 'resposta sem texto': () => Response.json({ unexpected: true }),
};
for (const [name, failure] of Object.entries(SPEECH_FAILURES)) test(`g) voz: ${name} no modelo escolhido não leva o áudio a um segundo provedor`, async t => {
 const f = fixture(t), provider = speechProviders(failure);
 await speechSetup(f);
 await assert.rejects(transcribeSpeech(f.db, f.actors.inventory, speechInput({ expectedProvider: ROUTED_SPEECH }), secret, { fetcher: provider.fetch, keys }));
 assert.deepEqual(provider.urls(), [GROQ_AUDIO], 'uma chamada só; o Deepgram (padrão) não recebe o áudio');
 assert.deepEqual(fallbacks(f), []);
 // Nem na nova tentativa do mesmo envio.
 await assert.rejects(transcribeSpeech(f.db, f.actors.inventory, speechInput({ expectedProvider: ROUTED_SPEECH }), secret, { fetcher: provider.fetch, keys }));
 assert.deepEqual(provider.urls(), [GROQ_AUDIO]);
});

test('g) voz: modelo escolhido sem chave cai no padrão antes do envio, com o destino padrão no consentimento e a queda na auditoria', async t => {
 const f = fixture(t), provider = speechProviders();
 await speechSetup(f);
 await manageAssistantCredential(f.db, f.actors.owner, { action: 'remove', organizationId: 'org_proex', provider: 'groq', expectedRevision: revision(f) }, secret, keys);
 assert.equal(storedConfig(f).speechModel, 'groq-whisper-turbo');
 const organization = (await assistantStatus(f.db, f.actors.owner, secret, 'org_proex', undefined, keys)).organizations.find(entry => entry.id === 'org_proex');
 assert.equal(organization.sttRoute, undefined, 'o portal mostra o provedor padrão como destino');
 await assert.rejects(transcribeSpeech(f.db, f.actors.inventory, speechInput({ expectedProvider: ROUTED_SPEECH }), secret, { fetcher: provider.fetch, keys }), code('speech_provider_changed'));
 assert.equal(provider.calls.length, 0);
 const result = await transcribeSpeech(f.db, f.actors.inventory, speechInput(), secret, { fetcher: provider.fetch, keys });
 assert.deepEqual(provider.calls, [{ url: SPEECH_ENDPOINT, auth: `Token ${FAKE.deepgram}`, model: null, fields: null }]);
 assert.equal(result.provenance.provider, 'deepgram'); assert.equal(usage(f).reserved_usd_micros, 500);
 assert.deepEqual(fallbacks(f), [{ actor: 'inventory-qa', task: 'speech', model: 'groq-whisper-turbo', name: 'Whisper turbo (Groq)', reason: 'Falta a chave do provedor deste modelo.' }]);
});

// ---------------------------------------------------------------------------------------------
// Documento: mesmas regras (recusa cai no padrão; dúvida não repete). A leitura de documento não tem
// acerto depois da resposta (já era assim): a reserva feita antes do envio é o que conta no dia.
// Números do caminho padrão tirados do código de antes do roteamento (commit 95f527a).
const DOCUMENT_BEFORE = { call: { url: DEEPSEEK, length: 1746, sha256: 'ebda541ec1dcb5814db28aa5fedfe2a2f2fa874af9f37ae021424230f8d06f3d' }, usage: { calls: 1, reserved_usd_micros: 2589, reserved_tokens: 5029 } };
// ---------------------------------------------------------------------------------------------
const content = 'O cadastro se chama Jardim universitário. Sua área informada é Comunicação. A execução começa em 31/10/2026. Não há data final informada.';
const fields = () => ({ fields: [{ key: 'name', value: 'Jardim universitário', quote: 'O cadastro se chama Jardim universitário.' }, { key: 'thematicArea', value: 'Comunicação', quote: 'Sua área informada é Comunicação.' }, { key: 'startsAt', value: '31/10/2026', quote: 'A execução começa em 31/10/2026.' }] });
// Com modelo escolhido, o pedido leva o destino que a autorização mostrou: "<modelo do documento>|<modelo da conferência>".
const LUNA = 'GPT-5.6 Luna (OpenAI)', DECIDER = 'Decider v1.2 (Perplexity)';
const documentInput = (aiDestination) => ({ kind: 'project', organizationId: 'org_proex', sourceMode: 'document', format: 'text', content, useAi: true, aiConsent: true, aiOperationKey: crypto.randomUUID(), ...(aiDestination === undefined ? {} : { aiDestination }) });
const openAiAnswer = body => Response.json({ model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fields()) } }], usage: { prompt_tokens: 500, completion_tokens: 200 } });
async function documentSetup(f, config = { documentModel: 'openai-gpt-5-6-luna' }) {
 await saveVault(f, 'deepseek'); await saveVault(f, 'openai');
 await configure(f, { documentEnabled: true, ...config });
}

test('documento: chave vazia faz a chamada e a reserva de antes; modelo escolhido recebe uma chamada só, com a mesma instrução', async t => {
 const standard = fixture(t), first = providers(standard, undefined, fields());
 await documentSetup(standard, {});
 const before = await previewImport(standard.db, standard.actors.owner, documentInput(), secret, first.fetch, undefined, keys);
 assert.deepEqual(first.urls(), [DEEPSEEK]); assert.equal(before.provenance.ai.provider, 'deepseek');
 assert.deepEqual(first.calls.map(({ url, length, sha256 }) => ({ url, length, sha256 })), [DOCUMENT_BEFORE.call], 'mesmo endereço, mesmo corpo, uma chamada');
 assert.deepEqual(first.calls[0].inflight, { ...DOCUMENT_BEFORE.usage, reserved_ms: 12000 }); assert.deepEqual(settled(standard), DOCUMENT_BEFORE.usage);
 assert.equal(standard.sql.some(text => /FROM settings WHERE name/.test(text)), false, 'com a chave vazia o catálogo nem é lido');
 assert.deepEqual(fallbacks(standard), []);

 const routed = fixture(t), second = providers(routed, openAiAnswer, fields());
 await documentSetup(routed);
 const preview = await previewImport(routed.db, routed.actors.owner, documentInput(`${LUNA}|`), secret, second.fetch, undefined, keys);
 assert.deepEqual(second.urls(), [OPENAI]);
 assert.equal(second.calls[0].auth, `Bearer ${FAKE.openai}`); assert.equal(second.calls[0].body.model, 'gpt-5.6-luna');
 assert.deepEqual(second.calls[0].body.messages.map(message => message.role), ['system', 'user']);
 assert.deepEqual(second.calls[0].body.messages, first.calls[0].body.messages, 'mesma instrução e mesmo texto que o padrão recebe');
 assert.equal('temperature' in second.calls[0].body, false, 'o endereço oficial da OpenAI segue sem temperatura no pedido');
 assert.equal(preview.candidates[0].fields.name, 'Jardim universitário');
 assert.equal(preview.provenance.ai.provider, 'catalog:openai-gpt-5-6-luna'); assert.equal(preview.provenance.ai.model, 'gpt-5.6-luna');
 // O escolhido (0,25 / 1,2) é mais barato que o padrão (0,3 / 1,2): a reserva fica no maior preço, o do padrão.
 assert.deepEqual(settled(routed), DOCUMENT_BEFORE.usage); assert.deepEqual(fallbacks(routed), []);
});

test('documento: a reserva usa o preço do modelo escolhido quando ele é mais caro que o padrão', async t => {
 const f = fixture(t), provider = providers(f, openAiAnswer, fields());
 await saveVault(f, 'deepseek'); await saveVault(f, 'openai');
 await catalog(f, { action: 'model.save', model: { id: 'leitor-caro', providerId: 'openai', model: 'leitor-caro-1', label: 'Leitor caro (sintético)', capabilities: ['text', 'document'], price: { inputPerM: 1, outputPerM: 2 }, source: { url: 'https://precos.example.invalid/', readAt: '2026-11-10' } } });
 await configure(f, { documentEnabled: true, documentModel: 'leitor-caro' });
 const preview = await previewImport(f.db, f.actors.owner, documentInput('Leitor caro (sintético) (OpenAI)|'), secret, provider.fetch, undefined, keys);
 assert.deepEqual(provider.urls(), [OPENAI]); assert.equal(provider.calls[0].body.model, 'leitor-caro-1'); assert.equal(preview.provenance.ai.provider, 'catalog:leitor-caro');
 // Mesmo tamanho de pedido do padrão (3.829 de entrada reservados, 1.200 de saída), a 1 e 2 em vez de 0,3 e 1,2.
 assert.deepEqual(provider.calls[0].inflight, { calls: 1, reserved_usd_micros: 3829 + 2400, reserved_tokens: 5029, reserved_ms: 12000 });
});

test('documento: recusa do escolhido cai no padrão com auditoria; tempo esgotado não gera segunda chamada', async t => {
 const refused = fixture(t), first = providers(refused, () => refusal(429), fields());
 await documentSetup(refused);
 const preview = await previewImport(refused.db, refused.actors.owner, documentInput(`${LUNA}|`), secret, first.fetch, undefined, keys);
 assert.deepEqual(first.urls(), [OPENAI, DEEPSEEK]);
 assert.equal(preview.provenance.ai.provider, 'deepseek'); assert.deepEqual(settled(refused), DOCUMENT_BEFORE.usage, 'uma reserva só: a recusa não conta outra chamada nem outro custo');
 assert.equal(first.calls[1].sha256, DOCUMENT_BEFORE.call.sha256, 'o padrão recebe o corpo de sempre');
 assert.deepEqual(fallbacks(refused), [{ actor: 'owner-qa', task: 'document', model: 'openai-gpt-5-6-luna', name: LUNA, reason: 'O serviço recusou o pedido (código 429).' }]);

 // Status 500 não é recusa certa: o padrão não recebe o documento.
 const unsure = fixture(t), third = providers(unsure, () => refusal(500), fields());
 await documentSetup(unsure);
 await assert.rejects(previewImport(unsure.db, unsure.actors.owner, documentInput(`${LUNA}|`), secret, third.fetch, undefined, keys), error => error?.code !== 'document_ai_destination');
 assert.deepEqual(third.urls(), [OPENAI], 'uma chamada só'); assert.deepEqual(fallbacks(unsure), []);

 const doubtful = fixture(t), second = providers(doubtful, () => { throw new DOMException('synthetic timeout', 'TimeoutError'); }, fields());
 await documentSetup(doubtful);
 await assert.rejects(previewImport(doubtful.db, doubtful.actors.owner, documentInput(`${LUNA}|`), secret, second.fetch, undefined, keys), error => error?.code !== 'document_ai_destination');
 assert.deepEqual(second.urls(), [OPENAI], 'o padrão não recebe o documento'); assert.deepEqual(fallbacks(doubtful), []);
 assert.equal(doubtful.native.prepare('SELECT status FROM ai_document_calls').get().status, 'failed');
});

// ---------------------------------------------------------------------------------------------
// Destino do documento: a autorização vale só para os modelos que a tela mostrou. Com modelo escolhido
// e apto, destino errado ou ausente não reserva nem envia nada; sem modelo escolhido o campo é ignorado.
// ---------------------------------------------------------------------------------------------
const destinationChanged = error => error?.code === 'document_ai_destination' && error.status === 409 && error.message === 'O modelo que recebe este texto mudou. Confira o aviso e autorize de novo.';
const documentRows = f => f.native.prepare('SELECT COUNT(*) n FROM ai_document_calls').get().n;
/** O que a tela monta com o estado do assistente: é o mesmo texto que o servidor confere. */
const shownDestination = async (f, actor = f.actors.owner) => { const shown = (await assistantStatus(f.db, actor, secret, 'org_proex', undefined, keys)).organizations.find(entry => entry.id === 'org_proex'); return shown.documentRouteName || shown.decisionRouteName ? `${shown.documentRouteName ?? ''}|${shown.decisionRouteName ?? ''}` : ''; };

test('destino do documento: com modelo escolhido, destino errado ou ausente responde 409 sem reservar nem enviar; o destino certo segue', async t => {
 const f = fixture(t), provider = providers(f, openAiAnswer, fields());
 await documentSetup(f);
 assert.equal(await shownDestination(f), `${LUNA}|`);
 // Ausente, vazio (a tela mostrou o texto de sempre), só o nome, outro modelo, conferência que não existe, quase igual e valor que não é texto.
 for (const shown of [undefined, '', LUNA, '|', `|${LUNA}`, 'GPT-6 Luna (OpenAI)|', `${LUNA}|${DECIDER}`, `${LUNA}| `, `${LUNA.toLowerCase()}|`, 7, null, [`${LUNA}|`]]) {
  await assert.rejects(previewImport(f.db, f.actors.owner, documentInput(shown), secret, provider.fetch, undefined, keys), destinationChanged, JSON.stringify(shown));
  assert.equal(provider.calls.length, 0, 'nenhuma chamada a provedor'); assert.equal(documentRows(f), 0, 'nenhuma reserva aberta'); assert.deepEqual(usage(f), {}, 'nada reservado no dia');
 }
 assert.deepEqual(fallbacks(f), []); assert.deepEqual(auditActions(f).filter(action => action.startsWith('import.')), []);
 const preview = await previewImport(f.db, f.actors.owner, documentInput(await shownDestination(f)), secret, provider.fetch, undefined, keys);
 assert.deepEqual(provider.urls(), [OPENAI]); assert.equal(preview.provenance.ai.provider, 'catalog:openai-gpt-5-6-luna');
 assert.deepEqual(settled(f), DOCUMENT_BEFORE.usage);
});

test('destino do documento: a conferência escolhida também faz parte do destino, com ou sem modelo de documento escolhido', async t => {
 const answer = (body, url) => url === PERPLEXITY ? jevAnswer(body.model) : openAiAnswer(body);
 // Documento e conferência escolhidos.
 const both = fixture(t), first = providers(both, answer, fields());
 await saveVault(both, 'typesafe'); await saveCatalogKey(both, 'perplexity');
 await documentSetup(both, { documentModel: 'openai-gpt-5-6-luna', jevEnabled: true, decisionModel: 'perplexity-decider-v1-2' });
 assert.equal(await shownDestination(both), `${LUNA}|${DECIDER}`);
 for (const shown of [undefined, '', `${LUNA}|`, `|${DECIDER}`, `${DECIDER}|${LUNA}`]) await assert.rejects(previewImport(both.db, both.actors.owner, documentInput(shown), secret, first.fetch, undefined, keys), destinationChanged, JSON.stringify(shown));
 assert.equal(first.calls.length, 0); assert.equal(documentRows(both), 0); assert.deepEqual(usage(both), {});
 const preview = await previewImport(both.db, both.actors.owner, documentInput(`${LUNA}|${DECIDER}`), secret, first.fetch, undefined, keys);
 assert.deepEqual(first.urls(), [OPENAI, PERPLEXITY]); assert.equal(preview.provenance.ai.jevModel, 'pplx-decider-v1.2');
 // Só a conferência escolhida: o documento segue no padrão, mas o destino mostrado ainda nomeia quem confere.
 const decision = fixture(t), second = providers(decision, answer, fields());
 await saveVault(decision, 'typesafe'); await saveCatalogKey(decision, 'perplexity');
 await documentSetup(decision, { jevEnabled: true, decisionModel: 'perplexity-decider-v1-2' });
 assert.equal(await shownDestination(decision), `|${DECIDER}`);
 for (const shown of [undefined, '', DECIDER, `${LUNA}|${DECIDER}`]) await assert.rejects(previewImport(decision.db, decision.actors.owner, documentInput(shown), secret, second.fetch, undefined, keys), destinationChanged, JSON.stringify(shown));
 assert.equal(second.calls.length, 0); assert.equal(documentRows(decision), 0);
 await previewImport(decision.db, decision.actors.owner, documentInput(`|${DECIDER}`), secret, second.fetch, undefined, keys);
 assert.deepEqual(second.urls(), [DEEPSEEK, PERPLEXITY]);
 assert.equal(second.calls[0].sha256, DOCUMENT_BEFORE.call.sha256, 'o padrão lê o documento com o corpo de sempre');
});

test('destino do documento: sem modelo escolhido, ou com um que não pode receber, o campo é ignorado e o caminho padrão não muda', async t => {
 // Chaves vazias: qualquer valor (ou nenhum) dá a mesma chamada e a mesma reserva de antes do roteamento.
 for (const shown of [undefined, '', `${LUNA}|`, 'qualquer coisa', 7]) {
  const f = fixture(t), provider = providers(f, undefined, fields());
  await documentSetup(f, {});
  assert.equal(await shownDestination(f), '');
  f.sql.length = 0;
  const preview = await previewImport(f.db, f.actors.owner, documentInput(shown), secret, provider.fetch, undefined, keys);
  assert.deepEqual(provider.calls.map(({ url, length, sha256 }) => ({ url, length, sha256 })), [DOCUMENT_BEFORE.call], JSON.stringify(shown));
  assert.deepEqual(settled(f), DOCUMENT_BEFORE.usage); assert.equal(preview.provenance.ai.provider, 'deepseek');
  assert.equal(f.sql.some(text => /FROM settings WHERE name/.test(text)), false, 'com a chave vazia o catálogo nem é lido');
 }
 // Modelo escolhido sem chave: não há destino novo para nomear; o texto vai só ao padrão, com a queda na auditoria.
 const f = fixture(t), provider = providers(f, undefined, fields());
 await documentSetup(f);
 await manageAssistantCredential(f.db, f.actors.owner, { action: 'remove', organizationId: 'org_proex', provider: 'openai', expectedRevision: revision(f) }, secret, keys);
 assert.equal(storedConfig(f).documentModel, 'openai-gpt-5-6-luna'); assert.equal(await shownDestination(f), '');
 await previewImport(f.db, f.actors.owner, documentInput(), secret, provider.fetch, undefined, keys);
 await previewImport(f.db, f.actors.owner, documentInput(`${LUNA}|`), secret, provider.fetch, undefined, keys);
 assert.deepEqual(provider.urls(), [DEEPSEEK, DEEPSEEK]);
 assert.deepEqual(fallbacks(f).map(entry => entry.reason), ['Falta a chave do provedor deste modelo.'], 'a mesma queda, no mesmo dia, fica registrada uma vez só');
});

// ---------------------------------------------------------------------------------------------
// Trava de destino na gravação com prévia: com modelo de conferência escolhido e apto, o pedido só
// segue se a tela mostrou o nome que o servidor resolve agora. Sem rota, o campo é ignorado.
// ---------------------------------------------------------------------------------------------
const decisionChanged = error => error?.code === 'assistant_destination' && error.status === 409 && error.message === 'O modelo que confere este registro mudou. Confira o aviso e confirme de novo.';
const callRows = f => f.native.prepare('SELECT COUNT(*) n FROM ai_calls').get().n;

test('trava de destino: com modelo de conferência escolhido, nome ausente ou errado responde 409 sem reservar nem enviar; o nome certo segue', async t => {
 const f = fixture(t), provider = providers(f, body => jevAnswer(body.model));
 await decisionSetup(f);
 const estimate = await estimateAssistantPlan(f.db, f.actors.inventory, { projectId: 'project-a', request: request().request }, secret, { keys });
 assert.equal(estimate.decisionDestination, DECIDER, 'a estimativa diz quem confere');
 // Ausente (tela antiga), vazio, o padrão, outro modelo, quase igual e valor que não é texto.
 for (const shown of [undefined, '', 'JEV', 'JEV 1.14 (TypeSafe)', 'Drex Max v1.1 (Nace)', `${DECIDER} `, DECIDER.toLowerCase(), 7, null, [DECIDER]]) {
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(shown === undefined ? {} : { decisionDestination: shown }), secret, { fetcher: provider.fetch, keys }), decisionChanged, JSON.stringify(shown));
  assert.equal(provider.calls.length, 0, 'nenhuma chamada a serviço'); assert.equal(callRows(f), 0, 'nenhuma reserva aberta'); assert.deepEqual(usage(f), {}, 'nada reservado no dia');
 }
 assert.deepEqual(fallbacks(f), []);
 const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request({ decisionDestination: estimate.decisionDestination }), secret, { fetcher: provider.fetch, keys });
 assert.deepEqual(provider.urls(), [DEEPSEEK, PERPLEXITY]); assert.equal(preview.plan.provenance.jevModel, 'pplx-decider-v1.2');
 await applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret, Date.now(), keys);
 assert.equal(stock(f), 10);
});

test('trava de destino: a troca do modelo depois da estimativa é barrada; o nome novo passa', async t => {
 const f = fixture(t), provider = providers(f, body => jevAnswer(body.model));
 await decisionSetup(f); await saveCatalogKey(f, 'nace');
 const input = { projectId: 'project-a', request: request().request };
 const before = await estimateAssistantPlan(f.db, f.actors.inventory, input, secret, { keys });
 await configure(f, { jevEnabled: true, decisionModel: 'nace-drex-max-v1-1' });
 await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ decisionDestination: before.decisionDestination }), secret, { fetcher: provider.fetch, keys }), decisionChanged);
 assert.equal(provider.calls.length, 0); assert.equal(callRows(f), 0);
 const after = await estimateAssistantPlan(f.db, f.actors.inventory, input, secret, { keys });
 assert.equal(after.decisionDestination, 'Drex Max v1.1 (Nace)');
 await prepareAssistantPlan(f.db, f.actors.inventory, request({ decisionDestination: after.decisionDestination }), secret, { fetcher: provider.fetch, keys });
 assert.deepEqual(provider.urls(), [DEEPSEEK, NACE]);
});

test('trava de destino: sem modelo escolhido, ou com um que não pode receber, o campo é ignorado e as chamadas são as de antes', async t => {
 for (const shown of [undefined, '', DECIDER, 'qualquer coisa', 7]) {
  const f = fixture(t), provider = providers(f);
  await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: 0, config: { ...DEFAULT_ASSISTANT_CONFIG, enabled: true, jevEnabled: true }, deepseekKey: key, typesafeKey: key }, secret);
  const estimate = await estimateAssistantPlan(f.db, f.actors.inventory, { projectId: 'project-a', request: request().request }, secret);
  assert.deepEqual(estimate, BEFORE_ROUTING['com conferência'].estimate, 'a estimativa não ganha campo novo');
  await prepareAssistantPlan(f.db, f.actors.inventory, request(shown === undefined ? {} : { decisionDestination: shown }), secret, { fetcher: provider.fetch });
  assert.deepEqual(provider.calls.map(({ url, length, sha256 }) => ({ url, length, sha256 })), [DEEPSEEK_CALL, TYPESAFE_CALL], JSON.stringify(shown));
  assert.deepEqual(settled(f), BEFORE_ROUTING['com conferência'].settled);
  assert.equal(f.sql.some(text => /FROM settings WHERE name/.test(text)), false, 'com a chave vazia o catálogo nem é lido');
 }
 // Modelo escolhido sem chave: não há nome novo para conferir; a estimativa não o cita e o pedido vai só ao padrão.
 const f = fixture(t), provider = providers(f);
 await decisionSetup(f);
 await catalog(f, { action: 'key.remove', providerId: 'perplexity' });
 assert.equal('decisionDestination' in await estimateAssistantPlan(f.db, f.actors.inventory, { projectId: 'project-a', request: request().request }, secret, { keys }), false);
 await prepareAssistantPlan(f.db, f.actors.inventory, request({ decisionDestination: DECIDER }), secret, { fetcher: provider.fetch, keys });
 assert.deepEqual(provider.urls(), [DEEPSEEK, TYPESAFE]);
});

// ---------------------------------------------------------------------------------------------
// Volta de versão segura: modelo por tarefa vazio não é gravado; a leitura preenche o padrão.
// ---------------------------------------------------------------------------------------------
test('configuração gravada: as três chaves vazias não são gravadas; com uma escolhida, só ela é gravada', async t => {
 const f = fixture(t);
 for (const provider of ['deepseek', 'typesafe', 'deepgram', 'groq', 'openai']) await saveVault(f, provider);
 await saveCatalogKey(f, 'perplexity');
 const stored = () => TASK_MODEL_KEYS.filter(taskKey => Object.hasOwn(storedConfig(f), taskKey));
 assert.deepEqual(stored(), [], 'salvar chaves no cofre e no catálogo não grava modelo por tarefa');
 await configure(f, { jevEnabled: true, sttEnabled: true, documentEnabled: true });
 assert.deepEqual(stored(), [], 'três vazias: nenhuma gravada');
 // A leitura devolve o padrão ('') para quem configura, e o caminho de uso segue igual.
 const status = await assistantStatus(f.db, f.actors.owner, secret, 'org_proex', undefined, keys);
 assert.deepEqual(TASK_MODEL_KEYS.map(taskKey => status.config[taskKey]), ['', '', '']);
 await configure(f, { jevEnabled: true, sttEnabled: true, documentEnabled: true, speechModel: 'groq-whisper-turbo' });
 assert.deepEqual(stored(), ['speechModel']); assert.equal(storedConfig(f).speechModel, 'groq-whisper-turbo');
 // O registro da troca guarda o nome que o histórico mostra, além do código.
 assert.deepEqual(JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='assistant.configure' ORDER BY rowid DESC LIMIT 1").get().details).modelNames, { 'groq-whisper-turbo': 'Whisper turbo (Groq)' });
 // Trocar uma chave do cofre regrava a configuração: continua só com a escolhida.
 await saveVault(f, 'openai');
 assert.deepEqual(stored(), ['speechModel']);
 await configure(f, { jevEnabled: true, sttEnabled: true, documentEnabled: true, decisionModel: 'perplexity-decider-v1-2' });
 assert.deepEqual(stored(), ['decisionModel'], 'desfazer a voz tira a chave do registro gravado');
 assert.deepEqual(JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='assistant.configure' ORDER BY rowid DESC LIMIT 1").get().details).modelNames, { 'groq-whisper-turbo': 'Whisper turbo (Groq)', 'perplexity-decider-v1-2': DECIDER });
});

// ---------------------------------------------------------------------------------------------
// Registro de queda sem repetir: um por organização, tarefa, modelo e motivo por dia de Brasília.
// ---------------------------------------------------------------------------------------------
test('registro de queda: a mesma queda no mesmo dia fica uma vez só; outro motivo ou outro dia registra de novo', async t => {
 const f = fixture(t), provider = providers(f);
 await decisionSetup(f);
 await catalog(f, { action: 'key.remove', providerId: 'perplexity' });
 const prepare = name => prepareAssistantPlan(f.db, f.actors.inventory, request({ operationKey: `test-only-assistant-call-${name}` }), secret, { fetcher: provider.fetch, keys });
 await prepare('one'); await prepare('two'); await prepare('three');
 assert.equal(provider.calls.filter(call => call.url === TYPESAFE).length, 3, 'as três conferências foram ao padrão');
 assert.deepEqual(fallbacks(f).map(entry => entry.reason), ['Falta a chave do provedor deste modelo.']);
 // Outro motivo no mesmo dia: registra.
 await saveCatalogKey(f, 'perplexity');
 const name = 'ai.catalog.v1:org_proex', saved = JSON.parse(f.native.prepare('SELECT value FROM settings WHERE name=?').get(name).value);
 f.native.prepare('UPDATE settings SET value=? WHERE name=?').run(JSON.stringify({ ...saved, models: saved.models.map(model => model.id === 'perplexity-decider-v1-2' ? { ...model, enabled: false } : model) }), name);
 await prepare('four'); await prepare('five');
 assert.deepEqual(fallbacks(f).map(entry => entry.reason), ['Falta a chave do provedor deste modelo.', 'Modelo removido ou desligado no catálogo.']);
 // No dia seguinte a mesma queda volta a ser registrada (uma vez).
 f.native.prepare("UPDATE audit SET created_at=? WHERE action='assistant.route.fallback'").run(new Date(Date.now() - 30 * 3600000).toISOString());
 await prepare('six'); await prepare('seven');
 assert.equal(fallbacks(f).filter(entry => entry.reason === 'Modelo removido ou desligado no catálogo.').length, 2);
 assert.equal(fallbacks(f).length, 3);
});

// ---------------------------------------------------------------------------------------------
// Documento no modelo escolhido: temperatura 0 onde o portal envia temperatura.
// ---------------------------------------------------------------------------------------------
test('documento no modelo escolhido: serviço compatível recebe temperatura 0', async t => {
 const f = fixture(t), provider = providers(f, openAiAnswer, fields());
 await saveVault(f, 'deepseek'); await saveVault(f, 'groq');
 await catalog(f, { action: 'model.save', model: { id: 'leitor-groq', providerId: 'groq', model: 'leitor-groq-1', label: 'Leitor Groq (sintético)', capabilities: ['text', 'document'], price: { inputPerM: 0.2, outputPerM: 0.6 }, source: { url: 'https://precos.example.invalid/', readAt: '2026-11-10' } } });
 await configure(f, { documentEnabled: true, documentModel: 'leitor-groq' });
 const preview = await previewImport(f.db, f.actors.owner, documentInput('Leitor Groq (sintético)|'), secret, provider.fetch, undefined, keys);
 assert.deepEqual(provider.urls(), ['https://api.groq.com/openai/v1/chat/completions']);
 assert.equal(provider.calls[0].body.temperature, 0); assert.equal(provider.calls[0].body.model, 'leitor-groq-1');
 assert.equal(preview.provenance.ai.provider, 'catalog:leitor-groq');
});

// ---------------------------------------------------------------------------------------------
// Salvamento: com troca de modelo por tarefa, a conferência de administração geral entra na mesma
// transação do salvamento. Perder esse papel entre a leitura e a gravação não grava a troca.
// ---------------------------------------------------------------------------------------------
test('salvamento: quem deixa de ser administração geral durante o salvamento não grava a troca de modelo por tarefa', async t => {
 const f = fixture(t), at = new Date().toISOString();
 await saveVault(f, 'deepseek'); await saveVault(f, 'typesafe'); await saveCatalogKey(f, 'perplexity');
 await configure(f, { jevEnabled: true });
 // A mesma pessoa é também dona da organização: a autoridade de configurar continua depois de perder a administração geral.
 f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES('owner-qa-org','owner-qa','owner@example.test','owner',NULL,'org_proex',?)").run(at);
 const racing = { prepare: text => f.db.prepare(text), batch: async statements => { f.native.prepare("UPDATE members SET revoked_at=? WHERE id='owner-qa'").run(at); return f.db.batch(statements); } };
 const save = config => configureAssistant(racing, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision(f), config: { ...DEFAULT_ASSISTANT_CONFIG, enabled: true, jevEnabled: true, ...config } }, secret, undefined, keys);
 const before = revision(f);
 await assert.rejects(save({ decisionModel: 'perplexity-decider-v1-2' }), error => error?.code === 'assistant_configuration_forbidden' && error.status === 403);
 assert.equal(revision(f), before); assert.equal(Object.hasOwn(storedConfig(f), 'decisionModel'), false, 'a troca não foi gravada');
 // Sem troca de modelo, quem configura a organização continua salvando limites (regra de sempre).
 await save({ dailyCalls: DEFAULT_ASSISTANT_CONFIG.dailyCalls + 1 });
 assert.equal(storedConfig(f).dailyCalls, DEFAULT_ASSISTANT_CONFIG.dailyCalls + 1);
});

// ---------------------------------------------------------------------------------------------
// Avisos 409 da voz: sem modelo escolhido, o texto de sempre; com modelo em jogo, o texto diz o que fazer.
// ---------------------------------------------------------------------------------------------
test('voz: sem modelo escolhido o aviso de troca de serviço é o de sempre; quem viu um modelo que deixou de valer recebe o aviso novo', async t => {
 const usual = 'O provedor de transcrição mudou. Atualize o portal e confirme novamente.', fresh = 'O serviço que transcreve o áudio mudou. Nada foi enviado. Confira o aviso, autorize e envie de novo.';
 const said = message => error => error?.code === 'speech_provider_changed' && error.status === 409 && error.message === message;
 const f = fixture(t), provider = speechProviders();
 await saveVault(f, 'groq');
 await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision(f), config: { ...DEFAULT_ASSISTANT_CONFIG, sttProvider: 'groq', sttEnabled: true } }, secret, undefined, keys);
 // A tela ainda mostrava o Deepgram: texto de sempre, letra por letra.
 await assert.rejects(transcribeSpeech(f.db, f.actors.inventory, speechInput(), secret, { fetcher: provider.fetch, keys }), said(usual));
 await assert.rejects(transcribeSpeech(f.db, f.actors.inventory, speechInput({ expectedProvider: 'deepgram' }), secret, { fetcher: provider.fetch, keys }), said(usual));
 // A tela mostrava um modelo escolhido que a administração desfez: o aviso novo.
 await assert.rejects(transcribeSpeech(f.db, f.actors.inventory, speechInput({ expectedProvider: ROUTED_SPEECH }), secret, { fetcher: provider.fetch, keys }), said(fresh));
 assert.equal(provider.calls.length, 0, 'nada foi enviado');
});

// ---------------------------------------------------------------------------------------------
// Recusas ao salvar o modelo por tarefa: o texto diz o que fazer, com os nomes das abas da tela.
// ---------------------------------------------------------------------------------------------
test('salvamento do modelo por tarefa: cada recusa diz o que fazer, sem citar catálogo nem provedor', async t => {
 const f = fixture(t), local = organizationOwner(f), base = { jevEnabled: true, sttEnabled: true, documentEnabled: true };
 for (const provider of ['deepseek', 'typesafe', 'deepgram', 'groq', 'openai']) await saveVault(f, provider);
 await configure(f, base);
 const refused = (status, errorCode, message) => error => error?.status === status && error.code === errorCode && error.message === message;
 await assert.rejects(configure(f, { ...base, decisionModel: 'perplexity-decider-v1-2' }, local), refused(403, 'catalog_admin', 'Só a administração geral escolhe os modelos de documentos, conferência e voz.'));
 await assert.rejects(configure(f, { ...base, decisionModel: 'Modelo Inválido!' }), refused(400, 'assistant_model', 'Escolha um modelo da aba Modelos para esta tarefa.'));
 await assert.rejects(configure(f, { ...base, decisionModel: 'modelo-que-nao-existe' }), refused(400, 'assistant_model', 'Escolha um modelo que exista e esteja ligado na aba Modelos.'));
 await assert.rejects(configure(f, { ...base, decisionModel: 'deepseek-flash' }), refused(400, 'assistant_model', 'Esse serviço não responde no formato de conferência (JEV).'));
 await assert.rejects(configure(f, { ...base, decisionModel: 'perplexity-decider-v1-2' }), refused(400, 'assistant_credentials', 'Falta a chave do serviço deste modelo. Cole a chave na aba Chaves e escolha o modelo de novo.'));
 assert.deepEqual(TASK_MODEL_KEYS.filter(taskKey => Object.hasOwn(storedConfig(f), taskKey)), [], 'nenhuma recusa gravou escolha');
});
