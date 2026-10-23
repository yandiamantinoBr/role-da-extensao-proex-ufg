#!/usr/bin/env node
// Converte o formato portátil (abas da planilha Google/Excel ou JSON) em SQL
// idempotente para o D1/SQLite do portal.
//
//   node scripts/portable-import.mjs <planilha.xlsx|dados.json> [--out seed.sql] [--apply-local]
//
// - .xlsx: arquivo baixado em Google Sheets (Arquivo → Fazer download → .xlsx) ou Excel Online.
// - .json: backup completo baixado no portal ou { "<tabela>": [[cabeçalho...], [linha...], ...] }.
//
// As linhas são validadas num banco em memória construído pelas migrações reais
// (tipos, CHECKs e chaves estrangeiras). O SQL gerado usa INSERT OR IGNORE: nunca
// sobrescreve registros existentes e pode ser repetido. Identidades, permissões,
// auditoria e credenciais não são importadas — a equipe é reconvidada no destino.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Ordem de dependência das chaves estrangeiras.
export const IMPORT_ORDER = [
  'organizational_units', 'project_types', 'projects', 'project_links', 'project_schedule_items', 'calls', 'project_calls',
  'material_categories', 'items', 'stock_movements', 'activity_groups', 'loans', 'records',
  'campaigns', 'offers', 'offer_components',
];
const SKIPPED = new Set(['members', 'profiles', 'audit', 'entity_versions', 'visits', 'settings', 'documents', 'record_attachments',
  'participations', 'attempts', 'reservations', 'entitlements']);

export function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const dir = join(root, 'drizzle');
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));
  return db;
}

// Leitor mínimo de .xlsx (zip + XML), sem dependências.
function unzip(buffer) {
  const files = new Map();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Arquivo .xlsx inválido.');
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(offset + 10), size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42), name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    offset += 46 + nameLength + extra + comment;
  }
  return files;
}
const xmlText = value => value.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
function columnIndex(ref) { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; }
export function readXlsx(buffer) {
  const files = unzip(buffer), read = name => files.get(name)?.toString('utf8') ?? '';
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText(m[1]));
  const rels = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]));
  const tables = {};
  for (const m of read('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = rels[m[2]].replace(/^\/?xl\//, '');
    const rows = [];
    for (const row of read(`xl/${target}`).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const values = [];
      for (const cell of row[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = /t="([^"]+)"/.exec(cell[2])?.[1], body = cell[3] ?? '';
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? /<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '';
        values[columnIndex(cell[1])] = type === 's' ? shared[Number(raw)] : xmlText(raw);
      }
      rows.push(Array.from(values, v => v ?? ''));
    }
    tables[xmlText(m[1])] = rows;
  }
  return tables;
}

export function importTables(db, tables, log = () => {}) {
  const statements = [];
  for (const table of IMPORT_ORDER) {
    const sheet = tables[table];
    if (!sheet || sheet.length < 2) continue;
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    const columns = new Map(info.map(c => [c.name, c]));
    const header = sheet[0].map(String);
    const used = header.map((name, i) => [name, i]).filter(([name]) => columns.has(name));
    let inserted = 0;
    for (const row of sheet.slice(1)) {
      if (row.every(v => String(v ?? '').trim() === '')) continue;
      const values = used.map(([name, i]) => {
        const column = columns.get(name), raw = row[i] ?? '';
        if (raw === '' || raw === null) return column.notnull ? (column.dflt_value === null ? '' : undefined) : null;
        if (/INT|REAL|NUM/i.test(column.type) && /^-?\d+(\.\d+)?$/.test(String(raw))) return Number(raw);
        return String(raw);
      });
      const kept = used.filter((_, i) => values[i] !== undefined).map(([name]) => name);
      const bound = values.filter(v => v !== undefined);
      const sql = `INSERT OR IGNORE INTO ${table}(${kept.join(',')}) VALUES(${kept.map(() => '?').join(',')})`;
      const result = db.prepare(sql).run(...bound);
      inserted += Number(result.changes);
      statements.push(`INSERT OR IGNORE INTO ${table}(${kept.join(',')}) VALUES(${bound.map(literal).join(',')});`);
    }
    log(`${table}: ${inserted} linha(s)`);
  }
  for (const name of Object.keys(tables)) if (!IMPORT_ORDER.includes(name) && SKIPPED.has(name) && tables[name].length > 1) log(`${name}: ignorada (identidade, auditoria ou dado gerado pelo portal)`);
  const problems = db.prepare('PRAGMA foreign_key_check').all();
  if (problems.length) throw new Error(`Referências inválidas: ${JSON.stringify(problems.slice(0, 5))}`);
  return statements;
}
function literal(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), source = args.find(a => !a.startsWith('--'));
  if (!source) { console.error('Uso: node scripts/portable-import.mjs <planilha.xlsx|dados.json> [--out seed.sql] [--apply-local]'); process.exit(2); }
  const parsed = source.endsWith('.xlsx') ? readXlsx(readFileSync(source)) : JSON.parse(readFileSync(source, 'utf8'));
  // Aceita o backup completo do portal ({ tables: {...} }) ou o mapa direto de abas.
  const tables = parsed.tables && typeof parsed.tables === 'object' ? parsed.tables : parsed;
  const statements = importTables(migratedDatabase(), tables, line => console.log(line));
  const outIndex = args.indexOf('--out'), out = outIndex >= 0 ? args[outIndex + 1] : 'portable-import.sql';
  writeFileSync(out, statements.join('\n') + '\n');
  console.log(`SQL gerado em ${out} (${statements.length} instruções).`);
  if (args.includes('--apply-local')) {
    const dir = join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
    const file = readdirSync(dir).find(name => /^[0-9a-f]{64}\.sqlite$/.test(name));
    if (!file) throw new Error('Banco local não encontrado. Rode `pnpm db:migrate:local` antes.');
    const local = new DatabaseSync(join(dir, file));
    local.exec('PRAGMA foreign_keys=ON');
    local.exec('BEGIN');
    for (const sql of statements) local.exec(sql);
    local.exec('COMMIT');
    console.log('Aplicado no banco local.');
  }
}
