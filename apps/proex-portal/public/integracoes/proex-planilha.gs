/**
 * PROEX UFG · Conector da planilha (Google Apps Script)
 *
 * Mantém esta planilha ligada ao portal de gestão: exporta todas as tabelas do
 * formato portátil, importa as edições permitidas (colunas editáveis e aba
 * Operações) com controle de versão e copia fotos e termos para uma pasta privada
 * do Drive. Funciona com qualquer conta Google (pessoal ou institucional) e com o
 * portal hospedado em qualquer endereço.
 *
 * Instalação (uma vez, por um responsável institucional do portal):
 *   1. Na planilha: Extensões → Apps Script. Apague o conteúdo e cole este arquivo.
 *   2. Salve, volte à planilha e recarregue a página. Aparece o menu "PROEX".
 *   3. PROEX → Conectar ao portal… Informe o endereço do portal e a chave de
 *      sincronização gerada em Configurações → Dados e sincronização.
 *   4. PROEX → Sincronizar agora. Depois, se quiser, ative a sincronização automática.
 *
 * Segurança: a chave fica nas propriedades do usuário que conectou (outros editores
 * não conseguem lê-la), mas quem pode editar a planilha também pode editar este
 * script. Compartilhe a planilha com permissão de edição somente com pessoas que
 * também poderiam administrar o portal; para o restante da equipe, use "leitor".
 *
 * Regras que este script respeita (as mesmas do portal):
 *   - Valores são gravados como texto literal (sem fórmulas).
 *   - Saldos, permissões, resultados e histórico nunca são importados da planilha.
 *   - Uma edição só é aplicada se a linha não mudou no portal desde a última
 *     sincronização; caso contrário vira conflito, registrado na aba Conflitos
 *     com o conteúdo desejado.
 *   - Linhas apagadas na planilha não apagam nada no portal.
 */

var CONTROL = 'Controle', OPERATIONS = 'Operações', CONFLICTS = 'Conflitos';
var OPERATIONS_HEADER = ['changeKey', 'action', 'input', 'status', 'entityId', 'code'];
var CONFLICTS_HEADER = ['id', 'entity_type', 'entity_id', 'expected_version', 'actual_version', 'reason', 'status', 'created_at'];
var BASELINE_NOTE = 'portable-v1: original confirmado; preserve até nova leitura de retorno.';
var EDITABLE_COLOR = '#FFF4D6', SYSTEM_COLOR = '#ECECEC';
var ATTACHMENTS_FOLDER = 'PROEX · Anexos privados';
var CONNECTOR_VERSION = '2026-10-31';
// O Apps Script encerra execuções após 6 minutos; paramos com folga.
var SYNC_BUDGET_MS = 5 * 60 * 1000, ATTACHMENTS_BUDGET_MS = 4 * 60 * 1000;
var ISOLATE_CODES = ['sync_operation_changed', 'sync_invalid_change_key', 'sync_invalid_action', 'sync_system_field', 'sync_invalid_row', 'sync_invalid_version', 'sync_change_limit', 'sync_input_limit'];
// Estes serviços preservam o valor atual quando um campo é omitido na edição.
// Campanhas exigem a linha completa; tabelas novas precisam da mesma conferência.
var PARTIAL_METADATA_TABLES = ['project_types', 'projects', 'project_links', 'project_schedule_items', 'calls', 'material_categories', 'items', 'organizational_units'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('PROEX')
    .addItem('Sincronizar agora', 'sincronizarAgora')
    .addItem('Copiar fotos e termos para o Drive', 'copiarAnexos')
    .addSeparator()
    .addItem('Ativar sincronização automática', 'ativarAutomatico')
    .addItem('Desativar sincronização automática', 'desativarAutomatico')
    .addSeparator()
    .addItem('Conectar ao portal…', 'conectar')
    .addItem('Ver estado da conexão', 'verEstado')
    .addToUi();
}

// ---------------------------------------------------------------- conexão

function propriedades_() { return PropertiesService.getUserProperties(); }

