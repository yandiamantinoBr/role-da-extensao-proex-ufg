# PROEX UFG Gestão e Rolê da Extensão

Portal para organizar projetos, equipe, eventos, materiais, participação no Rolê da Extensão e empréstimos. A interface prioriza o celular. O jogo livre existente continua independente, público e ilimitado em https://role-da-extensao-ufg.yandiamantinobr.chatgpt.site/ e em sua publicação GitHub Pages.

Este diretório contém a implementação V4 do portal. O [Manual de operação](docs/MANUAL-PROEX.md) reúne os fluxos para a equipe. A existência do código não comprova publicação nem validação de todos os fluxos. Consulte o registro de entrega e as verificações do PR para saber qual revisão foi efetivamente testada e publicada. Não há dados históricos ou saldos reais pré-preenchidos.

## Arquitetura desta implementação

**Duas hospedagens, um código.** O portal roda no ChatGPT Sites e também numa conta Cloudflare própria da PROEX, publicada pelo GitHub Actions (`.github/workflows/portal-deploy.yml`), com banco D1 e arquivos R2 independentes de conta pessoal. O passo a passo está em [Hospedagem própria](docs/HOSPEDAGEM-PROPRIA.md). Na hospedagem própria (`PROEX_STANDALONE=1`) o Worker descarta cabeçalhos de identidade do Sites e o primeiro responsável é criado em `/configuracao-inicial`, com `SETUP_TOKEN` e `OWNER_EMAIL`.

O portal usa o runtime do Sites, banco Cloudflare D1 e armazenamento privado Cloudflare R2. O login por e-mail e senha usa Better Auth, com sessões e credenciais no próprio D1. O manifesto `.openai/hosting.json` identifica o projeto do portal e declara os bindings lógicos `DB` e `BUCKET`. Ele deve ser preservado ao atualizar esse Site. O portal não usa o banco de outro projeto da PROEX ou do Kino Campus.

As tabelas `auth_*` guardam a autenticação; `portal_users`, `identity_aliases`, `profiles` e `members` guardam cadastro, vínculo de identidade, perfil e permissões do portal. O identificador canônico preserva o histórico anterior: o identificador novo do provedor de senha não substitui os responsáveis já gravados em participações, entregas, empréstimos ou auditoria. Igualdade de e-mail, sozinha, não vincula duas identidades nem concede privilégios.

O plano inicial discutia PostgreSQL gerenciado e autenticação externa como alternativas condicionais. PostgreSQL, Supabase e hospedagem externa continuam alternativas para uma migração deliberada; não estão configurados neste código. Uma migração exige adaptar SQL, restrições, transações, autenticação e arquivos, com novos testes. Não basta trocar uma variável de conexão.

A camada de serviços está em `lib/`; o esquema e suas migrações ficam em `db/` e `drizzle/`; rotas de API fazem autenticação e autorização no servidor. Os contratos são separados da apresentação, mas o adaptador D1 e os bindings ainda pertencem ao runtime atual. O snapshot previsto no repositório público ficará em `apps/proex-portal`, com implantação separada da roleta livre. Copiar o código para o GitHub não publica automaticamente este portal no Sites.

## Login, convites e primeiro responsável

A entrada habitual é em `/login`, com **e-mail e senha de uma conta previamente cadastrada e ativada**. Nome de usuário e CPF podem ser cadastrados pela própria pessoa como atalhos opcionais, usando a mesma senha; não constituem SSO institucional nem comprovação de identidade. O CPF não é exposto em relatórios ou planilhas: a busca usa HMAC com segredo do runtime. Alterar ou remover um atalho exige a senha atual e nova validação da conta ativa. Não há cadastro público livre. A página de login pode ser aberta sem autenticação; dados internos e operações exigem sessão válida e as permissões correspondentes. A participação oficial usa a mesma identidade canônica do cadastro, com um direito por conta e campanha.

