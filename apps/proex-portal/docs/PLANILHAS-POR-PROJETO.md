# Planilhas Google exclusivas por projeto

Implementado em 05/11/2026. Provisionamento real, autorização Google, compartilhamento e verificação institucional ainda precisam ser executados e registrados separadamente. Os testes descritos aqui usam apenas dados sintéticos. A planilha mestre e seu conector `2026-11-04.1` continuam independentes.

## Como os dados circulam

O arquivo específico recebe apenas a projeção do projeto ao qual foi vinculado. Edições permitidas e cadastros entram nos mesmos serviços do Portal. O banco do Portal permanece a fonte das regras e dos saldos. A próxima sincronização da mestre lê esse estado. Não há `IMPORTRANGE`, fórmula entre arquivos ou concessão de acesso à mestre.

| Projeção | Conteúdo | Alteração na planilha |
| --- | --- | --- |
| Projeto | Identificação, situação, cor, página oficial e local | Leitura |
| Materiais e categorias | Nome, unidade, descrição, identificação patrimonial básica, alerta e condição | Chave `materials`, versão original exigida |
| Estoque | Movimentos e saldos calculados | Saldo somente leitura; movimentos passam por `stock.move` |
| Grupos, empréstimos e campanhas | Resumo operacional sem contatos, responsáveis ou notas privadas | Leitura |
| Agenda | Título, intervalo, situação e URL | Leitura |
| Demandas | Título, prioridade, estado e prazo; sem corpo, responsáveis ou contatos | Desligada por padrão; resumo somente leitura após opção explícita do gestor |

As oito abas padrão têm prefixo **PROEX ·**. Incluir Demandas cria a nona. As demais abas do arquivo institucional são preservadas. As colunas `_rowKey`, `_rowHash`, `id` e `version` são de sistema. Apagar uma linha não exclui registros do Portal. Alterações recusadas ficam na aba de conflitos com o conteúdo desejado; a sincronização não inventa uma versão nem aplica saldos digitados.

Títulos e descrições também podem conter dados pessoais digitados por uma pessoa. Por isso, o resumo de Demandas exige consentimento específico. Habilitá-lo significa permitir que todos os leitores do arquivo no Google vejam os títulos, prioridades, estados e prazos das demandas daquele projeto. Para um arquivo de monitores que só precisa de materiais, mantenha a opção desligada. Corpos, designações, contatos, dados financeiros dos bens, termos, fotos, equipe, configurações e credenciais nunca são projetados.

## Instalação pelo gestor do projeto

1. Escolha um arquivo exclusivo do projeto. Para o CONPEEX, confira a finalidade e os acessos do controle institucional já existente antes de vincular. Não substitua abas existentes nem use a mestre como arquivo de projeto.
2. Na ficha do projeto, abra a seção da planilha sincronizada. Informe o ID do arquivo Google, um nome e a versão apresentada. Deixe o resumo de Demandas desligado se os leitores não puderem ler essas informações.
3. Gere uma chave `read` para leitura ou `materials` para cadastrar materiais, editar seus metadados e registrar movimentos. A chave `pxp_` aparece uma vez e expira em **30 dias**. O servidor guarda somente seu hash.
4. No arquivo Google, abra **Extensões → Apps Script**. Cole `/integracoes/proex-projeto-planilha.gs`. Em Configurações do projeto, exiba o manifesto e use `/integracoes/proex-projeto-appsscript.json`. O manifesto limita acesso às células ao arquivo atual; pede ainda conexão HTTP, barra lateral e gestão dos gatilhos desta conta. Não usa Drive ou Gmail.
5. Salve, recarregue o arquivo e use **PROEX · Projeto → Conectar a este projeto…**. Informe a origem do Portal e a chave restrita. A validação recusa uma chave da mestre ou um ID de arquivo diferente do vínculo.
6. Sincronize manualmente. Confirme a aba **PROEX · Controle**, o estado `verified`, a quantidade de tabelas conferidas e a ausência de conflitos. Faça um cadastro pelo menu **Cadastrar material**, com saldo zero. Edite o nome na coluna amarela, sincronize e confirme no Portal. Edite a descrição no Portal, sincronize e confira a releitura na planilha. Use apenas um material de teste explicitamente identificado e preserve o histórico de teste.
7. Se necessário, ative a rotina de dez minutos. O gatilho funciona sob a conta que o instalou, com a chave nas propriedades daquele usuário. Confira o histórico de execuções; ter um gatilho instalado não comprova sincronização bem-sucedida. Defina responsável pela rotação da chave antes dos 30 dias.

