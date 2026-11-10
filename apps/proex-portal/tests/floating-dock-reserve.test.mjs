import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('components/portal/dock-reserve.ts');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { dockReserve, DOCK_RESERVE_PROPERTY, DOCK_RESERVE_GAP } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('doca: o espaço no fim da página cobre a parte mais alta da doca em repouso, com folga', () => {
  // Celular de 844 px: barra inferior + área segura empurram a doca; Rolê (660) fica acima do botão Widgets (712).
  assert.equal(dockReserve(844, [712]), 844 - 712 + DOCK_RESERVE_GAP);
  assert.equal(dockReserve(844, [712, 660]), 844 - 660 + DOCK_RESERVE_GAP, 'com o Rolê na doca, o espaço cresce');
  // Chip minimizado acima dos botões também conta.
  assert.equal(dockReserve(844, [712, 660, 604]), 844 - 604 + DOCK_RESERVE_GAP);
  // Computador: Widgets a 24 px do fim da tela.
  assert.equal(dockReserve(900, [824]), 900 - 824 + DOCK_RESERVE_GAP);
  assert.equal(dockReserve(844, [700.4]), Math.ceil(844 - 700.4 + DOCK_RESERVE_GAP), 'arredonda para cima, nunca menos');
});

test('doca: sem parte visível, mantém o valor de reserva do CSS', () => {
  assert.equal(dockReserve(844, []), null);
  assert.equal(dockReserve(844, [Number.NaN, 900]), null, 'parte fora da tela não conta');
  assert.equal(dockReserve(0, [10]), null);
});

test('doca: a reserva vem da medição, vale em todas as páginas do portal e some com a doca', () => {
  const css = read('components/portal/floating-dock.module.css');
  const tsx = read('components/portal/floating-dock.tsx');
  assert.equal(DOCK_RESERVE_PROPERTY, '--dock-reserve');
  // Uma regra só, na área de conteúdo, usando a medição; nada de números soltos por tela ou por estado.
  assert.match(css, /:global\(\.p-main\):has\(\.dock\)\{padding-bottom:var\(--dock-reserve,/);
  assert.match(css, /:global\(\.pn-shell \.p-main\):has\(\.dock\)\{padding-bottom:var\(--dock-reserve,/);
  assert.doesNotMatch(css, /:has\(\.panel\[data-minimized\]\)\{padding-bottom/, 'o chip minimizado entra na medição, não numa regra fixa');
  assert.doesNotMatch(css, /p-main\):has\(\.dock\)\{padding-bottom:\d/, 'sem padding fixo que ignora o Rolê na doca');
  // Partes medidas: Rolê (itens), botão Widgets e chip minimizado.
  assert.match(tsx, /styles\.itemLauncher\}`\} data-dock-anchor/);
  assert.match(tsx, /styles\.toggleLauncher\}`\} data-dock-anchor/);
  assert.match(tsx, /data-dock-anchor=\{dock\.minimized \|\| undefined\}/);
  // Ao sair (fim da sessão, módulo desligado), o espaço é devolvido.
  assert.match(tsx, /removeProperty\(DOCK_RESERVE_PROPERTY\)/);
  assert.match(tsx, /new ResizeObserver\(measure\)/);
  assert.match(tsx, /addEventListener\('resize', measure\)/);
});

test('doca: páginas sem doca (voluntário, convite, convocação pública, login) não carregam a doca nem a reserva', () => {
  const files = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.(tsx?|css)$/.test(name)) files.push(path); } };
  walk(new URL('../app', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const users = files.filter(path => /floating-dock|FloatingDock|--dock-reserve/.test(readFileSync(path, 'utf8'))).map(path => path.replace(/\\/g, '/').replace(/^.*\/app\//, 'app/'));
  assert.deepEqual(users, ['app/portal-client.tsx'], 'só o portal autenticado monta a doca');
  assert.match(read('app/portal-client.tsx'), /module\.id === 'community'\) && <FloatingDock /, 'a doca só monta para quem tem a Comunidade');
});
