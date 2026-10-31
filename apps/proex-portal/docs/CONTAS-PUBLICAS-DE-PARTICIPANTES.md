# Conta pública de participante — R16/A05 e R03

Etapa local na branch `v14-acesso-publico`, sobre `b98a5d1`, em 31/10/2026. **Desligada por padrão. Não comprova abertura do cadastro, configuração de provedor, envio real ou fechamento da A05 em produção.** `portal-client.tsx`, Google, provedores e produção não foram alterados nesta etapa.

## Fronteira de acesso

Uma conta participante tem identidade canônica, e-mail comprovado, senha e sessão Better Auth, além de um marcador em `participant_accounts`. Não ganha linha em `members`, função de equipe, organização, projeto, relatório, arquivo, agenda ou integração. Domínio institucional, nome, cargo e dados enviados pelo cliente não atribuem autoridade.

O login existente também atende a conta participante. Ao abrir a raiz sem vínculos de equipe, a pessoa é encaminhada para `/participante`; o snapshot interno é negado. A conta participante sem vínculo não pode consultar o catálogo de unidades. O diretório descritivo anterior continua disponível às identidades admitidas legadas que não sejam contas públicas, preservando o contrato do perfil. Organizações/relatórios retornam escopo vazio ou negado conforme o contrato existente; nenhum dado de outro usuário ou catálogo privado é retornado.

`/participante` mostra apenas o nome/e-mail da própria conta e até 20 participações próprias em ações publicadas. A entrada em um evento continua pelo link/QR code da equipe. A página não descobre organizações ou eventos privados.

Convites institucionais/externos e recuperação administrativa permanecem nos fluxos anteriores. A recuperação pública só atua sobre uma conta marcada como participante que **nunca teve qualquer vínculo em `members`**, incluindo vínculos revogados. Se ela passar a integrar a equipe, a recuperação deve seguir o responsável; a senha atual e os recursos pessoais existentes continuam sujeitos às proteções anteriores. Bloqueio, reativação, anonimização e revogação de sessões usam os mecanismos existentes, preservando identidade e histórico.

## Prontidão e abertura explícita

`0012_v14_public_participants.sql` é nova e aditiva. Não depende das migrações 0009/0010/0011 de outras frentes. Cria somente configuração, marcador participante e desafios de e-mail; não altera concessões ou credenciais existentes. A configuração inicial mantém `enabled=0`.

Para abrir o cadastro, a administração da plataforma precisa:

1. Informar e confirmar o aviso institucional aprovado para a coleta pública.
2. Se houver critérios oficiais de participação definidos, informá-los e confirmar sua aprovação. Em branco, não há requisito adicional de elegibilidade. O fluxo não coleta idade, data de nascimento ou CPF e não inventa política da UFG.
3. Configurar a infraestrutura dedicada abaixo, usando valores apenas no gerenciador de segredos do provedor.
4. Conferir o domínio pela API oficial do provedor: status verificado, envio habilitado, domínio igual ao remetente e rastreamento de abertura/cliques desativado. Não existe campo para declarar manualmente que o domínio está verificado.
5. Marcar explicitamente a abertura e salvar com a versão atual.

| Nome de configuração | Uso no servidor |
| --- | --- |
| `PUBLIC_PARTICIPANT_EMAIL_PROVIDER` | Adaptador `resend` |
| `PUBLIC_PARTICIPANT_EMAIL_API_KEY` | Chave dedicada para envio e conferência do domínio; nunca recebida pela interface |
| `PUBLIC_PARTICIPANT_EMAIL_FROM` | Endereço simples do remetente no domínio verificado |
| `PUBLIC_PARTICIPANT_EMAIL_DOMAIN_ID` | Identificador do domínio no provedor |
| `BETTER_AUTH_URL` | Origem HTTPS canônica; links não usam host ou redirecionamento arbitrário do pedido |
| `BETTER_AUTH_SECRET` | Segurança existente da autenticação e hash com chave dos limites por e-mail |

