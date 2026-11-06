---
data: 2026-11-06
status: backend, fluxos de contexto e avisos 0034 conferidos; captura final pendente
base: e87159d26797737ada2275864135d4541d780165
ambiente: worktree local; SQLite sintético
---

# Revisão independente — edição, rastreio e pré-cadastros

## Escopo e limites

Revisão de código e execução de testes no worktree `edicao-e-rastreio-06nov`. O backend de estoque contextual e de pré-cadastros foi implementado por outras frentes. Esta revisão não alterou esses arquivos.

O parecer independente exclui `follow-up-panel.tsx` e `material-detail-drawer.tsx`, implementados pelo próprio revisor. A conferência desses dois componentes deve ser atribuída a outra frente. O documento não atribui nota estética e não substitui inspeção visual, publicação, migração real ou teste autenticado em produção.

## Backend: resultado após as correções

Não restou P0, P1 ou P2 identificado no backend do escopo abaixo após a revisão e o novo teste em fonte estabilizada:

- `lib/stock-context.ts`, integração em `lib/materials.ts`, `db/stock-context-schema.ts`, migração `0032` e rotas de contexto/consumo de materiais.
- `lib/directory/*`, `db/directory-schema.ts`, migração `0033` e `/api/directory`.

**35/35 testes passaram** nesta execução independente:

```powershell
node --test tests/stock-context.test.mjs tests/directory.test.mjs tests/materials.test.mjs tests/materials-v4.test.mjs
```

São 13 testes de estoque contextual, oito de diretório e 14 regressões de materiais. O resultado é de funções e SQLite sintético; os códigos HTTP, os cabeçalhos privados e a proteção de origem das rotas também foram inspecionados em fonte, sem afirmar teste real dessas rotas em produção.

### Acesso e dados retornados

- O catálogo de contrapartes faz uma leitura atômica com guarda do projeto de estoque e consulta da autoridade atual das contrapartes.
- Leituras de consumo e detalhe removem ID, nome e link de projetos contraparte sem acesso. O filtro por unidade também exige autoridade sobre o projeto contraparte; não serve como canal indireto para descobrir a unidade de um projeto oculto.
- Os agrupamentos ocultos não mantêm IDs distintos. Processos e identificações informadas pertencem ao registro do estoque autorizado; a relação com outra unidade ou projeto não concede acesso nem transfere saldo.
- Responsáveis dos indicadores de consumo são derivados das atribuições e permissões atuais. O incremento inicial de rastreio não criava campainha; a migração `0034`, revisada separadamente abaixo, acrescenta avisos persistentes no aplicativo. Não cria tarefa ou e-mail.

### Escritas, histórico e pré-cadastros

- Movimento físico, contexto e auditoria são gravados no mesmo batch. Os gatilhos validam escopo ativo, contraparte, nome/unidade do item e data do contexto; falha provoca rollback integral.
- O contexto e o movimento físico são imutáveis. Repetir uma chave preserva o resultado; alterar o significado da repetição é rejeitado. Registros antigos sem contexto continuam sem classificação, sem preenchimento retroativo inventado.
- O diretório exige administração atual da organização em leitura, escrita, histórico e repetição. CAS, chave de operação, escrita, histórico e auditoria compartilham a transação.
- Pré-cadastro não cria conta, autenticação, convite, associação, atribuição ou notificação. Contato publicado não significa e-mail verificado. Referências que precisam de revisão permanecem sinalizadas; adaptação manual preserva a fonte e o histórico.

### Datas e previsão

- A amostra começa na observação do próprio material/unidade de medida, em vez de presumir que todo o intervalo escolhido já era observado.
- Histórico com unidade ausente ou alterada impede a previsão. Materiais recentes não recebem artificialmente uma amostra de 30 dias.
- O esgotamento usa a data civil de Brasília, inclusive quando o dia UTC já avançou. A previsão continua sendo estimativa baseada em saídas observadas, sem presumir reposições futuras.

