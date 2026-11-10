import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// A "Semana" da doca soma a Agenda e os prazos de Meu trabalho. Com a categoria nova "Prazos de demandas" na Agenda
// (R7, 10/11/2026), os prazos não podem aparecer duas vezes nem trazer demandas de outras pessoas.
const compiled = ts.transpileModule(readFileSync(new URL('../components/portal/dock-calendar.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the week widget shows agenda items once and only my own deadlines', async () => {
  const slots = [], effects = []; let index = 0;
  const hooks = { useState: initial => { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = value; }]; }, useEffect: fn => { effects.push(fn); } };
  const api = { errorText: (_e, fallback) => fallback, communityGet: async url => url.startsWith('/api/calendar')
    ? { entries: [
      { uid: 'shift', title: 'Turno · Tarde · Evento', startsAt: '2026-11-12T17:00:00.000Z', endsAt: '2026-11-12T19:00:00.000Z', allDay: false, projectName: 'Projeto A', status: 'CONFIRMED', category: 'projects' },
      { uid: 'deadline.mine', title: 'Prazo · Separar brindes', startsAt: '2026-11-13', endsAt: '2026-11-14', allDay: true, projectName: 'Projeto A', status: 'CONFIRMED', category: 'deadlines' },
      { uid: 'deadline.other', title: 'Prazo · Demanda de outra pessoa', startsAt: '2026-11-13', endsAt: '2026-11-14', allDay: true, projectName: 'Projeto A', status: 'CONFIRMED', category: 'deadlines' },
    ] }
    : { tasks: { items: [{ id: 'mine', title: 'Separar brindes', due_at: '2026-11-13', target: { name: 'Projeto A' }, href: '/?module=demands' }] } } };
  const compiledModule = { exports: {} };
  vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, Promise, Date, Intl, Set, require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) } : name === './community-api' ? api : name.endsWith('.css') ? { default: new Proxy({}, { get: (_t, key) => String(key) }) } : new Proxy({}, { get: (_t, key) => String(key) }) });
  const render = () => { index = 0; return compiledModule.exports.default({ serverDay: '2026-11-10', onOpenCalendar() {} }); };
  render(); effects.splice(0).forEach(effect => effect()); await tick(); await tick();
  const body = text(render());
  assert.match(body, /Turno · Tarde · Evento/);
  assert.equal(body.split('Separar brindes').length - 1, 1, 'o meu prazo aparece uma vez só');
  assert.doesNotMatch(body, /Demanda de outra pessoa/, 'prazos dos outros ficam na Agenda, não na minha semana');
});
