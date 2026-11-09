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

- **Quem administra a hospedagem** pode cruzar o registro de pedidos da Vercel (hora, rede, navegador) com outros acessos e estimar o autor. O instantâneo atual guarda `updated_at`; o histórico guarda uma cópia na primeira gravação depois de 6 horas, que pode coincidir com o relato; um gatilho no Postgres ou PITR também guardariam versões. A tela diz que o anonimato vale para quem lê pelo portal, não contra quem administra a infraestrutura.
- O texto pode identificar quem escreveu; equipes muito pequenas reduzem o anonimato.
- Resolvido pela frente de segurança na PR #52: um gancho do Better Auth grava `ip_address` e `user_agent` vazios em `auth_session` (o limitador de login continua usando o IP em baldes próprios, com hash e sem ligação com a conta). Sessões abertas antes daquele deploy guardam os valores até expirar (no máximo 7 dias). Os registros da Vercel continuam existindo. A longo prazo, um token cego emitido fora do momento do envio desligaria conta e relato.

## Testes

`tests/community.test.mjs` cobre: formato do código; nenhuma linha nova da ouvidoria contém identificador, e-mail ou nome de quem escreveu; ausência de auditoria, chave de repetição e contador por pessoa; colunas proibidas; acompanhamento, repetição idempotente e código reutilizado; admissão só de vínculo interno, inclusive revogação dentro do lote; caixa só do responsável geral; resposta auditada sem dados de quem relatou; relato encerrado; limites coletivos; rota com CSRF, cabeçalhos privados e sessão sem renovação; widgets privados, limites e validação; anonimização; retorno de evento roteado à gestão certa e resposta visível a quem enviou.

# Comunidade · fase 2 (migração 0037)

## Recados

- Mensagem direta entre pessoas ativas da mesma organização (`lib/community/messages.ts`, `/api/community/messages`), desde que uma delas tenha acesso à organização inteira ou que as duas dividam um projeto. Quem trabalha em um só projeto não alcança a organização inteira, como no resto do portal. O responsável geral pode escrever a qualquer pessoa, mas **não lê** recados alheios pelo portal: não existe rota de leitura para a gestão. O backup completo (baixado pela administração) contém o banco inteiro; por isso, quando os dois lados ocultam um recado, ele é apagado de verdade.
- A lista de pessoas mostra só nomes, nunca e-mails. Até 1.000 caracteres, 60 recados por dia por pessoa.
- Cada lado pode ocultar a própria cópia. O bloqueio vale nos dois sentidos; recados de bloqueados somem da caixa e não contam como não lidos. Bloquear responde igual para contas inexistentes (até 500 bloqueios por pessoa).
- Texto recusa controles de direção (bidi) que disfarçam o conteúdo. O limite diário é de 60 recados em 24 horas corridas.
- Nem o texto nem o destinatário entram na impressão de idempotência (`mutation_keys`). Sem linha de auditoria. A anonimização apaga recados enviados e recebidos, bloqueios, preferências e selos.
- Não lidos aparecem na aba "Recados". Ainda não entram no sino nem geram e-mail: a fila do MailApp é presa às demandas (`followup_email_queue.task_id NOT NULL`, com consentimento e cotas próprias); estender exige revisão do fluxo de avisos. Fica como próximo passo.

## Selos (arte provisória)

- Calculados a partir do que já existe, sem contar volume (`lib/community/badges.ts`): "Fechou o que abriu" (demanda atribuída concluída), "Retorno que ajudou" (sugestão ou problema resolvido), "Reconheceu alguém" (elogio enviado) e "Mão na massa" (movimentação de material registrada).
- No máximo um de cada por semana (semana de segunda a domingo, Brasília). Só contam ações em dias úteis, das 7h às 20h. O nível sobe a cada 3 selos (máximo 10). Uma leitura repetida não grava nada; só o selo recém-conquistado é registrado.
- Só a própria pessoa vê. Pode desligar (nada é calculado) ou pausar até uma data nos próximos 120 dias; ao retomar no meio da semana, só contam ações a partir do dia seguinte ao fim da pausa.
- Limite conhecido: "Fechou o que abriu" e "Retorno que ajudou" usam a data da última alteração da demanda ou do retorno; editar algo já concluído pode render o selo em outra semana (no máximo um por semana). "Retorno que ajudou" não filtra horário, porque quem resolve é a gestão.
- Marcadores provisórios: formas simples com a inicial e o aviso "Arte provisória". Trocar pelas peças da comunicação quando chegarem.

