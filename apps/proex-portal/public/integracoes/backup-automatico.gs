/**
 * PROEX · Backup completo diário, formato 2.
 * Cole ESTE arquivo também no mesmo projeto Apps Script do proex-planilha.gs.
 * Opt-in separado: não é ativado pela sincronização de tabelas/anexos.
 * Somente ciphertext chega ao Drive; não recebe nem guarda a chave privada.
 * OAuth e pxs ficam somente nos headers dos seus respectivos destinos HTTPS.
 */
var BACKUP_BUDGET_MS = 5 * 60 * 1000, BACKUP_MAX_BYTES = 32 * 1024 * 1024;
function backupErro_(code) { var error = new Error(code); error.backupCode = code; return error; }
function backupPrazo_(start) { if (Date.now() - start >= BACKUP_BUDGET_MS) throw backupErro_('backup_time_budget'); }
function backupId_(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{5,200}$/.test(value)) throw backupErro_('backup_invalid_id'); return value; }
function backupEstado_(value) { propriedades_().setProperty('BACKUP_LAST_STATE', JSON.stringify(value)); }
function backupLer_(key) { try { return JSON.parse(propriedades_().getProperty(key) || 'null'); } catch (_) { throw backupErro_('backup_local_state_invalid'); } }
function backupPortal_(path, body, binary) {
  var props = propriedades_(), portal = props.getProperty('PORTAL_URL'), token = props.getProperty('SYNC_TOKEN');
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::443)?$/.test(portal || '') || !/^pxs_[A-Za-z0-9_-]{40,60}$/.test(token || '')) throw backupErro_('backup_connection_required');
  if (!/^\/api\/backup\/automatic(?:\/file\?ticket=pba_[A-Za-z0-9_-]{43})?$/.test(path)) throw backupErro_('backup_invalid_path');
  var options = { method: body ? 'post' : 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false };
  if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
  var response;
  try { response = UrlFetchApp.fetch(portal + path, options); } catch (_) { throw backupErro_('backup_portal_transport'); }
  if (response.getResponseCode() !== 200) { var code = ''; try { code = JSON.parse(response.getContentText()).code; } catch (_) {} throw backupErro_(/^backup_[a-z_]{1,60}$/.test(code || '') ? code : 'backup_portal_rejected'); }
  if (binary) return response;
  try { return JSON.parse(response.getContentText()); } catch (_) { throw backupErro_('backup_portal_response'); }
}
function backupDriveJson_(id, permissions) {
  backupId_(id);
  var fields = permissions ? 'permissions(id,type,role,deleted,permissionDetails(inherited)),nextPageToken' : 'id,mimeType,driveId,parents,owners(me),trashed,shortcutDetails';
  var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + (permissions ? '/permissions?pageSize=100&fields=' : '?fields=') + encodeURIComponent(fields), response;
  try { response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: false }); } catch (_) { throw backupErro_('backup_drive_transport'); }
  if (response.getResponseCode() !== 200) throw backupErro_('backup_drive_metadata_unavailable');
  try { return JSON.parse(response.getContentText()); } catch (_) { throw backupErro_('backup_drive_metadata_invalid'); }
}
/** Require current-user ownership, one owner ACL and the exact private parent.
 * My Drive reports its sole owner permission as inherited. That marker does not
 * add a reader: any additional/direct/inherited permission is still rejected.
 */
