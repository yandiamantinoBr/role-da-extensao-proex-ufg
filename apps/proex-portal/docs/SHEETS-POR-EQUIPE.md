# Google Sheets por equipe e projeto

## Entrega local de 2026-11-05

Brief: integrantes e gestores precisam abrir uma planilha nativa dedicada à sua equipe, sem receber a planilha mestre nem a projeção integral do projeto. Este primeiro canal permite consultar as demandas atribuídas explicitamente àquela equipe naquele projeto. A edição fica no Portal pelo link de cada linha. Nenhum arquivo Google real foi criado, compartilhado ou alterado nesta implementação.

Pronto neste corte: vínculo exclusivo, chave própria, projeção mínima, confirmação de leitura, abertura nativa, revogação e testes de isolamento. Instalação e autorização do Apps Script no arquivo escolhido continuam sendo uma etapa de ativação real, ainda não realizada por esta frente.

## Onde usar

1. No Portal, abra **Equipes**, escolha uma equipe ativa e **um projeto**.
2. Em **Planilha da equipe**, o link **Abrir no Sheets** aponta somente ao arquivo exclusivo configurado. A visão de todos os projetos não oferece um arquivo agregado.
3. A gestão do projeto pode **Configurar consulta da equipe** e vincular um arquivo nativo vazio, diferente da mestre, dos projetos e de outras equipes.
4. Para gerar a chave, a pessoa precisa manter simultaneamente gestão do projeto e afiliação ativa à equipe. Validade padrão de 7 dias, máximo de 30; 5 chaves ativas por vínculo e 20 emissões por pessoa/dia.
5. No arquivo: **Extensões → Apps Script**, cole `public/integracoes/proex-equipe-planilha.gs`, salve, reabra a planilha e use **PROEX · Equipe → Conectar este arquivo**. O script solicita origem HTTPS e chave daquela equipe. Use **Atualizar demandas**; a rotina de 10 minutos só é criada pela ação explícita no menu.

Vincular o endereço no Portal, sozinho, não sincroniza o arquivo. A interface só exibe confirmação quando o conector encerra uma leitura com quantidade, resumo do conjunto e releitura do conteúdo do Sheets. Esse recibo é evidência declarada pelo cliente; não é atestação criptográfica de uma escrita do Google. A ativação real exige conferir as células no arquivo nativo.

## Contrato técnico e isolamento

- `team_sheet_connections`: um vínculo por `(team_id, project_id)` e um `spreadsheet_id` exclusivo. Alterar o arquivo ou salvar configuração incrementa a versão, revoga as chaves e encerra execuções em andamento. Recibos de versões anteriores não mostram o novo vínculo como atualizado.
- `team_sheet_tokens`: propósito separado `pxt_`, 32 bytes aleatórios, somente SHA-256 persistido. Não é uma chave mestre `pxs_`, de projeto `pxp_`, pessoal MCP `pxm_` nem chave de IA.
- Vinculação exata: emissor, ID de concessão de gestão, ID de afiliação, equipe, projeto, arquivo e versão. Cada consulta revalida os vínculos, a conta ativa e a organização/projeto/equipe ativos. A afiliação não concede ACL.
- Renomear a equipe preserva IDs das afiliações retidas e mantém a consulta. Remover a afiliação revoga permanentemente a chave. Readicionar cria outro ID e não ressuscita a chave antiga. Revogar a concessão capturada também exige nova emissão, mesmo se houver outra concessão disponível.
- `POST /api/sync/team-connector` aceita somente bearer desta finalidade; não usa a sessão do instalador como identidade ampla. Limite persistido por chave: 1.000 chamadas/10 minutos. Não aceita operações de material, estoque, backup, Drive ou aplicação de mudanças.
- Ferramentas: `proex_sync_describe`, `proex_sync_read`, `proex_sync_run_start`, `proex_sync_run_finish`, `proex_team_sheet_tab`. O transporte retorna `{ok:true,result}`. O conector recusa redirecionamentos.
- Projeção única `followup_tasks`: ID, título, estado, prioridade, importância, prazo, versão, criação/atualização e URL do Portal, mais identificadores/resumos técnicos. Exclui corpo, notas, identidades/contatos, anexos, histórico e observações de checklist. A tarefa precisa ter projeto exato e atribuição ativa à equipe.
- Páginas de até 100; conjunto limitado a 5.000 linhas e 8 MiB. Cursor depende de resumo estável. Remover/alterar a atribuição durante a leitura descarta a resposta inteira. A última transação verifica autorização e conjunto completo (quantidade, IDs, campos, versões e atribuições) antes de página, recibo e replay, sem operação assíncrona posterior.
- Execução expira em 10 minutos; request ID é idempotente por chave. Conclusão exige resumo e quantidade atuais, `readbackVerified=true` e uma tabela conferida. Uma consulta recusada não se torna verde por replay de um recibo anterior.

## Migração e colisões

`0028_team_sheet_channels.sql` cria somente as três tabelas e guardas próprias. Não remove o UNIQUE de projeto nem muda o significado do conector existente. O coordenador deve gerar snapshot/journal após compor a migração 0027; esta frente não gerou esses metadados isoladamente.