As senhas têm de 12 a 128 caracteres. Better Auth armazena hashes scrypt com salt, não a senha em texto. A sessão usa cookie HttpOnly, Secure em HTTPS e validade de sete dias; o servidor consulta o banco, sem usar um perfil em cookie como substituto da autorização atual. A pessoa pode trocar a própria senha informando a atual. A troca renova a sessão corrente e encerra as anteriores; a recuperação encerra todas as sessões.

Para cadastros antigos, `/acesso-inicial` usa a identidade nativa do Sites **somente como comprovação explícita para vincular uma senha ao cadastro anterior**. É necessário possuir vínculo anterior ou ser o primeiro responsável configurado. Essa comprovação não substitui login por senha nas APIs do portal. Se já existir uma credencial para o mesmo e-mail, também é preciso comprovar a senha dela; não ocorre fusão automática por e-mail.

O segredo de runtime `OWNER_EMAIL` define o e-mail autorizado para o primeiro responsável institucional, comprovado pelo fluxo nativo anterior. Configure-o pelo controle de variáveis do Sites, fora do código e do manifesto. O bootstrap cria o vínculo inicial somente se nunca existiu um responsável global no banco; o histórico impede que mudar esse segredo ou entrar novamente ressuscite um vínculo revogado. Digitar esse e-mail em um cadastro por senha não concede o papel de responsável.

As configurações de autenticação precisam ser definidas no runtime:

| Variável | Finalidade |
| --- | --- |
| `BETTER_AUTH_URL` | Origem HTTPS oficial do portal, sem caminho, consulta ou fragmento |
| `BETTER_AUTH_SECRET` | Segredo aleatório de pelo menos 32 caracteres, mantido estável entre publicações |
| `OWNER_EMAIL` | Comprovação inicial do primeiro responsável pelo fluxo nativo, sem promoção por senha |

Na ausência de URL ou segredo válidos, o acesso por senha fica indisponível. Não há segredo padrão de produção. HTTP é permitido apenas em desenvolvimento explícito e para os hosts locais previstos. Não publicar valores dessas variáveis, tokens ou credenciais no README, GitHub, logs, fixtures ou capturas de tela. Não simular login inserindo cabeçalhos ou dados de usuário no cliente. Uma prévia local comum não reproduz automaticamente a comprovação nativa do Sites.

A tela de equipe emite **links de convite para copiar e compartilhar manualmente**. Nenhum e-mail ou mensagem é enviado automaticamente. O convite tem destinatário, função, escopo, validade de sete dias e aceite único. A pessoa abre `/convite`, informa o nome e define a senha; se já tiver credencial no portal, informa a senha atual. O servidor usa o destinatário e as permissões gravados no convite, sem aceitar uma função enviada pelo navegador. A ativação incompleta não permite login. A geração do link não concede acesso antes do aceite, nem dá permissão para editar código, publicar o Site ou acessar outros projetos.

Sem SMTP, o convite manual não comprova automaticamente controle da caixa de e-mail, e a conta não é marcada como e-mail verificado. O responsável deve conferir a pessoa e entregar o link pelo canal institucional adequado. Não há Google OAuth, login por WhatsApp, Facebook ou Instagram nesta revisão.

Se alguém esquecer a senha, o responsável institucional pode gerar um **link pessoal de recuperação**, válido por 30 minutos e de uso único, para compartilhar manualmente. O portal não envia esse link por e-mail. Solicitações públicas não podem emitir ou revelar links de recuperação. Não compartilhar senha nem guardar esses links em planilhas de uso geral.

## Papéis e escopos

| Papel | Operações principais |
| --- | --- |
| Responsável institucional | Configuração geral, projetos, acessos e operações institucionais |
| Gestor de projeto | Campanhas, equipe subordinada e operações no escopo concedido |
| Operador de evento | Atendimento presencial, registro da dinâmica e entrega autorizada |
| Responsável por estoque | Consulta, cadastro e movimentações de estoque permitidas |
| Responsável por empréstimos | Reservas, retirada, devolução e ocorrências |
| Leitor de relatórios | Indicadores e exportações agregadas do escopo autorizado |