Os escopos mínimos e o fato de gatilhos instaláveis executarem sob a conta de quem os criou seguem a documentação oficial do Google: [escopos de autorização](https://developers.google.com/apps-script/concepts/scopes), [acesso à planilha atual](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app#getActive()), [gatilhos instaláveis](https://developers.google.com/apps-script/guides/triggers/installable).

## Compartilhamento e revogação

O Portal não altera a lista de pessoas do Google Drive. Compartilhe o arquivo específico somente com as pessoas autorizadas a ler sua projeção. Um editor do arquivo também pode editar o Apps Script e potencialmente usar sua chave: o escopo `materials` deve corresponder ao poder que esse editor pode exercer naquele projeto. Para acesso ainda mais limitado, use o Portal com papel específico, ou um arquivo separado só de leitura.

Ter o ID de arquivo na requisição previne configuração acidental no arquivo errado; não é uma prova criptográfica da identidade Google do cliente. A segurança do servidor vem da credencial restrita, dos limites explícitos de projeção/ações e da autorização vigente. A mesma chave não permite ler nem alterar outros projetos, mesmo se o emissor for responsável global.

Revogar a chave, bloquear a conta, retirar a gestão do projeto, arquivar sua organização, desativar o vínculo ou alterar sua versão bloqueia as próximas consultas, replays e transações. Mudar o vínculo revoga todas as suas chaves e encerra rodadas pendentes. Dados já recebidos pelo Google continuam sendo uma cópia: retirar a opção Demandas não apaga uma aba já exportada nem recolhe cópias. Ao reduzir acesso, remova também os leitores/abas/copias no Google conforme a política institucional. Não presuma revogação retroativa de conteúdo.

## Migração para o Drive institucional

- **Mover o mesmo arquivo**, mantendo seu ID: o vínculo do Portal continua válido. Confirme as novas permissões herdadas e se a conta da rotina pode abrir o arquivo. Faça uma rodada manual com releitura e só então confirme a rotina.
- **Copiar para outro arquivo**, com novo ID: interrompa a rotina antiga; preserve os conflitos e a contagem física; salve o novo vínculo usando a versão atual. Isso revoga chaves antigas. Instale/autorize o conector no novo arquivo, gere nova chave e execute a conferência nos dois sentidos. Registre o novo ID/URL e o responsável. Remova o acesso/rotina do arquivo anterior após a validação institucional.
- **Não migrar com fórmulas de acesso à mestre.** A nova planilha se conecta ao Portal com seu próprio escopo. Recibos têm namespace da conexão e preservam a proteção contra repetição da mesma operação ao trocar de arquivo. Não reutilize deliberadamente uma chave de operação para outro conteúdo.

## Contrato para manutenção por outras IAs

`GET /api/projects/{id}/sheets` retorna vínculo, atalhos por aba, escopo de gestão e metadados de chaves. Apenas gestores recebem a lista de chaves; nenhum valor é recuperável. `POST` exige sessão, JSON, `X-Proex-Action: 1` e `Origin` exatamente igual à origem do pedido.

- `configure`: `spreadsheetId`, `label`, `expectedVersion`, `enabled?`, `includeTasks?` (padrão `false`). Toda reconfiguração avança a versão, revoga chaves e limpa atalhos.
- `token.create`: `scope: read | materials`, `label`, `expectedVersion`; retorna `token`, `expiresAt` e metadados na raiz.
- `token.revoke`: `id`.

O conector servidor a servidor é separado: `POST /api/sync/project-connector`, `Authorization: Bearer pxp_…`, corpo `{spreadsheetId,tool,args}`. Descrição, leitura paginada, importação, início/fim e registro de abas são uma lista fechada. Não despache suas chamadas ao handler global nem crie um ator responsável fictício.

Cada transação de domínio reavalia hash/expiração/revogação, vínculo/arquivo/versão, conta ativa, organização ativa e gestão do projeto. Importação resolve o projeto dos IDs no servidor e valida novamente o alvo dentro da transação. CAS e recibo pertencem à mesma transação do serviço. O ID criado também fica no recibo antes do `COMMIT`, para sobreviver à perda da resposta. Os serviços existentes continuam sendo os únicos escritores de metadados e estoque.

Para alterar o script, edite os overrides e rode `node scripts/build-project-sheet-connector.mjs`. O artefato público é estático, derivado de uma lista explícita do núcleo ensaiado da mestre. `--check` detecta divergência. Nunca carregue/eval código remoto no Apps Script.

## Evidência e custo

Vinte testes focais em SQLite descartável e VM do Apps Script passaram: duas organizações, ausência de dados de B e campos privados, dono global limitado à credencial do projeto, leitura sem mutação, cadastro/edição/estoque, ida e volta com o domínio visível para a mestre, replay, CAS, perda de acesso durante leitura, revogação imediatamente antes do `COMMIT`, bloqueio/expiração, troca de arquivo, arquivo mestre recusado, opção de Demandas, origem CSRF, preservação de abas, edição humana durante HTTP e atalhos.

Benchmark sintético local com duas organizações e **1.002 materiais**: a exportação de dados do projeto fez **13 chamadas** para **502 linhas**, contra **45 chamadas** para **1.013 linhas** da mestre. Cada chamada incluiu o `rateLimit` real, cuja limpeza/incremento usa uma transação de persistência. Isso reduz em **71%** essas transações de leitura paginada nesse conjunto. Amostra observada: 351 ms contra 1.444 ms; são números de bancada, sem HTTP/Google/Supabase e sem garantia de latência em produção. Início, fim, registro de abas e verificação da credencial acrescentam chamadas aos dois fluxos.

O limite de requisições persistente ainda causa uma gravação do instantâneo por chamada HTTP; o indicador `last_used_at` é atualizado no máximo uma vez por minuto. A projeção reduz o volume e as páginas, mas não elimina esse gargalo estrutural. Medir a persistência real e avaliar um limitador distribuído que não regrave o snapshot inteiro permanece uma tarefa de infraestrutura, antes de ampliar o número de arquivos/gatilhos. Sem custo adicional de provedor de e-mail, IA ou serviço pago criado por esta funcionalidade.