function conectar() {
  var ui = SpreadsheetApp.getUi();
  var url = ui.prompt('Endereço do portal', 'Exemplo: https://proex-gestao.vercel.app', ui.ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui.Button.OK) return;
  var token = ui.prompt('Chave de sincronização', 'Gere em Configurações → Dados e sincronização. Ela começa com pxs_ e aparece uma única vez.', ui.ButtonSet.OK_CANCEL);
  if (token.getSelectedButton() !== ui.Button.OK) return;
  var portal = url.getResponseText().trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(portal) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(portal)) throw new Error('Informe somente a origem HTTPS do portal, sem caminho.');
  var key = token.getResponseText().trim();
  if (!/^pxs_[A-Za-z0-9_-]{40,60}$/.test(key)) throw new Error('A chave informada não tem o formato esperado (pxs_…).');
  var props = propriedades_();
  props.setProperties({ PORTAL_URL: portal, SYNC_TOKEN: key });
  PropertiesService.getScriptProperties().deleteProperty('SYNC_TOKEN'); // versões antigas guardavam aqui

  // Pasta de anexos no "Meu Drive" de quem conecta, nunca dentro de pastas compartilhadas.
  var folder = pastaFilha_(DriveApp.getRootFolder(), ATTACHMENTS_FOLDER);
  conferirPastaPrivada_(folder);
  var ss = SpreadsheetApp.getActive(), parents = DriveApp.getFileById(ss.getId()).getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  chamar_('proex_sync_configure', { spreadsheetId: ss.getId(), folderId: parent.getId(), attachmentsFolderId: folder.getId() });
  props.setProperty('ATTACHMENTS_FOLDER_ID', folder.getId());
  ui.alert('Planilha conectada ao portal. Use PROEX → Sincronizar agora para a primeira carga.\n\nLembre-se: quem pode editar esta planilha também pode editar o script. Dê permissão de edição somente a responsáveis do portal.');
}

function verEstado() {
  var status = chamar_('proex_sync_describe', {});
  var last = (status.runs || [])[0], triggers = estadoGatilhos_(), attachments = lerEstadoAnexos_();
  var linhas = [
    'Conector: ' + CONNECTOR_VERSION,
    'Portal: ' + propriedades_().getProperty('PORTAL_URL'),
    'Tabelas no formato portátil: ' + status.schemas.tables.length,
    'Última execução: ' + (last ? last.status + ' em ' + (last.finished_at || last.started_at) + ' (' + (last.exported_count || 0) + ' linhas)' : 'nenhuma'),
    'Conflitos abertos: ' + (status.conflicts || []).length,
    'Gatilho de dados nesta conta: ' + triggers.data,
    'Gatilho de anexos nesta conta: ' + triggers.attachments,
    'Última cópia de anexos: ' + (attachments ? resumoAnexos_(attachments) + ' em ' + attachments.at : 'não registrada nesta conta'),
    'Gatilhos de outras contas não são visíveis aqui. Um gatilho instalado não comprova uma execução concluída.',
  ];
  SpreadsheetApp.getUi().alert(linhas.join('\n'));
}
function estadoGatilhos_() {
  var handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  function count(handler) { var n = handlers.filter(function (h) { return h === handler; }).length; return n ? n + ' instalado(s); confira o histórico de execuções' : 'não instalado'; }
  return { data: count('sincronizarAutomatico'), attachments: count('copiarAnexosAutomatico') };
}

function ativarAutomatico() {
  // Não instale uma rotina que já começa sem autenticação ou configuração.
  chamar_('proex_sync_describe', {});
  if (!propriedades_().getProperty('ATTACHMENTS_FOLDER_ID')) throw new Error('Conecte a planilha e a pasta privada antes de ativar os gatilhos.');
  desativarAutomatico();
  ScriptApp.newTrigger('sincronizarAutomatico').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('copiarAnexosAutomatico').timeBased().everyHours(1).create();
  SpreadsheetApp.getActive().toast('Dados a cada 30 minutos; fotos e termos a cada hora.', 'PROEX');
}
function desativarAutomatico() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['sincronizarAutomatico', 'copiarAnexosAutomatico'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}
function sincronizarAutomatico() { sincronizar_(); }
function copiarAnexosAutomatico() { copiarAnexos_(); }
function sincronizarAgora() { SpreadsheetApp.getActive().toast(sincronizar_(), 'PROEX', 8); }
function copiarAnexos() { copiarAnexos_(); SpreadsheetApp.getActive().toast(resumoAnexos_(lerEstadoAnexos_()), 'PROEX', 8); }

// ---------------------------------------------------------------- sincronização

