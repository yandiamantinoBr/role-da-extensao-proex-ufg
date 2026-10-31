import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise(resolve => setImmediate(resolve));
const source = readFileSync(new URL('../components/portal/material-detail-drawer.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';

function harness(canUploadPhotos = true) {
  const slots = [], effects = [], clicks = [], requests = [];
  let index = 0, tree, decode;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return slots[slot] ??= { current: initial }; },
    useCallback(fn) { return fn; },
    useEffect(fn) { const slot = index++; if (!(slot in slots)) { slots[slot] = true; effects.push(fn); } },
  };
  const jsx = (type, props) => ({ type, props });
  const compiled = { exports: {} };
  const detail = { item: { id: 'synthetic-item', project_id: 'synthetic-project', name: 'Material sintético', category: 'gift', stock: 1, reserved: 0, low_stock: 0, unit: 'unidade', version: 1, condition: 'active', description: '' }, category: null, categories: [], photos: [], movements: [], versions: [], nextCursor: null, availability: { available: 1 }, permissions: { canManage: true, canUploadPhotos } };
  const url = { createObjectURL: () => 'blob:synthetic-preview', revokeObjectURL() {} };
  vm.runInNewContext(`${code}\nmodule.exports.MaterialDialogForTest = MaterialDialog;`, {
    module: compiled, exports: compiled.exports,
    require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === 'lucide-react' ? new Proxy({}, { get: (_, key) => String(key) }) : name.endsWith('.css') ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : { default: () => null },
    fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => detail }; },
    window: { Image: class { decode() { return new Promise(resolve => { decode = resolve; }); } } },
    File, URL: url, Error, Date, FormData, crypto,
  });
  function nodes() { const all = []; function visit(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); all.push(node); visit(node.props?.children); } visit(tree); return all; }
  function render() {
    index = 0;
    tree = compiled.exports.MaterialDialogForTest({ itemId: 'synthetic-item', onClose() {} });
    for (const node of nodes()) if (node.props.ref && !node.props.ref.current) node.props.ref.current = node.type === 'dialog' ? { open: false, showModal() { this.open = true; }, close() { this.open = false; } } : { click() { clicks.push(node.props.capture === 'environment' ? 'camera' : 'gallery'); } };
  }
  const h = { render, nodes, clicks, requests, finishDecode: () => decode?.(), button(label) { return nodes().find(node => node.type === 'button' && text(node) === label); }, async ready() { render(); effects.splice(0).forEach(fn => fn()); await tick(); render(); this.button('Fotos').props.onClick(); render(); } };
  return h;
}

test('photo selection uses named native buttons that activate the corresponding hidden inputs without submitting', async () => {
  const h = harness(); await h.ready();
  for (const label of ['Usar câmera', 'Escolher foto']) {
    const button = h.button(label);
    assert.ok(button);
    assert.equal(button.props.type, 'button'); // Native buttons provide Enter/Space activation.
    assert.equal(button.props.disabled, false);
    button.props.onClick();
  }
  assert.deepEqual(h.clicks, ['camera', 'gallery']);
  const inputs = h.nodes().filter(node => node.type === 'input' && node.props.type === 'file');
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every(node => node.props.hidden && node.props.accept === 'image/jpeg,image/png,image/webp'));
  assert.equal(inputs[0].props.capture, 'environment');
  assert.equal(inputs[1].props.capture, undefined);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].init.method, undefined);
});

test('photo preparation disables both launchers and inputs; insufficient permission exposes neither launcher', async () => {
  const h = harness(); await h.ready();
  const input = h.nodes().find(node => node.type === 'input' && node.props.type === 'file');
  const target = { files: [new File(['synthetic'], 'material.jpg', { type: 'image/jpeg' })], value: 'synthetic-file' };
  input.props.onChange({ target }); h.render();
  assert.equal(target.value, '');
  assert.equal(h.button('Usar câmera').props.disabled, true);
  assert.equal(h.button('Escolher foto').props.disabled, true);
  assert.ok(h.nodes().filter(node => node.type === 'input' && node.props.type === 'file').every(node => node.props.disabled));
  assert.equal(h.requests.length, 1);
  const viewer = harness(false); await viewer.ready();
  assert.equal(viewer.button('Usar câmera'), undefined);
  assert.equal(viewer.button('Escolher foto'), undefined);
  assert.equal(viewer.nodes().filter(node => node.type === 'input' && node.props.type === 'file').length, 0);
});
