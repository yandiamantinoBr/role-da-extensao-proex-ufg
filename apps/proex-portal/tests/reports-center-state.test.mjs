import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { zipEntries } from './support/report-module.mjs';

const root = new URL('../', import.meta.url);
const transpile = file => ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function pure(file) { const compiledModule = { exports: {} }; vm.runInNewContext(transpile(file), { module: compiledModule, exports: compiledModule.exports, Blob, TextEncoder, Uint8Array, DataView, ArrayBuffer }); return compiledModule.exports; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const exportNames = ['Excel', 'PDF', 'Word', 'JSON', 'Imprimir'];
const base = { userId: 'report-user', projectId: 'project-a', unitId: '', area: '', from: '', to: '', scopeLabel: 'Projeto A', available: ['materials', 'loans'] };
const row = project => ({ id: `item-${project}`, projeto: `Projeto ${project.toUpperCase()}`, material: `Material ${project.toUpperCase()}`, classe: 'gift', unidade_medida: 'unidade', saldo: 9, reservado: 0, disponivel: 9 });

/** Run the real TSX and exporters with a minimal hook scheduler and virtual DOM.
 * Fetch and effects are separately controlled so the render BEFORE effect cleanup
 * and responses whose body resolves AFTER abort can both be exercised deterministically.
 * No DOM, network, filesystem writes or framework build is involved.
 */
function harness(storage = new Map()) {
 const slots = [], pendingEffects = [], requests = [], downloads = [], pdfInputs = []; let index = 0, tree, opened = 0;
 const same = (left, right) => left?.length === right?.length && left?.every((value, i) => Object.is(value, right[i]));
 const hooks = {
  useState(initial) { const key = index++; if (!(key in slots)) slots[key] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[key].value, next => { slots[key].value = typeof next === 'function' ? next(slots[key].value) : next; }]; },
  useRef(initial) { const key = index++; slots[key] ??= { value: { current: initial } }; return slots[key].value; },
  useMemo(callback) { index++; return callback(); },
  useCallback(callback) { index++; return callback; },
  useEffect(callback, deps) { const key = index++; if (!same(slots[key]?.deps, deps)) pendingEffects.push(() => { slots[key]?.cleanup?.(); slots[key] = { deps, cleanup: callback() }; }); },
 };
 const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
 const exporters = pure('components/portal/report-export.ts'); exporters.download = (name, blob) => downloads.push({ name, blob });
 const require = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsx : name === './report-export' ? exporters : name === './report-pdf' ? { toPdf(...args) { pdfInputs.push(args); return new Blob(['synthetic pdf'], { type: 'application/pdf' }); } } : name === '@/lib/report-quantities' ? pure('lib/report-quantities.ts') : name === '@/lib/extension-catalog' ? { areaLabel: value => value } : name.endsWith('.css') ? { default: new Proxy({}, { get: (_object, key) => key }) } : new Proxy({}, { get: (_object, key) => String(key) });
 const compiledModule = { exports: {} };
 const window = { setTimeout(callback) { callback(); return 1; }, clearTimeout() {}, open() { opened++; return null; } };
 vm.runInNewContext(transpile('components/portal/reports-center.tsx'), { module: compiledModule, exports: compiledModule.exports, require, Blob, Intl, Date, Map, Set, URL, URLSearchParams, AbortController, window, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, fetch: (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })) });
 function nodes() { const result = []; const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } result.push(node); visit(node.props?.children); }; visit(tree); return result; }
 return {
  requests, downloads, pdfInputs,
  renderProject(projectId, identity = {}) { index = 0; tree = compiledModule.exports.ProjectReportExports({projectId,...identity}); return tree; },
  render(props = base) { index = 0; tree = compiledModule.exports.default(props); return tree; },
  flushEffects() { while (pendingEffects.length) pendingEffects.shift()(); },
  button(name) { const found = nodes().find(node => node.type === 'button' && text(node) === name); assert.ok(found, `button ${name}`); return found; },
  input(label) { const node=nodes().find(node=>node.type==='label'&&text(node).includes(label)),input=node&&nodesInside(node).find(child=>['input','select'].includes(child.type));assert.ok(input,label);return input; },
  columnToggles() { const detail=nodes().find(node=>node.type==='details'&&text(node.props.children?.[0]).includes('Colunas')),result=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}if(node.type==='input'&&node.props.type==='checkbox')result.push(node);visit(node.props?.children);};visit(detail);return result; },
  text() { return text(tree); },
  get opened() { return opened; },
  dispose() { for (const slot of slots) slot?.cleanup?.(); },
 };
}
function nodesInside(node){const result=[];const visit=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(visit);return;}result.push(value);visit(value.props?.children);};visit(node);return result;}
async function load(h, project = 'a', props = base) { h.render(props); h.flushEffects(); h.requests.at(-1).resolve({ ok: true, json: async () => ({ dataset: 'materials', rows: [row(project)], truncated: false }) }); await tick(); h.render(props); }

