import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Rolê prepara rascunho de demanda; só o toque em "Criar demanda" grava, pela API de demandas.
// Dados 100% sintéticos. Nenhuma chamada sai da máquina: o provedor é falso.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  source = source.replace(/import\(['"](pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs)['"]\)/g, (_match, dependency) => `import(${JSON.stringify(import.meta.resolve(dependency))})`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-task-draft-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { DEFAULT_ASSISTANT_CONFIG, safeRequest } = await import(compile('assistant/contracts'));
const { configureAssistant } = await import(compile('assistant/service'));
const { manageAssistantCredential } = await import(compile('assistant/credential-vault'));
const { roleChat } = await import(compile('assistant/role'));
const { roleEstimate, roleConversationBytes, ROLE_SYSTEM_PROMPT_BYTES, ROLE_TOOLS_SCHEMA_BYTES } = await import(compile('assistant/role-contracts'));
const { runRoleTool, ROLE_TOOLS_ACTUAL_SCHEMA_BYTES } = await import(compile('assistant/role-tools'));
const { confirmRoleTaskDraft } = await import(compile('assistant/role-task-draft'));
const { signTaskDraft } = await import(compile('assistant/crypto'));

const secret = 'test-only-role-auth-secret-no-production-access';
const keys = { current: 'synthetic-only-independent-key-for-role-tests-000' };
const PROVIDER_KEY = 'sk-CANARIO-task-draft-synthetic-0000-ZZ99';

