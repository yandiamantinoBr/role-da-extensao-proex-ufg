import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const transpile = file => ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const catalog = { exports: {} };
vm.runInNewContext(transpile('lib/sync/sheet-tab-catalog.ts'), { exports: catalog.exports, module: catalog });
const tick = () => new Promise(resolve => setImmediate(resolve));
const spreadsheetId = 'spreadsheet-fixture-12345';
const master = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
const tabUrl = gid => `${master}?gid=${gid}#gid=${gid}`;
const base = { canSync: true, userId: 'global-owner-qa', context: 'reports', tabKeys: ['items'] };

function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  return node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  return typeof node === 'string' ? node : textContent(node);
}
function textContent(node) { return node?.props ? text(node.props.children) : ''; }
const anchors = node => flatten(node).filter(child => child.type === 'a');

function harness() {
  const requests = [];
  const compiled = { exports: {} };
  const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
  let state, effect, cleanup;
  const hooks = {
    useState(initial) { return [state ?? initial, value => { state = value; }]; },
    useEffect(handler) { effect = handler; },
  };
  const require = name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === '@/lib/sync/sheet-tab-catalog') return catalog.exports;
    if (name.endsWith('.css')) return { default: {} };
    return {};
  };
  vm.runInNewContext(transpile('components/portal/sheet-shortcuts.tsx'), {
    exports: compiled.exports, module: compiled, require, AbortController,
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
  });
  return {
    requests,
    wrapper: props => compiled.exports.SheetShortcuts(props),
    mount(node) { state = undefined; node.type(node.props); cleanup = effect(); },
    render: node => node.type(node.props),
    unmount: () => cleanup?.(),
  };
}
const ok = body => ({ status: 200, ok: true, json: async () => body });

test('master tab shortcuts are fetched only for a global owner and keyed by account and configuration', () => {
  const h = harness();
  assert.equal(h.wrapper({ ...base, canSync: false }), null);
  assert.equal(h.wrapper({ ...base, userId: '' }), null);
  assert.equal(h.requests.length, 0);
  const node = h.wrapper(base);
  assert.notEqual(h.wrapper({ ...base, userId: 'new-owner-qa' }).key, node.key);
  assert.notEqual(h.wrapper({ ...base, refreshKey: 1 }).key, node.key);
  h.mount(node);
  assert.equal(h.requests[0].url, '/api/sync?sheetTabs=1');
  assert.equal(h.requests[0].options.cache, 'no-store');
  h.unmount();
  assert.equal(h.requests[0].options.signal.aborted, true);
});

test('report and settings only render verified tab URLs and keep a clear master fallback', async () => {
  const h = harness(), node = h.wrapper({ ...base, projectScoped: true });
  h.mount(node);
  h.requests[0].resolve(ok({ spreadsheetId, spreadsheetUrl: master, tabs: {
    items: { gid: 0, url: tabUrl(0) }, projects: { gid: 2, url: 'https://other.example.invalid/' },
  } }));
  await tick();
  const report = h.render(node), [reportLink] = anchors(report);
  assert.equal(reportLink.props.href, tabUrl(0));
  assert.equal(reportLink.props.target, '_blank');
  assert.equal(reportLink.props.rel, 'noopener noreferrer');
  assert.match(text(report), /vários projetos.*filtros deste relatório.*colunas em creme.*Operações.*Sincronizar agora/);
  const fallback = h.render(h.wrapper({ ...base, tabKeys: ['projects'] }));
  assert.equal(anchors(fallback)[0].props.href, master);
  const settings = h.render(h.wrapper({ ...base, context: 'settings' }));
  assert.deepEqual(anchors(settings).map(link => link.props.href), [master, tabUrl(0)]);
});

test('forbidden or noncanonical responses never expose an operational link', async () => {
  for (const response of [
    { status: 403, ok: false, json: async () => { throw new Error('unexpected'); } },
    ok({ spreadsheetId, spreadsheetUrl: 'https://other.example.invalid/', tabs: { items: { gid: 0, url: tabUrl(0) } } }),
  ]) {
    const h = harness(), node = h.wrapper(base);
    h.mount(node);
    h.requests[0].resolve(response);
    await tick();
    assert.equal(h.render(node), null);
  }
});
