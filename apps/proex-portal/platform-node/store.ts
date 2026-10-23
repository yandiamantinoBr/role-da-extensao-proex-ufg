import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';

// Persistência do banco SQLite do portal fora do Cloudflare. O arquivo inteiro é
// gravado a cada transação que altera dados, com controle de versão (compare-and-set):
// duas instâncias nunca sobrescrevem a gravação uma da outra. Para a escala da PROEX
// (centenas a poucos milhares de linhas) isso preserva a semântica do D1 sem reescrever
// as consultas SQLite do portal.
export type Snapshot = { version: number; data: Uint8Array };
export interface SnapshotStore {
  version(): Promise<number>;
  load(): Promise<Snapshot | null>;
  /** Grava se a versão remota ainda for `expected`; devolve a nova versão ou null em conflito. */
  commit(expected: number, data: Uint8Array): Promise<number | null>;
}
export type StoredObject = { data: Uint8Array; contentType: string };
export interface ObjectStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

/** Disco local: VPS, servidor da UFG ou desenvolvimento. */
export function fileStores(directory: string): { snapshots: SnapshotStore; objects: ObjectStore } {
  mkdirSync(join(directory, 'objects'), { recursive: true });
  const versionFile = join(directory, 'version'), dataFile = join(directory, 'portal.sqlite.gz');
  const current = () => existsSync(versionFile) ? Number(readFileSync(versionFile, 'utf8')) : 0;
  const objectPath = (key: string) => join(directory, 'objects', createHash('sha256').update(key).digest('hex'));
  const atomic = (path: string, data: Uint8Array | string) => { writeFileSync(`${path}.tmp`, data); renameSync(`${path}.tmp`, path); };
  return {
    snapshots: {
      async version() { return current(); },
      async load() { const version = current(); return version ? { version, data: readFileSync(dataFile) } : null; },
      async commit(expected, data) {
        if (current() !== expected) return null;
        atomic(dataFile, data); atomic(versionFile, String(expected + 1));
        return expected + 1;
      },
    },
    objects: {
      async put(key, data, contentType) { atomic(objectPath(key), data); atomic(`${objectPath(key)}.type`, contentType); },
      async get(key) { const path = objectPath(key); return existsSync(path) ? { data: readFileSync(path), contentType: readFileSync(`${path}.type`, 'utf8') } : null; },
      async delete(key) { rmSync(objectPath(key), { force: true }); rmSync(`${objectPath(key)}.type`, { force: true }); },
    },
  };
}

/** Postgres (Supabase ou qualquer outro): hospedagem serverless, como a Vercel. */
export function postgresStores(url: string, schema = 'proex'): { snapshots: SnapshotStore; objects: ObjectStore } {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) throw new Error('Esquema Postgres inválido.');
  // prepare:false é necessário no pooler em modo transação do Supabase.
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15 });
  const snapshot = sql(`${schema}.sqlite_snapshot`), history = sql(`${schema}.sqlite_history`), objects = sql(`${schema}.objects`);
  return {
    snapshots: {
      async version() {
        const [row] = await sql<{ version: string }[]>`select version from ${snapshot} where id = 1`;
        return row ? Number(row.version) : 0;
      },
      async load() {
        const [row] = await sql<{ version: string; data: Uint8Array }[]>`select version, data from ${snapshot} where id = 1`;
        return row ? { version: Number(row.version), data: new Uint8Array(row.data) } : null;
      },
      async commit(expected, data) {
        return sql.begin(async tx => {
          const rows = expected === 0
            ? await tx<{ version: string }[]>`insert into ${snapshot} (id, version, data) values (1, 1, ${Buffer.from(data)}) on conflict (id) do nothing returning version`
            : await tx<{ version: string }[]>`update ${snapshot} set data = ${Buffer.from(data)}, version = version + 1, updated_at = now() where id = 1 and version = ${expected} returning version`;
          if (!rows.length) return null;
          // Cópia de segurança a cada 6 horas, mantendo os últimos 60 dias.
          await tx`insert into ${history} (version, data) select ${rows[0].version}, ${Buffer.from(data)} where not exists (select 1 from ${history} where created_at > now() - interval '6 hours')`;
          await tx`delete from ${history} where created_at < now() - interval '60 days'`;
          return Number(rows[0].version);
        });
      },
    },
    objects: {
      async put(key, data, contentType) {
        await sql`insert into ${objects} (key, content_type, size, data) values (${key}, ${contentType}, ${data.byteLength}, ${Buffer.from(data)})
          on conflict (key) do update set content_type = excluded.content_type, size = excluded.size, data = excluded.data, created_at = now()`;
      },
      async get(key) {
        const [row] = await sql<{ data: Uint8Array; content_type: string }[]>`select data, content_type from ${objects} where key = ${key}`;
        return row ? { data: new Uint8Array(row.data), contentType: row.content_type } : null;
      },
      async delete(key) { await sql`delete from ${objects} where key = ${key}`; },
    },
  };
}
