import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Cartão do rascunho de demanda no chat do Rolê: confere, edita e só "Criar demanda" grava. Dados sintéticos.
// Objetos do vm têm outro protótipo: compare a forma em JSON.
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
function load(file, require, globals = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require, ...globals });
  return mod.exports;
}
const contracts = load('lib/follow-up/contracts.ts', () => ({ HttpError: Error }));
const draft = { organizationId: 'org_proex', projectId: 'project-a', projectName: 'Projeto A', title: 'Divulgar novo prazo de recurso', description: 'Publicar o aviso nas redes.', dueAt: '2026-11-20', priority: 'high', assigneeId: 'leitor-qa', assigneeName: 'Bruno Leitor', expiresAt: Date.now() + 60_000, signature: 'corpo.assinatura' };

function harness(answer) {
  let index = 0, tree, status;
  const slots = [], requests = [], statuses = [], changed = [], opened = [];
  const hooks = { useState(initial) { const key = index++; if (!(key in slots)) slots[key] = initial; return [slots[key], value => slots[key] = typeof value === 'function' ? value(slots[key]) : value]; }, useRef(initial) { const key = index++; return slots[key] ??= { current: initial }; } };
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const modules = {
    react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': { Check: () => null, ClipboardList: () => null },
    '@/lib/follow-up/contracts': contracts,
    './follow-up-api': { followupApi: async (query, body) => { requests.push({ query, body }); return typeof answer === 'function' ? answer(body) : answer; }, followupChanged: () => changed.push(true) },
    './role-assistant.module.css': new Proxy({}, { get: (_target, name) => String(name) }),
  };
  const card = load('components/portal/role-task-draft-card.tsx', name => modules[name], { crypto, Error, encodeURIComponent });
  const nodes = () => { const found = [], visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } found.push(node); visit(node.props?.children); }; visit(tree); return found; };
  const h = {
    requests, statuses, changed, opened, card,
    render() { index = 0; tree = card.default({ draft, status, onStatus: value => { statuses.push(value); status = value; }, onOpen: () => opened.push(true) }); },
    text: () => text(tree), nodes,
    button(label) { const found = nodes().find(node => node.type === 'button' && text(node) === label); assert.ok(found, label); return found; },
    field(label) { const found = nodes().find(node => node.type === 'label' && text(node.props.children[0]) === label); assert.ok(found, label); return found.props.children[1]; },
    async click(label) { h.button(label).props.onClick(); await tick(); await tick(); h.render(); },
  };
  h.render(); return h;
}

test('CARTÃO DO RASCUNHO: mostra projeto, aviso, campos editáveis e os dois botões', () => {
  const h = harness({ task: { id: 'task-nova' } });
  const shown = h.text();
  for (const expected of ['Rascunho de demanda', 'Projeto: ', 'Projeto A', 'Nada foi criado ainda. Confira e toque em Criar demanda.', 'Título', 'Descrição', 'Prazo', 'Prioridade', 'Responsável: Bruno Leitor', 'Criar demanda', 'Descartar']) assert.ok(shown.includes(expected), expected);
  assert.equal(h.nodes().find(node => node.type === 'strong').props.children, 'Projeto A', 'the destination project stands out');
  assert.equal(h.field('Título').props.value, draft.title);
  assert.equal(h.field('Prazo').props.type, 'date');
  assert.deepEqual(plain(h.field('Prioridade').props.children.map(option => text(option))), ['Alta', 'Média', 'Baixa']);
  assert.equal(h.field('Prioridade').props.value, 'high');
  assert.equal(h.requests.length, 0, 'nothing is sent before the tap');
  for (const forbidden of ['draft', 'token', 'payload', 'Draft']) assert.ok(!shown.includes(forbidden), forbidden);
});

