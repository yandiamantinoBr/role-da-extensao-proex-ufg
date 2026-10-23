import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SnapshotStore } from './store';

// Implementação da interface D1 sobre SQLite local (node:sqlite), persistida num
// SnapshotStore. Mantém as garantias de que o portal depende no Cloudflare:
// - cada `batch` é uma transação atômica, com `changes()` e asserções na mesma conexão;
// - gravações concorrentes de instâncias diferentes são serializadas por compare-and-set:
//   em conflito, a instância recarrega o banco mais recente e reexecuta o lote;
// - leituras podem estar até `freshnessMs` atrasadas, como réplicas de leitura do D1.
type Value = string | number | bigint | null | Uint8Array;
type Row = Record<string, unknown>;
type Result = { success: true; results: Row[]; meta: { changes: number; last_row_id: number; duration: number; rows_read: number; rows_written: number; changed_db: boolean } };
export type Migration = { name: string; sql: string };

function bindValue(value: unknown): Value {
  if (value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(`D1_TYPE_ERROR: Type '${value === undefined ? 'undefined' : typeof value}' not supported for value '${String(value)}'`);
}
const readOnly = (sql: string) => /^\s*(select|pragma|explain|values)\b/i.test(sql) || (/^\s*with\b/i.test(sql) && !/\b(insert|update|delete|replace)\b/i.test(sql));

class Statement {
  constructor(private readonly owner: SnapshotD1, readonly sql: string, readonly params: Value[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.owner, this.sql, values.map(bindValue)); }
  async first<T = Row>(column?: string): Promise<T | null> {
    const [result] = await this.owner.execute([this]) as Result[];
    const row = result.results[0];
    if (!row) return null;
    if (column === undefined) return row as T;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return row[column] as T;
  }
  async all<T = Row>() { return (await this.owner.execute([this]))[0] as unknown as Result & { results: T[] }; }
  async run<T = Row>() { return this.all<T>(); }
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    return (await this.owner.execute([this], options?.columnNames ? 'raw-names' : 'raw'))[0] as T[];
  }
}

export class SnapshotD1 {
  private db: DatabaseSync | null = null;
  private version = 0;
  private lastCheck = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private migrated = false;

  constructor(private readonly store: SnapshotStore, private readonly migrations: Migration[] = [],
    private readonly file = join(tmpdir(), 'proex-d1', `${process.pid}.sqlite`), private readonly freshnessMs = 1500) {}

  prepare(sql: string) { return new Statement(this, sql); }
  batch(statements: Statement[]) { return this.execute(statements); }
  async exec(sql: string) { await this.execute([new Statement(this, sql)], 'exec'); return { count: 1, duration: 0 }; }
  withSession() { return this; }

  /** Executa um lote atômico; reexecuta sobre o banco mais recente em caso de gravação concorrente. */
  execute(statements: Statement[], mode: 'objects' | 'raw' | 'raw-names' | 'exec' = 'objects'): Promise<unknown[]> {
    return this.lock(async () => {
      await this.migrate();
      const writes = mode === 'exec' || statements.some(statement => !readOnly(statement.sql));
      for (let attempt = 0; attempt < 8; attempt++) {
        await this.refresh(writes || attempt ? 0 : this.freshnessMs);
        const db = this.db!, before = this.totalChanges();
        db.exec('BEGIN IMMEDIATE');
        let results: unknown[];
        try {
          results = statements.map(statement => this.run(db, statement, mode));
          db.exec('COMMIT');
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch { /* a transação já foi encerrada pelo SQLite */ }
          throw error;
        }
        if (this.totalChanges() === before && mode !== 'exec') return results;
        if (await this.persist()) return results;
      }
      throw new Error('D1_ERROR: muitas gravações simultâneas. Tente novamente em instantes.');
    });
  }

  private run(db: DatabaseSync, statement: Statement, mode: string): unknown {
    if (mode === 'exec') { db.exec(statement.sql); return null; }
    const prepared = db.prepare(statement.sql);
    const reader = prepared.columns().length > 0;
    if (mode !== 'objects') {
      prepared.setReturnArrays(true);
      const rows = reader ? prepared.all(...statement.params) as unknown[] : (prepared.run(...statement.params), []);
      return mode === 'raw-names' ? [prepared.columns().map(column => column.name), ...rows] : rows;
    }
    if (reader) {
      const rows = (prepared.all(...statement.params) as Row[]).map(row => ({ ...row }));
      const changes = readOnly(statement.sql) ? 0 : Number((db.prepare('SELECT changes() AS n').get() as { n: number }).n);
      return this.result(rows, changes, 0);
    }
    const info = prepared.run(...statement.params);
    return this.result([], Number(info.changes), Number(info.lastInsertRowid));
  }
  private result(results: Row[], changes: number, lastRowId: number): Result {
    return { success: true, results, meta: { changes, last_row_id: lastRowId, duration: 0, rows_read: results.length, rows_written: changes, changed_db: changes > 0 } };
  }
  private totalChanges() { return Number((this.db!.prepare('SELECT total_changes() AS n').get() as { n: number }).n); }

  private lock<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private open(data: Uint8Array | null) {
    this.db?.close();
    mkdirSync(dirname(this.file), { recursive: true });
    rmSync(this.file, { force: true });
    if (data) writeFileSync(this.file, gunzipSync(data));
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }
  private async refresh(maxAgeMs: number) {
    if (this.db && Date.now() - this.lastCheck < maxAgeMs) return;
    const remote = await this.store.version();
    this.lastCheck = Date.now();
    if (this.db && remote === this.version) return;
    const snapshot = remote ? await this.store.load() : null;
    this.open(snapshot?.data ?? null);
    this.version = snapshot?.version ?? 0;
  }
  private async persist(): Promise<boolean> {
    const committed = await this.store.commit(this.version, gzipSync(readFileSync(this.file)));
    if (committed === null) { this.lastCheck = 0; this.version = -1; return false; }
    this.version = committed;
    this.lastCheck = Date.now();
    return true;
  }
  /** Aplica migrações pendentes no mesmo formato de histórico do wrangler (`d1_migrations`). */
  private async migrate() {
    if (this.migrated || !this.migrations.length) { this.migrated = true; return; }
    for (let attempt = 0; attempt < 8; attempt++) {
      await this.refresh(0);
      const db = this.db!;
      db.exec('CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
      const applied = new Set((db.prepare('SELECT name FROM d1_migrations').all() as { name: string }[]).map(row => row.name));
      const pending = this.migrations.filter(migration => !applied.has(migration.name));
      if (!pending.length && this.version > 0) { this.migrated = true; return; }
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const migration of pending) {
          db.exec(migration.sql);
          db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(migration.name);
        }
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch { /* já encerrada */ } throw error; }
      if (await this.persist()) { this.migrated = true; return; }
    }
    throw new Error('D1_ERROR: não foi possível aplicar as migrações.');
  }
}
