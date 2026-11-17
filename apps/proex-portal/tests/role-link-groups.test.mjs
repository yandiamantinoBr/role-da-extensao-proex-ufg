import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Blocos de links da resposta direta do Rolê (links da PROEX, Instagram e notícias). Dados sintéticos.
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
function load(file) {
  const mod = { exports: {} };
  const source = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const require = name => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name.endsWith('.module.css')) { const css = new Proxy({}, { get: (_target, key) => key === 'default' ? css : key === '__esModule' ? false : String(key) }); return css; }
    throw new Error(`módulo inesperado ${name}`);
  };
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require, URL });
  return mod.exports;
}
const component = load('components/portal/role-link-groups.tsx');
const nodes = tree => { const found = [], visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } found.push(node); visit(node.props?.children); }; visit(tree); return found; };
const GROUPS = [
  { title: 'Acesso Rápido', links: [{ text: 'Editais PROEX', url: 'https://proex.ufg.br/p/editais-proex', readable: true }, { text: 'Solicitação de empréstimo', url: 'https://docs.google.com/forms/d/e/sintetico/viewform', readable: false }] },
  { title: 'Sistemas', links: [{ text: 'Analisa Dados UFG', url: 'https://analisa.ufg.br/', readable: true }] },
  { title: 'Redes sociais', links: [{ text: 'Instagram', url: 'https://www.instagram.com/sintetico', readable: false }] },
];

test('LINKS CLICÁVEIS: cada bloco é um <details> com título em <h3> e "· N links"; só os 2 primeiros abertos', () => {
  const tree = component.default({ groups: GROUPS }), all = nodes(tree);
  const details = all.filter(node => node.type === 'details');
  assert.deepEqual(details.map(node => node.props.open), [true, true, false]);
  const summaries = all.filter(node => node.type === 'summary');
  assert.deepEqual(summaries.map(text), ['Acesso Rápido · 2 links', 'Sistemas · 1 link', 'Redes sociais · 1 link']);
  assert.ok(summaries.every(summary => nodes(summary).some(node => node.type === 'h3')), 'título do bloco em <h3>');
  assert.equal(all.filter(node => node.type === 'ul').length, 3);
});

test('LINKS CLICÁVEIS: link abre em nova aba com aviso para leitor de tela, mostra o nome (nunca a URL completa) e "site externo" quando não é site oficial', () => {
  const all = nodes(component.default({ groups: GROUPS }));
  const anchors = all.filter(node => node.type === 'a');
  assert.equal(anchors.length, 4);
  for (const anchor of anchors) {
    assert.equal(anchor.props.target, '_blank');
    assert.equal(anchor.props.rel, 'noopener noreferrer');
    const parts = nodes(anchor);
    assert.ok(parts.some(node => node.props?.className === 'visually-hidden' && text(node) === ' (abre em nova aba)'));
    assert.ok(parts.some(node => node.props?.['aria-hidden'] === 'true' && text(node) === ' ↗'));
    assert.ok(!text(anchor).includes(anchor.props.href), 'a URL completa não aparece');
  }
  assert.equal(text(anchors[0]), 'Editais PROEX (abre em nova aba) ↗proex.ufg.br');
  assert.equal(text(anchors[1]), 'Solicitação de empréstimo (abre em nova aba) ↗docs.google.com · site externo');
  assert.ok(nodes(anchors[1]).some(node => node.type === 'small' && /site externo/.test(text(node))));
});

test('LINKS CLICÁVEIS: só aceita do servidor links HTTPS curtos; formato estranho não aparece', () => {
  const { roleLinkGroupsFrom } = component;
  assert.equal(roleLinkGroupsFrom(undefined), undefined);
  assert.equal(roleLinkGroupsFrom('x'), undefined);
  const kept = roleLinkGroupsFrom([{ title: 'Bloco', links: [
    { text: 'Bom', url: 'https://proex.ufg.br/', readable: true },
    { text: 'Inseguro', url: 'http://proex.ufg.br/', readable: true },
    { text: 'Script', url: 'javascript:alert(1)', readable: true },
    { text: 'Gigante', url: `https://proex.ufg.br/${'a'.repeat(300)}`, readable: true },
    { text: '', url: 'https://proex.ufg.br/p/1', readable: true },
    { text: 'Sem marca', url: 'https://example.test/', readable: 'sim' },
  ] }, { title: 'Vazio', links: [{ text: 'x', url: 'ftp://x' }] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(kept)), [{ title: 'Bloco', links: [{ text: 'Bom', url: 'https://proex.ufg.br/', readable: true }, { text: 'Sem marca', url: 'https://example.test/', readable: false }] }]);
});

test('LINKS CLICÁVEIS · ESTILO E TELA: alvos de 44 px, título do bloco no tom secundário, fontes com aviso de nova aba e lembrete de busca sem custo', () => {
  const css = read('components/portal/role-link-groups.module.css');
  assert.match(css, /\.summary\{[^}]*min-height:44px/);
  assert.match(css, /\.link\{[^}]*min-height:44px/);
  assert.match(css, /\.title\{[^}]*font-size:max\(13px,\.82rem\);font-weight:700;color:var\(--text-secondary\)/);
  assert.match(css, /\.list\{[^}]*list-style:none/);
  const tsx = read('components/portal/role-assistant.tsx');
  assert.match(tsx, /<RoleLinkGroups groups=\{message\.linkGroups\}\/>/);
  assert.match(tsx, /roleLinkGroupsFrom\(result\.linkGroups\)/);
  assert.match(tsx, /\{source\.label\}<span className="visually-hidden"> \(abre em nova aba\)<\/span><span aria-hidden="true"> ↗<\/span><\/a>/, 'todas as fontes externas avisam a nova aba');
  assert.match(tsx, /' · Ligue Fontes oficiais para buscar sem custo\.'/);
  assert.match(tsx, /const freeSearchHint = chatOn && !officialMode && !officialLookup && !!status\?\.policy\?\.publicSearch && !attachment && isOfficialSearch\(sanitized\.text\);/);
  assert.match(read('components/portal/role-assistant.module.css'), /\.sources>span\{/, 'o estilo do rótulo "Fontes da resposta" não pega o aviso escondido');
});
