import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const transpile = file => ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function pure(file) { const compiledModule = { exports: {} }; vm.runInNewContext(transpile(file), { module: compiledModule, exports: compiledModule.exports, Blob, TextEncoder, Uint8Array, DataView, ArrayBuffer }); return compiledModule.exports; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const exportNames = ['Excel', 'PDF', 'Word', 'CSV', 'JSON', 'Imprimir'];
const base = { projectId: 'project-a', unitId: '', area: '', from: '', to: '', scopeLabel: 'Projeto A', available: ['materials', 'loans'] };
const row = project => ({ id: `item-${project}`, projeto: `Projeto ${project.toUpperCase()}`, material: `Material ${project.toUpperCase()}`, classe: 'gift', unidade_medida: 'unidade', saldo: 9, reservado: 0, disponivel: 9 });

/** Run the real TSX and exporters with a minimal hook scheduler and virtual DOM.
 * Fetch and effects are separately controlled so the render BEFORE effect cleanup
 * and responses whose body resolves AFTER abort can both be exercised deterministically.
 * No DOM, network, filesystem writes or framework build is involved.
 */
function harness() {
 const slots = [], pendingEffects = [], requests = [], downloads = []; let index = 0, tree, opened = 0;
 const same = (left, right) => left?.length === right?.length && left?.every((value, i) => Object.is(value, right[i]));
 const hooks = {
  useState(initial) { const key = index++; if (!(key in slots)) slots[key] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[key].value, next => { slots[key].value = typeof next === 'function' ? next(slots[key].value) : next; }]; },
  useRef(initial) { const key = index++; slots[key] ??= { value: { current: initial } }; return slots[key].value; },
  useMemo(callback) { index++; return callback(); },
  useEffect(callback, deps) { const key = index++; if (!same(slots[key]?.deps, deps)) pendingEffects.push(() => { slots[key]?.cleanup?.(); slots[key] = { deps, cleanup: callback() }; }); },
 };
 const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
 const exporters = pure('components/portal/report-export.ts'); exporters.download = (name, blob) => downloads.push({ name, blob });
 const require = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsx : name === './report-export' ? exporters : name === '@/lib/report-quantities' ? pure('lib/report-quantities.ts') : name === '@/lib/extension-catalog' ? { areaLabel: value => value } : name.endsWith('.css') ? { default: new Proxy({}, { get: (_object, key) => key }) } : new Proxy({}, { get: (_object, key) => String(key) });
 const compiledModule = { exports: {} };
 const window = { setTimeout(callback) { callback(); return 1; }, clearTimeout() {}, open() { opened++; return null; } };
 vm.runInNewContext(transpile('components/portal/reports-center.tsx'), { module: compiledModule, exports: compiledModule.exports, require, Blob, Intl, Date, Map, Set, URLSearchParams, AbortController, window, localStorage: { getItem: () => null }, fetch: (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })) });
 function nodes() { const result = []; const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } result.push(node); visit(node.props?.children); }; visit(tree); return result; }
 return {
  requests, downloads,
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
async function load(h, project = 'a', props = base) { h.render(props); h.flushEffects(); h.requests.at(-1).resolve({ ok: true, json: async () => ({ rows: [row(project)] }) }); await tick(); h.render(props); }
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
  h.render(base); h.button('Empréstimos').props.onClick(); h.render(base);
  for (const name of exportNames) assert.equal(h.button(name).props.disabled, true, `${name}: dataset`);
 } finally { h.dispose(); }
});

test('a new successful response enables exports only with matching scope metadata and current rows', async () => {
 const h = harness(), next = { ...base, projectId: 'project-b', scopeLabel: 'Projeto B' }; try {
  await load(h); h.render(next); assert.equal(h.button('JSON').props.disabled, true); h.flushEffects();
  h.requests.at(-1).resolve({ ok: true, json: async () => ({ rows: [row('b')] }) }); await tick(); h.render(next);
  assert.equal(h.button('JSON').props.disabled, false); const exported = await jsonDownload(h);
  assert.equal(exported.filtros.Recorte, 'Projeto B'); assert.equal(exported.linhas[0].projeto, 'Projeto B'); assert.equal(JSON.stringify(exported).includes('Material A'), false);
 } finally { h.dispose(); }
});

test('a failed response clears previous rows and cannot export the previous project', async () => {
 const h = harness(), next = { ...base, projectId: 'project-b', scopeLabel: 'Projeto B' }; try {
  await load(h); h.render(next); h.flushEffects(); h.requests.at(-1).resolve({ ok: false, json: async () => ({ error: 'Falha sintética da consulta' }) }); await tick(); h.render(next);
  for (const name of exportNames) assert.equal(h.button(name).props.disabled, true, name);
  assert.match(h.text(), /Falha sintética/); assert.equal(h.text().includes('Material A'), false); assert.equal(h.downloads.length, 0);
 } finally { h.dispose(); }
});

test('an aborted response whose JSON resolves late cannot replace a newer successful scope', async () => {
 const h = harness(), b = { ...base, projectId: 'project-b', scopeLabel: 'Projeto B' }, c = { ...base, projectId: 'project-c', scopeLabel: 'Projeto C' }; let resolveBody;
 try {
  await load(h); h.render(b); h.flushEffects(); const oldRequest = h.requests.at(-1), deferred = new Promise(resolve => { resolveBody = resolve; }); oldRequest.resolve({ ok: true, json: () => deferred }); await tick();
  h.render(c); h.flushEffects(); assert.equal(oldRequest.init.signal.aborted, true);
  h.requests.at(-1).resolve({ ok: true, json: async () => ({ rows: [row('c')] }) }); await tick(); h.render(c);
  resolveBody({ rows: [row('b')] }); await tick(); h.render(c);
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
  h.input('Tipo de saída').props.onChange({target:{value:'loan'}});h.render(detailedProps);assert.equal(h.button('CSV').props.disabled,true);h.flushEffects();
  assert.equal(new URL('https://fixture.invalid'+h.requests.at(-1).url).searchParams.get('outflowType'),'loan');
  await respondDetails(h,[{...tracedRow,id:'loan:synthetic',tipo:'loan',quantidade:1,unidade_medida:'unidade',situacao_retorno:'out'}]);
  h.input('Situação da devolução').props.onChange({target:{value:'returned'}});h.render(detailedProps);assert.equal(h.button('JSON').props.disabled,true);h.flushEffects();
  assert.equal(new URL('https://fixture.invalid'+h.requests.at(-1).url).searchParams.get('returnState'),'returned');
  await respondDetails(h,[{...tracedRow,id:'loan:returned',tipo:'loan',quantidade:1,unidade_medida:'unidade',situacao_retorno:'returned'}]);
  const result=await jsonDownload(h);assert.equal(result.filtros['Tipo de saída'],'Retirada de equipamento');assert.equal(result.filtros['Devolução'],'Devolvido');assert.equal(result.linhas.length,1);assert.equal(result.linhas[0].quantidade,1);
 }finally{h.dispose();}
});