test('report subjects use one native select and changing it updates the request', async () => {
 const h = harness();
 try {
  await load(h);
  const subject = () => h.input('Assunto do relatório');
  assert.equal(subject().type, 'select');
  assert.equal(subject().props.value, 'materials');
  assert.equal(nodesInside(subject()).filter(node => node.type === 'option').length, 2);
  subject().props.onChange({target:{value:'loans'}}); h.render(); h.flushEffects();
  assert.equal(subject().props.value, 'loans');
  assert.equal(new URL(h.requests.at(-1).url, 'https://synthetic.example.invalid').searchParams.get('dataset'), 'loans');
 } finally { h.dispose(); }
});

test('report starts with subject/search, keeps advanced choices closed and places rows before export formats and charts', async () => {
 const h = harness();
 try {
  await load(h);
  const flat = nodesInside(h.render());
  const options = flat.find(node => node.type === 'details' && nodesInside(node).some(child => child.type === 'summary' && text(child).startsWith('Ajustar recorte e colunas')));
  const exports = flat.find(node => node.type === 'details' && nodesInside(node).some(child => child.type === 'summary' && text(child) === 'Exportar linhas deste recorte'));
  assert.equal(options.props.open, undefined); assert.equal(exports.props.open, undefined);
  assert.equal(nodesInside(options).includes(h.input('Buscar nas linhas')), false);
  assert.ok(flat.indexOf(h.input('Assunto do relatório')) < flat.findIndex(node => node.type === 'table'));
  assert.ok(flat.findIndex(node => node.type === 'table') < flat.indexOf(exports));
  assert.ok(flat.indexOf(exports) < flat.findIndex(node => node.type === 'figure'));
  h.input('Consultar metadados').props.onChange({target:{checked:true}}); h.render();
  const active = nodesInside(h.render()).find(node => node.type === 'summary' && text(node).startsWith('Ajustar recorte e colunas'));
  assert.ok(text(active).includes('metadados patrimoniais'));
  assert.equal(h.button('Excel').props.disabled, true);
 } finally { h.dispose(); }
});

test('all ten available subjects preserve fresh-query export gating through the single selector', async () => {
 const all = ['projects','materials','movements','outflows','outflow_details','loans','records','campaigns','demands','reviews'];
 const props = {...base,available:all}, h = harness();
 try {
  h.render(props); h.flushEffects();
  assert.equal(nodesInside(h.input('Assunto do relatório')).filter(node => node.type === 'option').length, 10);
  for (const dataset of all) {
   h.input('Assunto do relatório').props.onChange({target:{value:dataset}}); h.render(props); h.flushEffects();
   assert.equal(h.button('JSON').props.disabled, true);
   const request = h.requests.at(-1);
   assert.equal(new URL(request.url,'https://synthetic.example.invalid').searchParams.get('dataset'),dataset);
   request.resolve({ok:true,json:async()=>({dataset,rows:[{id:`synthetic-${dataset}`,projeto:'Projeto A',material:'Item A',unidade_medida:'unidade',quantidade:1}],truncated:false})}); await tick(); h.render(props);
   assert.equal(h.input('Assunto do relatório').props.value,dataset);
   assert.equal(h.button('JSON').props.disabled,false);
  }
 } finally { h.dispose(); }
});
async function jsonDownload(h) { h.button('JSON').props.onClick(); return JSON.parse(await h.downloads.at(-1).blob.text()); }

test('report exports remain disabled immediately on any server-filter or dataset change, before effects run', async () => {
 const h = harness(); try {
  await load(h); assert.equal(h.button('JSON').props.disabled, false); const initial = await jsonDownload(h); assert.equal(initial.linhas[0].projeto, 'Projeto A');
  for (const change of [{ projectId: 'project-b', scopeLabel: 'Projeto B' }, { unitId: 'unit-b' }, { area: 'cultura' }, { from: '2026-10-01' }, { to: '2026-10-31' }]) {
   h.render({ ...base, ...change });
   for (const name of exportNames) assert.equal(h.button(name).props.disabled, true, `${name}: ${JSON.stringify(change)}`);
   assert.equal(h.text().includes('Material A'), false);
   // Handler guards also protect asynchronous document generation and printing.
   h.button('PDF').props.onClick(); h.button('Word').props.onClick(); h.button('Imprimir').props.onClick(); await tick();
   assert.equal(h.downloads.length, 1); assert.equal(h.opened, 0);
  }
  h.render(base); h.input('Assunto do relatório').props.onChange({target:{value:'loans'}}); h.render(base);
  for (const name of exportNames) assert.equal(h.button(name).props.disabled, true, `${name}: dataset`);
 } finally { h.dispose(); }
});

