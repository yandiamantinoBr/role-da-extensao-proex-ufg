# Entrega 09/11/2026 · Acabamento visual e coerência

Frente conduzida pelo Claude Code (sessão "visual-coerencia"), branch `claude/visual-coerencia-09nov`. Objetivo: levar o Portal PROEX ao padrão visual do site Vozes da Gestão Pública, sem alterar regras, permissões ou dados.

## O que mudou para quem usa

| Pendência (vault, Rodada 09nov) | Resultado |
|---|---|
| "Refinar contexto" feio e com espaço vazio no celular | Seletor de projeto e botão de filtro na mesma linha. O painel abre logo abaixo, sem sobra. Um ponto laranja indica filtro ativo; os valores continuam no nome acessível. O `<details>` nativo foi mantido, como os testes exigem. |
| Início pouco visual | O cabeçalho do Início virou uma faixa de boas-vindas com data e cores do Rolê (sem bloco extra: o "hero" duplicado já tinha sido removido na V14). "Meu trabalho" ganhou barra de andamento (concluídas, em andamento, a iniciar). Os cartões de resumo têm barra em duas cores. |
| Gráficos interativos fora de Relatórios | O "Panorama" virou uma barra empilhada clicável com legenda em botões (acessível) e aparece no Início (materiais e empréstimos) e em Materiais, além da ficha do projeto. Tocar numa parte lista os registros com link, no projeto certo. Só entra o conjunto que a conta recebeu: nunca um zero no lugar de "sem acesso". Em Demandas, a distribuição por estado e prioridade abre por padrão. |
| Excesso de espaçamento | Cabeçalho, filtros e "Acompanhamento" compactos no celular. Materiais e Dinâmicas mostram primeiro o que se usa no evento (saldo; atendimento presencial); cadastros e "Nova dinâmica" ficam recolhidos ou no fim. No celular, Materiais caiu de cerca de 4.500 para 3.350 px de altura e Dinâmicas de 3.500 para 2.200 px. Cartões de material e de demanda ficaram compactos. |
| Navegação inferior redundante | A barra do celular deixou de repetir "Conta" (fica no avatar do topo e em "Mais") e passou a ser Início + Materiais + Dinâmicas + Demandas + Mais; módulos fixados pela pessoa vêm antes. **Premissa a confirmar com o Yan** (ver Perguntas). |
| Demanda abrindo no projeto de origem | Conferido ponta a ponta em 390 e 1366 px: o link "Abrir projeto de origem" abre a ficha do projeto certo, sem erro de página. Na ficha, "Importar projeto" saiu de cima e fica depois da lista. |
| Toasts, versão e ícones | Avisos com cor por tipo (sucesso, erro, alerta). Versão em pílula legível no rodapé (`Versão 2026.11.09 · <sha>`). Ícones sem repetição: "Pessoas e acessos" usa engrenagem de pessoa e "Relatórios" usa gráfico. |
| Mesma hierarquia em todos os módulos | Títulos em Sora, texto em DM Sans, cartões com a mesma sombra e raio, blocos recolhíveis com o mesmo marcador ▸/▾, escala de texto pequena um degrau acima (nada abaixo de 10 px). |

## Decisões e premissas fáceis de trocar

- **Tipografia:** DM Sans e Sora (licença OFL), as mesmas fontes das peças do Rolê da Extensão encontradas no computador do Yan. Servidas pelo próprio portal. Para trocar, altere `--font-sans` e `--font-display` no fim de `app/globals.css`.
- **Barra inferior:** Início + três atalhos (fixados primeiro; depois Materiais, Dinâmicas, Demandas e Agenda, os módulos do evento; depois os da função) + Mais. Constante `MOBILE_FIELD_MODULES` em `components/portal/portal-navigation.tsx`.
- **Panorama:** materiais e empréstimos no Início, materiais em Materiais; atividades continuam só na ficha do projeto.
- **Demandas no celular:** "Relatórios" sai da tela (fica em Mais e no computador); "Atualizar" vira ícone ao lado do filtro.
- **Nomes dos filtros:** "Refinar contexto" e "Buscar e filtrar" foram mantidos porque os testes fixam esses nomes acessíveis.