function backupPrivado_(id, parentId, isFolder) {
  var file = backupDriveJson_(id, false), acl = backupDriveJson_(id, true), permissions = acl.permissions || [], owners = file.owners || [];
  if (file.id !== id || file.trashed || file.driveId || file.shortcutDetails || owners.length !== 1 || owners[0].me !== true || !file.parents || file.parents.length !== 1 || file.parents[0] !== parentId || (isFolder && file.mimeType !== 'application/vnd.google-apps.folder') || (!isFolder && file.mimeType !== 'application/octet-stream') || acl.nextPageToken || permissions.length !== 1 || permissions[0].type !== 'user' || permissions[0].role !== 'owner' || permissions[0].deleted) throw backupErro_('backup_drive_not_owner_only');
  return file;
}
function backupPasta_(folderId) { backupPrivado_(folderId, DriveApp.getRootFolder().getId(), true); return DriveApp.getFolderById(folderId); }
function prepararPastaBackup() {
  var folder = DriveApp.getRootFolder().createFolder('PROEX · Backups completos privados');
  backupPasta_(folder.getId());
  SpreadsheetApp.getUi().alert('Pasta privada criada diretamente em Meu Drive. Copie este ID para o backup diário no portal:\n' + folder.getId() + '\nNão compartilhe esta pasta. A chave privada deve ficar offline e separada do Drive.');
}
function ativarBackupDiario() {
  var status = backupPortal_('/api/backup/automatic');
  if (!status.supported || !status.configuration || !status.configuration.enabled) throw backupErro_('backup_server_disabled');
  backupPasta_(status.configuration.driveFolderId);
  desativarBackupDiario();
  ScriptApp.newTrigger('backupDiarioAutomatico').timeBased().atHour(3).everyDays(1).inTimezone('America/Sao_Paulo').create();
  propriedades_().setProperty('BACKUP_DAILY_ENABLED', '1');
  SpreadsheetApp.getUi().alert('Backup diário instalado nesta conta, na faixa das 03h de Brasília. Confira o histórico de execuções e teste Executar backup completo agora. Instalar o gatilho não comprova uma cópia.');
}
function desativarBackupDiario() {
  propriedades_().deleteProperty('BACKUP_DAILY_ENABLED');
  ScriptApp.getProjectTriggers().forEach(function (trigger) { if (trigger.getHandlerFunction() === 'backupDiarioAutomatico') ScriptApp.deleteTrigger(trigger); });
}
function verEstadoBackup() {
  var status = backupPortal_('/api/backup/automatic'), local = backupLer_('BACKUP_LAST_STATE'), success = backupLer_('BACKUP_LAST_SUCCESS'), pending = backupLer_('BACKUP_PENDING_RECEIPT');
  SpreadsheetApp.getUi().alert(['Servidor: ' + (status.configuration && status.configuration.enabled ? 'habilitado' : 'desativado'), 'Gatilho nesta conta: ' + estadoGatilhos_().backup, 'Última tentativa local: ' + (local ? local.status + ' em ' + local.at + (local.code ? ' · ' + local.code : '') : 'nenhuma'), 'Última cópia com releitura confirmada nesta conta: ' + (success ? success.at + ' · ' + success.size + ' bytes · SHA-256 ' + success.sha256 : 'nenhuma'), 'Recibo pendente: ' + (pending ? pending.runId : 'nenhum'), status.notice, 'Restauração offline precisa ser ensaiada separadamente. Gatilhos de outras contas não aparecem aqui.'].join('\n'));
}
function liberarReciboBackup() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Liberar recibo pendente?', 'Use somente após conferir o arquivo no Drive. O arquivo será preservado; esta ação apenas permite uma nova tentativa quando uma mudança de configuração impede confirmar o recibo antigo.', ui.ButtonSet.YES_NO) === ui.Button.YES) propriedades_().deleteProperty('BACKUP_PENDING_RECEIPT');
}
function backupCompletoAgora() { return executarBackupCompleto_(false); }
function backupDiarioAutomatico() { return executarBackupCompleto_(true); }
function backupSHA_(bytes) { return hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)); }
function backupRecibo_(receipt, status, start) {
  backupPrazo_(start);
  if (receipt.driveFolderId !== status.configuration.driveFolderId || receipt.keyId !== status.configuration.keyId || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.size) || receipt.size < 64 || receipt.size > BACKUP_MAX_BYTES) throw backupErro_('backup_pending_configuration_changed');
  backupPasta_(receipt.driveFolderId); backupPrivado_(receipt.driveFileId, receipt.driveFolderId, false); backupPrazo_(start);
  var file = DriveApp.getFileById(receipt.driveFileId);
  if (file.getSize() !== receipt.size) throw backupErro_('backup_readback_size');
  var bytes = file.getBlob().getBytes();
  if (bytes.length !== receipt.size || backupSHA_(bytes) !== receipt.sha256) throw backupErro_('backup_readback_hash');
  backupPrazo_(start); backupPasta_(receipt.driveFolderId); backupPrivado_(receipt.driveFileId, receipt.driveFolderId, false);
  var ack = backupPortal_('/api/backup/automatic', { action: 'ack', runId: receipt.runId, sha256: receipt.sha256, size: receipt.size, driveFileId: receipt.driveFileId, driveFolderId: receipt.driveFolderId, privateConfirmed: true, readbackVerified: true });
  if (ack.verified !== true || ack.runId !== receipt.runId) throw backupErro_('backup_ack_not_verified');
  propriedades_().setProperty('BACKUP_LAST_SUCCESS', JSON.stringify({ at: new Date().toISOString(), runId: receipt.runId, generatedAt: receipt.generatedAt, driveFileId: receipt.driveFileId, size: receipt.size, sha256: receipt.sha256, keyId: receipt.keyId }));
  propriedades_().deleteProperty('BACKUP_PENDING_RECEIPT');
}
function executarBackupCompleto_(daily) {
  var start = Date.now(), lock = LockService.getUserLock(), locked = false, runId;
  try {
    if (daily && propriedades_().getProperty('BACKUP_DAILY_ENABLED') !== '1') throw backupErro_('backup_daily_disabled');
    locked = lock.tryLock(1000); if (!locked) throw backupErro_('backup_busy');
    backupEstado_({ status: 'running', at: new Date().toISOString() });
    var status = backupPortal_('/api/backup/automatic');
    if (!status.supported || !status.configuration || !status.configuration.enabled) throw backupErro_('backup_server_disabled');
    backupPasta_(status.configuration.driveFolderId); backupPrazo_(start);
    var pending = backupLer_('BACKUP_PENDING_RECEIPT'); if (pending) backupRecibo_(pending, status, start);
    var ticket = backupPortal_('/api/backup/automatic', { action: 'prepare', operationKey: Utilities.getUuid() }); runId = ticket.runId;
    if (ticket.keyId !== status.configuration.keyId || ticket.driveFolderId !== status.configuration.driveFolderId || !/^pba_[A-Za-z0-9_-]{43}$/.test(ticket.ticket || '')) throw backupErro_('backup_configuration_changed');
    backupPrazo_(start);
    var response = backupPortal_('/api/backup/automatic/file?ticket=' + ticket.ticket, null, true), headers = response.getAllHeaders(), lower = {};
    Object.keys(headers).forEach(function (key) { lower[key.toLowerCase()] = String(headers[key]); });
    var expected = Number(lower['x-proex-backup-size']), hash = lower['x-proex-backup-sha256'];
    if (!Number.isSafeInteger(expected) || expected < 64 || expected > BACKUP_MAX_BYTES || !/^[a-f0-9]{64}$/.test(hash || '') || lower['x-proex-backup-key-id'] !== ticket.keyId || lower['x-proex-backup-run-id'] !== runId) throw backupErro_('backup_download_headers');
    var blob = response.getBlob(), bytes = blob.getBytes();
    if (bytes.length !== expected || bytes.length > BACKUP_MAX_BYTES || String.fromCharCode.apply(null, bytes.slice(0, 8)) !== 'PROEXBK2' || backupSHA_(bytes) !== hash) throw backupErro_('backup_download_integrity');
    backupPrazo_(start);
    var folder = backupPasta_(ticket.driveFolderId), file = folder.createFile(blob.setContentType('application/octet-stream').setName('proex-completo-' + new Date().toISOString().slice(0, 10) + '-' + backupId_(runId) + '.proexbackup'));
    var receipt = { runId: runId, driveFolderId: ticket.driveFolderId, driveFileId: file.getId(), size: expected, sha256: hash, keyId: ticket.keyId, generatedAt: new Date().toISOString() };
    propriedades_().setProperty('BACKUP_PENDING_RECEIPT', JSON.stringify(receipt));
    backupRecibo_(receipt, status, start);
    backupEstado_({ status: 'verified_client', at: new Date().toISOString(), runId: runId, sha256: hash, size: expected });
    return { verified: true, runId: runId };
  } catch (error) {
    var code = error && /^backup_[a-z_]{1,60}$/.test(error.backupCode || '') ? error.backupCode : 'backup_failed';
    backupEstado_({ status: 'failed', at: new Date().toISOString(), runId: runId || null, code: code });
    throw backupErro_(code); // never log provider response, token, OAuth or raw exception
  } finally { if (locked) lock.releaseLock(); }
}
