# Meu trabalho e designações explícitas — R24

Base: `c35140a`. Incremento aditivo; as tabelas de domínio e os papéis existentes permanecem. A integração da interface e a publicação são responsabilidade do coordenador.

## Semântica e acesso

Uma demanda pertence ao trabalho pessoal apenas quando há atribuição direta ou atribuição a uma equipe ativa da qual a pessoa participa atualmente, com acesso SQL vigente ao contexto. `created_by`, contato do tomador, `responsible_reference` documental, notificações e `canWork` não criam atribuição. Remoção da equipe, perda de acesso, bloqueio/anonimização da conta ou revogação da designação suprimem os resultados. A atribuição direta e várias equipes contam uma única demanda.

A designação de responsabilidade é permanente até revisão/revogação explícita: tem projeto obrigatório, organização derivada desse projeto e área operacional `projects`, `materials`, `loans` ou `campaigns`. Área operacional significa módulo do portal, e não área temática FORPROEX. Pode indicar toda a área naquele projeto ou um único material/empréstimo/campanha compatível. Pessoas e equipes podem se sobrepor. O alvo é imutável; trocar de alvo exige nova designação e revogar a antiga. Um alvo mantém a mesma identidade inclusive depois de revogado; reativar exige sua versão atual e uma escolha explícita de responsáveis.

Somente owner/manager vigente no contexto pode nomear, substituir ou revogar. A ação revalida gestor, pessoas ativas com acesso ao projeto, equipes ativas da mesma organização e alvo dentro da mesma transação de CAS/recibo/histórico/auditoria. Uma equipe pode conter integrantes de vários projetos: cada pessoa só recebe trabalho se seu próprio acesso atual permitir. Equipes nunca concedem ACL. Designação não concede estoque, empréstimos, administração, leitura ou delegação de demanda. O grant limitado de uma demanda continua separado, incluindo a validação do emissor atual já existente.

Mudar o papel de quem nomeou uma responsabilidade não apaga a designação organizacional confirmada. Isso não preserva poderes de edição: toda ação posterior exige gestão atual. Responsáveis sem permissão do domínio veem a designação e seu contexto permitido, mas o nome/URL/ID no `target` da entidade ficam nulos e `canOpen=false`. Contatos, e-mails e roster privado não são incluídos. Organizações arquivadas conservam o histórico na consulta geral autorizada; não admitem novas nomeações e ficam fora do trabalho ativo pessoal.

## API e contagens

Os tipos e validadores canônicos estão em `lib/my-work/contracts.ts`.

