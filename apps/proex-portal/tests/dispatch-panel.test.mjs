import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Painel de Despachos (17/11/2026): dados sintéticos, sem nomes reais.
const source = readFileSync(new URL('../components/portal/dispatch-panel.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const tick = () => new Promise(resolve => setImmediate(resolve));
const task = (id, values = {}) => ({ id, title: `Demanda ${id}`, status: 'open', dueAt: '2026-11-20', version: 1, updatedAt: '2026-11-17T10:00:00Z', isAuthor: true, visibility: 'participants', kind: 'signature', documentKind: 'term', holderUserId: 'chief', holderName: 'Pessoa Chefia', documentRef: '', urgency: 'high', onAgenda: false, ...values });
const workspace = (withUserId) => ({ organizationId: 'org-a', withUserId, group: false, inLeadership: false, today: '2026-11-17',
  counts: { open: 3, needsCounterpart: 2, dueSoon: 1, overdue: 0 },
  people: [{ userId: 'chief', name: 'Pessoa Chefia', inLeadership: true }, { userId: 'peer', name: 'Pessoa Colega', inLeadership: false }],
  tasks: [task('a'), task('b', { kind: 'question', onAgenda: true }), task('c', { status: 'completed' }), task('d', { kind: 'decision' })] });

function harness() {
  const slots = [], effects = [], requests = []; let index = 0, tree, dirty = false;
  const same = (a, b) => a && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = index++, old = slots[i]; if (!old || !same(old.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect(fn, deps) { const i = index++, old = slots[i]; if (!old || !same(old.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props) => (typeof type === 'function' && type.name !== 'DateField' ? type(props) : { type, props });
  const api = { loadDispatchWorkspace: async query => { requests.push(query); return workspace(query.withUserId ?? null); }, loadDispatchDetail: async () => ({ task: {} }), saveDispatch: async () => ({ taskId: 'new' }) };
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, Promise, AbortController, Map, crypto,
    require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'Fragment' } : name === './dispatch-api' ? api : name.endsWith('.css') ? { default: new Proxy({}, { get: (_t, key) => String(key) }) } : name === './date-field' ? { default: function DateField() { return null; } } : new Proxy({}, { get: (_t, key) => key === 'default' ? 'Component' : String(key) }) });
  const h = {
    module: mod.exports, requests,
    render() { let guard = 0; do { dirty = false; index = 0; tree = mod.exports.default({ userId: 'staff', organizations: [{ id: 'org-a', name: 'Organização A' }] }); } while (dirty && ++guard < 8); },
    async settle() { for (let round = 0; round < 4; round++) { h.render(); effects.splice(0).forEach(effect => effect()); await tick(); } h.render(); },
    nodes() { const out = []; const walk = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); out.push(node); walk(node.props?.children); }; walk(tree); return out; },
    body() { return text(tree); },
  };
  return h;
}

test('tabs split open work by kind, Pauta by the agenda flag and Histórico by completion', () => {
  const h = harness();
  const tasks = workspace(null).tasks;
  assert.deepEqual(h.module.visibleTasks(tasks, 'open').map(t => t.id), ['a', 'b', 'd']);
  assert.deepEqual(h.module.visibleTasks(tasks, 'question').map(t => t.id), ['b']);
  assert.deepEqual(h.module.visibleTasks(tasks, 'agenda').map(t => t.id), ['b']);
  assert.deepEqual(h.module.visibleTasks(tasks, 'history').map(t => t.id), ['c']);
});

test('choosing a person names the counter, and "Nova demanda" starts private with that person included', async () => {
  const h = harness();
  await h.settle();
  assert.match(h.body(), /Estão com você/);
  h.nodes().find(node => node.type === 'select' && node.props.name === 'dispatchWith').props.onChange({ target: { value: 'chief' } });
  await h.settle();
  assert.equal(h.requests.at(-1).withUserId, 'chief');
  assert.match(h.body(), /Precisam de Pessoa Chefia/);
  h.nodes().find(node => node.type === 'button' && text(node).includes('Nova demanda')).props.onClick();
  await h.settle();
  const radio = h.nodes().find(node => node.type === 'input' && node.props.name === 'dispatchVisibility' && node.props.value === 'participants');
  assert.equal(radio.props.checked, true, '"Só as pessoas escolhidas" vem marcado');
  assert.ok(h.nodes().some(node => node.type === 'ul' && node.props['aria-label'] === 'Pessoas incluídas' && text(node).includes('Pessoa Chefia')), 'a outra pessoa já vem incluída');
  assert.match(h.body(), /nem a administração geral/);
  assert.match(h.body(), /Quem administra o banco de dados tecnicamente pode ler/, 'limite honesto na tela');
});

test('visual fixes from the 17/11 critique: one title, short options, wrapping tabs and spacing around the group card', () => {
  const css = readFileSync(new URL('../components/portal/dispatch-panel.module.css', import.meta.url), 'utf8');
  assert.match(source, /<Lock size=\{18\} aria-hidden="true"\/>Demandas privadas<\/h3>/, 'não repete "Despachos" logo abaixo da aba');
  assert.doesNotMatch(source, /' · Gestão superior'/, 'a opção do seletor leva só o nome');
  assert.match(css, /\.tabs \{ flex-wrap: wrap; overflow-x: visible; \}/);
  assert.match(css, /\.leadershipWrap \{ padding-block: 20px 32px; \}/);
  assert.match(css, /@container leadership \(max-width: 640px\) \{ \.filters > button \{ flex: 1 1 100%; \} \}/);
});