test('CARTÃO DO RASCUNHO: Criar demanda envia o que está no cartão, uma vez, e vira "Demanda criada" com link', async () => {
  const h = harness({ task: { id: 'task-nova' } });
  h.field('Título').props.onChange({ target: { value: '  Divulgar prazo revisado  ' } }); h.render();
  h.field('Prazo').props.onChange({ target: { value: '' } }); h.render();
  h.field('Prioridade').props.onChange({ target: { value: 'low' } }); h.render();
  const assignee = h.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox');
  assignee.props.onChange({ target: { checked: false } }); h.render();
  const create = h.button('Criar demanda');
  create.props.onClick(); create.props.onClick();
  await tick(); await tick(); h.render();
  assert.equal(h.requests.length, 1, 'two taps, one request');
  const { body } = h.requests[0];
  assert.deepEqual(plain({ ...body, operationKey: undefined }), { action: 'task.create', projectId: 'project-a', title: 'Divulgar prazo revisado', body: 'Publicar o aviso nas redes.', priority: 'low', dueAt: null, userIds: [], roleDraft: 'corpo.assinatura' });
  assert.match(body.operationKey, /^[0-9a-f-]{36}$/);
  assert.deepEqual(plain(h.statuses), [{ createdId: 'task-nova' }]);
  assert.equal(h.changed.length, 1, 'the Demandas screen is told to refresh');
  const shown = h.text();
  assert.ok(shown.includes('Demanda criada') && shown.includes('Divulgar prazo revisado') && shown.includes('Abrir demanda'));
  assert.ok(!shown.includes('Criar demanda'), 'no second create button');
  const link = h.nodes().find(node => node.type === 'a');
  assert.equal(link.props.href, '/?module=demands&project=project-a&demandId=task-nova');
  link.props.onClick(); assert.equal(h.opened.length, 1);
});

test('CARTÃO DO RASCUNHO: erro mostra o texto do servidor, mantém o rascunho e repete a mesma chave', async () => {
  let fail = true;
  const h = harness(() => { if (fail) throw new Error('Seu acesso a este projeto ou organização mudou.'); return { task: { id: 'task-depois' } }; });
  h.field('Descrição').props.onChange({ target: { value: 'Texto ajustado.' } }); h.render();
  await h.click('Criar demanda');
  const alert = h.nodes().find(node => node.props?.role === 'alert');
  assert.equal(text(alert), 'Seu acesso a este projeto ou organização mudou. O rascunho continua aqui.');
  assert.equal(h.field('Descrição').props.value, 'Texto ajustado.', 'the draft stays');
  assert.equal(h.statuses.length, 0);
  fail = false;
  await h.click('Criar demanda');
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].body.operationKey, h.requests[1].body.operationKey, 'a retry reuses the key: never two tasks');
  assert.ok(h.text().includes('Demanda criada'));
});

test('CARTÃO DO RASCUNHO: Descartar não envia nada; formato estranho não vira cartão', async () => {
  const h = harness({ task: { id: 'x' } });
  await h.click('Descartar');
  assert.deepEqual(plain(h.statuses), [{ discarded: true }]);
  assert.equal(h.requests.length, 0);
  assert.equal(h.text(), 'Rascunho descartado. Nada foi criado.');
  const { roleTaskDraftFrom } = h.card;
  assert.ok(roleTaskDraftFrom(draft));
  for (const broken of [null, [], { ...draft, title: '' }, { ...draft, priority: 'urgente' }, { ...draft, dueAt: '20/11/2026' }, { ...draft, signature: undefined }, { ...draft, title: 'x'.repeat(161) }, { ...draft, assigneeId: 'id', assigneeName: undefined }]) assert.equal(roleTaskDraftFrom(broken), undefined);
  const { assigneeId: _id, assigneeName: _name, ...withoutAssignee } = draft; void _id; void _name;
  assert.ok(roleTaskDraftFrom(withoutAssignee));
});

test('CARTÃO DO RASCUNHO: o chat do Rolê mostra o cartão vindo da resposta e guarda o estado na mensagem', () => {
  const source = readFileSync(new URL('../components/portal/role-assistant.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('roleTaskDraftFrom(result.taskDraft)'), 'only a well-formed draft from the chat answer');
  assert.ok(/<RoleTaskDraftCard draft=\{message\.taskDraft\} status=\{message\.taskDraftStatus\}/.test(source));
  const css = readFileSync(new URL('../components/portal/role-assistant.module.css', import.meta.url), 'utf8');
  for (const name of ['operation', 'operationTitle', 'documentEditor', 'editable', 'help', 'videoConsent', 'reviseActions']) assert.ok(new RegExp(`\\.${name}\\b`).test(css), `existing class ${name}`);
});
