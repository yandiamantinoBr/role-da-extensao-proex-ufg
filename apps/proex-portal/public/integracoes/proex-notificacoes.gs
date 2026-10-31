/**
 * PROEX · Avisos opcionais via MailApp. Instale somente em projeto separado do conector/backup.
 * Não usa GmailApp, caixa de entrada, aliases, CC/BCC ou anexos.
 * Não ative antes de escolher e confirmar a conta remetente no portal.
 * MailApp requer script.send_mail; identidade requer userinfo.email;
 * UrlFetch/gatilhos usam seus escopos próprios. Nenhum OAuth é executado pelo código local.
 */
function avisoPropriedades_() { return PropertiesService.getUserProperties(); }
function onOpen() { menuAvisosEmail(); }
var NOTIFY_BUDGET_MS = 4 * 60 * 1000, NOTIFY_BATCH_MAX = 3;
function avisoErro_(code) { var error = new Error(code); error.noticeCode = code; return error; }
function avisoEmail_(value) { var normalized = String(value || '').trim().toLowerCase(); if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/.test(normalized) || normalized.length > 254) throw avisoErro_('email_effective_account_unavailable'); return normalized; }
function avisoConta_() { try { return avisoEmail_(Session.getEffectiveUser().getEmail()); } catch (_) { throw avisoErro_('email_effective_account_unavailable'); } }
function avisoEstado_(value) { avisoPropriedades_().setProperty('EMAIL_LAST_STATE', JSON.stringify(value)); }
function avisoApi_(body) {
  var props = avisoPropriedades_(), portal = props.getProperty('PORTAL_URL'), token = props.getProperty('SYNC_TOKEN');
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::443)?$/.test(portal || '') || !/^pne_[A-Za-z0-9_-]{40,60}$/.test(token || '')) throw avisoErro_('email_connection_required');
  var response;
  try { response = UrlFetchApp.fetch(portal + '/api/follow-up/email', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify(body), muteHttpExceptions: true, followRedirects: false }); } catch (_) { throw avisoErro_('email_transport_uncertain'); }
  if (response.getResponseCode() !== 200) { var code = ''; try { code = JSON.parse(response.getContentText()).code; } catch (_) {} throw avisoErro_(/^email_[a-z_]{1,60}$/.test(code || '') ? code : 'email_request_rejected'); }
  try { return JSON.parse(response.getContentText()); } catch (_) { throw avisoErro_('email_response_invalid'); }
}
function conectarAvisosEmail() {
  var ui = SpreadsheetApp.getUi(), portal = ui.prompt('Origem do portal', 'Origem HTTPS oficial, sem caminho. Esta planilha deve ser exclusiva dos avisos.', ui.ButtonSet.OK_CANCEL);
  if (portal.getSelectedButton() !== ui.Button.OK) return;
  var origin = portal.getResponseText().trim().replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::443)?$/.test(origin)) throw avisoErro_('email_connection_required');
  var token = ui.prompt('Credencial restrita de avisos', 'Use a credencial pne_ exclusiva desta organização, criada no painel de avisos. Nunca coloque o valor em células.', ui.ButtonSet.OK_CANCEL);
  if (token.getSelectedButton() !== ui.Button.OK) return;
  var value = token.getResponseText().trim(); if (!/^pne_[A-Za-z0-9_-]{40,60}$/.test(value)) throw avisoErro_('email_connection_required');
  avisoPropriedades_().setProperties({ PORTAL_URL: origin, SYNC_TOKEN: value });
  ui.alert('Conexão guardada somente nas propriedades desta conta neste projeto separado. Prepare a organização e a conta efetiva. Nenhum envio ou gatilho foi ativado.');
}
function configurarAvisosLocais() {
  var ui = SpreadsheetApp.getUi(), reply = ui.prompt('Organização dos avisos', 'Copie o ID da organização configurada no portal. Esta ação não ativa envio.', ui.ButtonSet.OK_CANCEL);
  if (reply.getSelectedButton() !== ui.Button.OK) return;
  var organizationId = reply.getResponseText().trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(organizationId)) throw avisoErro_('email_invalid_organization');
  var actual = avisoConta_(), status = avisoApi_({ action: 'dispatch.status', organizationId: organizationId, installerEmail: actual });
  if (!status.configuration || status.configuration.senderEmail !== actual) throw avisoErro_('email_sender_mismatch');
  avisoPropriedades_().setProperty('EMAIL_ORGANIZATION_ID', organizationId);
  avisoPropriedades_().setProperty('EMAIL_INSTALLER_EMAIL', actual);
  ui.alert('Conta efetiva: ' + actual + '\nOrganização preparada. Nenhum e-mail foi enviado e nenhum gatilho foi instalado. Confira o remetente e o consentimento das pessoas no portal antes de ativar.');
}
function ativarAvisosEmail() {
  var props = avisoPropriedades_(), organizationId = props.getProperty('EMAIL_ORGANIZATION_ID'), actual = avisoConta_();
  if (!organizationId || props.getProperty('EMAIL_INSTALLER_EMAIL') !== actual) throw avisoErro_('email_sender_mismatch');
  var status = avisoApi_({ action: 'dispatch.status', organizationId: organizationId, installerEmail: actual });
  if (!status.configuration || !status.configuration.enabled || status.configuration.senderEmail !== actual) throw avisoErro_('email_disabled');
  if (MailApp.getRemainingDailyQuota() <= 0) throw avisoErro_('email_google_quota');
  desativarAvisosEmail();
  ScriptApp.newTrigger('avisosEmailAutomaticos').timeBased().everyMinutes(10).create();
  props.setProperty('EMAIL_TRIGGER_ENABLED', '1');
  SpreadsheetApp.getUi().alert('Gatilho de avisos instalado nesta conta, a cada 10 minutos. Isso não comprova envio. MailApp aceita a mensagem para envio; o portal não confirma entrega ou leitura.');
}
function desativarAvisosEmail() { avisoPropriedades_().deleteProperty('EMAIL_TRIGGER_ENABLED'); ScriptApp.getProjectTriggers().forEach(function (trigger) { if (trigger.getHandlerFunction() === 'avisosEmailAutomaticos') ScriptApp.deleteTrigger(trigger); }); }
function verEstadoAvisosEmail() {
  var props = avisoPropriedades_(), state; try { state = JSON.parse(props.getProperty('EMAIL_LAST_STATE') || 'null'); } catch (_) { state = null; }
  SpreadsheetApp.getUi().alert('Conta efetiva: ' + avisoConta_() + '\nGatilho nesta conta: ' + (props.getProperty('EMAIL_TRIGGER_ENABLED') === '1' ? 'habilitado; confira histórico' : 'desativado') + '\nÚltima tentativa: ' + (state ? state.status + ' em ' + state.at + ' · aceitos nesta execução: ' + (state.accepted || 0) + (state.code ? ' · ' + state.code : '') : 'nenhuma') + '\nPendente local: ' + (props.getProperty('EMAIL_PENDING') ? 'sim; não repetir envio manualmente' : 'não') + '\nAceitação não confirma entrega nem leitura.');
}
function menuAvisosEmail() { SpreadsheetApp.getUi().createMenu('PROEX · Avisos').addItem('Conectar somente os avisos', 'conectarAvisosEmail').addItem('Preparar conta e organização', 'configurarAvisosLocais').addItem('Ativar avisos por e-mail', 'ativarAvisosEmail').addItem('Desativar avisos por e-mail', 'desativarAvisosEmail').addItem('Enviar um único teste para mim', 'enviarTesteProprioAvisosEmail').addItem('Processar avisos agora', 'processarAvisosEmail').addItem('Ver estado dos avisos', 'verEstadoAvisosEmail').addToUi(); }
function avisosEmailAutomaticos() { if (avisoPropriedades_().getProperty('EMAIL_TRIGGER_ENABLED') !== '1') throw avisoErro_('email_trigger_disabled'); return processarAvisosEmail(); }
function avisoPending_(value) { avisoPropriedades_().setProperty('EMAIL_PENDING', JSON.stringify(value)); }
function processarAvisosEmail() { return avisoProcessar_(false); }
function enviarTesteProprioAvisosEmail() { return avisoProcessar_(true); }
function avisoPilotoRegistrar_(organizationId, id, status) { avisoPropriedades_().setProperty('EMAIL_PILOT_ATTEMPT', JSON.stringify({ organizationId: organizationId, id: id, status: status, at: new Date().toISOString() })); }
function avisoProcessar_(pilot) {
  var start = Date.now(), lock = LockService.getUserLock(), locked = false, props = avisoPropriedades_(), accepted = 0;
  try {
    locked = lock.tryLock(1000); if (!locked) throw avisoErro_('email_busy');
    var organizationId = props.getProperty('EMAIL_ORGANIZATION_ID'), actual = avisoConta_();
    if (!organizationId || props.getProperty('EMAIL_INSTALLER_EMAIL') !== actual) throw avisoErro_('email_sender_mismatch');
    if (pilot && props.getProperty('EMAIL_TRIGGER_ENABLED') === '1') throw avisoErro_('email_pilot_requires_paused');
    var common = { organizationId: organizationId, installerEmail: actual }, pending;
    try { pending = JSON.parse(props.getProperty('EMAIL_PENDING') || 'null'); } catch (_) { throw avisoErro_('email_pending_invalid'); }
    if (pilot && !pending && props.getProperty('EMAIL_PILOT_ATTEMPT')) { avisoEstado_({ status: 'pilot_already_attempted', at: new Date().toISOString(), accepted: 0 }); return { accepted: 0, state: 'pilot_already_attempted' }; }
    if (pending) {
      if (!!pending.pilot !== !!pilot) throw avisoErro_('email_pending_mode_changed');
      if (pending.organizationId !== organizationId || pending.installerEmail !== actual) throw avisoErro_('email_pending_context_changed');
      var externalMayHaveRun = pending.stage === 'sending' || pending.stage === 'accepted_local';
      if (pilot && externalMayHaveRun) avisoPilotoRegistrar_(organizationId, pending.id, 'attempted_unconfirmed');
      var recovered;
      if (pending.stage === 'accepted_local') { try { recovered = avisoApi_(Object.assign({}, common, { action: 'dispatch.ack', id: pending.id, claimToken: pending.claimToken, acceptanceToken: pending.acceptanceToken })); } catch (_) { recovered = avisoApi_(Object.assign({}, common, { action: 'dispatch.recover', id: pending.id, claimToken: pending.claimToken })); } }
      else recovered = avisoApi_(Object.assign({}, common, { action: 'dispatch.recover', id: pending.id, claimToken: pending.claimToken }));
      var recoveredStatus = recovered.status;
      if (pilot && externalMayHaveRun && ['superseded', 'queued', 'cancelled'].indexOf(recoveredStatus) >= 0) recoveredStatus = 'closed_unconfirmed';
      // Persist the pilot attempt/terminal outcome before clearing its pending claim.
      // A missing or changed server receipt must never authorize a second pilot.
      if (pilot && ['accepted', 'accepted_attested', 'closed_unconfirmed'].indexOf(recoveredStatus) >= 0) avisoPilotoRegistrar_(organizationId, pending.id, recoveredStatus);
      if (recoveredStatus === 'accepted') { if (pending.stage === 'accepted_local') accepted++; props.deleteProperty('EMAIL_PENDING'); }
      else if (recoveredStatus === 'superseded' || recoveredStatus === 'queued' || recoveredStatus === 'cancelled' || recoveredStatus === 'accepted_attested' || recoveredStatus === 'closed_unconfirmed') props.deleteProperty('EMAIL_PENDING');
      else throw avisoErro_('email_send_uncertain');
      if (pilot) { avisoEstado_({ status: recoveredStatus, at: new Date().toISOString(), accepted: accepted }); return { accepted: accepted, state: recoveredStatus }; }
    }
    for (var index = 0; index < (pilot ? 1 : NOTIFY_BATCH_MAX); index++) {
      if (Date.now() - start >= NOTIFY_BUDGET_MS) throw avisoErro_('email_time_budget');
      if (avisoConta_() !== actual) throw avisoErro_('email_sender_mismatch');
      var quota = MailApp.getRemainingDailyQuota(); if (!Number.isSafeInteger(quota) || quota < 1) { avisoEstado_({ status: 'google_quota', at: new Date().toISOString(), accepted: accepted, remainingQuota: Math.max(0, quota || 0) }); return { accepted: accepted, state: 'google_quota' }; }
      var response = avisoApi_(Object.assign({}, common, { action: pilot ? 'dispatch.pilot.claim' : 'dispatch.claim', remainingQuota: quota }));
      if (!response.claim) { avisoEstado_({ status: response.state || 'idle', at: new Date().toISOString(), accepted: accepted, remainingQuota: quota }); return { accepted: accepted, state: response.state || 'idle' }; }
      pending = { organizationId: organizationId, installerEmail: actual, id: response.claim.id, claimToken: response.claim.claimToken, stage: 'begin_pending', pilot: !!pilot }; avisoPending_(pending);
      var message = avisoApi_(Object.assign({}, common, { action: pilot ? 'dispatch.pilot.begin' : 'dispatch.begin', id: pending.id, claimToken: pending.claimToken, remainingQuota: quota }));
      if (message.senderEmail !== actual || !message.acceptanceToken || !/^[A-Za-z0-9_-]{20,100}$/.test(message.acceptanceToken) || message.subject !== 'PROEX · Nova demanda' || typeof message.body !== 'string' || message.body.length > 800 || !/^Você recebeu uma demanda na PROEX\.\n\nAcesse o portal para consultar os detalhes:\nhttps:\/\//.test(message.body) || avisoEmail_(message.to) !== message.to || /[,;\r\n]/.test(message.to)) throw avisoErro_('email_message_invalid');
      var linkLines = message.body.split('\n'), link = linkLines[linkLines.length - 1], expectedLink = props.getProperty('PORTAL_URL').replace(/:443$/, '') + '/?module=demands&demandId=';
      if (link.indexOf(expectedLink) !== 0 || !/^[A-Za-z0-9._~%:-]+$/.test(link.slice(expectedLink.length))) throw avisoErro_('email_message_invalid');
      if (pilot && message.to !== actual) throw avisoErro_('email_pilot_recipient_mismatch');
      if (Date.now() - start >= NOTIFY_BUDGET_MS || avisoConta_() !== actual || MailApp.getRemainingDailyQuota() < 1) throw avisoErro_('email_pre_send_changed');
      pending.stage = 'sending'; pending.acceptanceToken = message.acceptanceToken; avisoPending_(pending);
      if (pilot) avisoPilotoRegistrar_(organizationId, pending.id, 'attempted_unconfirmed');
      // Server has durably entered sending before this irreversible external call.
      // Any exception, timeout or uncertain result remains pending; never retry send.
      MailApp.sendEmail({ to: message.to, subject: message.subject, body: message.body });
      pending.stage = 'accepted_local'; avisoPending_(pending);
      var ack = avisoApi_(Object.assign({}, common, { action: 'dispatch.ack', id: pending.id, claimToken: pending.claimToken, acceptanceToken: pending.acceptanceToken }));
      if (ack.status !== 'accepted') throw avisoErro_('email_ack_uncertain');
      if (pilot) avisoPilotoRegistrar_(organizationId, pending.id, 'accepted');
      accepted++; props.deleteProperty('EMAIL_PENDING');
      avisoEstado_({ status: 'accepted', at: new Date().toISOString(), accepted: accepted, remainingQuota: MailApp.getRemainingDailyQuota() });
      if (pilot) return { accepted: accepted, state: 'accepted' };
      Utilities.sleep(1000);
    }
    return { accepted: accepted, state: 'batch_limit' };
  } catch (error) {
    var code = error && /^email_[a-z_]{1,60}$/.test(error.noticeCode || '') ? error.noticeCode : 'email_send_uncertain';
    avisoEstado_({ status: props.getProperty('EMAIL_PENDING') ? 'uncertain' : 'failed', at: new Date().toISOString(), accepted: accepted, code: code });
    throw avisoErro_(code); // no address, message, OAuth or token in exceptions/logs
  } finally { if (locked) lock.releaseLock(); }
}
