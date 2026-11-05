# Checklist de atividade — contrato e evidências

Contrato aprovado pelo coordenador em 05/11/2026. Migração aditiva reservada: `0026_activity_checklists.sql`, depois de MCP 0024 e transcrição 0025. O coordenador gera o snapshot e journal do Drizzle nessa ordem. Esta frente não publica nem envia e-mails reais.

## Objetivo

Conferir uma atividade, como uma mesa de apresentação, com respostas Sim, Não e Não se aplica, observações e responsáveis. A nova lista reutiliza uma demanda, seu projeto/organização, pessoas/equipes responsáveis, autorizações limitadas de acompanhamento, histórico, auditoria e a fila de notificações existente. Uma etiqueta de texto não concede acesso nem transforma alguém em apresentador/avaliador dentro do sistema de permissões.

O checklist de materiais continua separado: contagem, tamanho, avaria e geração de revisões preservam seu contrato e o saldo de estoque. Um checklist de atividade jamais executa movimentação de materiais.

## Persistência

`followup_checklists.kind` passa a ser `materials | activity`, com default `materials` para todas as conferências existentes. A tabela `followup_checklist_steps` guarda ID, checklist, posição (0–99), texto (1–160 caracteres), resposta `NULL | yes | no | not_applicable`, observação (até 600), versão individual e atualização. As perguntas/posições ficam estáveis após criar; cada operador altera somente a resposta e observação da linha autorizada.

O tipo do checklist é imutável. Triggers recusam passos genéricos numa conferência de materiais, materiais num checklist genérico e respostas após a conclusão/cancelamento. As referências já existentes mantêm checklist, demanda, evento e projeto no mesmo contexto.

## API interna

A rota continua `/api/follow-up`, com a mesma sessão, controle de origem, JSON limitado e `X-Proex-Action: 1`.

| Ação | Entrada principal | Versão esperada |
| --- | --- | --- |
| `checklist.activity.create` | projectId, organizationId, title, body opcional, campaignId opcional, rows[{label}], userIds/teamIds | Criação idempotente por operationKey |
| `checklist.activity.answer` | id do checklist, rowId, answer, note, operationKey | expectedVersion **da linha** |
| `checklist.activity.complete` | id do checklist, operationKey | expectedVersion **do checklist** |

A resposta de detalhe usa `checklist.kind='activity'`, `rows` com passos versionados e `followups:[]`. Material mantém as linhas anteriores; o cliente também aceita o discriminador ausente como material para compatibilidade com respostas anteriores. Tipos desconhecidos/respostas inválidas são recusados pelo transporte do cliente.

Cada linha tem CAS próprio: dois monitores podem responder perguntas diferentes simultaneamente. Atualizações da mesma linha exigem recarregar após conflito. O checklist e a demanda incrementam suas versões e o histórico guarda o delta da resposta, sem copiar toda a lista em cada alteração. Operação, recibo idempotente, auditoria, histórico, incremento e notificação pertencem ao mesmo batch.

Concluir exige pelo menos uma verificação e todas respondidas. A verificação ocorre de novo dentro do batch, junto da versão e autorização atuais. Uma autorização delegada pode responder e concluir listas sem respostas Não; respostas Não precisam de revisão por quem já possui a permissão operacional existente. Os registros permanecem salvos enquanto a revisão é feita.

## Acesso e privacidade

- Reutiliza `authority`, `taskWorkPermission` e `taskWorkAssertion`; atribuição/equipe sozinha não amplia permissões.
- Revogar a autorização, vínculo do participante ou vínculo do gestor invalida escrita e replay, inclusive entre validação e commit.
- Rotas antigas `checklist.count`/`checklist.complete` recusam o tipo activity. Sem esse gate, a conclusão material enxergaria zero materiais e poderia encerrar indevidamente uma lista genérica.
- `task.update` e `task.work` continuam impedindo conclusão enquanto qualquer checklist da demanda estiver aberto.
- Histórico e observações são internos ao contexto autorizado. A planilha por projeto nasce sem resumo de demandas; com opt-in expõe somente o resumo da demanda. Perguntas, respostas, observações e deltas de histórico não entram em nenhuma aba.
- A fila de avisos existente é reutilizada; esta implementação não autoriza nenhuma conta Google nem envia mensagens externas.

## Interface

O botão **Checklist de atividade** aparece no contexto de projeto para quem já pode criar demandas. O formulário aceita uma verificação por linha. **Adicionar modelo: Mesa de apresentação** apenas preenche um rascunho revisável; não cria registros nem inventa nomes de pessoas.

No detalhe, a barra mostra **N de M conferidos** (respostas preenchidas, sem sugerir qualidade/conclusão do projeto). Perguntas têm alternativas textuais e observação, alvo mínimo de 44 px, estado por salvar e salvamento separado por pergunta. Não é preciso permissão de estoque para uma pessoa com autorização limitada registrar uma resposta. Uma demanda encerrada/cancelada não permite novos registros.

## Gates e evidências

- Testes materiais e de segurança existentes continuaram passando.
- Novos casos de serviço: tipos separados, bloqueio de conclusão material, pendências, dois monitores em linhas diferentes, conflito na mesma linha, idempotência, revogação de grant/gestor na transação, cross-projeto/linha estrangeira, observação longa, rollback e saldo/reservas intactos.
- Cancelamento da demanda no início do batch bloqueia a resposta e não deixa recibo parcial.
- Testes de UI: modelo só de rascunho, limites, erro preserva resposta/observação, CAS por linha, progresso, leitura, revisão das respostas Não e demanda fechada.
- `project-sheets-activity-projection.test.mjs` executa o serviço real: opt-in omitido = oito abas sem demandas; opt-in true = nove abas com resumo permitido; perguntas, notas, corpo e histórico não vazam em nenhuma delas. Para executar no worktree isolado, os dois módulos de planilha e SQL 0022 já aprovados do principal foram copiados temporariamente só para QA; não pertencem a este commit. O gate deve ser repetido na revisão integrada.
- TypeScript, ESLint e build Node aprovados.
- Navegador real sobre app e SQLite locais descartáveis, sem mocks de atividade: formulário/modelo revisável → criação → respostas por linha → observação de resposta Não → conclusão → histórico. Estoque e reservas permaneceram iguais antes/depois.
- Capturas `activity-375/390/1366-light/dark.png` e `activity-result.json` em `apps/proex-portal/.sites-runtime/project-visual-qa/`. Seis combinações de largura/tema sem overflow horizontal ou erros de página, com alvos de resposta de pelo menos 44 px. Observações vazias ficam recolhidas e abrem ao escolher Não.
- O coordenador deve gerar metadados do Drizzle 0026 e executar os gates da revisão integrada antes do merge.

## Limites e próximos incrementos

Esta frente não altera os papéis de acesso do projeto, não cria um cadastro público de presença e não sincroniza perguntas/observações para o Google Sheets. Relatórios existentes incluem o resumo da demanda; um relatório detalhado dos passos em PDF/DOCX/XLSX requer uma projeção específica com a mesma ACL. Alterar a estrutura de uma lista já respondida também exige uma operação de revisão explícita, fora deste incremento.
