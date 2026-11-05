# Uso pessoal e uso pela organização

Implementado em 05/11/2026. Este documento descreve o código local; publicação e configuração real têm comprovantes próprios.

As credenciais continuam pertencendo ao cofre da organização. A escolha **Só eu** limita o uso dos modelos à pessoa que salvou essa configuração; **Organização** permite o uso pelos integrantes que já possuem a permissão operacional necessária no projeto. A escolha não concede acesso a projetos, estoque, documentos ou demandas.

Poder administrar funções, cotas e diagnóstico não dá acesso automático ao uso pessoal de outra pessoa. Uma delegação nominal de configuração continua sendo exigida para TI. O diagnóstico de metadados pode ser executado pelos administradores autorizados, com consentimento próprio, sem inferência ou envio de documentos/áudio. A administração de segredos tem autorização separada.

## Contrato

`AssistantConfig` acrescenta:

- `usageScope: 'private' | 'organization'`;
- `usageUserId: string | null`.

`configureAssistant` grava sempre a identidade canônica de quem está salvando quando a opção é `private`; um identificador enviado pelo navegador nunca escolhe outro usuário. Para `organization`, grava `null`. Requer autorização viva da organização e versão atual da configuração.

Sem configuração anterior, `newAssistantConfig(actorId)` fornece uso privado e todas as funções desligadas. Um salvamento explícito posterior pode ativar as funções que tenham chave e limites válidos. Gravar uma chave sozinha não ativa nenhuma função. JSON antigo sem os dois campos mantém a interpretação de uso da organização. O valor `DEFAULT_ASSISTANT_CONFIG` preserva essa compatibilidade e não deve criar novos cadastros.

Campos de política omitidos em uma atualização preservam o escopo anterior. Um salvamento da opção privada passa a se referir à pessoa que está salvando; a interface precisa explicar isso antes da confirmação. Não existe seleção de um terceiro nessa versão.

O estado do assistente informa, por organização, `canUseAi`, `usageScope` e `usageIsMine`. Pessoas sem permissão de configuração não recebem a identidade da pessoa autorizada para uso privado. O estado das funções considera a política, a configuração e a presença da credencial.

## Barreiras de execução

Texto, transcrição, interpretação documental e triagem de demandas verificam a política antes de decifrar as credenciais e novamente após essa espera. Os predicados SQL da reserva, envio, gravação, aplicação e recuperação de resultados usam a mesma política, além das permissões operacionais, organização ativa e revisão da configuração.

Uma mudança de escopo durante uma chamada pode impedir a apresentação do resultado, mas não desfaz o envio já realizado ao provedor. A reserva permanece contabilizada; não há repetição automática. Uma alteração depois de um movimento físico já confirmado preserva esse movimento e sua auditoria, conforme a política existente de recuperação idempotente.

Não há tabela ou migração nova: os dois campos ficam no JSON de configuração operacional, separado das credenciais cifradas. Esse JSON não contém a chave de API.

## Verificação

`node --test tests/assistant-usage-policy.test.mjs` usa SQLite real descartável e provedores simulados. Cobre padrões privado/desligado, legado, normalização de identidade, organização A/B, concessão administrativa sem uso implícito, quatro capacidades, mudança de política durante decifragem, antes do envio, no recebimento, no commit, na aplicação e na recuperação. Nenhuma chave ou chamada real é necessária.

Verifique também as suítes `assistant.test.mjs`, `task-triage.test.mjs` e `importer.test.mjs`. A interface e o registro da publicação são conferências separadas.
