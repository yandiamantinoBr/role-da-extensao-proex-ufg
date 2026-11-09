import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Dados 100% sintéticos. Nenhuma chamada sai da máquina.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-spending-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { aiSpending, aiSpendingDay, SPENDING_DAY_LIMIT } = await import(compile('assistant/spending'));

// "Agora" fixo: 09/11/2026 12:00 em Brasília (15:00 UTC).
const NOW = Date.parse('2026-11-09T15:00:00.000Z');
const PROMPT_CANARY = 'PROMPT-CANARIO-texto-do-usuario-nao-pode-sair';
const KEY_CANARY = 'sk-CANARIO-spending-synthetic-0000-ZZ99';

function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date(NOW).toISOString();
  native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('org_outra','Outra organização','outra',?,?)").run(now, now);
  native.prepare("INSERT INTO projects(id,name,description,scope,created_at) VALUES('project-a','Projeto A','','external',?)").run(now);
  const actors = {};
  for (const [role, project, name] of [['owner', null, 'Dona Sintética'], ['viewer', 'project-a', 'viewer@example.test']]) {
    const userId = `${role}-qa`, email = `${role}@example.test`, memberRole = role === 'owner' ? 'owner' : 'inventory';
    native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
    native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(userId, userId, email, memberRole, project, now);
    native.prepare('INSERT INTO profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run(userId, name, now, now);
    actors[role] = { userId, email, displayName: role, capabilities: [], members: [{ id: userId, user_id: userId, email, role: memberRole, project_id: project, revoked_at: null, created_at: now }] };
  }
  const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; } }; } };
  let sequence = 0;
  const audit = (action, details, at, { org = 'org_proex', project = null, actor = 'owner-qa' } = {}) => native.prepare('INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(`audit-${++sequence}`, actor, project, project ? null : org, action, `entity-${sequence}`, typeof details === 'string' ? details : JSON.stringify(details), at);
  const usage = (day, micros, org = 'org_proex') => native.prepare('INSERT INTO ai_organization_usage(organization_id,day,reserved_usd_micros,calls) VALUES(?,?,?,1)').run(org, day, micros);
  return { native, db, actors, audit, usage };
}

function seed(f) {
  // 09/11 (hoje): conversa em texto e uma foto.
  f.audit('assistant.role.chat', { provider: 'deepseek', model: 'deepseek-flash', hasImage: false, inputTokens: 900, outputTokens: 120, reservedUsdMicros: 3000, usdMicros: 1200, operationSuggested: false, operationDropped: false, overrun: false }, '2026-11-09T12:00:00.000Z');
  f.audit('assistant.role.chat', { provider: 'deepseek', model: 'deepseek-flash', hasImage: true, reservedUsdMicros: 6000, usdMicros: 2500 }, '2026-11-09T13:00:00.000Z', { actor: 'viewer-qa' });
  // Virada do dia: 03:00 UTC é meia-noite em Brasília → conta em 09/11.
  f.audit('assistant.role.chat', { provider: 'groq', model: 'openai/gpt-oss-120b', hasImage: false, reservedUsdMicros: 800, usdMicros: 100 }, '2026-11-09T03:00:00.000Z');
  // 02:59 UTC ainda é 08/11 23:59 em Brasília.
  f.audit('assistant.role.chat', { provider: 'groq', model: 'openai/gpt-oss-120b', hasImage: false, reservedUsdMicros: 900, usdMicros: 300 }, '2026-11-09T02:59:00.000Z');
  // 08/11: operação sem organization_id (o gatilho preenche pelo projeto) e sem custo real.
  f.audit('assistant.plan', { intent: 'stock.move', model: 'gpt-5.6-luna', provider: 'openai', jevModel: null, configRevision: 2, requestSha256: 'a'.repeat(64), reservedUsdMicros: 5000 }, '2026-11-08T16:00:00.000Z', { project: 'project-a' });
  // 07/11: voz, documento sem custo, triagem (JEV implícito) e comparação.
  f.audit('assistant.transcribe', { duration: 40, provider: 'groq', model: 'whisper-large-v3-turbo', audioSha256: 'b'.repeat(64), reservedUsdMicros: 444 }, '2026-11-07T10:00:00.000Z');
  f.audit('import.ai.preview', { kind: 'project', model: 'deepseek-flash', provider: 'deepseek', sourceDigest: 'c'.repeat(64), configRevision: 2 }, '2026-11-07T11:00:00.000Z');
  f.audit('task.triage.prepare', { model: 'jev-1.14.0', status: 'ready', inputTokens: 200, reservedUsdMicros: 700, proposalId: 'p1' }, '2026-11-07T12:00:00.000Z');
  f.audit('assistant.compare', { models: [{ provider: 'deepseek', model: 'deepseek-flash', usdMicros: 100, ms: 800 }, { provider: 'openai', model: 'gpt-5.6-luna', usdMicros: 400, ms: 1200 }], reservedUsdMicros: 2000, usdMicros: 500 }, '2026-11-07T13:00:00.000Z');
  // Ruído que não pode entrar: outra ação, outra organização, JSON quebrado.
  f.audit('assistant.configure', { revision: 3, reservedUsdMicros: 999999 }, '2026-11-09T12:30:00.000Z');
  f.audit('assistant.role.chat', { provider: 'deepseek', hasImage: false, reservedUsdMicros: 77777, usdMicros: 77777 }, '2026-11-09T12:30:00.000Z', { org: 'org_outra' });
  f.audit('assistant.role.chat', '{isto não é json', '2026-11-06T12:00:00.000Z');
  f.usage('2026-11-09', 9800); f.usage('2026-11-08', 5900); f.usage('2026-11-07', 3144); f.usage('2026-11-09', 50000, 'org_outra');
}

