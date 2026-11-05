# Revisão independente: Estrutura institucional, Meu trabalho e PDFs (05/11)

**Veredito: não aprovo.** O código melhorou bastante, mas nenhuma área chega a 9/10. Resta um P2 no PDF de várias páginas, o mesmo ponto já cobrado antes.

## O que examinei
- **Capturas abertas com Read (14):**
  - `structure-integrated/`: as 9 pedidas (estrutura e PDFs).
  - `personal-summary-qa/`: as 5 pedidas (resumo pessoal).
- **Código lido inteiro:**
  - `institutional-structure-panel.tsx` e o módulo CSS
  - `personal-work-summary.tsx` e o módulo CSS
  - `institutional-structure-export.ts`
- **Não li:** `report-pdf.ts`. O que digo sobre fontes do PDF vem só da imagem.
- **Não verifiquei:** foco por teclado em execução, leitor de tela, aparelho físico, produção. Não usei testes como prova.

## Notas
| Área | Nota | Motivo |
|---|---|---|
| Resumo pessoal | **8,5** | Hierarquia e tons claros nos dois temas; o 2×2 no móvel funciona. Ajuda reescrita, link duplicado removido, `aria-describedby` incluído. No estado revogado, os cards continuam clicáveis e a mensagem se contradiz. |
| Estrutura desktop | **8,5** | Um único aviso de escopo, com governança formal clara. Métrica renomeada, ramos recolhíveis, editor com nome da unidade e Cancelar. O editor ainda abre longe do card e há 3 botões com texto por nó. |
| Estrutura móvel | **8** | Cards caíram de ~200 para ~115 px, botões só com ícone de 44 px, níveis ≥2 recolhidos. Mas o 1º nó só aparece depois de ~700 px de preâmbulo, e o título do editor quebra em 5 linhas. |
| PDF compacto | **8,5** | Cabe em 1 página, a numeração 1.1.1 mostra a hierarquia e o bloco "Sobre o recorte" tem 5 linhas. A coluna "Unidade formal" ainda quebra em 3 linhas. |
| PDF multipágina | **7** | A pág. 2 tem 9 linhas, e uma ocupa 11 linhas de altura (sigla "QA LOCAL"). Tipo, Relação e Situação sobram espaço. "Nenhuma neste recorte" se repete 11 vezes. |

## P2 e P3 da crítica anterior
- **P2-1, aviso repetido: resolvido.**
  - Sobrou só um aviso (`panel.tsx:96`), com `max-width:75ch`.
  - A árvore agora começa em y≈612 (antes ≈660).
- **P2-2, árvore móvel: resolvido.** As quatro mudanças sugeridas foram feitas:
  - (a) selo só para Governança e Arquivada (`:128`);
  - (b) contagem de equipes omitida quando é 0;
  - (c) botões só com ícone abaixo de 600 px (`.css:106`);
  - (d) `<details open={depth<2}>` com o resumo "N subordinadas" (`:134`).
- **P2-3, PDF: parcialmente resolvido.**
  - Feito: bloco "Sobre o recorte" com 5 linhas, hierarquia numerada, 1 página no recorte pequeno.
  - Falta: os pesos das colunas continuam quase uniformes (`export.ts:19`, `[2.3,1.7,1.76,1.75,1.7,1.3]`).
- **P3 anteriores:**
  - Resolvidos: link duplicado, jargão, descrição para leitor de tela, métrica "Relações de governança", título e Cancelar do editor.
  - Pendentes: "Raiz" repetindo "Sem unidade superior" no PDF e a redundância "Projeto: X" / "Resumo · X".

## Pendências por prioridade
1. **P2, PDF: pesos das colunas e número separado do nome** (`export.ts:14,19`).
   - Trocar `columnWeights` por `[3.4,1.3,1.45,2.1,1.75,0.95]`.
   - Unir o número ao nome com espaço inquebrável: `` `${path}\u00A0${…}` ``.
   - Meta: nenhuma linha passar de 4 linhas no exemplo de 12 unidades.
2. **P3, PDF: repetição.**
   - Usar `'—'` no lugar de "Nenhuma neste recorte" e "Sem unidade superior".
   - Acrescentar em "Leitura": "— indica ausência no recorte."
   - Unificar a fonte do cabeçalho da tabela com a do corpo em `report-pdf.ts` (visto só na imagem).
3. **P3, Resumo pessoal no estado revogado** (`personal-work-summary.tsx:54-55`).
   - Com `current?.error`, renderizar os cards como `<div aria-disabled="true">` sem seta, em vez de `<a>`.
   - Hoje a mensagem diz ao mesmo tempo "Atualize a sessão" (vinda do servidor) e "use Atualizar" (sufixo do componente). Não acrescentar o sufixo quando o erro for 401/403.
4. **P3, preâmbulo da estrutura no móvel** (`panel.tsx:101-102`). Em `@container (max-width:599px)`:
   - mostrar as métricas numa linha só ("12 unidades · 1 governança · 1 equipe");
   - pôr a referência num `<details>` com o resumo "Fonte: {label}".
   - Isso economiza cerca de 250 px antes da árvore.
5. **P3, editor longe do card** (`panel.tsx:106,131`).
   - Quando `editor.node` existir, renderizar a `<section>` do editor dentro do `<li>` da unidade, logo após o `<article>`. "Nova unidade" e "Editar fonte" ficam no topo.
   - Adicionar `onKeyDown` com Escape chamando `cancelEditor()`.
6. **P3, título longo no editor** (`.css:80`).
   - Em `.editorTitle>span`, aplicar `-webkit-line-clamp:2` com `display:-webkit-box`, `-webkit-box-orient:vertical` e `overflow:hidden`.
   - Pôr o nome completo no atributo `title`. Hoje o título ocupa 5 linhas a 390 px.
7. **P3, mensagens de status inseridas já com conteúdo** (`panel.tsx:97,116`).
   - Hoje `role="status"` só é montado junto com o texto, e alguns leitores de tela podem não anunciá-lo.
   - Deixar o elemento sempre montado: `<p role="status" className={feedback?styles.feedback:styles.srOnly}>{feedback}</p>`. Fazer o mesmo com o "Consultando…".
8. **P3, ícones sem texto no móvel** (`panel.tsx:130`).
   - O ícone de corrente para "Equipes" é ambíguo sem rótulo.
   - Adicionar `title={name}`. Diferenciar visualmente "Arquivar", com um estilo mais discreto ou borda de alerta, para não ter o mesmo peso de Editar.

## Para aprovar
- Corrigir o item 1 e gerar novas capturas do PDF.
- Fazer os itens 3, 4 e 5, que levam resumo pessoal e estrutura móvel/desktop a ≥9.
- Os demais são refinamentos.

Não gravei o arquivo de plano nem chamei ExitPlanMode porque esta sessão só tem Read, Glob e Grep; o relatório fica só nesta resposta.