## Verificação

- Capturas antes/depois em 390 e 1366 px, temas claro e escuro, dos 14 módulos, com dados sintéticos (`scripts/qa-local.mjs` + sementes privadas ignoradas). Nenhum erro de página nem rolagem horizontal.
- Fluxo demanda → projeto de origem conferido em navegador automatizado nas duas larguras.
- Gates: ver a seção "Resultados" abaixo.

## Fora do escopo

- Lógica dos níveis de brinde na dinâmica e troca de foto dos materiais (sessão paralela `proex-niveis-foto`).
- Regras, permissões e dados: nenhuma alteração.

## Resultados

**Gates (branch, após atualizar com a `main` da PR #41):** 1.339/1.339 testes do portal, `check:types` sem erros, `lint` com 0 erros (2 avisos antigos de `<img>`), `build` e `build:node` concluídos.

**Crítica independente de design (subagente só de leitura, capturas 390/1366 claro/escuro dos 14 módulos):**

| Rodada | Nota | P0/P1 |
|---|---|---|
| Antes (produção 06/11) | 5,5 | — |
| 1 | 6,5 | 7 P1 (estrutura no celular, barra inferior, filtros, hierarquia, cartões altos, gráficos, barras sem sentido, Início longo) |
| 2 | 7,5 | 1 P1 novo (palavra quebrada) |
| 3 | 8,5 | nenhum |
| 4 (final) | **9,0** | **nenhum** |

**Revisão de código "do contra" (só leitura):** nenhum P0. O P1 (fonte nova também nas telas públicas da roleta) foi corrigido: a tipografia ficou restrita ao portal autenticado. Também corrigidos: painel de importação escondido sem perder a prévia, ícone de tema vazio em telas de 320–350 px, "Abrir todos" mantendo o projeto, nome do item nos empréstimos do Panorama e testes da variante do Início.

**Fluxos conferidos no navegador automatizado (390 px, dados sintéticos):** Materiais (detalhe pela seta, filtro de contexto, "Movimentar estoque" aberto, "Novo material" recolhido), Demandas (painel de filtros com Organização, abrir demanda e "Abrir projeto de origem"), Dinâmicas ("Operação presencial" primeiro, "Nova dinâmica" abre o formulário), Agenda e barra inferior ("Conta" segue em Mais). Sem erro de página nem rolagem horizontal.

**Correção de teste:** `tests/my-work-markdown.test.mjs` falhava em qualquer branch em 09/11/2026 (a data de geração do arquivo batia com a data oculta procurada). A `main` recebeu a mesma correção na PR #41; ficou a versão dela.

## Pendências (fora do escopo visual)

- Gráfico de atendimentos e brindes por hora em Dinâmicas (precisa de dado novo).
- Selecionar sozinho o evento quando há um só ativo em "Atendimento presencial" (lógica).
- Plural "10 unidade" na Agenda, montado no servidor (`lib/calendar.ts`).
- Unificar a lógica dos filtros de Agenda, Registros e Equipes no mesmo padrão "Projeto + funil".
- P3 da crítica final: espaço do marcador em "Consumo", largura de "Novo material" em 1366, altura de "Avisos por e-mail", nomes distintos para os dois "Responsáveis e demandas" de Dinâmicas, números de "Meu trabalho" em 28 px.
- Não verificado: celular físico e leitor de tela reais.

## Perguntas para o Yan

1. A barra inferior do celular ficou com Início, Materiais, Dinâmicas, Demandas e Mais. Mantemos assim (recomendado durante o CONPEEX) ou você prefere tirá-la e usar só o menu?
2. As fontes do portal agora são DM Sans e Sora, as mesmas das peças do Rolê. Aprova, ou prefere outra tipografia institucional?