test('changing project clears incompatible unit and chart filters and starts on the first page', async () => {
 const h = harness();
 const other = { ...base, projectId: 'project-b', scopeLabel: 'Projeto B' };
 const resolveRows = async (props, unit, category) => {
  h.render(props); h.flushEffects();
  const rows = Array.from({length: 30}, (_, index) => ({ ...row(props.projectId), id: `item-${index}`, classe: category, unidade_medida: unit }));
  h.requests.at(-1).resolve({ ok: true, json: async () => ({ dataset: 'materials', rows, truncated: false }) });
  await tick();
  return h.render(props);
 };
 try {
  let view = await resolveRows(base, 'kit', 'gift');
  h.input('Unidade de medida').props.onChange({ target: { value: 'kit' } });
  view = h.render();
  const chartFilter = nodesInside(view).find(node => node.type === 'Bar' && node.props.onClick);
  chartFilter.props.onClick({ payload: { raw: 'Brinde' } });
  h.render();
  h.button('Próxima').props.onClick();
  h.render();
  assert.match(h.text(), /26–30 de 30/);

  h.render(other);
  assert.equal(h.button('JSON').props.disabled, true);
  await resolveRows(other, '', 'equipment');
  assert.match(h.text(), /1–25 de 30/);
  assert.equal(h.button('JSON').props.disabled, false);
  assert.equal((await jsonDownload(h)).linhas.length, 30);

  await resolveRows(base, 'kit', 'gift');
  assert.equal(h.input('Unidade de medida').props.value, '');
  assert.match(h.text(), /1–25 de 30/);
 } finally { h.dispose(); }
});

test('chart and native group selector filter the same rows and reset pagination', async () => {
 const h = harness();
 const materialRows = Array.from({ length: 30 }, (_, index) => ({ ...row('a'), id: `gift-${index}` }));
 const equipment = { ...row('b'), classe: 'equipment' };
 try {
  h.render(); h.flushEffects();
  h.requests.at(-1).resolve({ ok: true, json: async () => ({ dataset: 'materials', rows: [...materialRows, equipment], truncated: false }) });
  await tick(); h.render();
  h.button('Próxima').props.onClick(); h.render();
  assert.match(h.text(), /26–31 de 31/);
  const select = () => h.input('Filtrar tabela por grupo');
  select().props.onChange({ target: { value: 'Equipamento' } }); h.render();
  assert.match(h.text(), /1–1 de 1/);
  assert.deepEqual((await jsonDownload(h)).linhas.map(line => line.material), ['Material B']);
  const filterBar = nodesInside(h.render()).find(node => node.type === 'Bar' && node.props.onClick);
  filterBar.props.onClick({ payload: { raw: 'Brinde' } }); h.render();
  assert.equal(select().props.value, 'Brinde');
  assert.match(h.text(), /1–25 de 30/);
  select().props.onChange({ target: { value: '' } }); h.render();
  assert.match(h.text(), /1–25 de 31/);
  const container = nodesInside(h.render()).find(node => node.type === 'ResponsiveContainer' && node.props.onResize);
  const axis = () => nodesInside(h.render()).find(node => node.type === 'YAxis' && node.props.type === 'category');
  container.props.onResize(234, 180);
  assert.equal(axis().props.width, 78);
  assert.match(axis().props.tickFormatter('Material institucional da Pró-Reitoria de Extensão'), /…$/);
  container.props.onResize(480, 180);
  assert.equal(axis().props.width, 150);
 } finally { h.dispose(); }
});

test('month table exposes the same entries and withdrawals as the filtered timeline', async () => {
 const h = harness(), props = { ...base, available: ['movements'] };
 const movement = (id, data, tipo, quantidade) => ({ ...row('a'), id, data, tipo, quantidade });
 try {
  h.render(props); h.flushEffects();
  h.requests.at(-1).resolve({ ok: true, json: async () => ({ dataset: 'movements', truncated: false, rows: [
   movement('in', '2026-09-02', 'receive', 7), movement('out', '2026-09-07', 'distribute', -4),
   movement('next', '2026-10-03', 'distribute', -2),
  ] }) });
  await tick(); h.render(props);
  const table = () => nodesInside(h.render(props)).find(node => node.type === 'table' && text(node).startsWith('Valores da evolução por mês'));
  const body = () => nodesInside(table()).filter(node => node.type === 'tr').map(row => nodesInside(row).filter(cell => ['th','td'].includes(cell.type)).map(text));
  assert.deepEqual(body(), [['Mês','Entradas','Saídas'],['set/26','7','4'],['out/26','0','2']]);
  h.input('Filtrar tabela por grupo').props.onChange({ target: { value: 'Entrada' } });
  assert.deepEqual(body(), [['Mês','Entradas','Saídas'],['set/26','7','0']]);
 } finally { h.dispose(); }
});