function sincronizar_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return 'Outra sincronização já está em andamento.';
  var started = Date.now();
  try {
    var status = chamar_('proex_sync_describe', {});
    var schemas = status.schemas.tables;
    var run = chamar_('proex_sync_run_start', { requestId: Utilities.getUuid() });
    var outcome = 'completed', exported = 0, verified = 0, applied = 0, conflicts = [];
    try {
      var ss = SpreadsheetApp.getActive();
      garantirAbasDeControle_(ss);
      var control = lerControle_(ss);

      // 1. Edições nas colunas editáveis, comparadas com a base da última sincronização.
      var edits = coletarEdicoes_(ss, schemas, control.baselines);
      conflicts = conflicts.concat(edits.problems);
      // 2. Operações digitadas (criações e movimentos permitidos pelo portal).
      var ops = coletarOperacoes_(ss);
      var results = aplicar_(edits.changes.concat(ops.changes), run.id);
      Object.keys(results).forEach(function (k) { if (results[k].status === 'applied') applied++; });
      edits.changes.forEach(function (change) {
        var r = results[change.changeKey];
        if (r && (r.status === 'conflict' || r.status === 'rejected')) conflicts.push(conflito_(r.conflictId || change.changeKey, change.table, change.id, change.expectedVersion, '', (r.code || r.status) + ' · conteúdo desejado: ' + JSON.stringify(change.fields)));
      });
      gravarRetornoOperacoes_(ss, ops.rows, results);

      // 3. Exportação tabela por tabela; a base de cada tabela é gravada logo após sua releitura.
      for (var i = 0; i < schemas.length; i++) {
        var schema = schemas[i];
        if (Date.now() - started > SYNC_BUDGET_MS) { outcome = 'failed'; break; }
        var rows = lerTabela_(schema.table);
        if (Date.now() - started > SYNC_BUDGET_MS) { outcome = 'failed'; break; }
        // A leitura do portal pode levar várias chamadas HTTP. Confira a planilha
        // depois delas, imediatamente antes da escrita, preservando edições novas.
        if (Object.prototype.hasOwnProperty.call(edits.snapshots, schema.table) && alteradaDuranteSync_(ss, schema, edits.snapshots[schema.table])) {
          conflicts.push(conflito_('', schema.table, '', '', '', 'A aba foi editada durante a sincronização e não foi sobrescrita. As edições serão lidas na próxima execução.'));
          continue;
        }
        escreverTabela_(ss, schema, rows);
        exported += rows.length;
        if (!conferirTabela_(ss, schema, rows)) continue;
        verified++;
        if (schema.mode === 'metadata') {
          control.replace(schema.table, rows.map(function (row) { return ['baseline:' + schema.table + ':' + row._rowKey, JSON.stringify(row), BASELINE_NOTE]; }));
          control.save(verified, schemas.length, 'running');
        }
      }
      registrarConflitos_(ss, conflicts);
      if (outcome === 'completed' && verified !== schemas.length) outcome = conflicts.length ? 'conflict' : 'failed';
      else if (outcome === 'completed' && conflicts.length) outcome = 'conflict';
      control.save(verified, schemas.length, outcome);
    } catch (error) {
      outcome = 'failed';
      if (control) { try { control.save(verified, schemas.length, outcome); } catch (_saveError) { /* preserve o erro original */ } }
      throw error;
    } finally {
      chamar_('proex_sync_run_finish', { id: run.id, status: outcome, exportedCount: exported, readbackVerified: verified === schemas.length, tablesVerified: verified });
    }
    return outcome === 'completed'
      ? 'Sincronizado: ' + exported + ' linhas exportadas, ' + applied + ' alteração(ões) aplicada(s).'
      : outcome === 'conflict' ? 'Sincronizado com ' + conflicts.length + ' conflito(s). Veja a aba Conflitos.'
      : 'Sincronização interrompida (tempo ou conferência). As bases já conferidas foram preservadas; a próxima execução relê as tabelas desde o início.';
  } finally {
    lock.releaseLock();
  }
}