## Histórico negativo e correções comprovadas

1. **Geração de migração apagou temporariamente gatilhos customizados de `0032`.** Uma execução durante a recomposição falhou no teste de imutabilidade: `Missing expected exception`, esperado `stock_context_immutable`. A frente responsável reanexou validação e imutabilidade ao DDL gerado. O novo teste passou. Futuras gerações devem preservar esses gatilhos e executar os testes; a correspondência com o snapshot Drizzle não dispensa as regras SQL adicionais.
2. **Amostra de previsão diluída pelo filtro.** Três dias de um material recente podiam ser divididos por todo o intervalo de 30 dias; a troca de unidade também não invalidava suficientemente a cobertura. Foi implementada cobertura individual e bloqueio por unidade incompatível, com testes de material recente e mudança de medida.
3. **Dia de esgotamento deslocado depois das 21h em Brasília.** A projeção extraía a data UTC. Foi corrigida para a data civil de Brasília e testada com relógio noturno controlado.
4. **Janela de revogação no catálogo de contrapartes.** A validação final anterior conferia somente o projeto de estoque, após nomes/IDs das contrapartes já terem sido lidos. A consulta foi convertida para batch atômico com autoridade viva das contrapartes; o teste de revogação passou.
5. **Suspeita de snapshot de unidade concorrente foi refutada antes do aceite.** O gatilho de `0032` já compara nome e unidade com o item dentro do batch. Foi acrescentado teste de edição concorrente para comprovar rollback, sem registrar a suspeita como defeito restante.

## Interface: achados corrigidos e testados

Revisão somente leitura de `project-detail`, `project-panel`, `project-quick-entry`, `stock-context-fields`, `stock-consumption-panel`, `stock-unit-dialog` e montagem em `portal-client`. A coordenação alterou os componentes; o revisor acrescentou somente testes independentes e este parecer.

| Achado | Estado neste checkpoint | Correção solicitada |
|---|---|---|
| Reserva rápida dependia de `relationships.items`, que só é retornado com `inventory.read`; o papel de empréstimos pode ter `loans.manage` sem essa capacidade. | P2 corrigido e testado | `loanEquipment` contém somente ID, nome e categoria, protegido por `loans.manage`. O teste real do papel de empréstimos confirma inventário completo ausente e catálogo mínimo presente no modal. |
| Exportação de consumo validava o servidor duas vezes, mas podia terminar depois de trocar seleção/filtros/projeto ou desmontar o painel. | P2 corrigido e testado | Chave de seleção e guarda de montagem impedem download de exportação atrasada. Testes adiam a preparação e mudam seleção, projeto ou desmontam o painel; nenhum arquivo é baixado. O caminho estável baixa uma vez após a segunda consulta. |
| Modo de material podia sobreviver a navegação/retorno e ser reutilizado por uma entrada que deveria apenas abrir a ficha. | Corrigido e testado | Os próprios handlers de navegação, restauração da rota, projeto, unidade e área foram executados em teste e retornam ao modo de consulta. O catálogo também abre explicitamente nesse modo. |
| Link de registros do projeto passava `project` na URL, mas a montagem anterior de `RecordsPanel` não consumia esse projeto nos filtros internos. | P2 corrigido e testado | `initialProjectId` e a chave por filtro chegam ao painel. A primeira consulta e o seletor interno usam o projeto indicado. |
| Cadastro rápido chamava `onSaved` após aguardar a escrita mesmo se a navegação desmontasse o modal; a ficha antiga podia abrir seu material sobre um novo projeto. | P2 corrigido e testado | Guarda de montagem impede callback tardio. O modal conserva seu alvo fora do fragmento transitório de carregamento para que a atualização normal da mesma ficha não seja confundida com saída. Os dois cenários e a prevenção de envio duplicado passaram. |

