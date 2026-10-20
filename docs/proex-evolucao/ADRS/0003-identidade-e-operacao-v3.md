# ADR 0003 — Identidade por senha e operação V3

Data: 20/10/2026. Estado: **implementada e publicada**, versão 3, com sucesso confirmado às 15:55:09 UTC. Fonte publicada no Sites: `db104886f98feebc1b83e30ad35d0390df556d3c`. Implantação: `appgdep_6ad78ec1db0c81919b6e4ef6588d8491`, revisão de ambiente 2.

Esta decisão sucede a [ADR 0002](0002-portal-nativo-sites.md) na autenticação cotidiana e amplia a operação do portal. Mantém a separação do jogo livre, o Site dedicado, o D1 e o R2. As ADRs anteriores permanecem como histórico; não documentam OAuth, SMTP ou PostgreSQL ativos na V3.

## Contexto e identidade

A equipe precisa de contas individuais, perfis editáveis, controle de usuários e navegação móvel. Depender de uma conta ChatGPT no acesso diário não atende ao fluxo escolhido para essa evolução. Trocar IDs pelo identificador de outro provedor, porém, perderia vínculos, auditoria e a restrição de uma participação por conta/evento.

Usar Better Auth e adaptador Drizzle fixados em `1.7.7`, com credenciais e sessões no D1, para entrada por **e-mail e senha**. Cadastro público aberto está desativado. O aplicativo expõe o ciclo de sessão e os fluxos de senha autorizados; endpoints administrativos genéricos do provedor não concedem permissões PROEX.

Novas contas são ativadas por convite controlado. O destinatário escolhe a senha e recebe os vínculos previstos no convite. Credencial e concessão de acesso são etapas distintas: a conta pendente não ganha acesso operacional antes de concluir a ativação. As transações preservam o vínculo canônico sob concorrência e impedem ativar a conta errada.

`portal_users` representa a conta canônica; `identity_aliases` associa o identificador do provedor; `profiles` guarda nome e referência privada da foto. `members` continua definindo funções por projeto. Papéis do mecanismo de autenticação, campos editáveis do perfil ou um e-mail coincidente não são fontes de autorização administrativa.

Para identidades anteriores, a ponte explícita com login nativo prova o vínculo e permite definir a primeira senha preservando o ID existente. O acesso nativo não é alternativa silenciosa à senha nem método cotidiano da V3. Não se unem contas por e-mail, não se apagam participações para liberar outra chance e não se reescreve auditoria para trocar de provedor.

O bootstrap histórico `OWNER_EMAIL` fica limitado ao primeiro responsável comprovado pela identidade nativa, antes de existir esse responsável no histórico. Um cadastro por senha com o mesmo e-mail não cria administrador. Trocar a configuração não restaura vínculo revogado.

## Convites, recuperação e sessões

Convites têm destinatário, função, escopo, prazo e uso único. O link é entregue manualmente pelo responsável; não há SMTP. O token bruto não é persistido. A emissão idempotente usa HMAC com segredo do servidor para recuperar o mesmo link da mesma operação; convite, hash, chave de operação e auditoria são confirmados no mesmo batch. Pedido com outros dados não reutiliza a operação. Links aceitos, revogados ou expirados não são reemitidos pelo replay.

Recuperação de senha também depende de fluxo autorizado para gerar link privado, sem envio automático de mensagem. O responsável confere a pessoa e o canal usado. Um convite manual não comprova controle da caixa de e-mail; a conta não recebe uma afirmação fictícia de e-mail verificado.

Sessões usam cookies protegidos e consulta atual da identidade. Bloqueio, ativação e vínculos são verificados no servidor. Revogar vínculo de um projeto é diferente de bloquear a conta em todos. Mudanças de função preservam o vínculo anterior. O último responsável ativo não pode ser perdido por bloqueio, revogação ou rebaixamento. Emissor bloqueado ou pendente não mantém seus convites aceitáveis apenas porque sua linha de vínculo ainda existe.

## Operação, perfil e dados

Projetos passam a ter identificação curta, situação, cor, URL, período, local e versão. Materiais têm identificação patrimonial, condição, versão e atualização. Empréstimos registram retirada, devolução e condição por etapa. Equipamento ainda retirado permanece indisponível após o prazo previsto; saldo físico não significa disponibilidade para novo uso.

