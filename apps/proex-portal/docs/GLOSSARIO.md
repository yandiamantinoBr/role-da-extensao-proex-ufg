# Glossário do Portal PROEX

Dicionário para pessoas e IAs: o nome de cada coisa na tela, no código e no banco. O código mistura português e inglês, e alguns conceitos têm mais de um nome. Este arquivo diz qual nome usar hoje e qual vai virar o oficial. O plano de consolidação está no fim.

Atualizado em 09/11/2026, sobre a `main` depois da PR52.

## Termos do domínio

| Na tela | Ideia | No código | Tabelas principais | Módulo / arquivos |
|---|---|---|---|---|
| **Organização** | Órgão dono dos dados (ex.: PROEX UFG). Isola projetos e acessos. | `organization` | `organizations`, `organization_grant_migrations` | `lib/organizations.ts`, `organizations-panel` |
| **Unidade** | Unidade acadêmica ou administrativa (ex.: FACE, EA) responsável por um projeto. Não dá acesso a nada. | `unit`, `organizationalUnit` | `organizational_units` | `lib/units.ts`, filtro "Unidade responsável" |
| **Projeto** | Projeto ou programa de extensão (ex.: Rolê da Extensão, 23º CONPEEX). É o escopo de quase tudo. | `project` | `projects`, `project_types`, `project_links`, `project_schedule_items` | módulo `projects`, `lib/projects.ts`, `project-panel`, `project-detail` |
| **Pessoas e acessos** | Quem entra no portal e com qual papel em cada projeto. | `member`, `role` (owner, manager, operator, inventory, loans, viewer) | `members`, `invites`, `portal_users`, `profiles`, `identity_aliases`, `auth_*` | módulo **`team`**, `lib/access.ts`, `lib/users.ts`, `team-panel` |
| **Equipe** | Grupo de trabalho para dividir demandas (ex.: Equipe do estande). Não dá acesso. | `workTeam`, `followup_team` | `followup_teams`, `followup_team_members`, `institutional_team_links` | módulo **`work-teams`**, `work-teams-panel` |
| **Estrutura institucional** | Organograma formal da organização. | `institutionalStructure`, `node` | `institutional_structures`, `institutional_nodes` | `lib/institutional-structure/` |
| **Material** | Qualquer coisa do estoque: brinde, equipamento retornável, material de distribuição ou de consumo. | `item` (`category`: `gift`, `equipment`, `distribution`, `consumption`) | `items`, `material_categories`, `item_primary_photos` | módulo `materials`, `lib/materials.ts`, `material-catalog`, `material-detail-drawer` |
| **Brinde** | Material da categoria `gift`, entregue ao público. | `item` com `category='gift'` | `items` | idem |
| **Kit / opção de brinde** | Conjunto de materiais entregue de uma vez, como "Brinde" ou "Super". | **`offer`** (`kind`: `brinde`, `super`), `offer_components` | `offers`, `offer_components` | aba "Brindes e kits", `lib/prize-tiers/` |
| **Nível de brinde** | Brinde, Super ou Super Super numa dinâmica. | `prizeTier` | `campaign_prize_tiers`, `campaign_prize_settings`, `campaign_prize_history` | `prize-tiers-panel`, `lib/prize-tiers/` |
| **Movimentação** | Entrada ou saída de estoque: recebimento, distribuição, consumo interno ou ajuste de contagem. | `stock.move`, `kind`: `receive`, `distribute`, `consume`, `adjust` | `stock_movements`, `stock_movement_contexts` | ficha do material → Movimentar; `lib/stock-context.ts`, `lib/outflow-details.ts` |
| **Reserva de brinde** | Quantidade prometida a um prêmio ainda não entregue. Aparece como "Reservado em brindes". | `reservation`, `entitlement` | `reservations`, `entitlements` | `pending-prizes` |
| **Empréstimo** | Saída temporária de um equipamento, com reserva, retirada e devolução. | `loan` (`status`: reservado, `out`, `returned`…) | `loans`, `documents` (termo do empréstimo) | módulo `loans`, `asset-details-panel` |
| **Dinâmica** | Ação com o público que distribui brindes, como a roleta do Rolê. A tela chama de "Dinâmicas"; o código chama de *campaign*, e às vezes de "evento" ou "ação". | **`campaign`** | `campaigns`, `campaign_sessions` (turnos), `campaign_planning`, `campaign_host_contexts` | módulo **`events`**, `lib/campaigns.ts`, `campaign-form`, `campaign-planning-panel` |
| **Participação** | Uma pessoa do público jogando a dinâmica. | `participation`, `attempt` | `participations`, `attempts`, `participant_accounts`, `public_participant_config` | `lib/participation.ts`, `lib/roulette.ts`, `/events`, `/participante` |
| **Demanda** | Tarefa da equipe, com prazo, prioridade e responsáveis. | **`followup_task`** (`task`) | `followup_tasks`, `followup_assignees`, `followup_history`, `followup_checklists`, `followup_task_transfers` | módulo `demands`, `lib/follow-up/`, `follow-up-panel` |
| **Conferência / checklist** | Contagem pós-evento ou lista de passos de uma atividade, ligada a uma demanda. | `checklist`, `activity checklist` | `followup_checklist*` | `activity-checklist` |
| **Responsabilidade** | Quem responde por uma área, material, empréstimo ou dinâmica. Não dá acesso. | `responsibility` | `work_responsibility_*` | `lib/responsibilities/`, `responsibility-manager` |
| **Meu trabalho** | Visão pessoal das demandas e responsabilidades de quem está logado. | `my-work` | (consulta) | módulo `my-work`, `lib/my-work/`, `meu-trabalho-panel` |
| **Registro** | Observação, ocorrência ou documento de um projeto, material ou empréstimo, com anexos. | `record`, `record_attachment` | `records`, `record_attachments` | módulo `records`, `lib/records.ts`, `records-panel` |
| **Histórico** | Linha do tempo. Existe em três lugares: ficha do material, Registros e a versão de cada demanda. | `history`, `audit` | `audit`, `entity_versions`, `followup_history` | `components/portal/history-timeline.tsx` (linha do tempo única), `activity-panel`, `lib/activity.ts` |
| **Agenda** | Datas de projetos, eventos e empréstimos, com feed para o Google Agenda. | `calendar` | `calendar_feeds`, `project_schedule_items` | módulo `calendar`, `lib/calendar.ts` |
| **Aviso / atenção** | Notificações e alertas de estoque baixo. | `notification`, `materialAttention` | `followup_notifications`, `followup_inbox_entries`, `material_attention_*` | sino, `material-attention-inbox` |
| **Planilha mestre / do projeto** | Cópia do portal no Google Sheets, sincronizada. | `sync`, `projectSheet`, `teamSheet` | `sync_*`, `project_sheet_*`, `team_sheet_*` | `lib/sync/`, `public/integracoes/*.gs` |
| **Rolê (assistente)** | Assistente de IA do portal. Não confundir com o projeto "Rolê da Extensão". | `roleAssistant`, `assistant` | `ai_*` | `lib/assistant/`, `role-assistant`, central de chaves |
| **Comunidade** | Mural, feedback e ouvidoria. | `community`, `ombuds` | `ombuds_reports`, `ombuds_messages`, `portal_feedback`, `personal_widget_settings` | módulo `community`, `lib/community/` |
| **Fixado** | Projeto ou equipe que a pessoa deixou à mão: vem primeiro em Projetos e aparece como subitem no menu lateral. Só a própria pessoa vê; a conta guarda apenas ids (até 12 de cada) e a anonimização apaga. | `pin`, `projectPins`, `teamPins` | `user_preferences` (0038) | `lib/preferences.ts`, `app/api/preferences`, `use-pinned-items.ts`, `portal-navigation.tsx` |

