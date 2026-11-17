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
const base = { organizationId: 'org_proex', projectId: 'project-a', projectName: 'Projeto A', title: 'Divulgar novo prazo de recurso', description: 'Publicar o aviso nas redes.', dueAt: '2026-11-20', priority: 'high', assigneeId: 'leitor-qa', assigneeName: 'Bruno Leitor', expiresAt: Date.now() + 60_000, signature: 'corpo.assinatura' };
const failure = (message, code) => Object.assign(new Error(message), code ? { code } : {});

function harness(answer, draft = base, initialStatus) {
  let index = 0, tree, status = initialStatus;
  const slots = [], effects = [], requests = [], statuses = [], changed = [], opened = [], focused = [];
  const hooks = {
    useState(initial) { const key = index++; if (!(key in slots)) slots[key] = initial; return [slots[key], value => slots[key] = typeof value === 'function' ? value(slots[key]) : value]; },
    useRef(initial) { const key = index++; return slots[key] ??= { current: initial }; },
    useEffect(run, deps) { const key = index++, previous = slots[key]; if (!previous || deps.some((dep, at) => dep !== previous[at])) effects.push(run); slots[key] = deps; },
  };
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const modules = {
    react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': { Check: () => null, ClipboardList: () => null },
    '@/lib/follow-up/contracts': contracts,
    './follow-up-api': { followupApi: async (query, body) => { requests.push({ query, body }); return typeof answer === 'function' ? answer(body) : answer; }, followupChanged: () => changed.push(true) },
    './role-assistant.module.css': (() => { const css = new Proxy({}, { get: (_target, name) => name === 'default' ? css : String(name) }); return css; })(),
  };
  const card = load('components/portal/role-task-draft-card.tsx', name => modules[name], { crypto, Error, encodeURIComponent });
  const nodes = () => { const found = [], visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } found.push(node); visit(node.props?.children); }; visit(tree); return found; };
  const h = {
    requests, statuses, changed, opened, focused, card, status: () => status,
    render() {
      index = 0; effects.length = 0;
      tree = card.default({ draft, status, onStatus: value => { statuses.push(value); status = value; }, onOpen: () => opened.push(true) });
      // O DOM falso: cada ref recebe um elemento que registra o foco.
      for (const node of nodes()) if (node.props?.ref && typeof node.props.ref === 'object') node.props.ref.current = { focus: () => focused.push(text(node)) };
      for (const run of effects.splice(0)) run();
    },
    text: () => text(tree), nodes,
    button(label) { const found = nodes().find(node => node.type === 'button' && text(node) === label); assert.ok(found, label); return found; },
    field(label) { const found = nodes().find(node => node.type === 'label' && text(node.props.children[0]) === label); assert.ok(found, label); return found.props.children[1]; },
    checkbox: () => nodes().find(node => node.type === 'input' && node.props.type === 'checkbox'),
    alert: () => nodes().find(node => node.props?.role === 'alert'),
    async click(label) { h.button(label).props.onClick(); await tick(); await tick(); h.render(); },
  };
  h.render(); return h;
}