test('report period on screen and in exports reflects whether the subject applies dates', async () => {
 const h = harness(), props = { ...base, available: ['projects', 'materials', 'loans'], from: '2026-10-01' };
 try {
  h.render(props);
  for (const dataset of props.available) {
   h.input('Assunto do relatório').props.onChange({ target: { value: dataset } });
   h.render(props); h.flushEffects();
   const request = h.requests.at(-1);
   assert.equal(new URL(request.url, 'https://synthetic.example.invalid').searchParams.get('from'), props.from);
   request.resolve({ ok: true, json: async () => ({ dataset, rows: [row('a')], truncated: false }) });
   await tick(); h.render(props);
   const period = dataset === 'loans' ? 'A partir de 01/10/2026' : 'Posição atual (sem filtro de período)';
   assert.ok(h.text().includes(period));
   assert.equal((await jsonDownload(h)).filtros.Período, period);
  }
 } finally { h.dispose(); }
});

test('a new successful response enables exports only with matching scope metadata and current rows', async () => {
 const h = harness(), next = { ...base, projectId: 'project-b', scopeLabel: 'Projeto B' }; try {
  await load(h); h.render(next); assert.equal(h.button('JSON').props.disabled, true); h.flushEffects();
  h.requests.at(-1).resolve({ ok: true, json: async () => ({ dataset: 'materials', rows: [row('b')], truncated: false }) }); await tick(); h.render(next);
  assert.equal(h.button('JSON').props.disabled, false); const exported = await jsonDownload(h);
  assert.equal(exported.filtros.Recorte, 'Projeto B'); assert.equal(exported.linhas[0].projeto, 'Projeto B'); assert.equal(JSON.stringify(exported).includes('Material A'), false);
 } finally { h.dispose(); }
});

test('a failed response clears stale rows, stays distinct from an empty report, and can retry the same scope', async () => {
 const h = harness(), next = { ...base, projectId: 'project-b', scopeLabel: 'Projeto B' }; try {
  await load(h); h.render(next); h.flushEffects(); h.requests.at(-1).resolve({ ok: false, json: async () => ({ error: 'Falha sintética da consulta' }) }); await tick(); h.render(next);
  for (const name of exportNames) assert.equal(h.button(name).props.disabled, true, name);
  assert.match(h.text(), /Falha sintética/); assert.equal(h.text().includes('Material A'), false); assert.equal(h.downloads.length, 0);
  assert.match(h.text(), /consulta indisponível/);
  assert.doesNotMatch(h.text(), /Nada para mostrar neste recorte/);
  const failedRequest = h.requests.at(-1);
  h.button('Tentar carregar relatório novamente').props.onClick(); h.render(next); h.flushEffects();
  const retry = h.requests.at(-1);
  assert.notEqual(retry, failedRequest);
  assert.equal(retry.url, failedRequest.url);
  assert.equal(h.button('JSON').props.disabled, true);
  retry.resolve({ ok: true, json: async () => ({ dataset: 'materials', rows: [], truncated: false }) });
  await tick(); h.render(next);
  assert.match(h.text(), /Nada para mostrar neste recorte/);
  assert.doesNotMatch(h.text(), /Falha sintética|consulta indisponível/);
 } finally { h.dispose(); }
});

test('a blocked print is announced beside export actions while the loaded rows stay usable', async () => {
 const h = harness(); try {
  await load(h);
  h.button('Imprimir').props.onClick();
  const exportOptions = nodesInside(h.render()).find(node => node.type === 'details' && text(node.props.children?.[0]) === 'Exportar linhas deste recorte');
  assert.match(text(nodesInside(exportOptions).find(node => node.props?.role === 'alert')), /bloqueou a janela/);
  assert.match(h.text(), /Material A/);
  assert.equal(h.button('Excel').props.disabled, false);
  assert.doesNotMatch(h.text(), /consulta indisponível/);
 } finally { h.dispose(); }
});

test('an aborted response whose JSON resolves late cannot replace a newer successful scope', async () => {
 const h = harness(), b = { ...base, projectId: 'project-b', scopeLabel: 'Projeto B' }, c = { ...base, projectId: 'project-c', scopeLabel: 'Projeto C' }; let resolveBody;
 try {
  await load(h); h.render(b); h.flushEffects(); const oldRequest = h.requests.at(-1), deferred = new Promise(resolve => { resolveBody = resolve; }); oldRequest.resolve({ ok: true, json: () => deferred }); await tick();
  h.render(c); h.flushEffects(); assert.equal(oldRequest.init.signal.aborted, true);
  h.requests.at(-1).resolve({ ok: true, json: async () => ({ dataset: 'materials', rows: [row('c')], truncated: false }) }); await tick(); h.render(c);
  resolveBody({ dataset: 'materials', rows: [row('b')], truncated: false }); await tick(); h.render(c);
  const exported = await jsonDownload(h); assert.equal(exported.filtros.Recorte, 'Projeto C'); assert.equal(exported.linhas[0].projeto, 'Projeto C'); assert.equal(JSON.stringify(exported).includes('Material B'), false);
 } finally { h.dispose(); }
});

