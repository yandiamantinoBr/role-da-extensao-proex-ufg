# Plano de continuidade do Rolê da Extensão

PROEX UFG • Planejamento e prompts de execução • 20 de outubro de 2026

## A decisão recomendada

Criar um portal de operações da PROEX, com áreas por projeto e acesso por função. O Rolê da Extensão será o primeiro módulo. A roleta livre continuará disponível; a participação oficial terá identificação, regra de uso e vínculo ao estoque. Um banco compartilhado manterá os registros consistentes entre celulares. Planilhas poderão receber consultas e importações controladas.

Este pacote organiza a implementação. Não instala login, estoque, Instagram ou empréstimos no site atual. Inclui um prompt mestre e sete prompts por etapa, com regras, dependências e critérios de aceite. O trabalho deste atendimento limita-se à pesquisa, planejamento e documentação em branch separada.

## O que foi confirmado

O repositório é público: https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg. A branch principal observada foi main, commit f905f0d78371dc4a8784cce27bdbc7ef6fa88103. O Sites confirmou o endereço atual público, ativo e na versão 7. O README documenta também o GitHub Pages.

O código já compartilha o jogo entre as duas publicações e usa React, TypeScript, Vinext e Vite. Sons são sintetizados no navegador. Configurações atuais de tempo, volume e chances são locais de cada aparelho, e não regras compartilhadas de campanha. O manifesto consultado não tinha banco D1 nem armazenamento R2 vinculados.

O relatório anexado tem 18 páginas e descreve o ciclo de atividades de 2025, apresentado em 2026, com nomenclatura histórica PROEC. Fundamenta interação, acolhimento, materiais e avaliação. Não traz uma série de contagens que permita preencher os indicadores desejados retrospectivamente. A interface futura deve usar PROEX.

## O primeiro incremento

Preservar uma referência testada do jogo e criar ambiente separado para administração, projetos e permissões. Depois conectar campanha, participação e entrega. Empréstimos e relatórios aproveitam essa base. A validação Instagram pode correr separadamente, sem bloquear os demais módulos.

O levantamento não auditou exaustivamente a segurança do código nem reproduziu todos os testes históricos. Declarações de testes em conversas anteriores não foram tratadas como testes executados neste atendimento.

<!-- pagina -->

## Como as partes se conectam

O usuário da equipe verá um portal único. Por trás dele, cada módulo terá regras e permissões próprias. Não é preciso criar um site independente para cada tipo de material. A versão livre e a participação oficial são experiências distintas porque têm responsabilidades distintas.

| Parte | Finalidade | Fonte de dados |
| --- | --- | --- |
| Roleta e dado livres | Experimentar e usar sem limite | Navegador, como hoje |
| Participação oficial | Evento, elegibilidade, resultado e retirada | Banco oficial |
| Painel PROEX | Equipe, projetos, materiais e relatórios | Mesmo banco, com escopos |
| Google Sheets | Consulta, exportação e entrada validada | Projeção ou importação controlada |
| GitHub | Código, documentação, versões e revisão | Arquivos sem dados operacionais |

### Banco e hospedagem

A recomendação inicial é PostgreSQL gerenciado com autenticação e armazenamento privado. Supabase é um candidato pragmático porque reúne esses serviços e documenta login Google e por e-mail [7–8]. O projeto deve ser exclusivo da PROEX. A decisão depende de infraestrutura institucional existente, responsáveis, região, custos, guarda e aprovação de fornecedores; nenhum recurso foi contratado ou provisionado neste atendimento.

Há uma restrição prática: a orientação atual de Sites preserva sua autenticação nativa ChatGPT. Não é correto prometer Google e e-mail dentro dessa mesma plataforma sem confirmar suporte. Por isso, a proposta é hospedar o portal oficial em ambiente compatível, reaproveitando o jogo e a identidade, enquanto o site livre permanece onde está. Isso será registrado numa decisão de arquitetura antes da implementação.

### Planilha sem conflito de saldos

O banco é o registro oficial. Sheets pode exibir relatórios, receber uma lista de entrada e oferecer edição controlada. Cada importação deve mostrar uma prévia, validar dados, tratar conflitos e registrar o lote. Editar ou apagar uma célula não pode apagar uma entrega ou liberar um equipamento.

A conexão disponível neste chat com Drive não é uma credencial permanente do futuro site. A execução publicada precisará de conexão autorizada própria e transferível à instituição. Trocar a planilha deve ser uma configuração, sem reescrever o sorteio ou o estoque.

