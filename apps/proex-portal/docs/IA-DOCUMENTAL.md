# Interpretação documental opcional — R10 / 0016

Desenho autorizado pelo coordenador em 2026-10-31. R06 continua como fluxo único: extração de fonte/arquivo → parser e validadores → prévia assinada → seleção/edição humana → serviços normais de cadastro → recibo/anexos. A estratégia opcional de IA complementa esse fluxo; não cria outro importador nem acessa SIGAA/SIPAC com login.

## Contrato de produto

A configuração organizacional existente recebe `documentEnabled=false` por padrão no JSON. Configurações antigas continuam desativadas para documentos sem migração de valores. DeepSeek deve estar habilitado e com credencial já configurada; as mesmas permissões de administração/TI e limites são usados. `configurationActor` não muda. O status acrescenta `documentAvailable`.

Cada pedido exige `useAi=true`, `aiConsent=true` e uma chave `aiOperationKey`. O opt-in informa a organização, texto extraído enviado ao provedor salvo, limite de16KiB UTF-8 e um cadastro por prévia. O fluxo determinístico mantém seus limites existentes de20 registros/256KiB; exceder o limite de IA exige um trecho menor e nunca trunca silenciosamente. Arquivos PDF/DOCX continuam no extrator existente; não são enviados como binário ao modelo. Não há OCR ou chamada paga/real durante o desenvolvimento.

IA devolve apenas campos do contrato `importFields(kind)` com valor bruto e trecho literal. O servidor normaliza o texto para NFC, remove HTML oculto/scripts/atributos, recusa aparentes credenciais e omite contatos/CPF antes do envio. Isso não equivale a anonimização completa: pessoas devem conferir a fonte antes de autorizar. O valor deve existir literalmente no trecho e o trecho no texto enviado. Datas/catálogos/centavos passam por `validateImportedFields`; não há conversão de moeda, criação de vigência a partir de ano, saldo, conta, papel ou identificador inventado.

A prévia mostra por campo método, evidência e estado: literal, missing, conflict ou review. `confidence` é sempre null; não existe percentagem de acurácia calibrada no corpus PROEX. Jev opcional usa sua decisão real para interromper ambiguidade, sem transformar sua confiança em evidência estatística por campo. Ausências ficam vazias. Conflito com a regra preserva o valor anterior e exige revisão; a interface não o seleciona automaticamente. Edições manuais continuam identificadas no recibo.

## Segurança e persistência

`lib/assistant/admission.ts` extrai a reserva já existente do assistente operacional sem mudar suas regras. Operações e documentos usam a mesma `ai_organization_usage`: custo, tokens, tempo e número de chamadas. A admissão é atômica e pertence ao nonce único da tentativa; replays e tentativas simultâneas não podem reutilizar uma reserva alheia ou pagar duas vezes. Falha/timeout mantém a reserva conservadora e não repete transporte automaticamente. O adaptador HTTP, modelos e allowlist existentes são reutilizados, sem endpoints novos ou chaves em outro lugar.

A migração aditiva `0016_document_ai.sql` cria `ai_document_calls`. Ela aceita project_id nulo exclusivamente para criação de projeto autorizada na organização; não há projeto fictício. FKs, checks, índice organizacional e triggers protegem identidade/contexto. O modelo é `db/assistant-document-schema.ts`, importando base-schema sem ciclo. Root integra reexport/journal/snapshot após0015; este agente não os reescreve.

A tabela mantém hashes, escopo, revisão, nonce e estado. Somente sugestões/trechos retornados são cifrados por AES-GCM com AAD de organização+chamada reutilizando a primitiva existente; texto integral do documento não é persistido. Cifra expira logicamente com a prévia em15min e é apagada oportunisticamente no próximo uso autorizado da organização. Não há cron de purga nem promessa de remoção física exata no minuto. Backup completo segue a política de cópia cifrada já estabelecida. A tabela privada não faz parte de Sheets/MCP/snapshot público.

Auditoria de IA contém apenas modelo, hash, tipo e revisão. Recibo normal registra modelo/hash/método dos campos selecionados, sem evidência literal, token da prévia ou texto bruto. Valores operacionais escolhidos seguem os registros de domínio existentes. Arquivo fonte só é anexado pela opção privada já existente; o DOCX original não vira anexo automaticamente.

ACL/configuração são reconferidas antes da reserva, imediatamente antes de cada transporte, após esperas, na persistência final e dentro de cada batch de apply. O proxy do importador acrescenta o fence de IA aos serviços normais sem remover seus guards/CAS/idempotência. Replay também revalida. Novo projeto continua exigindo administração da organização; bens exigem inventory.manage no projeto. Grant TI configura o provedor, sem ampliar o acesso aos dados ou cadastros.

A prévia IA usa HMAC v3, ligada a ator, organização, projeto/bem, revisão da configuração, fonte e prazo original. Prévia determinística v2 permanece compatível. Apply exige confirmação e seleção de campos; configuração alterada/desabilitada ou vínculo revogado invalida a operação. Equipamento novo nasce com saldo zero; bem existente recebe somente conferência/anexos, sem sobrescrever o cadastro.

## Limites e continuidade

Não houve publicação, leitura de segredo nem chamada real aos provedores. Testes usam SQLite/migrações reais, HTTP injetado e documentos/contas sintéticos. A revisão independente, integração de metadados, builds e CUA finais serão registrados no handoff. O coordenador mantém montagem, backup real, publicação e Vault.