function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString();
  native.prepare("INSERT INTO projects(id,name,description,scope,organization_id,created_at) VALUES('project-a','Projeto A','','external','org_proex',?),('project-b','Projeto B','','external','org_proex',?)").run(now, now);
  const actors = {};
  // owner: administração geral; editor: equipe do Projeto A; leitor: bolsista só leitura; outsider: só Projeto B.
  for (const [key, role, project, name] of [['owner', 'owner', null, 'Coordenação QA'], ['editor', 'inventory', 'project-a', 'Ana Souza'], ['leitor', 'viewer', 'project-a', 'Bruno Leitor'],
    ['outsider', 'inventory', 'project-b', 'Carla Externa'], ['dani1', 'viewer', 'project-a', 'Dani Lima'], ['dani2', 'viewer', 'project-a', 'Dani Rocha']]) {
    const userId = `${key}-qa`, email = `${key}@example.test`;
    native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
    native.prepare('INSERT INTO profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run(userId, name, now, now);
    native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(userId, userId, email, role, project, now);
    actors[key] = { userId, email, displayName: name, capabilities: [], members: [{ id: userId, user_id: userId, email, role, project_id: project, revoked_at: null, created_at: now }] };
  }
  const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  return { native, db, actors, tasks: () => native.prepare('SELECT COUNT(*) n FROM followup_tasks').get().n };
}
async function setup(f) {
  const vault = await manageAssistantCredential(f.db, f.actors.owner, { action: 'save', organizationId: 'org_proex', provider: 'deepseek', expectedRevision: 0, label: 'Chave deepseek de teste', secret: PROVIDER_KEY }, secret, keys);
  await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: vault.revision, config: { ...DEFAULT_ASSISTANT_CONFIG, usageScope: 'organization', roleEnabled: true } }, secret, undefined, keys);
}
function scriptedProvider(steps) {
  const calls = [];
  return { calls, fetch: async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    const message = step.tools ? { content: '', tool_calls: step.tools.map((tool, index) => ({ id: `call-${calls.length}-${index}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } })) } : { content: JSON.stringify(step.reply) };
    return Response.json({ model: body.model, choices: [{ finish_reason: step.tools ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 1500, completion_tokens: 90 } });
  } };
}
function chatInput(message) {
  const estimate = roleEstimate({ textProvider: 'deepseek', textBytes: roleConversationBytes([], safeRequest(message), 'Projeto A'), hasImage: false, tools: true });
  return { action: 'chat', projectId: 'project-a', operationKey: `role-draft-${Math.random().toString(36).slice(2, 12)}`, consent: true, message, acceptedCostMicros: estimate.costMicros };
}
const draftArgs = (extra = {}) => ({ projeto: 'Projeto A', titulo: 'Divulgar novo prazo de recurso', descricao: 'Publicar o aviso do novo prazo nas redes do projeto.', prazo: '2026-11-20', prioridade: 'alta', ...extra });
const payload = result => JSON.parse(result.content);
const confirmInput = (draft, extra = {}) => ({ action: 'task.create', projectId: draft.projectId, title: draft.title, body: draft.description, priority: draft.priority, dueAt: draft.dueAt, userIds: draft.assigneeId ? [draft.assigneeId] : [], operationKey: 'draft-confirm-0001', roleDraft: draft.signature, ...extra });

test('RASCUNHO DE DEMANDA: quem pode criar recebe rascunho normalizado no chat; nada é gravado antes do toque', async () => {
  const f = fixture();
  try {
    await setup(f);
    const before = f.tasks();
    const provider = scriptedProvider([
      { tools: [{ name: 'preparar_rascunho_demanda', args: draftArgs({ titulo: '  Divulgar   novo prazo\nde recurso do PROBEC ', responsavel: 'bruno leitor' }) }] },
      { reply: { reply: 'Preparei o rascunho. Confira no cartão e toque em Criar demanda.', operation: null } },
    ]);
    const answer = await roleChat(f.db, f.actors.editor, chatInput('Prepare um rascunho de demanda para divulgar o novo prazo de recurso do PROBEC, para o Bruno, até 20/11.'), secret, { keys, fetcher: provider.fetch });
    assert.equal(provider.calls[0].tools.some(tool => tool.function.name === 'preparar_rascunho_demanda'), true, 'the tool is offered');
    const draft = answer.taskDraft;
    assert.ok(draft, 'the chat answer carries the draft next to sources');
    assert.deepEqual({ projectId: draft.projectId, projectName: draft.projectName, title: draft.title, dueAt: draft.dueAt, priority: draft.priority, assigneeId: draft.assigneeId, assigneeName: draft.assigneeName },
      { projectId: 'project-a', projectName: 'Projeto A', title: 'Divulgar novo prazo de recurso do PROBEC', dueAt: '2026-11-20', priority: 'high', assigneeId: 'leitor-qa', assigneeName: 'Bruno Leitor' });
    assert.match(draft.signature, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(draft.expiresAt > Date.now() && draft.expiresAt <= Date.now() + 31 * 60_000, 'short validity');
    const tool = provider.calls[1].messages.find(message => message.role === 'tool').content;
    assert.ok(tool.includes('Nada foi gravado') && tool.includes('Bruno Leitor'), 'the model gets a short summary');
    for (const hidden of [draft.signature, 'leitor-qa', '@example.test', 'expiresAt']) assert.ok(!tool.includes(hidden), `never sent to the model: ${hidden}`);
    assert.equal(f.tasks(), before, 'no task row before the confirmation');
    const details = JSON.parse(f.native.prepare("SELECT details FROM audit WHERE action='assistant.role.chat'").get().details);
    assert.deepEqual(details.tools, [{ name: 'preparar_rascunho_demanda', rows: 1 }]);
    assert.ok(!JSON.stringify(details).includes('PROBEC'), 'audit keeps the tool name, never the text');
  } finally { f.native.close(); }
});

test('RASCUNHO DE DEMANDA: bolsista leitor e pessoa de outro projeto não recebem rascunho; outra organização e escopo fechado são recusados', async () => {
  const f = fixture();
  try {
    const reader = await runRoleTool(f.db, f.actors.leitor, 'org_proex', 'preparar_rascunho_demanda', draftArgs());
    assert.equal(reader.taskDraft, undefined);
    assert.match(payload(reader).observacao, /^Você não pode criar demandas neste projeto\./);
    const outsider = await runRoleTool(f.db, f.actors.outsider, 'org_proex', 'preparar_rascunho_demanda', draftArgs());
    assert.equal(outsider.taskDraft, undefined, 'naming a project the person does not see opens nothing');
    assert.match(payload(outsider).observacao, /Nenhum rascunho foi preparado/);
    const narrowed = await runRoleTool(f.db, f.actors.owner, 'org_proex', 'preparar_rascunho_demanda', draftArgs(), undefined, { kind: 'project', id: 'project-b', label: 'Projeto B', projectIds: ['project-b'] });
    assert.equal(narrowed.taskDraft, undefined, 'a project outside the conversation scope is refused');
    const now = new Date().toISOString();
    f.native.prepare("INSERT INTO organizations(id,name,slug,status,created_at,updated_at) VALUES('org_outra','Outra organização','outra-qa','active',?,?)").run(now, now);
    f.native.prepare("INSERT INTO projects(id,name,description,scope,organization_id,created_at) VALUES('project-c','Projeto C','','external','org_outra',?)").run(now);
    const crossOrg = await runRoleTool(f.db, f.actors.owner, 'org_proex', 'preparar_rascunho_demanda', draftArgs({ projeto: 'Projeto C' }));
    assert.equal(crossOrg.taskDraft, undefined, 'a project of another organization never becomes a draft here');
    const ambiguous = await runRoleTool(f.db, f.actors.owner, 'org_proex', 'preparar_rascunho_demanda', draftArgs({ projeto: undefined }));
    assert.equal(ambiguous.taskDraft, undefined, 'without a clear project, the Rolê asks');
    assert.deepEqual(payload(ambiguous).projetos, ['Projeto A', 'Projeto B']);
  } finally { f.native.close(); }
});

test('RASCUNHO DE DEMANDA: responsável só entre quem a criação aceitaria no projeto; de outro projeto ou ambíguo fica vazio', async () => {
  const f = fixture();
  try {
    const other = await runRoleTool(f.db, f.actors.editor, 'org_proex', 'preparar_rascunho_demanda', draftArgs({ responsavel: 'Carla' }));
    assert.equal(other.taskDraft.assigneeId, undefined);
    assert.ok(!other.content.includes('outsider-qa') && !other.content.includes('Externa'), 'a person of another project is neither resolved nor revealed');
    assert.ok(payload(other).avisos.some(note => note.includes('não encontrei') || note.includes('Não encontrei')));
    const tie = await runRoleTool(f.db, f.actors.editor, 'org_proex', 'preparar_rascunho_demanda', draftArgs({ responsavel: 'Dani' }));
    assert.equal(tie.taskDraft.assigneeId, undefined);
    assert.ok(payload(tie).avisos.some(note => note.includes('mais de uma pessoa')));
    assert.ok(!tie.content.includes('Lima') && !tie.content.includes('Rocha'), 'the tie does not list people');
    const exact = await runRoleTool(f.db, f.actors.editor, 'org_proex', 'preparar_rascunho_demanda', draftArgs({ responsavel: 'Dani Rocha' }));
    assert.equal(exact.taskDraft.assigneeId, 'dani2-qa');
    assert.ok(!exact.content.includes('dani2-qa'), 'the identifier stays out of the model');
  } finally { f.native.close(); }
});

test('RASCUNHO DE DEMANDA: tamanhos, data e prioridade são normalizados; título vazio e projeto longo são recusados', async () => {
  const f = fixture();
  try {
    const result = await runRoleTool(f.db, f.actors.editor, 'org_proex', 'preparar_rascunho_demanda', draftArgs({ titulo: 'T'.repeat(300), descricao: `Linha 1\n${'d'.repeat(5000)}\u0007`, prazo: '2026-02-30', prioridade: 'urgente' }));
    const draft = result.taskDraft;
    assert.equal(draft.title.length, 160);
    assert.equal(draft.description.length, 4000);
    assert.ok(draft.description.startsWith('Linha 1\n') && !draft.description.includes('\u0007'));
    assert.equal(draft.dueAt, null);
    assert.equal(draft.priority, 'medium');
    const notes = payload(result).avisos.join(' ');
    for (const expected of ['160 caracteres', '4.000 caracteres', 'não é uma data válida', 'Prioridade inválida']) assert.ok(notes.includes(expected), expected);
    assert.ok(new TextEncoder().encode(result.content).byteLength <= 8000, 'the summary fits the lookup budget');
    assert.equal((await runRoleTool(f.db, f.actors.editor, 'org_proex', 'preparar_rascunho_demanda', draftArgs({ prioridade: 'baixa', prazo: undefined }))).taskDraft.priority, 'low');
    await assert.rejects(runRoleTool(f.db, f.actors.editor, 'org_proex', 'preparar_rascunho_demanda', draftArgs({ titulo: '   ' })), error => error.code === 'role_tool_input');
    await assert.rejects(runRoleTool(f.db, f.actors.editor, 'org_proex', 'preparar_rascunho_demanda', draftArgs({ projeto: 'P'.repeat(121) })), error => error.code === 'role_tool_input');
    await assert.rejects(runRoleTool(f.db, f.actors.editor, 'org_proex', 'preparar_rascunho_demanda', draftArgs({ gravar: true })), error => error.code === 'role_tool_input');
    assert.ok(ROLE_TOOLS_ACTUAL_SCHEMA_BYTES <= ROLE_TOOLS_SCHEMA_BYTES, 'schema fits the cost ceiling');
    const { ROLE_SYSTEM_PROMPT_TOOLS } = await import(compile('assistant/role-contracts'));
    assert.ok(ROLE_SYSTEM_PROMPT_TOOLS.includes('preparar_rascunho_demanda'));
    assert.ok(new TextEncoder().encode(JSON.stringify(ROLE_SYSTEM_PROMPT_TOOLS)).byteLength + 200 <= ROLE_SYSTEM_PROMPT_BYTES, 'tools prompt fits the cost ceiling');
  } finally { f.native.close(); }
});

test('RASCUNHO DE DEMANDA: Criar demanda usa a API de demandas, uma vez por chave; a API confere permissão e assinatura', async () => {
  const f = fixture();
  try {
    await setup(f);
    const provider = scriptedProvider([{ tools: [{ name: 'preparar_rascunho_demanda', args: draftArgs({ responsavel: 'Bruno Leitor' }) }] }, { reply: { reply: 'Rascunho pronto.', operation: null } }]);
    const { taskDraft: draft } = await roleChat(f.db, f.actors.editor, chatInput('Crie uma demanda para divulgar o prazo.'), secret, { keys, fetcher: provider.fetch });
    const before = f.tasks();
    // A pessoa editou o título no cartão: vale o que está no cartão.
    const created = await confirmRoleTaskDraft(f.db, f.actors.editor, confirmInput(draft, { title: 'Divulgar prazo de recurso (revisado)' }), secret);
    assert.equal(f.tasks(), before + 1);
    assert.equal(created.task.title, 'Divulgar prazo de recurso (revisado)');
    assert.equal(created.task.project_id, 'project-a');
    assert.equal(created.task.priority, 'high');
    assert.deepEqual(created.task.assignees.map(entry => entry.user_id), ['leitor-qa']);
    const again = await confirmRoleTaskDraft(f.db, f.actors.editor, confirmInput(draft, { title: 'Divulgar prazo de recurso (revisado)' }), secret);
    assert.equal(again.duplicate, true);
    assert.equal(again.task.id, created.task.id);
    assert.equal(f.tasks(), before + 1, 'a second tap with the same key does not duplicate');
    // Assinatura de outra pessoa, vencida ou de outro projeto: recusada antes de gravar.
    await assert.rejects(confirmRoleTaskDraft(f.db, f.actors.owner, confirmInput(draft, { operationKey: 'draft-confirm-0002' }), secret), error => error.code === 'role_task_draft_invalid');
    await assert.rejects(confirmRoleTaskDraft(f.db, f.actors.editor, confirmInput(draft, { operationKey: 'draft-confirm-0003' }), secret, draft.expiresAt + 1), error => error.code === 'role_task_draft_invalid');
    await assert.rejects(confirmRoleTaskDraft(f.db, f.actors.editor, confirmInput(draft, { operationKey: 'draft-confirm-0004', projectId: 'project-b' }), secret), error => error.code === 'role_task_draft_invalid');
    await assert.rejects(confirmRoleTaskDraft(f.db, f.actors.editor, confirmInput(draft, { operationKey: 'draft-confirm-0005', roleDraft: `${draft.signature}x` }), secret), error => error.code === 'role_task_draft_invalid');
    // Mesmo com assinatura válida para si, quem não pode criar demandas recebe a recusa da própria API.
    const readerToken = await signTaskDraft(secret, { actorId: 'leitor-qa', organizationId: 'org_proex', projectId: 'project-a', digest: 'sintetico', expiresAt: Date.now() + 60_000 });
    await assert.rejects(confirmRoleTaskDraft(f.db, f.actors.leitor, confirmInput(draft, { operationKey: 'draft-confirm-0006', roleDraft: readerToken, userIds: [] }), secret), error => error.status === 403);
    await assert.rejects(confirmRoleTaskDraft(f.db, f.actors.editor, { ...confirmInput(draft, { operationKey: 'draft-confirm-0007' }), action: 'task.update' }, secret), error => error.code === 'followup_action');
    await assert.rejects(confirmRoleTaskDraft(f.db, f.actors.editor, confirmInput(draft, { operationKey: 'draft-confirm-0008' }), undefined), error => error.status === 503);
    assert.equal(f.tasks(), before + 1);
  } finally { f.native.close(); }
});