<!-- pagina -->

## Administração que a equipe consiga usar

O painel deve permitir selecionar projeto e evento, atender alguém, confirmar uma entrega, consultar disponibilidade e gerar relatório pelo celular. A navegação muda conforme a função; cada pessoa acessa somente o que precisa.

| Perfil sugerido | Escopo de trabalho |
| --- | --- |
| Responsável institucional | Organização, responsáveis e políticas |
| Gestor do projeto | Equipe, campanhas e regras do projeto |
| Operador de evento | Atendimento, resultado físico e entrega autorizada |
| Responsável por estoque | Recebimento, transferência, contagem e ajuste |
| Responsável por empréstimos | Reserva, retirada, retorno e ocorrências |
| Leitor de relatórios | Indicadores agregados autorizados |

Um bolsista do Rolê não ganha acesso ao estoque geral ou aos termos de outro projeto. Essa proteção deve valer no servidor e nos arquivos, inclusive se alguém alterar o endereço de uma página ou chamar a API diretamente. Esconder um botão não protege os registros.

### Convites e responsabilidades

O gestor informa e-mail, função, escopo e validade. A pessoa confirma a identidade e aceita um convite de uso único. A equipe pode revogar o vínculo; sessões abertas também precisam perder o poder de operar. Não se deve compartilhar senha nem permitir que o último responsável institucional seja removido sem substituição.

Administrar o painel significa configurar eventos e operar registros. Publicar uma alteração no código é outra permissão, mantida no GitHub e no processo de revisão. Um convite operacional não entrega acesso às credenciais ou à publicação do site.

### Telas prioritárias no celular

Início com evento ativo e ação principal. Atendimento com leitura de QR e código digitável. Entrega com resultado, itens e confirmação. Materiais com busca, saldo e histórico. Empréstimos com lista e calendário. Relatórios com filtro e atualização visível.

Botões confortáveis, contraste, foco, leitor de tela, zoom e mensagens simples fazem parte do aceite. No aparelho compartilhado da equipe, o botão Próximo atendimento limpa os dados da pessoa anterior. Falha de internet mostra o estado real e não uma confirmação que ainda não foi gravada.

<!-- pagina -->

## Participação oficial sem perder a fluidez

O evento terá regulamento versionado, datas, modalidades e cotas. A proposta é permitir uma participação por conta ou tíquete e campanha, compartilhada entre roleta, dado digital e dado físico. Isso é controle operacional; não prova que uma pessoa com várias contas só participou uma vez.

Google pode ser a entrada rápida, com código ou link por e-mail como alternativa. Quem não tem conta adequada poderá receber atendimento assistido. WhatsApp exige estudo próprio de canal oficial, custo e operação; não será apresentado como um login gratuito já disponível.

### O fluxo digital

O servidor verifica elegibilidade e limite, grava o resultado e reserva o direito ao prêmio numa operação protegida contra concorrência. Só então a animação apresenta a face autorizada. A animação continua leve e usa os recursos existentes.

Recarregar ou fechar a página recupera o mesmo resultado. Duas abas, dois aparelhos ou duplo toque disputam o mesmo direito. Uma chave de operação evita duplicação depois de falha de rede. Som, duração e confetes podem ser preferências da pessoa; as chances oficiais vêm da campanha no servidor.

### O fluxo presencial

Antes de autorizar o dado físico, o operador reserva o direito e cobertura para os resultados premiáveis possíveis. Depois registra a face real, converte a cobertura correspondente em prêmio e libera as demais. Isso evita duas autorizações apoiadas no último Super Brinde. O relatório identifica resultado observado pela equipe; correções preservam o registro anterior.

Sem conexão, a equipe pode usar uma contingência previamente definida com tíquetes e posterior conciliação. Essa modalidade tem garantia menor contra duplicidade e precisa aparecer separada. Não se deve confirmar uma reserva ou baixa como sincronizada quando o servidor não a recebeu.

### Duas regras que precisam ser decididas

“Tente novamente” conflita com uma tentativa única. O sistema deve separar participação e tentativa e exigir uma decisão: concede repetição? Quantas? Em qual modalidade? O que acontece ao esgotar? Não inventar essa política nem transformar a face em perda silenciosa.

“Super Super Brinde” e a possibilidade de arriscar um prêmio continuam desativados. Uma release ou um novo botão não resolve uma regra de premiação ainda indefinida. O piloto real precisa de regulamento claro; desenvolvimento e testes podem avançar com dados fictícios.

<!-- pagina -->

