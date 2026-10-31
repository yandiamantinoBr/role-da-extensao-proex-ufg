# Revisão independente de saídas rastreáveis — 2026-10-31

Escopo curto: backend `7ca2b9b` / integração `04c3d36`, UI `79c002f` / integração `e37e62b`, montagem `a8db955`. Revisão em worktree isolada sobre `c8062da`, somente código e fixtures sintéticas. Nenhum servidor, build, provedor, banco real ou porta 5173 foi utilizado. O commit desta revisão contém somente testes e este relatório.

Os oito testes de `outflow-details.test.mjs` e os dois estados novos da interface passaram antes dos ajustes. Foram acrescentadas somente duas provas independentes:

| Achado | Reprodução | Estado |
| --- | --- | --- |
| P2: falha de dados recebida como HTTP 200 aparece como consulta vazia | Erro de parse JSON e `rows` que não é array não apresentam erro explícito. A interface aplica o fallback vazio. | Correção do coordenador em validação. |
| P2: CSV de consulta parcial perde a indicação ao sair da tela | `truncated:true` aparece em `filtros.Cobertura` do JSON, mas o CSV tem nome normal e nenhum aviso no conteúdo. | Correção do coordenador em validação. |

## Controles conferidos

- Saída de estoque usa somente baixa efetiva de distribuição ou prêmio; empréstimo usa estado `out`/`returned`, uma unidade individual. Não há soma de reserva com retirada, nem baixa de estoque por empréstimo.
- Período usa `checked_out_at` ou auditoria válida da retirada. A previsão não substitui data efetiva. Registros sem data podem aparecer sem período e ficam fora de um intervalo datado.
- Auditoria com JSON inválido não derruba o relatório nem vira retirada; o teste inclui um registro inválido antes do evento válido.
- O viewer não recebe nome operacional ou notas, mesmo com `includeNotes=1`. Cada ramo aplica autorização SQL própria; rebaixamento durante o await e organização estrangeira continuam bloqueados.
- Operadores recebem nome atual do perfil, sem fallback para e-mail/ID; beneficiários, contatos e códigos privados de prêmio não entram no resultado.
- Texto livre exige consulta opcional e seleção explícita da coluna para exportar. Mudar filtro invalida imediatamente a exportação anterior. Saldo atual repetido não é oferecido como medida de soma.
- Montagem disponibiliza `outflow_details` para permissão operacional ou de relatórios; a autorização de cada linha permanece no servidor.
- O teto de bytes foi observado: 5.106 registros sintéticos de origem retornaram 3.010 linhas / 3.144.827 bytes, abaixo de 3 MiB, com `truncated:true`. Cinco consultas fizeram cinco leituras SQL e zero escritas. O benchmark é SQLite em memória, sem conclusão sobre capacidade da hospedagem.

A revisão não altera a política de compartilhamento: notas opcionais podem conter dados pessoais e devem ser conferidas pela pessoa operacional antes de exportar. Unidade, saldo, nome do material e nome do operador são atuais, sem promessa de reconstituição histórica.

Comandos focados na aplicação: `node --test tests/outflow-details.test.mjs` e `node --test --test-name-pattern='traceable outflow|independent:' tests/reports-center-state.test.mjs`. A compilação e os demais gates de integração ficam com o coordenador.