## Testes da fase 2

`tests/community-phase2.test.mjs`: recados só entre quem compartilha a organização, só nomes, leitura só por quem recebeu, ocultar por pessoa, bloqueio, revogação dentro do lote, repetição idempotente, teto diário; selos só em horário útil de dias úteis, um por tipo por semana, nível, leitura repetida sem gravação, desligar e pausar sem cálculo, ninguém vê selos de outra pessoa, anonimização.

O smoke do Worker reabre o D1 local depois de migração com `SELECT` solto (guarda da 0028), que travava `DROP TABLE` no Miniflare.

# Comunidade · fase 3 (migração 0040)

Premissas combinadas com a sessão coordenadora em 2026-11-09, para avançar sem esperar o Yan (fáceis de trocar; listadas também na aba "Espaço e premissas", visível à administração geral):

1. **Armazenamento (opção A):** imagens no mesmo armazenamento privado das fotos de materiais (tabela de objetos no Postgres). Todo acesso passa por `lib/community/media-store.ts` (`MediaStore`); para usar Supabase Storage com bucket privado, troque só `chatMediaStore()`.
2. **Onde se conversa:** uma conversa por projeto (quem lê o projeto) e conversas diretas com o mesmo alcance dos recados. Nada entre organizações.
3. Demais pontos seguem as premissas da especificação na Vault.

## Chat

- `lib/community/chat.ts`, rotas `/api/community/chat` (lista, mensagens, abrir, enviar, ler, apagar), `/api/community/chat/media` (envio de imagem) e `/api/community/chat/media/[id]` (leitura), tela `components/portal/community-chat.tsx`.
- **Ler nunca grava.** A tela consulta novas mensagens a cada 8 segundos só com a página visível; marcar como lido é um pedido explícito, feito só quando há mensagem nova de outra pessoa. Isso evita regravar o instantâneo do banco a cada consulta.
- Texto até 2.000 caracteres, com emoji; 300 mensagens por pessoa em 24 h. Cada pessoa apaga as próprias mensagens (a imagem é removida do armazenamento na hora).
- **Imagens:** o navegador reduz para até 1.600 px e recodifica (WebP ou JPEG), o que remove EXIF/GPS e mantém a orientação. O servidor confere o tipo real pelos primeiros bytes (JPEG, PNG, WebP; recusa GIF e HEIC) e **recusa** imagem com EXIF/XMP. Até 1,5 MB por arquivo, 20 por pessoa em 24 h e 150 MB ativos por organização. Servidas só a quem lê a conversa, com `nosniff`, `sandbox` e cache privado de 1 hora.
- **Prazo de 180 dias:** depois disso a imagem deixa de ser servida e é removida em lotes de 10, a cada envio de imagem. A mensagem mostra "Foto removida após 180 dias".
- A anonimização apaga o texto das mensagens da pessoa, agenda a remoção das imagens dela (`private_object_deletions`) e limpa leituras e fila de e-mail.

## Espaço do banco

- `GET /api/community/storage` (só administração geral) e aba "Espaço e premissas". Na Vercel + Supabase mede `pg_database_size` e o tamanho das tabelas do instantâneo, do histórico (60 dias) e dos objetos, por funções de catálogo somente leitura (`platform-node/store.ts`, `usage()`). Alerta a partir de 70% de 500 MB. Em outro ambiente mostra "não informado", nunca zero.

## Aviso de recado por e-mail

