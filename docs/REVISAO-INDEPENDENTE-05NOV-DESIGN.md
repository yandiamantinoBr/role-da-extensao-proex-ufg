# Revisão independente de design · PR36 · candidato anterior

Parecer somente leitura via Claude Code, revisão c2d0937. Não é aceite do código posterior nem do portal inteiro. Capturas usadas são sintéticas e não entram no repositório público. As limitações de inspeção fazem parte do parecer.

# Revisão independente: c2d0937, foco em UX, texto e acessibilidade básica

**Veredito: não aceito.** Encontrei 3 problemas P2 (estrutura em desktop/móvel e PDF) e nenhum P0 ou P1.

## O que inspecionei
- **Capturas abertas com Read:** as 10 indicadas (4 do resumo pessoal, 4 da estrutura, 2 páginas do PDF).
- **Código lido:**
  - `personal-work-summary.tsx:40-59`
  - `institutional-structure-panel.tsx:85-147`
  - `institutional-structure-panel.module.css` (só regras da árvore e responsivas)
  - `institutional-structure-export.ts` inteiro
  - `globals.css` (só o token do botão primário escuro)
- **Não li:** `personal-work-summary.module.css`, `portal-client.tsx`, `docs/ENTREGA-05NOV-…md`, `report-pdf.ts`.
- **Não certifico:** leitor de tela, aparelho físico, foco por teclado em execução nem o restante do portal.

## P2 (bloqueiam)

**P2-1. Estrutura: o mesmo aviso aparece 4 vezes e a árvore só começa abaixo da dobra.**
- Em 1366 px, a primeira unidade aparece só em y≈660 (`1366-light-overview.png`).
- O aviso "não concede acesso/permissões" se repete em `panel.tsx:88`, `:93`, `:95` (2ª frase) e `:106`.
- O aviso de `:93` vira uma linha única de cerca de 170 caracteres em 1366 px, o que dificulta a leitura.
- **Correção:**
  - Manter só o aviso de `:88`, acrescentando "Alterações valem para toda a organização" quando `canManage`.
  - Remover o `<p className="p-notice">` de `:93`.
  - Remover a 2ª frase da referência em `:95`.
  - Limitar `max-width: 75ch` nos textos do painel.

**P2-2. Árvore móvel longa, repetitiva e sem atalhos de navegação** (`390-light-tree.png`).
- Cada card tem de 180 a 250 px. Com 12 unidades, são cerca de 2.500 px de rolagem.
- Todo card repete o selo "Subordinação" e o texto "0 equipes vinculadas neste recorte" (`panel.tsx:119-120`).
- Os botões Editar/Equipes/Arquivar quebram em duas linhas a partir do 2º nível.
- **Mudança mínima:**
  - (a) Mostrar o selo só para "Governança" e "Arquivada" (`:119`). A legenda e a borda já indicam subordinação.
  - (b) Omitir a contagem de equipes quando for 0 (`:120`).
  - (c) Em `@container (max-width:599px)`, deixar os botões só com ícone. Os `aria-label` com o nome da unidade já existem.
  - (d) Para recolher subárvores, envolver o `NodeBranch` filho (`:122`) em `<details open={depth<2}>` com o resumo "N subordinadas".
- Só (a)–(c) já reduzem cada card para cerca de 110 px.

**P2-3. PDF: a página 1 não tem dados da estrutura, a página 2 fica 60% vazia e a hierarquia não aparece.**
- A tabela "Sobre o recorte" tem 10 linhas e ocupa a página 1. Os 3 registros vão para a página 2.
- As linhas estão em ordem hierárquica (`export.ts:13`), mas sem nenhuma indicação de nível.
- "Unidade formal" quebra em 3 linhas porque os pesos são quase uniformes (`:17`, `[2,1.85,1.76,1.82,1.76,1.3]`).
- Há duas linhas chamadas "Consulta" com sentidos diferentes (`:16`).
- **Correção:**
  - Reduzir `info` a 5 linhas: Organização, Recorte, Fonte com revisão e data, Situação incluída, Consulta dos dados.
  - Passar Conferência e Equipes para uma única nota de rodapé.
  - Renomear "Consulta" para "Unidades incluídas".
  - Pesos sugeridos: `[3.2,1.4,1.5,2.4,1.9,1]`.
  - Prefixar `unidade` com a profundidade, por exemplo `'— '.repeat(depth)` ou "↳". Isso exige passar a profundidade no `visit`.
- Meta: um recorte pequeno caber em uma página.

## P3
- **Resumo pessoal: links duplicados.** "Ver meu trabalho" (`personal-work-summary.tsx:56`) leva ao mesmo destino do card Pendentes (`'pending'`). Sugestão: apontar para a visão geral ou remover.
- **Resumo pessoal: texto redundante.** O escopo mostra "Projeto: Projeto QA descartável" e a seção seguinte repete "Resumo · Projeto QA descartável". Na Início, "Meu trabalho" aparece 3 vezes (menu, painel, "Mais usados").
- **Resumo pessoal: jargão.** A ajuda em `:57` ("Unidade e área temática não reduzem…") é técnica. Sugestão: "Uma demanda pode contar em mais de um grupo."
- **Resumo pessoal: descrição perdida no leitor de tela.** O `aria-label` do card (`:54`) substitui o texto de ajuda ("Em atraso ou bloqueadas"). Sugestão: incluir `help` no rótulo ou usar `aria-describedby`.
- **Estrutura: métrica ambígua.** "1 Governança" (`panel.tsx:94`) não diz o que conta. O PDF diz "Relações de governança"; usar o mesmo texto na tela.
- **Estrutura: editor longe do card.** O editor abre acima da árvore, longe do card clicado, e não diz qual unidade está sendo editada (`:99`). Sugestão: título "Editar unidade · {nome}" e um botão "Cancelar" ao lado de "Salvar".
- **PDF: colunas redundantes.** "Raiz" na coluna Relação repete "Sem unidade superior". As famílias de fonte se misturam entre cabeçalho e corpo (verifiquei só pela imagem).
- **Verificado sem problema:** o botão primário escuro `#8651a6` com texto branco tem contraste de cerca de 5,6:1.

## Notas (rubrica: hierarquia, densidade, clareza do texto, ícones/escaneabilidade, móvel, acessibilidade básica)
| Tela/PDF | Nota | Motivo |
|---|---|---|
| Resumo pessoal (desktop/móvel) | **7/10** | Cards claros, com ícones e cores por tom, e o 2×2 no móvel funciona. Perde pela redundância e pelo texto de ajuda. |
| Estrutura em desktop | **5/10** | Os dados ficam enterrados sob avisos, há 36 botões iguais para 12 nós e selos repetidos. |
| Estrutura no móvel (árvore e editor) | **4/10** | Árvore muito longa, sem como recolher, com títulos quebrando em 3 linhas. O editor em si está aceitável. |
| PDF | **4/10** | Visual institucional limpo, mas desperdiça espaço, a hierarquia é invisível e as colunas estão desequilibradas. |

Não usei os testes (1185) nem o lint e o CI70 como prova. Não consegui gravar o arquivo de plano nem chamar ExitPlanMode porque só tenho Read, Glob e Grep, então a revisão fica só nesta resposta.
