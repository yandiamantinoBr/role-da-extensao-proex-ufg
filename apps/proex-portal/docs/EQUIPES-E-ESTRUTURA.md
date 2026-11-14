# Equipes de trabalho e estrutura institucional

## Entrega desta etapa

A página `?module=work-teams` acompanha equipes, integrantes visíveis, demandas e andamento. `?module=team` mantém Pessoas e acessos, com organizações, convites e permissões. Reutiliza `followup_teams`, `followup_team_members` e as atribuições existentes; não exige migração nem cria pessoas ou equipes reais.

Em **Onde acompanhar**, escolha a organização inteira ou um projeto. Gestão da organização vê o quadro completo de integrantes e pode editar as equipes. Ao entrar a partir de um projeto, o recorte inicial é esse projeto. Na vista **Organização inteira**, entram as demandas de todos os projetos e as demandas institucionais sem projeto.

Em **Atuação da equipe**, filtre por atuação no projeto selecionado ou por vínculo a uma unidade do organograma. Na gestão da organização há também **Em vários projetos ativos** e **Sem atuação registrada em projetos**. A busca aceita equipe, projeto ou unidade, inclusive sigla e texto sem acento. **Só minhas equipes** pode ser combinado com esses filtros.

Uma equipe pertence à organização. A seção de atuação mostra projetos com demandas atribuídas à equipe ou responsabilidades vigentes na ficha do projeto, material, empréstimo ou dinâmica. Duas atribuições no mesmo projeto contam uma vez. O filtro de vários projetos ativos considera somente aqueles em atividade. Projetos históricos, de catálogo e arquivados permanecem identificados na ficha da equipe. O vínculo com uma unidade do organograma é independente dessas atribuições. Assim, a Coordenação Administrativa pode ter uma equipe vinculada à unidade e nenhuma atuação registrada em projetos. Para incluir uma equipe em dois projetos, use **Quem cuida de cada área** ou **Responsáveis e demandas** nas fichas correspondentes. Uma mesma equipe pode também receber demandas em ambos.

Um usuário com acesso apenas ao projeto vê as suas equipes e as equipes com trabalho registrado naquele projeto, inclusive quando abre a unidade vinculada no organograma. Em Equipes, os integrantes precisam ter acesso ao mesmo projeto para aparecer. No organograma aparecem o nome da equipe e seu vínculo com a unidade. Participar de uma equipe, aparecer no organograma ou ser designado responsável organiza o trabalho. A concessão de acesso continua em **Pessoas e acessos**. O serviço revalida escopo, visibilidade, integrantes e vínculos antes de responder, inclusive na consulta de exportação. Os arquivos incluem as demandas autorizadas do projeto e estado selecionados. Contatos, e-mails, anexos e histórico pessoal ficam fora dos arquivos.

Os gráficos e contadores incluem todas as demandas autorizadas do recorte, sem depender da paginação de seis registros. Clicar em um estado filtra a lista no servidor; abrir uma demanda leva ao contexto de origem. Selecionar uma equipe leva o foco ao painel correspondente. As equipes mostram somente atribuições explícitas à equipe, não toda demanda de qualquer integrante. Uma demanda pode ser contada em várias equipes, sem representar várias demandas distintas.

Ao baixar PDF, DOCX ou XLSX, o Portal consulta a equipe e as demandas do recorte antes e depois de preparar o arquivo. O download para se os dados ou os acessos mudarem durante a preparação. Se uma versão antiga da página pedir para atualizar, recarregue antes de tentar novamente. Acima de 5.000 demandas, escolha um projeto ou estado para baixar o conjunto completo. A [Planilha da equipe](SHEETS-POR-EQUIPE.md) usa um arquivo de consulta próprio para equipe e projeto.

Durante uma atualização no mesmo contexto, o resultado anterior permanece identificado e as ações sobre demandas/exportações aguardam a confirmação. Isso preserva foco e rolagem ao filtrar o gráfico. Trocar organização/projeto, perder um recorte nos dados de sessão ou receber 401/403 oculta os dados anteriores. Respostas tardias de consultas canceladas são descartadas.

## Estrutura oficial consultada em 05/11/2026