test('deselecting every column blocks exports instead of silently including hidden fields', async () => {
 const h = harness(); try {
  await load(h);
  for (;;) { const selected = h.columnToggles().find(input => input.props.checked); if (!selected) break; selected.props.onChange(); h.render(); }
  for (const name of exportNames) assert.equal(h.button(name).props.disabled, true, name);
  assert.match(h.text(), /Escolha ao menos uma coluna/);
  h.button('PDF').props.onClick(); h.button('Word').props.onClick(); h.button('Imprimir').props.onClick(); await tick(); assert.equal(h.downloads.length, 0); assert.equal(h.opened, 0);
  h.columnToggles()[0].props.onChange(); h.render(); assert.equal(h.button('JSON').props.disabled, false);
  const exported = await jsonDownload(h); assert.deepEqual(Object.keys(exported.linhas[0]), ['projeto']); assert.equal(exported.linhas[0].projeto, 'Projeto A'); assert.equal(JSON.stringify(exported.linhas).includes('Material A'), false);
 } finally { h.dispose(); }
});

const detailedProps={...base,available:['outflows','outflow_details'],initialDataset:'outflow_details'};
const tracedRow={id:'movement:synthetic',projeto:'Projeto A',data_saida:'2026-10-04',acao:'Feira institucional',material:'Kit institucional',unidade_medida:'kit',tipo:'distribute',quantidade:3,registrado_por:'Operador sintético',situacao_retorno:'not_applicable',saldo_atual:13,finalidade_registrada:'PRIVATE FREE TEXT'};
async function respondDetails(h,rows=[tracedRow]){h.requests.at(-1).resolve({ok:true,json:async()=>({dataset:'outflow_details',rows,truncated:false})});await tick();h.render(detailedProps);}

test('traceable outflow notes require an explicit query and column selection and are cleared before a different query can export',async()=>{
 const h=harness();try{
  h.render(detailedProps);h.flushEffects();assert.equal(new URL('https://fixture.invalid'+h.requests.at(-1).url).searchParams.has('includeNotes'),false);await respondDetails(h);
  assert.ok(!JSON.stringify(await jsonDownload(h)).includes('PRIVATE FREE TEXT'));
  h.input('Disponibilizar motivos').props.onChange({target:{checked:true}});h.render(detailedProps);assert.equal(h.button('JSON').props.disabled,true);h.flushEffects();
  assert.equal(new URL('https://fixture.invalid'+h.requests.at(-1).url).searchParams.get('includeNotes'),'1');await respondDetails(h);
  assert.ok(!JSON.stringify(await jsonDownload(h)).includes('PRIVATE FREE TEXT'),'consulting text does not select it for export');
  h.input('Motivo/finalidade registrada').props.onChange();h.render(detailedProps);
  const selected=await jsonDownload(h);assert.equal(selected.linhas[0].finalidade_registrada,'PRIVATE FREE TEXT');assert.match(selected.filtros['Textos livres'],/opcional/);
  h.input('Disponibilizar motivos').props.onChange({target:{checked:false}});h.render(detailedProps);assert.equal(h.button('JSON').props.disabled,true);assert.ok(!h.text().includes('PRIVATE FREE TEXT'));
 }finally{h.dispose();}
});

test('traceable outflow filters travel to the server, immediately disable stale exports and never offer sums of repeated current balances',async()=>{
 const h=harness();try{
  h.render(detailedProps);h.flushEffects();await respondDetails(h);
  assert.ok(!text(h.input('Medida')).includes('saldo atual'));assert.ok(!text(h.input('Medida')).includes('reservado atual'));
  h.input('Tipo de saída').props.onChange({target:{value:'loan'}});h.render(detailedProps);assert.equal(h.button('Excel').props.disabled,true);h.flushEffects();
  assert.equal(new URL('https://fixture.invalid'+h.requests.at(-1).url).searchParams.get('outflowType'),'loan');
  await respondDetails(h,[{...tracedRow,id:'loan:synthetic',tipo:'loan',quantidade:1,unidade_medida:'unidade',situacao_retorno:'out'}]);
  h.input('Situação da devolução').props.onChange({target:{value:'returned'}});h.render(detailedProps);assert.equal(h.button('JSON').props.disabled,true);h.flushEffects();
  assert.equal(new URL('https://fixture.invalid'+h.requests.at(-1).url).searchParams.get('returnState'),'returned');
  await respondDetails(h,[{...tracedRow,id:'loan:returned',tipo:'loan',quantidade:1,unidade_medida:'unidade',situacao_retorno:'returned'}]);
  const result=await jsonDownload(h);assert.equal(result.filtros['Tipo de saída'],'Retirada de equipamento');assert.equal(result.filtros['Devolução'],'Devolvido');assert.equal(result.linhas.length,1);assert.equal(result.linhas[0].quantidade,1);
 }finally{h.dispose();}
});
test('independent: malformed successful report JSON is an explicit failure rather than an empty successful query',async()=>{
 const failures=[];
 for(const body of [
  async()=>{throw new SyntaxError('Synthetic malformed JSON');},
  async()=>({dataset:'outflow_details',rows:'not-an-array',truncated:false}),
  async()=>({dataset:'loans',rows:[tracedRow],truncated:false}),
  async()=>({dataset:'outflow_details',rows:[tracedRow],truncated:'false'}),
  async()=>({dataset:'outflow_details',rows:[null],truncated:false}),
 ]){
  const h=harness();try{h.render(detailedProps);h.flushEffects();h.requests.at(-1).resolve({ok:true,json:body});await tick();h.render(detailedProps);
   for(const name of exportNames)assert.equal(h.button(name).props.disabled,true,name);
   failures.push(/não foi possível|inválid|incomplet/i.test(h.text()));
  }finally{h.dispose();}
 }
 assert.deepEqual(failures,[true,true,true,true,true],'invalid JSON, dataset, rows or coverage must be presented as data failures, not zero rows');
});
test('the report offers XLSX, PDF and Word and marks partial XLSX in the filename and metadata',async()=>{
 const h=harness();try{h.render(detailedProps);h.flushEffects();h.requests.at(-1).resolve({ok:true,json:async()=>({dataset:'outflow_details',rows:[tracedRow],truncated:true})});await tick();h.render(detailedProps);
  for(const name of ['Excel','PDF','Word']) assert.equal(h.button(name).props.disabled,false);
  assert.ok(!nodesInside(h.render(detailedProps)).some(node=>node.type==='button'&&text(node)==='CSV'));
  const json=await jsonDownload(h);assert.match(json.filtros.Cobertura,/parcial/);
  h.button('Excel').props.onClick();
  const xlsx=h.downloads.at(-1),entries=await zipEntries(xlsx.blob);
  assert.match(xlsx.name,/-parcial\.xlsx$/);
  assert.match(entries.get('xl/worksheets/sheet2.xml'),/Consulta parcial/);
 }finally{h.dispose();}
});

