import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const nodes = tree => { const result = []; function visit(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children); } visit(tree); return result; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const civilDateSource = readFileSync(new URL('../lib/civil-date.ts', import.meta.url), 'utf8');
const civilDateCode = ts.transpileModule(civilDateSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const civilDates = await import(`data:text/javascript;base64,${Buffer.from(civilDateCode).toString('base64')}`);
function harness() {
  const slots = [], effects = [], requests = [], copied = []; let index = 0, tree;
  const hooks = {
    useState(initial) { const key = index++; if (!(key in slots)) slots[key] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[key].value, next => { slots[key].value = typeof next === 'function' ? next(slots[key].value) : next; }]; },
    useMemo(fn) { index++; return fn(); },
    useEffect(fn, deps) { const key = index++; if (!slots[key] || deps.some((value, i) => !Object.is(value, slots[key].deps[i]))) { const previous = slots[key]; slots[key] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[key].cleanup = fn(); }); } },
  };
  const jsx = (type, props) => ({ type, props }), compiled = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL('../components/portal/calendar-panel.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, {
    module: compiled, exports: compiled.exports,
    require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === 'lucide-react' ? new Proxy({}, { get: (_, key) => String(key) }) : name.endsWith('.css') ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : name === '@/lib/civil-date' ? civilDates : { groupUnits: () => [] },
    Date, Intl, URLSearchParams, AbortController, Map, Error,
    fetch: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })),
    navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
  });
  const h = {
    requests, copied,
    render() { index = 0; tree = compiled.exports.default({ projects: [{ id: 'project-a', name: 'Projeto sintético A' }] }); while (effects.length) effects.shift()(); },
    all() { return nodes(tree); },
    button(label) { const result = this.all().find(node => node.type === 'button' && text(node).trim() === label); assert.ok(result, label); return result; },
    respond(request, body, ok = true) { request.resolve({ ok, json: async () => body }); },
    body() { return text(tree); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  h.render(); return h;
}
async function ready(h) { h.respond(h.requests[0], { entries: [], feeds: [], availableCategories: ['projects'] }); await tick(); h.render(); }

test('subscription copies its private HTTPS URL and opens the documented Google URL screen without putting the bearer in the external link', async () => {
  const h = harness();
  try {
    await ready(h);
    h.button('Gerar link privado de assinatura').props.onClick();
    const request = h.requests.at(-1);
    assert.equal(request.url, '/api/calendar');
    assert.equal(JSON.parse(request.init.body).action, 'feed.create');
    assert.equal(JSON.parse(request.init.body).category, 'projects');
    assert.equal(JSON.parse(request.init.body).projectId, null);
    const feedUrl = `https://portal.example.test/api/calendar/feed/${'S'.repeat(43)}`;
    h.respond(request, { id: 'feed-synthetic', feedUrl, expiresAt: '2027-10-31T12:00:00Z' }); await tick(); h.render();
    const link = h.all().find(node => node.type === 'a' && text(node).includes('Abrir Google Calendar'));
    assert.ok(link); assert.equal(link.props.href, 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl');
    assert.equal(link.props.target, '_blank'); assert.equal(link.props.rel, 'noopener noreferrer');
    assert.ok(!link.props.href.includes(feedUrl));
    assert.ok(h.body().includes('não conclui a assinatura'));
    await h.button('Copiar link').props.onClick(); h.render();
    assert.deepEqual(h.copied, [feedUrl]); assert.ok(h.button('Copiado'));
  } finally { h.dispose(); }
});

test('a failed feed creation never offers a fabricated subscription link', async () => {
  const h = harness();
  try {
    await ready(h); h.button('Gerar link privado de assinatura').props.onClick();
    h.respond(h.requests.at(-1), { error: 'Você não tem permissão para esta categoria ou projeto.' }, false); await tick(); h.render();
    assert.ok(h.body().includes('Você não tem permissão'));
    assert.equal(h.all().some(node => node.type === 'a' && text(node).includes('Abrir Google Calendar')), false);
    assert.deepEqual(h.copied, []);
  } finally { h.dispose(); }
});

test('the agenda label uses the last included day rather than the exclusive ICS end', async () => {
  const h = harness();
  try {
    h.respond(h.requests[0], { entries: [{ uid: 'civil-period', projectId: 'project-a', projectName: 'Projeto sintético A',
      category: 'projects', title: 'Atividade sintética', allDay: true, startsAt: '2026-11-09', endsAt: '2026-11-14' }],
      feeds: [], availableCategories: ['projects'] });
    await tick();
    h.render();
    const activity = h.all().find(node => node.type === 'article' && text(node).includes('Atividade sintética'));
    assert.match(text(activity), /9 de novembro de 2026 a 13 de novembro de 2026 · Dia inteiro/);
    assert.doesNotMatch(text(activity), /14 de novembro/);
  } finally { h.dispose(); }
});