test('CARTÃO DO RASCUNHO: mostra projeto, aviso, validade, campos editáveis e os dois botões; responsável começa desmarcado', () => {
  const h = harness({ task: { id: 'task-nova' } });
  const shown = h.text();
  for (const expected of ['Rascunho de demanda', 'Projeto: ', 'Projeto A', 'Nada foi criado ainda. Confira os campos e escolha Criar demanda.', 'Este rascunho vale por 30 minutos.', 'Título', 'Descrição', 'Prazo', 'Prioridade', 'Responsável: Bruno Leitor', 'Criar demanda', 'Descartar']) assert.ok(shown.includes(expected), expected);
  assert.equal(text(h.nodes().find(node => node.type === 'strong' && text(node).startsWith('Nada'))), 'Nada foi criado ainda.');
  assert.ok(h.nodes().some(node => node.type === 'strong' && node.props.children === 'Projeto A'), 'the destination project stands out');
  assert.ok(!shown.includes('Preparado depois de ler'), 'no injection warning when only the draft tool ran');
  const title = h.field('Título');
  assert.equal(title.type, 'textarea'); assert.equal(title.props.rows, 2); assert.equal(title.props.maxLength, 160); assert.equal(title.props.value, base.title);
  let blocked = false; title.props.onKeyDown({ key: 'Enter', preventDefault: () => { blocked = true; } }); assert.ok(blocked, 'Enter does not break the title');
  title.props.onChange({ target: { value: 'Linha um\nlinha dois' } }); h.render(); assert.equal(h.field('Título').props.value, 'Linha um linha dois');
  assert.equal(h.field('Descrição').props.className, 'taskDraftBody');
  assert.equal(h.field('Prazo').props.type, 'date');
  assert.deepEqual(plain(h.field('Prioridade').props.children.map(option => text(option))), ['Alta', 'Média', 'Baixa']);
  assert.equal(h.checkbox().props.checked, false, 'the assignee only goes in if the person ticks it');
  assert.equal(h.requests.length, 0, 'nothing is sent before the tap');
  for (const forbidden of ['draft', 'token', 'payload', 'Draft']) assert.ok(!shown.includes(forbidden), forbidden);
});

test('CARTÃO DO RASCUNHO: depois de ler outro conteúdo, o cartão avisa para conferir links e responsável', () => {
  const h = harness({ task: { id: 'x' } }, { ...base, afterUntrusted: true });
  const notice = h.nodes().find(node => node.type === 'p' && text(node).startsWith('Preparado depois'));
  assert.equal(text(notice), 'Preparado depois de ler conteúdo do portal ou da internet. Confira links e responsável antes de criar.');
  assert.equal(h.checkbox().props.checked, false);
});

test('CARTÃO DO RASCUNHO: Criar demanda envia o que está no cartão, uma vez, e vira "Demanda criada" com foco no link', async () => {
  const h = harness({ task: { id: 'task-nova' } });
  h.field('Título').props.onChange({ target: { value: '  Divulgar prazo revisado  ' } }); h.render();
  h.field('Prazo').props.onChange({ target: { value: '' } }); h.render();
  h.field('Prioridade').props.onChange({ target: { value: 'low' } }); h.render();
  h.checkbox().props.onChange({ target: { checked: true } }); h.render();
  const create = h.button('Criar demanda');
  create.props.onClick(); create.props.onClick();
  await tick(); await tick(); h.render();
  assert.equal(h.requests.length, 1, 'two taps, one request');
  const { body } = h.requests[0];
  assert.deepEqual(plain({ ...body, operationKey: undefined }), { action: 'task.create', projectId: 'project-a', title: 'Divulgar prazo revisado', body: 'Publicar o aviso nas redes.', priority: 'low', dueAt: null, userIds: ['leitor-qa'], roleDraft: 'corpo.assinatura' });
  assert.match(body.operationKey, /^[0-9a-f-]{36}$/);
  const saved = plain(h.status());
  assert.equal(saved.createdId, 'task-nova');
  assert.equal(saved.operationKey, body.operationKey);
  assert.deepEqual({ title: saved.title, dueAt: saved.dueAt, priority: saved.priority, keepAssignee: saved.keepAssignee }, { title: '  Divulgar prazo revisado  ', dueAt: '', priority: 'low', keepAssignee: true });
  assert.equal(h.changed.length, 1, 'the Demandas screen is told to refresh');
  const shown = h.text();
  assert.ok(shown.includes('Demanda criada') && shown.includes('Divulgar prazo revisado') && shown.includes('Abrir demanda'));
  assert.ok(!shown.includes('Criar demanda'), 'no second create button');
  const link = h.nodes().find(node => node.type === 'a');
  assert.equal(link.props.href, '/?module=demands&project=project-a&demandId=task-nova');
  assert.equal(link.props.className, 'p-button p-button-subtle taskDraftOpen');
  assert.deepEqual(plain(h.focused), ['Abrir demanda'], 'focus moves to the new task link');
  link.props.onClick(); assert.equal(h.opened.length, 1);
});