- Mesmo canal dos avisos de demanda (MailApp, credencial `pne_`, configuração, consentimento, cotas e intervalo), com fila própria `community_email_queue` (ids `cm-…`) em `lib/community/message-email.ts`. A rota `/api/follow-up/email` encaminha `begin`, `ack`, `recover` e `reconcile` pelo prefixo do id.
- O e-mail diz só "Você recebeu um recado no Portal PROEX" e o link `/?module=community&tab=messages`: sem conteúdo, sem remetente.
- Vale quando a pessoa já ligou os avisos por e-mail (em Demandas) **e** não desligou o interruptor "Avisar por e-mail quando eu receber um recado", em Recados (ligado por padrão). Não sai se o recado já foi lido, ocultado, se houver bloqueio ou se as pessoas deixaram de se alcançar.
- **Passo necessário na conta Google:** o script `public/integracoes/proex-notificacoes.gs` foi atualizado para aceitar o modelo de recado e pedir esse tipo no `dispatch.claim` (`kinds`). Enquanto o projeto Apps Script de avisos não receber a versão nova, ele continua enviando só avisos de demanda (o servidor não oferece recados a um script que não os pede).

## Testes da fase 3

`tests/community-phase3.test.mjs` (chat do projeto e direto, ler sem gravar, bloqueio, imagens com tipo real e sem metadados, limites, acesso, apagar, prazo, espaço só para a administração, anonimização, e-mail de recado sem conteúdo com consentimento, interruptor, leitura e bloqueio) e um caso novo em `tests/follow-up-email-apps-script.test.mjs` (modelo de recado aceito; variações recusadas).

## Quem lê a ouvidoria (designações, 0040)

Resposta do Yan em 2026-11-09 (Decisões): "pode ser alguém designado pela Proex também, mas a princípio... é a administração geral e as pessoas que têm acesso total... designar melhor isso".

- Lê por padrão: responsável ou gestor ativo **sem restrição de projeto**, no portal inteiro ou na organização PROEX (`org_proex`; a migração 0008 coloca nela os vínculos sem projeto de quem não é responsável). Premissa para "acesso total"; trocar em `PORTAL_WIDE_READER` (`lib/community/ombuds.ts`).
- A administração geral (responsável global) designa pessoas com início, fim e motivo (`ombuds_designations`), e revoga com motivo. Cada designação e revogação fica na tabela e na auditoria (`ombuds.designate`, `ombuds.designation.revoke`); o histórico só aparece para a administração geral.
- Um designado lê entre as datas, enquanto a conta e algum vínculo estiverem ativos; revogado ou fora do prazo, deixa de ler.
- Antes de escrever, a pessoa vê "Quem pode ler os relatos agora" (só nomes e se é acesso total ou designação até tal data). Ninguém que lê, inclusive designados, vê o autor: não há autor gravado.

## Correções após a revisão de segurança da fase 3

- Lista de conversas diretas respeita bloqueio e alcance (apelidos próprios na consulta de acesso); chat de projeto arquivado fecha.
- Aviso de recado: no máximo um aviso pendente por pessoa até ela ler; cotas próprias de recados (um terço da cota diária da organização; 2 por pessoa por dia), além das compartilhadas, para não consumir os avisos de demanda.
- Imagens: largura e altura lidas do cabeçalho; mais de 1.600 px de um lado é recusado. A linha é gravada antes do objeto; se o armazenamento falhar, a linha fica apagada (sem arquivo órfão). A limpeza só marca como apagada depois de remover o arquivo e roda também a cada mensagem enviada. Cache da imagem: 60 s. O corpo do envio é lido com teto, mesmo se o cabeçalho de tamanho mentir.
- Leitor de objetos local (`platform-node/env.ts`, `ObjectBucket.arrayBuffer`) pode devolver um buffer maior que o objeto no armazenamento em disco; o chat lê pelo `body`. Observação para quem mantém a plataforma.

Limites conhecidos: a limpeza dos 180 dias depende de uso (envios de imagem ou mensagem), não de uma rotina agendada; a consulta a cada 8 s traz só mensagens novas (uma mensagem apagada some para os outros ao reabrir a conversa); a caixa de enviados da conta Google que manda os avisos registra quem recebeu aviso e quando.
