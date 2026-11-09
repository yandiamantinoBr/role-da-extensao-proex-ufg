# Comunidade · fase 1 (migração 0036)

Módulo **Comunidade** e widgets pessoais do Início. A especificação de produto, as premissas e as perguntas em aberto ficam na Vault (`Portal PROEX - Comunidade (especificação)`). Este arquivo registra o comportamento do código.

## O que entrou

| Parte | Onde | Quem usa |
|---|---|---|
| Widgets pessoais (anotações, lembretes, atalho do Rolê) | `lib/community/widgets.ts`, `/api/community/widgets`, `components/portal/personal-widgets.tsx` | Toda pessoa com vínculo interno ativo |
| Caixa de retorno (sugestão, problema, elogio; plataforma, projeto ou evento) | `lib/feedback.ts`, `/api/feedback`, `components/portal/community-feedback.tsx` | Envia: vínculo interno. Gerencia: `access.manage` no projeto; plataforma: responsável geral |
| Ouvidoria anônima | `lib/community/ombuds.ts`, `/api/community/ombuds`, `components/portal/community-ombuds.tsx` | Envia e acompanha: vínculo interno. Lê e responde: responsável geral |

O botão "Sugestão ou problema" do rodapé abre a Comunidade já preenchida com a área e o projeto da tela atual. O formulário antigo (`feedback-panel.tsx`) só aparece para quem não vê o módulo.

## Widgets

- Desligados por padrão. Com tudo desligado, o Início mostra uma linha discreta com "Ativar widgets".
- Só a própria pessoa lê: toda consulta filtra por `user_id` da sessão; não existe tela de gestão nem linha de auditoria com o texto.
- Limites: 30 anotações, 50 lembretes abertos, 500 caracteres. Lembrete tem data opcional e hora opcional (24 h, só com data). "Atrasado" e "Hoje" usam o dia do servidor (Brasília).
- O atalho do Rolê clica no botão flutuante existente (`button[aria-keyshortcuts="Alt+R"]`). Se esse atributo mudar em `role-assistant.tsx`, atualize `ROLE_LAUNCHER` em `personal-widgets.tsx`.
- A anonimização da conta apaga `personal_notes` e `personal_widget_settings`.

## Retorno

- `portal_feedback` foi recriada para aceitar `praise`, `campaign_id` (evento) e a resposta da gestão (`response`, `responded_by`, `responded_at`). Linhas antigas foram copiadas com identificador, datas e estados.
- O projeto de um evento vem sempre da campanha gravada. Projeto informado diferente do projeto do evento é recusado.
- A gestão vê o nome de quem enviou. Quem responde fica na auditoria (`feedback.respond`).

## Ouvidoria: por que é anônima

O anonimato vem do que **não é gravado**:

- `ombuds_reports` e `ombuds_messages` não têm coluna de autoria, projeto, organização nem instante. Guardam só o dia (`AAAA-MM-DD`, Brasília).
- As tabelas são `WITHOUT ROWID` com identificador aleatório; a ordem física não revela a ordem de chegada.
- O código de acompanhamento (`OUV-` + 20 símbolos Crockford, 100 bits) é gerado no navegador. O servidor guarda só `SHA-256("proex-ouvidoria:v1:" + código)`. O código viaja no corpo do POST, nunca na URL.
- As ações de quem relata (`submit`, `track`, `reply`) leem a sessão com `getPortalUser({ refresh: false })`: confirmam o vínculo interno e não renovam a sessão, para não gravar nada da conta naquele momento. Não gravam auditoria, `mutation_keys` nem contador de limite por pessoa.
- Limites coletivos: 40 relatos novos por dia no portal, 10 mensagens de quem relata por relato por dia e 200 mensagens de acompanhamento por dia no portal. Há também um freio por pessoa (5 envios por hora) guardado **só na memória do processo**: não é gravado, some ao reiniciar e não vale entre instâncias.
- A leitura `GET /api/community` (abrir a Comunidade) também não renova a sessão.
- O texto das anotações pessoais não entra na impressão de idempotência (`mutation_keys`), que sobrevive à anotação.
- O formulário não usa rascunho local, não fica no `localStorage` e não passa pelo Rolê.
- As respostas da ouvidoria são auditadas com o identificador de quem respondeu (`ombuds.respond`, `ombuds.status`).

Riscos que o código não elimina (revisão independente de 09/11):

- **Quem administra a hospedagem e o banco** pode cruzar o registro de pedidos da Vercel (hora, rede, navegador) com `auth_session` (que guarda IP e navegador do login) e estimar o autor. O instantâneo atual guarda `updated_at`; o histórico guarda uma cópia na primeira gravação depois de 6 horas, que pode coincidir com o relato; um gatilho no Postgres ou PITR também guardariam versões. A tela diz que o anonimato vale para quem lê pelo portal, não contra quem administra a infraestrutura.
- O texto pode identificar quem escreveu; equipes muito pequenas reduzem o anonimato.
- Pendência para a frente de segurança: avaliar desligar o registro de IP e navegador nas sessões do Better Auth (`advanced.ipAddress.disableIpTracking` e user-agent), pesando o efeito no limite de tentativas de login. A longo prazo, um token cego emitido fora do momento do envio desligaria conta e relato.

## Testes

`tests/community.test.mjs` cobre: formato do código; nenhuma linha nova da ouvidoria contém identificador, e-mail ou nome de quem escreveu; ausência de auditoria, chave de repetição e contador por pessoa; colunas proibidas; acompanhamento, repetição idempotente e código reutilizado; admissão só de vínculo interno, inclusive revogação dentro do lote; caixa só do responsável geral; resposta auditada sem dados de quem relatou; relato encerrado; limites coletivos; rota com CSRF, cabeçalhos privados e sessão sem renovação; widgets privados, limites e validação; anonimização; retorno de evento roteado à gestão certa e resposta visível a quem enviou.
