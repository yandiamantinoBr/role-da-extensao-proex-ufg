import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fontBytes, load, zipEntries } from './support/project-report-module.mjs';

const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const nodes = tree => { const result = []; function visit(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children); } visit(tree); return result; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const civilDateSource = readFileSync(new URL('../lib/civil-date.ts', import.meta.url), 'utf8');
const civilDateCode = ts.transpileModule(civilDateSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const civilDates = await import(`data:text/javascript;base64,${Buffer.from(civilDateCode).toString('base64')}`);
const listSearchCode = ts.transpileModule(readFileSync(new URL('../lib/list-search.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const listSearch = await import(`data:text/javascript;base64,${Buffer.from(listSearchCode).toString('base64')}`);
const links = await load('lib/calendar-links.ts');
const { documentExport } = await load('components/portal/document-export.ts');
const ExportFormats = Symbol('ExportFormats');
function harness(initialProject = '', initialUnit = '', canOpenModule = () => true) {
  const slots = [], effects = [], requests = [], copied = [], files = [], exports = []; let index = 0, tree;
  let selectedProjectId = initialProject;
  let selectedUnitId = initialUnit;
  const hooks = {
    useState(initial) { const key = index++; if (!(key in slots)) slots[key] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[key].value, next => { slots[key].value = typeof next === 'function' ? next(slots[key].value) : next; }]; },
    useRef(initial) { const key = index++; return slots[key] ??= { current: initial }; },
    useMemo(fn) { index++; return fn(); },
    useEffect(fn, deps) { const key = index++; if (!slots[key] || deps.some((value, i) => !Object.is(value, slots[key].deps[i]))) { const previous = slots[key]; slots[key] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[key].cleanup = fn(); }); } },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const jsx = (type, props) => ({ type, props }), compiled = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL('../components/portal/calendar-panel.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, {
    module: compiled, exports: compiled.exports,
    require(name) {
      if (name === './document-export') return { documentExport: (...args) => { exports.push(args); return new Blob(); } };
      return name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === 'lucide-react' ? new Proxy({}, { get: (_, key) => String(key) }) : name.endsWith('.css') ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : name === '@/lib/civil-date' ? civilDates : name === '@/lib/list-search' ? listSearch : name === '@/lib/calendar-links' ? links : name === './export-formats' ? { default: ExportFormats } : name === './report-export' ? { download: (name, blob) => files.push({ name, blob }) } : { groupUnits: () => [] };
    },
    Date, Intl, URLSearchParams, AbortController, Map, Error,
    fetch: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })),
    navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
  });
  const h = {
    requests, copied, files, exports,
    render() {
      index = 0;
      tree = compiled.exports.default({
        projects: [{ id: 'project-a', name: 'Projeto sintético A', unit_id: 'unit-a' }],
        organizationalUnits: [{ id: 'unit-a', name: 'Unidade sintética A' }, { id: 'unit-b', name: 'Unidade sintética B' }],
        viewerId: 'viewer-test', selectedProjectId, selectedUnitId, canOpenModule,
        onProjectChange: id => { selectedProjectId = id; },
        onUnitChange: id => { selectedUnitId = id; selectedProjectId = ''; },
      });
      while (effects.length) effects.shift()();
    },
    all() { return nodes(tree); },
    button(label) { const result = this.all().find(node => node.type === 'button' && text(node).trim() === label); assert.ok(result, label); return result; },
    respond(request, body, ok = true, viewer = 'viewer-test') { request.resolve({ ok, headers: new Headers({ 'X-Proex-Viewer': viewer }), json: async () => body }); },
    body() { return text(tree); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  h.render(); return h;
}
async function ready(h) { h.respond(h.requests[0], { entries: [], feeds: [], availableCategories: ['projects'] }); await tick(); h.render(); }

test('agenda exports the same filtered commitments in PDF, DOCX and XLSX with Brazilian times', async t => {
  t.mock.method(globalThis, 'fetch', async path => {
    assert.equal(path, '/fonts/NotoSans-Regular.ttf');
    return new Response(fontBytes);
  });
  const h = harness();
  try {
    const day = new URL(h.requests[0].url, 'https://example.test').searchParams.get('from');
    const following = civilDates.offsetCivilDate(day, 1);
    const allDay = { allDay: true, category: 'projects', projectName: 'Projeto fictício', location: 'Sala 1', startsAt: day, endsAt: following, status: 'CONFIRMED' };
    const data = { feeds: [], availableCategories: ['projects', 'materials', 'loans'], entries: [
      { ...allDay, uid: 'a', title: 'Oficina autorizada', allDay: false, startsAt: `${day}T13:00:00Z`, endsAt: `${day}T13:30:00Z` },
      { ...allDay, uid: 'b', title: 'Oficina cancelada', status: 'CANCELLED' },
      { ...allDay, uid: 'c', title: 'Oficina amanhã', startsAt: following, endsAt: civilDates.offsetCivilDate(following, 1) },
      { ...allDay, uid: 'd', title: 'Palestra' },
      { ...allDay, uid: 'e', title: 'Oficina de materiais', category: 'materials' },
      { ...allDay, uid: 'f', title: 'Oficina à noite', allDay: false, startsAt: `${following}T02:30:00Z`, endsAt: `${following}T03:30:00Z` },
    ] };
    h.respond(h.requests[0], data); await tick(); h.render();
    const listFilter = () => h.all().find(node => node.props.name === 'agendaListCategory');
    const exportControl = () => h.all().find(node => node.type === ExportFormats);
    const listTitles = () => h.all().filter(node => node.type === 'article').map(node => text(node.props.children.find(child => child?.type === 'h4')));
    const ics = () => h.all().find(node => node.props.href?.endsWith('&format=ics')).props.href;
    const icsBefore = ics();

    h.all().find(node => node.props.name === 'calendarSearch').props.onChange({ target: { value: 'oficina' } });
    h.render();
    const dayButton = () => h.all().find(node => node.props['aria-controls'] === 'calendar-day-entries' && node.props['aria-label']?.startsWith('1 de '));
    dayButton().props.onClick({ currentTarget: null }); h.render();
    listFilter().props.onChange({ target: { value: 'projects' } }); h.render();
    assert.deepEqual(listTitles(), ['Oficina autorizada', 'Oficina à noite']);
    assert.match(dayButton().props['aria-label'], /3 registros$/);
    assert.equal(ics(), icsBefore);

    const datePt = day.split('-').reverse().join('/');
    const followingPt = following.split('-').reverse().join('/');
    assert.ok(h.body().includes("10:00 a 10:30") && !h.body().includes(`${datePt}, 10:00`), "no grupo do dia, o cartão mostra só o horário");
    assert.ok(h.body().includes(`${datePt}, 23:30 a ${followingPt}, 00:30`));
    for (const format of ['pdf', 'docx', 'xlsx']) {
      const index = h.requests.length;
      const download = exportControl().props.onExport(format);
      h.respond(h.requests[index], data); await tick();
      const args = h.exports.at(-1);
      assert.equal(args[0], format);
      assert.deepEqual(Array.from(args[3], row => row.event), ['Oficina autorizada\nProjetos e eventos', 'Oficina à noite\nProjetos e eventos']);
      h.respond(h.requests[index + 1], data); await download;
      assert.equal(h.files.at(-1).name, `agenda-proex-${day}.${format}`);

      const blob = await documentExport(...args);
      let content;
      if (format === 'pdf') {
        const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true, disableFontFace: true });
        try {
          const pdf = await task.promise;
          const page = await pdf.getPage(1);
          content = (await page.getTextContent()).items.map(item => item.str ?? '').join(' ').replace(/\s+/g, ' ');
        } finally { await task.destroy(); }
      } else {
        const zip = await zipEntries(blob);
        assert.ok(zip.has('[Content_Types].xml'));
        content = zip.get(format === 'docx' ? 'word/document.xml' : 'xl/worksheets/sheet1.xml');
      }
      assert.ok(content.includes(`${datePt}, 10:00 a 10:30`), format);
      assert.ok(content.includes(`${datePt}, 23:30 a ${followingPt}, 00:30`), format);
      assert.doesNotMatch(content, /\[U\+2192\]|→|Oficina cancelada|Oficina amanhã|Oficina de materiais|Palestra/);
    }

    const index = h.requests.length;
    const interrupted = exportControl().props.onExport('docx');
    h.respond(h.requests[index], data); await tick();
    h.respond(h.requests[index + 1], data, true, 'other-viewer');
    await assert.rejects(interrupted, /confirmar o acesso/);
    assert.equal(h.files.length, 3);

    h.render();
    h.respond(h.requests.at(-1), data); await tick(); h.render();
    const pending = exportControl().props.onExport('xlsx');
    listFilter().props.onChange({ target: { value: 'loans' } }); h.render();
    assert.equal(h.requests.at(-1).init.signal.aborted, true);
    h.respond(h.requests.at(-1), data); await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(h.files.length, 3);
    assert.equal(exportControl().props.disabled, true);
    assert.match(h.body(), /Nenhum compromisso desta categoria no recorte atual/);

    listFilter().props.onChange({ target: { value: 'projects' } }); h.render();
    h.button('Ver todo o período').props.onClick(); h.render();
    assert.deepEqual(listTitles(), ['Oficina autorizada', 'Oficina amanhã', 'Oficina à noite']);
    assert.equal(ics(), icsBefore);
  } finally { h.dispose(); }
});