- `GET /api/my-work`: `organizationId`, `projectId`, `assignment=all|direct|team`, `status=pending|all|completed|attention|overdue|due_today|in_progress|blocked|open|cancelled`, `taskOffset`, `responsibilityOffset`, `limit` (20 padrão, 1–50). Os offsets têm teto 50.000. O ator vem da sessão; `userId` e relógio enviados pelo cliente não mudam a população.
- `totalsScope=organization-project-assignment`: os totais completos e os grupos por área ignoram status e paginação. `tasks.total` corresponde apenas à lista filtrada por status; `responsibilities.total` conta as designações ativas. `attention` é a união de atrasadas ou bloqueadas, sem somar a mesma tarefa duas vezes. Prazos vencidos e para hoje contam somente demandas pendentes.
- Classificação operacional das demandas: empréstimo → material → campanha → projeto → geral. Uma demanda com mais de uma referência pertence somente ao primeiro grupo; as referências originais são preservadas. Designações e demandas têm unidades distintas: seus totais não devem ser somados como quantidade de materiais ou pessoas.
- Datas `today` e `asOf` vêm do servidor, no fuso `America/Sao_Paulo` (Brasília, UTC−03). Cada GET explícito recalcula o dia; o cliente deve atualizar após ações/retorno/virada pertinente, sem polling agressivo. `followupList` também oferece esses dois campos de modo aditivo, compatível com clientes anteriores.
- Listas e contagens pessoais são quatro SELECTs na mesma transação de leitura forte. Não há gravação por visita, leitura automática de notificação, fanout nem fetch por item. Cada página é uma consulta atual; offsets não prometem uma fotografia estável entre requisições concorrentes.
- `GET /api/responsibilities?view=catalog&projectId=...`: candidatos mínimos de gestão, nomes sem e-mail; até 500 itens/empréstimos/campanhas por coleção, com `truncated` explícito. `itemId`, `loanId`, `campaignId` priorizam o alvo escolhido dentro do projeto mesmo se ele ficar fora da primeira página do catálogo.
- `view=list`: organização/projeto/área, entidade opcional, `target=area|entity`, `status=active|revoked|all`, offset/limit. Alvo geral usa `target=area`; sem esse filtro a consulta abrange também entidades. O gerente deve consultar `status=all` para obter a versão de um alvo revogado. `view=detail&id=...` devolve uma designação atual autorizada.
- `POST responsibility.save`: projeto/área/alvo, `userIds` (até 20), `teamIds` (até 8), `expectedVersion` (0 apenas para alvo ainda inexistente), `operationKey`. `responsibility.revoke`: id, versão e chave de operação. Recibos idempotentes, concorrência, recuperação de resposta perdida e permissões atuais são revalidados; não há rollback destrutivo de uma gravação já confirmada.

`viewerId` e os ecos de contexto permitem descartar respostas de outra conta/projeto. A interface deve comparar o pedido atual, cancelar requisições antigas e validar JSON antes de substituir os dados. Hrefs são internos canônicos: demandas usam `module=demands&demandId`, e os alvos usam o módulo e projeto permitidos. O target carrega o ID da entidade para callbacks específicos; o link contextual sozinho não promete abrir um modal de entidade. Não usar href externo arbitrário do cliente.

## Migração, Sheets e recuperação

`0017_work_responsibilities.sql` adiciona scopes, assignees e history. Triggers protegem organização/projeto, referência compatível, identidade imutável e histórico imutável. Modelo tipado, journal e snapshot acompanham a migração. O Node descobre `drizzle/*.sql` ordenados no manifesto existente; o Worker usa a mesma pasta `migrations_dir`. Nenhuma migração anterior foi reescrita.

A projeção portátil/Sheets passa a ter 35 tabelas: `work_responsibility_scopes` é global-owner-only e somente leitura. Ela inclui contexto, alvo, estado e revisão, excluindo quem nomeou, responsáveis e histórico. Assignees/history não são tabelas portáteis e não podem ser editados pela planilha/MCP. Depois de publicar, uma sincronização real precisa verificar a nova aba e o total 35 antes de alegar atualização completa; esta implementação não executou conector real.

O backup completo inventaria as três tabelas automaticamente e conserva as atribuições/histórico que a projeção portátil omite. Os testes ensaiam restauração sintética, FKs e integridade e aplicam 0017 sobre todas as migrações anteriores, comparando todas as linhas antigas. O ensaio com backup real permanece a cargo do coordenador antes da migração de produção.

## Evidência local e limites

Testes usam somente SQLite, sessões e dados sintéticos. A rodada focada cobre 50+ tarefas, sobreposição direta/equipes, filtros de todos os estados, pessoas de outro projeto, conta bloqueada, remoção de membros, revogação, CAS, concorrência, resposta perdida, rollback da auditoria, DTOs, CSRF, backup e portable. O benchmark com SnapshotD1 real faz uma verificação autoritativa de versão e zero loads/commits após aquecimento; o tempo da fixture não estima rede ou capacidade Vercel/Supabase.

Nenhuma chamada paga, e-mail real, segredo, servidor, CUA, build ou publicação foi executado por este agente neste incremento. Interface/integração, revisão independente e gates globais continuam necessários antes de declarar a entrega completa.
