# Entrega 09/11/2026 · Registros com histórico e gráficos ligados

Frente conduzida pelo Claude Code (sessão "visual-coerencia"), branch `claude/registros-graficos-09nov`, a pedido do Yan (09/11, ~10h): Registros "não está muito bem organizada… tudo que está acontecendo nos diferentes departamentos, dependendo da permissão… por mês, por data, dia… gráficos que você possa passar o mouse, clicar e ser encaminhado para outra página".

## O que mudou

- **Registros ganhou a aba "Histórico" (padrão)**; a tela anterior continua intacta na aba "Documentos".
- **Histórico unificado** (`GET /api/activity`, `lib/activity.ts`): movimentos de estoque, empréstimos (reserva, retirada, devolução), demandas (criadas e concluídas), atividades da agenda e registros manuais.
  - Filtros: período (Hoje, 7 dias, 30 dias, Este mês, Escolher datas; até 92 dias), tipo, projeto e pessoa.
  - Linha do tempo por dia, com atalhos por mês, cabeçalho do dia fixo, agrupamento de acontecimentos repetidos no mesmo minuto e "Ver mais" depois de 8 itens.
  - Cada item leva à origem (material, empréstimo, demanda, agenda ou registros do projeto).
  - Movimento de estoque feito por proposta do assistente aparece como "Pedido ao Rolê, confirmado por <pessoa>" (identificado pela chave da operação `ai_…`).
- **Indicadores clicáveis**: estoque, empréstimos ativos e em atraso, demandas criadas e concluídas, atividades na agenda.
- **Gráficos**: demandas ao longo do tempo (por dia até 14 dias, por semana acima disso), movimento de estoque por material (até 8, nome inteiro, link para a ficha) e ocupação da agenda. Dica ao passar o mouse, a área do gráfico inteira leva ao módulo, "Ver em tabela" como alternativa acessível, sem eixo duplo. Paleta validada com o script da skill dataviz nos dois temas.
- Exemplo do campo de nome de material com a grafia "Botton".

## Quem vê o quê (decidido no servidor)

Cada fonte repete, dentro do SQL, a regra de leitura do próprio módulo:

| Fonte | Regra reaproveitada |
|---|---|
| Estoque | `projectAuthoritySql(['inventory.read'])` |
| Empréstimos e contagem de ativos/atrasados | `projectAuthoritySql(['loans.read'])` |
| Demandas | `authority` de `lib/follow-up/scope.ts` (a mesma de Demandas) |
| Agenda | `projectAuthoritySql(['reports.read','campaigns.manage'])`, a mesma da Agenda |
| Registros manuais | `listRecords` (papel por tipo de registro) |

Resultado: gestores com escopo da organização veem todos os projetos dela; membros de projeto veem só os projetos deles, incluindo o que os colegas do mesmo projeto fizeram; ninguém vê outra organização. Totais dos gráficos, lista de pessoas e contagem de empréstimos usam o mesmo filtro. Não saem nome ou contato de quem pegou emprestado, observações livres, texto dos registros, e-mails. Conta anonimizada aparece como "Pessoa removida", sem identificador.

**Premissas a confirmar com o Yan** (o histórico é mais restrito, nunca mais aberto que os módulos):

- O papel "operador" (bolsista que atende nas dinâmicas) vê só demandas, porque hoje não tem leitura de estoque nem de empréstimos.
- Bolsistas de estoque ou de empréstimos não veem a agenda do projeto no histórico, como na Agenda.
- Demanda da organização sem projeto aparece só para a dona da organização, como em Demandas.
- Nomes de quem concluiu uma demanda e de quem registrou a reserva aparecem no histórico, atendendo ao "com nomes" do pedido.

## Verificação

- Portal: 1.380 testes, tipos, lint (0 erros), `build` e `build:node`, já com as PRs 46–48 da `main`.
- `tests/activity.test.mjs` (8 testes): gestor da organização, bolsista de estoque, colega do mesmo projeto, leitor de outro projeto (inclusive com `projectId` forçado), bolsista de empréstimos, operador, duas organizações, dona da plataforma, acesso revogado, autor anonimizado, filtro por pessoa, campos privados, período e entradas inválidas, rota privada (401 e `private, no-store`), totais exatos com a lista cortada, atraso de empréstimo em milissegundos.
- Revisão de segurança independente (só leitura): nenhum P0/P1, nenhum vazamento entre projetos ou organizações; os dois P2 (identificador de conta anonimizada e atraso calculado comparando número com texto) foram corrigidos.
- Crítica de design independente (capturas 390/1366, claro e escuro): antes **5,0**; rodada 1 **7,5**; rodada 2 **8,6**; rodada 3 **9,0**, sem P0/P1. Evidências em `apps/proex-portal/docs/evidencias/2026-11-09-registros/`.
- Ensaio no navegador (390 e 1366 px): tocar no gráfico de estoque abre a ficha do material, no de demandas abre Demandas, o indicador de empréstimos abre Empréstimos; filtros de período e tipo funcionam; sem erro de página nem rolagem lateral.

## Desempenho

| Medição | Resultado |
|---|---|
| Servidor local, base sintética pequena, p50 de 25 chamadas | Registros antigo (`/api/records`) 11 ms; histórico de 30 dias 17 ms |
| Serviço direto, 20 mil movimentos, 3 mil demandas, 20 projetos | gestor 30 dias 13 ms; gestor hoje 3 ms; gestor 92 dias 21 ms; bolsista 30 dias 7 ms |

A consulta é sempre por período (até 92 dias), com até 600 linhas por fonte e 400 itens na lista; os totais dos gráficos vêm de agregações no banco e não dependem desse corte. Não foi criado índice novo: os existentes (`stock_movements(item_id, created_at)`, `project_schedule_items(project_id, starts_at)`) cobrem a escala atual.

## Recibo da PR42 (acabamento visual)

PR42 integrada em `68c517d` às 10:31; Vercel `dpl_E3X9cVokXuLq4ggk3iUS5pXFfPv3` READY no domínio oficial, mesmo SHA. Conferido sem login: saúde 200, `/login` e `/events` 200, fontes novas 200, `/api/records` 401. A conferência com login fica com o Yan.

## Pendências

- Nomes "Button …" no catálogo de sincronização (`lib/sync/catalog.ts`) são dados de correspondência com a planilha; a troca para "Botton" fica com quem renomeia os itens, para não quebrar a sincronização.
- Botão "Todos" nos tipos (sugestão P3 da crítica).
- Celular físico e leitor de tela reais não verificados.