/** Envia em lotes de 25; se um lote for recusado por uma linha, reenvia linha a linha. */
function aplicar_(changes, runId) {
  var results = {};
  for (var i = 0; i < changes.length; i += 25) {
    var batch = changes.slice(i, i + 25), response;
    try {
      response = chamar_('proex_sync_apply', { connectionId: 'google-sheets', runId: runId, changes: batch });
      response.results.forEach(function (r) { results[r.changeKey] = r; });
    } catch (error) {
      if (!isolavel_(error) || batch.length === 1) throw error;
      batch.forEach(function (change) {
        try {
          chamar_('proex_sync_apply', { connectionId: 'google-sheets', runId: runId, changes: [change] }).results.forEach(function (r) { results[r.changeKey] = r; });
        } catch (single) {
          if (!isolavel_(single)) throw single;
          results[change.changeKey] = { changeKey: change.changeKey, status: 'rejected', code: single.code };
        }
      });
    }
  }
  return results;
}
function isolavel_(error) { return error && ISOLATE_CODES.indexOf(error.code) >= 0; }

function lerTabela_(table) {
  for (var attempt = 0; attempt < 3; attempt++) {
    var rows = [], after = null, digest = null, restarted = false;
    do {
      var args = { table: table, limit: 100 };
      if (after) args.after = after;
      if (digest) args.expectedDigest = digest;
      var page;
      try { page = chamar_('proex_sync_read', args); }
      catch (e) { if (e.code === 'sync_snapshot_changed' || e.code === 'sync_invalid_cursor') { restarted = true; break; } throw e; }
      digest = page.digest;
      rows = rows.concat(page.rows);
      after = page.nextCursor;
    } while (after);
    if (!restarted) return rows;
  }
  throw new Error('A tabela ' + table + ' mudou durante a leitura. Tente novamente.');
}

function coletarEdicoes_(ss, schemas, baselines) {
  var changes = [], problems = [], snapshots = {};
  schemas.filter(function (s) { return s.mode === 'metadata'; }).forEach(function (schema) {
    var sheet = ss.getSheetByName(schema.sheetName);
    if (!sheet) { snapshots[schema.table] = null; return; }
    var values = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues() : [];
    snapshots[schema.table] = values;
    if (values.length < 2) return;
    var header = values[0], editable = schema.columns.filter(function (c) { return c.editable; });
    values.slice(1).forEach(function (cells) {
      if (cells.every(function (v) { return v === ''; })) return;
      var row = {};
      header.forEach(function (name, i) { row[name] = cells[i]; });
      var base = baselines[schema.table + ':' + row._rowKey];
      if (!base) { problems.push(conflito_('', schema.table, row.id || row._rowKey, '', '', 'Linha sem base de comparação (nova ou com chave alterada). Use a aba Operações para criar registros. Conteúdo: ' + JSON.stringify(row))); return; }
      var edited = {};
      editable.forEach(function (c) { if ((c.name in row) && texto_(row[c.name]) !== texto_(base[c.name])) edited[c.name] = row[c.name]; });
      if (texto_(row.id) !== texto_(base.id) || texto_(row.version) !== texto_(base.version) || row._rowHash !== base._rowHash) {
        problems.push(conflito_('', schema.table, base.id, base.version, row.version, 'Identificador, versão ou resumo alterados manualmente; nada foi importado. Edições na linha: ' + JSON.stringify(edited)));
        return;
      }
      if (!Object.keys(edited).length) return;
      // Envia os campos conhecidos; uma coluna nova ausente também na base não é
      // uma edição vazia. O serviço preserva seu valor atual até atualizar a aba.
      var fields = {}, invalid = [];
      editable.forEach(function (c) {
        if (!(c.name in row) && !(c.name in base)) {
          if (PARTIAL_METADATA_TABLES.indexOf(schema.table) < 0) invalid.push(c.name + ': coluna ausente; atualize a aba e reaplique a edição');
          return;
        }
        var source = (c.name in row) ? row[c.name] : texto_(base[c.name]);
        var converted = converter_(source, c);
        if (converted.error) invalid.push(c.name + ': ' + converted.error); else fields[c.name] = converted.value;
      });
      if (invalid.length) { problems.push(conflito_('', schema.table, base.id, base.version, '', 'Valor inválido (' + invalid.join('; ') + '). Conteúdo desejado: ' + JSON.stringify(edited))); return; }
      var key = 'm_' + hex_(schema.table + '\n' + base.id + '\n' + base.version + '\n' + JSON.stringify(fields)).slice(0, 48);
      changes.push({ changeKey: key, table: schema.table, id: base.id, expectedVersion: Number(base.version), fields: fields });
    });
  });
  return { changes: changes, problems: problems, snapshots: snapshots };
}

