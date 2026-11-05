/** PROEX · Planilha exclusiva de um projeto
 * @OnlyCurrentDoc
 * Instale em Extensões → Apps Script no arquivo indicado na ficha do projeto.
 * Use a chave pxp_ gerada nessa ficha, nunca uma chave da mestre.
 * As abas PROEX · … são reservadas à projeção. As outras abas são preservadas.
 * Uma chave vale 30 dias. Gere outra na ficha, reconecte e revogue a anterior.
 * Compartilhar este arquivo é uma ação independente no Google Drive. Editores
 * também podem editar o script: conceda edição apenas para o escopo de materiais
 * deste projeto. Demandas, agenda, empréstimos e saldos são somente leitura.
 * Este script não lê anexos, não consulta a mestre e não modifica permissões.
 * Artefato gerado por scripts/build-project-sheet-connector.mjs; não editar o
 * arquivo público diretamente. Núcleo de CAS/readback compartilhado com a mestre.
 */
var CONTROL = 'PROEX · Controle', OPERATIONS = 'PROEX · Operações', CONFLICTS = 'PROEX · Conflitos';
var CONNECTOR_VERSION = 'projeto-2026-11-05.1';
function onOpen() {
 SpreadsheetApp.getUi().createMenu('PROEX · Projeto')
  .addItem('Cadastrar material', 'cadastrarMaterial')
  .addItem('Sincronizar agora', 'sincronizarAgora')
  .addSeparator().addItem('Conectar a este projeto…', 'conectar')
  .addItem('Ver estado da conexão', 'verEstado')
  .addItem('Ativar sincronização a cada10minutos', 'ativarAutomatico')
  .addItem('Desativar sincronização automática', 'desativarAutomatico').addToUi();
}
function conectar() {
 var ui=SpreadsheetApp.getUi(),ss=SpreadsheetApp.getActive();
 if(!ss)throw new Error('Abra o arquivo Google vinculado na ficha do projeto.');
 var url=ui.prompt('Endereço do portal','Exemplo: https://proex-gestao.vercel.app',ui.ButtonSet.OK_CANCEL);
 if(url.getSelectedButton()!==ui.Button.OK)return;
 var key=ui.prompt('Chave restrita deste projeto','Na ficha do projeto, abra Planilha sincronizada → Gerar chave. Começa com pxp_ e vale30dias.',ui.ButtonSet.OK_CANCEL);
 if(key.getSelectedButton()!==ui.Button.OK)return;
 var portal=url.getResponseText().trim().replace(/\/+$/,''),token=key.getResponseText().trim();
 if(!/^https:\/\/[^\s/]+$/.test(portal)&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(portal))throw new Error('Informe somente a origem HTTPS do portal, sem caminho.');
 if(!/^pxp_[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Use a chave pxp_ deste projeto. A chave da mestre não é aceita.');
 propriedades_().setProperties({PORTAL_URL:portal,SYNC_TOKEN:token});
 var status=chamar_('proex_sync_describe',{});
 ui.alert('Vínculo confirmado com um único projeto ('+status.configuration.projectId+').\nEscopo: '+status.configuration.scope+'.\nUse PROEX · Projeto → Sincronizar agora. Somente as abas com prefixo PROEX · serão criadas/atualizadas.');
}
function verEstado() {
 var status=chamar_('proex_sync_describe',{}),last=(status.runs||[])[0];
 SpreadsheetApp.getUi().alert(['Conector: '+CONNECTOR_VERSION,'Projeto: '+status.configuration.projectId,'Escopo: '+status.configuration.scope,'Última execução: '+(last?last.status+' em '+(last.finished_at||last.started_at):'nenhuma'),'Chaves são restritas a este arquivo e expiram em30dias. Acesso Google Drive é independente.'].join('\n'));
}
function ativarAutomatico(){chamar_('proex_sync_describe',{});desativarAutomatico();ScriptApp.newTrigger('sincronizarAutomatico').timeBased().everyMinutes(10).create();SpreadsheetApp.getUi().alert('Rotina criada nesta conta para cada10minutos. Confira o histórico de execuções e renove a chave a cada30dias.');}
function desativarAutomatico(){ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='sincronizarAutomatico';}).forEach(function(t){ScriptApp.deleteTrigger(t);});}
function conferirPlanilhaCadastroMaterial_(){var status=chamar_('proex_sync_describe',{});if(status.configuration.scope!=='materials')throw new Error('A chave é de leitura. Para cadastrar materiais, solicite uma chave de materiais ao gestor do projeto.');}
function registrarAbasProjeto_(ss,schemas){var tabs={};schemas.forEach(function(schema){var sheet=ss.getSheetByName(schema.sheetName);if(sheet)tabs[schema.table]=sheet.getSheetId();});chamar_('proex_project_sheet_tabs',{tabs:tabs});}
function chamar_(tool,args) {
 var props=propriedades_(),portal=props.getProperty('PORTAL_URL'),token=props.getProperty('SYNC_TOKEN'),ss=SpreadsheetApp.getActive();
 if(!portal||!token||!ss)throw new Error('Abra esta planilha e use PROEX · Projeto → Conectar a este projeto…');
 var response=UrlFetchApp.fetch(portal+'/api/sync/project-connector',{method:'post',contentType:'application/json',muteHttpExceptions:true,followRedirects:false,headers:{Authorization:'Bearer '+token},payload:JSON.stringify({tool:tool,args:args,spreadsheetId:ss.getId()})});
 var body;try{body=JSON.parse(response.getContentText());}catch(_error){throw new Error('Resposta inesperada do Portal ('+response.getResponseCode()+').');}
 if(!body.ok){var error=new Error((body.code||'erro')+': '+(body.error||'Falha na integração do projeto.'));error.code=body.code;throw error;}
 return body.result;
}