test('CARTÃO DO RASCUNHO: erro usa o estilo de erro, trava os campos e repete a mesma chave', async () => {
  let fail = true;
  const h = harness(() => { if (fail) throw failure('Seu acesso a este projeto ou organização mudou.', 'followup_forbidden'); return { task: { id: 'task-depois' } }; });
  h.field('Descrição').props.onChange({ target: { value: 'Texto ajustado.' } }); h.render();
  await h.click('Criar demanda');
  assert.equal(text(h.alert()), 'Seu acesso a este projeto ou organização mudou. O rascunho continua aqui. Os campos ficam travados para a nova tentativa não criar a demanda em dobro.');
  assert.equal(h.alert().props.className, 'error');
  assert.equal(h.field('Descrição').props.value, 'Texto ajustado.', 'the draft stays');
  for (const label of ['Título', 'Descrição', 'Prazo', 'Prioridade']) assert.equal(h.field(label).props.disabled, true, `${label} locked after the first tap`);
  assert.equal(h.status().createdId, undefined);
  fail = false;
  await h.click('Criar demanda');
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].body.operationKey, h.requests[1].body.operationKey, 'a retry reuses the key: never two tasks');
  assert.ok(h.text().includes('Demanda criada'));
});

test('CARTÃO DO RASCUNHO: rascunho vencido ou chave já usada não convida a criar de novo', async () => {
  for (const code of ['role_task_draft_invalid', 'operation_changed']) {
    const h = harness(() => { throw failure('mensagem do servidor', code); });
    await h.click('Criar demanda');
    const alert = h.alert();
    assert.equal(text(alert), 'A demanda pode já ter sido criada. Confira em Demandas antes de criar de novo.');
    assert.equal(alert.props.className, 'error');
    const link = h.nodes().find(node => node.type === 'a');
    assert.equal(text(link), 'Abrir Demandas do projeto');
    assert.equal(link.props.href, '/?module=demands&project=project-a');
    assert.equal(link.props.className, 'p-button p-button-subtle taskDraftOpen', 'a discreet button, apart from the paragraph');
    assert.equal(h.button('Criar demanda').props.disabled, true, code);
  }
});

test('CARTÃO DO RASCUNHO: Descartar não envia nada, anuncia e recebe o foco; formato estranho não vira cartão', async () => {
  const h = harness({ task: { id: 'x' } });
  await h.click('Descartar');
  assert.equal(h.status().discarded, true);
  assert.equal(h.requests.length, 0);
  const note = h.nodes()[0];
  assert.equal(h.text(), 'Rascunho descartado. Nada foi criado.');
  assert.equal(note.props.role, 'status'); assert.equal(note.props.tabIndex, -1);
  assert.deepEqual(plain(h.focused), ['Rascunho descartado. Nada foi criado.']);
  const { roleTaskDraftFrom } = h.card;
  assert.ok(roleTaskDraftFrom(base) && roleTaskDraftFrom({ ...base, afterUntrusted: true }));
  for (const broken of [null, [], { ...base, title: '' }, { ...base, priority: 'urgente' }, { ...base, dueAt: '20/11/2026' }, { ...base, signature: undefined }, { ...base, title: 'x'.repeat(161) }, { ...base, assigneeId: 'id', assigneeName: undefined }, { ...base, afterUntrusted: 'sim' }]) assert.equal(roleTaskDraftFrom(broken), undefined);
  const { assigneeId: _id, assigneeName: _name, ...withoutAssignee } = base; void _id; void _name;
  assert.ok(roleTaskDraftFrom(withoutAssignee));
});

