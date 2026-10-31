import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';

const root = fileURLToPath(new URL('../', import.meta.url));
const compiled = new Map();
function modelModule(file) {
  if (compiled.has(file)) return compiled.get(file);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (_match, _quote, dependency) => {
    const target = dependency.startsWith('.')
      ? modelModule(resolve(dirname(file), `${dependency}.ts`))
      : import.meta.resolve(dependency);
    return `from ${JSON.stringify(target)}`;
  });
  const result = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  compiled.set(file, result);
  return result;
}
const model = await generateSQLiteDrizzleJson(await import(modelModule(resolve(root, 'db/schema.ts'))));
const quote = name => `"${name.replaceAll('"', '""')}"`;
const sorted = rows => rows.map(row => JSON.stringify(row)).sort();

test('typed Drizzle model matches columns and foreign keys of the actual immutable SQLite migrations', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of readdirSync(resolve(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
      db.exec(readFileSync(resolve(root, 'drizzle', name), 'utf8'));
    }
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name).sort();
    assert.deepEqual(Object.keys(model.tables).sort(), tables);
    for (const name of tables) {
      const runtime = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
      const expected = Object.values(model.tables[name].columns);
      assert.deepEqual(sorted(expected.map(column => [column.name, column.type.toLowerCase(), Boolean(column.notNull)])),
        sorted(runtime.map(column => [column.name, column.type.toLowerCase(), Boolean(column.notnull)])), `${name}: column/type/nullability mismatch`);
      const runtimeKeys = db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all().map(key => [key.from, key.table, key.to]);
      const expectedKeys = Object.values(model.tables[name].foreignKeys).flatMap(key => key.columnsFrom.map((column, index) => [column, key.tableTo, key.columnsTo[index]]));
      assert.deepEqual(sorted(expectedKeys), sorted(runtimeKeys), `${name}: foreign key mismatch`);
    }
  } finally { db.close(); }
});

test('migration journal and snapshots form a complete chain and the latest snapshot has no model drift', async () => {
  const directory = resolve(root, 'drizzle');
  const journal = JSON.parse(readFileSync(resolve(directory, 'meta/_journal.json'), 'utf8'));
  const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  assert.deepEqual(journal.entries.map(entry => `${entry.tag}.sql`), files);
  let previous = null;
  for (const [index, entry] of journal.entries.entries()) {
    assert.equal(entry.idx, index);
    const snapshot = JSON.parse(readFileSync(resolve(directory, 'meta', `${String(index).padStart(4, '0')}_snapshot.json`), 'utf8'));
    if (previous) assert.equal(snapshot.prevId, previous.id);
    previous = snapshot;
  }
  assert.deepEqual(await generateSQLiteMigration(previous, model), []);
});
