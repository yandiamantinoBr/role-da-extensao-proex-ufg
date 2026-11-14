# Entrega 11/11/2026 · R1 (Histórico único) e R4, etapa 1 (Quem cuida de cada área)

> **Não fazer merge antes de 14/11.** A PR fica em rascunho. Nada daqui está em produção.

Sessão de aparência e Registros, ramo `claude/historico-unico-responsaveis`. O pedido veio da coordenadora em 11/11. As propostas foram aprovadas pelo Yan em 10/11 ("Sim, seguir todas") e o plano está em `docs/PLANO-R1-R4-HISTORICO-E-RESPONSAVEIS.md`.

Valem as premissas do plano, porque o Yan ainda não respondeu às duas perguntas:
- "Ver histórico" abre Registros já filtrado;
- a seção da ficha do projeto se chama "Quem cuida de cada área".

## O que muda para quem usa

1. **Um Histórico só (R1).**
   - A linha do tempo virou um componente único (`components/portal/history-timeline.tsx`). Registros usa esse componente e a tela dele não mudou.
   - As fichas de **material**, **empréstimo**, **demanda** e **dinâmica** ganharam o atalho **"Ver histórico"**. Ele abre Registros, aba Histórico, já filtrado por aquele assunto.
   - No Histórico filtrado aparecem o nome do assunto, o botão "Ver histórico de tudo", o período (começa em 90 dias) e o filtro por pessoa. Os gráficos e indicadores gerais ficam de fora.
   - O que entra em cada assunto:

     | Assunto | Acontecimentos |
     |---|---|
     | Material | movimentações de estoque, empréstimos dele, demandas e registros ligados a ele |
     | Empréstimo | reserva, retirada e devolução; demandas e registros ligados a ele |
     | Demanda | criação e conclusão |
     | Dinâmica | demandas ligadas a ela e acessos de voluntário |

2. **"Cronograma"** é o novo nome da "Linha do tempo" da ficha do projeto, que mostra datas futuras. O link `#project-timeline` continua valendo.
3. **"Quem cuida de cada área" (R4, etapa 1).**
   - A ficha do projeto mostra quem cuida do **Estoque**, dos **Empréstimos** e das **Dinâmicas** do projeto inteiro.
   - Quem gerencia o projeto vê o botão "Indicar" (ou "Alterar"), que abre o mesmo formulário de responsáveis do painel antigo. Quem só lê vê os nomes, sem botão.
   - **O painel "Responsáveis e demandas" continua no topo de Materiais, Empréstimos e Dinâmicas.** Ele só sai em outra PR, depois da conferência da auditoria.

## O que não muda

- **Permissões:** nenhuma regra mudou.
  - O filtro por assunto só estreita o que cada módulo já deixava ler.
  - A seção da ficha usa a mesma rota de responsáveis, sem mudança no servidor.
- **Banco:** sem migração.
- **Históricos próprios das fichas** (material, demanda, versões): continuam onde estão. A retirada é o passo 5 do plano, uma PR por ficha, depois de o atalho estar no ar e conferido.

## Quem vê o quê

- **Histórico por assunto** (`GET /api/activity` com `itemId`, `loanId`, `taskId` ou `campaignId`; um só por vez):
  - cada fonte mantém a regra de leitura do próprio módulo, e o assunto entra como um filtro a mais;
  - assunto de outro projeto, de outra organização ou que não existe responde igual: lista vazia e sem nome;
  - no modo assunto não saem totais de gráfico, contagem de empréstimos, prazos nem atividade da equipe.
- **Quem cuida de cada área:**
  - cada área aparece para quem já abre o módulo dela naquele projeto, ou seja, para quem via o painel do topo;
  - quem lê e quem edita é decidido pela rota de responsáveis, como antes;
  - o nome do material no Histórico filtrado segue a regra de Materiais: quem só lê empréstimos vê nome de equipamento, não de brinde.

## Critérios da auditoria (`r4-criterios-conferencia.md`)

