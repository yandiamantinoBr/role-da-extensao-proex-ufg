# Revisão independente: Estrutura institucional, Meu trabalho e PDFs (05/11, depois do e3da3e9 e do cabeçalho compacto)

## Veredito: **não aprovo ainda**

O motivo é de evidência, não de desenho. As duas capturas a 1366 px no tema claro estão visivelmente fora do padrão do restante do conjunto. Por isso não sustentam uma nota ≥9 para a estrutura no desktop claro. O código e as demais capturas já sustentam 9 nas áreas avaliadas. Não encontrei P0 nem P1.

## O que examinei

- **Capturas abertas com Read (17):**
  - `structure-integrated/`: as 12 pedidas (estrutura, PDFs e cabeçalho do projeto).
  - `personal-summary-qa/`: as 5 pedidas (resumo pessoal).
- **Código lido inteiro:**
  - `institutional-structure-panel.tsx` e `.module.css`
  - `personal-work-summary.tsx`
  - `institutional-structure-export.ts`
- **Código lido em parte:**
  - `report-pdf.ts`: só a validação e o agrupamento de colunas, linhas 15–16 e 55–61.
  - `globals.css` e `project-detail.tsx:162`, por busca pontual.
- **Não li:** `personal-work-summary.module.css`. Julguei o resumo pessoal pelas imagens.
- **Não verifiquei:** teclado ou leitor de tela em execução, aparelho físico, produção. Não usei testes aprovados como prova visual. Aceito como informado, sem conferir, que Cancelar e Escape devolvem o foco.

## Notas por área

| Área | Nota | Base |
|---|---|---|
| Resumo pessoal | **9** | 2×2 legível a 375 e 390 px nos dois temas e tons distintos. No estado revogado (`:56`), os cards viram `div aria-disabled` sem seta e mostram "—", com uma única mensagem. Ajuda e horário estão claros. |
| Estrutura desktop | **9 no escuro; claro não avaliável** | Escuro: linha densa com título e 3 ações, Arquivar tracejado e secundário, editor dentro do `<li>` com o nome completo em 2 linhas, Cancelar ao lado de Salvar. Claro: a captura apresenta defeito (ver achado 1). |
| Estrutura móvel | **9** | Fonte recolhida por padrão. Botões só com ícone de 44 px, com `title` e `aria-label`, e Arquivar diferenciado. Ramos de nível ≥2 recolhidos e contados ("2 unidades subordinadas"). Editor no ponto de origem, com o título limitado a 2 linhas e reticências. |
| PDF compacto | **9** | 1 página, 4 colunas com corpo em 10 pt e "Sobre o recorte" em 5 linhas. A numeração 1/1.1/1.1.1 mostra a hierarquia e "—" substitui as repetições. |
| PDF multipágina | **9** | Pág. 2: 10 linhas, quase todas com 3 linhas de altura. O título longo sai completo em 6 linhas, sem reduzir a fonte. O cabeçalho da tabela se repete com "(continuação)". |

## Pendências anteriores

### P2 da crítica anterior
- **P2-3, pesos das colunas do PDF: resolvido.**
  - Em vez de reequilibrar seis colunas, o PDF agrupa os campos em quatro colunas impressas (`export.ts:19`).
  - `report-pdf.ts:58` exige que cada coluna autorizada apareça exatamente uma vez, sem chave inventada. Isso impede omissão, duplicação e invenção de campos.
  - O DOCX e o XLSX continuam com as seis colunas originais.
  - A meta de "≤4 linhas por registro" foi atendida em todos os registros, menos o título sintético propositalmente longo. Ali, preservar o conteúdo é o correto.
- **P2-1 e P2-2** continuam resolvidos.

### P3 da crítica anterior
| Item | Situação |
|---|---|
| Estado revogado do resumo | **Resolvido** (`personal-work-summary.tsx:56`) |
| Preâmbulo móvel | **Parcial.** A fonte está recolhida e as métricas ficaram compactas. O 1º nó ainda aparece só em y≈670 a 390 px, o que é aceitável. |
| Editor longe do card e Escape | **Resolvido** (`panel.tsx:95-96,129,154`) |
| Título longo no editor | **Resolvido** (`.css:94`) |
| Região de status sempre montada | **Resolvido** (`panel.tsx:119`) |
| Ícones com `title` e Arquivar discreto | **Resolvido** (`panel.tsx:150`, `.css:71`) |
| "—" no lugar de repetições no PDF | **Resolvido** |
| Fonte do cabeçalho da tabela | **Não resolvido.** O cabeçalho está em sans negrito e o corpo em outra família, visto só na imagem. |
| "Raiz" no PDF | **Parcial.** Aparece como "— / Relação: Raiz". |
| "Projeto: X" repetido em "Resumo · X" | **Pendente** |

## Achados restantes, por prioridade

### 1. P2 (bloqueio de evidência): capturas 1366 px no tema claro estão inconsistentes
Arquivos: `1366-light-overview.png` e `project-1366-light.png`.