Um vínculo pode se limitar a um projeto. As capacidades são verificadas novamente nas APIs e nos downloads; esconder um menu não é a proteção. A revogação de um vínculo impede novas operações quando a requisição seguinte consulta o banco, inclusive de uma sessão que já estava aberta. Convites usados e vínculos são registros diferentes: revogar um convite pendente não é a mesma operação que revogar o vínculo de alguém que já entrou.

O diretório de usuários permite consultar os cadastros visíveis ao gestor e alterar funções permitidas no escopo existente, preservando os vínculos anteriores como histórico. Um responsável institucional pode bloquear ou reativar uma conta: o bloqueio impede acesso e revoga as sessões por senha. A aplicação protege o último responsável ativo e não permite bloquear a própria conta. O papel técnico `user` de Better Auth não corresponde a nenhum papel administrativo da PROEX; os privilégios vêm de `members`.

O responsável global não é concedido pelo formulário comum de convite. Recuperação ou sucessão desse papel exige procedimento institucional e manutenção autorizada, sem apagar histórico para contornar o bootstrap. A operação diária não exige compartilhar a conta do responsável.

## Perfil, celular e aparência

Em Meu perfil, cada pessoa pode alterar o nome de exibição e os campos opcionais de unidade, cargo/função e telefone, escolher uma foto na galeria ou solicitar a câmera do aparelho, além de trocar a senha. O e-mail de login não é editável por esse formulário. A interface prepara a foto em PNG com até 512 pixels no maior lado; o servidor limita a imagem preparada a 2 MB e armazena o arquivo no R2 privado. A foto não se torna um endereço público de armazenamento.

Os controles de câmera usam a seleção de arquivos do navegador. A oferta da câmera e os formatos que o aparelho consegue abrir dependem do navegador e do sistema; quando necessário, é possível selecionar uma imagem ou arquivo já salvo. A interface não depende da instalação de um aplicativo. Os dados confirmados ficam no servidor e podem ser consultados em outro aparelho após login; não há edição offline com sincronização posterior.

O seletor oferece tema claro, escuro e preferência do sistema nas páginas de entrada, painel e participação. A preferência fica no próprio navegador; não há sincronização de tema entre aparelhos. As variações da marca preservam contraste com o fundo.

## Solicitações de privacidade

A própria pessoa pode solicitar anonimização, com confirmação da senha. A equipe analisa antes de executar. O processo remove dados de conta, identificadores de entrada, credenciais e foto; preserva contagens, histórico operacional e auditoria com identificador interno. Textos, termos e anexos de terceiros não são apagados automaticamente. A limpeza de objetos pode ficar pendente até confirmação; a conta anonimizada tem tombstone e não pode ser reativada nem receber dados pessoais por materialização do diretório. O último responsável ativo continua protegido. Esse fluxo não substitui a política institucional de tratamento e retenção.

## Projetos e registros operacionais

Os projetos organizam o escopo da equipe, dos materiais e das ações. Cada projeto tem **abrangência**: interno (conduzido pela equipe PROEX) ou externo (unidade acadêmica, órgão ou parceiro apoiado pela PROEX). A abrangência organiza a lista e a planilha; o acesso continua sendo concedido por projeto na Equipe, de modo que um bolsista de um projeto externo vê apenas aquele projeto. O cadastro reúne nome, identificação curta, descrição, cor, endereço oficial, local, período, situação e etapa no catálogo: em atividade, passado ou referência. Tipos de iniciativa são configuráveis pelo responsável. Um programa/projeto superior organiza o catálogo, sem herdar privilégios; ciclos são recusados, inclusive em alterações concorrentes. Cada material pertence a um projeto e a uma classe operacional: brinde, equipamento retornável, distribuição institucional ou consumo. Categorias de apresentação são administráveis sem substituir essas regras operacionais.