Fonte principal: [Estrutura Organizacional 2026, PDF oficial](https://files.cercomp.ufg.br/weby/up/694/o/Estrutura_Organizacional_-_2026.pdf), versão impressa 5.0.3 de 28/07/2026, uma página. PDF conferido por renderização; seu conteúdo é uma imagem, não uma árvore de texto confiável. SHA256: `DB862C20AB4B9D5328651E129D4A2FFE5DBFA371715293F1A2FAC2293D48DC91`.

```text
Câmara de Extensão e Cultura (governança)
└─ Pró-Reitoria de Extensão
   ├─ Diretoria de Extensão
   │  ├─ Coordenação de Ações de Extensão
   │  └─ Coordenação Casa Projetos Sociais
   ├─ Diretoria de Articulação e Logística
   │  ├─ Coordenação de Acompanhamento de Editais
   │  ├─ Coordenação de Eventos Institucionais
   │  └─ Coordenação Centro de Cultura e Eventos
   ├─ Coordenação Administrativa
   └─ Revista UFG
```

A [notícia oficial da reorganização](https://proex.ufg.br/n/199742-proec-agora-se-chama-pro-reitoria-de-extensao-e-passa-por-mudancas), de 27/03/2026 e atualizada em 30/03, confirma a alteração de nome e as duas diretorias, com criação da Secretaria de Arte e Cultura na UFG. A [página Equipe PROEX](https://proex.ufg.br/p/equipe-proex), atualizada em 05/10/2026, é um diretório de pessoas e agrupamentos; não estabelece automaticamente a hierarquia nem permissões na aplicação. Este documento público não importa identidades ou contatos desse diretório.

Comunicação/Design, TI, apoio administrativo, logística e equipes temporárias de eventos são possíveis equipes operacionais. Esses exemplos não são novas diretorias oficiais e não foram cadastrados automaticamente.

## Próxima etapa: contrato proposto, ainda sem implementação

- Reaproveitar a organização existente e suas equipes. O catálogo global `organizational_units`, usado para classificar projetos e unidades UFG/parceiras, não deve virar implicitamente uma hierarquia interna por organização.
- Adicionar nós estruturais por organização, com tipo, situação, fonte, versão da fonte, data de verificação, versão do registro e histórico. Relações distinguem subordinação administrativa, governança e afiliação; validar mesma organização, ciclos, autorrelações e CAS.
- Vincular equipes a um ou mais nós. Preservar equipes transversais e vínculos funcionais separados de ACL. Cargo de coordenação não equivale ao papel `owner` ou `manager` do portal.
- CRUD formal exige revisão humana do documento de origem; uma importação ou interpretação por IA apresenta proposta e diferenças antes de alterar o cadastro. Não criar usuários, convites ou acessos por aproximação de nome.
- Uma planilha de equipe limitada precisa de arquivo e projeção próprios, com escopo equipe + projeto + dados permitidos. O canal `pxp_` de um projeto inteiro não deve ser entregue a uma equipe restrita e protegido apenas por filtros, abas ou intervalos. A edição do arquivo permite consultar suas células; isolamento precisa ocorrer antes da exportação/sincronização.
- A planilha mestre permanece administrativa. Migração para Drive institucional deve preservar IDs/vínculos, inventário, ACL e recuperação; registrar a mudança do arquivo canônico e testar ida/volta. Não prometer apagamento de cópias já baixadas.
- Exportações e gráficos da estrutura devem usar o mesmo recorte autorizado e manter PDF/DOCX/XLSX, legenda, fonte, período e horário de Brasília.

## Verificação

Testes de domínio cobrem duas organizações, dois projetos da mesma organização, multiequipe, agregados, escopo de integrantes, arquivamento, perda de vínculo, conta bloqueada, revogação durante leitura, paginação e exportação. `work-teams-export.test.mjs` confere a revogação e a mudança de dados depois da preparação do arquivo. A validação de resposta recusa contexto/conta diferente, estados desconhecidos e contagens inválidas.

A interface foi ensaiada em React StrictMode com o componente, a rota e o serviço reais sobre SQLite em memória com dados sintéticos. Validar 375/390/1366 px nos dois temas, campos e botões por teclado, alvos de pelo menos 44 px, filtros do gráfico, criar/editar equipe, limpar dados após 403 e reabrir os três formatos. Evidências locais ficam em `.sites-runtime/teams-qa/`; nenhum desses ensaios declara publicação ou sincronização com dados reais.
