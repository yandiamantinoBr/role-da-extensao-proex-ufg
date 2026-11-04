#!/usr/bin/env node
// Executa public/integracoes/proex-planilha.gs contra um portal em execução, com uma
// planilha Google simulada em memória. Serve para validar o conector sem publicar nada.
//
//   PORTAL_URL=http://127.0.0.1:5173 SYNC_TOKEN=pxs_... node scripts/apps-script-harness.mjs
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { localHarnessUrl } from './local-harness-url.mjs';

const portal = process.env.PORTAL_URL, token = process.env.SYNC_TOKEN;
if (!portal || !token) { console.error('Defina PORTAL_URL e SYNC_TOKEN.'); process.exit(2); }
const localOrigin = localHarnessUrl(portal).origin;

class Sheet {
  constructor(name) { this.name = name; this.cells = []; this.maxRows = 1000; this.maxCols = 26; this.frozenRows = 0; this.frozenCols = 0; }
  getName() { return this.name; }
  getLastRow() { for (let r = this.cells.length; r > 0; r--) if ((this.cells[r - 1] || []).some(v => v !== '' && v !== undefined)) return r; return 0; }
  getLastColumn() { return Math.max(0, ...this.cells.map(row => { for (let c = row.length; c > 0; c--) if (row[c - 1] !== '' && row[c - 1] !== undefined) return c; return 0; })); }
  getMaxRows() { return this.maxRows; } getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_after, n) { this.maxRows += n; } insertColumnsAfter(_after, n) { this.maxCols += n; }
  getFrozenRows() { return this.frozenRows; } setFrozenRows(n) { this.frozenRows = n; }
  getFrozenColumns() { return this.frozenCols; } setFrozenColumns(n) { this.frozenCols = n; }
  getRange(row, col, height = 1, width = 1) {
    if (row + height - 1 > this.maxRows || col + width - 1 > this.maxCols) throw new Error(`Range fora da grade em ${this.name}`);
    const { cells } = this, read = () => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => String(cells[row - 1 + r]?.[col - 1 + c] ?? '')));
    const range = {
      getValues: read, getDisplayValues: read,
      setValues(values) { assert.equal(values.length, height); values.forEach((line, r) => { assert.equal(line.length, width); cells[row - 1 + r] ??= []; line.forEach((v, c) => { assert.equal(typeof v, 'string', 'o conector deve gravar texto literal'); cells[row - 1 + r][col - 1 + c] = v; }); }); return range; },
      clearContent() { for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) if (cells[row - 1 + r]) cells[row - 1 + r][col - 1 + c] = ''; return range; },
      setNumberFormat() { return range; }, setFontWeight() { return range; }, setBackgrounds() { return range; }, setNotes() { return range; },
    };
    return range;
  }
}
const sheets = new Map(), properties = {}, prompts = [portal, token], files = new Map();
const ss = {
  getId: () => 'harnessSpreadsheet0001', toast: (msg) => console.log('  toast:', msg),
  getSheetByName: name => sheets.get(name) ?? null,
  insertSheet: name => { const s = new Sheet(name); sheets.set(name, s); return s; },
};
const folder = id => ({ getId: () => id, getSharingAccess: () => 'PRIVATE', getEditors: () => [], getViewers: () => [], getFoldersByName: () => ({ hasNext: () => false }), createFolder: name => folder('folder_' + name.replace(/\W/g, '').padEnd(12, 'x')),
  createFile: blob => { const id = 'file_' + randomUUID().replace(/-/g, ''); files.set(id, blob); return { getId: () => id }; } });
