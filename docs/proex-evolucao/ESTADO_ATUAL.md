# Estado atual da evolução PROEX

## V3 publicada

Atualização de 20/10/2026, na branch `feat/proex-portal`. **A publicação nativa da V3 foi confirmada com sucesso às 15:55:09 UTC**, versão 3. A V2 permanece documentada no histórico abaixo. Leia a [ADR 0003](ADRS/0003-identidade-e-operacao-v3.md), o [manual do portal](../../apps/proex-portal/README.md) e a [entrega V3](../ENTREGA-V3.md).

Portal: https://proex-gestao.yandiamantinobr.chatgpt.site. Fonte publicada no Sites: `db104886f98feebc1b83e30ad35d0390df556d3c`. Implantação: `appgdep_6ad78ec1db0c81919b6e4ef6588d8491`, revisão de ambiente 2. O commit público do GitHub é um registro separado dessa revisão de fonte; copiar arquivos ou abrir PR não substitui publicar o Worker e suas migrações.

### Implementação V3

- Entrada por **e-mail e senha com Better Auth**, sessões e credenciais no D1. Cadastro público aberto está desativado: novas contas são ativadas por convite controlado. Não há senha compartilhada da equipe nem envio automático de mensagens.
- O login nativo ChatGPT fica restrito à ponte explícita para definir a primeira senha de uma identidade já conhecida. Depois da migração, o acesso diário usa senha. IDs canônicos e aliases preservam vínculos, participações e histórico; e-mails iguais não unem contas automaticamente.
- Convites manuais têm prazo, uso único, destinatário e escopo. Repetir a mesma emissão recupera o mesmo link sem criar outro convite ou auditoria. Aceitos, revogados ou expirados não têm o token reemitido. O convite não comprova controle da caixa de e-mail.
- Perfil com nome, foto privada e alteração de senha. E-mail e permissões não são editáveis pelo perfil. A interface oferece galeria/câmera quando o aparelho permite; isso não constitui teste em câmera física.
- Diretório de usuários, bloqueio global de conta, funções por projeto e troca de função com histórico. As APIs verificam o estado atual da conta e dos vínculos; contas bloqueadas ou pendentes não autorizam convites. O último responsável ativo é protegido.
- Projetos e materiais têm campos editáveis e versão para detectar alterações simultâneas. A disponibilidade de equipamento considera empréstimos ainda retirados, inclusive vencidos; saldo físico e disponibilidade são informações diferentes.
- Registros operacionais e anexos privados complementam campanhas, estoque, empréstimos e relatórios. Agenda reúne dados autorizados por categoria e projeto, com exportação e assinatura ICS de leitura.
- A participação oficial e o estoque continuam decididos pelo servidor. Uma conta/evento compartilha o limite entre roleta, dado e presencial; tíquetes assistidos permanecem separados e não comprovam pessoas físicas únicas.

### Evidência disponível

Na verificação final informada pela implementação, **179 de 179 testes automatizados**, TypeScript e build do Worker passaram. O Worker compilado também passou por smoke de autenticação em Miniflare/workerd, com banco temporário e credenciais sintéticas. A publicação nativa tem a evidência separada acima; esses testes não equivalem à homologação com dados institucionais reais.

Houve revisão da interface desktop e em largura de 390 pixels, com fixtures locais. Não foi realizada captura por câmera real, teste em telefone físico nem homologação da V3 com estoque, termos ou participantes reais. O jogo livre manteve seus 12 arquivos de referência e passou pelos 33 testes da sua suíte.

### Integrações e próximos passos

Google Calendar pode consumir arquivo ou URL ICS **somente para leitura**. Não existe OAuth Google, escrita de volta no portal ou atualização imediata garantida. Revogar uma assinatura impede novas consultas; não apaga cópias já importadas por outro serviço.

Google Sheets continua restrito à importação manual de CSV. SMTP, envio de convites por e-mail, verificação Meta de seguidores, login WhatsApp e integração SEI/SIGAA não estão ativos. O perfil Instagram é um link opcional, sem condição de seguir para participar.

