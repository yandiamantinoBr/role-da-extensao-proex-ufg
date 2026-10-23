#!/usr/bin/env node
// Converte o formato portátil (abas da planilha Google/Excel ou JSON) em SQL
// idempotente para o D1/SQLite do portal. Linhas que violam as regras do banco são
// rejeitadas e listadas (nunca descartadas em silêncio).
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

// Colunas obrigatórias que o formato portátil omite por privacidade recebem um marcador.
const PLACEHOLDERS = { actor_id: 'importacao', created_by: 'importacao', delivered_by: 'importacao', borrower_name: 'Não informado (importação)', borrower_contact: '' };
const IMPORT_ACTOR_NOTE = 'Saldo importado de backup ou planilha';

/** Valida e insere as linhas; devolve o SQL idempotente das linhas aceitas e o relatório. */
export function importTables(db, tables, log = () => {}) {
  const statements = [], rejected = [], exportedStock = new Map();
  const emit = (table, columns, values) => {
    const sql = `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`;
    db.exec('SAVEPOINT linha');
    try {
      db.prepare(sql).run(...values);
      db.exec('RELEASE linha');
      statements.push(`INSERT OR IGNORE INTO ${table}(${columns.join(',')}) VALUES(${values.map(literal).join(',')});`);
      return true;
    } catch (error) {
      db.exec('ROLLBACK TO linha'); db.exec('RELEASE linha');
      rejected.push({ table, id: values[columns.indexOf('id')] ?? values[0], reason: String(error.message || error) });
      return false;
    }
  };
  for (const table of IMPORT_ORDER) {
    const sheet = tables[table];
    if (!sheet || sheet.length < 2) continue;
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    const columns = new Map(info.map(c => [c.name, c]));
    const header = sheet[0].map(String);
    const used = header.map((name, i) => [name, i]).filter(([name]) => columns.has(name));
    const missing = info.filter(c => c.notnull && c.dflt_value === null && !c.pk && !header.includes(c.name) && c.name in PLACEHOLDERS);
    let rows = sheet.slice(1).filter(row => !row.every(v => String(v ?? '').trim() === ''));
    // Movimentos em ordem cronológica: os saldos são recalculados pelos gatilhos do banco.
    if (table === 'stock_movements') { const at = header.indexOf('created_at'); rows = [...rows].sort((a, b) => String(a[at]).localeCompare(String(b[at]))); }
    let inserted = 0;
    for (const row of rows) {
      const names = [], values = [];
      for (const [name, i] of used) {
        const column = columns.get(name), raw = row[i] ?? '';
        let value;
        if (table === 'items' && (name === 'stock' || name === 'reserved')) {
          if (name === 'stock') exportedStock.set(String(row[header.indexOf('id')]), Number(raw) || 0);
          value = 0; // saldo e reserva nascem zerados e são reconstruídos pelos movimentos
        } else if (raw === '' || raw === null) {
          if (column.notnull && column.dflt_value !== null) continue;
          value = column.notnull ? '' : null;
        } else value = /INT|REAL|NUM/i.test(column.type) && /^-?\d+(\.\d+)?$/.test(String(raw)) ? Number(raw) : String(raw);
        names.push(name); values.push(value);
      }
      for (const column of missing) { names.push(column.name); values.push(PLACEHOLDERS[column.name]); }
      if (emit(table, names, values)) inserted++;
    }
    log(`${table}: ${inserted} de ${rows.length} linha(s)`);
  }
  // Ajuste final: o saldo exportado prevalece quando os movimentos não o explicam
  // (por exemplo, uma planilha sem a aba de movimentos). O ajuste fica registrado.
  for (const [itemId, expected] of exportedStock) {
    const current = db.prepare('SELECT stock FROM items WHERE id=?').get(itemId)?.stock;
    if (current === undefined || current === expected) continue;
    const id = `importacao-saldo-${itemId}`.slice(0, 200), now = new Date().toISOString();
    if (emit('stock_movements', ['id', 'item_id', 'delta', 'kind', 'note', 'actor_id', 'created_at'], [id, itemId, expected - current, 'adjust', IMPORT_ACTOR_NOTE, 'importacao', now])) log(`items: saldo de ${itemId} ajustado para ${expected}`);
  }
  for (const name of Object.keys(tables)) if (!IMPORT_ORDER.includes(name) && SKIPPED.has(name) && tables[name].length > 1) log(`${name}: ignorada (identidade, auditoria ou dado gerado pelo portal)`);
  for (const item of rejected) log(`REJEITADA ${item.table} ${item.id}: ${item.reason}`);
  const problems = db.prepare('PRAGMA foreign_key_check').all();
  if (problems.length) throw new Error(`Referências inválidas: ${JSON.stringify(problems.slice(0, 5))}`);
  return Object.assign(statements, { rejected });
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
  if (statements.rejected.length) { console.error(`${statements.rejected.length} linha(s) rejeitada(s); veja as mensagens REJEITADA acima.`); process.exitCode = 1; }
  if (args.includes('--apply-postgres')) {
    // Alvo Node (Vercel): aplica sobre o SQLite guardado no Postgres, com o mesmo
    // controle de versão do portal (platform-node/store.ts). O portal precisa ter sido
    // aberto ao menos uma vez para criar o banco e aplicar as migrações.
    const { default: postgres } = await import('postgres');
    const { gzipSync, gunzipSync } = await import('node:zlib');
    const { tmpdir } = await import('node:os');
    const url = process.env.PROEX_DATABASE_URL, schema = process.env.PROEX_DATABASE_SCHEMA || 'proex';
    if (!url) throw new Error('Defina PROEX_DATABASE_URL.');
    const sql = postgres(url, { prepare: false, max: 1 }), table = sql(`${schema}.sqlite_snapshot`);
    try {
      for (let attempt = 0; ; attempt++) {
        const [row] = await sql`select version, data from ${table} where id = 1`;
        if (!row) throw new Error('Banco ainda não criado: abra o portal uma vez antes de importar.');
        const file = join(tmpdir(), `proex-import-${process.pid}.sqlite`);
        writeFileSync(file, gunzipSync(row.data));
        const target = new DatabaseSync(file);
        target.exec('PRAGMA foreign_keys=ON; BEGIN');
        for (const statement of statements) target.exec(statement);
        target.exec('COMMIT');
        target.close();
        const updated = await sql`update ${table} set data = ${gzipSync(readFileSync(file))}, version = version + 1, updated_at = now() where id = 1 and version = ${row.version} returning version`;
        if (updated.length) { console.log(`Aplicado no Postgres (versão ${updated[0].version}).`); break; }
        if (attempt >= 4) throw new Error('O banco mudou durante a importação. Tente novamente.');
      }
    } finally { await sql.end(); }
  }
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
