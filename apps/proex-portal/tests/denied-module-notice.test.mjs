import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// P6 (revisão de 09/11, aprovada em 10/11/2026): ?module=settings para quem não administra volta ao Início
// com um aviso, em vez de voltar em silêncio.
const file = readFileSync(new URL('../app/portal-client.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('portal-client.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) { let found; const visit = node => { if (!found && predicate(node)) found = node; else if (!found) ts.forEachChild(node, visit); }; visit(source); return found; }
const notice = find(node => ts.isJsxElement(node) && node.getText(source).includes('é só da administração') && node.openingElement.getText(source).includes('deniedStyles.notice'));
const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';

function renderNotice(deniedModule, tab = 'overview') {
  const exportsObject = {}; const context = { module: { exports: exportsObject }, exports: exportsObject, require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }), deniedModule, tab, tabs: [{ id: 'settings', label: 'Configurações' }, { id: 'calendar', label: 'Agenda' }], ShieldCheck: 'ShieldCheck', deniedStyles: new Proxy({}, { get: (_t, key) => String(key) }), setDeniedModule: value => { context.cleared = value; } };
  vm.runInNewContext(transpile(`module.exports = () => (${notice.getText(source)});`), context);
  return { tree: context.module.exports(), context };
}

test('a denied settings link explains it is for the administration, and the notice can be dismissed', () => {
  assert.ok(notice, 'aviso presente no Início');
  const { tree, context } = renderNotice('settings');
  assert.match(text(tree), /Configurações é só da administração\. Você voltou ao Início/);
  const button = tree.props.children.find(child => child?.type === 'button');
  button.props.onClick(); assert.equal(context.cleared, null);
  assert.match(text(renderNotice('calendar').tree), /Agenda não faz parte do seu acesso/);
});

test('opening a denied link, a later navigation or a new location all keep the notice honest', () => {
  // Endereço negado ao abrir: restoreLocation usa deniedPortalModule depois de aplicar a localização.
  const restore = find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === 'restoreLocation').getText(source);
  assert.match(restore, /applyLocation\(next\);[\s\S]*const denied = deniedPortalModule\(url\.searchParams, next, tabs\.map\(module => module\.id\)\);\s*if \(denied\) setDeniedModule\(denied as ModuleId\);/);
  // Perda de acesso durante a sessão: o redirecionamento também registra o módulo.
  assert.match(file, /if \(requestedTab !== 'overview' && tabs\.some\(module => module\.id === requestedTab\)\) setDeniedModule\(requestedTab as ModuleId\); setTab\(tab\);/);
  for (const name of ['navigate', 'applyLocation']) assert.match(find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source), /setDeniedModule\(null\)/, name);
});

test('browser back or forward opens Equipes the normal way and the menu follows the team shown', () => {
  const apply = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'applyLocation').getText(source);
  assert.match(apply, /setTeamIntent\(null\)/, 'um pedido antigo de Equipes não volta com o Voltar do navegador');
  assert.match(file, /current: tab === 'work-teams' && shownTeamId === team\.id/);
  assert.match(file, /onTeamShown=\{setShownTeamId\}/);
  assert.match(file, /pinError=\{pins\.error\}/);
});