| # | Critério | Situação nesta PR |
|---|---|---|
| 1 | Mesmo registro, ida e volta, sem duplicar | **Testado.** `tests/my-work.test.mjs` ("area-wide owners") cobre uma linha só em `work_responsibility_scopes`, com `target_key` vazio e sem material, empréstimo ou dinâmica, e mostra que regravar e repetir o envio não duplicam. No navegador: gravei na ficha e li no topo de Materiais; gravei no topo de Empréstimos e li na ficha. |
| 2 | Mesma trilha | **Testado.** Mesma ação, ator e projeto em `audit`, e uma versão por gravação em `work_responsibility_history`. |
| 3 | Mesma permissão nos dois sentidos | **Testado.** Bolsista de estoque e leitor veem quem cuida do estoque e não editam; outra organização não vê. A ficha mostra cada área a quem já abre o módulo. |
| 4 | Visão de todos os projetos | **Para a PR de retirada.** Com "Todos os projetos", o painel do topo não mostra resumo: só os atalhos e o aviso "Selecione um projeto…". Não há resumo a preservar. |
| 5 | Dinâmicas sem painel por cartão | **Já existe.** O cartão da dinâmica já tem o painel compacto com `campaignId` (`portal-client.tsx`, cartões de Dinâmicas). |
| 6 | Atalhos que somem com o topo | **Para a PR de retirada.** A ficha do projeto já tem "Demandas". Falta decidir o atalho para "Meu trabalho", que já está no menu e na barra de baixo. |
| 7 | Celular, 375 px | **Conferido.** Ficha e Histórico filtrado sem rolagem lateral em 375 e 390 px, e sem erro no console. A seção nova não tem campo sem `id`/`name`. |
| 8 | Testes | **Feito.** Itens 1 a 3 no serviço, e um teste de tela que confirma que a ficha e o painel antigo montam o mesmo formulário com o mesmo alvo. |

## Verificação

- Portal: 1.562 testes passaram, já com a main de 11/11 (PR95). Tipos e lint (0 erros) também. `build` e `build:node` passaram antes de juntar a main; depois dela, quem confere é a verificação automática da PR.
- **Revisão de segurança independente** (só leitura): nenhum P0 ou P1 e nenhum vazamento entre projetos ou organizações. Os quatro P3 foram tratados: nome de material pela regra de Materiais, nenhuma consulta quando não há área a mostrar, `projectId` fora do pedido no modo assunto e arquivo temporário de QA apagado antes do commit.
- **Crítica de design independente** (capturas 390/1366, claro e escuro): primeira nota **8,0**, com um P1 (quem só lê via um botão que terminava em "seu acesso não permite"). O P1 e os ajustes de texto foram corrigidos e a segunda nota foi **9,0**, sem P0 nem P1.
- Testes novos:
  - `tests/activity.test.mjs`: histórico por assunto. Cobre gestor, bolsista de estoque, leitor de outro projeto com ID forçado, outra organização, acesso revogado, ID inexistente, dois assuntos juntos (400), entrada inválida e a rota.
  - `tests/my-work.test.mjs`: critérios 1 a 3 da auditoria.
  - `tests/history-and-area-owners-ui.test.mjs`: endereço `history=`, atalhos das fichas, "Cronograma" e formulário igual nos dois caminhos.
- QA local sintético (127.0.0.1, porta própria), com fluxos de ponta a ponta no navegador e capturas em 390 e 1366 px, claro e escuro: `apps/proex-portal/docs/evidencias/2026-11-11-historico-e-responsaveis/`.

## Não verificado

- Celular físico e leitor de tela.
- Produção: nada foi publicado.
- Conferência da auditoria pela API com os cinco perfis sintéticos. É a parte dela, antes da retirada do painel.

## Pendências e acompanhamentos

- **Retirada do painel do topo** (R4, etapa 2): PR separada, depois da conferência da auditoria (critérios 4 e 6).
- **Retirada dos históricos duplicados** (R1, passo 5): uma PR por ficha, avisando as sessões de Materiais e de Empréstimos.
- **Fora do escopo, só registrado:**
  - a ficha do projeto tem 13 campos sem `id`/`name` em "Opções do relatório" (relatório do projeto), que já existiam antes;
  - os textos internos do formulário de responsáveis ("Recarregar designação", "Revogar designação") são de um componente usado em outras telas e ficaram como estavam; a crítica sugeriu simplificar;
  - "Linha do tempo" continua como nome de seção no relatório do projeto e em "Linha do tempo de prazos" das demandas. Os dois são outra coisa e não foram renomeados.
