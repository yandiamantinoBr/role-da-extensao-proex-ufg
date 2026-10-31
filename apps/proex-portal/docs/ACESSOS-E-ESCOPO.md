# Acessos e escopo — incremento V10

O modelo posterior de organizações independentes está em [Organizações e isolamento — R04/V11](ORGANIZACOES-E-ISOLAMENTO.md). Este registro preserva o comportamento da V10 anterior à migração 0008.

Implementação local iniciada em 31/10/2026 sobre a V9 (`441649a`). Não cria provedor de login, organização independente ou cadastro público. Publicação e situação dos provedores devem ser conferidas no registro de entrega integrado.

## O que a autorização significa hoje

Uma conta identifica a pessoa; um vínculo em `members` define a função e os projetos em que ela pode atuar. O domínio do e-mail e os campos de perfil (estudante, bolsista, servidor, unidade) não concedem poderes. Uma pessoa externa pode receber convite, com o mesmo controle de projeto e função aplicado a qualquer destinatário.

`organizational_units` é o catálogo de unidades UFG e parceiros usado nos perfis e filtros. Ele não é uma fronteira de segurança. `members.project_id=NULL` significa **portal inteiro**, incluindo projetos futuros; não significa apenas uma unidade do catálogo. Mudar a unidade do perfil ou do projeto não cria nem transfere vínculos.

| Função existente | Pode fazer, no escopo concedido | Não concede |
| --- | --- | --- |
| Responsável (`owner`) | Administração geral, projetos, equipe, operação, relatórios e sincronização | Acesso a outros sistemas ou credenciais de provedores |
| Gestor (`manager`) | Editar metadados do projeto; campanhas, materiais, empréstimos, relatórios e convites subordinados | Criar projeto/tipo global, unidades, configurações gerais, recuperação de conta ou sincronização |
| Operador (`operator`) | Atendimento presencial e entrega de prêmio | Gerenciar equipe, estoque ou empréstimos |
| Materiais (`inventory`) | Ler e gerenciar catálogo e estoque | Gerenciar equipe, empréstimos ou configurações |
| Empréstimos (`loans`) | Ler empréstimos, reservar e registrar retirada/devolução | Gerenciar equipe, estoque ou configurações |
| Leitor (`viewer`) | Consultar relatórios e informações de projeto autorizadas | Alterar operações, equipe ou configurações |
| Conta sem vínculo interno | Participar de uma campanha pública disponível, com conta ativa | Painel interno, projetos, equipe ou relatórios |

O responsável é global no esquema atual. Gestor e demais funções normalmente recebem um projeto específico; vínculos globais antigos continuam válidos e devem ser revisados pela administração. Um gestor de projeto só pode convidar, alterar ou revogar funções subordinadas no próprio projeto; não pode conceder gestor, responsável ou escopo global. O responsável não é convidável pelo fluxo comum.

## Convites com o menor escopo por padrão

O formulário seleciona o projeto atual ou o único projeto disponível. Havendo vários projetos sem seleção atual, exige uma escolha. O alcance “Portal inteiro” fica separado das opções de projeto e aparece apenas à administração geral.

Para emitir um convite global, o responsável precisa selecionar esse alcance e marcar a confirmação de todos os projetos, inclusive futuros. Essa confirmação não tem `name` e não entra no rascunho automático. A API exige `projectId: null` e `globalAccess: true` (booleano); ausência, texto `"true"`, número ou `false` não autorizam esse alcance. A confirmação não substitui o teste de responsável atual no SQL. Convites por projeto continuam exigindo o identificador do projeto.

Convites preservam destinatário, função, validade de sete dias, uso único, hash do token e recibos de repetição. O envio permanece manual. Um link de convite não comprova automaticamente controle da caixa de e-mail. Pessoas com credencial existente precisam provar a senha para ativar o vínculo.

## Revalidação durante a gravação

