# Entrega 11/11/2026 · R4, etapa 2: painel "Responsáveis e demandas" sai do topo

> **Não fazer merge antes de 14/11.** PR em rascunho, empilhada sobre a da etapa 1 (`claude/historico-unico-responsaveis`). Nada daqui está em produção.

Sessão de aparência e Registros, ramo `claude/responsaveis-fora-do-topo`. A auditoria conferiu os critérios 1, 2 e 3 da etapa 1 em 11/11 e liberou esta etapa (`r4-conferencia-resultado-11nov.md`, na pasta de notas das sessões).

## O que muda para quem usa

1. **O painel "Responsáveis e demandas" saiu do topo de Materiais, Empréstimos e Dinâmicas.**
   - No lugar, com um projeto escolhido, fica uma linha baixa: "Quem cuida do estoque: ficha do projeto" (ou "dos empréstimos", "das dinâmicas"). O link abre a ficha do projeto, onde está "Quem cuida de cada área".
   - Com "Todos os projetos", não aparece nada: não há projeto para indicar.
2. **A ficha do projeto ganhou o atalho "Meu trabalho"**, ao lado de "Demandas". Os dois abrem já com o projeto escolhido, como os botões do painel antigo.
3. **O painel compacto continua** na ficha do projeto, na ficha do material e nos cartões de empréstimo e de dinâmica.

## Espaço antes da lista

Posição do primeiro bloco depois do filtro (as abas, em Materiais; o título da lista, em Empréstimos e Dinâmicas). O valor é igual nos três módulos.

| Largura | Situação | Antes | Depois | Ganho |
|---|---|---|---|---|
| 390 px | com projeto escolhido | 306 px | 274 px | 32 px |
| 390 px | todos os projetos | 306 px | 246 px | 60 px |
| 1366 px | com projeto escolhido | 454 px | 349 px | 105 px |
| 1366 px | todos os projetos | 454 px | 321 px | 133 px |

No celular, a linha nova ocupa 20 px. A área de toque do link passa de 44 px por uma margem invisível, que não empurra a lista.

## Critérios da auditoria que faltavam

| # | Critério | Como ficou |
|---|---|---|
| 4 | Visão de todos os projetos | Com "Todos os projetos", o painel antigo mostrava só os dois botões e o aviso "Selecione um projeto…". Não havia resumo de vários projetos, então nada se perde. Meu trabalho e Demandas continuam no menu. |
| 6 | Atalhos que somem com o topo | "Meu trabalho" e "Demandas" estão na ficha do projeto, já filtrados. Do módulo até a ficha é um toque, pela linha nova. Os dois também continuam no menu e na barra de baixo, que mantêm o projeto escolhido. |
| — | Painel montado duas vezes no celular (observação da auditoria) | As duas cópias saíram: a página não tem mais nenhuma. O componente do painel ficou só com a forma compacta, com uma montagem e uma consulta. |

## O que não muda

- Permissões e servidor: nada mudou. Sem migração.
- Quem via os responsáveis no topo continua vendo na ficha do projeto (etapa 1, conferida pela auditoria).

## Verificação

- Portal: 1.563 testes passaram. Tipos, lint (0 erros), `build` e `build:node` também.
- Teste novo em `tests/history-and-area-owners-ui.test.mjs`: sem painel no topo, linha com o caminho para a ficha, atalhos na ficha e painel só na forma compacta.
- QA local sintético, no celular (390 px):
  - a linha leva à ficha nos três módulos, e a seção "Quem cuida de cada área" está lá;
  - "Meu trabalho" e "Demandas" da ficha abrem com o projeto escolhido;
  - sem projeto, a linha não aparece;
  - os cartões de empréstimo e de dinâmica mantêm o painel compacto;
  - sem rolagem lateral e sem erro no console.
- Capturas do antes e do depois em 390 e 1366 px, claro e escuro: `apps/proex-portal/docs/evidencias/2026-11-11-painel-fora-do-topo/`.

## Não verificado

- Celular físico e leitor de tela.
- Produção: nada foi publicado.
