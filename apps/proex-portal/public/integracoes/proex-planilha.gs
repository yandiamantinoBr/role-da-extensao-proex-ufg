/**
 * PROEX UFG · Conector da planilha (Google Apps Script)
 *
 * Mantém esta planilha ligada ao portal de gestão: exporta todas as tabelas do
 * formato portátil, importa as edições permitidas (colunas editáveis e aba
 * Operações) com controle de versão e copia fotos e termos para uma pasta privada
 * do Drive. Funciona com qualquer conta Google (pessoal ou institucional) e com o
 * portal hospedado em qualquer endereço.
 *
 * Instalação (uma vez):
 *   1. Na planilha: Extensões → Apps Script. Apague o conteúdo e cole este arquivo.
 *   2. Salve, volte à planilha e recarregue a página. Aparece o menu "PROEX".
 *   3. PROEX → Conectar ao portal… Informe o endereço do portal e a chave de
 *      sincronização gerada em Configurações → Dados e sincronização.
 *   4. PROEX → Sincronizar agora. Depois, se quiser, ative a sincronização automática.
 *
 * Regras que este script respeita (as mesmas do portal):
 *   - Valores são gravados como texto literal (sem fórmulas).
 *   - Saldos, permissões, resultados e histórico nunca são importados da planilha.
 *   - Uma edição só é aplicada se a linha não mudou no portal desde a última
 *     sincronização; caso contrário vira conflito, registrado na aba Conflitos.
 *   - Linhas apagadas na planilha não apagam nada no portal.
 */

var CONTROL = 'Controle', OPERATIONS = 'Operações', CONFLICTS = 'Conflitos';
var OPERATIONS_HEADER = ['changeKey', 'action', 'input', 'status', 'entityId', 'code'];
var CONFLICTS_HEADER = ['id', 'entity_type', 'entity_id', 'expected_version', 'actual_version', 'reason', 'status', 'created_at'];
var BASELINE_NOTE = 'portable-v1: original confirmado; preserve até nova leitura de retorno.';
var EDITABLE_COLOR = '#FFF4D6', SYSTEM_COLOR = '#ECECEC';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('PROEX')
    .addItem('Sincronizar agora', 'sincronizarAgora')
    .addItem('Copiar fotos e termos para o Drive', 'copiarAnexos')
    .addSeparator()
    .addItem('Ativar sincronização automática (30 min)', 'ativarAutomatico')
    .addItem('Desativar sincronização automática', 'desativarAutomatico')
    .addSeparator()
    .addItem('Conectar ao portal…', 'conectar')
    .addItem('Ver estado da conexão', 'verEstado')
    .addToUi();
}

// ---------------------------------------------------------------- conexão

function conectar() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  var url = ui.prompt('Endereço do portal', 'Exemplo: https://proex-gestao.seu-dominio.workers.dev', ui.ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui.Button.OK) return;
  var token = ui.prompt('Chave de sincronização', 'Gere em Configurações → Dados e sincronização. Ela começa com pxs_ e aparece uma única vez.', ui.ButtonSet.OK_CANCEL);
  if (token.getSelectedButton() !== ui.Button.OK) return;
  var portal = url.getResponseText().trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(portal) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(portal)) throw new Error('Informe somente a origem HTTPS do portal, sem caminho.');
  var key = token.getResponseText().trim();
  if (!/^pxs_[A-Za-z0-9_-]{40,60}$/.test(key)) throw new Error('A chave informada não tem o formato esperado (pxs_…).');
  props.setProperties({ PORTAL_URL: portal, SYNC_TOKEN: key });

  // Registra esta planilha e uma pasta privada de anexos ao lado dela.
  var ss = SpreadsheetApp.getActive(), file = DriveApp.getFileById(ss.getId());
  var parents = file.getParents(), parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var folder = pastaFilha_(parent, 'PROEX · Anexos privados');
  chamar_('proex_sync_configure', { spreadsheetId: ss.getId(), folderId: parent.getId(), attachmentsFolderId: folder.getId() });
  props.setProperty('ATTACHMENTS_FOLDER_ID', folder.getId());
  ui.alert('Planilha conectada ao portal. Use PROEX → Sincronizar agora para a primeira carga.');
}

