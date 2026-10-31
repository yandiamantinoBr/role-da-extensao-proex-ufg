# Organizações e isolamento — R04 / V11

Implementação local sobre `0033788`, branch `v11-organizacoes`, iniciada em 31/10/2026. **A migração 0008 não deve ser publicada antes de existir backup criptografado completo e restauração isolada verificada.** Este documento não comprova publicação ou alteração em produção.

## Fronteira de segurança

`organizations` é uma entidade de acesso independente. Cada projeto pertence a uma organização, com FK real e validação SQL. Materiais, campanhas, empréstimos, registros, anexos e demais operações herdam a fronteira do projeto armazenado. `organizational_units` continua sendo o catálogo UFG usado em perfis e filtros; escolher uma unidade ou usar e-mail institucional não concede organização, projeto ou função.

| Vínculo em `members` | Alcance |
| --- | --- |
| `owner`, projeto nulo, organização nula | Administração da plataforma; acesso integral explícito, preservado para os responsáveis atuais |
| `owner`, projeto nulo, organização preenchida | Administração somente daquela organização, incluindo criação de projetos e gestão de acessos locais |
| Função operacional com projeto preenchido | Somente o projeto concedido; a organização precisa corresponder à dele |
| Função operacional com projeto nulo e organização preenchida | Todos os projetos daquela organização; usado na preservação de concessões antigas e em convites organizacionais explícitos |
| Conta sem vínculo | Nenhum dado interno; a participação pública mantém contrato próprio |

O administrador de organização não recebe acesso à administração da plataforma, ao catálogo compartilhado de unidades/tipos, à recuperação ou bloqueio global de contas, a backup integral ou a Sheets/MCP integral. A sincronização atual continua exclusiva da administração da plataforma. Uma conexão própria de uma organização exigirá outra entrega, com filtros, tokens e pasta separados; esta versão nega esse uso em vez de apresentar um isolamento incompleto.

O último administrador ativo de cada organização é protegido, inclusive nos caminhos antigos de revogação e mudança de função. A proteção do último responsável da plataforma considera somente responsáveis com organização nula. Um administrador local não conta como substituto do responsável da plataforma.

## Migração e preservação

`drizzle/0008_v11_organizations.sql` é nova e aditiva em relação às migrações existentes:

- Cria a organização inicial `org_proex` e vincula a ela os projetos existentes.
- Preserva responsáveis antigos como administradores da plataforma. Concessões antigas sem projeto, de outras funções, passam a valer apenas na organização inicial, incluindo seus projetos futuros.
- Preserva identificadores, papéis, datas e vínculos revogados. `organization_grant_migrations` registra a classificação de cada concessão anterior, sem copiar e-mails, e impede alteração/exclusão dessa trilha.
- Acrescenta organização a membros, convites e auditoria. Convites antigos pertencem à organização inicial; novos convites usam a organização do projeto ou uma organização explicitamente autorizada.
- Atualiza o índice de vínculo ativo para distinguir organizações. Uma pessoa pode ter funções diferentes em projetos/organizações distintos.
- Impede trocar a organização de projeto ou mover o escopo de concessões existentes. Transferências precisam de revisão e migração específicas; não são uma edição comum.
- Impede projeto superior ou edital compartilhado atravessando organizações. As referências de projeto continuam sujeitas às regras existentes de estoque, reservas, versões e histórico.

SQLite não permite acrescentar a uma tabela populada uma FK com padrão não nulo. A migração acrescenta a FK, preenche os dados existentes e usa triggers para garantir organização preenchida e válida em todas as novas inserções. Inserções legadas sem a coluna recebem a organização inicial (ou a organização real do projeto); uma falha de preenchimento aborta inclusive `INSERT OR IGNORE`. A verificação local cobre FK, triggers, preservação dos movimentos e trilha imutável.

## Contrato para a interface e importadores

`GET /api/organizations` retorna somente organizações acessíveis, com `canManage` calculado no SQL pela concessão atual. O snapshot do portal também inclui `organizations` e `organization_id` nos projetos e repete essa leitura: revogar um vínculo ou rebaixar um administrador não conserva organizações/permissões do ator em cache. As projeções de equipe incluem `organization_id` para distinguir administração local e da plataforma. `canManage` informa o que exibir; as operações sempre revalidam a autoridade no SQL.

`GET /api/organizations?organizationId=<id>` exige administração da organização e retorna `{ organization, members }`, com os vínculos e estados locais. Não revela pessoas ou concessões de outras organizações.