const javaBytes = buf => [...buf].map(b => (b > 127 ? b - 256 : b));
const context = vm.createContext({
  console,
  SpreadsheetApp: { getActive: () => ss, getUi: () => ({ ButtonSet: { OK_CANCEL: 1 }, Button: { OK: 'OK' }, alert: msg => console.log('  alert:', msg.split('\n')[0]),
    prompt: () => { const value = prompts.shift(); return { getSelectedButton: () => 'OK', getResponseText: () => value }; } }) },
  DriveApp: { Access: { PRIVATE: 'PRIVATE' }, getRootFolder: () => folder('rootFolder0000001'), getFolderById: id => folder(id),
    getFileById: id => ({ getParents: () => ({ hasNext: () => true, next: () => folder('parentFolder00001') }), getSharingAccess: () => 'PRIVATE', getEditors: () => [], getViewers: () => [], getSize: () => files.get(id)?.bytes.length ?? 0, getBlob: () => files.get(id), setTrashed() {} }) },
  PropertiesService: { getUserProperties: () => ({ getProperty: k => properties[k] ?? null, setProperty: (k, v) => { properties[k] = v; }, setProperties: o => Object.assign(properties, o), deleteProperty: k => { delete properties[k]; } }), getScriptProperties: () => ({ deleteProperty() {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => [] },
  Utilities: { getUuid: () => randomUUID(), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_alg, value) => javaBytes(createHash('sha256').update(typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value.map(b => (b + 256) % 256))).digest()) },
  UrlFetchApp: { fetch(url, options = {}) {
    if (new URL(url).origin !== localOrigin) throw new Error('O harness bloqueou uma chamada fora do portal local.');
    const args = ['-s', '-o', '-', '-w', '\n%{http_code}', url];
    if (options.method === 'post') args.push('-X', 'POST', '-H', `Content-Type: ${options.contentType}`, '--data-binary', '@-');
    for (const [k, v] of Object.entries(options.headers || {})) args.push('-H', `${k}: ${v}`);
    const output = execFileSync('curl', args, { input: options.payload ?? '', maxBuffer: 64 * 1024 * 1024 });
    const split = output.lastIndexOf(10), body = output.subarray(0, split), status = Number(output.subarray(split + 1).toString());
    return { getResponseCode: () => status, getContentText: () => body.toString('utf8'),
      getBlob: () => ({ bytes: body, getBytes: () => javaBytes(body), setName(name) { this.name = name; return this; } }) };
  } },
});
vm.runInContext(readFileSync(new URL('../public/integracoes/proex-planilha.gs', import.meta.url), 'utf8'), context);

const cell = (sheetName, predicate, column) => { const s = sheets.get(sheetName), header = s.cells[0]; const row = s.cells.slice(1).find(r => predicate(Object.fromEntries(header.map((h, i) => [h, r[i]])))); return { s, row, index: s.cells.indexOf(row), col: header.indexOf(column) }; };

console.log('1. Conectar');
context.conectar();
console.log('2. Primeira sincronização');
console.log(' ', context.sincronizar_());
const items = sheets.get('items');
assert.ok(items && items.getLastRow() > 1, 'a aba items deve ter linhas');
assert.ok(sheets.get('Controle').cells.some(r => String(r[0]).startsWith('baseline:items:')), 'bases gravadas no Controle');
const expectedTables = context.chamar_('proex_sync_describe', {}).schemas.tables.length;
const controlValue = key => sheets.get('Controle').cells.find(row => row[0] === key)?.[1];
assert.equal(controlValue('syncState'), 'verified');
assert.equal(controlValue('tablesVerified'), String(expectedTables));
assert.equal(controlValue('connectorVersion'), context.CONNECTOR_VERSION);

console.log('3. Editar a descrição de um material e criar um movimento pela aba Operações');
const target = cell('items', r => r.name?.startsWith('Button azul'), 'description');
const newDescription = `Button azul, 2,5 cm — revisado pela planilha ${new Date().toISOString()}`;
target.s.cells[target.index][target.col] = newDescription;
const itemId = target.s.cells[target.index][target.s.cells[0].indexOf('id')];
const ops = sheets.get('Operações'); const opKey = 'harness-' + randomUUID();
ops.cells.push([opKey, 'stock.move', JSON.stringify({ itemId, delta: 5, kind: 'receive', note: 'Contagem física (teste do conector)' }), '', '', '']);
console.log(' ', context.sincronizar_());
const after = cell('items', r => r.id === itemId, 'description');
assert.equal(after.row[after.col], newDescription, 'edição aplicada e reexportada');
const opRow = ops.cells.find(r => r[0] === opKey);
console.log('  retorno da operação:', opRow.slice(3).join(' | '));
const stock = cell('items', r => r.id === itemId, 'stock');
console.log('  saldo após o movimento:', stock.row[stock.col]);

console.log('4. Conflito: editar a partir de uma base antiga');
const stale = cell('items', r => r.id === itemId, 'description');
const control = sheets.get('Controle'), baseRow = control.cells.find(r => r[0] === `baseline:items:${itemId}`);
const base = JSON.parse(baseRow[1]); base.version = Number(base.version) - 1; baseRow[1] = JSON.stringify(base);
stale.s.cells[stale.index][stale.s.cells[0].indexOf('version')] = String(base.version);
stale.s.cells[stale.index][stale.col] = 'Edição concorrente que deve virar conflito';
console.log(' ', context.sincronizar_());
assert.ok(sheets.get('Conflitos').getLastRow() > 1, 'conflito registrado');
const kept = cell('items', r => r.id === itemId, 'description');
assert.equal(kept.row[kept.col], newDescription, 'o portal não aceitou a edição conflitante');
console.log('5. Linhas inválidas não travam a sincronização');
const before = sheets.get('Conflitos').getLastRow();
const bad = [['curta', 'stock.move', '{}'], ['harness-json-' + randomUUID(), 'stock.move', '{nao é json'], [opKey, 'stock.move', JSON.stringify({ itemId, delta: 99, kind: 'receive', note: 'Mesma chave, outro conteúdo' })]];
for (const [key, action, input] of bad) ops.cells.push([key, action, input, '', '', '']);
const okKey = 'harness-ok-' + randomUUID();
ops.cells.push([okKey, 'stock.move', JSON.stringify({ itemId, delta: 1, kind: 'receive', note: 'Operação válida no mesmo lote' }), '', '', '']);
const low = cell('items', r => r.id === itemId, 'low_stock');
low.s.cells[low.index][low.col] = '1,5';
console.log(' ', context.sincronizar_());
const status = key => ops.cells.find(r => r[0] === key)?.slice(3, 6).join(' | ');
assert.match(status('curta'), /^rejected/);
assert.match(status(bad[1][0]), /^rejected \| {2}\| invalid_json/);
assert.match(ops.cells.filter(r => r[0] === opKey)[1].slice(3).join('|'), /rejected\|\|sync_operation_changed/);
assert.match(status(okKey), /^applied/, 'a valid operation in the same batch is still applied');
assert.ok(sheets.get('Conflitos').cells.slice(before).some(r => String(r[5]).includes('low_stock')), 'invalid number reported with the desired value');
console.log('6. Anexos:', context.copiarAnexos_(), 'arquivo(s) copiado(s)');
console.log('7. Preservar uma edição feita durante a leitura HTTP e conferir todos os valores');
const beforeRace = cell('items', row => row.id === itemId, 'description');
const baselineBeforeRace = controlValue(`baseline:items:${itemId}`);
const read = context.lerTabela_; let inject = true;
context.lerTabela_ = table => {
  const rows = read(table);
  if (table === 'items' && inject) { inject = false; beforeRace.row[beforeRace.col] = 'Edição humana durante a exportação'; }
  return rows;
};
try { assert.match(context.sincronizar_(), /conflito/); }
finally { context.lerTabela_ = read; }
assert.equal(beforeRace.row[beforeRace.col], 'Edição humana durante a exportação', 'a exportação não deve sobrescrever a edição feita durante HTTP');
assert.equal(controlValue(`baseline:items:${itemId}`), baselineBeforeRace, 'a base da aba não conferida deve permanecer intacta');
const currentSchema = context.chamar_('proex_sync_describe', {}).schemas.tables.find(schema => schema.table === 'items');
assert.equal(context.conferirTabela_(ss, currentSchema, read('items')), false, 'chave e hash intactos não confirmam valores divergentes');
assert.equal(controlValue('syncState'), 'partial');

console.log('8. Conferir recibos de Operações após edição concorrente e chave reutilizada');
assert.match(context.sincronizar_(), /^Sincronizado:/, 'a edição pendente da etapa anterior deve ser importada');
const balance = () => {
  const current = cell('items', row => row.id === itemId, 'stock');
  return Number(current.row[current.col]);
};
const startingStock = balance();
const raceKey = 'harness-race-' + randomUUID();
const raceInput = { itemId, delta: 2, kind: 'receive', note: 'Recebimento de duas unidades.' };
const concurrentInput = JSON.stringify({ ...raceInput, delta: 9 });
const raceRow = [raceKey, 'stock.move', JSON.stringify(raceInput), '', '', ''];
ops.cells.push(raceRow);
const call = context.chamar_;
let editedDuringApply = false;
context.chamar_ = (tool, args) => {
  const response = call(tool, args);
  if (tool === 'proex_sync_apply' && args.changes?.some(change => change.changeKey === raceKey)) {
    assert.equal(response.results[0].status, 'applied');
    raceRow[2] = concurrentInput;
    editedDuringApply = true;
  }
  return response;
};
try { assert.match(context.sincronizar_(), /conflito/); }
finally { context.chamar_ = call; }
assert.ok(editedDuringApply);
assert.deepEqual(raceRow, [raceKey, 'stock.move', concurrentInput, 'conflict', '', 'operation_row_changed']);
assert.equal(balance(), startingStock + 2, 'só o conteúdo original chegou ao estoque');
assert.ok(sheets.get('Conflitos').cells.some(row => row.join(' ').includes('operation_row_changed')));

const reusedRow = [raceKey, 'stock.move', concurrentInput, '', '', ''];
ops.cells.push(reusedRow);
assert.doesNotThrow(() => context.sincronizar_());
assert.deepEqual(reusedRow.slice(3), ['rejected', '', 'sync_operation_changed']);
assert.equal(balance(), startingStock + 2, 'nem a divergência nem a chave reutilizada alteraram o estoque');

console.log('9. Cadastrar material pelo formulário, retomar resposta perdida e conferir ida e volta');
const activeWorkbook = ss.getId;
ss.getId = () => 'anotherSyntheticWorkbook0002';
try { assert.throws(() => context.carregarCadastroMaterial(), /Abra a planilha mestre configurada/); }
finally { ss.getId = activeWorkbook; }
const cadastro = context.carregarCadastroMaterial();
const project = cadastro.projects.find(project => project.name.split(' · ')[0] === 'Projeto QA descartável');
assert.ok(project?.id, 'o formulário oferece um projeto da planilha conectada');
const input = {
  changeKey: cadastro.draft.changeKey,
  projectId: project.id,
  category: 'gift',
  categoryId: '',
  name: 'Material do formulário QA',
  unit: 'unidade',
  lowStock: 3,
  description: 'Cadastro manual feito no formulário da planilha.',
  assetCode: '',
};
const lost = new Error('Resposta sintética interrompida após confirmação no portal.');
let lostAfterCommit = false;
context.chamar_ = (tool, args) => {
  const response = call(tool, args);
  if (tool === 'proex_sync_apply' && args.changes?.some(change => change.changeKey === input.changeKey)) {
    assert.equal(response.results[0].status, 'applied');
    lostAfterCommit = true;
    throw lost;
  }
  return response;
};
try { assert.throws(() => context.salvarCadastroMaterial(input), /retome o mesmo cadastro/); }
finally { context.chamar_ = call; }
assert.ok(lostAfterCommit);
const pending = context.carregarCadastroMaterial().draft;
assert.equal(pending.changeKey, input.changeKey);
assert.equal(pending.input.name, input.name);
assert.throws(() => context.salvarCadastroMaterial({ ...input, name: 'Mudança após perda de resposta' }), /Há um cadastro para retomar/);
assert.throws(() => context.novoCadastroMaterial(input.changeKey), /cadastro em andamento/);
const created = context.salvarCadastroMaterial(input);
assert.equal(created.status, 'duplicate', 'a mesma chave deve recuperar o cadastro anterior');
assert.ok(created.entityId);
const portalCreated = () => context.lerTabela_('items').filter(item => item.name === input.name && item.project_id === project.id);
const createdRows = portalCreated();
assert.equal(createdRows.length, 1, 'a repetição não cria outro material');
const [portalItem] = createdRows;
assert.equal(portalItem.id, created.entityId);
assert.equal(portalItem.description, input.description);
assert.equal(Number(portalItem.stock), 0);
assert.equal(Number(portalItem.low_stock), 3);
assert.ok(!items.cells.some(row => row.includes(created.entityId)), 'o formulário separa cadastro de sincronização');
context.novoCadastroMaterial(input.changeKey);
assert.notEqual(context.carregarCadastroMaterial().draft.changeKey, input.changeKey);
assert.match(context.sincronizar_(), /^Sincronizado:/);
const exportedItem = cell('items', row => row.id === created.entityId, 'description');
assert.equal(exportedItem.row[exportedItem.col], input.description);
assert.equal(exportedItem.row[exportedItem.s.cells[0].indexOf('stock')], '0');
const updatedDescription = 'Descrição revisada na coluna em creme.';
exportedItem.row[exportedItem.col] = updatedDescription;
assert.match(context.sincronizar_(), /^Sincronizado:/);
const [updatedItem] = portalCreated();
assert.equal(updatedItem.description, updatedDescription);
assert.equal(Number(updatedItem.version), Number(portalItem.version) + 1);
const reexportedItem = cell('items', row => row.id === created.entityId, 'description');
assert.equal(reexportedItem.row[reexportedItem.col], updatedDescription);
const updatedBaseline = JSON.parse(controlValue(`baseline:items:${created.entityId}`));
assert.equal(updatedBaseline.description, updatedDescription);
assert.equal(updatedBaseline.version, updatedItem.version);
assert.equal(controlValue('syncState'), 'verified');
assert.equal(controlValue('tablesVerified'), String(expectedTables));

if (process.env.PROEX_QA_PORTAL_EDIT === '1') {
  console.log('10. Editar pelo Portal autenticado e conferir a projeção na planilha');
  const { localClient, QA_EMAIL, QA_TEST_PASSWORD } = await import('./qa-local.mjs');
  const loopback = new URL(localOrigin);
  assert.equal(loopback.hostname, '127.0.0.1', 'edição pela sessão sintética só na bancada QA');
  const api = localClient(Number(loopback.port));
  const login = await api('/api/account', { action: 'login', identifier: QA_EMAIL, password: QA_TEST_PASSWORD, returnTo: '/' });
  assert.equal(login.status, 200);
  const portalDescription = 'Descrição alterada no Portal pela conta sintética.';
  const response = await api('/api/portal', { action: 'item.update', id: created.entityId, expectedVersion: Number(updatedItem.version), description: portalDescription, operationKey: randomUUID() });
  assert.equal(response.status, 200);
  assert.equal(response.value.item.description, portalDescription);
  assert.equal(Number(response.value.item.version), Number(updatedItem.version) + 1);
  assert.equal(reexportedItem.row[reexportedItem.col], updatedDescription, 'a célula ainda guarda o valor anterior à sincronização');
  assert.match(context.sincronizar_(), /^Sincronizado:/);
  const projected = cell('items', row => row.id === created.entityId, 'description');
  assert.equal(projected.row[projected.col], portalDescription);
  assert.equal(projected.row[projected.s.cells[0].indexOf('version')], String(response.value.item.version));
  assert.equal(JSON.parse(controlValue(`baseline:items:${created.entityId}`)).description, portalDescription);
  assert.equal(controlValue('syncState'), 'verified');
  assert.equal(controlValue('tablesVerified'), String(expectedTables));
}

console.log('OK — conector validado contra', portal);