## Sinônimos que convivem hoje (e o nome oficial proposto)

| Conceito | Nomes em uso | Oficial proposto | Por quê |
|---|---|---|---|
| Dinâmica | tela "Dinâmicas"; módulo `events`; código `campaign`; textos "evento", "ação" | **Dinâmica** na tela; `campaign` no código (já está no banco) | Renomear a tabela é caro e arriscado. Basta alinhar o id do módulo (`events` → `campaigns`) e os textos. |
| Pessoas e acessos × Equipes | módulo `team` = Pessoas e acessos; módulo `work-teams` = Equipes | `access` para Pessoas e acessos; `teams` para Equipes | Hoje `team` não é "Equipe", e isso confunde pessoas e IAs. |
| Kit | "Brindes e kits", "opção", `offer` | **Kit** na tela; `offer` no código | Um nome só na tela. |
| Demanda | "Demanda", `followup_task`, `task`, "tarefa" | **Demanda** na tela; `task` no código novo | `followup` vem de uma fase antiga. |
| Material | "Material", `item`, "bem", "patrimônio" | **Material**; `item` no código; "patrimônio" só para equipamento com código de tombo | — |
| Movimentação | "Recebimento" na ficha / "Receber" na API (`receive`), "Distribuição" / `distribute`, "Uso pela equipe" / "Consumo interno" (`consume`) | Os textos da ficha | A mesma operação aparece com dois textos em telas diferentes. |
| Meu trabalho | `my-work` e `meu-trabalho-panel` | `my-work` | Arquivos em inglês, textos em português. |
| Rolê | projeto "Rolê da Extensão" e assistente "Rolê" | **assistente Rolê** sempre com "assistente" | Evita confusão em busca e relatório. |