test('agenda opens exact authorized sources and uses the parent for a shift or movement', async () => {
  const h = harness('', '', (module, entry) => module !== 'events' || entry.projectId === 'project-a');
  try {
    const day = new URL(h.requests[0].url, 'https://example.test').searchParams.get('from');
    const base = { category: 'projects', title: 'Agenda fictícia', projectName: 'Projeto A', projectId: 'project-a', startsAt: day, endsAt: civilDates.offsetCivilDate(day, 1), allDay: true };
    const entry = (sourceKind, sourceId, extra = {}) => ({ ...base, uid: sourceId, sourceKind, sourceId, ...extra });
    h.respond(h.requests[0], { feeds: [], availableCategories: ['projects'], entries: [
      entry('project', 'project-a'), entry('deadline', 'task-a', { projectId: '' }),
      entry('loan', 'loan-a'), entry('campaign-session', 'shift-a', { parentId: 'campaign-a' }),
      entry('campaign-session', 'shift-other', { projectId: 'project-b', parentId: 'hidden-campaign' }),
      entry('movement', 'item-a.consume.2026-11-14', { parentId: 'item-a' }),
      entry('movement', 'legacy'), entry('project-schedule', 'schedule-a'),
    ] });
    await tick();
    h.render();
    const targets = h.all().filter(node => node.type === 'a' && node.props.href.startsWith('/?')).map(node => new URL(node.props.href, 'https://example.test').searchParams);
    assert.equal(targets.length, 7);
    assert.ok(targets.some(query => query.get('detailProject') === 'project-a'));
    assert.ok(targets.some(query => query.get('demandId') === 'task-a' && !query.has('project')));
    assert.ok(targets.some(query => query.get('loanId') === 'loan-a'));
    assert.ok(targets.some(query => query.get('campaignId') === 'campaign-a'));
    assert.ok(targets.some(query => query.get('itemId') === 'item-a'));
    assert.equal(targets.filter(query => query.get('scheduleItemId') === 'schedule-a').length, 2);
    assert.ok(targets.every(query => !query.has('project') || query.get('project') === 'project-a'));
  } finally { h.dispose(); }
});

