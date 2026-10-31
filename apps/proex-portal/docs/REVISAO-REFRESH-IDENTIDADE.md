# Refresh e troca de conta — verificação limitada

Patch revisado: `cda66338bd50d68381a5b8615d21f41e87e99c24`. Os quatro cenários pedidos passaram em Node 24 e Node 26; lint do teste sem erro/aviso. Nenhuma implementação foi alterada.

`tests/portal-refresh-identity.test.mjs` extrai por AST TypeScript o callback real de `refresh`, o conversor de identidade e os inicializadores reais das refs. Executa essas expressões inalteradas com agendamento de hooks, fetch, setters e navegação simulados. Não copia a condição nem verifica regex/texto do patch; não reconstrói a aplicação inteira.

Provas: mesma identidade substitui o snapshot; identidade nova pede reload sem executar `setData` ou avançar para o snapshot estrangeiro; primeira carga sem identidade vincula a conta e atualizações seguintes não entram em loop; resposta estrangeira antiga, posterior à resposta válida mais nova, não recarrega nem sobrescreve o contexto atual.

A key por usuário nos dois AssistantPanel foi lida no diff. Montagem/reconciliação completa e navegação real permanecem no CUA integrado do coordenador. Esta verificação não usou rede, ambiente real, porta 5173 ou navegador e não ampliou o escopo para outros estados de sessão.