## O que o Instagram permite e o que ainda falta

A demanda de bloquear o jogo até seguir a PROEX foi preservada. A pesquisa encontrou um caminho técnico contextual: a Meta documenta um campo de seguimento na API de perfil de mensagens. Ele depende do fluxo e das permissões da conta profissional integrada; não é uma consulta universal por nome de usuário nem um login simples para todos os participantes [1–2].

Uma futura prova de conceito deverá ligar a sessão do site à interação elegível por desafio de uso único. Também terá de verificar acesso, webhooks, expiração, limites e comportamento na conta institucional real. Não foi acessado aplicativo Meta nem token da PROEX. O perfil atual também não foi confirmado; não presumir que seja @proex.ufg.

A política de Spam da Meta inclui restrições a exigir engajamento para acesso a conteúdo exclusivo [3]. A aplicação dessa regra à dinâmica precisa de avaliação específica. A disponibilidade técnica de um campo não equivale à autorização para impor a condição. Não há base para declarar neste levantamento que toda promoção com follow é permitida ou proibida.

### Caminho recomendado para o primeiro piloto

Convidar a conhecer e seguir o perfil, com entrada por Google/e-mail e atendimento assistido. O bloqueio obrigatório fica pendente de validação técnica e institucional. Essa alternativa é uma recomendação de implantação, e não uma alegação de que o pedido de verificação obrigatória já foi cumprido.

| Sinal registrado | O que permite afirmar |
| --- | --- |
| Clique no perfil | Alguém abriu o link |
| Autodeclaração | A pessoa informou que segue |
| Conferência da equipe | Houve checagem manual naquele horário |
| Confirmação por API | O provedor confirmou o estado consultado |
| Crescimento total da conta | Houve variação no período, sem causalidade demonstrada |

Não somar esses sinais como “novos seguidores gerados”. Uma confirmação de seguimento pode corresponder a quem já seguia antes do evento. A interface deve distinguir indisponível de não confirmado.

Limite da pesquisa: as páginas Meta tiveram bloqueios/429 na abertura direta. Os campos e permissões foram confirmados em trechos indexados das próprias páginas oficiais. Antes de implementar, o agente deverá revalidar a documentação completa e testar o aplicativo autorizado. Scraping, senha do Instagram e APIs não oficiais não são alternativas propostas.

<!-- pagina -->

## Brindes e estoque com registros coerentes

Brinde e Super Brinde são categorias de premiação. Button, caneta e sacochila são itens físicos. Uma oferta define quais itens atendem à categoria e em quais quantidades. Esse catálogo deve ser editável pela equipe, sem mudar o código.

| Item citado por Yan | Como cadastrar inicialmente |
| --- | --- |
| Button laranja, roxo e azul | Três variantes de 2,5 cm; saldo a contar |
| Planner | Kit; composição de 7 ou 8 folhas a confirmar |
| Caneta PROEX | Item; especificação e quantidade a confirmar |
| Sacochila e squeeze brancos | Itens separados; saldo a contar |
| Agenda | Item eventual, sem oferta presumida |
| Três buttons | Conjunto que consome três unidades |

Esses exemplos não constituem estoque inicial nem regra definitiva de prêmio. O catálogo poderá incluir novos itens, conjuntos e substituições autorizadas.

### Ganhar e retirar são momentos diferentes

Emitir o direito ao prêmio reserva uma oferta ou cota garantida. Confirmar a retirada baixa os itens reais e registra quem entregou. Um código ou QR de uso único permite recuperar o direito sem mostrar e-mail ou nome na URL. Duplo toque e repetição da requisição não podem gerar outra baixa.

Um prêmio de três buttons conta como uma premiação e três unidades entregues. A pessoa pode estar aguardando retirada sem que os itens já constem como entregues. Troca de composição e estorno exigem validação, motivo e histórico.

### Quando o material acabar

O sistema não deve emitir mais direitos do que consegue atender. Se uma categoria deixar de ter cobertura, a campanha pausa novas participações e avisa a equipe. Não deve sortear de novo, mudar probabilidades ou transformar silenciosamente o ganhador em perdedor.

O estoque terá entradas, reservas, entregas, transferências e ajustes. Contagem física pode revelar divergência; a correção gera um movimento justificado, sem editar o saldo e apagar o rastro. Materiais compartilhados entre projetos mantêm um único saldo físico, mesmo que apareçam em várias áreas.

O catálogo público de brindes, fotografias e classificação mais elaborada foram mencionados como demanda posterior. A base será preparada, mas a exposição ao participante depende da organização desses dados e regras.