function alteradaDuranteSync_(ss, schema, before) {
  var sheet = ss.getSheetByName(schema.sheetName);
  if (!sheet) return before !== null;
  if (before === null) return true;
  var now = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues() : [];
  return JSON.stringify(now) !== JSON.stringify(before);
}

function coletarOperacoes_(ss) {
  var sheet = ss.getSheetByName(OPERATIONS), rows = [], changes = [];
  if (sheet.getLastRow() < 2) return { rows: rows, changes: changes };
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, OPERATIONS_HEADER.length).getDisplayValues();
  values.forEach(function (cells) {
    var key = cells[0].trim(), action = cells[1].trim();
    if (!key || cells[3]) return; // linha vazia ou já processada
    var entry = { changeKey: key };
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(key)) { entry.local = { status: 'rejected', code: 'invalid_change_key' }; rows.push(entry); return; }
    try {
      var input = JSON.parse(cells[2] || '{}');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input');
      changes.push({ changeKey: key, action: action, input: input });
    } catch (e) { entry.local = { status: 'rejected', code: 'invalid_json' }; }
    rows.push(entry);
  });
  return { rows: rows, changes: changes };
}

/** Grava o retorno localizando cada operação pela chave, mesmo que linhas tenham sido movidas. */
function gravarRetornoOperacoes_(ss, rows, results) {
  if (!rows.length) return;
  var sheet = ss.getSheetByName(OPERATIONS);
  var current = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 4).getDisplayValues();
  var pending = current.map(function (r) { return r[3] ? null : r[0].trim(); }); // só linhas ainda sem retorno
  rows.forEach(function (entry) {
    var r = entry.local || results[entry.changeKey], index = pending.indexOf(entry.changeKey);
    if (!r || index < 0) return;
    pending[index] = null;
    var range = sheet.getRange(index + 2, 4, 1, 3);
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
  if (!sheet || sheet.getLastRow() !== rows.length + 1) return false;
  var header = sheet.getRange(1, 1, 1, schema.columns.length).getDisplayValues()[0];
  if (header.join('\u0001') !== schema.columns.map(function (c) { return c.name; }).join('\u0001')) return false;
  if (!rows.length) return true;
  var values = sheet.getRange(2, 1, rows.length, header.length).getDisplayValues();
  // Os hashes armazenados são células também: mantê-los intactos não prova que
  // nome, saldo, texto ou qualquer outro valor foi gravado e relido corretamente.
  return rows.every(function (row, i) { return header.every(function (name, j) { return values[i][j] === texto_(row[name]); }); });
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

/** Lê o Controle e devolve as bases e um gravador que substitui as bases de uma tabela. */
function lerControle_(ss) {
  var sheet = ss.getSheetByName(CONTROL), rows = [], baselines = {};
  if (sheet.getLastRow() >= 2) rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().map(function (r) { return [String(r[0]), String(r[1]), String(r[2])]; });
  var entries = rows.filter(function (r) { return r[0].indexOf('baseline:') === 0; });
  var previousVerified = rows.filter(function (r) { return r[0] === 'lastVerifiedAt'; })[0];
  var lastVerifiedAt = previousVerified ? previousVerified[1] : '';
  entries.forEach(function (r) { try { baselines[r[0].slice(9)] = JSON.parse(r[1]); } catch (e) { /* base corrompida: a linha vira conflito */ } });
  return {
    baselines: baselines,
    replace: function (table, fresh) {
      var prefix = 'baseline:' + table + ':';
      entries = entries.filter(function (r) { return r[0].indexOf(prefix) !== 0; }).concat(fresh);
    },
    save: function (verified, total, state) {
      var now = new Date().toISOString();
      var complete = state === 'completed' && verified === total;
      if (complete) lastVerifiedAt = now;
      var data = [
        ['key', 'value', 'note'],
        ['formatVersion', '1', 'Versão do formato portátil. Alterar somente com migração coordenada.'],
        ['syncState', complete ? 'verified' : 'partial', 'Verificada somente após releitura de todas as tabelas e ausência de conflitos nesta execução.'],
        ['lastVerifiedAt', lastVerifiedAt, 'Última execução integralmente verificada; não comprova gatilho ativo.'],
        ['tablesVerified', String(verified), 'Abas conferidas nesta execução.'],
        ['lastAttemptAt', now, 'Horário da tentativa atual.'],
        ['lastAttemptStatus', state || 'partial', 'Resultado desta tentativa; bases parciais já conferidas são preservadas.'],
        ['connectorVersion', CONNECTOR_VERSION, 'Versão instalada do conector Apps Script.'],
      ].concat(entries);
      if (sheet.getMaxRows() < data.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), data.length + 1 - sheet.getMaxRows());
      if (sheet.getLastRow() > 0) sheet.getRange(1, 1, sheet.getLastRow(), 3).clearContent();
      var range = sheet.getRange(1, 1, data.length, 3);
      range.setNumberFormat('@');
      range.setValues(data);
    },
  };
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
  var folderId = propriedades_().getProperty('ATTACHMENTS_FOLDER_ID');
  if (!folderId) {
    salvarEstadoAnexos_({ status: 'failed', copied: 0, failed: 1, codes: ['attachment_folder_missing'] });
    throw new Error('Conecte a planilha e a pasta privada antes de copiar anexos.');
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { salvarEstadoAnexos_({ status: 'busy', copied: 0, failed: 0 }); return 0; }
  var result = { status: 'completed', copied: 0, failed: 0, existing: 0, codes: [] };
  try {
    var folder = DriveApp.getFolderById(folderId);
    conferirPastaPrivada_(folder);
    var after = null, started = Date.now();
    do {
      var args = { limit: 50 };
      if (after) args.after = after;
      var page = chamar_('proex_sync_attachment_list', args);
      for (var i = 0; i < page.attachments.length; i++) {
        var item = page.attachments[i];
        if (item.driveExport && !item.driveExport.deletedAt) { result.existing++; continue; }
        if (Date.now() - started > ATTACHMENTS_BUDGET_MS) {
          result.status = result.failed ? 'failed' : 'partial';
          salvarEstadoAnexos_(result);
          if (result.failed) throw new Error('Falha na cópia de anexos. Veja PROEX → Ver estado da conexão.');
          return result.copied;
        }
        try {
          var ticket = chamar_('proex_sync_attachment_ticket', { kind: item.kind, id: item.id });
          var response = UrlFetchApp.fetch(ticket.url, { muteHttpExceptions: true, followRedirects: false });
          if (response.getResponseCode() !== 200) {
            var downloadError = new Error('Download de anexo recusado.');
            downloadError.code = 'download_http_' + response.getResponseCode(); throw downloadError;
          }
          var blob = response.getBlob();
          var bytes = blob.getBytes(), hash = hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
          var ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[item.mime] || 'bin';
          var file = folder.createFile(blob.setName(item.kind + '-' + item.id + '.' + ext));
          var reread = DriveApp.getFileById(file.getId());
          var privateConfirmed = reread.getSharingAccess() === DriveApp.Access.PRIVATE && reread.getEditors().length === 0 && reread.getViewers().length === 0;
          var readbackVerified = false;
          if (privateConfirmed && reread.getSize() === bytes.length) {
            var storedBytes = reread.getBlob().getBytes();
            readbackVerified = storedBytes.length === bytes.length && hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, storedBytes)) === hash;
          }
          if (!privateConfirmed || !readbackVerified) {
            var readbackError = new Error('A cópia privada não passou na conferência.');
            readbackError.code = privateConfirmed ? 'attachment_readback_failed' : 'attachment_not_private'; throw readbackError;
          }
          chamar_('proex_sync_attachment_ack', {
            kind: item.kind, id: item.id, driveFileId: file.getId(), driveUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
            contentHash: hash, size: bytes.length, privateConfirmed: privateConfirmed, readbackVerified: readbackVerified,
          });
          result.copied++;
        } catch (error) {
          result.failed++;
          var code = error && /^[a-z0-9_]{1,80}$/i.test(error.code || '') ? error.code : 'attachment_copy_failed';
          if (result.codes.indexOf(code) < 0 && result.codes.length < 5) result.codes.push(code);
          // Falha de autenticação não deve provocar uma chamada por anexo.
          if (['sync_token_invalid', 'sync_forbidden', 'unauthenticated'].indexOf(code) >= 0) throw error;
        }
      }
      after = page.nextCursor;
    } while (after);
    result.status = result.failed ? 'failed' : 'completed';
    salvarEstadoAnexos_(result);
    if (result.failed) throw new Error('Falha na cópia de ' + result.failed + ' anexo(s); ' + result.copied + ' confirmado(s). Veja PROEX → Ver estado da conexão.');
    return result.copied;
  } catch (_error) {
    result.status = 'failed';
    if (!result.failed) result.failed = 1;
    salvarEstadoAnexos_(result);
    // Não inclua nomes, URLs de tickets ou texto bruto do provedor nos logs.
    throw new Error('Cópia de anexos incompleta: ' + result.copied + ' confirmado(s), ' + result.failed + ' falha(s). Veja PROEX → Ver estado da conexão.');
  } finally {
    lock.releaseLock();
  }
}
function salvarEstadoAnexos_(result) {
  result.at = new Date().toISOString();
  propriedades_().setProperty('LAST_ATTACHMENTS_RESULT', JSON.stringify(result));
}
function lerEstadoAnexos_() {
  try { return JSON.parse(propriedades_().getProperty('LAST_ATTACHMENTS_RESULT') || 'null'); } catch (_error) { return null; }
}
function resumoAnexos_(result) {
  if (!result) return 'nenhuma cópia registrada';
  if (result.status === 'busy') return 'não executada: outra sincronização está em andamento';
  var text = result.copied + ' cópia(s) confirmada(s), ' + result.failed + ' falha(s)';
  if (result.status === 'partial') text += '; interrompida pelo limite de tempo, há anexos por conferir';
  if (result.existing) text += '; ' + result.existing + ' cópia(s) anterior(es) não revalidadas';
  if (result.codes && result.codes.length) text += '; códigos: ' + result.codes.join(', ');
  return text;
}

