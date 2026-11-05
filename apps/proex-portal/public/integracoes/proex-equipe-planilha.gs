/**
 * PROEX · Equipe e projeto — somente consulta, versão 1.
 * Cole em Extensões > Apps Script de um arquivo exclusivo e salve.
 * A chave fica nas propriedades do usuário executor. Editores do arquivo
 * também podem editar o script; compartilhe somente com a equipe autorizada.
 * @OnlyCurrentDoc
 */
var TEAM_SHEET_TAB = 'PROEX · Demandas da equipe';
var TEAM_HEADERS = ['ID técnico','Resumo técnico','ID da demanda','Demanda','Estado','Prioridade','Importância','Prazo (ISO)','Versão','Criada em','Atualizada em','Editar no Portal'];
var TEAM_FIELDS = ['_rowKey','_rowHash','id','title','status','priority','importance','due_at','version','created_at','updated_at','portal_url'];
function onOpen() {
 SpreadsheetApp.getUi().createMenu('PROEX · Equipe').addItem('Conectar este arquivo', 'conectarEquipe').addItem('Atualizar demandas', 'atualizarEquipe').addItem('Ver situação', 'situacaoEquipe').addSeparator().addItem('Ativar atualização a cada 10 minutos', 'ativarEquipe').addItem('Desativar atualização automática', 'desativarEquipe').addToUi();
}
function conectarEquipe() {
 var ui=SpreadsheetApp.getUi(), url=ui.prompt('Endereço do Portal', 'Cole somente o endereço HTTPS do Portal PROEX.',ui.ButtonSet.OK_CANCEL);
 if(url.getSelectedButton()!==ui.Button.OK)return;
 var origin=url.getResponseText().trim().replace(/\/$/,'');
 if(!/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(origin))throw new Error('Use o endereço HTTPS do Portal, sem caminhos.');
 var key=ui.prompt('Chave da equipe', 'Cole a chave pxt_ gerada para esta equipe, projeto e arquivo.',ui.ButtonSet.OK_CANCEL);
 if(key.getSelectedButton()!==ui.Button.OK)return;
 if(!/^pxt_[A-Za-z0-9_-]{43}$/.test(key.getResponseText().trim()))throw new Error('Use uma chave de consulta da equipe.');
 var props=PropertiesService.getUserProperties(), previous=props.getProperties();
 props.setProperties({PROEX_TEAM_ORIGIN:origin,PROEX_TEAM_KEY:key.getResponseText().trim(),PROEX_TEAM_FILE:SpreadsheetApp.getActive().getId()});
 try { var result=consultarEquipe_('proex_sync_describe',{});if(!result.configuration.readOnly||result.configuration.spreadsheetId!==SpreadsheetApp.getActive().getId())throw new Error('O arquivo não corresponde ao vínculo.'); }
 catch(error){['PROEX_TEAM_ORIGIN','PROEX_TEAM_KEY','PROEX_TEAM_FILE'].forEach(function(name){if(previous[name]===undefined)props.deleteProperty(name);else props.setProperty(name,previous[name]);});throw error;}
 ui.alert('Conexão conferida. Use Atualizar demandas para preencher a aba reservada. A edição continua no Portal.');
}
function consultarEquipe_(tool,args) {
 var props=PropertiesService.getUserProperties(), base=props.getProperty('PROEX_TEAM_ORIGIN'), key=props.getProperty('PROEX_TEAM_KEY'), file=props.getProperty('PROEX_TEAM_FILE');
 if(!base||!key||file!==SpreadsheetApp.getActive().getId())throw new Error('Conecte este arquivo com sua chave de equipe.');
 var response=UrlFetchApp.fetch(base+'/api/sync/team-connector',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+key},payload:JSON.stringify({tool:tool,args:args,spreadsheetId:file}),muteHttpExceptions:true,followRedirects:false});
 var body;try{body=JSON.parse(response.getContentText());}catch(_){throw new Error('O Portal não retornou uma resposta válida.');}
 if(response.getResponseCode()!==200)throw new Error(body.error||'O Portal recusou a consulta. Confira o acesso e a validade da chave.');
 if(body.ok!==true||!body.result||typeof body.result!=='object')throw new Error('O Portal retornou uma resposta incompleta.');
 return body.result;
}
function atualizarEquipe(){ atualizarEquipe_(); }
function atualizarEquipeAutomatico(){ atualizarEquipe_(); }
function atualizarEquipe_() {
 var lock=LockService.getUserLock();if(!lock.tryLock(1000))return;
 var run=null,rows=[],digest=null,started=Date.now();
 try {
  var info=consultarEquipe_('proex_sync_describe',{}),config=info.configuration;
  if(!config.readOnly||config.spreadsheetId!==SpreadsheetApp.getActive().getId())throw new Error('O arquivo não corresponde à consulta de equipe.');
  run=consultarEquipe_('proex_sync_run_start',{requestId:Utilities.getUuid()});
  var cursor=null,total=null;
  do {
   if(Date.now()-started>240000)throw new Error('A consulta excedeu o tempo. Tente novamente.');
   var args={table:'followup_tasks',limit:100,runId:run.id};if(cursor){args.after=cursor;args.expectedDigest=digest;}
   var page=consultarEquipe_('proex_sync_read',args);
   if(!page.readOnly||!Array.isArray(page.rows)||page.rows.length>100||!/^[a-f0-9]{64}$/.test(page.digest)||!Number.isInteger(page.total)||page.total<0||page.total>5000||digest&&page.digest!==digest||total!==null&&page.total!==total)throw new Error('A projeção mudou ou veio incompleta. Tente novamente.');
   digest=page.digest;total=page.total;rows=rows.concat(page.rows);cursor=page.nextCursor;
   if(rows.length>5000||cursor!==null&&typeof cursor!=='string'||cursor&&page.rows.length===0)throw new Error('Página de consulta inválida.');
  }while(cursor);
  if(rows.length!==total)throw new Error('A quantidade de demandas está incompleta.');
  var ss=SpreadsheetApp.getActive(),sheet=ss.getSheetByName(TEAM_SHEET_TAB)||ss.insertSheet(TEAM_SHEET_TAB);
  escreverEquipe_(sheet,rows,config);
  SpreadsheetApp.flush();conferirEquipe_(sheet,rows);
  consultarEquipe_('proex_team_sheet_tab',{gid:sheet.getSheetId()});
  var receipt=consultarEquipe_('proex_sync_run_finish',{id:run.id,status:'completed',exportedCount:rows.length,readbackVerified:true,tablesVerified:1,snapshotDigest:digest});
  if(receipt.status!=='completed')throw new Error('O Portal não confirmou esta atualização. Consulte novamente.');
  PropertiesService.getUserProperties().setProperty('PROEX_TEAM_LAST_OK',new Date().toISOString());
  ss.toast(rows.length+' demandas conferidas. Edição pelo link do Portal.','PROEX · Equipe',6);
 } catch(error) {
  if(run)try{consultarEquipe_('proex_sync_run_finish',{id:run.id,status:'failed',exportedCount:rows.length,readbackVerified:false,tablesVerified:0});}catch(_){}
  throw error;
 } finally {lock.releaseLock();}
}
function textoEquipe_(value){return value===null||value===undefined?'':String(value);}
function matrizEquipe_(rows){return [TEAM_HEADERS].concat(rows.map(function(row){return TEAM_FIELDS.map(function(field){return textoEquipe_(row[field]);});}));}
function escreverEquipe_(sheet,rows,config) {
 var data=matrizEquipe_(rows),height=Math.max(data.length,sheet.getLastRow(),2);
 if(sheet.getMaxRows()<height)sheet.insertRowsAfter(sheet.getMaxRows(),height-sheet.getMaxRows());
 if(sheet.getMaxColumns()<TEAM_FIELDS.length)sheet.insertColumnsAfter(sheet.getMaxColumns(),TEAM_FIELDS.length-sheet.getMaxColumns());
 // RichText stores literal text, including = + - @; source titles never become formulas.
 var rich=data.map(function(row){return row.map(function(value,index){var builder=SpreadsheetApp.newRichTextValue().setText(value);if(index===11&&/^https?:\/\//.test(value))builder.setLinkUrl(value);return builder.build();});});
 sheet.getRange(1,1,height,TEAM_FIELDS.length).clearContent();
 sheet.getRange(1,1,data.length,TEAM_FIELDS.length).setRichTextValues(rich);
 sheet.getRange(1,1,1,TEAM_FIELDS.length).setBackground('#3b1753').setFontColor('#ffffff').setFontWeight('bold');
 sheet.getRange(1,4).setNote('Somente consulta · '+config.teamName+' · '+config.projectName+'. Esta aba é atualizada pelo Portal e será sobrescrita. Use Editar no Portal. Outras abas não são alteradas.');
 sheet.setFrozenRows(1);sheet.hideColumns(1,3);sheet.setColumnWidth(4,360);sheet.setColumnWidths(5,8,150);
 sheet.getRange(1,1,data.length,TEAM_FIELDS.length).setWrap(true).setVerticalAlignment('top');
}
function conferirEquipe_(sheet,rows) {
 var expected=matrizEquipe_(rows),actual=sheet.getRange(1,1,expected.length,TEAM_FIELDS.length).getDisplayValues();
 if(JSON.stringify(actual)!==JSON.stringify(expected)||sheet.getLastRow()!==expected.length)throw new Error('O conteúdo do Sheets não corresponde à consulta. Não foi confirmado.');
}
function situacaoEquipe(){var info=consultarEquipe_('proex_sync_describe',{});SpreadsheetApp.getUi().alert(info.configuration.teamName+' · '+info.configuration.projectName+'\nSomente consulta. Última confirmação deste usuário: '+(PropertiesService.getUserProperties().getProperty('PROEX_TEAM_LAST_OK')||'ainda não houve')+'.');}
function ativarEquipe(){consultarEquipe_('proex_sync_describe',{});desativarEquipe_();ScriptApp.newTrigger('atualizarEquipeAutomatico').timeBased().everyMinutes(10).create();SpreadsheetApp.getUi().alert('Atualização ativada para a conta que autorizou a rotina. A chave expira em até 30 dias e depende do acesso e vínculo atuais.');}
function desativarEquipe_(){ScriptApp.getProjectTriggers().forEach(function(trigger){if(trigger.getHandlerFunction()==='atualizarEquipeAutomatico')ScriptApp.deleteTrigger(trigger);});}
function desativarEquipe(){desativarEquipe_();SpreadsheetApp.getUi().alert('A atualização automática desta conta foi desativada.');}
