# R24 · Meu trabalho e acompanhamento visual

Pedido de Yan em 31/10/2026: demandas com cores/símbolos que permitam reconhecer urgência e andamento; uma central pessoal resumida para os registros relacionados à pessoa e às suas equipes; responsáveis nomeados para projetos, materiais, empréstimos e dinâmicas; navegação direta e resumo visual em cada contexto. O exemplo “renovar no CGA” é uma demanda informada pelo usuário, sem prazo/obrigação institucional presumidos.

## Critérios de implementação

- Separar **estado**, **prioridade** e **prazo**. Alta prioridade não significa atraso. Verde/visto indica conclusão; amarelo/pausa ou relógio pede atenção; vermelho/alerta indica atraso ou prioridade alta, com rótulos explícitos. Não existe promessa de codificação universal; a convenção será consistente no produto.
- Meu trabalho reúne atribuição direta ou equipe ativa/membro vigente, intersectada com permissões atuais. Autoria, cargo, contato patrimonial e pessoa que tomou emprestado não criam responsabilidade implícita. Uma tarefa direta + duas equipes conta uma vez por pessoa.
- Nomeações permanentes por projeto e módulo, opcionalmente por entidade, exigem modelo aditivo 0017, gestão vigente, pessoas/equipes elegíveis, versão/CAS, auditoria e revogação. Não concedem acesso. A central só inclui nomes, links e números autorizados.
- Totais completos no servidor, independentemente das páginas de até 50 registros. Status filtra a lista; os totais identificados como “Totais do recorte” continuam cobrindo a população atribuída no recorte de organização/projeto/modalidade de atribuição. Módulo operacional não é área temática, unidade ou equipe.
- Cartões informativos têm ícone, texto e contraste em ambos os temas. Ações são botões/links próprios de pelo menos 44 px. Datas de atenção usam o dia de Brasília informado pelo servidor. Hoje ainda não venceu; concluídas/canceladas não aparecem vencidas.
- Preservar Início, atalhos e todas as operações atuais. Nova central usa módulo próprio; perfil continua sendo cadastro/identidade, não relatório de trabalho. Nomeações em Sheets são projeção somente leitura; administração e ACL continuam no portal.

## Verificação e continuidade

Testar 51+ demandas, duplicidade direta/equipes, organizações/projetos alheios, equipe arquivada/membro removido, ator bloqueado, respostas antigas após mudança de conta/recorte, status e paginação, datas, zero/vazio e erro. Ensaiar migração e recuperação em isolamento antes de publicar; manter SQLite/Supabase e conector existente. Conferir 1250/375/320, claro/escuro, teclado e áreas de toque; revisão independente do design/contratos. Registrar publicação real e limitações separadas do código local.

Responsáveis da implementação: backend/0017 em `v15-meu-trabalho`; UI isolada em `v15-meu-trabalho-ui`; sinais e integração em `v15-demandas-visuais`. R23/V14 tem entrega e nota próprias; a aprovação V14 não aprova antecipadamente R24.

Referências primárias: [uso de cor — W3C](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html), [Tag — GOV.UK](https://design-system.service.gov.uk/components/tag/), [lista de tarefas — GOV.UK](https://design-system.service.gov.uk/components/task-list/), [mensagens de estado — W3C](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). As recomendações foram confrontadas pelo auditor com os contratos e permissões locais.