test('agenda searches authorized visible titles, places and projects without changing the ICS query', async () => {
  const h=harness();
  try {
    const day=new URL(h.requests[0].url,'https://example.test').searchParams.get('from');
    const end=new Date(`${day}T12:00:00Z`); end.setUTCDate(end.getUTCDate()+1);
    const sameDay={category:'projects',projectName:'Projeto Rolê',startsAt:day,endsAt:end.toISOString().slice(0,10),allDay:true};
    h.respond(h.requests[0],{entries:[
      {...sameDay,uid:'a',title:'Apresentação pública',location:'Auditório principal'},
      {...sameDay,uid:'b',title:'Reunião interna',location:'Sala 2'},
    ],feeds:[],availableCategories:['projects']});await tick();h.render();
    const findSearch=()=>h.all().find(node=>node.type==='input'&&node.props.name==='calendarSearch');
    findSearch().props.onChange({target:{value:'apresentacao auditorio'}});h.render();
    assert.match(h.body(),/Apresentação pública/);
    assert.doesNotMatch(h.body(),/Reunião interna/);
    assert.equal(h.requests.length,1);
    const ics=h.all().find(node=>node.type==='a'&&node.props.href.includes('format=ics'));
    assert.doesNotMatch(ics.props.href,/search=|auditorio/);
    findSearch().props.onChange({target:{value:'inexistente'}});h.render();
    assert.match(h.body(),/Nenhum resultado para esta busca/);
    h.button('Limpar filtros').props.onClick();h.render();
    assert.match(h.body(),/Reunião interna/);
  }finally{h.dispose();}
});