/** Interrompe se a pasta de anexos estiver compartilhada por link ou com outras pessoas. */
function conferirPastaPrivada_(folder) {
  var shared = folder.getSharingAccess() !== DriveApp.Access.PRIVATE || folder.getEditors().length > 0 || folder.getViewers().length > 0;
  if (shared) throw new Error('A pasta "' + ATTACHMENTS_FOLDER + '" está compartilhada. Remova o compartilhamento antes de copiar fotos e termos.');
}

// ---------------------------------------------------------------- utilitários

function chamar_(tool, args) {
  var props = propriedades_();
  var portal = props.getProperty('PORTAL_URL'), token = props.getProperty('SYNC_TOKEN');
  if (!portal || !token) throw new Error('Conecte a planilha primeiro: PROEX → Conectar ao portal…');
  var response = UrlFetchApp.fetch(portal + '/api/sync/connector', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, followRedirects: false,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ tool: tool, args: args }),
  });
  var body;
  try { body = JSON.parse(response.getContentText()); } catch (e) { throw new Error('Resposta inesperada do portal (' + response.getResponseCode() + ').'); }
  if (!body.ok) { var error = new Error((body.code || 'erro') + ': ' + (body.error || 'falha na integração')); error.code = body.code; throw error; }
  return body.result;
}
function pastaFilha_(parent, name) {
  var found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}
function texto_(value) { return value === null || value === undefined ? '' : String(value); }
/** Converte o texto da célula para o tipo da coluna; valores ambíguos viram erro, nunca nulo silencioso. */
function converter_(value, column) {
  var text = texto_(value).trim();
  if (column.type === 'number') {
    if (text === '') return { value: null };
    if (!/^-?\d+(\.\d+)?$/.test(text)) return { error: 'use números com ponto decimal (ex.: 3 ou 2.5)' };
    return { value: Number(text) };
  }
  if (column.type === 'boolean') {
    var lower = text.toLowerCase();
    if (['true', '1', 'sim', 'verdadeiro'].indexOf(lower) >= 0) return { value: true };
    if (['false', '0', 'não', 'nao', 'falso'].indexOf(lower) >= 0) return { value: false };
    return { error: 'use sim/não, verdadeiro/falso ou 1/0' };
  }
  if (text === '') return { value: column.type === 'text' && !/_id$/.test(column.name) ? '' : null };
  return { value: text };
}
function hex_(text) { return hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)); }
function hexBytes_(bytes) { return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join(''); }
