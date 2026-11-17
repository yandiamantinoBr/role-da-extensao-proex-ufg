import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Seta comum das caixas que abrem (rodada de 16/11): chevron à direita que gira, no lugar do triângulo do
// navegador, do "›" e das caixas sem seta. Mesmo desenho de "Refinar contexto", Equipes e Configurações.
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = source('../app/globals.css').replace(/\s+/g, ' ');

test('the shared disclosure class draws one chevron and hides every other marker', () => {
  assert.match(css, /details>summary\.p-disclosure\.p-disclosure\{list-style:none;display:flex;/);
  assert.match(css, /details>summary\.p-disclosure\.p-disclosure::-webkit-details-marker\{display:none\}/);
  assert.match(css, /details>summary\.p-disclosure\.p-disclosure::after\{content:"";[^}]*margin-left:auto;[^}]*background:var\(--brand-ink\);[^}]*m6 9 6 6 6-6/);
  assert.match(css, /details\[open\]>summary\.p-disclosure\.p-disclosure::after\{transform:rotate\(180deg\)\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{details>summary\.p-disclosure\.p-disclosure::after\{transition:none\}\}/);
});

test('the boxes that used the browser triangle, "›" or no arrow now use it', () => {
  const boxes = {
    '../components/portal/project-panel.tsx': ['Administrar catálogo', 'Refinar projetos'],
    '../components/portal/records-panel.tsx': ['Adicionar documentos ou fotos'],
    '../components/portal/meu-trabalho-panel.tsx': ['Outras opções'],
    '../components/portal/task-page-summary.tsx': ['Distribuição por estado e prioridade', 'Linha do tempo de prazos'],
    '../components/portal/reports-center.tsx': ['Ajustar recorte e colunas', 'Colunas (', 'Exportar linhas deste recorte', 'Ver valores por mês'],
    '../components/portal/dynamics-explainer.tsx': ['O que é uma dinâmica?'],
    '../components/portal/follow-up-panel.tsx': ['Vincular à demanda', 'Mais materiais e tamanhos', 'Autorizar atualizações nesta demanda', 'Buscar e filtrar', 'Criar equipe', 'integrantes', 'Versões da demanda'],
    '../components/portal/task-triage.tsx': ['Matriz de urgência e importância', 'Triagem com IA'],
    '../components/portal/organization-email-settings.tsx': ['Avisos por e-mail'],
    '../app/portal-client.tsx': ['Novo material', 'Nova dinâmica', 'Cadastrar um patrimônio individual'],
  };
  for (const [file, labels] of Object.entries(boxes)) {
    const code = source(file);
    for (const label of labels) {
      const at = code.indexOf(label, code.search(new RegExp(`<summary[^>]*>[^<]*(<[^/][^>]*>[^<]*)*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)));
      const tag = code.slice(code.lastIndexOf('<summary', at), code.indexOf('>', code.lastIndexOf('<summary', at)) + 1);
      assert.match(tag, /p-disclosure/, `${file}: ${label}`);
    }
  }
  assert.ok(!source('../components/portal/meu-trabalho-panel.module.css').includes("content:'›'"), 'sem o "›" em Meu trabalho');
});