<!-- pagina -->

## Empréstimos e materiais da PROEX

O mesmo portal pode atender operações diferentes sem misturar seus registros. Equipamento retorna; material distribuído ou consumido normalmente não retorna.

| Operação | Exemplos | Registro principal |
| --- | --- | --- |
| Empréstimo | Projetor, caixa de som, microfone | Reserva, saída e devolução |
| Material do projeto | Banner, dado físico, fantasia | Localização, uso e condição |
| Distribuição institucional | Pasta, crachá, bloco, calendário | Quantidade e destino institucional |
| Consumo interno | Papel, limpeza, alimentação | Quantidade, finalidade e período |

São exemplos informados ou propostos, não inventário conferido. Projetos como Oxigênio e seus nomes oficiais devem ser validados antes do cadastro. Um bem compartilhado não deve ser duplicado para cada projeto.

### Disponibilidade por intervalo

O painel mostrará período e situação: solicitado, reservado, retirado, devolvido, atrasado ou em manutenção. O banco deve impedir duas reservas incompatíveis, mesmo que dois servidores confirmem ao mesmo tempo. Acessórios e conjuntos também participam desse controle.

Passar a data prevista não significa que o equipamento voltou. O atraso permanece visível e sinaliza impacto nas próximas reservas. Devolução parcial e avaria exigem registro; manutenção bloqueia uso até liberação autorizada. A interface precisa explicar o conflito com clareza.

### Termos e fluxos já existentes

O portal oficial da PROEX já aponta formulário de empréstimos, com dados da ação, solicitação e datas [9]. A página de serviços gráficos documenta distribuição de materiais institucionais e fluxo via SEI [10]. O sistema novo deve apoiar e integrar esses procedimentos; não se pode presumir que substitui seus registros e autorizações.

A foto ou PDF do termo fica em armazenamento privado, com acesso por função e prazo próprio de guarda. Upload não equivale a assinatura eletrônica verificada. Termos com assinaturas, documentos ou contatos não irão ao GitHub nem a planilha pública.

Contribuições pessoais para alimentação exigem um módulo financeiro e regras próprias. Nesta etapa, o escopo pode registrar o consumo dos produtos; não inclui cobrança, PIX, dívida, rateio ou contabilidade paralela.

<!-- pagina -->

## Dados mínimos e relatórios úteis

Um checkbox “autorizo a PROEX” não resolve todo o tratamento. A ANPD orienta o poder público a identificar a base aplicável e apresenta exemplo de evento universitário com comunicação posterior facultativa [4]. Registro operacional, divulgação futura e uso de imagem devem ter finalidades separadas.

A proposta usa identidade interna e do provedor, e-mail quando o login exigir, campanha, modalidade, resultado e entrega. Nome de exibição pode ser opcional. Não pedir CPF, endereço, data completa de nascimento, avatar ou lista de amigos por padrão. Identificadores pseudonimizados continuam exigindo proteção quando permitem vincular a pessoa.

O aviso deve explicar responsável, finalidade, dados, fornecedores, guarda e canal de direitos. Esses pontos precisam ser definidos institucionalmente; não foi confirmado canal LGPD central atual nem inventado prazo de retenção. A LGPD exige atenção ao melhor interesse de crianças e adolescentes; o enquadramento do ECA Digital vigente em 2026 também deve ser avaliado [5–6]. Prever atendimento assistido, sem criar exigência improvisada de RG ou selfie.

### O relatório da gestão

| Pergunta | Indicador adequado |
| --- | --- |
| Quantos acessaram? | Acessos ou sessões, com método declarado |
| Quantos participaram? | Participações por identidade/campanha |
| Qual dinâmica foi usada? | Roleta, dado digital e físico separados |
| Quantas chances ocorreram? | Tentativas, separadas de participações |
| O que foi distribuído? | Premiações e unidades por item |
| O que está pendente? | Retirada, atraso, divergência e manutenção |

Os filtros usarão evento, projeto, período e fuso de São Paulo. O painel padrão será agregado, sem nomes/e-mails. Dados fictícios, demonstrações e registros provisórios terão identificação própria. O número “30 pessoas” citado como exemplo não deve entrar como histórico real do evento de 19 de outubro.

Contas, infraestrutura, backups e responsáveis devem ser transferíveis à instituição. A implementação precisa testar restauração, revogação de acessos e proteção de anexos. O código pode ser público; participantes e documentos operacionais permanecem privados.