Acessar projeto abre um detalhe interno com fontes, links, editais, cronologia, relações e versões. Editar busca a revisão atual; o servidor aplica CAS e recusa sobrescrita concorrente. As versões de projeto, edital, link e atividade preservam metadados; restaurar cria outra revisão e revalida as regras atuais. Não reverte estoque, sorteios, arquivos ou empréstimos. Editais compartilhados exigem administração de todos os projetos envolvidos para alterar seus vínculos.

O catálogo de referência em `lib/catalog/proex-2026.json` foi pesquisado em fontes institucionais em 23/10/2026. Ele separa programas atuais, referências de gestões anteriores, projetos, congresso e programa de fomento. Pré-cadastro é uma operação autorizada, idempotente e feita pelos serviços de domínio: preserva registros encontrados e só cria itens ausentes com estoque zero. Não importa a cronologia editorial como execução operacional nem fabrica empréstimos, participações, entregas, saldo ou resultados. A ausência num índice atual não comprova encerramento. As fontes oficiais e ressalvas estão no JSON e no manual.

Os registros permitem documentar observações, manutenção, distribuição, consumo, atividade de projeto, material ou empréstimo. Têm projeto, título, descrição e data da ocorrência; podem ter período e vínculo com um material ou empréstimo do mesmo projeto. Fotos e PDFs de até 10 MB podem ser anexados, com leitura e download conforme as permissões do registro. Um registro de consumo ou distribuição é documentação operacional: ele não baixa estoque nem cria empréstimo sozinho. Essas operações continuam pelos movimentos e reservas próprios de cada módulo.

## Agenda e Google Calendar

A agenda reúne informações do portal por **Empréstimos, Materiais, Projetos e eventos, e Consumo**, com filtro de período e projeto. A disponibilidade de um equipamento continua sendo validada no banco, independentemente do que outro aplicativo mostrar.

É possível baixar um arquivo ICS ou criar uma assinatura de leitura por categoria e escopo. A URL privada de assinatura é exibida na criação, tem validade de um ano e pode ser revogada no painel. Quem obtiver esse link pode consultar os eventos incluídos nele; guarde-o como uma credencial. O servidor verifica novamente as permissões e a situação da conta a cada consulta; bloqueio, revogação ou perda de acesso impedem novas leituras.

