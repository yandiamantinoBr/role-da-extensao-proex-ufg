import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Menu lateral: a seta de Projetos e Equipes mostra os fixados como subitens (pedido do Yan, 09/11/2026).
const source = readFileSync(new URL('../components/portal/portal-navigation.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
function sidebar(props) {
  const slots = []; let cursor = 0;
  const hooks = { useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef: initial => ({ current: initial }), useCallback: fn => fn, useEffect() {} };
  const jsx = (type, props) => ({ type, props }), compiledModule = { exports: {} };
  vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === './navigation-model' ? { recommendedModules: () => [] } : name.endsWith('.css') ? { default: new Proxy({}, { get: (_t, key) => String(key) }) } : new Proxy({}, { get: (_t, key) => String(key) }) });
  let tree;
  const modules = [{ id: 'overview', label: 'Início', icon: 'i' }, { id: 'projects', label: 'Projetos', icon: 'p' }, { id: 'work-teams', label: 'Equipes', icon: 't' }, { id: 'materials', label: 'Materiais', icon: 'm' }];
  const render = (patch = {}) => { cursor = 0; tree = compiledModule.exports.DesktopSidebar({ modules, active: 'overview', onNavigate() {}, pinned: [], role: 'owner', collapsed: false, onToggle() {}, ...props, ...patch }); };
  const all = () => { const result = []; const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children); }; visit(tree); return result; };
  render();
  return { render, all, find: predicate => all().find(predicate), body: () => text(tree) };
}

test('projects and teams with pins get an arrow that expands the pinned items; other modules stay plain', () => {
  const opened = [];
  const h = sidebar({ subitems: { projects: [{ id: 'p1', label: 'Rolê da Extensão', onOpen: () => opened.push('p1') }, { id: 'p2', label: 'CONPEEX', onOpen: () => opened.push('p2') }], 'work-teams': [{ id: 't1', label: 'Comunicação', onOpen: () => opened.push('t1') }] } });
  const toggle = label => h.find(node => node.type === 'button' && node.props['aria-label'] === label);
  assert.ok(toggle('Mostrar fixados de Projetos'));
  assert.ok(toggle('Mostrar fixados de Equipes'));
  assert.equal(toggle('Mostrar fixados de Materiais'), undefined, 'sem fixados, sem seta');
  assert.doesNotMatch(h.body(), /Rolê da Extensão/, 'fechado por padrão fora da página');
  toggle('Mostrar fixados de Projetos').props.onClick(); h.render();
  assert.equal(toggle('Ocultar fixados de Projetos').props['aria-expanded'], true);
  const items = h.all().filter(node => node.type === 'button' && node.props.title && /Rolê|CONPEEX/.test(node.props.title));
  assert.deepEqual(items.map(node => node.props.title), ['Rolê da Extensão', 'CONPEEX']);
  items[1].props.onClick();
  assert.deepEqual(opened, ['p2']);
  assert.doesNotMatch(h.body(), /Comunicação/, 'cada módulo abre sozinho');
  // Na página do módulo, a lista já vem aberta; recolhido, o menu não mostra subitens.
  h.render({ active: 'work-teams' }); assert.match(h.body(), /Comunicação/);
  h.render({ collapsed: true }); assert.equal(toggle('Ocultar fixados de Equipes') ?? toggle('Mostrar fixados de Equipes'), undefined);
});
