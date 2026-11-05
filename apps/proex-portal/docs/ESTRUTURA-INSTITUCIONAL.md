# Estrutura institucional e equipes

A estrutura formal descreve unidades e suas relações. Equipes organizam o trabalho; pessoas e permissões continuam nos mecanismos existentes. Vincular uma equipe a uma unidade não concede acesso a projetos, contas, documentos, planilhas ou chaves de IA. Nenhuma pessoa é cadastrada pelo modelo.

## Fonte e aplicação

Referência pública: [organograma da PROEX UFG](https://files.cercomp.ufg.br/weby/up/694/o/Estrutura_Organizacional_-_2026.pdf), versão 5.0.3 de 28/07/2026, SHA-256 `db862c20ab4b9d5328651e129d4a2ffe5dbfa371715293f1a2fac2293d48dc91`. O PDF de uma página foi conferido visualmente; sua extração textual é insuficiente. O modelo contém 11 unidades. A relação da Câmara de Extensão e Cultura com a PROEX é de governança; as demais relações representadas são de subordinação. TI e Comunicação não são incluídas como coordenações oficiais.

A migração 0029 cria três tabelas vazias. O administrador precisa abrir a prévia, conferir os nomes e aplicar explicitamente o modelo, apenas em uma estrutura ainda vazia. A prévia é editável. A fonte guardada registra a proveniência; não certifica alterações feitas na instituição. Prévia editada e edições posteriores das unidades marcam a estrutura como adaptada. Fonte manual não recebe o endereço do documento oficial automaticamente.

## Autorização e armazenamento

- `institutional_structures`: um cabeçalho por organização, proveniência e versão CAS global.
- `institutional_nodes`: nome, sigla, tipo, superior, relação, ordem e situação. Pai e filho pertencem à mesma organização, inclusive na chave estrangeira composta.
- `institutional_team_links`: vínculos opcionais com equipes existentes, com desvinculação lógica e sem alterações em integrantes ou papéis.

Alterar a estrutura exige vínculo ativo de responsável da organização (`owner`, escopo organização) ou de responsável global. Gerência restrita a projeto, afiliação a equipe e delegação de configuração de IA não bastam. A autorização é refeita no SQL da transação, e o recibo também exige autoridade atual. Não há mutação de `organizational_units` ou dos papéis existentes.

Um membro com acesso a projeto pode consultar a árvore formal da organização desse projeto. Nomes de equipes e vínculos só entram na resposta quando a equipe já está visível ao usuário pelas regras atuais de afiliação/atribuição e escopo. Não se devolvem integrantes, contatos, demandas ou contagens dessas equipes. O histórico de unidades arquivadas exige responsável da organização e consulta explícita.

`GET /api/institutional-structure` recebe `organizationId`, `projectId` opcional e `includeArchived=true|false`. Não grava no banco. Duas projeções consolidadas comparam a árvore, a fonte, a autoridade, os nomes e os vínculos; a segunda consulta é a última operação assíncrona antes da resposta. Mudança de acesso ou recorte durante a leitura descarta o resultado. Respostas são `private, no-store` e `nosniff`.

`POST` usa Origin exata, JSON limitado a 48 KiB e `X-Proex-Action: 1`. Cada operação exige `organizationId`, `expectedVersion` e `operationKey`. Ações: `source.save`, `node.save`, `node.status`, `link.save` e `template.apply`. Campos não previstos são recusados. CAS, chave de idempotência, atualização e auditoria fazem parte do mesmo lote atômico. Um replay revalida a autoridade e não repete a auditoria. O registro de auditoria guarda tipo e versão, sem copiar nomes ou conteúdo dos formulários.

## Integridade e limites

Os gatilhos SQL recusam ciclos, auto-referência, pais de outra organização, pais arquivados e vínculos com unidades/equipes arquivadas. Arquivar uma unidade exige antes arquivar seus filhos ativos e desfazer seus vínculos de equipe. Restaurar um filho exige superior ativo. Uma equipe arquivada pode ser desvinculada pelo administrador; não é necessário reativá-la para limpar o vínculo.

Até 200 unidades por organização, oito níveis, 500 vínculos ativos e 500 equipes visíveis por consulta. O modelo editável tem até 50 unidades. Os limites impedem árvore ou relatório truncados sem aviso. O serviço não possui operação de exclusão definitiva. A migração é aditiva e não semeia dados oficiais nem modifica registros anteriores.

## Exportação

PDF, DOCX e XLSX usam os geradores e a marca existentes. Campos permitidos: nomes/siglas/tipos das unidades, nome do superior, tipo de relação, situação e nomes das equipes autorizadas. Proveniência, recorte, versão e horário acompanham o documento. Não exportar identificadores internos, pessoas, contatos, notas privadas, URLs de equipes ou dados de projetos relacionados.

A exportação consulta novamente o mesmo recorte antes de produzir o artefato e novamente antes de baixar. Conta, organização, projeto, filtro de arquivados e época do componente precisam continuar iguais. Revogação, resposta tardia ou mudança de dados impedem o download. Os arquivos não alegam acesso completo a equipes da instituição quando o usuário só vê seu recorte.

## Validação desta frente

Backend inicial: `0928dbe` e `81ad4c7`. Onze testes novos verificam SQLite real e proteção de rotas; junto dos nove de Equipes e três de migração preservada, 23/23 passaram. Tipos e lint focal passaram. Casos cobertos: duas organizações, três formas de não autorização, fonte editada, nomes longos, ciclos e pais inválidos via SQL direto, arquivamento/restauração, limites, concorrência, replay e revogação durante leitura/escrita. A migração preserva os registros anteriores e passa `foreign_key_check`.

Benchmark sintético local: 100 leituras com 200 unidades, 33 equipes visíveis e 500 vínculos; três consultas por leitura, JSON de 63.504 bytes, mediana 3,57 ms e p95 4,26 ms. Mede SQLite em memória neste computador, sem rede; não certifica desempenho em produção.

UI, arquivos reais, revisão independente e publicação recebem os resultados comprovados após seus próprios gates. Este documento não é recibo de deploy. Não foram alterados Google, Drive, permissões reais ou chaves. Snapshots e journal 0029 são responsabilidade da composição do coordenador, sem regeneração isolada nesta frente.
