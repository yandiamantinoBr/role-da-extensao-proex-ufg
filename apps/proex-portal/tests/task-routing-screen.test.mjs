// Roteamento por tarefa, lado da tela: o que o servidor expõe para a tela mostrar antes do envio
// (destino e teto da voz, reserva da triagem) e as listas dos seletores da administração.
// Tudo aqui é sintético: chaves falsas, provedores falsos, banco em memória. Nenhuma chamada real.
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
 const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-task-routing-screen-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { DEFAULT_ASSISTANT_CONFIG } = await import(compile('assistant/contracts'));
const { configureAssistant, assistantStatus } = await import(compile('assistant/settings'));
const { manageAssistantCredential } = await import(compile('assistant/credential-vault'));
const { catalogView, catalogSettingName, manageCatalog } = await import(compile('assistant/model-catalog-store'));
const { defaultCatalog, fitsTask, taskModelOptions } = await import(compile('assistant/model-catalog'));
const { transcribeSpeech, validateSpeechAudio, speechReservedUsdMicros, SPEECH_ENDPOINT } = await import(compile('assistant/speech'));
const { roleStatus } = await import(compile('assistant/role'));
const { roleSpeechCeilingMicros, speechRouteCeilingMicros, speechRouteName, taskRouteLabel, shownRouteName, triageNoticeText, triageConsentText, documentConsentText, operationConferenceText, operationsServiceText, operationsConferenceSentence } = await import(compile('assistant/role-contracts'));
const { encodeSpeechWav } = await import(compile('../components/portal/speech-audio'));

const secret = 'test-only-assistant-auth-secret-no-production-access';
const keys = { current: 'synthetic-only-independent-key-for-task-routing-screen-tests' };
const FAKE = { deepseek: 'test-only-fake-provider-credential', typesafe: 'test-only-fake-typesafe-credential', deepgram: 'test-only-fake-deepgram-credential', groq: 'test-only-fake-groq-credential', openai: 'test-only-fake-openai-credential', perplexity: 'test-only-fake-perplexity-credential' };
const GROQ_AUDIO = 'https://api.groq.com/openai/v1/audio/transcriptions';

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

const revision = f => Number(f.native.prepare("SELECT revision FROM ai_organization_settings WHERE organization_id='org_proex'").get()?.revision ?? 0);
const reserved = f => f.native.prepare('SELECT reserved_usd_micros FROM ai_organization_usage').get().reserved_usd_micros;
const saveVault = (f, provider) => manageAssistantCredential(f.db, f.actors.owner, { action: 'save', organizationId: 'org_proex', provider, expectedRevision: revision(f), label: 'Chave sintética', secret: FAKE[provider] }, secret, keys);
const view = f => catalogView(f.db, f.actors.owner, 'org_proex', secret, keys);
/** Grava o catálogo direto no banco: o portal recusa desligar um modelo em uso, então o teste simula o estado antigo. */
function storeCatalog(f, next) { const name = catalogSettingName('org_proex'); f.native.prepare('DELETE FROM settings WHERE name=?').run(name); f.native.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?)').run(name, JSON.stringify(next), '2026-11-10T00:00:00.000Z'); }
const configure = (f, config = {}) => configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: revision(f), config: { ...DEFAULT_ASSISTANT_CONFIG, enabled: true, ...config } }, secret, undefined, keys);
const organizationOf = async f => (await assistantStatus(f.db, f.actors.owner, secret, 'org_proex', undefined, keys)).organizations.find(entry => entry.id === 'org_proex');
const roleSpeech = async f => (await roleStatus(f.db, f.actors.inventory, { projectId: 'project-a' }, secret, { keys })).speech;
async function speechSetup(f, config = { speechModel: 'groq-whisper-turbo' }) {
 for (const provider of ['deepseek', 'deepgram', 'groq']) await saveVault(f, provider);
 await configure(f, { sttEnabled: true, ...config });
}
function wav(seconds = 1) { const samples = new Float32Array(Math.floor(seconds * 16000)); for (let i = 0; i < samples.length; i++) samples[i] = .1 * Math.sin(i * .1); return encodeSpeechWav({ duration: seconds, length: samples.length, sampleRate: 16000, numberOfChannels: 1, getChannelData: () => samples }); }
const speechInput = (expectedProvider, seconds = 1) => ({ projectId: 'project-a', operationKey: `test-only-transcription-${String(seconds).replace('.', '-')}`, consent: true, mime: 'audio/wav', bytes: wav(seconds), expectedProvider });
/** Voz falsa: Deepgram (áudio cru) e formulário de áudio no formato OpenAI (Groq). */
function speechProviders() {
 const urls = [];
 return { urls, fetch: async (url, init) => {
  urls.push(String(url));
  if (init.body instanceof FormData) return Response.json({ text: 'Texto para revisão humana.' });
  const duration = validateSpeechAudio(new Uint8Array(init.body), 'audio/wav').duration;
  return Response.json({ metadata: { duration, model_info: { 'synthetic-model': { arch: 'nova-3', name: '3-general-nova', version: '2026-05-13.synthetic' } } }, results: { channels: [{ alternatives: [{ transcript: 'Registrar entrada de 10 canetas.' }] }] } });
 } };
}

