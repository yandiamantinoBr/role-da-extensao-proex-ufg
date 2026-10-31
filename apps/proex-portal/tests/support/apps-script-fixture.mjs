import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export class Sheet {
  constructor(name, cells = []) { this.name = name; this.cells = cells.map(row => row.slice()); this.maxRows = 1000; this.maxColumns = 26; this.frozenRows = 0; this.frozenColumns = 0; }
  getLastRow() { for (let i = this.cells.length; i > 0; i--) if (this.cells[i - 1].some(value => value !== '' && value !== undefined)) return i; return 0; }
  getLastColumn() { return Math.max(0, ...this.cells.map(row => row.length)); }
  getMaxRows() { return this.maxRows; } getMaxColumns() { return this.maxColumns; }
  insertRowsAfter(_after, count) { this.maxRows += count; } insertColumnsAfter(_after, count) { this.maxColumns += count; }
  getFrozenRows() { return this.frozenRows; } getFrozenColumns() { return this.frozenColumns; }
  setFrozenRows(value) { this.frozenRows = value; } setFrozenColumns(value) { this.frozenColumns = value; }
  getRange(row, column, height = 1, width = 1) {
    assert.ok(row > 0 && column > 0 && height > 0 && width > 0);
    assert.ok(row + height - 1 <= this.maxRows && column + width - 1 <= this.maxColumns);
    const range = {
      getDisplayValues: () => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => String(this.cells[row - 1 + r]?.[column - 1 + c] ?? ''))),
      setValues: values => { assert.equal(values.length, height); values.forEach((line, r) => { assert.equal(line.length, width); this.cells[row - 1 + r] ??= []; line.forEach((value, c) => { this.cells[row - 1 + r][column - 1 + c] = value; }); }); this.onWrite?.({ row, column, height, width }); return range; },
      clearContent: () => { for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) if (this.cells[row - 1 + r]) this.cells[row - 1 + r][column - 1 + c] = ''; return range; },
      setNumberFormat: () => range, setFontWeight: () => range, setBackgrounds: () => range, setNotes: () => range,
    };
    range.getValues = range.getDisplayValues;
    return range;
  }
}

export function scriptFixture() {
  const sheets = new Map(), properties = new Map([['ATTACHMENTS_FOLDER_ID', 'synthetic-private-folder']]), calls = [], alerts = [], files = new Map(), triggers = [];
  let now = Date.parse('2026-10-31T15:00:00.000Z'), locked = false, nextFile = 0;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const folder = { getSharingAccess: () => 'PRIVATE', getEditors: () => [], getViewers: () => [], createFile: blob => { const id = `synthetic-file-${++nextFile}`; files.set(id, blob); return { getId: () => id }; } };
  const ss = { getSheetByName: name => sheets.get(name) ?? null, insertSheet: name => { const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; }, toast: value => alerts.push(value) };
  const fixture = { ss, sheets, properties, calls, alerts, files, triggers, schemas: [], rows: {}, attachments: [],
    advance(milliseconds) { now += milliseconds; }, lock(value) { locked = value; },
    addSheet(name, cells) { const sheet = new Sheet(name, cells); sheets.set(name, sheet); return sheet; },
    control() { return Object.fromEntries(sheets.get('Controle').cells.slice(1).map(row => [row[0], row[1]])); },
    onCall() {}, download() { return { status: 200, bytes: Buffer.from('synthetic attachment') }; }, storedBytes: bytes => bytes, fileEditors: [],
  };
  const context = vm.createContext({ Date: Clock,
    SpreadsheetApp: { getActive: () => ss, getUi: () => ({ alert: value => alerts.push(value) }) },
    PropertiesService: { getUserProperties: () => ({ getProperty: key => properties.get(key) ?? null, setProperty: (key, value) => properties.set(key, value) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => !locked, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: target => triggers.splice(triggers.indexOf(target), 1), newTrigger: handler => { const builder = { timeBased: () => builder, everyMinutes: () => builder, everyHours: () => builder, create: () => triggers.push({ getHandlerFunction: () => handler }) }; return builder; } },
    DriveApp: { Access: { PRIVATE: 'PRIVATE' }, getFolderById: () => folder, getFileById: id => ({ getSharingAccess: () => 'PRIVATE', getEditors: () => fixture.fileEditors, getViewers: () => [], getSize: () => files.get(id).getBytes().length, getBlob: () => ({ getBytes: () => fixture.storedBytes(files.get(id).getBytes()) }) }) },
    UrlFetchApp: { fetch: url => { const { status, bytes = Buffer.from('') } = fixture.download(url); return { getResponseCode: () => status, getBlob: () => ({ getBytes: () => [...bytes], setName() { return this; } }) }; } },
    Utilities: { getUuid: randomUUID, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (_algorithm, value) => [...createHash('sha256').update(typeof value === 'string' ? value : Buffer.from(value.map(byte => (byte + 256) % 256))).digest()] },
  });
  vm.runInContext(readFileSync(new URL('../../public/integracoes/proex-planilha.gs', import.meta.url), 'utf8'), context);
  context.chamar_ = (tool, args) => {
    calls.push({ tool, args: structuredClone(args) }); fixture.onCall(tool, args);
    if (tool === 'proex_sync_describe') return { schemas: { tables: fixture.schemas }, runs: [], conflicts: [] };
    if (tool === 'proex_sync_run_start') return { id: 'synthetic-run' };
    if (tool === 'proex_sync_apply') return { results: [] };
    if (tool === 'proex_sync_read') return { rows: fixture.rows[args.table] ?? [], nextCursor: null };
    if (tool === 'proex_sync_attachment_list') return { attachments: fixture.attachments, nextCursor: null };
    if (tool === 'proex_sync_attachment_ticket') return { url: `https://synthetic.invalid/${args.id}` };
    return {};
  };
  fixture.context = context;
  return fixture;
}