test('CARTÃO DO RASCUNHO: chat usa o cartão; estilos do cartão ficam no CSS do Rolê (ícone na linha, contraste, foco, escuro)', () => {
  const source = readFileSync(new URL('../components/portal/role-assistant.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('roleTaskDraftFrom(result.taskDraft)'), 'only a well-formed draft from the chat answer');
  assert.ok(/<RoleTaskDraftCard draft=\{message\.taskDraft\} status=\{message\.taskDraftStatus\}/.test(source));
  const css = readFileSync(new URL('../components/portal/role-assistant.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.operationTitle\{display:flex;align-items:center;gap:\.4rem;/);
  assert.match(css, /\.taskDraft\{--task-draft-border:#8a7a99\}/);
  assert.match(css, /html\[data-theme=dark\]\) \.taskDraft\{--task-draft-border:#a58fbb\}/);
  assert.match(css, /\.taskDraft textarea\.taskDraftBody\{field-sizing:content;[^}]*max-height:14rem/);
  assert.match(css, /\.taskDraft input:focus-visible,[^{]*\.taskDraft button:focus-visible[^{]*\{outline:3px solid var\(--focus\)/);
  assert.match(css, /html\[data-theme=dark\]\) \.taskDraft input\[type=checkbox\]\{accent-color:#b48ad6\}/);
  assert.match(css, /\.taskDraft :global\(\.p-button-subtle\)\{border:1px solid var\(--task-draft-border\)\}/);
  assert.match(css, /\.taskDraft \.taskDraftOpen\{[^}]*font-size:max\(14px/);
  for (const name of ['operation', 'documentEditor', 'editable', 'help', 'videoConsent', 'reviseActions', 'error', 'searchOnlyNotice']) assert.ok(new RegExp(`\\.${name}\\b`).test(css), `existing class ${name}`);
});

test('CARTÃO DO RASCUNHO: remontar com o estado guardado na mensagem mantém trava, aviso, chave e edições', async () => {
  // Erro comum: campos travados e chave guardada; a conversa recarrega e o cartão volta igual.
  const first = harness(() => { throw failure('Falha de rede.', 'network'); });
  first.field('Título').props.onChange({ target: { value: 'Título editado' } }); first.render();
  first.checkbox().props.onChange({ target: { checked: true } }); first.render();
  await first.click('Criar demanda');
  const saved = plain(first.status());
  assert.equal(saved.title, 'Título editado'); assert.equal(saved.keepAssignee, true); assert.match(saved.operationKey, /^[0-9a-f-]{36}$/);
  const again = harness({ task: { id: 'task-uma' } }, base, saved);
  assert.equal(again.field('Título').props.value, 'Título editado', 'edits survive');
  assert.equal(again.field('Título').props.disabled, true, 'fields stay locked');
  assert.equal(again.checkbox().props.checked, true);
  await again.click('Criar demanda');
  assert.equal(again.requests[0].body.operationKey, saved.operationKey, 'same key after remount: never a second task');
  assert.deepEqual(plain(again.requests[0].body.userIds), ['leitor-qa']);
  // "Talvez criada": depois de remontar, o aviso continua e Criar segue desativado.
  const maybe = harness(() => { throw failure('mensagem do servidor', 'role_task_draft_invalid'); });
  await maybe.click('Criar demanda');
  const remounted = harness({ task: { id: 'x' } }, base, plain(maybe.status()));
  assert.ok(remounted.text().includes('A demanda pode já ter sido criada.'));
  assert.equal(remounted.button('Criar demanda').props.disabled, true);
  assert.equal(remounted.field('Descrição').props.disabled, true);
  assert.equal(remounted.requests.length, 0);
  // Criada ou descartada continuam assim.
  assert.ok(harness({}, base, { createdId: 'task-uma', operationKey: saved.operationKey }).text().includes('Demanda criada'));
  assert.equal(harness({}, base, { discarded: true }).text(), 'Rascunho descartado. Nada foi criado.');
});

test('CARTÃO DO RASCUNHO: a recarga depois de cada resposta não desmonta a conversa', () => {
  const source = readFileSync(new URL('../components/portal/role-assistant.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('const loadStatus = useCallback(async (id: string, options?: { keep?: boolean }) => {'));
  assert.ok(source.includes('if (!options?.keep) setStatus(null);'));
  assert.ok(source.includes("if (reply.operation && status.operationsAvailable) void locateOperation(reply);\n      void loadStatus(projectId, { keep: true });"), 'send() keeps the conversation mounted');
  assert.ok(source.includes("if (previousMode.current === 'chat' && nextMode !== 'chat') resetConversation();"), 'leaving chat mode still clears the conversation (PR 187)');
  const css = readFileSync(new URL('../components/portal/role-assistant.module.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.taskDraft .reviseActions :global(.p-button){font-size:max(14px,.9rem)}'));
});