// ---------------------------------------------------------------------------------------------
// Teto da voz: a função que a tela usa dá o mesmo número que o servidor reserva.
// ---------------------------------------------------------------------------------------------
test('teto da voz no modelo escolhido: contas fixas (1 s a US$ 0,04/h = 112) e piso da reserva revisada do mesmo formato (Groq ou Deepgram)', () => {
 assert.equal(speechRouteCeilingMicros('groq', 1, 0.04), 112);
 assert.equal(speechRouteCeilingMicros('groq', 0.5, 0.04), 112, 'mínimo de 10 s cobrados');
 assert.equal(speechRouteCeilingMicros('groq', 90, 0.04), 1000);
 assert.equal(speechRouteCeilingMicros('groq', 90, 0.36), 9000);
 // Formato Groq: preço cadastrado abaixo do revisado (US$ 0,04/h) não baixa a reserva.
 assert.equal(speechRouteCeilingMicros('groq', 1, 0.01), 112);
 assert.equal(speechRouteCeilingMicros('groq', 90, 0.01), 1000);
 assert.equal(speechRouteCeilingMicros('groq', 90, 0.0001), roleSpeechCeilingMicros('groq', 90));
 // Formato Deepgram: nunca abaixo da reserva revisada (US$ 0,03/min).
 assert.equal(speechRouteCeilingMicros('deepgram', 1, 0.258), 717);
 assert.equal(speechRouteCeilingMicros('deepgram', 60, 0.258), 30000);
 assert.equal(speechRouteCeilingMicros('deepgram', 90, 3), 75000);
 for (const seconds of [0.5, 1, 9.99, 10, 37.5, 60, 90]) {
  assert.equal(speechRouteCeilingMicros('groq', seconds, 0.04), speechReservedUsdMicros('groq', seconds), 'mesmo preço do padrão, mesma reserva');
  assert.equal(speechRouteCeilingMicros('deepgram', seconds, 0.258), Math.max(Math.ceil(Math.max(seconds, 10) * 258000 / 3600), speechReservedUsdMicros('deepgram', seconds)));
  for (const provider of ['groq', 'deepgram']) assert.equal(roleSpeechCeilingMicros(provider, seconds), speechReservedUsdMicros(provider, seconds), 'o teto do padrão não mudou');
 }
});