`POST /api/organizations` exige mesma origem, JSON e `X-Proex-Action: 1`:

| Ação | Campos | Autorização |
| --- | --- | --- |
| `organization.create` | `name`, `slug` | Administração da plataforma |
| `organization.update` | `organizationId`, `name`, `status`, `expectedVersion` | Administração daquela organização, com CAS |
| `organization.admin.grant` | `organizationId`, `userId`, `confirmed: true` | Administração local, para pessoa já vinculada; plataforma pode escolher outra conta ativa |
| `organization.admin.revoke` | `organizationId`, `memberId`, `confirmed: true` | Administração local, preservando outro administrador ativo |

Promover uma concessão organizacional anterior cria um novo vínculo e conserva o antigo como revogado, com referência na auditoria. Repetir uma concessão concluída recupera o vínculo existente. Bloqueio do destinatário ou perda de autoridade durante a operação não deixa promoção parcial.

`project.create` recebe `organizationId`. Administrador de uma única organização pode omitir o campo e usar a própria; a plataforma mantém a organização inicial como compatibilidade quando o campo é omitido. Importadores e a nova interface devem sempre enviar a organização escolhida. Alterar `organizationId` em projeto existente é rejeitado.

Convites por projeto derivam a organização no servidor e rejeitam uma organização conflitante. A interface deve enviar `organizationId` no convite sem projeto, com autoridade administrativa correspondente e `globalAccess: true`. Para pedidos anteriores, omitir a organização usa a única organização administrada ou a organização inicial; a autorização continua sendo conferida. O nome antigo do indicador permanece compatível, mas agora o alcance é **a organização escolhida**, nunca organizações futuras não concedidas. O formulário deve nomear esse alcance como organizacional na integração. Domínio de e-mail, perfil e texto do cliente não estabelecem autoridade.

## Leituras, gravações e integração portátil

Os predicados que antes usavam apenas `project_id IS NULL` foram separados em três casos: responsável da plataforma, responsável daquela organização ou vínculo do projeto. SQL de materiais, registros, arquivos, atendimento, projetos e equipe usa a organização do recurso. Snapshot, relatórios, CSV e agenda revalidam papéis e conta na própria leitura. Um ator em cache ou uma lista de projetos/capacidades adulterada não substitui o vínculo atual.

Recibos de idempotência e recuperação de uma resposta perdida revalidam também a leitura do resultado de projetos, editais, links, agenda e tipos. O catálogo global de tipos exige concessão atual da plataforma mesmo quando a pessoa ainda administra a PROEX localmente. Cancelamentos presenciais verificam conta ativa, ativação concluída, não anonimização e vínculo válido antes do replay e dentro do batch, sem liberação de reservas ou auditoria quando o acesso mudou. As mesmas barreiras foram entregues separadamente, sem dependência da 0008, no commit `d1f6347` para antecipação na base V10.

O formato portátil ganha `organizations` somente para leitura, além de `organization_id` não editável em projetos e nas projeções de equipe/auditoria. São 29 tabelas; a planilha antiga de projetos expande de 22 para 23 colunas sem apagar campos omitidos. Não foi alterado Google Sheets, Drive ou Apps Script real. O conector só deve ser atualizado/conferido após a revisão integrada e a autorização de publicação.

## Verificação e pendências de integração

Os testes novos usam SQLite, migrações e módulos reais, com contas e arquivos sintéticos. A matriz A/B cobre administrações locais, gestores, bolsistas, externos, concessões antigas, listas/detalhes, equipe privada, relatórios, CSV, agenda JSON/ICS, anexos de empréstimos/registros, campanhas, estoque, criação, convites, revogação, CAS e negação de Sheets/MCP ao administrador local. Também verifica cabeçalhos nativos forjados no modo standalone, promoção interrompida, revogação concorrente e ausência de efeitos parciais.

A suíte completa passou em 401/401 casos tanto no Node 24.22.1 quanto no Node 26.12.1; tipos passaram e lint terminou com zero erros e quatro avisos anteriores. Os builds Worker e Node passaram, assim como o smoke do Worker compilado, incluindo autenticação, senha, sessão, MCP e roundtrip portátil com revogação imediata. Uma revisão independente repetiu os cinco probes de autorização que originaram correções (replay revogado, lista de organizações após revogação, catálogo global após perda de administração da plataforma, cancelamento com conta bloqueada e `canManage` após rebaixamento), todos aprovados; também executou 94 testes de organizações/projetos/atendimento/equipe. Esta evidência é local e não substitui as verificações da revisão integrada.

