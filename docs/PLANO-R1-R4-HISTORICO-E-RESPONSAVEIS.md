# Plano R1 e R4 · Histórico único e Responsáveis nas fichas

Escrito em 10/11/2026 pela sessão de aparência e Registros. O Yan aprovou as propostas em 10/11 ("Sim, seguir todas").

**Nada daqui vai ao ar antes de 14/11.** Origem: `apps/proex-portal/docs/REVISAO-GERAL-09NOV.md` (R1 e R4) e a nota da vault "Portal PROEX - Consolidação 10nov". Os nomes seguem `apps/proex-portal/docs/GLOSSARIO.md`, seção "Nomes finais aprovados".

## Situação em 11/11

Pronto em ramo (`claude/historico-unico-responsaveis`), com PR em rascunho e **sem merge antes de 14/11**. O detalhe está em `docs/ENTREGA-11NOV-R1-R4-HISTORICO-E-RESPONSAVEIS.md`.

| Parte | Situação |
|---|---|
| R1, passos 1 a 4 (Cronograma, componente único, filtro por assunto, "Ver histórico") | feito no ramo |
| R1, passo 5 (tirar os históricos duplicados das fichas) | falta; uma PR por ficha, depois do merge |
| R4, passo 1 ("Quem cuida de cada área" na ficha do projeto) | feito no ramo |
| R4, passo 2 (conferência da auditoria) | feita em 11/11: critérios 1, 2 e 3 passaram (`r4-conferencia-resultado-11nov.md`, na pasta de notas das sessões) |
| R4, passos 3 e 4 (tirar o painel do topo e medir o ganho) | feito em ramo próprio (`claude/responsaveis-fora-do-topo`), PR em rascunho empilhada sobre a primeira; detalhe em `docs/ENTREGA-11NOV-R4-ETAPA2-PAINEL-FORA-DO-TOPO.md` |

## R1 · Um componente Histórico

**Hoje** o histórico aparece em sete lugares, cada um com o seu desenho:

1. Registros, aba Histórico (`components/portal/activity-panel.tsx` e `lib/activity.ts`, `GET /api/activity`);
2. ficha do material (`material-movement-history.tsx`, dentro de `material-detail-drawer.tsx`);
3. demanda (linha do tempo de prazos em `task-page-summary.tsx`);
4. versões;
5. "Linha do tempo" do projeto (`project-detail.tsx`, `#project-timeline`), que na verdade mostra datas futuras;
6. pré-cadastro;
7. consumo.

**Forma final:** um componente **Histórico** com filtro por assunto. As fichas ficam só com o atalho "Ver histórico", que abre o Histórico já filtrado.

### Passos (uma PR por passo, cada um publicável sozinho)

1. **Renomear para "Cronograma"** a "Linha do tempo" do projeto. Muda o título, o `aria-label` e o texto de ajuda. A âncora `#project-timeline` continua, para não quebrar links. É a parte de menor risco e pode ir primeiro.
2. **Extrair o componente.**
   - De `activity-panel.tsx` saem `HistoryTimeline` (os dias, os agrupamentos, "Ver mais" e as quebras de nome corrigidas em 10/11) e `HistoryFilters`.
   - O painel de Registros passa a usar os dois. Nada muda na tela, e os testes atuais de Registros cobrem essa etapa.
3. **Filtro por assunto na API.**
   - `GET /api/activity` aceita `itemId`, `loanId`, `taskId` e `campaignId`, além de `projectId`.
   - Cada filtro repete a regra de leitura do módulo de origem, como já acontece hoje.
   - Testes de visibilidade para cada um: leitor de outro projeto com o ID forçado, outra organização e acesso revogado.
4. **Atalho "Ver histórico" nas fichas.**
   - Fichas de material, empréstimo, demanda e dinâmica.
   - O atalho leva a `?module=records&view=history&item=<id>` (ou o filtro correspondente) e mostra o assunto como um chip removível.
   - Os históricos próprios de cada ficha saem só depois que o atalho estiver no ar e conferido.
5. **Remover os históricos duplicados**, um por PR, com captura antes e depois.
   - Ordem: material, demanda, versões, pré-cadastro, consumo.
   - Antes de remover cada um, confirmar que o Histórico mostra os mesmos acontecimentos, inclusive correções e estornos com selo.

**Pronto quando:**
- só exista um Histórico;
- toda ficha tenha "Ver histórico";
- o projeto mostre "Cronograma";
- os testes de visibilidade passem;
- houver capturas em 390 e 1366 px nos dois temas.

**Premissa fácil de trocar:** o atalho abre Registros, em vez de um painel lateral dentro da ficha. Se o Yan preferir ver sem sair da ficha, o mesmo componente abre numa gaveta.

## R4 · Responsáveis e demandas nas fichas

**Hoje** o painel "Acompanhamento", com "Responsáveis deste contexto", fica no topo de Materiais, Empréstimos e Dinâmicas.
- No código: `app/portal-client.tsx`, linha com `(['materials','loans','events']).includes(tab) && workContext(...)`, e `components/portal/work-context-panel.tsx`, que usa `ResponsibilityManager`.
- Ele também aparece nas fichas e cartões, com `compact`, quando recebe `itemId`, `loanId` ou `campaignId`.
- **Restrição registrada pela auditoria:** só nesse painel do topo se escolhe quem cuida da área inteira (estoque, empréstimos ou dinâmicas) de um projeto. Por isso ele não pode sair antes de essa escolha existir na ficha do projeto.

### Passos

1. **Ficha do projeto ganha "Quem cuida de cada área".**
   - Na ficha do projeto (`project-detail.tsx`), uma seção com três linhas: Estoque, Empréstimos e Dinâmicas.
   - Cada linha reaproveita `ResponsibilityManager` com `area`, sem `itemId`, `loanId` nem `campaignId`.
   - Mesma ação no servidor, mesma permissão e mesmo teste. Nenhuma regra nova.
2. **Conferir com a auditoria** ([sessão de auditoria](#local_21bcebee-33a1-4ab3-86fc-aaf83778ce0d)): os dois caminhos devem gravar o mesmo registro, com a mesma trilha de auditoria.
3. **Tirar o painel do topo** de Materiais, Empréstimos e Dinâmicas.
   - No topo fica só uma linha discreta, "Responsáveis: ficha do projeto", para quem gerencia.
   - O painel compacto continua nas fichas e cartões, e em Meu trabalho.
4. **Medir o ganho no celular:** altura antes da lista, em 390 px, nos três módulos, com captura antes e depois.

**Pronto quando:**
- a escolha da área inteira estiver na ficha do projeto e for testada;
- o topo dos três módulos estiver sem o painel;
- as fichas mantiverem o painel compacto;
- a auditoria tiver conferido que nada se perdeu.

## Combinação com outras sessões

- **Auditoria** (`local_21bcebee`): passo 2 de R4, antes de tirar o painel.
- **Materiais** e **Empréstimos**: o passo 5 de R1 remove históricos dentro das fichas deles. Avisar antes de cada PR, para não haver conflito.
- **Rolê:** os registros "Pedido ao Rolê" continuam no Histórico como hoje. A lógica do assistente não muda.

## Perguntas para o Yan (com premissa adotada)

1. "Ver histórico" abre Registros já filtrado (premissa) ou uma gaveta dentro da ficha?
2. Na ficha do projeto, a seção se chama "Quem cuida de cada área" (premissa) ou "Responsáveis do projeto"?