test('teto da voz: o que a tela calcula com os dados do estado é exatamente o que o servidor reserva ao transcrever', async t => {
 // Formulário de áudio (Groq) escolhido sobre o padrão Deepgram.
 const groq = fixture(t), first = speechProviders();
 await speechSetup(groq);
 const shown = (await roleSpeech(groq)).routeModel;
 await transcribeSpeech(groq.db, groq.actors.inventory, { ...speechInput('catalog:groq-whisper-turbo', 1), approval: shown.approval }, secret, { fetcher: first.fetch, keys });
 assert.deepEqual(first.urls, [GROQ_AUDIO]);
 assert.equal(reserved(groq), 112); assert.equal(speechRouteCeilingMicros(shown.style, 1, shown.perHour), 112);
 await transcribeSpeech(groq.db, groq.actors.inventory, { ...speechInput('catalog:groq-whisper-turbo', 37.5), approval: shown.approval }, secret, { fetcher: first.fetch, keys });
 assert.equal(reserved(groq), 112 + speechRouteCeilingMicros(shown.style, 37.5, shown.perHour));

 // Deepgram do catálogo escolhido sobre o padrão Groq: formato Deepgram, com o piso da reserva revisada.
 const deepgram = fixture(t), second = speechProviders();
 await speechSetup(deepgram, { sttProvider: 'groq', speechModel: 'deepgram-nova-3' });
 const other = (await roleSpeech(deepgram)).routeModel;
 assert.deepEqual({ ...other, approval: typeof other.approval }, { label: 'Nova-3 (Deepgram)', service: 'Deepgram', perHour: 0.258, style: 'deepgram', approval: 'string' });
 await transcribeSpeech(deepgram.db, deepgram.actors.inventory, { ...speechInput('catalog:deepgram-nova-3', 1), approval: other.approval }, secret, { fetcher: second.fetch, keys });
 assert.deepEqual(second.urls, [SPEECH_ENDPOINT]);
 assert.equal(reserved(deepgram), 717); assert.equal(speechRouteCeilingMicros(other.style, 1, other.perHour), 717);
 await transcribeSpeech(deepgram.db, deepgram.actors.inventory, { ...speechInput('catalog:deepgram-nova-3', 60), approval: other.approval }, secret, { fetcher: second.fetch, keys });
 assert.equal(reserved(deepgram), 717 + 30000); assert.equal(speechRouteCeilingMicros(other.style, 60, other.perHour), 30000);
});

// ---------------------------------------------------------------------------------------------
// Estado: nome, preço e formato só existem com modelo escolhido em condição de receber o áudio.
// ---------------------------------------------------------------------------------------------
const TODAY_ORGANIZATION = ['id', 'name', 'canConfigure', 'canDelegate', 'canUseAi', 'usageScope', 'usageIsMine', 'available', 'sttAvailable', 'sttProvider', 'legacySttProvider', 'sttCredentialSource', 'documentAvailable', 'documentApproval', 'documentCostMicros', 'documentProvider', 'documentHasDecision', 'decisionApproval', 'decisionCostMicros'];

test('estado sem modelo de voz escolhido: Rolê e assistente respondem exatamente como hoje e o catálogo nem é lido para a voz', async t => {
 const f = fixture(t);
 await speechSetup(f, {});
 assert.deepEqual(await roleSpeech(f), { available: true, provider: 'deepgram' });
 f.sql.length = 0;
 const organization = await organizationOf(f);
 assert.deepEqual(Object.keys(organization), TODAY_ORGANIZATION);
 assert.equal(organization.sttProvider, 'deepgram'); assert.equal(organization.sttAvailable, true);
 assert.equal(f.sql.some(text => /FROM settings WHERE name/.test(text)), false, 'com a chave vazia o catálogo nem é lido');
});

