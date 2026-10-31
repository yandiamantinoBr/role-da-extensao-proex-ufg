import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url), tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const props = { kind: 'asset', defaultProjectId: 'project-a', projects: [{ id: 'project-a', name: 'Projeto A' }, { id: 'project-b', name: 'Projeto B' }], items: [], canWrite: () => true };
const preview = { projectId: 'project-a', itemId: null, reviewToken: 'synthetic-reviewed-document', provenance: { label: 'Documento sintético', retrievedAt: '2026-10-31T12:00:00Z', extraction: 'text-file' }, candidates: [{ key: 'row-1', fields: { name: 'Equipamento A', assetCode: '000123' }, problems: {}, warnings: [] }] };
function harness() {
 const slots = [], requests = [], cache = new Map(); let index = 0, tree, currentProps = props;
 const hooks = {
  useState(initial) { const key = index++; if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial; return [slots[key], value => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }]; },
  useRef(initial) { const key = index++; slots[key] ??= { current: initial }; return slots[key]; },
 };
 const jsx = { jsx: (type, attrs) => ({ type, props: attrs }), jsxs: (type, attrs) => ({ type, props: attrs }) };
 function load(file) {
  if (cache.has(file)) return cache.get(file);
  const compiledModule = { exports: {} }; cache.set(file, compiledModule.exports);
  const require = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsx : name === 'lucide-react' ? new Proxy({}, { get: (_object, key) => String(key) }) : name.endsWith('.css') ? { default: new Proxy({}, { get: (_object, key) => key }) } : load(name.startsWith('@/') ? `${name.slice(2)}.ts` : `${path.posix.normalize(path.posix.join(path.posix.dirname(file), name))}.ts`);
  const source = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { module: compiledModule, exports: compiledModule.exports, require, Error, Date, TextEncoder, TextDecoder, Uint8Array, AbortController, FormData, File, crypto, window: { setTimeout: () => 1, clearTimeout() {} }, fetch: (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })) }); return compiledModule.exports;
 }
 const Component = load('components/portal/assisted-import-panel.tsx').default;
 function nodes() { const result = []; const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } result.push(node); visit(node.props?.children); }; visit(tree); return result; }
 const h = {
  requests,
  render(nextProps = currentProps) { currentProps = nextProps; index = 0; tree = Component(currentProps); return tree; },
  find(type, predicate) { const found = nodes().find(node => node.type === type && predicate(node)); assert.ok(found, type); return found; },
  button(label) { return h.find('button', node => text(node).trim() === label); },
  chooseFile(file) { h.find('input', node => node.props.type === 'file').props.onChange({ currentTarget: { files: [file], value: file.name } }); h.render(); },
  content() { return h.find('textarea', () => true).props.value; },
  alerts() { return nodes().filter(node => node.props?.role === 'alert').map(text); },
  text() { return text(tree); },
 };
 h.render(); h.button('Abrir importação').props.onClick(); h.render();
 h.find('select', node => node.props.children.some?.(child => child?.props?.value === 'document')).props.onChange({ target: { value: 'document' } }); h.render();
 return h;
}
const file = (name, content = 'Nome: Equipamento A\nTombamento: 000123') => new File([content], name, { type: 'text/plain' });
function deferredFile(name) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); const value = file(name); value.text = () => promise; return { value, resolve, reject }; }

test('selecting an invalid replacement clears the former file and cannot submit its stale content', async () => {
 for (const invalid of [file('not-supported.exe'), file('too-large.txt', 'x'.repeat(256 * 1024 + 1))]) {
  const h = harness(); h.chooseFile(file('accepted-a.txt')); await tick(); h.render(); assert.match(h.text(), /Selecionado: accepted-a.txt/);
  h.chooseFile(invalid); await tick(); h.render(); assert.equal(h.text().includes('accepted-a.txt'), false); assert.equal(h.content(), '');
  assert.match(h.text(), /Use PDF|256 KiB/); h.button('Preparar prévia').props.onClick(); await tick(); h.render();
  assert.equal(h.requests.length, 0); assert.match(h.text(), /documento válido ou informe o conteúdo/); assert.ok(h.find('input', node => node.props.type === 'file'));
 }
});
test('file reading disables preparation and an older read cannot clear the latest pending read or overwrite its result', async () => {
 const h = harness(), a = deferredFile('document-a.txt'), b = deferredFile('document-b.txt');
 h.chooseFile(a.value); assert.equal(h.button('Preparar prévia').props.disabled, true); assert.match(h.text(), /Lendo o documento/);
 h.button('Preparar prévia').props.onClick(); await tick(); assert.equal(h.requests.length, 0);
 // Simulate a queued second change event while the first File.text() is pending.
 h.chooseFile(b.value); a.resolve('Nome: Não usar A'); await tick(); h.render(); assert.equal(h.button('Preparar prévia').props.disabled, true);
 b.resolve('Nome: Usar documento B'); await tick(); h.render(); assert.equal(h.button('Preparar prévia').props.disabled, false); assert.equal(h.content(), 'Nome: Usar documento B'); assert.match(h.text(), /Selecionado: document-b.txt/); assert.equal(h.text().includes('document-a.txt'), false);
});
test('a failed older read cannot replace the selected newer file or display a stale error', async () => {
 const h = harness(), a = deferredFile('old-a.txt'); h.chooseFile(a.value); h.chooseFile(file('new-b.txt', 'Nome: Equipamento B')); await tick(); h.render();
 a.reject(new Error('old file failed')); await tick(); h.render(); assert.equal(h.content(), 'Nome: Equipamento B'); assert.match(h.text(), /Selecionado: new-b.txt/); assert.equal(h.alerts().length, 0); assert.equal(h.button('Preparar prévia').props.disabled, false);
});
test('changing the global context preserves the reviewed destination and source, with a visible warning', async () => {
 const h = harness(); h.chooseFile(file('source-a.txt')); await tick(); h.render(); h.button('Preparar prévia').props.onClick(); await tick();
 assert.equal(h.requests[0].init.body.get('projectId'), 'project-a'); h.requests[0].resolve({ ok: true, json: async () => preview }); await tick(); h.render(); assert.match(h.text(), /Destino: Projeto A/);
 h.render({ ...props, defaultProjectId: 'project-b' }); assert.match(h.text(), /filtro geral mostra Projeto B/); assert.match(h.text(), /continua destinada a Projeto A/); assert.match(h.text(), /Destino: Projeto A/); assert.equal(h.button('Confirmar e salvar').props.disabled, true);
 h.button('Voltar à fonte').props.onClick(); h.render(); assert.match(h.text(), /Selecionado: source-a.txt/); assert.equal(h.requests.length, 1);
});
