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

A tabela mantém hashes, escopo, revisão, nonce e estado. Somente sugestões/trechos retornados são cifrados por AES-GCM com AAD de organização+chamada reutilizando a primitiva existente; não se cria armazenamento separado do documento integral; as sugestões podem incluir trechos literais da fonte. Cifra expira logicamente com a prévia em15min e é apagada oportunisticamente no próximo uso autorizado da organização. Não há cron de purga nem promessa de remoção física exata no minuto. Backup completo segue a política de cópia cifrada já estabelecida. A tabela privada não faz parte de Sheets/MCP/snapshot público.

Auditoria de IA contém apenas modelo, hash, tipo e revisão. Recibo normal registra modelo/hash/método dos campos selecionados, sem evidência literal, token da prévia ou texto bruto. Valores operacionais escolhidos seguem os registros de domínio existentes. Arquivo fonte só é anexado pela opção privada já existente; o DOCX original não vira anexo automaticamente.

ACL/configuração são reconferidas antes da reserva, imediatamente antes de cada transporte, após esperas, na persistência final e dentro de cada batch de apply. O proxy do importador acrescenta o fence de IA aos serviços normais sem remover seus guards/CAS/idempotência. Replay também revalida. Novo projeto continua exigindo administração da organização; bens exigem inventory.manage no projeto. Grant TI configura o provedor, sem ampliar o acesso aos dados ou cadastros.

A prévia IA usa HMAC v3, ligada a ator, organização, projeto/bem, revisão da configuração, fonte e prazo original. Prévia determinística v2 permanece compatível. Apply exige confirmação e seleção de campos; configuração alterada/desabilitada ou vínculo revogado invalida a operação. Equipamento novo nasce com saldo zero; bem existente recebe somente conferência/anexos, sem sobrescrever o cadastro.

## Limites e continuidade

Não houve publicação, leitura de segredo nem chamada real aos provedores. Testes usam SQLite/migrações reais, HTTP injetado e documentos/contas sintéticos. A revisão independente, integração de metadados, builds e CUA finais serão registrados no handoff. O coordenador mantém montagem, backup real, publicação e Vault.

## Verificação local e revisão independente (2026-10-31)

- Backend R10: `4d26fcf`, correção de transporte/orçamento `d3c4ad4`; correções do mesmo padrão nos fluxos operacionais/STT `cd4be2e` e `ba11de1`. Após decrypt, assinatura e demais esperas, a última consulta SQL confirma papel/projeto/organização/configuração antes do transporte ou retorno. O batch que marca uma consulta aplicada inclui a mesma autorização. Movimentos físicos já confirmados não são revertidos em perda posterior de acesso: a recuperação permanece idempotente.
- 45 testes próprios de assistente/STT/documentos passaram em Node 24.22.1 e 26.12.1. A revisão independente de `relatorios_datas` reconferiu 15 probes, mais esses testes e dois de modelo: 62/62; os nove probes de envio/retorno anteriormente vermelhos passaram após os patches.
- Dez testes comportamentais do painel cobrem consentimento, organização correta, campos ausentes/conflitos, leitura assíncrona de arquivo e respostas antigas após troca de fonte/arquivo/projeto. Campos ausentes ficam em lista compacta; revelar e digitar um campo mantém sua chave/posição e a evidência original, com ajuste manual explícito.
- CUA/Chrome em ambiente descartável `qa-local`: login sintético → Materiais → fonte textual → opt-in nomeando PROEX UFG/103 bytes → consentimento → prévia com dois campos literais e 18 ausências → trecho expandido → marca manual com foco preservado → confirmação → recibo → catálogo atualizado com patrimônio `000456`, saldo/reservado/disponível zero. Formulário sem overflow nas larguras 375/414/1250 (clientWidth=scrollWidth: 358/397/1233, descontada a barra). Tema escuro em 375 e claro em 414/1250; console sem erros na inspeção final.
- Para esse CUA, foi temporariamente injetada uma função `qaDocumentFetch` apenas nos argumentos de `previewImport` das duas rotas de importação. O adaptador recusava endpoints fora da allowlist e devolvia `Response.json` fixa, sem rede. Configuração/credencial eram sintéticas no banco descartável. Uma rota temporária com iframe fornecia as três larguras sem redimensionar o navegador do usuário. Ambas as injeções, o helper e a rota foram removidos antes dos commits finais; as rotas voltaram ao transporte padrão. Nenhuma chave real, chamada paga, áudio real, acesso SIGAA autenticado ou OCR foi testado.

Evidências locais (fora do repositório): `C:/Users/yan1n/AppData/Local/Temp/proex-document-375-dark.png`, `proex-document-375-receipt.png`, `proex-document-414-light.png`, `proex-document-1250-light.png`. São capturas de dados sintéticos, não evidência de provedor ou produção.