O snapshot inclui permissões gerais e por projeto, diretório autorizado e perfil atual. O responsável pode materializar metadados de legados a partir de vínculos existentes no banco. Esse processo não cria aliases, não une e-mails, não concede funções e preserva bloqueios, ativação pendente e perfis editados.

O titular pode alterar nome e foto; e-mail e função não fazem parte desse formulário. A imagem preparada é PNG, validada e processada no servidor, armazenada no R2 privado e entregue por rota autorizada. Galeria/câmera dependem do aparelho e de suas permissões. A revisão visual com fixtures não comprova captura por câmera física.

Registros operacionais e anexos privados complementam estoque, campanhas e empréstimos, com autorização por recurso/projeto, limites, concorrência e auditoria. A participação oficial continua com resultado gravado antes da animação, reserva de brindes e entrega única. Atendimento assistido por tíquete é separado de conta autenticada e não garante pessoa física única.

## Agenda e integrações

A agenda projeta dados autorizados por categoria e projeto. Oferece download ICS e assinatura privada **somente de leitura**, com escopo, validade e revogação. A projeção não é cópia integral dos registros nem autorização para acessar contatos, termos, notas privadas ou outros projetos. A privacidade das categorias e dos campos deve permanecer coberta por testes.

Google Calendar pode consumir o ICS como cliente externo. Não existe OAuth Google, escrita automática na conta Google, edição de volta no portal ou atualização imediata garantida. Revogar URL impede novas consultas; não remove cópias já baixadas ou importadas pelo cliente.

SMTP, sincronização automática Sheets, verificação Meta de seguidores, login WhatsApp e SEI/SIGAA continuam fora da configuração ativa. CSV pode ser importado manualmente em planilha. Instagram permanece link opcional, sem follow-gate ou contagem comprovada de seguidores. Uma conexão de ferramenta no chat não se torna infraestrutura permanente para os visitantes.

## Infraestrutura e publicação

O Worker permanece no Site dedicado `appgprj_6ad777bf0b288191a60d90401ac71d25`, em https://proex-gestao.yandiamantinobr.chatgpt.site, separado da roleta livre. `DB` é o binding D1 e `BUCKET` o R2 privado. `BETTER_AUTH_URL` e `BETTER_AUTH_SECRET` são configurados no servidor; valores de segredo não pertencem ao GitHub, ao cliente ou à documentação.

A V3 acrescenta 0002/0003 às migrações 0000/0001 da V2, com alterações aditivas que preservam os triggers e registros anteriores. SQL aplicado não deve ser reescrito. Bancos temporários de teste e fixtures de interface não são dados para importar na produção.

`apps/proex-portal` recebe a fonte versionada sem histórico privado ou artefatos de runtime. O commit público do GitHub é um registro separado da revisão publicada no Sites. Novas entregas devem identificar fonte, versão/status de implantação e migrações; endereço do portal, commit ou PR isolados não provam atualização hospedada.

## Verificação e limites

A verificação final informada para a entrega inclui **179/179 testes aprovados**, TypeScript e build, além de smoke do Worker compilado em Miniflare/workerd com D1 temporário e credenciais sintéticas. A interface foi inspecionada em desktop e largura de 390 pixels, com fixtures. O jogo livre preservou 12 arquivos de referência e passou em seus 33 testes.

Não se declara teste em telefone físico, captura por câmera real ou homologação da V3 com estoque, termos e participantes institucionais. A publicação bem-sucedida não substitui o piloto da equipe. Estoque real, regulamentos, aviso de privacidade, retenção, backups e fluxo para menores exigem validação institucional. Não há regra inventada de Super Super Brinde nem módulo financeiro de contribuições pessoais.

A autenticação acrescenta manutenção de dependências, recuperação e segredos. Portabilidade para PostgreSQL ou outra hospedagem exige adaptar SQL, transações, identidade, arquivos e testes; não é uma troca de variável de conexão. A V3 não contrata nem presume gratuidade de serviços externos. Consulte a [entrega V3](../../ENTREGA-V3.md) para a evidência consolidada.
