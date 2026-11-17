import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Botão "Ler com IA" do resultado escaneado da busca oficial. Dados sintéticos; nada é enviado.
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const cache = new Map();
function load(file, globals = {}) {
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  cache.set(file, mod.exports);
  const source = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const require = name => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'lucide-react') return { FileText: () => null, LoaderCircle: () => null };
    if (name.endsWith('.module.css')) { const css = new Proxy({}, { get: (_target, key) => key === 'default' ? css : key === '__esModule' ? false : String(key) }); return css; }
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('./')) return load(file.replace(/[^/]+$/, '') + name.slice(2) + '.ts');
    throw new Error(`módulo inesperado ${name}`);
  };
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require, Intl, URL, Number, ...globals });
  Object.assign(cache.get(file), mod.exports);
  return mod.exports;
}
const card = load('components/portal/role-scanned-pdf-card.tsx');
const { PDF_READING_MAX_COST_MICROS } = load('lib/assistant/role-pdf-reading-contracts.ts');
const { formatMicros, friendlyMicros } = load('lib/assistant/role-contracts.ts');
const NBSP = String.fromCharCode(160);
// O valor em dólar usa espaço não separável, como no resto do Rolê.
const COST = `US$${NBSP}0,0123`;
const LINK = 'https://files.cercomp.ufg.br/weby/up/694/o/SEI_9_Edital_Escaneado.pdf';
const offer = (extra = {}) => ({ url: LINK, title: 'SEI 9 Edital Escaneado.pdf', costMicros: 12_345, expiresAt: 1_900_000_000_000, signature: 'corpo.assinatura', question: 'Quantas bolsas?', key: 'chave-fixa-0001', ...extra });
const nodes = tree => { const found = [], visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } found.push(node); visit(node.props?.children); }; visit(tree); return found; };
const render = (value, disabled = false) => { const clicks = []; const tree = card.default({ offer: value, disabled, onRead: () => clicks.push(true) }); return { tree, clicks, all: nodes(tree), shown: text(tree) }; };
const css = read('components/portal/role-assistant.module.css');

test('CARTÃO DO PDF ESCANEADO: título, aviso do que vai ao Google Gemini, custo amigável e botão "Ler com IA · até {custo exato}"', () => {
  const view = render(offer());
  assert.equal(view.tree.props['aria-label'], 'Ler o PDF escaneado com IA');
  assert.equal(view.tree.props.className, 'operation pdfReading', 'mesmo sistema do cartão do rascunho');
  const [title, notice, cost] = view.all.filter(node => node.type === 'p');
  assert.equal(title.props.className, 'operationTitle'); assert.equal(text(title), 'Ler o PDF escaneado com IA');
  assert.equal(notice.props.className, 'sendsTo');
  assert.equal(text(notice), 'O PDF público e a sua pergunta serão enviados ao Google Gemini (IA do Google) para leitura.');
  assert.equal(cost.props.className, 'sendsTo');
  assert.equal(text(cost), `Custo máximo: ${friendlyMicros(12_345)}. Nada é enviado até você tocar no botão.`);
  assert.equal(cost.props.children[0].type, 'strong');
  const button = view.all.find(node => node.type === 'button');
  assert.equal(text(button), `Ler com IA · até ${COST}`);
  assert.equal(formatMicros(12_345), COST, 'valor exato só dentro do botão');
  assert.equal(button.props.type, 'button');
  assert.equal(button.props.className, 'p-button p-button-primary', 'mesmo estilo dos botões do painel');
  assert.equal(button.props.disabled, false);
  assert.equal(view.all.find(node => node.props?.className === 'reviseActions')?.props.children, button, 'dentro da faixa de ações (alvo de 44 px)');
  button.props.onClick();
  assert.equal(view.clicks.length, 1);
  assert.equal(render(offer(), true).all.find(node => node.type === 'button').props.disabled, true, 'travado enquanto o Rolê faz outra coisa');
});