test('project summary buttons download the same authorized singleton in each format without a preliminary query', async () => {
 const row = {id:'project-a',projeto:'Projeto A',abrangencia:'internal',etapa:'past',materiais:0};
 const h = harness();
 try {
  const report = h.renderProject(row.id);
  assert.equal(h.requests.length,0);
  const masthead = nodesInside(report).find(node => node.type?.name === 'ReportMasthead');
  assert.match(masthead.props.description,/Ficha e totais da posição atual/);
  for (const [button, ext] of [['Excel (XLSX)','xlsx'],['Word (DOCX)','docx'],['PDF','pdf']]) {
   h.button(button).props.onClick();
   const request = h.requests.at(-1);
   const query = new URL(request.url,'https://synthetic.example.invalid').searchParams;
   assert.deepEqual(Object.fromEntries(query),{dataset:'projects',projectId:row.id});
   h.renderProject(row.id);
   assert.equal(h.button(button).props.disabled,true);
   request.resolve({ok:true,json:async()=>({dataset:'projects',rows:[row],truncated:false})});
   await tick();
   h.renderProject(row.id);
   const exported = h.downloads.at(-1);
   assert.equal(exported.name.split('.').at(-1),ext);
   assert.equal(h.button(button).props.disabled,false);
   if (ext !== 'pdf') assert.match(await exported.blob.text(),/Projeto A/);
  }
  const [,columns,pdfRows,formatValue,metadata] = h.pdfInputs[0];
  assert.equal(columns.some(column=>column.key==='local'),false,'use the same default columns as the central report');
  assert.equal(pdfRows[0],row);
  assert.equal(formatValue(row,'materiais'),0);
  assert.equal(formatValue(row,'emprestimos'),'');
  assert.equal(formatValue(row,'etapa'),'Encerrado');
  assert.ok(metadata.some(([label,value])=>label==='Recorte'&&value==='Projeto A'));
 } finally { h.dispose(); }
});

test('the project report links only to spreadsheets already available in the project', () => {
 const h = harness(), linked = tree => nodesInside(tree).find(node => node.type === 'a' && node.props.href === '#project-spreadsheets');
 try {
  assert.equal(linked(h.renderProject('project-a')), undefined);
  assert.equal(text(linked(h.renderProject('project-a', { hasLinkedSpreadsheets: true }))), 'Planilhas do projeto');
 } finally { h.dispose(); }
});

test('project summary never downloads absent, mixed, partial, unauthorized or detached project results', async () => {
 const h=harness(),projectId='project-a';
 try {
  const same={id:projectId,projeto:'Projeto A'};
  const foreign={id:'project-b',projeto:'Projeto B'};
  const body=(rows,truncated=false)=>({dataset:'projects',rows,truncated});
  const results=[
   [true,body([]),/indisponível/],
   [true,body([foreign]),/não corresponde/],
   [true,body([same,foreign]),/não corresponde/],
   [true,body([same],true),/não corresponde/],
   [false,{error:{message:'Acesso revogado'}},/Acesso revogado/],
  ];
  for (const [ok,value,alert] of results) {
   h.renderProject(projectId);
   h.button('Excel (XLSX)').props.onClick();
   h.requests.at(-1).resolve({ok,json:async()=>value});
   await tick();
   h.renderProject(projectId);
   assert.match(h.text(),alert);
   assert.equal(h.downloads.length,0);
  }
  const section=h.renderProject(projectId);
  h.button('Word (DOCX)').props.onClick();
  const abandoned=h.requests.at(-1);
  section.props.ref(null);
  assert.equal(abandoned.init.signal.aborted,true);
  abandoned.resolve({ok:true,json:async()=>body([same])});
  await tick();
  assert.equal(h.downloads.length,0);
 } finally { h.dispose(); }
});