Para usar no Google Calendar, adicione a URL em **Outras agendas → + → Do URL**, pelo computador; depois a agenda pode aparecer no aplicativo móvel da mesma conta. Consulte as [instruções oficiais do Google Agenda](https://support.google.com/calendar/answer/37100?hl=pt-BR). Trata-se de assinatura ICS de leitura: o Google decide quando buscar atualizações. Não há atualização imediata garantida, envio por OAuth nem edição do portal a partir do Calendar. Importar um arquivo ICS cria uma cópia daquele momento; assinar a URL permite consultas posteriores. Revogar um link impede novas consultas, mas não apaga cópias que já tenham sido importadas ou mantidas pelo serviço externo.

## Preparar a primeira ação do Rolê

1. Configure o responsável, entre no painel e cadastre o projeto com o nome oficial.
2. Conte os materiais físicos. Cadastre os itens e suas unidades, começando com saldo zero; registre as entradas conferidas. Não usar números ilustrativos como estoque real.
3. Crie uma oferta de **Brinde** e uma de **Super Brinde**, cada uma com sua composição e quantidade de itens. Um conjunto de três buttons consome três unidades; um kit planner precisa ter unidade e composição decididas pela equipe. O catálogo detalhado não é exposto ao participante nesta entrega.
4. Cadastre a campanha com nome, local, início, fim, regulamento, ofertas e política explícita para Tente novamente. Uma campanha começa como rascunho.
5. Publique, na configuração institucional, o aviso de privacidade aplicável. A instituição define finalidade, base legal, responsáveis, retenção e canal de atendimento. Um texto genérico de consentimento não substitui essas definições.
6. Ative a campanha quando regras, ofertas, período e aviso estiverem completos e houver cobertura de estoque. Compartilhe a página `/events/<id>` gerada para aquela campanha.
7. Convide a equipe com a função e o projeto necessários. Verifique o acesso de cada perfil antes de usar dados e brindes reais.

O sistema não cria estoque, regras ou dados de 2025 a partir do relatório narrativo. Buttons, planners, canetas, sacochilas e outros materiais precisam de cadastro e conferência. A classificação Super Super Brinde e a possibilidade de arriscar um prêmio não estão implementadas.

## Participação oficial e atendimento presencial

A roleta e o dado digitais compartilham **uma participação por conta e campanha**. A campanha oficial exige cadastro ativo no portal; a versão livre permanece pública e ilimitada. O servidor define e grava cada resultado antes da animação; a página apenas o apresenta. Atualizar ou reabrir recupera o registro, sem conceder nova chance. A escolha da modalidade fica vinculada à primeira participação.

A opção presencial usa o mesmo direito da conta quando a pessoa reserva seu atendimento na página do evento. Uma tentativa pendente gera comprovante para mostrar à equipe; ela não realiza um sorteio digital. A equipe observa a face real, conclui o registro e confirma a entrega quando houver prêmio. Não realizar o lançamento físico antes de a reserva ser confirmada.

O atendimento assistido da equipe também pode emitir tíquete para quem não utiliza conta ou celular. Esse controle é por tíquete, com identificação diferente da conta. A equipe deve impedir atendimento duplicado entre os dois caminhos; o sistema não comprova uma pessoa física única nem impede alguém de manter várias contas. Tíquetes e contas aparecem separados nos indicadores.

### Chances e repetição

As seis faces têm chances iguais: três Brinde, uma Super Brinde, uma Tente novamente e uma Não foi dessa vez. Portanto, Brinde corresponde a 3/6; cada outra categoria, a 1/6. A modalidade digital sorteia no servidor. No presencial, registra-se o resultado observado.

O gestor precisa escolher de **zero a três repetições** para a face Tente novamente. Zero significa nenhuma repetição; três permitem, no máximo, quatro lançamentos na mesma participação. Se o limite já foi atingido e sair essa face, o registro fica como `retry_exhausted`: a participação termina sem outra chance. Esse estado não é uma sétima face. A política precisa constar claramente no regulamento; uma configuração indefinida impede a ativação.

Duração e som alteram somente a apresentação. Não concedem novas tentativas nem mudam probabilidades. A ciência das regras e do aviso é separada de divulgação futura ou autorização de uso de imagem. Para público infantil e adolescente, o fluxo e os dados necessários exigem avaliação institucional específica; uma conta de login não prova idade ou responsabilidade parental.

## Estoque e entrega

Categoria de resultado, oferta e item físico são registros distintos. Um direito ao prêmio reserva os itens; a confirmação da retirada baixa as unidades reais. O código opaco do comprovante permite uma única entrega. Requisições repetidas recuperam ou respeitam a operação já registrada, sem outra baixa.

A reserva é **conservadora**: cada tentativa precisa ter cobertura para as duas ofertas possíveis de prêmio antes da sua autorização. Isso evita prometer o último Super Brinde a duas pessoas. Depois do resultado, a cobertura não usada é liberada e a correspondente ao prêmio permanece reservada. Essa garantia pode impedir uma tentativa mesmo se ainda houver algum item físico disponível isoladamente.

Uma tentativa física pendente mantém a cobertura, pois o lançamento pode já ter acontecido. Ela não é liberada automaticamente por tempo ou fechamento da tela. Pendências precisam de conclusão e conferência pela equipe. Se o atendimento foi abandonado antes do lançamento, o cancelamento manual com motivo encerra a participação e libera a cobertura; ele não cria outra chance. Não refazer um sorteio por falta de material, reduzir probabilidades silenciosamente ou registrar entrega sem o retorno do servidor.

Entradas, distribuição institucional, consumo e ajustes têm movimentos e motivo. Equipamentos retornáveis usam empréstimo. Distribuições e doações de materiais não são receitas financeiras; eventuais informações operacionais de destino não são incluídas nas exportações agregadas. Rateios, contribuições pessoais para alimentação, PIX, cobrança e contabilidade não fazem parte deste portal.

## Empréstimos e anexos

Cadastre cada equipamento como um bem individual. Reservas consideram intervalos e estado; conflitos são bloqueados no banco. Equipamento retirado e não devolvido permanece indisponível após a data prevista. Manutenção e avaria precisam ser registradas antes de novo uso. O portal apoia a operação, sem substituir por si só termos e autorizações oficiais no SEI/SIGAA.

Fotos e PDFs dos termos são objetos privados em R2, associados ao empréstimo e ao projeto. Downloads passam por autorização no servidor. A API aceita PDF, JPEG, PNG ou WebP até 10 MB, com verificações de conteúdo e extensão. Upload de um termo não constitui assinatura eletrônica certificada. Não anexar documentos reais em testes nem publicar termos ou assinaturas no GitHub.

## Indicadores e planilhas

**Conector da planilha.** A planilha Google fica ligada ao portal pelo conector Apps Script (`public/integracoes/proex-planilha.gs`, também baixável em Configurações). Ele roda na conta Google de quem instala, exporta as tabelas do formato portátil, importa edições das colunas editáveis e da aba Operações com controle de versão, registra conflitos e copia fotos e termos para uma pasta privada do Drive. A autenticação usa uma chave de sincronização (`pxs_…`) criada e revogada pelo responsável institucional; o portal guarda só o hash e revalida o papel a cada chamada. Detalhes em [Sincronização](docs/SINCRONIZACAO.md). `scripts/apps-script-harness.mjs` executa o próprio arquivo `.gs` contra um portal local com uma planilha simulada.

O painel separa participações, tentativas, modalidades, tíquetes, premiações, entregas e unidades físicas. Um prêmio composto por três buttons é uma premiação e três unidades; uma repetição autorizada não é outra pessoa. Acessos registrados não são visitantes únicos.

As exportações CSV de participação, estoque e empréstimos respeitam os projetos autorizados. Elas não incluem e-mail, identificador da conta, contato do solicitante, termos ou observações pessoais. São projeções para gestão, não cópia integral do banco. Dados inseridos em campos livres ainda exigem cuidado da equipe. O agrupamento operacional atual usa horário de Brasília, UTC−03, para o período atendido pela implementação.

A V4 disponibiliza formato portátil, paginação por digest, recibos de idempotência, controle de execuções e importação pelos serviços de domínio. Metadados editáveis usam versão CAS; operações de estoque são append-only. Campos calculados, resultados e permissões não são editáveis diretamente. Cabeçalhos, `_rowKey`, `_rowHash`, versões e nomes técnicos das abas precisam ser preservados.

**Configuração do Drive/Sheets não comprova sincronização verificada.** Salvar IDs, criar uma planilha ou registrar uma solicitação não executa sozinho uma rotina conectada. A conclusão exige leitura de retorno de todas as abas declaradas e ausência de conflitos abertos. O estado deve ser conferido pelo histórico de execuções, não pelo sucesso de configuração ou criação de uma automação. As conexões do autor no chat não se tornam credenciais permanentes dos visitantes. Uma pasta de anexos não comprova cópia dos objetos R2; exportações portáteis não são backup integral de credenciais e arquivos privados. CSV continua disponível para uso manual. Leia o [manual](docs/MANUAL-PROEX.md) antes de operar a planilha.

O endereço do Instagram é configurável e opcional. Abrir ou seguir o perfil não é condição de participação neste fluxo. Não há OAuth Instagram, consulta de seguidores ou métrica de novos seguidores atribuídos ao Rolê. Uma integração Meta futura exige validação técnica, de política e institucional; não usar scraping ou senha dos participantes.

## Desenvolvimento e publicação

Execute os comandos a partir deste diretório, inclusive quando estiver dentro de `apps/proex-portal` no repositório. Preserve o lockfile e use as versões do projeto.

```sh
pnpm install --frozen-lockfile
pnpm db:migrate:local          # banco local em .wrangler/state
pnpm exec tsc --noEmit --incremental false
pnpm test
pnpm run build
# Depois do build: autenticação no Worker compilado, com D1/R2 temporários.
node --import ./scripts/sites-env.mjs tests/password-auth-worker-smoke.mjs
```

No ambiente Work gerenciado, use o supervisor e o fluxo da skill Sites para prévia, preparação de fonte e publicação. Em desenvolvimento standalone, `pnpm dev` inicia a aplicação; esse servidor não cria contas nem permissões administrativas por conta própria. Configure as variáveis de autenticação e mantenha os dados locais separados. Fixtures sintéticas de teste não devem ser copiadas para a base hospedada.

As versões de Better Auth e do adaptador Drizzle estão fixadas no manifesto e no lockfile. Atualizações exigem revisar as notas de segurança, respeitar a política de maturidade das dependências e testar novamente login, cookies, vínculo canônico, convites, bloqueio e recuperação. `tests/password-auth.test.mjs` usa Better Auth real, Drizzle D1 e SQLite com as migrações reais; ele também verifica disputas de ativação e resgate único de recuperação. O smoke após o build executa o Worker compilado em Miniflare/workerd, criando seus próprios bancos temporários e credenciais sintéticas, sem acessar a base local compartilhada ou a hospedada. Essas verificações complementam a validação nos navegadores utilizados pela equipe.

O Sites provisiona os bindings declarados e aplica as migrações hospedadas no fluxo de publicação. O esquema está em `db/schema.ts`; após mudanças deliberadas, gere e revise as novas migrações com `pnpm run db:generate`, mantendo SQL e metadados no GitHub. Migrações já aplicadas são imutáveis. Não criar ou alterar tabelas durante requisições do aplicativo.

Para a base **local**, faça um build para gerar a configuração Wrangler e aplique cada arquivo SQL ainda pendente, em ordem. O comando abaixo é um exemplo; substitua o nome pelo arquivo correto e nunca reaplique um já executado:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/<migracao_pendente>.sql
```

Banco local e banco hospedado são separados. Esse comando não publica nem atualiza dados de produção. Não versionar `.dev.vars`, `.env`, `.wrangler/state`, saídas de build, tokens ou bases de teste. Arquivos privados e dados operacionais ficam fora do repositório.

## Pendências antes da operação institucional

- Conferir estoque real, composição dos kits, ofertas, regulamento e responsáveis de cada evento.
- Validar aviso, base de tratamento, fluxo para menores, canal de direitos, retenção, backups e recuperação com a instituição.
- Confirmar a titularidade e a administração dos recursos, incluindo sucessão e suporte da equipe.
- Fazer piloto integrado com os perfis reais autorizados, preservando dados de teste separados e registrando a evidência de cada verificação.
- Se necessário, configurar SMTP institucional e um fluxo de verificação de e-mail e entrega automática de convites/recuperação; a revisão atual usa links compartilhados manualmente.
- Confirmar uma execução completa de sincronização externa com leitura de retorno antes de anunciá-la como ativa; configuração, código e planilha preparada são evidências distintas.
- Avaliar separadamente Google OAuth, integração Meta, catálogo público e migração para outros serviços. Nenhum item deve ser anunciado como ativo sem implementação e verificação.