function verEstado() {
  var status = chamar_('proex_sync_describe', {});
  var last = (status.runs || [])[0];
  var linhas = [
    'Portal: ' + PropertiesService.getScriptProperties().getProperty('PORTAL_URL'),
    'Tabelas no formato portátil: ' + status.schemas.tables.length,
    'Última execução: ' + (last ? last.status + ' em ' + (last.finished_at || last.started_at) + ' (' + (last.exported_count || 0) + ' linhas)' : 'nenhuma'),
    'Conflitos abertos: ' + (status.conflicts || []).length,
    'Automático: ' + (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sincronizarAutomatico'; }) ? 'ativo' : 'desativado'),
  ];
  SpreadsheetApp.getUi().alert(linhas.join('\n'));
}

function ativarAutomatico() {
  desativarAutomatico();
  ScriptApp.newTrigger('sincronizarAutomatico').timeBased().everyMinutes(30).create();
  SpreadsheetApp.getActive().toast('Sincronização automática a cada 30 minutos.', 'PROEX');
}
function desativarAutomatico() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sincronizarAutomatico') ScriptApp.deleteTrigger(t); });
}
function sincronizarAutomatico() { sincronizar_(); copiarAnexos_(); }
function sincronizarAgora() {
  var resumo = sincronizar_();
  SpreadsheetApp.getActive().toast(resumo, 'PROEX', 8);
}
function copiarAnexos() {
  var n = copiarAnexos_();
  SpreadsheetApp.getActive().toast(n + ' arquivo(s) copiado(s) para a pasta privada.', 'PROEX', 6);
}

// ---------------------------------------------------------------- sincronização

function sincronizar_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return 'Outra sincronização já está em andamento.';
  try {
    var status = chamar_('proex_sync_describe', {});
    var schemas = status.schemas.tables;
    var run = chamar_('proex_sync_run_start', { requestId: Utilities.getUuid() });
    var outcome = 'completed', exported = 0, verified = 0, applied = 0, conflicts = [];
    try {
      var ss = SpreadsheetApp.getActive();
      garantirAbasDeControle_(ss);
      var baselines = lerBases_(ss);

      // 1. Edições nas colunas editáveis, comparadas com a base da última sincronização.
      var edits = coletarEdicoes_(ss, schemas, baselines);
      conflicts = conflicts.concat(edits.problems);
      // 2. Operações digitadas (criações e movimentos permitidos pelo portal).
      var ops = coletarOperacoes_(ss);
      var changes = edits.changes.concat(ops.changes);
      var results = {};
      for (var i = 0; i < changes.length; i += 25) {
        var batch = chamar_('proex_sync_apply', { connectionId: 'google-sheets', runId: run.id, changes: changes.slice(i, i + 25) });
        batch.results.forEach(function (r) { results[r.changeKey] = r; });
        applied += batch.applied;
      }
      edits.changes.forEach(function (change) {
        var r = results[change.changeKey];
        if (r && (r.status === 'conflict' || r.status === 'rejected')) conflicts.push(conflito_(r.conflictId || change.changeKey, change.table, change.id, change.expectedVersion, '', (r.code || r.status) + ' · edição desejada: ' + JSON.stringify(change.fields)));
      });
      gravarRetornoOperacoes_(ss, ops.rows, results);
      if (conflicts.length || Object.keys(results).some(function (k) { return results[k].status === 'conflict'; })) outcome = 'conflict';

      // 3. Exportação completa, tabela por tabela, com leitura paginada coerente.
      var newBaselines = [];
      schemas.forEach(function (schema) {
        var rows = lerTabela_(schema.table);
        escreverTabela_(ss, schema, rows);
        exported += rows.length;
        if (schema.mode === 'metadata') rows.forEach(function (row) { newBaselines.push(['baseline:' + schema.table + ':' + row._rowKey, JSON.stringify(row), BASELINE_NOTE]); });
        // 4. Leitura de retorno: chaves e resumos precisam bater com o que foi gravado.
        if (conferirTabela_(ss, schema, rows)) verified++;
      });
      registrarConflitos_(ss, conflicts);
      if (verified === schemas.length) gravarControle_(ss, newBaselines, schemas.length);
      else outcome = 'failed';
    } catch (error) {
      outcome = 'failed';
      throw error;
    } finally {
      chamar_('proex_sync_run_finish', { id: run.id, status: outcome, exportedCount: exported, readbackVerified: verified === schemas.length, tablesVerified: verified });
    }
    return outcome === 'completed'
      ? 'Sincronizado: ' + exported + ' linhas exportadas, ' + applied + ' alteração(ões) aplicada(s).'
      : outcome === 'conflict' ? 'Sincronizado com ' + conflicts.length + ' conflito(s). Veja a aba Conflitos.' : 'Falha na conferência. Tente novamente.';
  } finally {
    lock.releaseLock();
  }
}