test('estado com modelo de voz escolhido: o destino vem com nome do modelo, serviço, preço por hora e formato, sem chave nem endereço', async t => {
 const f = fixture(t), expected = { label: 'Whisper turbo (Groq)', service: 'Groq', perHour: 0.04, style: 'groq' };
 await speechSetup(f);
 const voice = await roleSpeech(f);
 assert.match(voice.routeModel.approval, /^[A-Za-z0-9_-]{43}$/);
 Object.assign(expected, { approval: voice.routeModel.approval });
 assert.deepEqual(voice, { available: true, provider: 'deepgram', route: 'catalog:groq-whisper-turbo', routeModel: expected });
 const organization = await organizationOf(f);
 assert.deepEqual(Object.keys(organization), [...TODAY_ORGANIZATION, 'sttRoute', 'sttRouteModel']);
 assert.equal(organization.sttRoute, 'catalog:groq-whisper-turbo'); assert.deepEqual(organization.sttRouteModel, expected);
 assert.equal(organization.sttProvider, 'deepgram', 'o padrão continua informado');
 assert.equal(speechRouteName(expected), 'Whisper turbo (Groq)', 'o nome já diz o serviço: não repete');
 assert.equal(speechRouteName({ label: 'Voz sintética', service: 'Serviço de teste' }), 'Voz sintética (Serviço de teste)');
 // Quem só usa (sem poder configurar) recebe o mesmo destino e nada além dele.
 const member = (await assistantStatus(f.db, f.actors.inventory, secret, 'org_proex', undefined, keys)).organizations.find(entry => entry.id === 'org_proex');
 assert.equal(member.sttRoute, 'catalog:groq-whisper-turbo'); assert.deepEqual(member.sttRouteModel, expected);
 const everything = JSON.stringify([await roleStatus(f.db, f.actors.inventory, { projectId: 'project-a' }, secret, { keys }), await assistantStatus(f.db, f.actors.inventory, secret, 'org_proex', undefined, keys)]);
 assert.equal(everything.includes('test-only-fake'), false, 'nenhuma chave no estado'); assert.equal(everything.includes('api.groq.com'), false, 'nenhum endereço de provedor no estado');
});

test('estado com modelo de voz escolhido que não pode receber o áudio: volta a ser a resposta de hoje (o destino é o padrão)', async t => {
 // Sem a chave do provedor do modelo escolhido.
 const f = fixture(t);
 await speechSetup(f);
 await manageAssistantCredential(f.db, f.actors.owner, { action: 'remove', organizationId: 'org_proex', provider: 'groq', expectedRevision: revision(f) }, secret, keys);
 assert.deepEqual(await roleSpeech(f), { available: true, provider: 'deepgram' });
 assert.deepEqual(Object.keys(await organizationOf(f)), TODAY_ORGANIZATION);
 // Escolhido igual ao padrão: não há outro destino para nomear.
 const same = fixture(t);
 await speechSetup(same, { speechModel: 'deepgram-nova-3' });
 assert.deepEqual(await roleSpeech(same), { available: true, provider: 'deepgram' });
 assert.deepEqual(Object.keys(await organizationOf(same)), TODAY_ORGANIZATION);
 // Modelo que aparece desligado no catálogo depois de escolhido.
 const off = fixture(t);
 await speechSetup(off);
 const base = defaultCatalog('2026-11-10T00:00:00.000Z');
 storeCatalog(off, { ...base, models: base.models.map(model => model.id === 'groq-whisper-turbo' ? { ...model, enabled: false } : model) });
 assert.equal((await view(off)).catalog.models.find(model => model.id === 'groq-whisper-turbo').enabled, false);
 assert.deepEqual(await roleSpeech(off), { available: true, provider: 'deepgram' });
 assert.deepEqual(Object.keys(await organizationOf(off)), TODAY_ORGANIZATION);
});

// ---------------------------------------------------------------------------------------------
// Seletores da administração: as três listas saem da mesma regra que o servidor aplica (fitsTask).
// ---------------------------------------------------------------------------------------------
test('listas dos seletores: cada tarefa oferece só os modelos que o servidor aceitaria, com o aviso de chave', async t => {
 const f = fixture(t);
 await saveVault(f, 'deepseek'); await saveVault(f, 'groq');
 const shown = (await view(f)).catalog, ids = task => taskModelOptions(shown, task).map(option => option.id);
 assert.deepEqual(ids('document'), ['deepseek-flash', 'openai-gpt-5-6-luna', 'openai-gpt-6-luna', 'openai-gpt-6-1-terra', 'anthropic-claude-haiku-5-5']);
 assert.deepEqual(ids('decision'), ['typesafe-jev-1-14', 'perplexity-decider-v1-2', 'nace-drex-max-v1-1']);
 assert.deepEqual(ids('speech'), ['groq-whisper-turbo', 'deepgram-nova-3']);
 assert.deepEqual(taskModelOptions(shown, 'speech'), [{ id: 'groq-whisper-turbo', label: 'Whisper turbo (Groq)', hasKey: true }, { id: 'deepgram-nova-3', label: 'Nova-3 (Deepgram)', hasKey: false }]);
 assert.deepEqual(taskModelOptions(shown, 'document').filter(option => option.hasKey).map(option => option.id), ['deepseek-flash']);
 for (const task of ['document', 'decision', 'speech']) for (const option of taskModelOptions(shown, task)) {
  const model = shown.models.find(entry => entry.id === option.id);
  assert.equal(fitsTask(model, shown.providers.find(provider => provider.id === model.providerId), task), null);
 }
});