**O que se vê:**
- A barra lateral está estreita (~185 px, contra 260 px no escuro) e com a logo cortada ("ROEX", "Pessoas e acess").
- Em `project-1366-light.png`, o conteúdo começa por baixo da borda da barra lateral: "Todos os projetos" e a aba "Demandas" ficam cortados.
- Na estrutura, Editar e Equipes aparecem como botões cinza médio com texto claro, de contraste visivelmente baixo.
- Em `project-390-light.png` e `project-375-dark.png`, "Editar projeto" também tem aparência de desativado.

**Por que destoa do código:**
- `.nodeActions button` usa `background:var(--canvas)`, que vale `#f7f6fa` no tema claro.
- `p-button-subtle` usa `#f3eef7`.
- A 390 px no claro e a 1366 px no escuro, esses mesmos botões saem corretos.

A hipótese mais provável é uma captura feita no meio de uma transição: troca de tema logo antes do disparo, mais `transition:background .15s` e a animação de largura da barra lateral. Mas não confirmei essa causa.

**O que fazer:**
1. Gerar de novo as capturas claras a 1366 px, em visita nova no tema claro, com `prefers-reduced-motion: reduce` emulado ou após aguardar `document.getAnimations()` terminar.
2. Registrar na mesma execução:
   - `document.documentElement.scrollWidth <= innerWidth`;
   - contraste do texto de `.nodeActions button` e de `.p-button-subtle` ≥ 4,5:1.
3. Se o defeito persistir, ele vira um P2 real. Nesse caso:
   - definir `background` e `color` explícitos na base `.p-button` (`globals.css:17`), que hoje não tem nenhum dos dois e depende do `ButtonFace` do navegador;
   - acrescentar `color:var(--ink)` em `.nodeActions button`.

### 2. P3: PDF, primeira linha de "Vínculo institucional" sem rótulo
A unidade superior aparece solta, sem rótulo, e a raiz sai como "— / Relação: Raiz".
- Em `export.ts:19`, trocar a ordem para `keys:['relacao','superior']`. O agrupamento já rotula as linhas seguintes: "Subordinação / Unidade superior: Pró-reitoria de Extensão".
- Para a raiz, a linha fica "Raiz / Unidade superior: —", o que dispensa explicação.

### 3. P3: PDF, família da fonte do cabeçalho da tabela
O cabeçalho usa outra família que não a do corpo.
- Em `report-pdf.ts`, usar a mesma família do corpo no `headStyles`, mantendo o negrito.

### 4. P3: resposta ao Cancelar longe do ponto de edição
"Edição cancelada. Nada foi alterado." fica no rodapé do painel (`1366-dark-tree.png`), longe do nó editado. O foco volta ao botão de origem, então a caixa persistente só ocupa espaço.
- Em `cancelEditor()` (`panel.tsx:59`), manter o texto apenas para leitores de tela: deixar a região de status montada com a classe `srOnly` quando a mensagem for de cancelamento. Uma forma é guardar `{text, quiet:true}` e escolher `styles.srOnly` quando `quiet` for verdadeiro.

### 5. P3: escopo repetido no início
"Projeto: Projeto QA descartável" (Meu trabalho) aparece logo antes de "Resumo · Projeto QA descartável".
- Em `personal-work-summary.tsx:50`, omitir a linha de escopo quando a página já mostrar o mesmo projeto no título seguinte, por exemplo com uma prop `scopeShownNearby`. Outra opção é encurtar para "Neste projeto".

### 6. P3: preâmbulo móvel da estrutura
Na visita nova a 390 px, o 1º nó aparece em y≈670. Já é aceitável, e não peço linhas fixas.
- Para ganhar cerca de 60 px sem esconder conteúdo: em `@container (max-width:599px)`, juntar as três métricas numa só linha horizontal (número e rótulo curto lado a lado).
- O aviso de governança deve continuar inteiro.

### 7. P3: "Atualize a sessão" ao lado do botão "Atualizar" no estado revogado
No estado revogado (`1366-dark-revoked.png`), o botão "Atualizar" do card só recarrega os totais. Isso pode confundir com "Atualize a sessão".
- Quando o erro for 401/403, trocar o texto para: "Seu acesso mudou. Recarregue a página ou entre novamente para consultar este contexto."

### 8. P3: texto provisório no cabeçalho do projeto
"Synthetic header layout only" aparece nas três capturas de projeto.
- Confirmar que é dado sintético do QA e não texto fixo no componente. Se for fixo, removê-lo.

## Para aprovar
- Resolver o item 1: novas capturas claras a 1366 px, mais as medições de rolagem horizontal e de contraste.
- Se as novas capturas saírem coerentes com o código e com as versões a 390 px e no escuro, a estrutura no desktop também chega a 9 e eu aprovaria as cinco áreas.
- Os itens 2 a 8 são refinamentos e não bloqueiam.

Esta avaliação vale só para esses componentes, com dados sintéticos locais. Não é uma afirmação sobre o site inteiro nem sobre produção. Não gravei arquivo de plano nem chamei ExitPlanMode porque esta sessão só tem Read, Glob e Grep.