O preflight falha claramente se houver colisão legada entre mestre e projeto, antes de criar tabelas. Triggers recusam qualquer reutilização de arquivo entre mestre, projeto e equipe nos dois sentidos, inclusive renomear uma linha de configuração para o nome canônico. Colisões reais precisam de diagnóstico e escolha explícita de arquivo exclusivo; a migração não corrige nem move dados reais.

Mover o mesmo arquivo entre pastas preserva seu ID; copiar cria outro ID e requer novo vínculo/CAS, revogação e nova confirmação. O compartilhamento no Google é independente da ACL do Portal. Revogar a chave interrompe novas consultas, mas não apaga dados já recebidos/copiados. Nunca tratar o arquivo de um projeto inteiro como arquivo restrito à equipe por confiar em filtro visual.

## Apps Script e planilha

A chave fica em UserProperties da conta executora. Scripts vinculados podem ser vistos/editados por editores do arquivo; isso não é um cofre contra esses editores. A rotina instalável executa na identidade de quem a autorizou. Restrinja a colaboração do arquivo ao público da projeção mínima.

A aba reservada `PROEX · Demandas da equipe` é sobrescrita somente depois de uma leitura completa bem-sucedida. Outras abas são preservadas. Dados são gravados com RichText literal, inclusive títulos começando por `=`, `+`, `-` ou `@`; somente a coluna de URL gerada pelo servidor recebe hiperlink. Não usa fórmulas provenientes de dados, `DriveApp`, chave em URL, `ScriptProperties`, biblioteca remota ou `eval`. Erro de quota, rede ou autorização antes da coleta completa mantém o conteúdo anterior. Falha após escrita não gera confirmação positiva e permite nova tentativa manual ou pelo próximo acionamento, sem retry pago.

Fontes oficiais consultadas em 2026-11-05: [scripts vinculados e colaboração](https://developers.google.com/apps-script/guides/bound), [UserProperties](https://developers.google.com/apps-script/guides/properties), [identidade de gatilhos instaláveis](https://developers.google.com/apps-script/guides/triggers/installable), [Range.setRichTextValues](https://developers.google.com/apps-script/reference/spreadsheet/range), [RichTextValueBuilder](https://developers.google.com/apps-script/reference/spreadsheet/rich-text-value-builder).

## Edição em Sheets: próxima etapa concreta

Ainda não implementada neste canal. Proposta: colunas de sugestão para estado, prioridade e prazo; chave de proposta, versão-base e ID da tarefa; retorno sem mutação automática; revisão autenticada no Portal por cada pessoa autorizada; diff explícito; aplicação pelo serviço normal de demandas com CAS por tarefa, idempotência e auditoria. A assinatura da conta que instala o script não pode atribuir autoria nem substituir a confirmação individual de quem edita a planilha. Alterações em título, responsáveis, corpo, permissões, materiais ou estoque não entram implicitamente nesse contrato.

A evolução formal do organograma (nós, relações, fontes oficiais e vínculos de equipes) continua em fila própria em `EQUIPES-E-ESTRUTURA.md`; não é pré-requisito nem seed de pessoas reais deste conector.

## Evidências locais

- Serviço/SQL: 12 testes específicos, incluindo duas organizações, equipes/projetos distintos, propósito/arquivo, rename, remoção/reentrada, revogação durante leitura/recibo/replay e colisões SQL.
- UI: 7 testes de parser/CAS, chave mascarada e cópia explícita, resposta tardia após fechar/reabrir, troca de projeto/conta, desmontagem e 401/403.
- Apps Script: testes em VM de protocolo real, ferramentas mínimas, RichText literal, falha de releitura/recibo e recusa antes de tocar a aba. Google nativo ainda não ensaiado neste canal.
- Navegador: 375/390/1366 px, claro/escuro, navegador en-US, zero overflow, controles de ao menos 44 px. Percurso navegador → API real → SQLite em RAM: salvar vínculo, emitir chave mascarada, ler duas demandas, concluir recibo, fechar/reabrir sem chave, revogar e obter 403. Visão de todos os projetos não oferece link.
- Capturas/relatório sintéticos locais: `.sites-runtime/team-sheets-qa/`. Nenhuma chave/dado real utilizado. Revisão independente de SQL/serviço encerrou os P2s de corrida; revisão final de UI/script será registrada no recibo do coordenador.


Revisão independente final do painel isolado: **9,0/10** nos seis recortes capturados, sem P1/P2 visual, sem extrapolar à produção. Subpassos de instalação numerados após sugestão do revisor. Follow-up: mutações usam AbortController e identidade própria por operação; fechar, trocar contexto ou desmontar cancela a requisição, descarta a resposta tardia e libera o novo contexto. O `finally` de uma operação antiga não pode destravar a operação nova. Duas regressões adicionais cobrem POST A pendurado → POST B e resposta de A enquanto B ainda está em andamento. A criação pode já ter sido efetivada no servidor antes do cancelamento; a lista atualizada permite conferir/revogar a conexão sem reapresentar o segredo.
