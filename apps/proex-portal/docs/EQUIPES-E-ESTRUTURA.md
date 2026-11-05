# Equipes de trabalho e estrutura institucional

## Entrega desta etapa

A página `?module=work-teams` acompanha equipes, integrantes visíveis, demandas e andamento. `?module=team` mantém Pessoas e acessos, com organizações, convites e permissões. Reutiliza `followup_teams`, `followup_team_members` e as atribuições existentes; não exige migração nem cria pessoas ou equipes reais.

O usuário escolhe organização e projeto. Somente responsáveis pela organização podem consultar todos os seus projetos e gerenciar equipes. A edição ocorre na visão da organização, onde a lista completa de integrantes elegíveis está disponível; editar uma lista parcial de projeto não pode remover pessoas ocultas do cadastro da equipe.

Uma pessoa pode participar de várias equipes. Pertencer à equipe, ter e-mail institucional ou possuir vínculo de estágio/bolsa não concede permissão. Um usuário de projeto vê suas equipes e as equipes atribuídas às demandas que já pode consultar, com integrantes que também tenham acesso ao projeto. Os serviços revalidam o acesso antes de retornar os dados. Não exportam contatos, e-mails, conteúdo de anexos ou histórico pessoal.

Os gráficos e contadores incluem todas as demandas autorizadas do recorte, sem depender da paginação de seis registros. Clicar em um estado filtra a lista no servidor; abrir uma demanda leva ao contexto de origem. Selecionar uma equipe leva o foco ao painel correspondente. As equipes mostram somente atribuições explícitas à equipe, não toda demanda de qualquer integrante. Uma demanda pode ser contada em várias equipes, sem representar várias demandas distintas.

PDF, DOCX e XLSX fazem uma nova leitura autorizada e incluem metadados do recorte. O limite é 5.000 demandas: ultrapassá-lo pede um recorte menor e não gera arquivo parcial silenciosamente. A interface não oferece CSV. Os arquivos são cópias; esta etapa não cria uma planilha nativa sincronizada por equipe.

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

Testes de domínio cobrem duas organizações, dois projetos da mesma organização, multiequipe, agregados, escopo de integrantes, arquivamento, perda de vínculo, conta bloqueada, revogação durante leitura, paginação e exportação. A validação de resposta recusa contexto/conta diferente, estados desconhecidos e contagens inválidas.

A interface foi ensaiada em React StrictMode com o componente, a rota e o serviço reais sobre SQLite em memória com dados sintéticos. Validar 375/390/1366 px nos dois temas, campos e botões por teclado, alvos de pelo menos 44 px, filtros do gráfico, criar/editar equipe, limpar dados após 403 e reabrir os três formatos. Evidências locais ficam em `.sites-runtime/teams-qa/`; nenhum desses ensaios declara publicação ou sincronização com dados reais.
