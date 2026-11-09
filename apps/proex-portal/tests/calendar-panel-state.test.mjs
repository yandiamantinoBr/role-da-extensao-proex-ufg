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
function harness(initialProject = '', initialUnit = '') {
  const slots = [], effects = [], requests = [], copied = []; let index = 0, tree;
  let selectedProjectId = initialProject;
  let selectedUnitId = initialUnit;
  const hooks = {
    useState(initial) { const key = index++; if (!(key in slots)) slots[key] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[key].value, next => { slots[key].value = typeof next === 'function' ? next(slots[key].value) : next; }]; },
    useRef(initial) { const key = index++; return slots[key] ??= { current: initial }; },
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
    render() {
      index = 0;
      tree = compiled.exports.default({
        projects: [{ id: 'project-a', name: 'Projeto sintético A', unit_id: 'unit-a' }],
        organizationalUnits: [{ id: 'unit-a', name: 'Unidade sintética A' }, { id: 'unit-b', name: 'Unidade sintética B' }],
        selectedProjectId, selectedUnitId,
        onProjectChange: id => { selectedProjectId = id; },
        onUnitChange: id => { selectedUnitId = id; selectedProjectId = ''; },
      });
      while (effects.length) effects.shift()();
    },
    all() { return nodes(tree); },
    button(label) { const result = this.all().find(node => node.type === 'button' && text(node).trim() === label); assert.ok(result, label); return result; },
    respond(request, body, ok = true) { request.resolve({ ok, json: async () => body }); },
    body() { return text(tree); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  h.render(); return h;
}
async function ready(h) { h.respond(h.requests[0], { entries: [], feeds: [], availableCategories: ['projects'] }); await tick(); h.render(); }

test('the project and unit from the route scope the calendar query and ICS, and clearing the project keeps the unit', async () => {
  const h = harness('project-a', 'unit-a');
  try {
    const query = new URL(h.requests[0].url, 'https://example.test').searchParams;
    assert.equal(query.get('projectId'), 'project-a');
    assert.equal(query.get('unitId'), 'unit-a');
    await ready(h);
    const ics = h.all().find(node => node.type === 'a' && node.props.href.includes('format=ics'));
    const icsQuery = new URL(ics.props.href, 'https://example.test').searchParams;
    assert.equal(icsQuery.get('projectId'), 'project-a');
    assert.equal(icsQuery.get('unitId'), 'unit-a');
    const project = h.all().find(node => node.type === 'select' && node.props.value === 'project-a');
    project.props.onChange({ target: { value: '' } });
    h.render();
    const unitQuery = new URL(h.requests.at(-1).url, 'https://example.test').searchParams;
    assert.equal(unitQuery.has('projectId'), false);
    assert.equal(unitQuery.get('unitId'), 'unit-a');
    h.respond(h.requests.at(-1), { entries: [], feeds: [], availableCategories: ['projects'] });
    await tick(); h.render();
    assert.equal(h.button('Gerar link privado de assinatura').props.disabled, true);
  } finally { h.dispose(); }
  const outside = harness('projeto-sem-acesso');
  try {
    assert.equal(new URL(outside.requests[0].url, 'https://example.test').searchParams.has('projectId'), false);
  } finally { outside.dispose(); }
  const mismatched = harness('project-a', 'unit-b');
  try {
    const query = new URL(mismatched.requests[0].url, 'https://example.test').searchParams;
    assert.equal(query.has('projectId'), false);
    assert.equal(query.get('unitId'), 'unit-b');
  } finally { mismatched.dispose(); }
});

test('opening and closing a day never scrolls the page or moves focus away from the day (relato de 09/11/2026)', async () => {
  const h = harness(), calls = [];
  try {
    // Um registro sintético no primeiro dia do mês, para o atalho ter o que mostrar.
    const from = new URL(h.requests[0].url, 'https://example.test').searchParams.get('from');
    const next = new Date(`${from}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    h.respond(h.requests[0], { entries: [{ uid: 'entry-a', category: 'projects', title: 'Atividade sintética', startsAt: from, endsAt: next.toISOString().slice(0, 10), allDay: true, projectName: 'Projeto sintético A', status: 'CONFIRMED' }], feeds: [], availableCategories: ['projects'] });
    await tick(); h.render();
    const dayButton = () => h.all().find(node => node.type === 'button' && node.props?.['aria-pressed'] !== undefined && node.props?.['aria-controls'] === 'calendar-day-entries');
    const heading = h.all().find(node => node.props?.id === 'calendar-day-heading');
    const target = label => ({ focus: () => calls.push(`${label}:focus`), scrollIntoView: () => calls.push(`${label}:scroll`) });
    heading.props.ref.current = target('list');
    // Abrir e fechar o mesmo dia várias vezes: antes, cada abertura descia a página (scrollIntoView na lista fixa).
    for (let round = 0; round < 4; round++) {
      dayButton().props.onClick({ currentTarget: target('day') }); h.render();
      assert.match(h.body(), /Compromissos de /);
      assert.equal(dayButton().props['aria-pressed'], true);
      dayButton().props.onClick({ currentTarget: target('day') }); h.render();
      assert.doesNotMatch(h.body(), /Compromissos de /);
    }
    assert.deepEqual(calls, [], 'abrir ou fechar um dia não pode rolar a página nem tirar o foco do dia');
    // No celular, a lista fica abaixo do mês: o atalho explícito leva até ela só quando a pessoa pede.
    dayButton().props.onClick({ currentTarget: target('day') }); h.render();
    const jump = h.all().find(node => node.type === 'button' && /^Ver \d+ registros? do dia \d+$/.test(text(node).trim()));
    assert.ok(jump, 'atalho para a lista do dia');
    jump.props.onClick(); h.render();
    assert.deepEqual(calls, ['list:focus', 'list:scroll']);
    h.button('Ver todo o período').props.onClick(); h.render();
    assert.doesNotMatch(h.body(), /Compromissos de /);
    assert.deepEqual(calls, ['list:focus', 'list:scroll', 'day:focus', 'day:scroll']);
  } finally { h.dispose(); }
});

test('the day list never combines an automatic scroll with the sticky side column', () => {
  const source = readFileSync(new URL('../components/portal/calendar-panel.tsx', import.meta.url), 'utf8');
  const effects = source.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
  for (const effect of effects) assert.doesNotMatch(effect, /scrollIntoView|scrollTo|\.focus\(/, 'nenhum efeito pode rolar a página ou mover o foco sozinho');
  const css = readFileSync(new URL('../components/portal/calendar-panel.module.css', import.meta.url), 'utf8');
  assert.match(css, /@container agenda \(min-width:860px\)\{\.jump\{display:none\}\}/, 'o atalho some quando a lista está ao lado do mês');
});

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

test('month days announce all visible categories and update the label together with badges, previews and day details', async () => {
  const h = harness();
  try {
    await ready(h);
    const month = new URL(h.requests[0].url, 'https://example.test').searchParams.get('from').slice(0, 7);
    const day = n => `${month}-${String(n).padStart(2, '0')}`;
    const button = n => h.all().find(node => node.type === 'button' && node.props['aria-controls'] === 'calendar-day-entries' && node.props['aria-label'].startsWith(`${n} de `));
    assert.match(button(10).props['aria-label'], /, 0 registros$/);
    h.button('Atualizar consulta').props.onClick(); h.render();
    const entry = (uid, category, startsAt, endsAt, allDay = false) => ({ uid, category, title: `Atividade ${uid}`, projectId: 'project-a', projectName: 'Projeto sintético A', startsAt, endsAt, allDay });
    const entries = [
      entry('loan-spanning', 'loans', day(9), day(11), true),
      entry('material', 'materials', `${day(10)}T12:00:00Z`, `${day(10)}T12:01:00Z`),
      entry('project', 'projects', `${day(10)}T21:00:00Z`, `${day(10)}T22:00:00Z`),
      entry('consumption', 'consumption', `${day(10)}T10:00:00Z`, `${day(10)}T10:01:00Z`),
      entry('another-day', 'projects', day(12), day(13), true),
    ];
    h.respond(h.requests.at(-1), { entries, feeds: [], availableCategories: ['loans', 'materials', 'projects', 'consumption'] }); await tick(); h.render();
    assert.match(button(10).props['aria-label'], /, 4 registros$/);
    assert.match(text(button(10)), /\+2$/);
    assert.equal(nodes(button(10)).filter(node => node.type === 'em').length, 2);
    assert.match(button(9).props['aria-label'], /, 1 registro$/);
    assert.match(button(11).props['aria-label'], /, 0 registros$/);
    button(10).props.onClick({ currentTarget: {} }); h.render();
    assert.equal(h.all().filter(node => node.type === 'article').length, 4);
    assert.ok(h.all().filter(node => node.type === 'article').every(node => !text(node).includes('another-day')));
    const projectFilter = h.all().find(node => node.type === 'select' && node.props.value === 'all');
    projectFilter.props.onChange({ target: { value: 'projects' } }); h.render();
    h.respond(h.requests.at(-1), { entries: entries.filter(entry => entry.category === 'projects'), feeds: [], availableCategories: ['loans', 'materials', 'projects', 'consumption'] }); await tick(); h.render();
    assert.match(button(10).props['aria-label'], /, 1 registro$/);
    assert.equal(nodes(button(10)).filter(node => node.type === 'em').length, 1);
  } finally { h.dispose(); }
});
