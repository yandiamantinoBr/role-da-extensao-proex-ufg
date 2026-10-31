import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const output = ts.transpileModule(readFileSync(new URL('../lib/draft-storage.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { clearDraftStorage, createDraftScope, PRIVATE_DRAFT_FIELD, draftLogoutKey, onDraftLogout } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

test('logout removes every current-account draft while preserving other accounts and preferences', () => {
  const values = new Map([
    ['proex:draft:v1:user-a:loan', '{}'], ['proex:draft:v1:user-a:project', '{}'],
    ['proex:draft:v1:user-ab:loan', '{}'], ['proex:draft:v1:user-b:loan', '{}'],
    ['proex-theme', 'dark'], ['proex:navigation', '{}'],
  ]);
  const storage = { get length() { return values.size; }, key(i) { return [...values.keys()][i] ?? null; }, removeItem(key) { values.delete(key); } };
  clearDraftStorage(storage, 'user-a');
  assert.deepEqual([...values.keys()], ['proex:draft:v1:user-ab:loan', 'proex:draft:v1:user-b:loan', 'proex-theme', 'proex:navigation']);
  clearDraftStorage(storage, 'user-a');
  assert.equal(values.size, 4);
});

test('borrower identity and contact are excluded without disabling ordinary project drafts', () => {
  for (const name of ['borrowerName', 'borrowerContact', 'password', 'email', 'telefone', 'cpf', 'setupToken']) assert.ok(PRIVATE_DRAFT_FIELD.test(name), name);
  for (const name of ['name', 'description', 'projectId', 'startsAt', 'quantity']) assert.equal(PRIVATE_DRAFT_FIELD.test(name), false, name);
});

test('a logout in another tab invalidates only the matching account and listener cleanup works', () => {
  const tab = new EventTarget(); let active = true, cleared = 0;
  const stop = onDraftLogout(tab, 'user-a', () => { active = false; cleared++; });
  const notify = (user, value) => tab.dispatchEvent(Object.assign(new Event('storage'), { key: draftLogoutKey(user), newValue: value }));
  notify('user-b', 'logout'); assert.equal(active, true);
  notify('user-a', null); assert.equal(active, true);
  notify('user-a', 'logout'); assert.equal(active, false); assert.equal(cleared, 1);
  stop(); notify('user-a', 'logout'); assert.equal(cleared, 1);
});

test('a stale tab cannot restore autosave by rendering its cached identity after logout', () => {
  const scope = createDraftScope();
  scope.activate('user-a');
  assert.equal(scope.current, 'user-a');
  scope.invalidate('user-a');
  for (let render = 0; render < 3; render++) {
    scope.activate('user-a');
    assert.equal(scope.current, 'anon');
  }
  scope.activate('user-b');
  assert.equal(scope.current, 'user-b');
  // A fresh page after login owns a new lifecycle; the stale page stays invalid.
  const afterLogin = createDraftScope();
  afterLogin.activate('user-a');
  assert.equal(afterLogin.current, 'user-a');
});