test('agrega por dia, provedor e função no fuso de Brasília', async () => {
  const f = fixture();
  try {
    seed(f);
    const result = await aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex', from: '2026-11-06', to: '2026-11-09' }, NOW);
    assert.equal(result.from, '2026-11-06'); assert.equal(result.to, '2026-11-09');
    assert.deepEqual(result.days.map(day => day.day), ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
    const [d6, d7, d8, d9] = result.days;
    // JSON quebrado conta como chamada de conversa sem custo, mas nada quebra.
    assert.equal(d6.calls, 1); assert.equal(d6.realUsdMicros, 0); assert.equal(d6.spentUsdMicros, 0);
    // 09/11: 1200 + 2500 + 100 (00:00 em Brasília); a chamada de 02:59 UTC fica em 08/11.
    assert.equal(d9.calls, 3); assert.equal(d9.realUsdMicros, 3800); assert.equal(d9.reservedUsdMicros, 9800);
    assert.deepEqual(d9.byFunction.photos, { calls: 1, realUsdMicros: 2500, ceilingUsdMicros: 6000, spentUsdMicros: 2500 });
    assert.equal(d9.byFunction.role.calls, 2); assert.equal(d9.byProvider.deepseek.realUsdMicros, 3700); assert.equal(d9.byProvider.groq.realUsdMicros, 100);
    assert.equal(d8.calls, 2); assert.equal(d8.realUsdMicros, 300); assert.equal(d8.reservedUsdMicros, 5900);
    // Operação sem custo real: o gasto usa o teto da chamada.
    assert.deepEqual(d8.byFunction.operations, { calls: 1, realUsdMicros: 0, ceilingUsdMicros: 5000, spentUsdMicros: 5000 });
    assert.equal(d8.byProvider.openai.calls, 1); assert.equal(d8.spentUsdMicros, 5300);
    assert.equal(d7.calls, 4); assert.equal(d7.realUsdMicros, 500);
    assert.equal(d7.byFunction.speech.ceilingUsdMicros, 444); assert.equal(d7.byFunction.documents.calls, 1); assert.equal(d7.byFunction.documents.spentUsdMicros, 0);
    assert.equal(d7.byFunction.triage.ceilingUsdMicros, 700); assert.equal(d7.byProvider.typesafe.calls, 1, 'triagem usa o JEV');
    assert.deepEqual(d7.byFunction.compare, { calls: 1, realUsdMicros: 500, ceilingUsdMicros: 2000, spentUsdMicros: 500 });
    assert.equal(d7.byProvider.openai.realUsdMicros, 400); assert.equal(d7.byProvider.deepseek.realUsdMicros, 100);
    assert.equal(result.totals.calls, 10); assert.equal(result.totals.realUsdMicros, 4600); assert.equal(result.totals.reservedUsdMicros, 18844);
    assert.equal(result.today.day, '2026-11-09'); assert.equal(result.today.realUsdMicros, 3800); assert.equal(result.today.reservedUsdMicros, 9800);
    assert.equal(result.dailyLimitUsdMicros, 1_000_000); assert.equal(result.partial, false);
    assert.equal(JSON.stringify(result).includes('77777'), false, 'outra organização não entra');
    assert.equal(JSON.stringify(result).includes('999999'), false, 'ações sem custo de IA não entram');
    // Hoje fora do período também é calculado.
    const past = await aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex', from: '2026-11-06', to: '2026-11-07' }, NOW);
    assert.equal(past.today.realUsdMicros, 3800); assert.equal(past.days.length, 2);
  } finally { f.native.close(); }
});

test('padrão de 30 dias, limite de 92 dias e datas inválidas', async () => {
  const f = fixture();
  try {
    const standard = await aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex' }, NOW);
    assert.equal(standard.days.length, 30); assert.equal(standard.to, '2026-11-09'); assert.equal(standard.from, '2026-10-11');
    assert.equal(standard.totals.calls, 0);
    const max = await aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex', from: '2026-08-10', to: '2026-11-09' }, NOW);
    assert.equal(max.days.length, 92);
    await assert.rejects(aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex', from: '2026-08-09', to: '2026-11-09' }, NOW), error => error.status === 400 && /92 dias/.test(error.message));
    await assert.rejects(aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex', from: '2026-02-30', to: '2026-03-02' }, NOW), error => error.status === 400);
    await assert.rejects(aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex', from: '2026-11-09', to: '2026-11-01' }, NOW), error => error.status === 400);
    await assert.rejects(aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex', from: "2026-11-01' OR 1=1--" }, NOW), error => error.status === 400);
    await assert.rejects(aiSpending(f.db, f.actors.owner, { organizationId: 'org_inexistente' }, NOW), error => error.status === 404);
    await assert.rejects(aiSpendingDay(f.db, f.actors.owner, { organizationId: 'org_proex', day: '09/11/2026' }), error => error.status === 400);
  } finally { f.native.close(); }
});

test('somente a administração geral vê gastos: 401 sem sessão e 403 para não dono', async () => {
  const f = fixture();
  try {
    seed(f);
    await assert.rejects(aiSpending(f.db, null, { organizationId: 'org_proex' }, NOW), error => error.status === 401);
    await assert.rejects(aiSpending(f.db, f.actors.viewer, { organizationId: 'org_proex' }, NOW), error => error.status === 403);
    await assert.rejects(aiSpendingDay(f.db, f.actors.viewer, { organizationId: 'org_proex', day: '2026-11-09' }), error => error.status === 403);
    await assert.rejects(aiSpendingDay(f.db, null, { organizationId: 'org_proex', day: '2026-11-09' }), error => error.status === 401);
    // Dono revogado perde o acesso na hora.
    f.native.prepare("UPDATE members SET revoked_at=? WHERE id='owner-qa'").run(new Date(NOW).toISOString());
    await assert.rejects(aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex' }, NOW), error => error.status === 403);
  } finally { f.native.close(); }
});

test('nada fora da lista de permissão sai: prompt, chave, e-mail e campos estranhos ficam de fora', async () => {
  const f = fixture();
  try {
    seed(f);
    f.audit('assistant.role.chat', { provider: 'deepseek<script>', model: `modelo com espaço ${KEY_CANARY}`, hasImage: false, reservedUsdMicros: 1000, usdMicros: 400, prompt: PROMPT_CANARY, apiKey: KEY_CANARY, email: 'vazado@example.test', reply: PROMPT_CANARY }, '2026-11-09T14:00:00.000Z', { actor: 'viewer-qa' });
    f.audit('assistant.compare', { models: [{ provider: 'openai', model: 'gpt-5.6-luna', usdMicros: 10, ms: 5, prompt: PROMPT_CANARY, apiKey: KEY_CANARY }], reservedUsdMicros: 50, usdMicros: 10, prompt: PROMPT_CANARY }, '2026-11-09T14:10:00.000Z');
    const period = await aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex', from: '2026-11-01', to: '2026-11-09' }, NOW);
    const day = await aiSpendingDay(f.db, f.actors.owner, { organizationId: 'org_proex', day: '2026-11-09' });
    for (const output of [JSON.stringify(period), JSON.stringify(day)]) {
      assert.equal(output.includes(PROMPT_CANARY), false, 'prompt nunca sai');
      assert.equal(output.includes(KEY_CANARY), false, 'chave nunca sai');
      assert.equal(output.includes('@example.test'), false, 'e-mail nunca sai');
      assert.equal(output.includes('<script>'), false);
      assert.equal(/"(?:prompt|apiKey|details|email|reply|actor_id|entity_id)"/.test(output), false);
    }
    assert.equal(period.today.byProvider.other.realUsdMicros, 400, 'provedor desconhecido vira "Outro"');
    const allowed = ['at', 'time', 'function', 'functionLabel', 'provider', 'providerLabel', 'model', 'realUsdMicros', 'ceilingUsdMicros', 'who'];
    for (const call of day.calls) assert.deepEqual(Object.keys(call).sort(), [...allowed].sort());
    const injected = day.calls.find(call => call.realUsdMicros === 400);
    assert.equal(injected.model, null); assert.equal(injected.provider, 'other'); assert.equal(injected.who, 'Pessoa da equipe', 'nome com @ é trocado');
    assert.deepEqual(Object.keys(day).sort(), ['calls', 'day', 'organizationId', 'total', 'truncated']);
    assert.deepEqual(Object.keys(period).sort(), ['dailyLimitUsdMicros', 'days', 'from', 'functions', 'organizationId', 'partial', 'providers', 'to', 'today', 'totals']);
  } finally { f.native.close(); }
});

test('lista do dia: hora e nome em Brasília, mais recentes primeiro, no máximo 200 e sem e-mail', async () => {
  const f = fixture();
  try {
    seed(f);
    const day = await aiSpendingDay(f.db, f.actors.owner, { organizationId: 'org_proex', day: '2026-11-09' });
    assert.equal(day.total, 3); assert.equal(day.truncated, false);
    assert.deepEqual(day.calls.map(call => call.time), ['10:00', '09:00', '00:00']);
    assert.equal(day.calls[0].functionLabel, 'Fotos'); assert.equal(day.calls[0].who, 'Pessoa da equipe');
    assert.equal(day.calls[1].who, 'Dona Sintética'); assert.equal(day.calls[1].providerLabel, 'DeepSeek'); assert.equal(day.calls[1].model, 'deepseek-flash');
    assert.equal(day.calls[1].realUsdMicros, 1200); assert.equal(day.calls[1].ceilingUsdMicros, 3000);
    const compare = (await aiSpendingDay(f.db, f.actors.owner, { organizationId: 'org_proex', day: '2026-11-07' })).calls.find(call => call.function === 'compare');
    assert.equal(compare.provider, 'mixed'); assert.equal(compare.providerLabel, 'DeepSeek + OpenAI'); assert.equal(compare.model, 'deepseek-flash, gpt-5.6-luna');
    const documents = (await aiSpendingDay(f.db, f.actors.owner, { organizationId: 'org_proex', day: '2026-11-07' })).calls.find(call => call.function === 'documents');
    assert.equal(documents.realUsdMicros, null); assert.equal(documents.ceilingUsdMicros, null);
    for (let index = 0; index < SPENDING_DAY_LIMIT + 5; index++) {
      f.audit('assistant.role.chat', { provider: 'groq', hasImage: false, reservedUsdMicros: 10, usdMicros: 5 }, new Date(Date.parse('2026-11-05T12:00:00.000Z') + index * 1000).toISOString(), { actor: 'viewer-qa' });
    }
    const busy = await aiSpendingDay(f.db, f.actors.owner, { organizationId: 'org_proex', day: '2026-11-05' });
    assert.equal(busy.calls.length, 200); assert.equal(busy.total, 205); assert.equal(busy.truncated, true);
    assert.equal(JSON.stringify(busy).includes('@'), false);
    const period = await aiSpending(f.db, f.actors.owner, { organizationId: 'org_proex', from: '2026-11-05', to: '2026-11-05' }, NOW);
    assert.equal(period.days[0].calls, 205, 'o resumo conta todas, mesmo com a lista limitada');
  } finally { f.native.close(); }
});