test('listas dos seletores: modelo desligado, de teste, sem preço ou de provedor que não serve fica de fora', () => {
 const base = defaultCatalog('2026-11-10T00:00:00.000Z'), change = (id, patch) => ({ ...base, models: base.models.map(model => model.id === id ? { ...model, ...patch } : model) });
 const ids = (shown, task) => taskModelOptions(shown, task).map(option => option.id);
 assert.equal(ids(change('groq-whisper-turbo', { enabled: false }), 'speech').includes('groq-whisper-turbo'), false, 'desligado');
 assert.equal(ids(change('groq-whisper-turbo', { testOnly: true }), 'speech').includes('groq-whisper-turbo'), false, 'só para teste');
 assert.equal(ids(change('groq-whisper-turbo', { price: { inputPerM: 0, outputPerM: 0, perHour: 0 } }), 'speech').includes('groq-whisper-turbo'), false, 'sem preço por hora');
 assert.equal(ids(change('openai-gpt-6-luna', { price: { inputPerM: 0.1, outputPerM: 0, perHour: 0 } }), 'document').includes('openai-gpt-6-luna'), false, 'sem preço de saída');
 assert.equal(ids(change('perplexity-decider-v1-2', { price: { inputPerM: 0, outputPerM: 0, perHour: 0 } }), 'decision').includes('perplexity-decider-v1-2'), false, 'sem preço de entrada');
 assert.equal(ids(change('typesafe-jev-1-14', { capabilities: ['decision', 'document'], price: { inputPerM: 1, outputPerM: 1, perHour: 0 } }), 'document').includes('typesafe-jev-1-14'), false, 'provedor de decisão não lê documento');
 assert.equal(ids(change('deepseek-flash', { capabilities: ['text', 'decision'] }), 'decision').includes('deepseek-flash'), false, 'só o formato de decisão confere e tria');
 assert.equal(ids(change('nvidia-deepseek-v4-1-flash', { capabilities: ['text', 'document'], price: { inputPerM: 1, outputPerM: 1, perHour: 0 } }), 'document').includes('nvidia-deepseek-v4-1-flash'), false, 'modelo de teste nunca entra');
 assert.deepEqual(taskModelOptions({ providers: [], models: base.models }, 'speech'), [], 'provedor removido');
 assert.equal(taskModelOptions(base, 'speech').every(option => option.hasKey === false), true, 'sem informação de chave, avisa que falta');
});

// ---------------------------------------------------------------------------------------------
// Avisos e autorizações de documento, conferência e triagem: sem modelo escolhido, o texto de sempre;
// com modelo escolhido, o texto nomeia o modelo e diz que o padrão de hoje é a reserva.
// ---------------------------------------------------------------------------------------------
const LUNA = 'GPT-5.6 Luna (OpenAI)', DECIDER = 'Decider v1.2 (Perplexity)';

test('textos sem modelo escolhido: exatamente os de antes, com nome ausente, nulo ou vazio', () => {
 for (const none of [undefined, null, '']) {
  assert.equal(triageNoticeText(none), 'O JEV recebe esse resumo e o prazo desta demanda.');
  assert.equal(triageConsentText(none), 'Autorizo enviar este resumo e prazo à TypeSafe.');
  assert.equal(documentConsentText(none, none), 'Autorizo enviar o texto extraído desta fonte ao provedor de texto escolhido para esta organização (DeepSeek ou OpenAI) e ao Jev se habilitado.');
  assert.equal(operationConferenceText(none), ', com conferência da TypeSafe (JEV)');
  assert.equal(operationsServiceText(none), 'o serviço de registros de estoque');
  assert.equal(operationsConferenceSentence(none), '', 'sem modelo escolhido não há frase nova no aviso');
 }
 assert.equal(operationsServiceText(), 'o serviço de registros de estoque');
 assert.equal(triageNoticeText(), 'O JEV recebe esse resumo e o prazo desta demanda.');
 assert.equal(documentConsentText(), 'Autorizo enviar o texto extraído desta fonte ao provedor de texto escolhido para esta organização (DeepSeek ou OpenAI) e ao Jev se habilitado.');
});