test('CARTÃO DO PDF ESCANEADO: lendo, o botão fica com aria-disabled (contraste mantido), ícone girando e o toque é ignorado', () => {
  const view = render(offer({ reading: true }), true);
  const button = view.all.find(node => node.type === 'button');
  assert.equal(text(button), 'Lendo o PDF com IA…');
  assert.equal(button.props['aria-disabled'], 'true');
  assert.equal(button.props.disabled, false, 'sem o atributo disabled, que deixa o botão apagado');
  assert.equal(button.props.children[0].props.className, 'p-spin', 'ícone girando');
  button.props.onClick();
  assert.equal(view.clicks.length, 0);
  assert.match(css, /\.pdfReading \.reviseActions :global\(\.p-button\)\{font-size:max\(14px,\.9rem\);padding-inline:12px\}/);
  assert.match(css, /:global\(html\[data-theme=dark\]\) \.pdfReading :global\(\.p-button-primary:not\(:disabled\)\)\{border-color:#d4b3e8\}/, 'borda visível no escuro');
  assert.match(css, /\.sources a\{[^}]*min-height:44px/, 'link da fonte com alvo de 44 px');
});

test('CARTÃO DO PDF ESCANEADO: depois da leitura some; recusa definitiva vira só o aviso, focado; erro passageiro mantém o botão', () => {
  assert.equal(card.default({ offer: offer({ done: true }), disabled: false, onRead: () => {} }), null);
  const closed = card.default({ offer: offer({ closed: true, error: 'A leitura de PDF escaneado com IA não está ligada nesta organização.', errorId: 'e1' }), disabled: false, onRead: () => {} });
  assert.equal(closed.type, 'p', 'sem caixa dentro de caixa');
  assert.equal(closed.props.role, 'alert'); assert.equal(closed.props.tabIndex, -1); assert.equal(closed.props.className, 'error');
  assert.equal(closed.props.children, 'A leitura de PDF escaneado com IA não está ligada nesta organização.');
  const focused = [];
  closed.props.ref({ focus: () => focused.push('alerta') });
  assert.deepEqual(focused, ['alerta'], 'o aviso recebe o foco quando aparece');
  const retry = render(offer({ error: 'O Gemini demorou demais ou não respondeu. Tente novamente mais tarde.', errorId: 'e2' }));
  assert.ok(retry.all.some(node => node.type === 'button'), 'erro passageiro mantém o botão para tentar de novo');
  const alert = retry.all.find(node => node.props?.role === 'alert');
  assert.equal(alert.props.tabIndex, -1); assert.equal(typeof alert.props.ref, 'function');
});

test('OFERTA DO SERVIDOR: só PDF oficial, título curto, custo dentro do teto e oferta assinada viram cartão', () => {
  const from = card.roleScannedPdfFrom;
  const good = { url: LINK, title: 'Edital.pdf', costMicros: 9_000, expiresAt: 1_900_000_000_000, signature: 'corpo.assinatura' };
  assert.deepEqual(JSON.parse(JSON.stringify(from(good, 'Pergunta', 'k-0001'))), { ...good, question: 'Pergunta', key: 'k-0001' });
  for (const bad of [null, [], { ...good, url: 'https://example.test/edital.pdf' }, { ...good, costMicros: 0 }, { ...good, costMicros: PDF_READING_MAX_COST_MICROS + 1 },
    { ...good, title: 'x'.repeat(301) }, { ...good, title: undefined }, { ...good, signature: undefined }, { ...good, signature: 'sem ponto' }, { ...good, expiresAt: 'amanhã' }]) {
    assert.equal(from(bad, 'Pergunta', 'k-0001'), undefined, JSON.stringify(bad)?.slice(0, 80));
  }
});

test('CHAT: oferta só da busca oficial; rodapé avisa que a leitura é à parte; o toque manda endereço, pergunta, teto, oferta assinada e a chave fixa', () => {
  const source = read('components/portal/role-assistant.tsx');
  assert.match(source, /const pdfReading = result\.provider === 'official' \? roleScannedPdfFrom\(result\.pdfReading, text, crypto\.randomUUID\(\)\) : undefined;/);
  assert.match(source, /pdfReading \? 'Consulta pública · sem custo de IA \(a leitura abaixo é cobrada à parte\)' : 'Consulta pública · sem custo de IA'/);
  const call = source.slice(source.indexOf("action: 'pdf.read'"), source.indexOf('}, 55_000)'));
  assert.match(call, /operationKey: offer\.key/);
  assert.match(call, /consent: true, message: offer\.question, url: offer\.url, acceptedCostMicros: offer\.costMicros, offer: offer\.signature/);
  assert.doesNotMatch(call, /data:|base64|file|bytes/i, 'nenhum conteúdo de arquivo sai do navegador');
  // O cartão fica depois do rodapé da busca, para o rodapé "sem custo" não parecer valer para a leitura.
  assert.ok(source.indexOf('{message.pdfReading && <RoleScannedPdfCard') > source.indexOf('{message.meta && <small>{message.meta}</small>}'));
});

test('CHAT: dois toques não disparam duas leituras; só recusa com código do servidor troca a chave; sem "Pensando…" repetido; foco na nova resposta', () => {
  const source = read('components/portal/role-assistant.tsx');
  assert.match(source, /const pendingPdf = useRef<Set<string>>\(new Set\(\)\);/);
  assert.match(source, /pendingPdf\.current\.has\(offer\.key\)\) return;\n\s*pendingPdf\.current\.add\(offer\.key\);/);
  assert.match(source, /pendingPdf\.current\.delete\(offer\.key\);/);
  assert.match(source, /const answered = cause instanceof RequestError && !!cause\.code && cause\.code !== 'assistant_call_replay' && cause\.status !== 502 && cause\.status !== 504;/);
  assert.match(source, /\{busy && !readingPdf && <li/);
  assert.match(source, /focusOnShow: true/);
  assert.match(source, /<p ref=\{message\.focusOnShow \? focusOnMount : undefined\} tabIndex=\{message\.focusOnShow \? -1 : undefined\}>/);
  assert.match(source, /\{message\.notice && <p className=\{styles\.help\}>\{message\.notice\}<\/p>\}/, 'aviso de leitura por IA com estilo de ajuda');
});

test('ADMINISTRAÇÃO: o interruptor do vídeo diz que também libera a leitura de PDF escaneado', () => {
  assert.match(read('components/portal/assistant-administration-panel.tsx'), /Também libera a leitura de PDF oficial escaneado com o Gemini, com custo mostrado antes\./);
});
