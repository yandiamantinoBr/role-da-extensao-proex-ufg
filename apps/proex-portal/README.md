# PROEX UFG Gestão e Rolê da Extensão

Portal para organizar projetos, equipe, eventos, materiais, participação no Rolê da Extensão e empréstimos. A interface prioriza o celular. O jogo livre existente continua independente, público e ilimitado em https://role-da-extensao-ufg.yandiamantinobr.chatgpt.site/ e em sua publicação GitHub Pages.

Este diretório contém a implementação do portal. A existência do código não comprova publicação nem validação de todos os fluxos. Consulte o registro de entrega e as verificações do PR para saber qual revisão foi efetivamente testada e publicada. Não há dados históricos ou saldos reais pré-preenchidos.

## Arquitetura desta implementação

O portal usa o runtime nativo do Sites, banco Cloudflare D1 e armazenamento privado Cloudflare R2. O manifesto `.openai/hosting.json` identifica o projeto do portal e declara os bindings lógicos `DB` e `BUCKET`. Ele deve ser preservado ao atualizar esse Site. O portal não usa o banco de outro projeto da PROEX ou do Kino Campus.

O plano inicial discutia PostgreSQL gerenciado e autenticação externa como alternativas condicionais. A implementação atual adota persistência e identidade nativas do Sites para integrar os recursos disponíveis. PostgreSQL, Supabase e hospedagem externa continuam alternativas para uma migração deliberada; não estão configurados neste código. Uma migração exige adaptar SQL, restrições, transações, autenticação e arquivos, com novos testes. Não basta trocar uma variável de conexão.

A camada de serviços está em `lib/`; o esquema e suas migrações ficam em `db/` e `drizzle/`; rotas de API fazem autenticação e autorização no servidor. Os contratos são separados da apresentação, mas o adaptador D1 e os bindings ainda pertencem ao runtime atual. O snapshot previsto no repositório público ficará em `apps/proex-portal`, com implantação separada da roleta livre. Copiar o código para o GitHub não publica automaticamente este portal no Sites.

## Login e primeiro responsável

A entrada usa **Entrar com ChatGPT**, pelo mecanismo nativo do Sites. Não há login próprio por senha, Google direto, código por e-mail, WhatsApp ou Instagram. Uma conta que entrou no portal ainda precisa de um vínculo para operar módulos administrativos. A participação pública em uma campanha usa a identidade nativa, sem exigir vínculo na equipe.

O segredo de runtime `OWNER_EMAIL` define o e-mail autorizado para o primeiro responsável institucional. Configure-o pelo controle de variáveis do Sites, fora do código e do manifesto. O responsável deve entrar normalmente com a conta correspondente. O bootstrap cria o vínculo inicial somente se nunca existiu um responsável global no banco; o histórico impede que mudar esse segredo ou entrar novamente ressuscite um vínculo revogado. O e-mail é usado nessa validação; o identificador estável da conta é usado nos registros.

Não publicar o valor de `OWNER_EMAIL`, tokens ou credenciais no README, GitHub, logs, fixtures ou capturas de tela. Não simular login inserindo cabeçalhos ou dados de usuário no cliente. Uma prévia local comum não reproduz automaticamente a autenticação do Sites.

A tela de equipe emite **links de convite para copiar e compartilhar manualmente**. Nenhum e-mail ou mensagem é enviado automaticamente. O convite tem destinatário, função, escopo, prazo e uso único. A pessoa entra com a conta do e-mail indicado e só então aceita. A geração do link não concede acesso antes do aceite, nem dá permissão para editar código, publicar o Site ou acessar outros projetos.

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

O responsável global não é concedido pelo formulário comum de convite. Recuperação ou sucessão desse papel exige procedimento institucional e manutenção autorizada, sem apagar histórico para contornar o bootstrap. A operação diária não exige compartilhar a conta do responsável.

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

A roleta e o dado digitais compartilham **uma participação por conta e campanha**. O servidor define e grava cada resultado antes da animação; a página apenas o apresenta. Atualizar ou reabrir recupera o registro, sem conceder nova chance. A escolha da modalidade fica vinculada à primeira participação.

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

O painel separa participações, tentativas, modalidades, tíquetes, premiações, entregas e unidades físicas. Um prêmio composto por três buttons é uma premiação e três unidades; uma repetição autorizada não é outra pessoa. Acessos registrados não são visitantes únicos.

As exportações CSV de participação, estoque e empréstimos respeitam os projetos autorizados. Elas não incluem e-mail, identificador da conta, contato do solicitante, termos ou observações pessoais. São projeções para gestão, não cópia integral do banco. Dados inseridos em campos livres ainda exigem cuidado da equipe. O agrupamento operacional atual usa horário de Brasília, UTC−03, para o período atendido pela implementação.

**Não há sincronização automática com Google Sheets.** O CSV pode ser importado em uma planilha. Uma integração futura deverá ter conexão institucional, acesso mínimo, identificação da origem, idempotência e validação; editar uma célula não poderá apagar uma entrega ou liberar um equipamento. As conexões do autor no chat não se tornam credenciais permanentes dos visitantes.

O endereço do Instagram é configurável e opcional. Abrir ou seguir o perfil não é condição de participação neste fluxo. Não há OAuth Instagram, consulta de seguidores ou métrica de novos seguidores atribuídos ao Rolê. Uma integração Meta futura exige validação técnica, de política e institucional; não usar scraping ou senha dos participantes.

## Desenvolvimento e publicação

Execute os comandos a partir deste diretório, inclusive quando estiver dentro de `apps/proex-portal` no repositório. Preserve o lockfile e use as versões do projeto.

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit --incremental false
pnpm run build
```

No ambiente Work gerenciado, use o supervisor e o fluxo da skill Sites para prévia, preparação de fonte e publicação. Em desenvolvimento standalone, `pnpm dev` inicia a aplicação; esse servidor não cria identidade nativa nem permissões administrativas por conta própria.

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
- Se necessário, definir autenticação direta Google/e-mail e SMTP apropriado em arquitetura compatível; não estão disponíveis como método próprio deste portal.
- Avaliar separadamente integração Meta, catálogo público, sincronização Sheets e migração para outros serviços. Nenhum desses itens deve ser anunciado como ativo antes da implementação e verificação.