test('cancelled replacements do not clutter the active agenda, but remain visible on request and in ICS', async () => {
  const h = harness();
  try {
    const day = new URL(h.requests[0].url, 'https://example.test').searchParams.get('from');
    const base = { category: 'projects', title: 'Turno vigente', projectName: 'Projeto A', startsAt: day, endsAt: civilDates.offsetCivilDate(day, 1), allDay: true };
    h.respond(h.requests[0], { feeds: [], availableCategories: ['projects'], entries: [
      { ...base, uid: 'active', status: 'CONFIRMED' },
      { ...base, uid: 'cancelled', title: 'Turno substituído', status: 'CANCELLED' },
    ] });
    await tick();
    h.render();
    assert.match(h.body(), /Turno vigente/);
    assert.doesNotMatch(h.body(), /Turno substituído/);
    assert.match(h.body(), /Mostrar cancelados \(1\)/);
    const toggle = h.all().find(node => node.type === 'input' && node.props.type === 'checkbox');
    assert.equal(toggle.props.checked, false);
    toggle.props.onChange({ target: { checked: true } });
    h.render();
    assert.match(h.body(), /Turno substituído/);
    const cancelled = h.all().find(node => node.type === 'article' && node.props['data-cancelled']);
    assert.ok(cancelled, 'o cartão cancelado é marcado para o estilo próprio');
    assert.ok(h.all().some(node => node.type === 'em' && node.props['data-cancelled'] && node.props.title === 'Cancelado · Turno substituído'), 'a prévia do mês também mostra o cancelamento');
    assert.equal(text(cancelled.props.children.find(child => child?.type === 'span')), 'Cancelado', 'selo "Cancelado" acima do título');
    assert.doesNotMatch(h.body(), /arquivado|Projeto A · Cancelado/, 'cancelado não é arquivado, e o selo não se repete na linha do projeto');
    const ics = h.all().find(node => node.type === 'a' && node.props.href.includes('format=ics'));
    assert.doesNotMatch(ics.props.href, /cancelled/i);
    assert.equal(h.requests.length, 1);
    assert.ok(!h.all().some(node => node.type === 'button' && /Limpar filtros/.test(text(node))), 'mostrar cancelados é exibição, não filtro: não surge "Limpar filtros"');
    toggle.props.onChange({ target: { checked: false } });
    h.render();
    assert.doesNotMatch(h.body(), /Turno substituído/);
  } finally { h.dispose(); }
});

