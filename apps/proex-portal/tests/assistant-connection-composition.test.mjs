import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url), tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';

function harness() {
  const slots = [], cleanups = [], cache = new Map(), requests = [], lifecycle = []; let index = 0, tree, mounted = null;
  const Boundary = () => null;
  const hooks = {
    useState(initial) { const key = index++; if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial; return [slots[key], value => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }]; },
    useRef(initial) { const key = index++; slots[key] ??= { current: initial }; return slots[key]; },
    useEffect(callback) { const key = index++; if (!(key in slots)) { slots[key] = true; cleanups.push(callback()); } },
  };
  const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
  function load(file) {
    if (cache.has(file)) return cache.get(file); const compiledModule = { exports: {} }; cache.set(file, compiledModule.exports);
    const require = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsx : name === './assistant-connection-panel' ? { default: Boundary } : name === './speech-input' ? { default: () => null } : load(name.startsWith('@/') ? `${name.slice(2)}.ts` : `${path.posix.normalize(path.posix.join(path.posix.dirname(file), name))}.ts`);
    const code = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require, Error, crypto, AbortController, window: { setTimeout: () => 1, clearTimeout() {} }, fetch: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })) }); return compiledModule.exports;
  }
  const Component = load('components/portal/assistant-panel.tsx').default, defaults = load('lib/assistant/contracts.ts').DEFAULT_ASSISTANT_CONFIG;
  function nodes() { const result = []; const visit = (node, ancestors = []) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(child => visit(child, ancestors)); return; } result.push({ ...node, ancestors }); visit(node.props?.children, [...ancestors, node]); }; visit(tree); return result; }
  // A generic type/key boundary records mount lifetimes. Product authorization
  // and revision decisions are made only by the real parent TSX above.
  function reconcile() {
    const next = nodes().find(node => node.type === Boundary);
    if (mounted && (!next || next.key !== mounted.key)) { lifecycle.push(['unmount', mounted.props.orgId, mounted.props.revision]); mounted = null; }
    if (next && !mounted) { mounted = { key: next.key, props: next.props, state: { consent: false }, ancestors: next.ancestors }; lifecycle.push(['mount', next.props.orgId, next.props.revision]); }
    else if (next && mounted) { mounted.props = next.props; mounted.ancestors = next.ancestors; }
  }
  const h = {
    requests, lifecycle,
    render() { index = 0; tree = Component({ projects: [{ id: 'project-a', name: 'Projeto A', organization_id: 'org-a' }], defaultProjectId: 'project-a' }); reconcile(); },
    button(label) { const node = nodes().find(node => node.type === 'button' && text(node) === label); assert.ok(node, label); return node; },
    selector() { const label = nodes().find(node => node.type === 'label' && text(node).startsWith('Organização da configuração')); assert.ok(label); return label.props.children.find(node => node?.type === 'select'); },
    status(org = 'org-a', extra = {}) { return { available: true, canConfigure: true, canDelegate: false, organizationId: org, revision: 1, config: defaults, organizations: ['org-a', 'org-b'].map(id => ({ id, name: id, canConfigure: true, available: true, sttAvailable: false })), ...extra }; },
    get boundary() { return mounted; },
    async reply(index, body) { requests[index].resolve({ ok: true, json: async () => body }); await tick(); h.render(); },
    dispose() { cleanups.forEach(cleanup => cleanup?.()); },
  }; h.render(); return h;
}
async function open(h, status) { h.button('Assistente com revisão').props.onClick(); await tick(); await h.reply(0, status); }

test('an authorized saved revision mounts diagnostics only after opening configuration and inside its fieldset', async () => {
  const h = harness(); try {
    await open(h, h.status('org-a', { revision: 3 })); assert.equal(h.boundary, null);
    h.button('Configurar IA').props.onClick(); h.render(); assert.equal(h.boundary.props.orgId, 'org-a'); assert.equal(h.boundary.props.revision, 3);
    assert.ok(h.boundary.ancestors.some(node => node.type === 'fieldset' && node.props.disabled === false));
    h.button('Configurar IA').props.onClick(); h.render(); assert.equal(h.boundary, null); assert.deepEqual(h.lifecycle, [['mount', 'org-a', 3], ['unmount', 'org-a', 3]]);
  } finally { h.dispose(); }
});

test('a viewer or an unsaved revision never mounts the diagnostics boundary', async () => {
  for (const extra of [{ canConfigure: false, revision: 1 }, { canConfigure: true, revision: 0 }]) {
    const h = harness(); try { await open(h, h.status('org-a', extra)); if (extra.canConfigure) { h.button('Configurar IA').props.onClick(); h.render(); } assert.equal(h.boundary, null); assert.deepEqual(h.lifecycle, []); } finally { h.dispose(); }
  }
});

test('changing effective organization or saved revision unmounts the previous boundary and discards its local consent', async () => {
  const h = harness(); try {
    await open(h, h.status()); h.button('Configurar IA').props.onClick(); h.render(); h.boundary.state.consent = true;
    h.selector().props.onChange({ target: { value: 'org-b' } }); await tick(); await h.reply(1, h.status('org-b'));
    assert.equal(h.boundary.props.orgId, 'org-b'); assert.equal(h.boundary.state.consent, false); h.boundary.state.consent = true;
    h.button('Salvar configuração').props.onClick(); await tick(); await h.reply(2, { revision: 2 }); await tick(); await h.reply(3, h.status('org-b', { revision: 2 }));
    assert.equal(h.boundary.props.revision, 2); assert.equal(h.boundary.state.consent, false);
    assert.deepEqual(h.lifecycle, [['mount', 'org-a', 1], ['unmount', 'org-a', 1], ['mount', 'org-b', 1], ['unmount', 'org-b', 1], ['mount', 'org-b', 2]]);
    assert.ok(h.requests.every(request => request.url.startsWith('/api/assistant')));
  } finally { h.dispose(); }
});
