import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.createSourceFile('portal-client.tsx', readFileSync(new URL('../app/portal-client.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PortalClient');
assert.ok(component?.body, 'PortalClient must have an executable body');
function initializer(container, name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node.initializer;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(container);
  assert.ok(found, `production initializer ${name}`);
  return found.getText(source);
}
// Execute the unchanged callback and its real identity/ref initializers. Only
// React scheduling, network transport, setters and browser navigation are bound
// to this small harness; no copy of the identity/concurrency decision is tested.
const program = ts.transpileModule(`
  const string = ${initializer(source, 'string')};
  const sessionIdentity = ${initializer(component.body, 'sessionIdentity')};
  const latestRequest = ${initializer(component.body, 'latestRequest')};
  const refresh = ${initializer(component.body, 'refresh')};
  capture({ refresh, identity: () => sessionIdentity.current });
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;

function harness(initial) {
  const requests = [], events = [], state = { snapshot: initial, refreshing: false, expired: false, failure: '', reloads: 0 };
  let routine;
  vm.runInNewContext(program, {
    initial, Date, Error,
    useRef: current => ({ current }), useCallback: callback => callback,
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
    window: { location: { reload() { state.reloads++; events.push('reload'); } } },
    setData(value) { state.snapshot = value; events.push('data'); },
    setRefreshing(value) { state.refreshing = value; }, setSessionExpired(value) { state.expired = value; },
    setUpdatedAt() { events.push('updated'); }, setNow() {}, setFailure(value) { state.failure = value; },
    readableError: (message, fallback) => message || fallback,
    capture(value) { routine = value; },
  });
  return { ...routine, requests, events, state, reply(index, body) { requests[index].resolve({ ok: true, status: 200, json: async () => body }); } };
}
const snapshot = (userId, project) => ({ user: { userId }, projects: [{ id: project }], privateContext: `synthetic-${project}` });

test('the same identity replaces the snapshot normally and completes refresh state', async () => {
  const initial = snapshot('user-a', 'old-project'), next = snapshot('user-a', 'new-project'), h = harness(initial);
  const pending = h.refresh(); assert.equal(h.state.refreshing, true); h.reply(0, next);
  assert.equal(await pending, true); assert.equal(h.state.snapshot, next); assert.equal(h.state.reloads, 0);
  assert.deepEqual(h.events, ['data', 'updated']); assert.equal(h.state.refreshing, false); assert.equal(h.state.expired, false);
  assert.equal(h.requests[0].url, '/api/portal'); assert.equal(h.requests[0].options.cache, 'no-store');
});

test('a new identity reloads before any foreign snapshot is put into the existing account context', async () => {
  const initial = snapshot('user-a', 'private-a'), foreign = snapshot('user-b', 'private-b'), h = harness(initial);
  const pending = h.refresh(); h.reply(0, foreign);
  assert.equal(await pending, false); assert.equal(h.state.reloads, 1); assert.equal(h.state.snapshot, initial);
  assert.deepEqual(h.events, ['reload']); assert.equal(h.identity(), 'user-a'); assert.equal(h.state.refreshing, false);
});

test('an initial snapshot without identity binds the first account and does not cause a reload loop', async () => {
  const h = harness({}), first = snapshot('user-a', 'first'), second = snapshot('user-a', 'second');
  const initialLoad = h.refresh(); h.reply(0, first); assert.equal(await initialLoad, true); assert.equal(h.identity(), 'user-a');
  const refresh = h.refresh(); h.reply(1, second); assert.equal(await refresh, true);
  assert.equal(h.state.reloads, 0); assert.equal(h.state.snapshot, second); assert.deepEqual(h.events, ['data', 'updated', 'data', 'updated']);
});

test('a stale foreign identity response cannot reload or overwrite a newer successful request', async () => {
  const h = harness(snapshot('user-a', 'initial')), old = h.refresh(), latest = h.refresh(), current = snapshot('user-a', 'current');
  h.reply(1, current); assert.equal(await latest, true); h.reply(0, snapshot('user-b', 'stale-foreign')); await old;
  assert.equal(h.state.snapshot, current); assert.equal(h.state.reloads, 0); assert.equal(h.identity(), 'user-a');
  assert.deepEqual(h.events, ['data', 'updated']); assert.equal(h.state.refreshing, false);
});
