# V17 · piloto próprio dos avisos

## Comportamento

O menu **Enviar um único teste para mim** processa no máximo uma notificação normal elegível do próprio emissor canônico. A API não recebe destinatário livre: deriva a pessoa da credencial administrativa e revalida identidade, consentimento, atribuição, acesso e cotas na transação e antes de liberar a mensagem. Pessoas de outras filas não são destinatárias do piloto. A rotina regular continua separada e inicialmente pausada.

O GAS grava uma tentativa durável antes de chamar MailApp. ACK perdido pode ser recuperado sem repetir o envio; uma resposta substituída ou não comprovada encerra o piloto sem afirmar aceitação e sem abrir outra tentativa. A revisão independente encontrou esse caso de repetição, que foi corrigido antes da publicação. O marcador local não promete entrega exatamente uma vez entre projetos/clientes diferentes; permanecem os controles de fila e cota do servidor.

A cópia da credencial agora aguarda o navegador, informa sucesso ou falha, oferece seleção manual e exige conferir o armazenamento antes de ocultar o valor. Nenhuma mensagem de erro contém a credencial ou a exceção privada do navegador. Troca de organização, substituição e desmontagem ignoram respostas tardias.

Não há migração, dependência, mudança no contrato Sheets ou ampliação de OAuth. O projeto privado de avisos continua separado do projeto existente de dados/anexos/backup. Os quatro escopos explícitos são envio MailApp, identidade da conta, conexão externa e gatilhos; a rotina não lê a caixa de entrada nem células das planilhas.

## Verificação

Fontes integradas: `3c34a10`, `fc1ab1e`, `a28e3d0`; candidatos dos autores `e5504a7`, `e779a97`, `dda5c1a`. Revisão independente aprovada: 53 testes focados e 14 cenários próprios em Node 24/26, inclusive revogações após `sending`, rollback do claim, clipboard tardio e bloqueio de um segundo piloto. Tipos e lint passaram, com três avisos antigos no lint completo. Os gates integrados, CI e publicação são registrados pela coordenação separadamente da autoria.

## Operação autorizada

A confirmação específica para a conta pessoal provisória, uma credencial restrita de trinta dias, rotina de dez minutos e um piloto para a própria conta foi recebida. A conta efetiva, a organização e a conexão privada foram preparadas; existe somente uma credencial ativa. Neste checkpoint anterior à publicação da V17, o servidor de envio e o gatilho continuam OFF e nenhum teste real foi enviado.

A execução deve atualizar somente o `Code.gs` desse projeto privado separado, preservar o manifesto e as propriedades, habilitar limites conservadores e usar exclusivamente o menu de piloto. A demanda operacional real de validação deve ser atribuída somente ao próprio responsável e concluída após o resultado; não cria estoque, empréstimo ou evento fictício. Confirmar estado/pendência, distinguir aceitação de entrega e instalar o gatilho somente após o piloto. Procedimento completo em [AVISOS-EMAIL.md](../apps/proex-portal/docs/AVISOS-EMAIL.md).

Resultados reais, identificadores de implantação e limites operacionais serão acrescentados após execução; nenhum segredo ou localizador privado integra este arquivo.
