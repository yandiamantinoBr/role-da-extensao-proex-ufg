import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// P8 (revisão de 09/11): quem não cria registro vê, em Registros, como pedir. A regra de permissão não muda.
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function recordCapabilities() {
  const code = ts.transpileModule(source('../components/portal/records-panel.tsx'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const compiled = {exports: {}};
  const stub = new Proxy(function () {}, {get: (_, key) => key === '__esModule' ? false : stub, apply: () => stub});
  vm.runInNewContext(code, {module: compiled, exports: compiled.exports, require: () => stub, console});
  return compiled.exports.RECORD_CAPABILITIES;
}
function roleCapabilities() {
  const text = source('../lib/access.ts');
  const operational = [...text.match(/const OPERATIONAL = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  const block = text.match(/const ROLE_CAPABILITIES[^{]*\{([\s\S]*?)\n\};/)[1];
  return Object.fromEntries([...block.matchAll(/^\s*(\w+): (.+),$/gm)].map(([, role, list]) => [role, [...(list.includes('OPERATIONAL') ? operational : []), ...[...list.matchAll(/'([^']+)'/g)].map(match => match[1])]]));
}

test('only roles without any record capability get the "how to ask" note', () => {
  const needed = recordCapabilities();
  assert.deepEqual([...needed].sort(), ['campaigns.manage', 'inventory.manage', 'loans.manage']);
  const roles = roleCapabilities();
  const canCreate = role => roles[role].some(capability => needed.includes(capability));
  for (const role of ['owner', 'manager', 'inventory', 'loans']) assert.equal(canCreate(role), true, role);
  for (const role of ['operator', 'viewer']) assert.equal(canCreate(role), false, role);
});

test('the note sits in Registros, explains what to do and whom to ask, and opens Demandas', () => {
  const client = source('../app/portal-client.tsx');
  assert.match(client, /const canCreateRecord = canGlobal\(\.\.\.RECORD_CAPABILITIES\) \|\| projects\.some\(project => canProject\(string\(project\.id\), \.\.\.RECORD_CAPABILITIES\)\);/);
  const note = client.match(/\{!canCreateRecord && projects\.length > 0 && <div className="p-notice p-records-ask" role="note">([\s\S]*?)<\/div>\}\n/)?.[1];
  assert.ok(note, 'nota de Registros');
  assert.match(note, /não cria registros novos/);
  assert.match(note, /Abra uma demanda para quem coordena o projeto/);
  assert.match(note, /onClick=\{\(\) => navigate\('demands'\)\}>Abrir demanda</);
  assert.ok(client.indexOf('p-records-ask') > client.indexOf("{tab === 'records' && <>"), 'dentro do módulo Registros');
});
