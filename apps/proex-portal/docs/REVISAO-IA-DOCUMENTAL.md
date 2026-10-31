# Revisão independente da IA documental — 2026-10-31

Escopo: backend de R10 `4d26fcf` / integração `d7ffcd4`, modelo e cadeia de migrações `0dfa34e`, montagem de organização `8487055`. A revisão partiu de `84c9c02` em worktree isolada. Não alterou backend, metadados, provedores, configuração ou dados reais; não iniciou servidor nem usou a porta 5173. Todos os documentos, contas, chaves e transportes dos testes são sintéticos.

Resultado: revisão aprovada nos trechos examinados após os fixes do autor `d3c4ad4`, `cd4be2e` e `ba11de1`. Os quinze testes independentes passaram, junto de 45 testes documentais/assistente/STT e dois de modelo/migrações: **62/62**. Não foi identificado outro P0/P1 nesse escopo. Isso não substitui os gates de integração e interface do coordenador.

## Achados e comprovação

| Achado | Prova antes da correção | Estado |
| --- | --- | --- |
| P1: revogação/reconfiguração durante o reload de credenciais permitia um POST documental | Após a segunda leitura de settings e antes de concluir AES-GCM, revogar o vínculo ou mudar a revisão ainda produzia uma chamada. A resposta posterior era bloqueada, mas o texto já havia saído. | Corrigido em `d3c4ad4`; os dois testes independentes passaram. |
| P2: corpo Jev podia superar a reserva preventiva antes da segunda chamada | Campos válidos com a mesma citação literal Unicode produziram 34.976 bytes UTF-8 para um teto reservado de 24.078. O servidor só conferia uso após o transporte. | Corrigido em `d3c4ad4`; a medição do corpo real impede o segundo POST e preserva a reserva conservadora. |
| P1: os caminhos operacionais e STT existentes tinham a mesma janela de reload | Revogação durante a segunda leitura de settings ainda permitia um POST de geração ou upload WAV. | Corrigido em `cd4be2e` e `ba11de1`; ambos os testes independentes passaram. |
| P1: replay STT e apply/replay de consulta podiam devolver conteúdo após revogação | Revogar durante a decifração de uma transcrição já pronta ainda devolvia texto; revogar antes do batch de `stock.query` marcava applied; revogar no reload de um replay applied ainda devolvia o item. | Corrigido em `ba11de1`; os três testes independentes passaram, sem applied/auditoria indevidos na consulta revogada. |
| P2: replay de preparo podia devolver proposta após alteração de configuração durante assinatura | Revisão alterada durante HMAC não era conferida novamente após a assinatura; a ACL já era conferida pelo fluxo externo. | Corrigido em `ba11de1`; o teste independente passou sem nova chamada. |

O arquivo `tests/document-ai-independent.test.mjs` mantém as reproduções e os cenários positivos. As provas de espera interceptam somente o retorno de uma consulta ou de uma operação criptográfica real, sem substituir criptografia, autorização ou serviços de domínio. Esses pontos reproduzem a mudança de estado durante um `await`.

## Controles conferidos

- Consentimento explícito, fonte com até 16 KiB UTF-8 e orçamento compartilhado são verificados antes da admissão. Uma configuração com Jev e apenas uma chamada disponível não despacha DeepSeek.
- Concessão TI permite configurar IA; não concede leitura ou importação em projeto. Organização A não acessa projeto de B.
- O guard documental é acrescentado ao batch de domínio. Não substitui CAS, recibos de idempotência, validação de estoque ou autorização existente. Edição concorrente preserva o valor atual e não cria recibo nem mutation key órfãos.
- Organização arquivada dentro do batch impede criar o projeto e seu recibo.
- Cifra AES-GCM de sugestões usa AAD de organização e chamada. Trocar ciphertext entre chamadas impede recuperação, sem novo transporte.
- A evidência deve ser literal, mas não comprova verdade. Confiança por campo permanece `null`; a prévia avisa sobre revisão humana. O teste verifica omissão dos exemplos sintéticos de e-mail/CPF no corpo enviado.
- `portalSnapshot` e todas as projeções portáteis usadas por Sheets/Drive não contêm chave, ciphertext nem a citação documental sintética. A tabela privada não integra a allowlist; o MCP usa o mesmo serviço de leitura portátil.
- `tests/drizzle-model-migrations.test.mjs`: dois testes passaram, conferindo colunas/FKs e cadeia de journal/snapshots sem divergência de modelo. Nenhum metadado foi reescrito pela revisão.

## Retenção e alcance

Não há campo dedicado ao texto integral de entrada; sugestões e citações cifradas podem reproduzir partes da fonte, inclusive uma fonte curta. Os quinze minutos são o prazo lógico da prévia no banco ativo. A limpeza de ciphertext depende de outro uso autorizado da organização; não há cron nem garantia de apagamento físico no minuto.

Snapshots históricos e backups podem conservar essa cifra por mais tempo. A limpeza do banco ativo não apaga essas cópias. Política institucional de retenção, custódia e descarte de backups continua pendente; não se promete remoção de todas as cópias em quinze minutos.

Resultados locais não comprovam conexão real, custo efetivo do provedor, acurácia, OCR ou publicação. A montagem visual, a validação no navegador e a decisão de publicar pertencem ao coordenador.

Comando reproduzível na aplicação: `node --test tests/document-ai-independent.test.mjs tests/document-ai.test.mjs tests/assistant.test.mjs tests/drizzle-model-migrations.test.mjs`. ESLint do teste independente passou sem avisos. O commit desta revisão contém somente o teste independente e este relatório; as correções de backend permanecem com a autoria e os hashes acima.
