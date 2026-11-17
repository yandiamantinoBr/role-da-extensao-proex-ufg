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
// O valor em dólar usa espaço não separável, como no resto do Rolê.
const COST = 'US$\u00a00,0123';
const LINK = 'https://files.cercomp.ufg.br/weby/up/694/o/SEI_9_Edital_Escaneado.pdf';
const offer = (extra = {}) => ({ url: LINK, title: 'SEI 9 Edital Escaneado.pdf', costMicros: 12_345, question: 'Quantas bolsas?', key: 'chave-fixa-0001', ...extra });
const nodes = tree => { const found = [], visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } found.push(node); visit(node.props?.children); }; visit(tree); return found; };
const render = (value, disabled = false) => { const clicks = []; const tree = card.default({ offer: value, disabled, onRead: () => clicks.push(true) }); return { tree, clicks, all: nodes(tree), shown: text(tree) }; };

test('CARTÃO DO PDF ESCANEADO: aviso de envio ao Google Gemini com o custo máximo e o botão "Ler com IA · até {custo}"; o toque chama a leitura', () => {
  const view = render(offer());
  assert.ok(view.shown.includes(`O PDF público será enviado ao Google Gemini para leitura. Custo máximo: ${COST}.`), view.shown);
  const button = view.all.find(node => node.type === 'button');
  assert.equal(text(button), `Ler com IA · até ${COST}`);
  assert.equal(button.props.type, 'button');
  assert.equal(button.props.className, 'p-button p-button-primary', 'mesmo estilo dos botões do painel');
  assert.equal(button.props.disabled, false);
  assert.equal(view.all.find(node => node.props?.className === 'reviseActions')?.props.children, button, 'dentro da faixa de ações (alvo de 44 px)');
  assert.equal(view.tree.props['aria-label'], 'Ler o PDF escaneado com IA');
  button.props.onClick();
  assert.equal(view.clicks.length, 1);
  assert.equal(render(offer(), true).all.find(node => node.type === 'button').props.disabled, true, 'travado enquanto o Rolê trabalha');
  const reading = render(offer({ reading: true })).all.find(node => node.type === 'button');
  assert.equal(text(reading), 'Lendo o PDF com IA…'); assert.equal(reading.props.disabled, true);
});

test('CARTÃO DO PDF ESCANEADO: depois da leitura some; recusa definitiva tira o botão e mostra o motivo', () => {
  assert.equal(card.default({ offer: offer({ done: true }), disabled: false, onRead: () => {} }), null);
  const closed = render(offer({ closed: true, error: 'A leitura de PDF escaneado com IA não está ligada nesta organização.' }));
  assert.equal(closed.all.some(node => node.type === 'button'), false);
  assert.equal(closed.all.find(node => node.props?.role === 'alert')?.props.children, 'A leitura de PDF escaneado com IA não está ligada nesta organização.');
  const retry = render(offer({ error: 'O Gemini demorou demais ou não respondeu. Tente novamente mais tarde.' }));
  assert.ok(retry.all.some(node => node.type === 'button'), 'erro passageiro mantém o botão para tentar de novo');
});

test('OFERTA DO SERVIDOR: só PDF oficial, título curto e custo dentro do teto viram cartão', () => {
  const from = card.roleScannedPdfFrom;
  assert.deepEqual(JSON.parse(JSON.stringify(from({ url: LINK, title: 'Edital.pdf', costMicros: 9_000 }, 'Pergunta', 'k-0001'))), { url: LINK, title: 'Edital.pdf', costMicros: 9_000, question: 'Pergunta', key: 'k-0001' });
  for (const bad of [null, [], { url: 'https://example.test/edital.pdf', title: 'x', costMicros: 9_000 }, { url: LINK, title: 'x', costMicros: 0 },
    { url: LINK, title: 'x', costMicros: PDF_READING_MAX_COST_MICROS + 1 }, { url: LINK, title: 'x'.repeat(301), costMicros: 9_000 }, { url: LINK, costMicros: 9_000 }]) {
    assert.equal(from(bad, 'Pergunta', 'k-0001'), undefined, JSON.stringify(bad)?.slice(0, 80));
  }
});

test('CHAT: a oferta só nasce de resposta da busca oficial e o toque manda só endereço, pergunta, teto e a chave fixa', () => {
  const source = read('components/portal/role-assistant.tsx');
  assert.match(source, /const pdfReading = result\.provider === 'official' \? roleScannedPdfFrom\(result\.pdfReading, text, crypto\.randomUUID\(\)\) : undefined;/);
  const call = source.slice(source.indexOf("action: 'pdf.read'"), source.indexOf('}, 55_000)'));
  assert.match(call, /operationKey: offer\.key/);
  assert.match(call, /consent: true, message: offer\.question, url: offer\.url, acceptedCostMicros: offer\.costMicros/);
  assert.doesNotMatch(call, /data:|base64|file|bytes/i, 'nenhum conteúdo de arquivo sai do navegador');
  assert.match(source, /\{message\.pdfReading && <RoleScannedPdfCard /);
});
