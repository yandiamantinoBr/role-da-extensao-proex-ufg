# Demandas, equipes, conferências e avisos internos — R20 / 0014

Incremento isolado para integração pelo coordenador. Nenhuma publicação ou mensagem externa foi realizada neste trabalho. Dados dos testes são sintéticos.

## Integração e migração

A migração `0014_follow_up.sql` acrescenta dez tabelas sem alterar tabelas ou dados anteriores. Requer organizações da 0008, não depende da 0012/0013. Aplicar somente após backup verificado, em sequência depois dessas versões quando presentes no checkout final. O modelo está em `db/follow-up-schema.ts`: integrar com `export * from './follow-up-schema'` no schema principal e reconciliar journal/snapshot somente depois da 0012/0013. Não foi criado snapshot final conflitante nesta branch. Triggers de imutabilidade/referências permanecem exclusivamente no SQL runtime. A expressão COALESCE do índice de atribuições deve ser preservada; Drizzle 0.31.10 possui limitação conhecida na emissão fresh de índices com vírgula em expressões. Não substituir a expressão nem regravar migrações aplicadas para contornar o gerador.

Tabelas: `followup_teams`, `followup_team_members`, `followup_tasks`, `followup_assignees`, `followup_history`, `followup_checklists`, `followup_checklist_items`, `followup_checklist_actions`, `followup_notifications`, `followup_work_grants`.

## Autorização pública para relatórios e extensões

`lib/follow-up/scope.ts` exporta `authority(userSql, orgSql, projectSql, write=false, manage=false)`. Os argumentos SQL são expressões fixas do servidor. O argumento `userSql='?'` ocorre uma vez nessa função; preferir uma coluna de caller quando compor várias funções. `effectiveRecipient`, `assignedRecipient` e `workAuthority` repetem o argumento de usuário e devem receber uma coluna/expressão, nunca um único placeholder com uma única ligação.

Toda leitura deve usar `authority` do próprio usuário e do escopo armazenado da demanda. `reports.read` sozinho não dá acesso. Organização sem projeto é somente para owner da organização ou da plataforma. Projetos respeitam o vínculo atual. Histórico de organização arquivada continua consultável por quem mantém acesso; escrita, trabalho delegado e avisos exigem organização ativa. Os guards consultam SQL atual, sem confiar nos arrays de permissões do ator em cache.

Equipes são organizacionais, com associação muitos-para-muitos e remoção histórica. Não mudam `members` e não concedem ACL. Pessoas comuns só recebem nomes de pessoas elegíveis no mesmo projeto; a gestão de equipe usa um catálogo separado `teamPeople`, disponível exclusivamente a administradores da organização. Não há e-mails na projeção.

Viewer continua somente leitura. A gestão pode conceder, com confirmação explícita, uma autorização limitada `followup_work_grants` a pessoa atualmente atribuída e com acesso ao projeto. Ela pode atualizar status/nota e contar os materiais dessa demanda. Não pode alterar título, responsáveis, prazo, referências, estoque, criar demandas nem delegar. O grant depende da atribuição atual e do vínculo/papel/conta atuais do gestor emissor. Remoções, revogações e bloqueios são revalidados no batch de gravação e no replay. Divergências da conferência exigem revisão de alguém com permissão operacional antes da conclusão/geração de pendências.

## Contrato de dados e relatórios

`followup_tasks`: `id, organization_id, project_id` (nulo = geral da organização), `title, body, priority` (high/medium/low), `status` (open/in_progress/blocked/completed/cancelled), `due_at` (YYYY-MM-DD, opcional), `campaign_id, item_id, loan_id` opcionais, `version, created_by, created_at, updated_at`. Referências têm de ser do projeto; organização/projeto são imutáveis. Datas de atraso derivam de prazo + estado atual, sem gravar a cada visita.

`followup_checklists`: escopo obrigatório de projeto, `campaign_id` opcional, `task_id` único, título, open/completed, versão e timestamps. `followup_checklist_items`: material real `item_id`, `size` livre até 40 caracteres (P/M/G podem ser linhas distintas), esperado/contado/avariado, observação. `counted` nulo é pendência de preenchimento; avariado nunca supera contado. Consultar unidade pelo item; não somar unidades ou tamanhos sem separar. Nenhum checkbox altera stock/reserved/movements. A conclusão pode criar demandas de revisão por divergência, com vínculo único `(checklist_id,row_id)` em `followup_checklist_actions`.

Fechar evento junto da criação de conferência é uma única transação com CAS do evento e os guards normais do domínio. Falha na criação preserva o evento aberto. Operações usam chave idempotente e versões; repetir conclusão ou resposta perdida não duplica tarefas/avisos.

API `/api/follow-up`: GET `view=tasks|detail|catalog|inbox`; POST operações `task.create/update/work/worker.grant/worker.revoke`, `team.create/update`, `checklist.create/count/complete`, `notification.read`. GET é estritamente sem escrita. POST exige mesma origem, JSON e `X-Proex-Action`. Limite de 64 KiB.

## Avisos e contrato do e-mail

Notificações internas persistem em `followup_notifications(id,task_id,user_id,cause_key,read_at,created_at)`, com dedupe por demanda+usuário+causa. Causa `task:VERSION` ou `checklist:ID:VERSION`. Não contêm título/corpo congelados: a caixa consulta o estado atual da demanda, o acesso atual, a conta ativa, a organização ativa e a atribuição efetiva (direta/equipe ativa), além do autor da demanda. A revogação ou saída de equipe oculta avisos anteriores imediatamente, sem apagar o histórico. Inbox é próprio de cada usuário.

`fanout` não envia e-mail. R21/0015 é uma frente separada: antes de qualquer envio precisa revalidar `authority`, `activeAccount`, organização ativa e `effectiveRecipient`; não deve confiar em destinatário congelado. Configuração/opt-in, claim TTL, beginSend durável, ACK de aceitação e estado incerto pertencem àquela frente. Não há promessa de exactly once ou retentativa cega após envio incerto. Nenhum envio real habilitado por 0014.

WhatsApp é apenas compartilhamento manual de título + link protegido via `https://wa.me/?text=`. Não inclui telefone, corpo, contagens ou envio automático.

## Verificação do backend

13 cenários SQLite reais passaram em Node 24: isolamento A/B, escopo geral somente admin, referências, CAS/idempotência, atomicidade do encerramento, três tamanhos, pendências únicas, saldos preservados, remoção de equipe, grants mínimos e revogação no commit, histórico arquivado, catálogo sem contatos e GET sem escrita. Tipos e lint focados passaram antes da entrega da UI. A verificação final da UI e de compatibilidade portátil é registrada no complemento deste documento antes do handoff final.
