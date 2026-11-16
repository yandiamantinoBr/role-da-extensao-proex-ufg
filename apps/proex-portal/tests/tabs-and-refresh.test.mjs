import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Passada de coerência de 16/11: abas internas com o mesmo desenho de Materiais e Registros, e o "Atualizar" do
// módulo sempre como botão secundário com ícone e texto (dentro de um cartão, só o ícone).
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('internal tabs share the Materiais/Registros look: soft active tab, brand text, dark underline', () => {
  const material = source('../app/globals.css');
  assert.match(material, /\.p-material-tabs>button\.is-active\{color:var\(--brand-ink\);background:var\(--surface-soft\);font-weight:600\}/);
  const management = source('../components/portal/management/management.module.css');
  assert.match(management, /\.tabs button\[aria-selected=true\] \{ background: var\(--surface-soft\); color: var\(--brand-ink\); font-weight: 600; \}/);
  assert.match(management, /:global\(html\[data-theme=dark\]\) \.tabs button\[aria-selected=true\] \{ background: #3a2a48; color: #f2ebf8; box-shadow: inset 0 -3px 0 #dfbaf4; \}/);
  assert.ok(!/aria-selected=true\] \{ background: var\(--purple\)/.test(management), 'sem aba ativa cheia');
  const community = source('../components/portal/community.module.css');
  assert.match(community, /\.tabs button\[aria-selected=true\]\{background:var\(--surface-soft\);color:var\(--brand-ink\);font-weight:600\}/);
  assert.match(community, /:global\(html\[data-theme=dark\]\) \.tabs button\[aria-selected=true\]\{background:#3a2a48;color:#f2ebf8;box-shadow:inset 0 -3px 0 #dfbaf4\}/);
  for (const css of [management, community]) assert.match(css, /font-size: ?12px;/);
});

test('module-level refresh is a secondary button with icon and the word "Atualizar"', () => {
  const buttons = {
    '../components/portal/work-teams-panel.tsx': /className="p-button p-button-subtle" disabled=\{busy \|\| exporting\}.{0,120}?><RefreshCw size=\{16\} aria-hidden="true"\/>Atualizar<\/button>/,
    '../components/portal/meu-trabalho-panel.tsx': /className="p-button p-button-subtle" onClick=\{refresh\} aria-label="Atualizar meu trabalho"><RefreshCw size=\{16\} aria-hidden="true"\/>Atualizar<\/button>/,
    '../components/portal/management/dashboard-panel.tsx': /className="p-button p-button-subtle".{0,160}?><RefreshCw size=\{16\} aria-hidden="true"\/>Atualizar<\/button>/,
    '../components/portal/follow-up-panel.tsx': /className=\{`p-button p-button-subtle \$\{filterStyles\.refresh\}`\}.{0,160}?><RefreshCw size=\{16\} aria-hidden="true"\/><span className=\{filterStyles\.btnText\}>Atualizar<\/span><\/button>/,
    '../components/portal/records-panel.tsx': /aria-label="Atualizar consulta"[^>]*><RefreshCw size=\{16\} aria-hidden="true" \/><span>Atualizar<\/span>/,
    '../components/portal/personal-work-summary.tsx': /className="p-button p-button-subtle" onClick=\{refresh\} aria-label="Atualizar resumo pessoal"><RefreshCw size=\{16\} aria-hidden="true"\/><span>Atualizar<\/span>/,
  };
  for (const [file, pattern] of Object.entries(buttons)) assert.match(source(file), pattern, file);
  assert.ok(!source('../components/portal/management/dashboard-panel.tsx').includes('Recarregar dados'));
});

test('Demandas secondary buttons and Equipes fields use the portal sizes', () => {
  assert.match(source('../components/portal/follow-up-panel.tsx'), /const button='p-button p-button-subtle justify-self-start max-w-full'/);
  const teams = source('../components/portal/work-teams-panel.module.css');
  assert.match(teams, /\.filters :is\(select,input\),\.form :is\(input:not\(\[type=checkbox\]\),select\) \{[^}]*font-size: 13px;/);
  assert.match(teams, /@media \(max-width: 720px\) \{ \.filters :is\(select,input\),\.form :is\(input:not\(\[type=checkbox\]\),select\) \{ font-size: 16px; \} \}/);
  // Configurações no celular: as pílulas que passam da borda esmaecem, mostrando que dá para rolar.
  assert.match(source('../app/settings-groups.module.css'), /\.index \{ flex-wrap: nowrap; overflow-x: auto;[^}]*mask-image: linear-gradient\(to right, #000 82%, transparent\);/);
});