A chave precisa autorizar `GET /domains/:id` e `POST /emails`; uma chave restrita apenas ao envio pode falhar na conferência, mantendo o modo fechado. Use credencial/conta dedicada e confira o escopo no provedor antes de abrir o serviço. Não foi criada ou consultada nenhuma credencial real nesta entrega.

A comprovação é vinculada ao hash da configuração do remetente/chave/origem e vale por 24 horas. Rotação da chave, mudança da origem/remetente, expiração, aviso não aprovado ou falta de infraestrutura fecha o fluxo efetivo. A interface administrativa mostra os requisitos pendentes; a pública informa indisponibilidade e orienta o atendimento assistido. Leituras públicas não consultam o provedor nem gravam visitas. Revalidar o domínio é uma ação administrativa somente de leitura no provedor, sem e-mail de teste.

Salvar configuração não envia mensagens. Não há disparo em lote, cron de e-mail ou uso de MCP de mensagens. O adaptador só é chamado pelo pedido explícito de cadastro/recuperação no formulário público. Configurações versionadas, inclusive nova conferência do domínio, invalidam links pendentes emitidos na versão anterior.

## Prova, senha, privacidade e limites

O pedido público exige mesma origem, JSON, `X-Proex-Action: 1`, aviso aceito e confirmação dos critérios apenas quando definidos. Conta de equipe, endereço ocupado, conta bloqueada e recuperação de endereço ausente recebem o mesmo envelope genérico `202`; o resultado do provedor, existência da conta e tokens não são devolvidos. Há um piso temporal de melhor esforço de 1,8 segundo, sem alegação de tempo constante absoluto entre serviços externos.

O link contém 32 bytes aleatórios em fragmento `#token=…`, sem token na query ou GET do servidor. O cliente remove o fragmento imediatamente; conserva o valor só em memória para os POSTs de inspeção/conclusão. Não há log, storage ou rascunho do token/senha. O banco guarda o hash SHA-256, finalidade, prazo de 15 minutos, versão/aceites e estado de uso. Abrir/inspecionar o link não o consome; só a conclusão válida o consome.

`provider_accepted_at` significa apenas que o provedor aceitou a requisição e retornou um ID. Não é confirmação de entrega, leitura ou ausência de bounce; não há webhook de entrega nesta etapa. A interface apresenta resposta condicional e não afirma que a mensagem foi entregue.

O batch SQLite revalida desafio, prazo, versão habilitada e elegibilidade atual da conta. Consome a prova junto com credencial Better Auth, identidade canônica, alias, perfil mínimo e marcador participante. Recuperação altera somente a credencial correspondente e apaga todas as suas sessões no mesmo lote. O hash de senha vem do `hashPassword` exportado pelo Better Auth 1.7.7 já fixado no repositório; não há algoritmo próprio. As gravações explícitas usam o schema existente para conservar atomicidade no D1, que não oferece transação interativa para encadear `createUser` e os vínculos. Login, cookie, sessão, validação da senha e revogação continuam no SDK real, exercitados pelos testes. Uma atualização futura do SDK/schema precisa repetir esses testes.

As sessões autorizadas desta base estão em `auth_session`: não há tabela `portal_session` ou storage secundário de sessão. `cookieCache` permanece desativado e o resolvedor solicita `disableCookieCache: true` em cada consulta. O teste de recuperação cria dois cookies/sessões simultâneos e confirma, pelo SDK e resolvedor canônico reais, que ambos deixam de autenticar após a recuperação.

O e-mail temporário do desafio é apagado no consumo. Desafios expirados são limpos em lotes limitados quando chegam pedidos posteriores; não há promessa de expurgo com servidor sem tráfego. A retenção institucional dos dados de conta/participação continua dependendo da política e do fluxo de privacidade existentes. Não há campos adicionais de idade/CPF/telefone neste cadastro.

Limites persistidos: 100 pedidos/hora no total, 20/hora por IP reconhecido pela plataforma, três/15 minutos por endereço com hash com chave e **50 tentativas de envio/dia** no total, incluindo falhas do provedor. Prova tem limites globais, por IP e por hash. O corpo público é limitado a 4 KiB e a configuração a 12 KiB; respostas do provedor a 32 KiB. O host da API é fixo, sem redirecionamento externo, com prazo de rede. Estes limites mitigam abuso e custo; não constituem prova de humanidade nem garantia de entrega.

