import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const tick = () => new Promise(done => setImmediate(done));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const data = (tokens = []) => ({ projects: [{ id: 'project-a', name: 'Project A' }], tokens });
const metadata = { id: 'created-token', label: 'Synthetic connection', scopes: ['project.summary'], projectIds: ['project-a'], createdAt: '2026-11-05T15:00:00.000Z', expiresAt: '2099-11-12T15:00:00.000Z', revokedAt: null };
const secret = { id: metadata.id, token: 'pxm_' + 's'.repeat(43), expiresAt: metadata.expiresAt };
function harness() {
  let index = 0, tree, disposed = false, unmountedUpdates = 0; const slots = [], effects = [], requests = [], timers = [];
  const same = (a, b) => a?.length === b?.length && a?.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const key = index++; slots[key] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[key].value, value => { if (disposed) unmountedUpdates++; slots[key].value = typeof value === 'function' ? value(slots[key].value) : value; }]; },
    useRef(initial) { const key = index++; slots[key] ??= { value: { current: initial } }; return slots[key].value; },
    useCallback(callback, deps) { const key = index++; if (!same(slots[key]?.deps, deps)) slots[key] = { value: callback, deps }; return slots[key].value; },
    useEffect(callback, deps) { const key = index++; if (!same(slots[key]?.deps, deps)) { const previous = slots[key]; slots[key] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[key].cleanup = callback(); }); } },
  };
  const jsx = (type, props) => ({ type, props }), compiled = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL('../components/portal/mcp-connections-panel.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  class FormValues { constructor(form) { this.form = form; } get(key) { return this.form.values[key]; } getAll(key) { return [].concat(this.form.values[key] ?? []); } }
  vm.runInNewContext(source, { module: compiled, exports: compiled.exports, require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === 'lucide-react' ? new Proxy({}, { get: (_, key) => String(key) }) : { default: new Proxy({}, { get: (_, key) => String(key) }) }, Date, Set, Symbol, Error, Number, Object, Promise, AbortController, crypto, FormData: FormValues, window: { location: { hash: '', origin: 'https://synthetic.example.invalid' }, setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {} }, navigator: { clipboard: { async writeText() {} } }, fetch: (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })) });
  function nodes() { const result = []; function visit(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children); } visit(tree); return result; }
  const details = { open: false, querySelector() { return { focus() {} }; }, scrollIntoView() {} };
  const h = { requests, render() { index = 0; tree = compiled.exports.default(); nodes().find(node => node.type === 'details').props.ref.current = details; while (effects.length) effects.shift()(); while (timers.length) timers.shift()(); }, toggle(open) { details.open = open; nodes().find(node => node.type === 'details').props.onToggle({ currentTarget: details }); this.render(); }, text() { return text(tree); }, secret() { return nodes().find(node => node.type === 'input' && node.props.value === secret.token); }, async respond(n, value, status = 200) { requests[n].resolve({ ok: status < 400, status, json: async () => value }); await tick(); this.render(); }, submit() { const form = nodes().find(node => node.type === 'form'); assert.ok(form); const target = { resets: 0, values: { label: 'Synthetic connection', projectId: ['project-a'], scope: ['project.summary'], days: '7' }, reset() { this.resets++; } }; const promise = form.props.onSubmit({ preventDefault() {}, currentTarget: target }); this.render(); return { promise, target }; }, dispose() { for (const slot of slots) slot?.cleanup?.(); disposed = true; }, get unmountedUpdates() { return unmountedUpdates; } };
  h.render(); return h;
}
async function ready(h) { h.toggle(true); await h.respond(0, data([metadata])); }

test('a late creation response cannot reveal its secret or reset the new opening after close/reopen', async () => {
  const h = harness(); try {
    await ready(h); const operation = h.submit(); assert.equal(h.requests[1].init.method, 'POST');
    h.toggle(false); h.toggle(true); await h.respond(2, data([metadata])); assert.equal(h.secret(), undefined);
    await h.respond(1, secret); await operation.promise; h.render();
    assert.equal(h.secret(), undefined); assert.equal(operation.target.resets, 0); assert.equal(h.text().includes('Credencial criada'), false);
    assert.equal(h.requests.length, 4, 'late settlement may refresh current metadata only'); await h.respond(3, data([metadata])); assert.equal(h.secret(), undefined);
  } finally { h.dispose(); }
});

test('current 401/403 after successful creation clears both the one-time secret and previously loaded private metadata', async () => {
  for (const status of [401, 403]) {
    const h = harness(); try {
      await ready(h); const operation = h.submit(); await h.respond(1, secret); assert.ok(h.secret());
      await h.respond(2, { error: 'Synthetic access lost' }, status); await operation.promise; h.render();
      assert.equal(h.secret(), undefined); assert.equal(h.text().includes(metadata.label), false); assert.equal(h.text().includes('Project A'), false); assert.ok(h.text().includes('Synthetic access lost'));
    } finally { h.dispose(); }
  }
});

test('closing aborts reads and ignores a late previous opening response even if the transport still delivers it', async () => {
  const h = harness(); try {
    h.toggle(true); const old = h.requests[0]; h.toggle(false); assert.equal(old.init.signal.aborted, true); h.toggle(true);
    await h.respond(1, data()); await h.respond(0, { projects: [{ id: 'foreign', name: 'Must not reappear' }], tokens: [] });
    assert.equal(h.text().includes('Must not reappear'), false); assert.ok(h.text().includes('Project A'));
  } finally { h.dispose(); }
});

test('unmounting for another account/context drops in-flight POST completion without state updates', async () => {
  const h = harness(); await ready(h); const operation = h.submit(); h.dispose();
  h.requests[1].resolve({ ok: true, status: 200, json: async () => secret }); await operation.promise;
  assert.equal(h.unmountedUpdates, 0); assert.equal(h.requests.length, 2);
});