test('project preview and PDF share the verified project metrics and distinguish zero from missing data', async () => {
 const h = harness(), projectId = 'project-a';
 const row = {id:projectId,projeto:'Projeto A',materiais:0,eventos:3,marcos_agenda:2,emprestimos:null};
 const resolveProject = async () => {
  h.requests.at(-1).resolve({ok:true,json:async()=>({dataset:'projects',rows:[row],truncated:false})});
  await tick();
  return h.renderProject(projectId);
 };
 try {
  h.renderProject(projectId);
  h.button('Ver prévia').props.onClick();
  const preview = await resolveProject();
  const indicators = nodesInside(preview).find(node => node.type?.name === 'ReportMetrics');
  const expected = [{label:'Materiais',value:0},{label:'Dinâmicas',value:3},{label:'Empréstimos',value:null},{label:'Registros',value:null}];
  assert.deepEqual(JSON.parse(JSON.stringify(indicators.props.metrics)),expected);
  assert.match(text(indicators.type(indicators.props)),/Materiais0Dinâmicas3EmpréstimosNão informadoRegistrosNão informado/);
  assert.match(text(preview), /Marcos na Agenda2/);
  assert.equal(h.downloads.length,0);
  assert.equal(h.button('Ocultar prévia').props['aria-expanded'],true);

  h.button('PDF').props.onClick();
  await resolveProject();
  assert.equal(h.requests.length,2,'export revalidates the project even with a preview');
  assert.deepEqual(JSON.parse(JSON.stringify(h.pdfInputs[0][5].presentation)),{projectName:'Projeto A',metrics:expected});

  h.button('Excel (XLSX)').props.onClick();
  h.requests.at(-1).resolve({ok:false,json:async()=>({error:{message:'Acesso revogado'}})});
  await tick();
  const denied = h.renderProject(projectId);
  assert.match(h.text(),/Acesso revogado/);
  assert.equal(nodesInside(denied).some(node => node.type?.name === 'ReportMetrics'),false);
  assert.equal(h.downloads.length,1);
 } finally { h.dispose(); }
});

test('missing report values remain blank in exports while real zero survives', async () => {
 const h = harness();
 try {
  h.render(); h.flushEffects();
  h.requests.at(-1).resolve({ok:true,json:async()=>({dataset:'materials',rows:[{...row('a'),saldo:null,disponivel:0}],truncated:false})});
  await tick();
  h.render();
  const file = await jsonDownload(h);
  assert.equal(file.linhas[0].saldo,null);
  assert.equal(file.linhas[0].disponivel,0);
 } finally { h.dispose(); }
});

test('only the canonical Rolê project receives its mark with the official page or a blank source', async () => {
 const h = harness(), id = 'role-da-extensao', duplicate = 'ac2e5e32-d4f7-4894-b177-b33383e10f3b';
 const projectName = 'Rolê da Extensão', officialUrl = 'https://proex.ufg.br/p/60194-role-da-extensao';
 const brand = tree => nodesInside(tree).find(node => node.type?.name === 'ReportMasthead').props.projectBrand;
 try {
  assert.equal(brand(h.renderProject(duplicate,{projectName,officialUrl})),undefined);
  assert.equal(brand(h.renderProject(id,{projectName,officialUrl:'https://proex.ufg.br.invalid/p/60194-role-da-extensao'})),undefined);
  assert.equal(brand(h.renderProject(id,{projectName,officialUrl:'https://proex.ufg.br/p/outro-projeto'})),undefined);
  assert.equal(brand(h.renderProject(id,{projectName:'Outro projeto',officialUrl})),undefined);
  assert.equal(brand(h.renderProject(id,{projectName,officialUrl})),'role-da-extensao');
  assert.equal(brand(h.renderProject(id,{projectName,officialUrl:null})),'role-da-extensao');
  h.button('PDF').props.onClick();
  h.requests.at(-1).resolve({ok:true,json:async()=>({dataset:'projects',rows:[{id,projeto:projectName}],truncated:false})});
  await tick();
  assert.equal(h.pdfInputs[0][5].presentation.projectBrand,'role-da-extensao');
 } finally { h.dispose(); }

 const center = harness();
 try {
  const projectIdentity = {id,name:projectName,official_url:null};
  assert.equal(brand(center.render({...base,projectId:id,projectIdentity})),'role-da-extensao');
  assert.equal(brand(center.render({...base,projectId:duplicate,projectIdentity})),undefined);
  assert.equal(brand(center.render({...base,projectId:duplicate,projectIdentity:{...projectIdentity,id:duplicate,official_url:officialUrl}})),undefined);
 } finally { center.dispose(); }
});