Antes de integrar/publicar: concluir revisão independente da 0008 e das permissões; conferir backup e restauração; incorporar o seletor/gestão de organizações na interface e no importador; repetir tipos, suíte, lint e os builds Worker/Node na revisão integrada. Esta entrega do backend não afirma que a nova interface já foi montada nem que houve aplicação da migração em produção.

## Interface isolada — etapa seguinte sobre `b59e873`

`components/portal/organizations-panel.tsx` fornece `OrganizationsPanel` com estas props:

| Prop | Contrato |
| --- | --- |
| `organizations` | `OrganizationSummary[]` do snapshot autorizado: `id`, `name`, `slug`, `status`, `version`, `canManage` |
| `currentActor` | `{ userId, isPlatformOwner }`; derivar administração da plataforma de `globalCapabilities`, nunca apenas do nome do papel |
| `people` | Opcional: `OrganizationPerson[]`, projeção `users` já autorizada do snapshot. Somente a plataforma usa essa lista para nomear pessoas de fora da organização; a administração local usa exclusivamente os membros retornados no detalhe protegido |
| `onChanged` | Callback assíncrono ou síncrono para recarregar o snapshot do portal após uma alteração concluída |

O painel permite criar organizações somente na plataforma, editar nome/situação com CAS, recarregar a versão após conflito, conceder/remover administração local após confirmação e preservar o último administrador ativo. A edição mantém rascunho local por conta/organização/versão, apagado após salvar; escolhas administrativas e confirmações não são persistidas como rascunho. O diálogo nativo tem rótulo/descrição, foco inicial em Cancelar, ciclo de Tab/Shift+Tab, Escape quando não está salvando e bloqueio de submissão duplicada. Contas bloqueadas, pendentes e anonimizadas não são candidatas nem contam como substitutas; o detalhe também omite o nome de perfis antigos anonimizados.

`ProjectPanel` passa a receber `organizations` e `isPlatformOwner`. O chamador deve permitir criação quando houver capacidade global correspondente **ou** uma organização ativa com `canManage`. Uma única organização gerenciável aparece com nome fixo e envia seu ID; várias exigem escolha explícita sem seleção inicial. A hierarquia oferece apenas projetos da organização escolhida, e edições conservam o vínculo original. Tipos/unidades compartilhados só aparecem para `isPlatformOwner`. Na ausência da nova prop, a criação fica indisponível; a integração do chamador é necessária antes de publicar a interface. O importador recebeu o mesmo contrato em sua tarefa separada.

`portal-client.tsx` não foi alterado nesta branch: o coordenador integrará a aba/painel, props, visibilidade da criação e atualização do snapshot em conjunto com as demais entregas. A API e os testes independem dessa montagem.

Nove testes adicionais executam os handlers JSX reais com um adaptador inerte de DOM/hooks e encaminham as ações à API/SQLite reais. Cobrem confirmação/cancelamento, duplicidade, revogação concorrente do último administrador, CAS/recarregamento, criação por organização, edição sem transferência, anonimização e ausência de controles administrativos para externos. Essa técnica não simula geometria ou teclado.

Nesta etapa da interface, a suíte completa passou em 410/410 casos no Node 24.22.1; tipos e builds Worker/Node passaram. O lint permaneceu com zero erros e quatro avisos anteriores. Após a inclusão do rascunho, os nove testes de interface e a verificação de tipos/lint dos arquivos alterados foram repetidos e passaram.

Em fixture React separada na porta local 5174, sem credenciais/ambiente de produção, foi conferido o fluxo navegador → API → SQLite: concessão confirmada, cancelamento por Escape, foco/Shift+Tab, projetos locais/plataforma persistidos em organizações distintas, criação/arquivamento e limites do externo. As capturas sintéticas foram inspecionadas. Nos estados verificados em 375/414 px e 1250 px com conteúdo de aproximadamente 950 px, a largura da página permaneceu igual à janela, nenhum controle ficou cortado, os botões medidos tinham pelo menos 44 px e não houve `pageerror`. Evidências locais ignoradas pelo Git: `.sites-runtime/organizations-ui-browser-evidence.json` e `organizations-*.png`. A partir da orientação posterior do coordenador, novas verificações de interface devem usar exclusivamente CUA; o smoke CUA integrado continua pendente, junto do backup/restauração real antes da migração.