test('textos com modelo escolhido: nomeiam apenas quem pode receber nesta confirmação', () => {
 const texts = {
  aviso: triageNoticeText(DECIDER), triagem: triageConsentText(DECIDER), documento: documentConsentText(LUNA), documentoEConferencia: documentConsentText(LUNA, DECIDER),
  conferencia: documentConsentText(null, DECIDER), registro: operationConferenceText(DECIDER), servico: operationsConferenceSentence(DECIDER),
 };
 assert.deepEqual(texts, {
  aviso: 'O modelo Decider v1.2 (Perplexity) recebe esse resumo e o prazo desta demanda.',
  triagem: 'Autorizo enviar este resumo e prazo ao modelo Decider v1.2 (Perplexity).',
  documento: 'Autorizo enviar o texto desta fonte ao modelo GPT-5.6 Luna (OpenAI). O texto também vai ao JEV se a conferência estiver ligada.',
  documentoEConferencia: 'Autorizo enviar o texto desta fonte ao modelo GPT-5.6 Luna (OpenAI) (leitura) e ao modelo Decider v1.2 (Perplexity) (conferência).',
  conferencia: 'Autorizo enviar o texto desta fonte ao padrão do portal (DeepSeek ou OpenAI) e, para a conferência, ao modelo Decider v1.2 (Perplexity).',
  registro: ', com conferência do modelo Decider v1.2 (Perplexity)',
  servico: 'Os registros de estoque são conferidos pelo modelo Decider v1.2 (Perplexity).',
 });
 assert.equal(operationsServiceText(DECIDER), 'o serviço de registros de estoque', 'o item da lista não muda: quem confere vai na frase à parte');
 for (const [name, text] of Object.entries(texts)) {
  assert.doesNotMatch(text, /se (ele|um deles) não puder responder/i, name);
  assert.doesNotMatch(text, /\b(tokens?|fallback|rotas?|endpoints?|catálogo|provedor(es)?|aptos?)\b/i, `${name}: sem termo técnico`);
  assert.doesNotMatch(text, /JEV padrão|padrão de hoje/i, `${name}: o padrão é "padrão do portal"`);
  assert.doesNotMatch(text.replaceAll(DECIDER, 'X').replaceAll(LUNA, 'Y'), /\([^)]*\(/, `${name}: sem parênteses dentro de parênteses`);
 }

});

test('nome do modelo escolhido: tira a observação entre parênteses do serviço e não repete o serviço que o nome já diz', () => {
 assert.equal(taskRouteLabel({ label: 'Decider v1.2 (Perplexity)', service: 'Perplexity (decisão)' }), DECIDER, 'o nome já diz o serviço');
 assert.equal(taskRouteLabel({ label: 'Leitor sintético', service: 'Perplexity (decisão)' }), 'Leitor sintético (Perplexity)', 'o parêntese do serviço sai');
 assert.equal(taskRouteLabel({ label: 'GPT-5.6 Luna (OpenAI)', service: 'OpenAI' }), LUNA);
 assert.equal(taskRouteLabel({ label: 'leitor OPENAI rápido', service: 'OpenAI' }), 'leitor OPENAI rápido', 'maiúsculas e minúsculas não fazem repetir');
 assert.equal(taskRouteLabel({ label: 'Voz sintética', service: 'Serviço de teste' }), 'Voz sintética (Serviço de teste)');
 assert.equal(taskRouteLabel({ label: 'Modelo sintético', service: '' }), 'Modelo sintético');
 assert.equal(taskRouteLabel({ label: 'Modelo sintético', service: ' (decisão) ' }), 'Modelo sintético', 'serviço que é só observação não vira parêntese vazio');
 // Nome recebido do servidor: só texto curto chega à tela.
 for (const value of [undefined, null, 7, true, {}, [LUNA]]) assert.equal(shownRouteName(value), '');
 assert.equal(shownRouteName(`  ${LUNA} `), LUNA); assert.equal(shownRouteName('x'.repeat(500)).length, 160);
});

test('a documentação na tela nomeia o serviço padrão efetivo e a conferência somente quando ligada', () => {
 assert.equal(documentConsentText(null, null, 'deepseek', false), 'Autorizo enviar o texto desta fonte à DeepSeek.');
 assert.equal(documentConsentText(null, DECIDER, 'openai', true), `Autorizo enviar o texto desta fonte à OpenAI e ao modelo ${DECIDER} para conferência.`);
 assert.equal(documentConsentText(LUNA, null, 'deepseek', true), `Autorizo enviar o texto desta fonte ao modelo ${LUNA} e ao JEV, da TypeSafe, para conferência.`);
});

// ---------------------------------------------------------------------------------------------
// Estado: os nomes de documento e conferência só existem com modelo escolhido e apto a responder.
// ---------------------------------------------------------------------------------------------
const catalogChange = async (f, body) => manageCatalog(f.db, f.actors.owner, { organizationId: 'org_proex', expected: (await view(f)).stamp, ...body }, secret, keys);
const role = f => roleStatus(f.db, f.actors.inventory, { projectId: 'project-a' }, secret, { keys });
async function namesSetup(f, config = {}) {
 for (const provider of ['deepseek', 'typesafe', 'openai']) await saveVault(f, provider);
 await catalogChange(f, { action: 'key.save', providerId: 'perplexity', label: 'Chave sintética', secret: FAKE.perplexity });
 await configure(f, { documentEnabled: true, jevEnabled: true, ...config });
}

test('estado sem modelo de documento ou conferência escolhido: as chaves novas não existem e o catálogo nem é lido', async t => {
 const f = fixture(t);
 await namesSetup(f);
 f.sql.length = 0;
 const organization = await organizationOf(f), status = await role(f);
 assert.deepEqual(Object.keys(organization), TODAY_ORGANIZATION);
 assert.equal(organization.available, true); assert.equal(organization.documentAvailable, true);
 assert.equal(status.operationsAvailable, true); assert.equal('decisionRouteName' in status, false);
 assert.equal(f.sql.some(text => /FROM settings WHERE name/.test(text)), false, 'com as chaves vazias o catálogo nem é lido');
});

test('estado com modelo escolhido e apto: o assistente informa o nome do documento e da conferência, e o Rolê o da conferência', async t => {
 // Só o documento.
 const document = fixture(t);
 await namesSetup(document, { documentModel: 'openai-gpt-5-6-luna' });
 const first = await organizationOf(document);
 assert.deepEqual(Object.keys(first), [...TODAY_ORGANIZATION, 'documentRouteName']); assert.equal(first.documentRouteName, LUNA);
 assert.equal('decisionRouteName' in await role(document), false, 'o Rolê não lê documento');
 // Só a conferência.
 const decision = fixture(t);
 await namesSetup(decision, { decisionModel: 'perplexity-decider-v1-2' });
 const second = await organizationOf(decision), keysBefore = Object.keys(await role(fixtureWithout(t, decision)));
 assert.deepEqual(Object.keys(second), [...TODAY_ORGANIZATION, 'decisionRouteName']); assert.equal(second.decisionRouteName, DECIDER);
 const status = await role(decision);
 assert.equal(status.decisionRouteName, DECIDER);
 assert.deepEqual(Object.keys(status).filter(key => key !== 'decisionRouteName').sort(), keysBefore.sort(), 'nada além do nome entra na resposta do Rolê');
 // Os dois, e quem só usa (sem poder configurar) recebe os mesmos nomes e nada além deles.
 const both = fixture(t);
 await namesSetup(both, { documentModel: 'openai-gpt-5-6-luna', decisionModel: 'perplexity-decider-v1-2' });
 const third = await organizationOf(both);
 assert.deepEqual(Object.keys(third), [...TODAY_ORGANIZATION, 'documentRouteName', 'decisionRouteName']);
 const member = (await assistantStatus(both.db, both.actors.inventory, secret, 'org_proex', undefined, keys)).organizations.find(entry => entry.id === 'org_proex');
 assert.equal(member.documentRouteName, LUNA); assert.equal(member.decisionRouteName, DECIDER); assert.equal(member.canConfigure, false);
 const everything = JSON.stringify([await role(both), await assistantStatus(both.db, both.actors.inventory, secret, 'org_proex', undefined, keys)]);
 assert.equal(everything.includes('test-only-fake'), false, 'nenhuma chave no estado');
 for (const address of ['api.openai.com', 'api.perplexity.ai']) assert.equal(everything.includes(address), false, 'nenhum endereço de provedor no estado');
});
/** O mesmo banco, lido como estava: serve só para comparar as chaves da resposta do Rolê sem o modelo de conferência. */
function fixtureWithout(t, f) {
 const other = fixture(t), stored = f.native.prepare("SELECT revision,config_json,credentials_ciphertext,updated_by,updated_at FROM ai_organization_settings WHERE organization_id='org_proex'").get();
 other.native.prepare("INSERT INTO ai_organization_settings(organization_id,revision,config_json,credentials_ciphertext,updated_by,updated_at) VALUES('org_proex',?,?,?,?,?)").run(stored.revision, JSON.stringify({ ...JSON.parse(stored.config_json), decisionModel: '' }), stored.credentials_ciphertext, stored.updated_by, stored.updated_at);
 return other;
}

test('estado com modelo escolhido que não pode responder: volta a ser a resposta de hoje, sem nome', async t => {
 const chosen = { documentModel: 'openai-gpt-5-6-luna', decisionModel: 'perplexity-decider-v1-2' };
 // Sem a chave dos provedores dos modelos escolhidos.
 const keyless = fixture(t);
 await namesSetup(keyless, chosen);
 await manageAssistantCredential(keyless.db, keyless.actors.owner, { action: 'remove', organizationId: 'org_proex', provider: 'openai', expectedRevision: revision(keyless) }, secret, keys);
 await catalogChange(keyless, { action: 'key.remove', providerId: 'perplexity' });
 assert.deepEqual(Object.keys(await organizationOf(keyless)), TODAY_ORGANIZATION); assert.equal('decisionRouteName' in await role(keyless), false);
 // Modelos que aparecem desligados no catálogo depois de escolhidos.
 const off = fixture(t);
 await namesSetup(off, chosen);
 const stored = (await view(off)).catalog, base = defaultCatalog('2026-11-10T00:00:00.000Z');
 storeCatalog(off, { ...base, models: base.models.map(model => Object.values(chosen).includes(model.id) ? { ...model, enabled: false } : model) });
 assert.equal(stored.models.filter(model => Object.values(chosen).includes(model.id)).every(model => model.enabled), true);
 assert.deepEqual(Object.keys(await organizationOf(off)), TODAY_ORGANIZATION); assert.equal('decisionRouteName' in await role(off), false);
 // Escolhido igual ao padrão: não há outro destino para nomear.
 const same = fixture(t);
 await namesSetup(same, { documentModel: 'deepseek-flash', decisionModel: 'typesafe-jev-1-14' });
 assert.deepEqual(Object.keys(await organizationOf(same)), TODAY_ORGANIZATION); assert.equal('decisionRouteName' in await role(same), false);
 // Conferência desligada: o modelo de conferência escolhido não recebe nada, então não há nome.
 const unchecked = fixture(t);
 await namesSetup(unchecked, { jevEnabled: false, decisionModel: 'perplexity-decider-v1-2' });
 assert.deepEqual(Object.keys(await organizationOf(unchecked)), TODAY_ORGANIZATION); assert.equal('decisionRouteName' in await role(unchecked), false);
});