test('the CONPEEX mark requires the official project ID, edition and address for preview and PDF', async () => {
 const h = harness(), projectId = 'ad875870-a443-4f47-9c06-5dd0a6178de0';
 const projectName = '23º CONPEEX — Congresso de Pesquisa, Ensino e Extensão';
 const officialSource = 'https://23conpeex.plateia.ufg.br/';
 const currentBrand = (officialUrl, name = projectName, id = projectId) => nodesInside(h.renderProject(id,{projectName:name,officialUrl}))
  .find(node => node.type?.name === 'ReportMasthead').props.projectBrand;
 try {
  assert.equal(currentBrand(officialSource),'conpeex-2026');
  assert.equal(currentBrand('https://ufg.br/e/39456-23-congresso-de-pesquisa-ensino-e-extensao-conpeex'),'conpeex-2026');
  assert.equal(currentBrand(officialSource,'22º CONPEEX'),undefined);
  assert.equal(currentBrand('https://23conpeex.plateia.ufg.br.invalid/'),undefined);
  assert.equal(currentBrand('https://user@23conpeex.plateia.ufg.br/'),undefined);
  assert.equal(currentBrand('https://ufg.br/'),undefined);
  assert.equal(currentBrand(officialSource,projectName,'clone-project'),undefined);
  h.button('PDF').props.onClick();
  h.requests.at(-1).resolve({ok:true,json:async()=>({dataset:'projects',rows:[{id:'clone-project',projeto:projectName}],truncated:false})});
  await tick();
  assert.equal(h.pdfInputs[0][5].presentation.projectBrand,undefined);
  currentBrand(officialSource);
  h.button('PDF').props.onClick();
  h.requests.at(-1).resolve({ok:true,json:async()=>({dataset:'projects',rows:[{id:projectId,projeto:projectName}],truncated:false})});
  await tick();
  assert.equal(h.pdfInputs[1][5].presentation.projectBrand,'conpeex-2026');
 } finally { h.dispose(); }
});

test('report presets and unsaved search are isolated across account changes before any effects', () => {
 const legacy = 'proex.reports.presets.v1';
 const ownerKey = 'proex.reports.presets.v2:report-user';
 const nextKey = 'proex.reports.presets.v2:other%3Auser';
 const preset = (name, search) => JSON.stringify([{name,search,dataset:'materials',columns:['projeto'],groupBy:'projeto',measure:'__count__'}]);
 const storage = new Map([[legacy,preset('Modelo compartilhado','termo legado')],[ownerKey,preset('Modelo da primeira pessoa','termo privado')],[nextKey,preset('Modelo da segunda pessoa','pesquisa própria')]]);
 const h = harness(storage), second = {...base,userId:'other:user'};
 const field = (tree, label) => nodesInside(tree).find(node => node.props?.['aria-label'] === label);
 const form = tree => nodesInside(tree).find(node => node.type === 'form' && field(node,'Nome do modelo'));
 try {
  h.render(); h.flushEffects();
  let tree = h.render();
  assert.equal(storage.has(legacy),false);
  assert.ok(h.button('Modelo da primeira pessoa'));
  assert.equal(h.text().includes('Modelo compartilhado'),false);
  h.button('Modelo da primeira pessoa').props.onClick();
  tree = h.render();
  assert.equal(h.input('Buscar nas linhas').props.value,'termo privado');
  field(tree,'Nome do modelo').props.onChange({target:{value:'rascunho privado'}});
  tree = h.render(second);
  assert.equal(h.text().includes('Modelo da primeira pessoa'),false);
  assert.equal(h.input('Buscar nas linhas').props.value,'');
  assert.equal(field(tree,'Nome do modelo').props.value,'');
  assert.equal(h.button('Salvar').props.disabled,true);
  form(tree).props.onSubmit({preventDefault(){}});
  assert.equal(storage.get(nextKey),preset('Modelo da segunda pessoa','pesquisa própria'));

  h.flushEffects();
  tree = h.render(second);
  assert.ok(h.button('Modelo da segunda pessoa'));
  field(tree,'Nome do modelo').props.onChange({target:{value:'Novo modelo'}});
  h.input('Buscar nas linhas').props.onChange({target:{value:'novo termo'}});
  tree = h.render(second);
  form(tree).props.onSubmit({preventDefault(){}});
  assert.equal(JSON.parse(storage.get(nextKey))[0].search,'novo termo');
  assert.equal(storage.get(ownerKey),preset('Modelo da primeira pessoa','termo privado'));
  h.render(); h.flushEffects(); h.render();
  assert.ok(h.button('Modelo da primeira pessoa'));
  assert.equal(h.text().includes('Novo modelo'),false);
 } finally { h.dispose(); }
});
