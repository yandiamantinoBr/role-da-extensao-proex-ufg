# Meu trabalho — contrato de montagem da UI V15

Estado: componentes isolados, sem mudança de navegação ou publicação. A validação visual e as APIs integradas continuam sendo gates do coordenador.

## Central pessoal

`components/portal/meu-trabalho-panel.tsx`, exportação padrão `MeuTrabalhoPanel`.

- `userId`: identidade canônica da sessão, obrigatória. Montar também com `key={userId}`.
- `organizationId` e `projectId`: contexto explícito ou `null`. Não passar unidade ou área temática como organização.
- `onOpenTask(id, {organizationId, projectId})`: opcional; o coordenador pode selecionar o projeto e abrir Demandas com `demandId`.
- `onOpenTarget(target, context)`: opcional; só é chamado quando `target.canOpen` é verdadeiro. Permite abrir o registro autorizado existente. Sem callback, há navegação nativa pelo `href` canônico da API.

A central consulta `/api/my-work`, com seis registros por página, paginação independente para demandas e designações. Cartões acionam filtros SQL reais, incluindo `attention`, `due_today`, `in_progress` e `completed`. Os totais e a distribuição por módulo vêm da população completa da API; não são inferidos da página nem da autoria dos registros. Atribuição direta e por equipe são indicadas separadamente, incluindo `both`. Designações e demandas têm unidades diferentes e não são somadas.

`today` vem da consulta do servidor, em Brasília, e é passado ao `TaskSignals` compartilhado. Atualização manual e evento `proex:followup-changed` renovam os dados; não há polling nem persistência local de nomes. O coordenador pode disparar esse evento ao mudar o contexto operacional ou após uma alteração. Uma central deixada aberta durante a virada do dia exige atualização para renovar a classificação de prazos.

## Gestão de designações

`components/portal/responsibility-manager.tsx`, exportação padrão `ResponsibilityManager`.

- `userId`, `projectId` e `area` são obrigatórios.
- `area`: `projects | materials | loans | campaigns`.
- `itemId`, `loanId` e `campaignId`: opcionais; somente o identificador correspondente à área pode ser preenchido. Ausência significa designação geral daquela área no projeto, consultada com `target=area`.
- `onChanged()`: opcional, chamado uma vez após confirmação válida e apenas enquanto a montagem ainda pertence à mesma conta/alvo.

Montar no detalhe da entidade já visível e com permissão vigente; o componente não descobre entidades privadas nem amplia ACL. A interface também exige `catalog.canManage` e, quando existe registro, `record.canEdit`. O servidor continua responsável pela autorização final. O coordenador decide o ponto de montagem em cada aba; os títulos da UI não substituem identificação visível do registro no pai.

Catálogo e lista são consultados em paralelo. `status=all` recupera a versão de uma designação revogada, necessária para reativar com CAS; responsáveis históricos não são pré-selecionados. Alterações enviam `expectedVersion` e `operationKey`; uma repetição da mesma ação após erro conserva a chave. Revogação exige confirmação separada. Conflitos preservam a seleção; recarregar a designação descarta a seleção local e busca a versão atual.

## Isolamento e verificação

Ambos os componentes validam DTO canônico, `viewerId`, contexto/alvo, status e paginação antes de apresentar dados. Chaves de consulta ocultam imediatamente respostas de outra conta ou contexto, inclusive antes da limpeza dos efeitos. Abortos e gerações descartam respostas tardias. Erros HTTP 401/403 removem nomes e ações; respostas HTTP 200 inválidas não viram lista vazia ou sucesso. Títulos e links de alvo restrito são ignorados mesmo se enviados indevidamente no DTO.

`tests/my-work-panel-state.test.mjs` executa TSX, handlers, efeitos, fetch falso e os validadores reais; não compara texto-fonte. Cobre filtros/paginação/totais, troca de conta/contexto, corrida entre handler e cleanup, erro de contrato, 403, reativação/revogação, CAS, retry e callbacks obsoletos. `work-signals.test.mjs` mantém os testes do componente compartilhado do coordenador.

CSS local usa container queries, métricas em duas colunas abaixo de 680px e listas em uma coluna, sem largura mínima fixa. Interações têm altura mínima de 44px. Essa estrutura foi lida e testada em harness; não equivale a medição de layout. Restam CUA integrada em 320/375/414/1250, claro/escuro, navegação por teclado e abertura dos detalhes reais, incluindo estado sem atribuições, alvo restrito e catálogos parciais.