## Nomes finais aprovados (Yan, 10/11/2026: "Sim, seguir todas")

Nomes de tela a usar em código novo e nas próximas PRs de consolidação. A troca nas telas antigas segue as fases do fim deste arquivo, a partir de 14/11.

| Hoje | Nome final | Observação |
|---|---|---|
| Histórico em vários lugares | **Histórico**, num componente único com filtro por assunto | As fichas ganham um atalho "Ver histórico" filtrado |
| "Linha do tempo" na ficha do projeto | **Cronograma** | Mostra datas futuras, não histórico |
| Pessoas e acessos | **Acessos** | Quem entra no portal e com qual papel |
| Equipes | **Equipes** | Só equipe de trabalho, sem dar acesso |
| Pré-cadastro + equipe publicada pela PROEX | **Diretório** | Pessoas conhecidas, com ou sem conta |
| Botões de baixar dados espalhados | **Exportar**, concentrado em Relatórios | Nas outras telas, um botão "Exportar" que abre Relatórios já filtrado. Implementado em ramo (R3); o que fica onde está em `docs/EXPORTACOES.md` |
| "Indicadores das dinâmicas" em Relatórios | sai | Repete o conjunto Dinâmicas da central. O resumo por dia virou o assunto **Dinâmicas por dia** |
| Painel "Responsáveis e demandas" no topo dos módulos | **Responsáveis** na ficha (do material, empréstimo, dinâmica ou projeto) | O responsável pela área inteira vai para a ficha do projeto, para não perder a função |
| Quatro formas de movimentar estoque | **Registrar movimento**: escolher o material e abrir a ficha, ou **Vários de uma vez** (saída conjunta) | Uma tela só, com corrigir, desfazer e anexos. Pronto em ramo; merge a partir de 14/11. Ver `REGISTRAR-MOVIMENTO-E-SAIDA-MULTIPLA.md` |
| "Assistente com revisão" + Rolê | **assistente Rolê** | O outro sai. Depois de 13/11 |
| Importação assistida | **Importar de arquivo** | Planilha, PDF ou SIGAA |

## Palavras com mais de um sentido (revisão geral de 09/11)

