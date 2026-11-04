# V17 · piloto próprio dos avisos

Publicação de 31/10/2026 pela [PR #18](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/18), candidato `109b0b943edc1672abc616e43cc4a599dee81138`, merge `f77736262089c97aab226f956fd622ae3b407ad4`. Vercel `dpl_9FpsCmBEfQPeTZ8q9j8TmTxETivG` READY no mesmo commit. CI aprovou 854 testes do portal e 33 do jogo. Tipos e builds Worker/Node passaram. A checagem de isolamento retornou 200 no domínio canônico e 403 nos dois hosts antigos conhecidos.

## Comportamento

O menu **Enviar um único teste para mim** processa no máximo uma notificação normal elegível do próprio emissor canônico. A API não recebe destinatário livre: deriva a pessoa da credencial administrativa e revalida identidade, consentimento, atribuição, acesso e cotas na transação e antes de liberar a mensagem. Pessoas de outras filas não são destinatárias do piloto. A rotina regular continua separada e inicialmente pausada.

O GAS grava uma tentativa durável antes de chamar MailApp. ACK perdido pode ser recuperado sem repetir o envio; uma resposta substituída ou não comprovada encerra o piloto sem afirmar aceitação e sem abrir outra tentativa. A revisão independente encontrou esse caso de repetição, que foi corrigido antes da publicação. O marcador local não promete entrega exatamente uma vez entre projetos/clientes diferentes; permanecem os controles de fila e cota do servidor.

A cópia da credencial agora aguarda o navegador, informa sucesso ou falha, oferece seleção manual e exige conferir o armazenamento antes de ocultar o valor. Nenhuma mensagem de erro contém a credencial ou a exceção privada do navegador. Troca de organização, substituição e desmontagem ignoram respostas tardias.

Não há migração, dependência, mudança no contrato Sheets ou ampliação de OAuth. O projeto privado de avisos continua separado do projeto existente de dados/anexos/backup. Os quatro escopos explícitos são envio MailApp, identidade da conta, conexão externa e gatilhos; a rotina não lê a caixa de entrada nem células das planilhas.

## Verificação

Fontes integradas: `3c34a10`, `fc1ab1e`, `a28e3d0`; candidatos dos autores `e5504a7`, `e779a97`, `dda5c1a`. Revisão independente aprovada: 53 testes focados e 14 cenários próprios em Node 24/26, inclusive revogações após `sending`, rollback do claim, clipboard tardio e bloqueio de um segundo piloto. Tipos e lint passaram, com três avisos antigos no lint completo. Os gates integrados, CI e publicação são registrados pela coordenação separadamente da autoria.

## Operação confirmada

A confirmação específica para a conta pessoal provisória, uma credencial restrita de trinta dias, rotina de dez minutos e um piloto para a própria conta foi recebida. A conta e a organização efetivas foram confirmadas. A primeira credencial, cuja cópia não pôde ser conferida, foi revogada antes da substituição. A credencial ativa vence em **30/11/2026**.

O `Code.gs` salvo no projeto privado foi comparado ao arquivo revisado, com equivalência após normalizar finais de linha. O manifesto apresenta os quatro escopos aprovados. Em 31/10, o menu próprio enviou um teste às **22:34:38 UTC**. O estado local registrou uma aceitação às **22:34:39.867 UTC**, sem pendência. O portal mostrou uma aceitação e a busca exata na conta destinatária confirmou a mensagem na caixa de entrada. O link abriu a demanda operacional atribuída somente ao responsável, que foi concluída após a instalação.

O painel de gatilhos mostrou uma instância de `avisosEmailAutomaticos`, com intervalo de dez minutos. Servidor habilitado e limites operacionais restaurados para 50 por organização/dia, 3 por pessoa/dia, 100 por evento e intervalo mínimo de 300 segundos. O consentimento individual continua necessário. Em **04/11/2026**, o histórico do Google mostrou execuções `Time-Driven` concluídas às 09:42, 09:52, 10:02 e 10:12 no horário exibido. Essas linhas comprovam a execução automática. A prova de entrega corresponde ao piloto próprio de 31/10.

Consulte o procedimento e a renovação em [AVISOS-EMAIL.md](../apps/proex-portal/docs/AVISOS-EMAIL.md). Capturas ficam na pasta local ignorada. A Vault guarda os metadados privados da operação.