test('cards, day previews and exports drop the repeated type word but keep it in the small label (crítica de 16/11)', async () => {
  const h = harness();
  try {
    const day = new URL(h.requests[0].url, 'https://example.test').searchParams.get('from');
    const base = { projectName: 'Projeto A', startsAt: day, endsAt: civilDates.offsetCivilDate(day, 1), allDay: true, status: 'CONFIRMED' };
    const data = { feeds: [], availableCategories: ['projects', 'materials', 'deadlines'], entries: [
      { ...base, uid: 'm', category: 'materials', title: 'Materiais · Botton azul · 40 unidades' },
      { ...base, uid: 'p', category: 'deadlines', title: 'Prazo · Separar brindes' },
      { ...base, uid: 'a', category: 'projects', title: 'Atividade · Mostra de extensão' },
      { ...base, uid: 'x', category: 'projects', title: 'Oficina · parte 2' },
      { ...base, uid: 'c', category: 'projects', title: 'Atividade · Oficina suspensa', status: 'CANCELLED', state: 'cancelled' },
    ] };
    h.respond(h.requests[0], data); await tick(); h.render();
    h.all().find(node => node.type === 'input' && node.props.name === 'agendaShowCancelled').props.onChange({ target: { checked: true } }); h.render();
    const cards = h.all().filter(node => node.type === 'article').map(node => {
      const children = node.props.children; return [text(children.find(c => c?.type === 'small')), text(children.find(c => c?.type === 'h4'))];
    });
    assert.deepEqual(cards.sort(), [
      ['Materiais', 'Botton azul · 40 unidades'],
      ['Prazos de demandas', 'Separar brindes'],
      ['Projetos e eventos · Atividade', 'Mostra de extensão'],
      ['Projetos e eventos · Atividade', 'Oficina suspensa'],
      ['Projetos e eventos', 'Oficina · parte 2'],
    ], 'antes: "Materiais" em cima e "Materiais · Botton azul" no título');
    const chips = h.all().filter(node => node.type === 'em').map(node => text(node));
    assert.ok(chips.includes('Botton azul · 40 unidades') && !chips.some(chip => chip.startsWith('Materiais ·')));
    const counters = h.all().filter(node => node.type === 'button' && /^\d/.test(text(node))).map(text);
    assert.ok(counters.includes('1Material') && counters.includes('3Projetos e eventos'), `antes: "1 Materiais"; agora: ${counters}`);
    h.all().find(node => node.type === 'input' && node.props.name === 'calendarSearch').props.onChange({ target: { value: 'oficina' } }); h.render();
    assert.ok(h.button('Limpar filtros'), 'no mês atual, o link não fala em voltar ao mês');
    assert.ok(!h.all().some(node => node.type === 'button' && text(node) === 'Voltar ao mês atual e limpar filtros'));
    h.all().find(node => node.type === 'input' && node.props.name === 'calendarSearch').props.onChange({ target: { value: '' } }); h.render();
    const range = text(h.all().find(node => node.type === 'div' && node.props.className === 'rangeSummary').props.children[0]);
    assert.match(range, /^1 a \d{2} de [a-zç]+ de \d{4}$/, `período curto, sem repetir mês e ano: ${range}`);
    const dayHeadings = h.all().filter(node => node.type === 'h4' && node.props.className === 'dayHeading').map(text);
    assert.equal(dayHeadings.length, 1, 'a lista do período tem um título por dia, e os cartões não repetem a data');
    assert.ok(h.all().filter(node => node.type === 'article').every(node => text(node).includes('Dia inteiro · Projeto A') && !text(node).includes('/')), 'horário e projeto numa linha só');
    assert.ok(h.all().filter(node => node.type === 'em').every(node => node.props.children?.type === 'span' && node.props.children.props.className === 'chipText'), 'o corte em duas linhas fica no texto interno da prévia');
    const index = h.requests.length;
    const download = h.all().find(node => node.type === ExportFormats).props.onExport('xlsx');
    h.respond(h.requests[index], data); await tick();
    const args = h.exports.at(-1);
    assert.deepEqual(Array.from(args[3], row => row.event).sort(), [
      'Botton azul · 40 unidades\nMateriais', 'CANCELADO · Oficina suspensa\nProjetos e eventos · Atividade',
      'Mostra de extensão\nProjetos e eventos · Atividade', 'Oficina · parte 2\nProjetos e eventos', 'Separar brindes\nPrazos de demandas',
    ]);
    assert.ok(!args[5].some(([label]) => label === 'Compromissos'), 'o total já aparece no quadro do PDF');
    assert.equal(args[5].map(([label]) => label).join(' | '), 'Período | Projetos | Categoria | Fuso horário | Gerado em', '"Recorte" virou "Projetos" e o PDF diz quando foi gerado');
    assert.equal(args[6].recordsLabel, 'Compromissos do período'); assert.equal(args[6].mutedDetailLines, true);
    assert.equal(args[6].metrics.map(metric => `${metric.value} ${metric.label}`).join(' | '), '5 Compromissos | 3 Projetos e eventos | 1 Material | 1 Prazo de demanda', 'o quadro do PDF repete os contadores da tela');
    assert.equal(args[6].metrics[0].detail, 'inclui 1 cancelado', 'os cancelados viram nota do total');
    const whens = Array.from(args[3], row => row.when);
    assert.ok(whens[0].includes('/') && whens.slice(1).every(value => value === 'Dia inteiro'), `a data só na primeira linha do dia: ${whens}`);
    assert.equal(Array.from(args[6].mutedRows).join(), String(Array.from(args[3]).findIndex(row => row.event.startsWith('CANCELADO'))), 'a linha cancelada sai em cinza no PDF');
    assert.ok(h.all().some(node => node.type === 'span' && node.props.className === 'dotCancelled'), 'no celular, o ponto tracejado indica o cancelado do dia');
    assert.equal(h.all().find(node => node.type === ExportFormats).props.tiles, true, 'os três formatos cabem lado a lado na coluna da lista');
    h.respond(h.requests[index + 1], data); await download;
  } finally { h.dispose(); }
});

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
    const jump = h.all().find(node => node.type === 'button' && /^Ver \d+ compromissos? do dia \d+$/.test(text(node).trim()));
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
    assert.match(text(activity), /09\/11\/2026 a 13\/11\/2026 · dia inteiro/);
    assert.doesNotMatch(text(activity), /14\/11/);
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