Após a publicação, a equipe deve conferir a entrada e o acesso autorizado com suas próprias contas, realizar o piloto e preencher a configuração institucional. Estoque real, ofertas, regulamentos, aviso de privacidade, retenção e fluxo para menores continuam sob decisão da PROEX. A roleta livre permanece independente; as automações antigas e a sincronização Windows não são reativadas por esta revisão.

## Histórico preservado — publicação V2

O registro abaixo descreve a entrega anterior e sua evidência. As referências a login ChatGPT e aos testes daquela versão não substituem a decisão V3 acima.

Atualizado em 20/10/2026. Branch: `feat/proex-portal`. Leia a [ADR 0002](ADRS/0002-portal-nativo-sites.md) e o [manual do portal](../../apps/proex-portal/README.md).

## Entrega operacional

Portal publicado: https://proex-gestao.yandiamantinobr.chatgpt.site

- Site novo, banco D1 e armazenamento R2 privado separados da roleta livre.
- Login ChatGPT, primeiro responsável vinculado à conta proprietária, convites por link, revogação e permissões por projeto.
- Painel responsivo: projetos, campanhas, materiais, ofertas compostas, estoque auditado, empréstimos com conflitos e anexos privados, equipe e relatórios CSV.
- Participação única por conta/evento entre roleta, dado e presencial; reservas e entrega única no servidor. Atendimento assistido sem conta com tíquete explicitamente separado. Retomada e cancelamento auditado de pendências.
- Política de repetição configurável de zero a três; regras preservadas após ativar. Rascunhos editáveis. Nenhuma regra de Super Super Brinde foi criada.
- Métricas por projeto/dia/campanha, sem fingir visitantes únicos ou seguidores verificados.

A versão livre continua no Site anterior e no Pages. Main permanece em `f905f0d78371dc4a8784cce27bdbc7ef6fa88103`; nenhuma alteração foi mesclada nela. Baseline de 12 arquivos preservado. A automação antiga continua desabilitada; sincronização Windows não foi reativada.

## Verificação

Portal: 50 testes reproduzíveis com SQLite real e migrações, TypeScript e build Worker passaram. Incluem concorrência, idempotência, saldo, isolamento de projetos, convites, último responsável, cancelamento e relatórios. Migrações aplicadas localmente e publicação nativa concluída. Revisão visual desktop e em iframe de 390 pixels, com dados locais de QA, sem login simulado na publicação. A versão hospedada respondeu HTTP 200 na entrada e 401 nos endpoints de gestão/exportação/anexos sem autenticação; a consulta de evento inexistente respondeu 404 pelo banco. Não houve teste em aparelho físico nem prova de login de visitante/entrega hospedada; a conta proprietária deve entrar pelo fluxo nativo normal.

Fundação/jogo livre: 33 testes e TypeScript passaram; proteção dos 12 arquivos passou novamente. O núcleo anterior em `lib/proex/access` permanece como trabalho independente; o runtime novo usa `apps/proex-portal/lib/access.ts`.

## Limites explícitos

Login Google/e-mail direto, envio automático de e-mails, verificação Meta de seguimento, sincronização automática Sheets, SEI/SIGAA e contribuições financeiras de alimentação não estão ativos. Não há credencial de instituição nesses serviços configurada para o portal. Consulte a ADR antes de retomar essas integrações.

A equipe precisa preencher saldos reais, ofertas, regulamentos e aviso de privacidade antes de ativar campanhas. Catálogo visual, Super Super Brinde, composição definitiva do planner, guarda dos dados e fluxo para menores continuam decisões institucionais. Produção não recebeu dados de demonstração nem histórico fabricado.

## Continuidade

Fonte publicada do portal: `e146d849e3f7ca87c471841a27f429b22c216905`, project_id `appgprj_6ad777bf0b288191a60d90401ac71d25`. O código público está em `apps/proex-portal`, sem histórico privado ou segredos. Validar código, escopos e regras; usar migrações novas; publicar no mesmo Site. Uma PR não substitui uma publicação verificada.