## Contrato de integração

- `GET /api/participants`: disponibilidade e textos aprovados, sem configuração secreta.
- `POST /api/participants`: `request`, `inspect`, `complete`; campos desconhecidos ou tentativa de incluir função/projeto/e-mail de destino na conclusão são rejeitados.
- `GET /api/participants?self=1`: conta/participações próprias, com sessão canônica.
- `GET/POST /api/participants/admin`: administração atual da plataforma, CSRF, rate limit e CAS. Ações `configure` e `verifySender`.
- `PublicParticipantsSettingsPanel({ canManage, onChanged? })`: componente isolado para o coordenador montar na configuração; `canManage` deve vir de capacidade global de administração. O servidor revalida o vínculo dentro do lote.
- `/participante/acesso`, `/participante/confirmar`, `/participante`: telas separadas do painel interno. Login e evento distinguem equipe convidada e público consumidor de ações. `ParticipantEntryLink` consulta a disponibilidade somente com leitura.

O coordenador precisa montar o painel administrativo em `portal-client.tsx` e combinar as mudanças de `app/page.tsx`, login/evento, plataforma, participação, schema e journal com as outras frentes. Preserve o vínculo de organização e os novos campos/controles existentes na revisão integrada.

## Evidência local e gates

Os testes usam SQLite migrado, Better Auth/Drizzle/scrypt reais, resolvedor de sessão e APIs reais. Somente bindings/identidade de transporte, e-mail externo e o relógio do envelope são isolados. Há cobertura de cadastro sem grants, prova/TTL/replay, recuperação e sessões antigas, conta de equipe e estados bloqueado/pendente/anonimizado, CAS/perda de autoridade, antienumeração, CSRF/payload, concorrência da participação, bloqueio/reativação e cem leituras públicas sem gravação ou requisição ao provedor.

A suíte completa passou em 427/427 casos no Node 24.22.1. Tipos passaram e lint terminou com zero erros e quatro avisos anteriores. Os builds Worker/Node e o smoke compilado passaram; o smoke também confirma, com a migração real no Worker, que o modo inicial está fechado, o pedido retorna 503 e não cria desafio sem prontidão. O coordenador realizou revisão independente de leitura e repetiu os 17 casos novos com SDK/SQLite reais, todos aprovados e sem bloqueador identificado nesta árvore.

CUA conferiu a fixture React local da porta 5174, com mensagens falsas, em iframes de 375/414 px sem alterar o viewport global do Chrome. Foi observado modo desligado sem formulário; depois somente a fixture foi aberta com texto sintético, seguida de pedido, comprovação com fragmento removido, criação, login real do SDK, página própria sem catálogo e saída. A largura observada não excedeu o conteúdo; na confirmação os inputs estavam dentro da tela e o botão medido tinha 44 px. Evidência sintética ignorada pelo Git: `.sites-runtime/public-participant-cua-mobile.png`. A aba e a fixture foram encerradas. Nenhum e-mail real, teste pago, chave real, dado de produção ou aba do usuário foi usado nesse fluxo.

Antes de abrir em produção: conferir o SHA final e checks da integração; backup/restauração e integração das migrações; montagem administrativa; verificação CUA do build integrado; aviso institucional aprovado; configuração/escopo real do provedor e domínio conferido por responsável; decisão explícita de abrir. A revisão independente local foi concluída, sem substituir esses gates operacionais. **A05 permanece pendente em produção enquanto o modo estiver desligado.**

## Fontes primárias consultadas

- [Resend: consultar domínio](https://resend.com/docs/api-reference/domains/get-domain) — status, capacidades e rastreamento.
- [Resend: enviar e-mail](https://resend.com/docs/api-reference/emails/send-email) — envio HTTP e chave de idempotência.
- [Better Auth: e-mail e senha](https://better-auth.com/docs/authentication/email-password) — senha na conta credential, hash e revogação de sessões.
- Código e tipos do Better Auth 1.7.7 instalado, `db/auth-schema.ts`, resolvedor canônico e testes do repositório.
