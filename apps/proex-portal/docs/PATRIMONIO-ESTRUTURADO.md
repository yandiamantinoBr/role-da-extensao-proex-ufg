# Cadastro patrimonial estruturado

Implementação local R07, conferida em 31/10/2026. O portal registra a referência operacional de bens do projeto; procedimentos institucionais de incorporação, guarda, movimentação e transferência continuam nos sistemas e fluxos oficiais. Nenhuma alteração de metadados substitui autorização, assinatura ou registro no SIPAC/SEI.

## Fontes oficiais consultadas

- [DLOG/UFG — SIPAC Patrimônio](https://dlog.ufg.br/p/36979-sipac-patrimonio), consultada em 31/10/2026: recebimento, transferência, recolhimento e levantamento; conferir a localidade antes de transferir.
- [DLOG/UFG — Recebimento de doações](https://dlog.ufg.br/p/40305-recebimento-de-doacoes), consultada em 31/10/2026: a orientação inclui termo, nota fiscal ou declaração de propriedade, fotos e indicação da lotação em processo específico.
- [Manual de patrimônio móvel publicado pela UFG](https://files.cercomp.ufg.br/weby/up/452/o/SIPAC_Patrimonio_DMP.pdf), consultado em 31/10/2026 como referência de campos de identificação e responsabilidade. É documento histórico; o roteiro atual é o da DLOG acima.

Não se coletou inventário real, nome de responsável, documento fiscal, foto ou termo privado. Testes e navegação usam exclusivamente dados sintéticos.

## Modelo e preservação

A migração aditiva `0010_structured_asset_metadata.sql` acrescenta 16 campos opcionais a `items`. Linhas antigas recebem `NULL`: não se estimam dados, preços ou datas. `asset_code` continua sendo texto, com a unicidade por projeto existente, e preserva `00001234`. Descrição e nome existentes são mantidos.

O contrato reutilizável está em `lib/asset-metadata.ts`. Os nomes da API e seus equivalentes SQL são:

| API | SQL | Conteúdo conferido |
| --- | --- | --- |
| brand / model / serialNumber | brand / model / serial_number | Marca, modelo e série textual |
| assetLocation | asset_location | Localização descrita na fonte |
| responsibleUnit / responsibleReference | responsible_unit / responsible_reference | Unidade e referência documental do responsável; sem conceder qualquer acesso |
| conservationState / assetStatus | conservation_state / asset_status | Conservação observada e situação patrimonial informada |
| origin / destination | origin / destination | Origem e destino informados, sem declarar transferência autorizada |
| processReference / responsibilityTerm / invoiceReference | process_reference / responsibility_term / invoice_reference | Referências dos documentos, sem conteúdo sensível desnecessário |
| sourceReference | source_reference | Documento, página ou outra proveniência conferida |
| acquisitionDate | acquisition_date | Data documentada, ou ausente |
| acquisitionValueCents | acquisition_value_cents | Centavos inteiros documentados, inclusive zero explícito, ou ausente |

Valores exigem ao menos uma referência de fonte, nota fiscal, processo ou termo. Essa exigência também é um gatilho SQLite, para proteger importações portáteis. O formulário converte decimal para centavos exatos e recusa separadores ambíguos. `NULL` não vira zero em prévia ou relatório.

`condition` continua sendo a condição operacional que controla disponibilidade (`active`, `maintenance`, `inactive`). `assetStatus` é apenas informativo. Nenhum dos novos campos altera saldo, reserva, empréstimo, papel, projeto ou organização. Novo equipamento cadastrado nasce com saldo zero. Entradas físicas continuam sendo movimentos explícitos do livro de estoque.

`item.create`, `item.update` e `item.restore` usam validação comum; edições exigem versão atual. Cada alteração gera revisão de metadados, e a restauração não recua saldos ou movimentos. Revisões antigas sem os campos novos preservam os valores atuais desses campos, em vez de inventar um estado histórico.

## Interface e montagem

`components/portal/asset-details-panel.tsx` exporta `AssetDetailsPanel({ itemId, projectId, onSaved })`:

- `itemId: string | null`: um bem existente, ou `null` para cadastro manual de equipamento individual.
- `projectId: string`: projeto explícito. A resposta carregada precisa corresponder a ele.
- `onSaved?: (itemId: string) => void | Promise<void>`: atualizar a lista/painel do coordenador após gravação.

O coordenador monta o componente na área de materiais autorizada. Este incremento não edita `portal-client.tsx` nem `material-detail-drawer.tsx`. O formulário prepara uma prévia local, move o foco para a revisão e só confirma por ação explícita. Fonte ausente é mostrada como “Não informado”.

O detalhe reutiliza `records` e `record_attachments`, preservando arquivos anteriores e seus controles. Fotos JPEG/PNG/WebP e PDFs de até 4 MiB são enviados apenas após confirmação. Registro e upload têm chaves estáveis para retomar falhas sem duplicação. URLs são privadas, com autorização na leitura; chaves de armazenamento não entram no payload. O resumo de empréstimos usa somente situação e datas, sem identidade/contato de quem retirou. Listas exibem no máximo 100 anexos, 100 empréstimos e 100 registros, com aviso de truncamento; movimentos mantêm a paginação existente.

## Acesso, relatórios e Sheets

O detalhe exige `inventory.read`, e a edição exige `inventory.manage` no projeto. A autoridade é conferida novamente em SQL; revogação durante leitura suprime o payload. Criar, editar ou restaurar precisa preservar também os predicados de organização da migração 0008 na integração do coordenador.

Os relatórios padrão não recebem os novos campos. A opção explícita “Consultar metadados patrimoniais privados” envia `assetDetails=1`; o servidor limita linhas a projetos com permissão vigente de inventário. As colunas privadas aparecem para escolha, sem serem selecionadas por padrão. O mesmo recorte da central alimenta os formatos existentes, incluindo PDF/DOCX no incremento do coordenador. A nota de privacidade passa a indicar que o arquivo pode conter referências patrimoniais privadas. Valor ausente permanece vazio; a coluna de valor é rotulada em centavos, sem soma financeira presumida.

A projeção portátil de `items` inclui somente os campos explicitamente listados; os novos metadados são marcados `private: true`, e a planilha global continua exclusiva da administração geral. Sincronização de metadados exige versão e recibo; não muda saldo por célula nem concede papel. Públicos de campanha/jogo, o snapshot amplo do portal e MCP limitado não recebem os novos campos. IA não recebe uma nova ação que altere cadastro, tombamento, identificador, projeto, organização ou permissão; propostas continuam passando pelos fluxos explícitos de revisão já existentes.

O importador documental deve mapear somente campos efetivamente lidos para esse contrato, preservando a proveniência em registros. Bem existente apenas é vinculado à conferência; nunca se sobrescreve o cadastro ou se cria entrada de estoque automaticamente. Esse mapeamento é coordenado separadamente no incremento de importação para evitar editar o mesmo serviço em paralelo.

## Validação local

`tests/asset-metadata.test.mjs` executa as migrações e SQL reais com fixtures em memória: legado, zeros, ausência/zero documentado, datas/valores inválidos, versões, restauração, A/B, revogação durante leitura e gravação, PDFs privados, relatórios opt-in, Sheets/CAS e negação de MCP limitado/públicos. A suíte relacionada de materiais, registros, sincronização, relatórios e importação portátil também é executada.

QA visual isolado, sem provedores e sem arquivos de ambiente: Chrome em 375×812, 414×896 e 1250×900. Não houve rolagem horizontal do documento. Campos móveis mediram 300 px de largura e 48 px de altura em 375 px; em 1250 px, painel de 926 px com duas colunas de 430 px e controles de 44 px. Seleção/revisão não gravou; confirmação fez uma única gravação no servidor de fixture. Valor sem fonte foi recusado; prévia preservou tombamento `00004567`, ausências e valor monetário. Esses números comprovam a interface isolada, não o deploy ou o desempenho de produção.

Integração/publicação e mapeamento final do importador ficam a cargo do coordenador. Aplicar 0010 depois de 0008/0009, com backup/restauração já comprovados; preservar os guards organizacionais e reconciliar metadados Drizzle na branch integrada. Nenhuma dependência ou serviço de provedor foi acrescentado.