function lerTabela_(table) {
  for (var attempt = 0; attempt < 3; attempt++) {
    var rows = [], after = null, digest = null, restarted = false;
    do {
      var args = { table: table, limit: 100 };
      if (after) args.after = after;
      if (digest) args.expectedDigest = digest;
      var page;
      try { page = chamar_('proex_sync_read', args); }
      catch (e) { if (String(e).indexOf('sync_snapshot_changed') >= 0) { restarted = true; break; } throw e; }
      digest = page.digest;
      rows = rows.concat(page.rows);
      after = page.nextCursor;
    } while (after);
    if (!restarted) return rows;
  }
  throw new Error('A tabela ' + table + ' mudou durante a leitura. Tente novamente.');
}

function coletarEdicoes_(ss, schemas, baselines) {
  var changes = [], problems = [];
  schemas.filter(function (s) { return s.mode === 'metadata'; }).forEach(function (schema) {
    var sheet = ss.getSheetByName(schema.sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;
    var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();
    var header = values[0], editable = {};
    schema.columns.forEach(function (c) { if (c.editable) editable[c.name] = c; });
    values.slice(1).forEach(function (cells) {
      if (cells.every(function (v) { return v === ''; })) return;
      var row = {};
      header.forEach(function (name, i) { row[name] = cells[i]; });
      var base = baselines[schema.table + ':' + row._rowKey];
      if (!base) { problems.push(conflito_('', schema.table, row.id || row._rowKey, '', '', 'Linha sem base de comparação (nova ou com chave alterada). Use a aba Operações para criar registros. Conteúdo: ' + JSON.stringify(row).slice(0, 1500))); return; }
      if (texto_(row.id) !== texto_(base.id) || texto_(row.version) !== texto_(base.version) || row._rowHash !== base._rowHash) { problems.push(conflito_('', schema.table, base.id, base.version, row.version, 'Identificador, versão ou resumo alterados manualmente; a edição não foi importada.')); return; }
      var fields = {}, changed = false;
      Object.keys(editable).forEach(function (name) {
        if (!(name in row) || texto_(row[name]) === texto_(base[name])) return;
        fields[name] = converter_(row[name], editable[name]);
        changed = true;
      });
      if (!changed) return;
      var key = 'm_' + hex_(schema.table + '\n' + base.id + '\n' + base.version + '\n' + JSON.stringify(fields)).slice(0, 48);
      changes.push({ changeKey: key, table: schema.table, id: base.id, expectedVersion: Number(base.version), fields: fields });
    });
  });
  return { changes: changes, problems: problems };
}

function coletarOperacoes_(ss) {
  var sheet = ss.getSheetByName(OPERATIONS), rows = [], changes = [];
  if (sheet.getLastRow() < 2) return { rows: rows, changes: changes };
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, OPERATIONS_HEADER.length).getDisplayValues();
  values.forEach(function (cells, i) {
    var key = cells[0].trim(), action = cells[1].trim();
    if (!key || cells[3]) return; // linha vazia ou já processada
    var entry = { line: i + 2, changeKey: key };
    try {
      var input = JSON.parse(cells[2] || '{}');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input');
      changes.push({ changeKey: key, action: action, input: input });
    } catch (e) { entry.local = { status: 'rejected', code: 'invalid_json' }; }
    rows.push(entry);
  });
  return { rows: rows, changes: changes };
}

