# Revisão independente do refinamento de apresentação

Fiz uma revisão delta, somente leitura. Usei apenas as ferramentas Read/Grep, sem shell, rede ou escrita, e não rodei nenhum teste. Não há P0, P1 nem P2. Encontrei três P3.

## O que confirmei

**Hosts no PDF (`campaign-planning-export.ts:11`)**
- O documento recebe apenas `host.projectName`, limpo com `clean`. `projectId`, `linkedAt`, `canManage`, `projectStatus`, `viewerId` e `campaignId` não chegam a `info`, `rows` nem `presentation`.
- A origem já vem filtrada no SQL (`service.ts:42-44`, CTE `visible_hosts` com `authority(...)` sobre o host). Por isso, um host oculto não entra no DTO com id, nome ou contagem.
- O texto padrão "Nenhum anfitrião visível neste recorte" não diz se existem hosts ocultos nem quantos.
- **Por que é seguro:** o PDF só mostra um subconjunto do que a API autorizada já devolve ao mesmo usuário na tela. Não cria um canal novo.

**Cerca de exportação (`campaign-planning-panel.tsx:226-233`)**
- A ordem é: leitura, depois `fingerprint` e `report` da mesma resposta, imports, geração, nova leitura e comparação. Logo depois vem `download` síncrono, sem `await` após a cerca.
- `planningFingerprint` serializa todo o workspace menos `asOf`, incluindo `hosts`, `viewerId` e `canManage`. O teste da linha 16 cobre `hosts:[]` e `canManage:false`.
- No servidor, `planningWorkspace` também lê duas vezes e devolve 403 se a visibilidade dos hosts mudar.
- **Resultado:** se um host for revogado no meio da exportação, o nome dele não sai em arquivo baixado.

**Apresentação do PDF (`report-pdf.ts:101-102, 159, 177`)**
- Os quatro campos novos são opcionais e, quando ausentes, voltam aos valores anteriores (`projectName || title`, `'Registros do relatório'`, o ternário de rótulo antigo e `title`). Quem chama sem esses campos não muda de comportamento.
- O conteúdo continua passando por `text()`, que remove caracteres de controle e de direção de texto.

**Histórico de transferência (`follow-up-panel.tsx:284`)**
- Os nomes saem só de `catalog.projects.find(...)`. Sem correspondência, aparece o texto genérico de origem/destino restrito. O DTO não ganhou campos novos.
- O snapshot (`transfer.ts:136-137`) guarda apenas `transferId`, `from/toProjectId`, `fromVersion` e `reason`. Não há nomes de pessoas ou responsáveis.
- Não achei, nas linhas de `transfer.ts` que olhei, nenhuma escrita que apague `followup_assignees`. Isso é coerente com a frase "Responsáveis e registros anteriores mantidos" como garantia de que os registros são preservados.

## P3

1. **`headingLabel` e `subtitle` não passam por `trim()`** (`report-pdf.ts:159, 177`), ao contrário de `mainTitle` e `recordsLabel`. Um valor só com espaços sairia em branco em vez de usar o padrão. Hoje não acontece: `headingLabel` é constante e `subtitle` sempre começa com "Responsável: ". Só deixa a API inconsistente.
2. **A frase "Responsáveis e registros anteriores mantidos" pode ser lida como "todos continuam vendo".** Quem não tem acesso ao destino mantém a atribuição, mas perde a visibilidade, como o próprio painel avisa (`followup-transfer-panel.tsx:123-125`). Sugestão de texto, sem urgência: "Atribuições e registros preservados; a visibilidade segue o acesso atual ao destino."
3. **Snapshots antigos sem `fromProjectId`/`toProjectId`** caem no texto "nome sujeito ao seu acesso atual", o que sugere uma restrição que pode não existir. É seguro, só um pouco impreciso.

## Limites desta leitura

- Não li `isWorkspace` por inteiro. Se `projectName` não for string, `clean` lança erro e a exportação falha sem vazar nada.
- Não confirmei de onde vem `catalog.projects`. Aceitei a premissa de que é o catálogo autorizado atual. Se ele listar projetos da organização sem ACL de leitura, o histórico mostraria nomes que esse usuário já veria nesse catálogo, sem exposição nova.
- Não revisei `document-export`/DOCX/planilha além do que `report-pdf` recebe, nem `authority()` e `scope.ts`, que você disse já estarem revisados.
- Não li os outros arquivos `tests/campaign-planning*` além das linhas de `campaign-planning-export.test.mjs` encontradas com Grep.
- Não avaliei a estética.

Coordenação: osP3de trim e da frase de atribuições foram corrigidos antes dos gates finais.
