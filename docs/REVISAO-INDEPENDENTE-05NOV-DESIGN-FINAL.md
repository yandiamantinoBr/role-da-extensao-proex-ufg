# Revisão independente de acompanhamento: P2 de evidência no desktop claro (05/11)

## Veredito: **aprovado no escopo**
O P2 de evidência foi resolvido e não há outro P2. Dou **9** para a estrutura no desktop claro.

## Escopo
- Considerei apenas o P2 de evidência deixado aberto em `design-acceptance-result.json`: as capturas claras a 1366 px e a aparência de "desativado" dos botões.
- O código continua o mesmo, como você informou. Não reavaliei o resumo pessoal, a estrutura móvel, os PDFs nem o desktop escuro. As notas 9 anteriores ficam mantidas, com os mesmos limites.

## O que examinei
- **Capturas abertas:**
  - `structure-integrated/1366-light-overview.png`
  - `structure-integrated/project-1366-light.png`
  - `structure-integrated/project-390-light.png`
  - `structure-integrated/project-375-dark.png`
- **Medições:**
  - `stable-contrast-result.json`
  - `structure-integrated/compact-and-project-result.json`. O arquivo está nessa subpasta, não na raiz de `.sites-runtime`.
- **Scripts de captura e medição:**
  - `stable-contrast.mjs`, lido inteiro.
  - `structure-browser-qa.mjs` e `compact-and-project-qa.mjs`, só por busca dos pontos de espera e de captura.
- **Parecer anterior:** `design-acceptance-result.json`.

## O defeito anterior sumiu das imagens
**`1366-light-overview.png`**
- A barra lateral tem a largura cheia (~260 px), igual à do tema escuro. A logo PROEX/UFG aparece inteira, e "Pessoas e acessos" e "Recolher menu" estão sem corte.
- Editar e Equipes têm fundo claro (`--canvas`) com texto escuro e legível.
- Arquivar continua tracejado e mais discreto, como deve ser.
- O selo "Governança", a legenda e os ramos recolhidos ("2 unidades subordinadas") estão coerentes com a versão escura.

**`project-1366-light.png`**
- O conteúdo começa depois da barra lateral. "Todos os projetos" e as abas Demandas, Equipe e convites, Agenda e Planilhas estão inteiros.
- "Editar projeto" tem texto escuro sobre lilás claro e não parece mais desativado.

**`project-390-light.png` e `project-375-dark.png`**
- "Editar projeto" está claramente ativo nos dois temas.
- O título quebra em 3 linhas sem estourar a largura.
- O botão fica abaixo do título, o que confere com `editTop 277 ≥ titleBottom 224`.

## A metodologia se sustenta
- Os três scripts emulam movimento reduzido (`reducedMotion:'reduce'`) e, antes de cada captura, esperam `document.fonts.ready` e o fim de todas as animações finitas de `getAnimations()`. Isso responde à causa que eu supunha antes, uma captura feita no meio da transição.
- **Contraste:** `stable-contrast.mjs` lê a cor calculada do texto e compõe o fundo efetivo pela cadeia de elementos pais, incluindo transparência. Os testes falham abaixo de 4,5:1 e também quando há rolagem horizontal. Os resultados:

| Tema | Rolagem horizontal | Editar e Equipes | Arquivar | `.p-button-subtle` |
|---|---|---|---|---|
| Claro | 1366 = 1366 | 14,12 (`rgb(41,35,51)` sobre `#f7f6fa`) | 5,01 | 12,83 |
| Escuro | 1366 = 1366 | 15,85 | 7,46 | 9,48 |

- Todos os botões têm opacidade 1.
- `compact-and-project-result.json` registra que a largura do documento é igual à da janela em 375, 390 e 1366 px, sem erros.
- Concluo que a suspeita de dependência do `ButtonFace` do navegador não se confirma no estado estável. O que eu tinha visto era a transição em curso, não um defeito do produto.

## Limites que continuam
- A medição de contraste cobre só os botões do organograma e os `.p-button-subtle` da tela de equipes. "Editar projeto", na tela do projeto, foi avaliado apenas pelas imagens, que parecem corretas.
- O método não considera fundos em gradiente ou imagem, nem a opacidade dos elementos pais. Isso não afeta estes botões.
- As capturas mostram o estado estável. Não avaliei como fica a tela durante a troca de tema (cerca de 150 ms).
- Se a barra lateral também animar a largura no primeiro carregamento, e não só ao recolher, um usuário veria por um instante o estado estreito. Seria P3. Não confirmei porque não reli o código.
- O texto em inglês "Synthetic header layout only" é dado de teste, como você informou. Por isso o item 8 do parecer anterior fica encerrado.
- Não verifiquei teclado nem leitor de tela em execução, aparelho físico ou produção.

## Achados restantes (P3, não bloqueiam)
1. **Ícone solto no cabeçalho do projeto** (`project-1366-light.png`, y≈507): o ícone de escudo fica numa linha própria, acima de "A relação entre programa e projeto…". Sugiro pô-lo na mesma linha do texto (`display:flex; align-items:flex-start; gap`), igual ao aviso de governança da estrutura.
2. **Sem medição da tela do projeto:** vale incluir `.p-button` da tela do projeto ("Editar projeto", "Relatórios do projeto", "Atualizar") no alvo de `stable-contrast.mjs`, para o contraste ficar medido também ali.
3. **Base `.p-button`:** se a base continuar sem `background` e `color` próprios (`globals.css:17`), defini-los é uma proteção barata contra o estilo padrão do navegador. Não é defeito observado.
4. Os itens 2 a 7 do parecer anterior continuam abertos, todos P3: rótulo do vínculo no PDF, fonte do cabeçalho da tabela, aviso de "Edição cancelada", escopo repetido, preâmbulo móvel e o texto do estado revogado.

## Notas finais

| Área | Nota |
|---|---|
| Estrutura no desktop claro | **9** (antes não era avaliável) |
| Estrutura no desktop escuro | 9 (mantida) |
| Estrutura móvel | 9 (mantida) |
| Resumo pessoal | 9 (mantida) |
| PDF compacto e PDF multipágina | 9 (mantidas) |

Não há P0, P1 nem P2 em aberto. A aprovação vale apenas para estes componentes, com dados sintéticos locais (loopback). Não certifica o site inteiro nem a produção.

Não gravei arquivo de plano nem chamei ExitPlanMode porque esta sessão só tem as ferramentas Read, Glob e Grep.
