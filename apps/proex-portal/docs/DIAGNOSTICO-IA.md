# Diagnóstico explícito de conexão — R11

Implementado em 2026-10-31 sobre a V12 integrada `00e4fd2`. Testes exclusivamente com HTTP simulado e credenciais sintéticas: **nenhuma conexão com chave real, geração paga ou transcrição foi executada nesta entrega**. A configuração de provedores continua separada e não é habilitada por um diagnóstico.

## Alcance comprovável

Uma pessoa atualmente autorizada a configurar IA naquela organização — responsável ou TI com concessão explícita — pode consultar metadados autenticados usando somente a credencial **já salva e cifrada no servidor**. Isso também funciona com geração/STT desativados, para conferir a configuração antes de liberar uso. O cliente envia organização, revisão, provedor, consentimento e chave de operação; não envia credencial, endpoint, pedido, material, documento, áudio ou dados pessoais.

| Provedor | Métodos fixos | O que o resultado pode afirmar |
| --- | --- | --- |
| DeepSeek | `GET https://api.deepseek.com/user/balance`, depois `GET https://api.deepseek.com/models` | Endpoint autenticado respondeu conforme contrato e modelo `deepseek-flash` está listado ou não (ausência no catálogo não comprova indisponibilidade). Valores monetários da resposta são descartados, sem apresentação, log ou persistência. Não comprova saldo para uma operação específica nem geração. |
| TypeSafe/Jev | `GET https://api.typesafe.ai/v1/models` | Consulta autenticada respondeu e modelo fixado `jev-1.14.0` está listado ou não. Versões pinadas podem ser aceitas sem aparecer no catálogo; ausência não é indisponibilidade. Não executa System One e não mede confiança/acurácia. |
| Deepgram | **GET** `https://api.deepgram.com/v1/auth/token` | O endpoint de validação de chave respondeu com JSON de metadados. Dados da chave/conta são descartados. Não comprova modelo, escopo de transcrição, codec ou envio de áudio. Não usa POST de concessão/JWT. |

