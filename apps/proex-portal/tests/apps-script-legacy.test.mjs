import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const directory = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) {
    const source = JSON.parse(readFileSync(`${directory}lib/${name}`, 'utf8'));
    return `data:text/javascript;base64,${Buffer.from(`export default ${JSON.stringify(source)};`).toString('base64')}`;
  }
  let code = ts.transpileModule(readFileSync(`${directory}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  const url = `data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${name}-legacy-sync-test.mjs`).toString('base64')}`;
  modules.set(name, url);
  return url;
}
const { describePortableSchemas, exportPortablePage } = await import(compile('sync/portable'));
const { applyPortableChanges } = await import(compile('sync/apply'));
const schemas = describePortableSchemas().tables;
const schemaFor = table => schemas.find(schema => schema.table === table);
const newProjectFields = ['unit_id', 'prizes_enabled', 'scope', 'thematic_area', 'extension_line'];

// Only the sheet operations used by collection and schema expansion are simulated.
class Sheet {
  constructor(header, row) { this.cells = [header.slice(), ...(row ? [header.map(name => row[name] ?? '')] : [])]; this.columns = header.length; this.frozenRows = 0; this.frozenColumns = 0; }
  getLastRow() { return this.cells.length; }
  getLastColumn() { return Math.max(...this.cells.map(row => row.length)); }
  getMaxRows() { return 100; }
  getMaxColumns() { return this.columns; }
  insertColumnsAfter(_after, count) { this.columns += count; }
  getFrozenRows() { return this.frozenRows; }
  getFrozenColumns() { return this.frozenColumns; }
  setFrozenRows(value) { this.frozenRows = value; }
  setFrozenColumns(value) { this.frozenColumns = value; }
  getRange(row, column, height = 1, width = 1) {
    assert.ok(column + width - 1 <= this.columns);
    const range = {
      getDisplayValues: () => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => String(this.cells[row - 1 + r]?.[column - 1 + c] ?? ''))),
      setValues: values => { values.forEach((line, r) => { this.cells[row - 1 + r] ??= []; line.forEach((value, c) => { this.cells[row - 1 + r][column - 1 + c] = value; }); }); return range; },
      clearContent: () => { for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) if (this.cells[row - 1 + r]) this.cells[row - 1 + r][column - 1 + c] = ''; return range; },
      setNumberFormat: () => range, setFontWeight: () => range, setBackgrounds: () => range, setNotes: () => range,
    };
    return range;
  }
}
function sheetFixture(schema, baseline, missingColumns = [], missingBaseline = missingColumns) {
  const sheets = new Map(), header = schema.columns.map(column => column.name).filter(name => !missingColumns.includes(name));
  const sheet = new Sheet(header, baseline); sheets.set(schema.sheetName, sheet);
  const ss = { getSheetByName: name => sheets.get(name) ?? null, insertSheet: name => { const added = new Sheet([]); sheets.set(name, added); return added; } };
  const original = Object.fromEntries(Object.entries(baseline).filter(([name]) => !missingBaseline.includes(name)));
  const context = vm.createContext({ Utilities: { getUuid: randomUUID, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_algorithm, value) => [...createHash('sha256').update(value).digest()].map(byte => byte > 127 ? byte - 256 : byte) } });
  vm.runInContext(readFileSync(`${directory}public/integracoes/proex-planilha.gs`, 'utf8'), context);
  return { context, sheet, ss, sheets, edit(name, value) { sheet.cells[1][header.indexOf(name)] = value; },
    collect() { return JSON.parse(JSON.stringify(context.coletarEdicoes_(ss, [schema], { [`${schema.table}:${original._rowKey}`]: original }))); } };
}
function syntheticRow(schema) {
  return Object.fromEntries(schema.columns.map(column => [column.name, column.name === '_rowKey' || column.name === 'id' ? 'qa-row' : column.name === '_rowHash' ? 'qa-hash' : column.type === 'boolean' ? 1 : column.type === 'number' ? 1 : `${column.name} original`]));
}
function databaseFixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${directory}drizzle`).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(`${directory}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString(), userId = 'qa-owner', email = 'qa-owner@example.test';
  native.prepare("INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES('qa-member',?,?,'owner',NULL,?)").run(userId, email, now);
  native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
  native.prepare("INSERT INTO organizational_units(id,name,acronym,kind,created_at,updated_at) VALUES('qa-unit','Unidade fictícia','QA','academic',?,?)").run(now, now);
  native.prepare("INSERT INTO projects(id,name,unit_id,prizes_enabled,scope,thematic_area,extension_line,created_at) VALUES('qa-project','Projeto anterior','qa-unit',1,'external','cultura','12',?)").run(now);
  const actor = { userId, email, displayName: 'QA', capabilities: [], members: [{ id: 'qa-member', user_id: userId, email, role: 'owner', project_id: null, revoked_at: null, created_at: now }] };
  const db = { prepare(sql) { let values = []; return { bind(...parameters) { values = parameters; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; },
    async batch(statements) { native.exec('BEGIN'); try { const result = statements.map(statement => statement.execute()); native.exec('COMMIT'); return result; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  return { native, db, actor };
}

test('legacy project edit reaches the backend while omitted new columns preserve current settings', async () => {
  const { native, db, actor } = databaseFixture();
  try {
    const current = (await exportPortablePage(db, actor, { table: 'projects' })).rows[0];
    const fixture = sheetFixture(schemaFor('projects'), current, newProjectFields);
    fixture.edit('name', 'Nome corrigido na planilha antiga');
    const collected = fixture.collect();
    assert.deepEqual(collected.problems, []); assert.equal(collected.changes.length, 1);
    for (const field of newProjectFields) assert.equal(Object.hasOwn(collected.changes[0].fields, field), false);
    const applied = await applyPortableChanges(db, actor, { changes: collected.changes });
    assert.equal(applied.results[0].status, 'applied');
    const saved = native.prepare('SELECT name,unit_id,prizes_enabled,scope,thematic_area,extension_line FROM projects WHERE id=?').get(current.id);
    assert.deepEqual({ ...saved }, { name: 'Nome corrigido na planilha antiga', unit_id: 'qa-unit', prizes_enabled: 1, scope: 'external', thematic_area: 'cultura', extension_line: '12' });
    const refreshed = (await exportPortablePage(db, actor, { table: 'projects' })).rows[0];
    fixture.context.escreverTabela_(fixture.ss, schemaFor('projects'), [refreshed]);
    assert.equal(fixture.sheet.columns, 22); assert.equal(fixture.sheet.cells[1][2], current.id);
    assert.equal(fixture.context.conferirTabela_(fixture.ss, schemaFor('projects'), [refreshed]), true);
    const units = schemaFor('organizational_units');
    fixture.context.escreverTabela_(fixture.ss, units, []);
    assert.ok(fixture.sheets.has('organizational_units'));
  } finally { native.close(); }
});

test('missing checkbox column uses a known baseline; explicit false remains an intended update', () => {
  const schema = schemaFor('projects'), row = syntheticRow(schema);
  const missing = sheetFixture(schema, row, ['prizes_enabled'], []); missing.edit('name', 'Outro nome');
  assert.equal(missing.collect().changes[0].fields.prizes_enabled, true);
  const unchecked = sheetFixture(schema, row); unchecked.edit('prizes_enabled', false);
  const result = unchecked.collect();
  assert.deepEqual(result.problems, []); assert.equal(result.changes[0].fields.prizes_enabled, false);
  const blank = sheetFixture(schema, row); blank.edit('prizes_enabled', '');
  assert.equal(blank.collect().changes.length, 0); assert.match(blank.collect().problems[0][5], /prizes_enabled/);
});

test('legacy edits also retain backend defaults instead of inventing values for new fields', async () => {
  const { native, db, actor } = databaseFixture();
  try {
    native.prepare("INSERT INTO projects(id,name,created_at) VALUES('qa-defaults','Projeto com padrões',?)").run(new Date().toISOString());
    const original = (await exportPortablePage(db, actor, { table: 'projects' })).rows.find(row => row.id === 'qa-defaults');
    const fixture = sheetFixture(schemaFor('projects'), original, newProjectFields);
    fixture.edit('name', 'Padrões preservados');
    const result = await applyPortableChanges(db, actor, { changes: fixture.collect().changes });
    assert.equal(result.results[0].status, 'applied');
    const saved = native.prepare('SELECT unit_id,prizes_enabled,scope,thematic_area,extension_line FROM projects WHERE id=?').get(original.id);
    assert.deepEqual({ ...saved }, Object.fromEntries(newProjectFields.map(field => [field, original[field]])));
    assert.equal(saved.prizes_enabled, 0); assert.equal(saved.scope, 'internal');
  } finally { native.close(); }
});

test('legacy columns are omitted only for update services that preserve absent fields', () => {
  for (const [table, missing, edited] of [['project_types', 'description', 'label'], ['project_links', 'url', 'label'], ['project_schedule_items', 'note', 'title'], ['calls', 'description', 'title'], ['material_categories', 'description', 'label'], ['items', 'description', 'name'], ['organizational_units', 'campus', 'name']]) {
    const schema = schemaFor(table), fixture = sheetFixture(schema, syntheticRow(schema), [missing]);
    fixture.edit(edited, 'Texto corrigido'); const result = fixture.collect();
    assert.deepEqual(result.problems, [], table); assert.equal(result.changes.length, 1, table);
    assert.equal(Object.hasOwn(result.changes[0].fields, missing), false, table);
  }
  // The legacy campaign service requires a complete editable row. Never invent
  // empty strings for missing data there, even when the new column is optional.
  for (const missing of ['rules_text', 'location', 'retry_limit']) {
    const schema = schemaFor('campaigns'), fixture = sheetFixture(schema, syntheticRow(schema), [missing]);
    fixture.edit('name', 'Nome corrigido'); const result = fixture.collect();
    assert.equal(result.changes.length, 0); assert.match(result.problems[0][5], /coluna ausente/i);
  }
  const campaign = schemaFor('campaigns'), known = sheetFixture(campaign, syntheticRow(campaign), ['rules_text'], []);
  known.edit('name', 'Nome corrigido');
  assert.deepEqual(known.collect().problems, []); assert.equal(known.collect().changes[0].fields.rules_text, 'rules_text original');
  const future = { ...schemaFor('projects'), table: 'future_metadata' };
  const unknown = sheetFixture(future, syntheticRow(future), ['description']); unknown.edit('name', 'Nome corrigido');
  assert.equal(unknown.collect().changes.length, 0); assert.match(unknown.collect().problems[0][5], /coluna ausente/i);
});
