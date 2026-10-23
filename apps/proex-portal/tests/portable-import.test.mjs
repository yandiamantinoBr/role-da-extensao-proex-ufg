import assert from 'node:assert/strict';
import test from 'node:test';
import { migratedDatabase, importTables, readXlsx } from '../scripts/portable-import.mjs';

const project = ['id', 'name', 'short_name', 'description', 'status', 'lifecycle', 'type_id', 'parent_id', 'color', 'official_url', 'starts_at', 'ends_at', 'location', 'version', 'created_at', 'scope'];
const tables = {
  project_types: [['id', 'key', 'label', 'description', 'status', 'version', 'created_at', 'updated_at'], ['type-a', 'program', 'Programa', '', 'active', '1', '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z']],
  projects: [['_rowKey', '_rowHash', ...project], ['p1', 'h', 'p1', 'Rolê da Extensão', '', 'Ações', 'active', 'active', '', '', '#54216C', '', '', '', '', '1', '2026-10-20T00:00:00.000Z', 'internal'],
    ['p2', 'h', 'p2', 'Projeto parceiro', '', '', 'active', 'catalog', 'type-a', 'p1', '#000000', '', '', '', '', '2', '2026-10-21T00:00:00.000Z', 'external']],
  items: [['id', 'project_id', 'name', 'category', 'category_id', 'unit', 'stock', 'reserved', 'low_stock', 'description', 'condition', 'asset_code', 'version', 'created_at', 'updated_at'],
    ['i1', 'p1', 'Button azul', 'gift', '', 'unidade', '0', '0', '0', '', 'active', '', '1', '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z']],
  members: [['id', 'user_id', 'role'], ['m', 'someone', 'owner']],
};

test('portable rows are validated by the real migrations and converted to idempotent SQL', () => {
  const db = migratedDatabase(), log = [];
  const statements = importTables(db, tables, line => log.push(line));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM projects').get().n, 2);
  const partner = db.prepare("SELECT parent_id,type_id,starts_at,version,scope FROM projects WHERE id='p2'").get();
  assert.deepEqual({ ...partner }, { parent_id: 'p1', type_id: 'type-a', starts_at: null, version: 2, scope: 'external' });
  assert.equal(db.prepare("SELECT type_id FROM projects WHERE id='p1'").get().type_id, null, 'empty foreign keys become NULL');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM members').get().n, 0, 'identities and grants are never imported');
  assert.ok(log.some(line => line.startsWith('members: ignorada')));
  assert.ok(statements.every(sql => sql.startsWith('INSERT OR IGNORE INTO ')));
  const target = migratedDatabase();
  for (const sql of statements) target.exec(sql);
  for (const sql of statements) target.exec(sql);
  assert.equal(target.prepare('SELECT COUNT(*) n FROM items').get().n, 1, 'replaying the SQL is harmless');
});

test('broken references are reported instead of silently imported', () => {
  const broken = { items: [tables.items[0], ['i9', 'missing-project', 'Item', 'gift', '', 'unidade', '0', '0', '0', '', 'active', '', '1', '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z']] };
  assert.throws(() => importTables(migratedDatabase(), broken), /FOREIGN KEY|Referências/);
});

// Minimal stored (uncompressed) .xlsx produced in memory, as Google Sheets/Excel would.
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data); centrals.push(central, nameBytes); offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
test('xlsx downloads from Google Sheets or Excel are read sheet by sheet', () => {
  const xlsx = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="project_types" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>id</t></si><si><t>label</t></si><si><t>Programa &amp; ações</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>type-x</t></is></c><c r="B2" t="s"><v>2</v></c><c r="D2"><v>7</v></c></row></sheetData></worksheet>',
  });
  assert.deepEqual(readXlsx(xlsx), { project_types: [['id', 'label'], ['type-x', 'Programa & ações', '', '7']] });
});
