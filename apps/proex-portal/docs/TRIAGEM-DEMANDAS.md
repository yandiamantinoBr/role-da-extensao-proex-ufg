# Triagem de Demandas com JEV

A pessoa com permissão de editar a demanda pode registrar importância manualmente. A matriz de Demandas conta os registros pendentes da página atual. O campo de prioridade continua representando urgência. Registros anteriores à migração aparecem como “Sem classificação” até receberem importância explícita.

A opção Triagem com JEV está desligada por padrão no servidor. Ela requer `PROEX_JEV_TASK_TRIAGE=1`, assistente e JEV habilitados na organização e credencial existente. O texto da demanda fica no portal. A pessoa redige um resumo de até 600 caracteres, revisa o conteúdo e consente com o envio dele e do prazo. O servidor também informa o dia de Brasília para o modelo interpretar prazos. Links, contatos e formatos de credenciais conhecidos são rejeitados. Identificadores, títulos, nomes de equipes e texto integral da demanda ficam fora do pedido.

Uma chamada JEV classifica duas dimensões separadas. O portal apresenta os critérios correspondentes às categorias sugeridas e pede confirmação expressa. As duas escolhas exigem confiança e probabilidade de pelo menos 0,9. Dúvida em um eixo encaminha ambos para decisão manual. A proposta expira após dez minutos, pertence à conta solicitante e exige a mesma versão da demanda e da configuração. A confirmação atualiza prioridade e importância em uma transação com histórico e auditoria.

A reserva máxima por análise é de 4.096 tokens de entrada, 173 micros de dólar pela tarifa de referência e uma chamada. O teto diário compartilhado é aplicado antes do transporte. Reservas e tokens medidos são armazenados separadamente por organização, modelo e dia. Cobrança conciliada e painel consolidado de uso por modelo são entregas separadas. O recibo de triagem guarda o resultado tipado e o resumo fica fora do recibo e do histórico.

A validação usa provedor simulado e SQLite descartável. A ativação futura exige decisão institucional sobre envio ao provedor, teste sintético com teto e conferência do recibo. A indicação de equipe requer uma etapa própria de validação e confirmação da atribuição. A triagem inicial deixa os responsáveis como estavam.

[Contrato da API TypeSafe](https://api.typesafe.ai/redoc) · [Tarifa publicada](https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost)