Fontes oficiais consultadas em 2026-10-31: [DeepSeek: balance](https://api-docs.deepseek.com/api/get-user-balance/), [modelos](https://api-docs.deepseek.com/api/list-models/); [TypeSafe: modelos da conta autenticada](https://docs.typesafe.ai/api/list-models) e [limites do catálogo para versões pinadas](https://docs.typesafe.ai/models); [Deepgram: teste de autenticação](https://developers.deepgram.com/guides/fundamentals/authenticating#test-request). São consultas de metadados, sem chamada aos endpoints de inferência ou consumo de áudio. Não se promete política de cobrança imutável dos provedores; não há operação de geração solicitada por este fluxo.

Um HTTP 200 isolado não é o recibo inteiro: o adaptador exige JSON não vazio, corpo limitado, ausência de erros e campos esperados nas listas de modelos/balance. Não apresenta texto bruto do provedor. Resultado rejeitado, limitado, expirado, inválido ou indisponível permanece explícito. Credencial válida para metadados pode não ter todos os escopos/créditos necessários à operação real.

## API, autorização e limites

- `GET /api/assistant/connection?organizationId=…`: lê os últimos diagnósticos da **revisão atual**; não chama provedor nem grava contador. Exige autorização atual de configuração. Configuração ainda não salva retorna orientação para salvá-la primeiro.
- `POST /api/assistant/connection`: sessão canônica, origem exata, JSON, `X-Proex-Action: 1`, corpo até 2 KiB. Campos exatos: `organizationId`, `expectedRevision`, `provider`, `operationKey`, `consent: true`.
- Credenciais são decifradas com AAD da organização. Provedor e endpoints estão em lista fechada HTTPS, sem porta, redirecionamento, URL de áudio ou endpoint fornecido pelo cliente. Não aceita `pxs_`/`pne_` como sessão.
- Cada resposta externa tem limite de **32 KiB**, medido também durante streaming; listas admitem até duzentos modelos. Orçamento do transporte e fence após admissão de até **oito segundos**, ou o timeout configurado menor; leituras de autorização/admissão acrescentam seu próprio tempo. Não há retentativa automática. Cancelamento do cliente propaga aborto quando possível, sem garantir cancelamento retroativo de chamada já recebida.
- Cotas de diagnóstico por organização/provedor: três operações novas a cada janela de dez minutos e doze a cada janela de 24 horas. São separadas do orçamento de inferência; reservas e intent são atômicos. Não se registra cobrança, token de geração ou duração de áudio fictícios.

`configurationActor`/`aiConfigurationAuthority` preservam a mesma concessão TI e a autoridade atual do concedente, sem conceder inventário ou outro projeto. A revisão e a autorização participam dos batches de admissão, imediatamente antes de cada GET externo e ao persistir/devolver o resultado. Revogação durante uma resposta impede apresentar ou registrar sucesso. Rotação/reconfiguração exige diagnóstico novo; um resultado antigo não fica validado para credenciais novas.

## Idempotência e estado honesto

Não há migração nova. `mutation_keys` continua identificando um registro criado atomicamente pela operação: `entity_id` aponta ao audit de intent `assistant.connection.started`. O resultado sanitizado fica em `assistant.connection.result` vinculado àquele intent. O fluxo não apaga idempotência global nem usa tabela de domínio como depósito de respostas brutas.

Dois pedidos concorrentes com a mesma operação criam apenas um intent e uma consulta externa. Repetição autorizada recupera o recibo existente; se o processo morreu ou a resposta ainda está em andamento, retorna **resultado pendente/não confirmado**, sem refazer GET. Reutilizar a operação com organização/provedor/revisão diferentes é rejeitado. Há ação explícita na interface para permitir uma nova consulta, sob nova operação e dentro da cota. Não se confunde essa escolha com retry automático.

Auditoria e resposta contêm somente organização, provedor, revisão, horário, latência, status HTTP, modelo listado/não listado e resultado do diagnóstico. Não contêm chave, ciphertext, saldos, IDs privados do provedor, scopes detalhados, conteúdo ou erro bruto remoto. Projeções portáteis/MCP podem registrar ação/ID/horário, conforme allowlist existente; não exportam esses detalhes ou segredos.

## Montagem e voz

`AssistantConnectionPanel({ orgId: string, revision: number })` é componente isolado para montar dentro da configuração do `AssistantPanel`, somente quando `canConfigure` for verdadeiro. Use key por ator/organização/revisão na montagem externa; o componente também remonta internamente ao trocar organização/revisão. Salvar configuração atualiza a revisão, invalidando apresentação antiga. A interface carrega apenas recibos; clicar em testar exige consentimento. Respostas malformadas, organização/revisão trocadas e erro de acesso limpam a apresentação anterior. Nenhuma chave é pedida ou guardada nesse componente.

R12 já oferece o fluxo adequado ao pedido humano: gravar ou selecionar áudio → ouvir → transcrever → editar/revisar texto → preparar proposta → confirmar operação normal. O diagnóstico de Deepgram **não substitui esse teste funcional**; configuração, permissão/codec e conferência em aparelho físico continuam etapas operacionais. Não foi acrescentado microfone indiscriminadamente a formulários.

## Verificação

Fixtures SQLite reais com cifra/configuração/permissões reais e transporte HTTP falso. Casos cobrem configuração desativada, TI e concedente revogados, organização A/B existente, credencial ausente, revisão, SSRF/redirect, quota independente e concorrente, idempotência, timeout/abort, respostas/echo acima do contrato e exclusão de segredos nos snapshots/MCP/Sheets/Drive. A UI é exercitada por scheduler de hooks/JSX, sem navegador automatizado: consentimento, JSON inválido, acesso perdido, resposta tardia e tentativa incerta. A montagem integrada e a publicação pertencem ao coordenador; nenhum resultado local comprova conexão real com os provedores.
