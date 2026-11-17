import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('components/portal/dock-reserve.ts');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { dockReserve, fabPlacement, FAB_STEP, FAB_MARGIN, DOCK_RESERVE_PROPERTY, DOCK_RESERVE_GAP } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('doca de computador: o espaço no fim da página cobre a parte mais alta em repouso, com folga', () => {
  assert.equal(dockReserve(900, [824]), 900 - 824 + DOCK_RESERVE_GAP);
  assert.equal(dockReserve(900, [824, 772]), 900 - 772 + DOCK_RESERVE_GAP, 'com o Rolê na doca, o espaço cresce');
  assert.equal(dockReserve(900, [824, 772, 716]), 900 - 716 + DOCK_RESERVE_GAP, 'o chip minimizado também entra na medição');
  assert.equal(dockReserve(900, [830.4]), Math.ceil(900 - 830.4 + DOCK_RESERVE_GAP), 'arredonda para cima');
});

test('doca: sem parte visível, mantém o valor de reserva do CSS', () => {
  assert.equal(dockReserve(844, []), null);
  assert.equal(dockReserve(844, [Number.NaN, 900]), null, 'parte fora da tela não conta');
  assert.equal(dockReserve(0, [10]), null);
});

test('doca: a reserva medida vale no computador e some com a doca', () => {
  const css = read('components/portal/floating-dock.module.css');
  const tsx = read('components/portal/floating-dock.tsx');
  assert.equal(DOCK_RESERVE_PROPERTY, '--dock-reserve');
  // Uma regra só, na área de conteúdo, usando a medição; nada de números soltos por tela ou por estado.
  assert.match(css, /:global\(\.p-main\):has\(\.dock\)\{padding-bottom:var\(--dock-reserve,/);
  assert.match(css, /@media \(width > 720px\)\{\s*:global\(\.p-main\):has\(\.dock\)\{padding-bottom:var\(--dock-reserve,/);
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
  assert.match(tsx, /launchers\.current\[returnTo\] \?\? launchers\.current\.toggle/, 'fechar um painel minimizado volta ao botão Widgets se a pilha estiver recolhida');
});

test('celular: Widgets e o Rolê independente ficam no cabeçalho, e a folha só existe depois de abrir', () => {
  const dock = read('components/portal/floating-dock.tsx');
  const role = read('components/portal/role-assistant.tsx');
  const css = read('components/portal/floating-dock.module.css');
  assert.match(dock, /document\.querySelector\('\.pn-shell \.p-topbar-actions'\)/);
  assert.match(dock, /if \(toolbar\) \{[\s\S]*createPortal\(<button[\s\S]*setMobileView\('launchers'\)/);
  assert.match(dock, /mobileOpen && <dialog[^>]*className=\{styles\.mobileDialog\}/);
  assert.match(dock, /sheet\.showModal\(\)/);
  assert.match(dock, /event\.shiftKey && \(current === first \|\| current === mobileHeading\.current\)/);
  assert.match(dock, /const shown = dock !== null && !toolbar/);
  assert.match(css, /@media \(max-width:720px\)\{\s*\.dock\{display:none\}/);
  assert.match(role, /!open && ready && !dock\.registered/);
  assert.match(role, /toolbar \? createPortal\(launcher, toolbar\) : launcher/);
});

test('doca: páginas sem doca (voluntário, convite, convocação pública, login) não carregam a doca nem a reserva', () => {
  const files = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.(tsx?|css)$/.test(name)) files.push(path); } };
  walk(new URL('../app', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const users = files.filter(path => /floating-dock|FloatingDock|--dock-reserve/.test(readFileSync(path, 'utf8'))).map(path => path.replace(/\\/g, '/').replace(/^.*\/app\//, 'app/'));
  assert.deepEqual(users, ['app/portal-client.tsx'], 'só o portal autenticado monta a doca');
  assert.match(read('app/portal-client.tsx'), /module\.id === 'community'\) && <FloatingDock /, 'a doca só monta para quem tem a Comunidade');
});


test('Rolê pode receber Escape com o estado ainda carregando', () => {
  const role = read('components/portal/role-assistant.tsx');
  assert.match(role, /ref=\{dialog\}[^>]+tabIndex=\{-1\}/);
  assert.match(role, /\(input\.current \?\? panel\)\.focus/);
  assert.match(role, /\[open, status\?\.available\]/);
});

test('celular flutuante: o botão fica em casa quando nada está embaixo e sobe só o necessário quando há um botão', () => {
  const home = { left: 324, right: 376, bottom: 760, size: 52, limit: 300 };
  assert.equal(fabPlacement({ ...home, blocked: () => false }), 0, 'livre: fica em casa');
  // Um botão de largura total ocupa de 700 a 760 px: o botão flutuante precisa subir acima dele, com margem.
  const shift = fabPlacement({ ...home, blocked: (x, y) => y >= 700 && y <= 760 });
  assert.ok(shift !== null && shift % FAB_STEP === 0);
  assert.ok(760 - shift + FAB_MARGIN < 700, 'a parte de baixo do botão, com a margem, fica acima do controle');
  assert.ok(760 - (shift - FAB_STEP) + FAB_MARGIN >= 700, 'e não sobe mais que um passo além do necessário');
  // Um controle só na lateral esquerda não atrapalha o canto direito.
  assert.equal(fabPlacement({ ...home, blocked: x => x < 200 }), 0);
});

test('celular flutuante: sem lugar livre, o botão some em vez de cobrir algo', () => {
  const home = { left: 324, right: 376, bottom: 760, size: 52, limit: 300 };
  assert.equal(fabPlacement({ ...home, blocked: () => true }), null, 'tudo ocupado: esconde');
  assert.equal(fabPlacement({ ...home, bottom: 40, blocked: () => false }), null, 'sem espaço acima da barra: esconde');
  let probes = 0;
  fabPlacement({ ...home, blocked: () => { probes++; return false; } });
  assert.ok(probes > 0 && probes <= 9, 'em casa, no máximo nove pontos são consultados');
});

test('modos escolhidos: lateral fixa reserva o próprio espaço, botão do celular sai da frente e a escolha fica em Meu espaço', () => {
  const css = read('components/portal/floating-dock.module.css');
  const tsx = read('components/portal/floating-dock.tsx');
  // Computador, fixo na lateral: a área de trabalho (cabeçalho incluso) encolhe; nada fica por baixo do trilho.
  // A classe local fica fora do :global(), senão o CSS Module não troca o nome e a regra nunca vale (a lateral cobria 85 px).
  assert.match(css, /:global\(html\):has\(\.sideDock\) :global\(\.pn-shell>\.p-workspace\)\{width:calc\(100% - var\(--portal-sidebar-width\) - var\(--dock-side\)\)\}/);
  assert.match(css, /:global\(html\):has\(\.sideDock\)\{--dock-side:84px\}/);
  assert.match(css, /:global\(html\):has\(\.sideDock\[data-open\]\)\{--dock-side:424px\}/);
  assert.doesNotMatch(css, /:global\([^)]*\.(sideDock|mobileFab|dock)\b/, 'nenhuma classe local dentro de :global()');
  assert.match(tsx, /const sidebar = !toolbar && layout\.desktop === 'sidebar'/);
  assert.match(tsx, /const shown = dock !== null && !toolbar && !sidebar/, 'a reserva de baixo do modo flutuante não vale na lateral');
  // Celular, flutuante no canto: fica visível ao rolar; some só com campo focado e com a central ou uma folha aberta; reserva o fim da página.
  assert.match(css, /\.mobileFab\[data-state=away\]\{opacity:0;visibility:hidden;pointer-events:none\}/);
  assert.match(css, /:global\(\.pn-shell \.p-main\):has\(\.mobileFab\)\{padding-bottom:var\(--dock-reserve,/);
  assert.match(css, /aria-controls="followup-notification-center"\]\[aria-expanded="true"\]\)\) \.mobileFab,:global\(body:has\(dialog\[open\]\)\) \.mobileFab/);
  assert.doesNotMatch(tsx, /const onScroll = \(\) => \{ button\.dataset\.state = 'away';/, 'o botão não some ao rolar (Yan, 17/11)');
  assert.match(tsx, /if \(editing\(\)\) \{ button\.dataset\.state = 'away'; return; \}/);
  assert.match(tsx, /layout\.mobile === 'floating'\s*\? <>[\s\S]{0,4000}<MobileFab/);
  // Escolha por conta, em Meu espaço, sem roubar o foco ao carregar.
  assert.match(tsx, /name=\{`dock-layout-\$\{choice\.device\}`\}/);
  assert.match(tsx, /action: 'layout', device, value/);
  assert.match(tsx, /setLayout\(current => current\[device\] === value \? \{ \.\.\.current, \[device\]: previous \}/, 'falha ao gravar desfaz só aquele aparelho, se a tela ainda mostrar o valor que falhou');
  assert.match(tsx, /if \(layoutRequests\.current\[device\] !== request\) return; setLayout/, 'resposta atrasada de uma escolha anterior é ignorada');
  assert.doesNotMatch(tsx, /setLayout\(current => \{[\s\S]{0,200}communityPost/, 'nada de gravar dentro da função que atualiza o estado');
  assert.match(tsx, /if \(toolbar \|\| !dock\?\.open \|\| dock\.minimized \|\| !openedByPerson\.current\) return;/, 'carregar com um painel aberto não move o foco');
});


test('celular: o botão do canto abre o mesmo leque com nomes do computador, e flutuante é o padrão', () => {
  const css = read('components/portal/floating-dock.module.css');
  const tsx = read('components/portal/floating-dock.tsx');
  const lib = read('lib/community/widgets.ts');
  // Pedido do Yan (16/11): no celular, o leque com rótulos como no computador, sem precisar escolher.
  assert.match(tsx, /const DEFAULT_LAYOUT: DockLayout = \{ desktop: 'floating', mobile: 'floating' \}/);
  assert.match(lib, /DEFAULT_DOCK_LAYOUT: DockLayout = \{ desktop: 'floating', mobile: 'floating' \}/);
  assert.match(tsx, /\{fan && <MobileFan onClose=\{\(\) => setFan\(false\)\}>/, 'o botão abre o leque, não a folha');
  assert.match(tsx, /onOpen=\{\(\) => setFan\(value => !value\)\}/, 'tocar de novo recolhe');
  assert.match(tsx, /className=\{styles\.stackLabel\}[^>]*>\{label\}/, 'cada botão do leque tem o nome ao lado');
  assert.match(tsx, /setFan\(false\); setMobileView\(widgetId\)/, 'escolher um widget abre o painel dele');
  assert.match(tsx, /setFan\(false\); item\.onOpen\(\)/, 'o Rolê também está no leque');
  assert.match(tsx, /event\.key === 'Escape'/);
  assert.match(css, /\.mobileFan\{position:fixed;right:14px;bottom:calc\(var\(--dock-fab-nav,72px\)/, 'o leque sobe a partir do botão, acima da barra de baixo');
  assert.match(css, /\.mobileFab\[data-open\]\{[^}]*visibility:visible/, 'com o leque aberto o botão não some');
});

test('celular: sem lugar livre, o botão do canto fica em casa em vez de sumir', () => {
  const tsx = read('components/portal/floating-dock.tsx');
  assert.doesNotMatch(tsx, /if \(shift === null\) \{ button\.dataset\.state = 'away'; return; \}/, 'na tela cheia de cartões (Início) o botão sumia');
  assert.match(tsx, /--dock-fab-shift', '0px'\)/, 'o botão fica sempre no mesmo lugar, não pula');
  assert.doesNotMatch(tsx, /fabPlacement\(/, 'nada de procurar outro lugar na tela');
});

test('Meu espaço: cartões com desenho de cada modo, aviso de salvo, e ordem do leque por setas valendo nos dois aparelhos', () => {
  const tsx = read('components/portal/floating-dock.tsx');
  const css = read('components/portal/floating-dock.module.css');
  // O leque, o trilho e a lista do celular seguem a ordem escolhida, não a ordem fixa do código.
  assert.match(tsx, /const active = dock\.enabled\.map\(widgetId => WIDGETS\.find/);
  assert.doesNotMatch(tsx, /const active = WIDGETS\.filter/, 'a ordem fixa antiga não volta');
  // Quatro modos, cada um com miniatura; a escolha continua sendo um rádio por aparelho (teclado e leitor de tela).
  for (const kind of ['desktop-floating', 'desktop-sidebar', 'mobile-floating', 'mobile-header']) assert.match(tsx, new RegExp(`picture: '${kind}'`));
  assert.match(tsx, /<input className=\{styles\.modeRadio\} type="radio" name=\{`dock-layout-\$\{choice\.device\}`\}/);
  assert.match(tsx, /<Miniature kind=\{option\.picture\}\/>/);
  assert.match(tsx, /aria-hidden="true" focusable="false"/, 'o desenho é decorativo: o texto do cartão diz o mesmo');
  assert.match(css, /\.modeCard:has\(\.modeRadio:focus-visible\)\{outline:3px solid var\(--focus\)/, 'o foco do teclado aparece no cartão');
  // "Salvo" anunciado por aparelho e para a lista de widgets.
  assert.match(tsx, /role="status" aria-live="polite"/);
  assert.match(tsx, /saving: 'Salvando…', saved: 'Salvo'/);
  assert.match(tsx, /<legend className=\{styles\.groupHead\}>[\s\S]{0,200}<SaveStatus note=\{note\} area=\{choice\.device\}\/><\/legend>/, 'o aviso fica ao lado do título do grupo e não empurra a tela');
  assert.match(tsx, /id="dock-order-heading"[^>]*>Widgets e ordem do leque<\/h3><SaveStatus note=\{note\} area="widgets"\/>/, 'marcar, desmarcar e mover também mostram Salvo, à vista');
  assert.match(tsx, /onChange=\{next => update\(\(\) => next, true, 'widgets'\)\}/);
  // O que vale onde fica escrito.
  assert.match(tsx, /Cada aparelho tem a sua escolha\./);
  assert.match(tsx, /Vale no computador e no celular\. A ordem é a do leque, de cima para baixo\./);
  // Setas com nome, alvo de 44 px, primeira não sobe e última não desce, e o foco fica no widget movido.
  assert.match(tsx, /aria-label=\{`Subir \$\{widget\.label\}`\}[^>]*disabled=\{index === 0\}/);
  assert.match(tsx, /aria-label=\{`Descer \$\{widget\.label\}`\}[^>]*disabled=\{index === dock\.enabled\.length - 1\}/);
  assert.match(css, /\.orderMoves button\{display:grid;place-items:center;width:44px;height:44px/);
  assert.match(tsx, /\(same && !same\.disabled \? same : other\)\?\.focus/);
});

test('Meu espaço: o aparelho em uso vem primeiro, abaixo do título da seção', () => {
  const tsx = read('components/portal/floating-dock.tsx');
  const css = read('components/portal/floating-dock.module.css');
  assert.match(tsx, /<details className=\{styles\.otherDevice\}>/, 'o outro aparelho fica recolhido, para a lista subir');
  assert.match(tsx, /\[\.\.\.LAYOUT_CHOICES\]\.sort\(\(a, b\) => Number\(b\.device === device\) - Number\(a\.device === device\)\)/);
  assert.doesNotMatch(css, /\.layoutChoice\[data-here\]\{order:-1\}/, 'order no CSS passava o grupo para cima do título');
});

test('Meu espaço: desligados à parte e discretos, sem o lilás que marca o escolhido', () => {
  const tsx = read('components/portal/floating-dock.tsx');
  const css = read('components/portal/floating-dock.module.css');
  assert.match(tsx, /<h4 className=\{styles\.offHeading\}>Desligados<\/h4>/);
  assert.match(css, /\.orderRow\[data-off\]\{border-style:dashed;background:transparent\}/);
  assert.doesNotMatch(css, /\.orderRow\[data-off\]\{background:var\(--surface-soft\)\}/);
  assert.match(css, /\.orderCheck\{appearance:none;[^}]*border:2px solid/, 'caixa desmarcada com borda visível nos dois temas');
});

test('Meu espaço: o resumo do outro aparelho cabe no painel estreito e não repete o rótulo', () => {
  const tsx = read('components/portal/floating-dock.tsx');
  const css = read('components/portal/floating-dock.module.css');
  assert.match(tsx, /<summary><span className=\{styles\.otherText\}><strong>Outro aparelho:/, 'título em cima, escolha atual embaixo');
  assert.match(css, /\.otherDevice\[open\] \.otherChoice\{display:none\}/);
  assert.match(tsx, /\{group\(choices\[1\], true\)\}/);
  assert.match(css, /\.foldedLegend\{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset\(50%\)/, 'o rótulo repetido some da tela, mas fica para o leitor de tela');
});