<!-- pagina -->

## Execução em etapas e continuidade

| Prompt | Resultado esperado |
| --- | --- |
| 00 Mestre | Contexto e regras comuns para qualquer retomada |
| 01 Diagnóstico | Baseline, preservação, ambiente e arquitetura |
| 02 Administração | Login, convites, projetos e permissões |
| 03 Participação | Campanha, limite comum e resultado recuperável |
| 04 Estoque | Ofertas, reservas, entrega e movimentos |
| 05 Empréstimos | Disponibilidade, termos, retorno e consumo |
| 06 Instagram | Prova de viabilidade e integração isolada |
| 07 Relatórios | Indicadores, Sheets e manual de operação |

03 e 04 compartilham o contrato de cotas e retirada. Não haverá piloto com brindes reais enquanto esse vínculo e as regras críticas não estiverem validados. 06 pode avançar em paralelo. Não é necessário abrir sete chats simultaneamente: cada um deve começar lendo o estado atual para evitar implementações divergentes.

### GitHub e preservação

O pacote deve permanecer numa branch de planejamento, separado de main e dos pipelines de publicação. Uma release futura registra a revisão do código, mas não mantém sozinha a URL antiga funcionando. Será preciso preservar a implantação livre e seus builds também.

A consulta da API não encontrou releases nem licença global do projeto. Há licenças de terceiros em arquivos específicos. Repositório público não equivale automaticamente a uma licença livre de reutilização [11]. A licença do código próprio e os direitos sobre marcas/fontes precisam ser tratados separadamente; não foram alterados neste atendimento.

O README menciona sincronização horária, mas a automação Sites vinculada estava desabilitada. Não foi reativada nem testada a cópia Windows. Portanto, não se deve confiar nessa sincronização para o trabalho futuro sem diagnóstico.

### Como usar agora

No próximo chat, envie 00_PROMPT_MESTRE.txt e 01_DIAGNOSTICO_E_PRESERVACAO.txt. Para outra frente, envie o mestre, o prompt daquela etapa e a branch/estado atualizado. Os prompts permitem seguir com trabalho independente mesmo quando faltarem decisões institucionais. Não há necessidade de colar credenciais.

<!-- pagina -->

## Fontes e decisões em aberto

Consulta realizada em 20/10/2026. Fontes técnicas e normativas devem ser revalidadas antes da implementação. Propostas de arquitetura deste plano são recomendações, e não recursos já configurados.

[1] Meta — Instagram User Profile API. Campos e permissões de mensagens. https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile

[2] Meta — Instagram API with Instagram Login. https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login

[3] Meta — Spam, Transparency Center. https://transparency.meta.com/policies/community-standards/spam/

[4] ANPD — Tratamento de dados pessoais pelo Poder Público, versão 2.0, junho de 2023, especialmente páginas impressas 10–13. https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-poder-publico-anpd-versao-final.pdf/@@display-file/file

[5] Brasil — LGPD, texto compilado, especialmente arts. 6, 14, 15, 16 e 23. https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm

[6] Brasil — Lei 15.211/2025, Estatuto Digital da Criança e do Adolescente. https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm

[7] Supabase — Sign in with Google. https://supabase.com/docs/guides/auth/social-login/auth-google

[8] Supabase — Passwordless email sign-in. https://supabase.com/docs/guides/auth/auth-email-passwordless

[9] PROEX/UFG — Formulário de empréstimos vinculado ao portal oficial. https://docs.google.com/forms/d/e/1FAIpQLSdUQVhf4ClakZKeRs1UznUHPwukGmztdeyTCTyaaW3lDU2oig/viewform

[10] PROEX/UFG — Solicitação de serviços gráficos. https://proex.ufg.br/p/32371-solicitacao-de-servicos-graficos

[11] GitHub Docs — Licensing a repository. https://docs.github.com/en/enterprise-cloud@latest/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository

Fontes do próprio projeto: relatório PDF anexado; README, package.json, app/page.tsx, app/globals.css, lib/roulette.ts, docs/synchronization.md, manifesto, árvore e metadados do repositório; consulta nativa Sites. O anexo original foi preservado.

### Decisões antes do piloto real

Confirmar responsável institucional e infraestrutura; escopo de uma participação; política de Tente novamente; catálogo/cotas; composição do planner; canal e viabilidade Instagram; finalidade/base de dados, guarda e fluxo para menores; integração com procedimentos oficiais. Os prompts preveem desenvolvimento isolado enquanto essas decisões forem fechadas.