`capabilityBatch` deriva os papéis autorizados da mesma matriz usada por `requireCapability`. Uma asserção SQL no início do lote verifica vínculo não revogado, escopo do projeto e conta ativa, sem ativação pendente ou anonimização. A asserção e os efeitos de domínio/auditoria compartilham a transação. As consultas legadas sem linha de `portal_users` preservam o comportamento de compatibilidade existente; contas novas usam o cadastro canônico ativo.

Campanhas, configurações, atendimento presencial e entrega de prêmio usam essa barreira. Revogação ou bloqueio entre a primeira verificação e o lote resulta em HTTP 403, sem campanha, reserva, movimento de estoque ou auditoria parcial. Replays administrativos também conferem o vínculo atual. O sorteio público usa conta canônica ativa, sem exigir função interna; verifica a conta antes de recuperar um resultado e novamente dentro do lote que grava a tentativa.

O alvo Node/Vercel força `PROEX_STANDALONE=1` no adaptador. Nesse modo, `getChatGPTUser` devolve `null` antes de ler cabeçalhos `oai-authenticated-*`. Identidade nativa continua restrita à alternativa Sites. Sheets/MCP continuam exigindo responsável geral dentro dos serviços; um cabeçalho, célula ou lista de capacidades do cliente não concede esse papel.

## Próxima entrega: organizações independentes e entrada institucional

Organizações independentes precisam de entidade própria, associação explícita de projetos e vínculos por organização, além de restrições SQL que impeçam referências cruzadas. A organização deve vir da sessão e do recurso armazenado, com validação no servidor; nunca de um filtro ou campo livre do navegador. Um administrador de organização deve administrar apenas a própria organização. O catálogo UFG permanece separado desse modelo.

Também será necessário decidir a migração dos vínculos globais existentes, a administração excepcional do portal e o escopo de planilhas, tokens, anexos e relatórios por organização. Não reutilizar `unit_id` como substituto e não executar migração de produção antes do backup e da revisão da entrega. Nenhuma migração foi criada neste incremento.

Para facilitar a entrada institucional, o próximo fluxo deve comprovar identidade por provedor institucional configurado ou por convite seguro e, depois, resolver os vínculos autorizados. Conta institucional não deve nascer como responsável, gestor ou membro de todos os projetos. Autenticação e concessão de acesso são etapas distintas. Cadastro público para participantes continua como requisito separado.

## Verificação

Os testes usam os módulos reais, migrações SQLite reais e dados sintéticos. Cobrem convites globais explícitos, destinatários institucionais/externos, revogação/bloqueio/ativação pendente/anonimização antes do lote e preservação de concorrência e idempotência. A matriz de escopo inclui todos os seis relatórios, três CSVs, downloads privados, agenda JSON/ICS e criação de assinatura.

Execute em `apps/proex-portal`, com o pnpm fixado:

```sh
npx --yes pnpm@11.25.0 check:types
npx --yes pnpm@11.25.0 lint
npx --yes pnpm@11.25.0 test
npx --yes pnpm@11.25.0 build
npx --yes pnpm@11.25.0 build:node
```

Registre os resultados e o commit integrado na entrega. Testes isolados de HTTP substituem a identidade somente na fronteira de transporte; não comprovam login ou disponibilidade de produção. A revisão visual e autenticada deve incluir o convite por projeto, a confirmação global e a restauração do rascunho sem confirmar alcance global automaticamente.

Resultado local em 31/10/2026, branch `v10-acessos`: **360/360 testes** em Node 26.12.1 e 24.22.1; tipos sem erros nos dois runtimes; lint completo sem erros e com os quatro avisos anteriores; builds Worker e Node concluídos; smoke do Worker compilado passou para autenticação, API e MCP. As regressões novas somam 39 testes sobre a V9. Nenhum servidor foi mantido aberto e nenhum dado ou provedor real foi alterado. A conferência visual do formulário de convite permanece para a integração.
