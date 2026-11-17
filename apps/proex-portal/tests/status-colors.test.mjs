import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Cores pelo significado (passada de coerência de 16/11): roxo = informação, aqua/verde = ativo ou concluído,
// laranja = atenção, vermelho só para o crítico (prazo vencido). Selos com versão própria no tema escuro.
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('red is reserved for the overdue deadline; priority and "Atenção" use attention orange or neutral', () => {
  const signals = source('../components/portal/work-signals.tsx');
  assert.match(signals, /const tone: SignalTone = priority === 'high' \? 'warning' : 'neutral';/);
  assert.match(source('../lib/follow-up/presentation.ts'), /kind: 'overdue', tone: 'danger'/, 'prazo vencido continua crítico');
  // "Atenção" (em atraso ou bloqueadas) tem a mesma cor no Início e em Meu trabalho.
  assert.match(source('../components/portal/personal-work-summary.tsx'), /label:'Atenção',[^}]*tone:'warning'/);
  assert.match(source('../components/portal/meu-trabalho-panel.tsx'), /name: 'Atenção',[^}]*tone: 'warning'/);
  const card = source('../components/portal/work-task-card.module.css');
  assert.match(card, /\.card\[data-priority=high\] \{ border-inline-start-color: #d06f00; \}/);
  assert.ok(!/#b91c1c|#fda4af/.test(card), 'sem vermelho na borda de prioridade');
});

test('status badges have their own dark colors and disabled buttons stay readable in dark mode', () => {
  const css = source('../app/globals.css');
  for (const rule of [
    'html[data-theme=dark] .p-badge{background:#33243f;color:#e3cdf3}',
    'html[data-theme=dark] .p-status-active,html[data-theme=dark] .p-status-returned,html[data-theme=dark] .p-status-accepted{background:#143438;color:#a8e6ec}',
    'html[data-theme=dark] .p-status-late{background:#452233;color:#ffd0dd}',
    'html[data-theme=dark] .p-status-paused,html[data-theme=dark] .p-status-pending{background:#3b2a16;color:#ffc983}',
    'html[data-theme=dark] .p-button:disabled,html[data-theme=dark] .p-button-primary:disabled{opacity:1;background:#2c2236;border-color:#4a3a58;color:#a99bb6}',
  ]) assert.ok(css.includes(rule), rule);
  // Cada situação usada pelo Badge tem versão escura.
  const light = [...css.matchAll(/\.p-status-([a-z]+)[,{]/g)].map(match => match[1]);
  for (const status of new Set(light)) assert.ok(css.includes(`html[data-theme=dark] .p-status-${status}`), status);
});

test('tags are round like the status badges', () => {
  assert.match(source('../components/portal/project-panel.module.css'), /\.scopeInternal,\.scopeExternal\{display:inline-block;border-radius:999px;/);
  assert.match(source('../components/portal/project-panel.module.css'), /\.featureBadge\{[^}]*border-radius:999px;/);
  assert.match(source('../components/portal/work-teams-panel.module.css'), /\.mine \{[^}]*border-radius: 999px;/);
});