function gravarRetornoOperacoes_(ss, rows, results) {
  var sheet = ss.getSheetByName(OPERATIONS);
  rows.forEach(function (entry) {
    var r = entry.local || results[entry.changeKey];
    if (!r) return;
    var range = sheet.getRange(entry.line, 4, 1, 3);
    range.setNumberFormat('@');
    range.setValues([[r.status || '', r.entityId || '', r.code || '']]);
  });
}

function escreverTabela_(ss, schema, rows) {
  var sheet = ss.getSheetByName(schema.sheetName) || ss.insertSheet(schema.sheetName);
  var header = schema.columns.map(function (c) { return c.name; });
  var width = header.length, height = rows.length + 1;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  if (sheet.getMaxRows() < height + 1) sheet.insertRowsAfter(sheet.getMaxRows(), height + 1 - sheet.getMaxRows());
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), width)).clearContent();
  var data = [header].concat(rows.map(function (row) { return header.map(function (name) { return texto_(row[name]); }); }));
  var range = sheet.getRange(1, 1, data.length, width);
  range.setNumberFormat('@'); // texto literal: nada vira fórmula, data ou número
  range.setValues(data);
  var head = sheet.getRange(1, 1, 1, width);
  head.setFontWeight('bold').setBackgrounds([schema.columns.map(function (c) { return c.editable ? EDITABLE_COLOR : SYSTEM_COLOR; })]);
  head.setNotes([schema.columns.map(function (c) { return c.label + (c.editable ? ' · editável na planilha' : ' · calculado pelo portal'); })]);
  if (sheet.getFrozenRows() !== 1) sheet.setFrozenRows(1);
  if (sheet.getFrozenColumns() !== 1) sheet.setFrozenColumns(1);
}

function conferirTabela_(ss, schema, rows) {
  var sheet = ss.getSheetByName(schema.sheetName);
  var header = sheet.getRange(1, 1, 1, schema.columns.length).getDisplayValues()[0];
  if (header.join('\u0001') !== schema.columns.map(function (c) { return c.name; }).join('\u0001')) return false;
  if (!rows.length) return sheet.getLastRow() <= 1;
  var keyCol = header.indexOf('_rowKey'), hashCol = header.indexOf('_rowHash');
  var values = sheet.getRange(2, 1, rows.length, header.length).getDisplayValues();
  return rows.every(function (row, i) { return values[i][keyCol] === row._rowKey && values[i][hashCol] === row._rowHash; });
}

function garantirAbasDeControle_(ss) {
  [[CONTROL, ['key', 'value', 'note']], [OPERATIONS, OPERATIONS_HEADER], [CONFLICTS, CONFLICTS_HEADER]].forEach(function (spec) {
    var sheet = ss.getSheetByName(spec[0]) || ss.insertSheet(spec[0]);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, spec[1].length).setValues([spec[1]]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });
}

function lerBases_(ss) {
  var sheet = ss.getSheetByName(CONTROL), map = {};
  if (sheet.getLastRow() < 2) return map;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (cells) {
    var key = String(cells[0]);
    if (key.indexOf('baseline:') !== 0) return;
    try { map[key.slice(9)] = JSON.parse(cells[1]); } catch (e) { /* base corrompida: a linha vira conflito */ }
  });
  return map;
}

