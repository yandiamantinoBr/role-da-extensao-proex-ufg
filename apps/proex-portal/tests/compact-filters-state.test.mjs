import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
function nodes(tree) { const result = []; function visit(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children); } visit(tree); return result; }
function harness(file, props) {
 const slots = [], effects = [], requests = []; let index = 0, tree;
 const hooks = {
  useState(initial) { const key = index++; if (!(key in slots)) slots[key] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[key].value, next => { slots[key].value = typeof next === 'function' ? next(slots[key].value) : next; }]; },
  useRef(initial) { const key = index++; return (slots[key] ??= { value: { current: initial } }).value; },
  useMemo(fn) { index++; return fn(); },
  useEffect(fn, deps) { const key = index++; if (!slots[key] || deps.some((value, i) => !Object.is(value, slots[key].deps[i]))) { const previous = slots[key]; slots[key] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[key].cleanup = fn(); }); } },
 };
 const jsx = (type, props) => ({ type, props }), compiled = { exports: {} };
 const catalogue = { THEMATIC_AREAS: [{ key: 'education', label: 'Educação' }], areaLabel: value => value, unitText: unit => unit.name, groupUnits: units => [{ group: 'Unidades', units }] };
 const source = ts.transpileModule(readFileSync(new URL(`../components/portal/${file}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
 vm.runInNewContext(source, { module: compiled, exports: compiled.exports, require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === 'lucide-react' ? new Proxy({}, { get: (_, key) => String(key) }) : name.endsWith('.css') ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : name.includes('extension-catalog') ? catalogue : name.includes('use-form-draft') ? { DraftNotice: () => null, useFormDraft: () => ({ clear() {} }) } : { default: () => null }, Date, Intl, URLSearchParams, AbortController, Map, Error, fetch: (url, init) => { requests.push({ url, init }); return new Promise(() => {}); } });
 const h = { requests, render() { index = 0; tree = compiled.exports.default(props); return tree; }, all() { return nodes(tree); }, flush() { while (effects.length) effects.shift()(); }, button(label) { const button = this.all().find(node => node.type === 'button' && text(node).trim() === label); assert.ok(button, label); return button; }, field(label) { const parent = this.all().find(node => node.type === 'label' && text(Array.isArray(node.props.children) ? node.props.children[0] : node.props.children).trim() === label); const input = parent && nodes(parent).find(node => ['input', 'select'].includes(node.type)); assert.ok(input, label); return input; }, change(label, value) { this.field(label).props.onChange({ target: { value } }); this.render(); this.flush(); }, disclosure(label) { return this.all().find(node => node.type === 'details' && nodes(node).some(child => child.type === 'summary' && text(child).startsWith(label))); }, dispose() { slots.forEach(slot => slot?.cleanup?.()); } };
 h.render(); h.flush(); return h;
}
const projects = [
 { id: 'a', name: 'Projeto A', unit_id: 'unit-a', type_id: 'type-a', thematic_area: 'education', scope: 'internal', lifecycle: 'active', status: 'active' },
 { id: 'b', name: 'Projeto B', unit_id: 'unit-b', type_id: 'type-b', thematic_area: 'culture', scope: 'external', lifecycle: 'past', status: 'active' },
];
const units = [{ id: 'unit-a', name: 'Unidade A' }, { id: 'unit-b', name: 'Unidade B' }];

test('collapsed project refinements preserve unique working filters, count active values and clear them', () => {
 const h = harness('project-panel', { projects, organizationalUnits: units, projectTypes: [{ id: 'type-a', label: 'Tipo A' }, { id: 'type-b', label: 'Tipo B' }], canCreate: false, canEdit: () => false, mutate: async () => ({}) });
 try {
  assert.equal(h.disclosure('Refinar projetos').props.open, undefined);
  assert.equal(nodes(h.disclosure('Refinar projetos')).filter(node => node.type === 'select').length, 4);
  assert.equal(h.all().filter(node => node.type === 'select').length, 4);
  assert.equal(h.all().filter(node => node.type === 'article').length, 2);
  for (const [label, value] of [['Unidade responsável', 'unit-a'], ['Área temática', 'education'], ['Modalidade', 'type-a'], ['Situação', 'active']]) h.change(label, value);
  assert.equal(h.all().filter(node => node.type === 'article').length, 1);
  assert.ok(text(h.disclosure('Refinar projetos')).includes('4 ativo(s)'));
  h.button('Limpar filtros').props.onClick(); h.render();
  assert.equal(h.all().filter(node => node.type === 'article').length, 2);
  assert.equal(h.field('Unidade responsável').props.value, '');
  assert.equal(h.field('Situação').props.value, 'all');
  assert.equal(text(h.disclosure('Refinar projetos')).includes('ativo(s)'), false);
 } finally { h.dispose(); }
});

test('catalogue administration is a closed native disclosure containing the original actions', () => {
 const h = harness('project-panel', { projects, organizationalUnits: units, isPlatformOwner: true, canCreate: false, canEdit: () => false, mutate: async () => ({}) });
 try {
  const admin = h.disclosure('Administrar catálogo');
  assert.equal(admin.props.open, undefined);
  assert.equal(nodes(admin).filter(node => node.type === 'button').length, 2);
  assert.ok(text(admin).includes('Unidades'));
  assert.ok(text(admin).includes('Tipos de iniciativa'));
 } finally { h.dispose(); }
});

test('agenda keeps its five filters unique and preserves context, dates and month navigation in real requests', () => {
 const h = harness('calendar-panel', { projects, organizationalUnits: units });
 try {
  const detail = h.disclosure('Filtrar período e contexto');
  assert.equal(detail.props.open, undefined);
  assert.equal(nodes(detail).filter(node => ['input', 'select'].includes(node.type)).length, 5);
  h.change('Categoria', 'loans'); h.change('Projeto', 'a'); h.change('Unidade responsável', 'unit-b');
  assert.equal(h.field('Projeto').props.value, '');
  h.change('Projeto', 'b'); h.change('Data final (incluída)', '2026-11-30'); h.change('Data inicial', '2026-11-01');
  const query = () => new URL(h.requests.at(-1).url, 'https://synthetic.example.invalid').searchParams;
  for (const [key, value] of [['category', 'loans'], ['projectId', 'b'], ['unitId', 'unit-b'], ['from', '2026-11-01'], ['to', '2026-11-30']]) assert.equal(query().get(key), value);
  const summary = h.all().find(node => node.props.className === 'summaryRow');
  assert.ok(text(summary).includes('Projeto B'));
  assert.ok(text(summary).includes('Empréstimos'));
  h.all().find(node => node.props['aria-label'] === 'Consultar próximo mês').props.onClick(); h.render(); h.flush();
  assert.equal(query().get('from'), '2026-12-01');
  assert.equal(query().get('category'), 'loans');
  assert.equal(query().get('projectId'), 'b');
 } finally { h.dispose(); }
});