**7/7 testes independentes de contexto passaram**, além dos 35 de backend. O arquivo de teste passou no ESLint:

```powershell
node --test tests/project-context-actions.test.mjs
node node_modules/eslint/bin/eslint.js tests/project-context-actions.test.mjs
```

Esses testes executam os componentes/handlers e controlam as promessas de escrita e exportação; as fronteiras de navegador são simuladas. Não afirmam que PDF, DOCX ou XLSX reais foram reabertos pelo revisor.

## Avisos persistentes: revisão independente da migração 0034

Escopo adicional, implementado por outra frente e revisado em fonte congelada: `drizzle/0034_material_attention.sql`, `db/material-attention-schema.ts`, `lib/material-attention.ts`, contratos, `/api/material-attention` e `MaterialAttentionInbox`. Não houve alteração de implementação pelo revisor. A montagem visual final da campainha permanece dependente da verificação integrada da coordenação.

**18/18 testes passaram nesta execução independente:** 11 de serviço e SQLite, cinco de interface e dois de rota. Somados aos 42 anteriores, são 60 testes independentes destes escopos; a contagem não representa a suíte completa do Portal.

```powershell
node --test tests/material-attention.test.mjs tests/material-attention-route.test.mjs tests/material-attention-inbox.test.mjs
```

Não restou P0, P1 ou P2 identificado nesse escopo após a correção da transição de resgate. As garantias conferidas foram:

- O episódio nasce somente no cruzamento de disponível acima do mínimo para no mínimo ou abaixo, provocado por nova movimentação manual do Portal ou ajuste do mínimo. Instalar a migração, cadastrar saldo inicialmente baixo, consultar a página e criar reserva não geram avisos retroativos. Equipamentos e materiais inativos são excluídos.
- Índice único impede dois episódios abertos por material. Recuperação real de disponibilidade, redução do mínimo e desativação resolvem o episódio. A próxima queda usa outra identidade e outros recibos; o histórico de episódios anteriores é imutável.
- A consulta exige simultaneamente conta ativa, acesso atual a materiais e responsabilidade explícita atual pelo material, área ou projeto. Equipes precisam estar ativas na mesma organização. Cargo de administrador e pré-cadastro não concedem recebimento automático; múltiplas designações são deduplicadas por existência.
- ID, título, quantidade e link somente são retornados para episódios autorizados. Não entram SEI, beneficiário ou contatos nesse DTO. A dupla leitura rejeita mudanças intermediárias de estoque ou acesso com resposta de atualização, sem devolver títulos antigos.
- Ler, dispensar e reexibir alteram recibos somente do usuário autenticado. A escrita e a auditoria compartilham batch com autorização viva; nova autorização depois do commit também protege a resposta e repetições. A chave de operação exige o mesmo significado. A disputa concorrente recuperada agora responde `duplicate: true`.
- As rotas exigem origem, cabeçalho de ação e JSON nas escritas, limitam o corpo e rejeitam campos duplicados ou desconhecidos. Respostas e erros são privados e sem cache. O cliente confere a identidade do envelope, cancela consultas/escritas antigas e remove dados em erro de acesso ou troca de conta.
- O incremento não envia e-mail, não cria conta, convite ou permissão e não altera o livro de movimentos por meio dos recibos. A opção de dispensar não resolve a falta física para os demais responsáveis.

### Histórico negativo adicional: reserva e entrega de prêmio

A liberação de reserva consumida ocorre antes da inserção da saída de prêmio no mesmo batch. O disponível sobe temporariamente e volta ao valor líquido anterior. Essa etapa intermediária podia encerrar um episódio existente ou provocar um falso cruzamento seguinte. A coordenação identificou o problema durante a prova de integração; a frente de avisos passou a reconhecer a entrega `consumed`/`delivered` ainda sem sua linha `prize:*` e restringiu a criação por estoque a movimentos manuais elegíveis.