| Palavra | Sentidos que convivem | Como escrever daqui em diante |
|---|---|---|
| **Unidade** | Unidade acadêmica (FACE, EA) e unidade de controle do material (unidade, kit, pacote) | "Unidade" só para a acadêmica; "unidade de medida" para o material |
| **Reserva** | Reserva de equipamento (empréstimo) e quantidade reservada para prêmios ("Reservado em brindes") | "Reserva" no empréstimo; "reservado para prêmios" no estoque |
| **Retirada** | Retirada de equipamento e retirada de brinde (por código) | "Retirada do equipamento" e "entrega do brinde" |
| **Ação** | Tabela `activity_groups` sem tela; "ação" como dinâmica; "ação de extensão" no empréstimo | Evitar "ação" para a dinâmica; usar **Dinâmica** |
| **Destino** | Para onde o material foi ou está reservado (`material_destinations`) | "Destino" |
| **Pré-cadastro** | Pessoa ainda sem conta (`directory_people`) | "Pré-cadastro", dentro de um futuro "Diretório" |
| **Turno / sessão** | Período de uma dinâmica (`campaign_sessions`); a tela diz "sessão" em alguns botões | **Turno** |
| **Responsável** | Responsabilidade por uma área (`work_responsibility_*`) e responsável de uma demanda (`followup_assignees`) | "Responsável pela área" e "responsável pela demanda" |
| **Conferência** | Checklist pós-evento da demanda, "Conferir dados" do pré-cadastro, conferência antes de salvar um bem | "Conferência" só para o checklist pós-evento |
| **Linha do tempo** | Na ficha do projeto, mostra datas futuras | **Cronograma** |
| **Equipe** | Equipe de trabalho, "Equipe e convites" (acessos) na ficha do projeto, "equipe publicada pela PROEX" | "Equipe" só para equipe de trabalho |

## Mapa curto das pastas (`apps/proex-portal`)

| Pasta | O que tem |
|---|---|
| `app/` | Páginas e rotas. `portal-client.tsx` é a casca do painel e troca o módulo por `?module=`. `app/api/*/route.ts` são as rotas HTTP: cada uma confere origem, sessão e papel, e chama `lib/`. |
| `components/portal/` | Painéis e componentes de tela, um arquivo `.tsx` com o seu `.module.css`. A navegação fica em `navigation-model.ts`. |
| `components/ui/` | Peças genéricas de interface (shadcn). |
| `lib/` | Regras de negócio e SQL. `access.ts` (papéis), `errors.ts` (mensagens públicas), `rate-limit.ts`, `password-auth.ts` (Better Auth), uma pasta por domínio (`follow-up/`, `sync/`, `prize-tiers/`…). |
| `drizzle/` | Migrações SQL em ordem, já aplicadas. Não reescreva as publicadas (ver `AGENTS.md`). |
| `db/` | Esquema Drizzle (`auth-schema.ts` e outros). |
| `platform-node/` | Alvo Node (Vercel): SQLite em memória gravado como instantâneo no Supabase (`d1.ts`, `store.ts`). |
| `worker/`, `cloudflare/` | Alvo Cloudflare, mantido compatível. |
| `public/integracoes/` | Scripts do Google Apps Script (planilhas, avisos, backup). |
| `scripts/` | Build, QA local (`qa-local.mjs`), backup e utilitários de Vite. |
| `tests/` | Testes `node --test` (`*.test.mjs`), com SQLite e dados sintéticos. |
| `docs/` | Documentação técnica, entregas e auditorias. |

## Nomes de classe no inspetor

Desde 09/11/2026, as classes dos CSS Modules aparecem como `Arquivo_classe__hash`. Por exemplo, `MaterialDetailDrawer_tabs__3f9a1` vem da classe `.tabs` em `material-detail-drawer.module.css`. O hash tem 5 caracteres, é estável entre builds e separa arquivos com o mesmo nome. A configuração está em `scripts/vite/readable-class-names.mjs`.

Classes sem esse formato (`p-button`, `p-field`, `theme-switch`) são globais, de `app/globals.css`.

## Plano de consolidação de termos (depois do CONPEEX, a partir de 14/11)

Não faça renome em massa enquanto várias sessões editam o portal em paralelo. Cada fase é uma PR pequena, com testes.

1. **Textos de tela.** Alinhar só os rótulos visíveis à coluna "oficial proposto": Kit, os textos da movimentação e "assistente Rolê". Não toca em banco nem em API.
2. **Ids de módulo.** `events` → `campaigns`, `team` → `access` e `work-teams` → `teams`, mantendo os ids antigos como sinônimos na leitura de `?module=` para não quebrar links salvos.
3. **Código novo.** Funções e tipos novos usam `task` em vez de `followup`, e arquivos novos seguem kebab-case em inglês. Os antigos ficam até alguém mexer neles por outro motivo.
4. **Banco.** Só se houver ganho claro, com migração nova e testes de rollback. Renomear tabelas publicadas não está planejado.

Antes de cada fase, confira este glossário e atualize-o na mesma PR.