function gravarControle_(ss, baselines, tables) {
  var sheet = ss.getSheetByName(CONTROL), now = new Date().toISOString();
  var rows = [
    ['key', 'value', 'note'],
    ['formatVersion', '1', 'Versão do formato portátil. Alterar somente com migração coordenada.'],
    ['syncState', 'verified', 'Metadados importados e relidos com controle de versão.'],
    ['lastVerifiedAt', now, 'Gravação e leitura de retorno das ' + tables + ' abas confirmadas pelo conector Apps Script.'],
    ['tablesVerified', String(tables), 'Todas as tabelas operacionais declaradas no portal.'],
  ].concat(baselines);
  if (sheet.getMaxRows() < rows.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  if (sheet.getLastRow() > 0) sheet.getRange(1, 1, sheet.getLastRow(), 3).clearContent();
  var range = sheet.getRange(1, 1, rows.length, 3);
  range.setNumberFormat('@');
  range.setValues(rows);
}

function registrarConflitos_(ss, conflicts) {
  if (!conflicts.length) return;
  var sheet = ss.getSheetByName(CONFLICTS);
  var range = sheet.getRange(sheet.getLastRow() + 1, 1, conflicts.length, CONFLICTS_HEADER.length);
  range.setNumberFormat('@');
  range.setValues(conflicts);
}

function conflito_(id, table, entityId, expected, actual, reason) {
  return [id || Utilities.getUuid(), table, texto_(entityId), texto_(expected), texto_(actual), String(reason).slice(0, 45000), 'open', new Date().toISOString()];
}

// ---------------------------------------------------------------- anexos

function copiarAnexos_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('ATTACHMENTS_FOLDER_ID');
  if (!folderId) return 0;
  var folder = DriveApp.getFolderById(folderId), copied = 0, after = null, started = Date.now();
  do {
    var args = { limit: 50 };
    if (after) args.after = after;
    var page = chamar_('proex_sync_attachment_list', args);
    for (var i = 0; i < page.attachments.length; i++) {
      var item = page.attachments[i];
      if (item.driveExport && !item.driveExport.deletedAt) continue;
      if (Date.now() - started > 4 * 60 * 1000) return copied; // respeita o limite de execução
      var ticket = chamar_('proex_sync_attachment_ticket', { kind: item.kind, id: item.id });
      var response = UrlFetchApp.fetch(ticket.url, { muteHttpExceptions: true, followRedirects: false });
      if (response.getResponseCode() !== 200) continue;
      var blob = response.getBlob();
      var bytes = blob.getBytes(), hash = hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
      var ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[item.mime] || 'bin';
      var file = folder.createFile(blob.setName(item.kind + '-' + item.id + '.' + ext));
      // Pasta e arquivo permanecem privados (herdam o compartilhamento da pasta).
      var reread = DriveApp.getFileById(file.getId());
      var privateCopy = reread.getSharingAccess() === DriveApp.Access.PRIVATE;
      if (!privateCopy) { reread.setTrashed(true); continue; }
      chamar_('proex_sync_attachment_ack', {
        kind: item.kind, id: item.id, driveFileId: file.getId(), driveUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
        contentHash: hash, size: bytes.length, privateConfirmed: true, readbackVerified: reread.getSize() === bytes.length,
      });
      copied++;
    }
    after = page.nextCursor;
  } while (after);
  return copied;
}

// ---------------------------------------------------------------- utilitários

function chamar_(tool, args) {
  var props = PropertiesService.getScriptProperties();
  var portal = props.getProperty('PORTAL_URL'), token = props.getProperty('SYNC_TOKEN');
  if (!portal || !token) throw new Error('Conecte a planilha primeiro: PROEX → Conectar ao portal…');
  var response = UrlFetchApp.fetch(portal + '/api/sync/connector', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, followRedirects: false,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ tool: tool, args: args }),
  });
  var body;
  try { body = JSON.parse(response.getContentText()); } catch (e) { throw new Error('Resposta inesperada do portal (' + response.getResponseCode() + ').'); }
  if (!body.ok) throw new Error((body.code || 'erro') + ': ' + (body.error || 'falha na integração'));
  return body.result;
}
function pastaFilha_(parent, name) {
  var found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}
function texto_(value) { return value === null || value === undefined ? '' : String(value); }
function converter_(value, column) {
  if (value === '') return column.type === 'text' && !/_id$/.test(column.name) ? '' : null;
  if (column.type === 'number') return Number(value);
  if (column.type === 'boolean') return value === 'true' || value === '1' || value === 'TRUE';
  return value;
}
function hex_(text) { return hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)); }
function hexBytes_(bytes) { return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join(''); }