O teste final executa os serviços reais `participation.ticket` → `participation.physical` → `prize.redeem`, tanto sem episódio prévio quanto com episódio aberto. Confirma disponível líquido preservado, nenhuma criação indevida e nenhuma resolução transitória. A liberação real de reserva continua podendo resolver um episódio, sem ser confundida com reposição física. Rollback do livro de movimentos também desfaz o episódio.

Limites deliberados: saldo baixo anterior não recebe aviso retroativo; reserva isolada e resgate não iniciam episódio neste incremento; não há e-mail ou tarefa automática. O registro SQL é persistente, mas implantação real da migração e aceite da campainha no navegador final não são comprovados por esta bateria sintética.

## Eventos públicos e data/hora: escopo adicional somente leitura

Foram inspecionados `lib/public-events.ts`, índice e detalhe da API de eventos, redirecionamento SSR de rascunho, índice público e `DateTimeField`. **9/9 testes específicos passaram:** cinco de eventos públicos/SQLite e quatro dos contratos de data/hora. Não restou P0, P1 ou P2 identificado nessa revisão de fonte.

```powershell
node --test tests/public-events.test.mjs tests/date-time-field.test.mjs
```

O índice retorna apenas identificador público, nome, local, situação e início/fim. Não inclui projeto ou identidade. Rascunhos e identificadores desconhecidos têm resultado público ausente; encerramento que nunca foi publicado não torna o rascunho público. Pausados/encerrados exigem auditoria anterior de ativação, e projetos/organizações arquivados retiram o evento da projeção. O destino privado de rascunho só é calculado com autoridade SQL atual; material sem acesso a campanhas não concede esse caminho.

O editor usa data brasileira e hora de 24 horas, mantendo valor canônico local para o formulário. Os testes desta bateria validam os helpers e limites; não comprovam interação React, restauração de rascunho ou reset no navegador. Foi comunicado um P3 preventivo: `readOnly` recebido pelo componente chega à data, mas não ao campo de hora. Nenhum consumidor atual usa essa propriedade; ela precisa ser propagada antes de adotar o editor como campo somente leitura.

Com este escopo, foram executados 69 testes independentes distintos entre os grupos acima. Isso continua separado da suíte integrada, das capturas finais e da produção.

## Inspeção visual parcial

Foram vistas as capturas sintéticas de consumo em 390 e 1366 px, claro/escuro; ficha de projeto em 390/1366; e diretório em 375/390/1366. Consumo apresenta datas no padrão brasileiro, controles com alvos visíveis, barra com quantidade e contraste legível nas composições vistas. Os detalhes de cobertura e histórico estavam recolhidos nessas capturas; seu estado expandido não recebe aceite visual aqui.

A captura antiga da ficha em 1366 px tinha grande sobra vazia ao lado da lista de materiais. A coordenação informou uma composição posterior com quatro itens iniciais, expansão e coluna complementar empilhada; é necessária recaptura para julgar esse resultado.

As capturas do diretório foram produzidas por `locator.screenshot` e mostram artefatos de posição: cabeçalho/link de pular conteúdo dentro da imagem longa e conteúdo cortado à esquerda na versão de 1366 px. As verificações geométricas relatadas não substituem uma imagem inspecionável. Foi solicitada recaptura estável, com foco/rolagem controlados e sem avisos transitórios. Isso não foi classificado automaticamente como defeito de CSS.

**Não há nota estética final neste checkpoint.** O resultado dos testes de fluxo não foi convertido em nota visual nem usado para ignorar essas lacunas.

## Continuidade

Antes da publicação, concluir as capturas finais, executar os gates integrados, inspecionar teclado/mobile e confirmar a revisão publicada. Manter separados: código local, aplicação das migrações, dados reais, sincronização Sheets e aceite em produção. Esta revisão não ativou integrações externas nem revisou os componentes de autoria do próprio revisor como independentes. Novos pedidos fora deste escopo precisam de suas próprias evidências.