test('an empty agenda explains what appears there for this access (P7, 10/11/2026)', async () => {
  const h = harness();
  try {
    h.respond(h.requests[0], { entries: [], feeds: [], availableCategories: ['materials', 'deadlines'] });
    await tick(); h.render();
    assert.match(h.body(), /Nada na Agenda neste período/);
    assert.match(h.body(), /Aqui aparecem materiais e prazos de demandas dos projetos que você acompanha/);
  } finally { h.dispose(); }
});

test('on phones the month cells keep only dots and counts: the last chip rule hides the previews again (quinta crítica de 16/11)', () => {
  const css = readFileSync(new URL('../components/portal/calendar-panel.module.css', import.meta.url), 'utf8');
  const lastShow = css.lastIndexOf('.chip { display:block'), lastHide = css.lastIndexOf('@media(max-width:720px){.chip{display:none}}');
  assert.ok(lastShow > 0 && lastHide > lastShow, 'a regra que esconde no celular vem depois da que mostra');
});

test('today uses the brand colour, not the Materiais orange, and the legend explains cancelled previews when they show (sexta crítica de 16/11)', () => {
  const css = readFileSync(new URL('../components/portal/calendar-panel.module.css', import.meta.url), 'utf8');
  const tail = css.slice(css.lastIndexOf('.day[aria-current=date] .dayNumber'));
  assert.match(tail, /^\.day\[aria-current=date\] \.dayNumber \{ background: var\(--surface-soft\); color: var\(--brand-ink\); \}/);
  const source = readFileSync(new URL('../components/portal/calendar-panel.tsx', import.meta.url), 'utf8');
  assert.match(source, /\{showCancelled&&<small><span className=\{styles\.legendCancelled\}\/>Cancelado<\/small>\}/);
});
