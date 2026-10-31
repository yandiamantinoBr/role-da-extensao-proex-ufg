import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
export type CaptureLimits = { totalBytes: number; objectBytes: number; objects: number };
export type BackupCapture = { backend: 'disk' | 'postgres'; snapshot: Snapshot; objects: { storageId: string; key: string | null; contentType: string; data: Uint8Array }[] };
export type BackendStores = { snapshots: SnapshotStore; objects: ObjectStore; backup: { authoritySnapshot(limits: CaptureLimits): Promise<Snapshot>; capture(limits: CaptureLimits): Promise<BackupCapture> } };
function captureError(code: 'backup_limit' | 'backup_source'): never { throw Object.assign(new Error('Backup source unavailable.'), { name: 'BackupSourceError', code }); }

/** Disco local: VPS, servidor da UFG ou desenvolvimento. */
export function fileStores(directory: string): BackendStores {
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
    backup: {
      async authoritySnapshot(limits) {
        if (!existsSync(dataFile) || !existsSync(versionFile) || lstatSync(dataFile).isSymbolicLink() || lstatSync(versionFile).isSymbolicLink()) captureError('backup_source');
        if (lstatSync(dataFile).size > limits.totalBytes) captureError('backup_limit');
        const version = current(), data = readFileSync(dataFile);
        if (!Number.isSafeInteger(version) || version < 1 || current() !== version) captureError('backup_source');
        return { version, data };
      },
      async capture(limits) {
        // All operations below are synchronous: no application write can interleave
        // in this Node process. This backend does not support multiple writers in
        // different OS processes; Supabase uses a database transaction below.
        if (!existsSync(dataFile) || !existsSync(versionFile) || lstatSync(dataFile).isSymbolicLink() || lstatSync(versionFile).isSymbolicLink() || lstatSync(join(directory, 'objects')).isSymbolicLink()) captureError('backup_source');
        const before = current();
        if (!Number.isSafeInteger(before) || before < 1) captureError('backup_source');
        const entries = readdirSync(join(directory, 'objects')).sort();
        const ids = entries.filter(name => /^[a-f0-9]{64}$/.test(name));
        if (ids.length > limits.objects || entries.length !== ids.length * 2 || entries.some(name => !/^[a-f0-9]{64}(\.type)?$/.test(name))) captureError('backup_source');
        let size = lstatSync(dataFile).size;
        if (size > limits.totalBytes) captureError('backup_limit');
        for (const id of ids) {
          const path = join(directory, 'objects', id), type = `${path}.type`;
          if (!existsSync(type) || lstatSync(path).isSymbolicLink() || lstatSync(type).isSymbolicLink() || !lstatSync(path).isFile() || !lstatSync(type).isFile() || lstatSync(type).size > 200) captureError('backup_source');
          const bytes = lstatSync(path).size;
          if (bytes > limits.objectBytes || (size += bytes) > limits.totalBytes) captureError('backup_limit');
        }
        const data = readFileSync(dataFile), copied = ids.map(id => ({ storageId: id, key: null, contentType: readFileSync(join(directory, 'objects', `${id}.type`), 'utf8'), data: readFileSync(join(directory, 'objects', id)) }));
        if (current() !== before) captureError('backup_source');
        // Opaque orphan keys on disk cannot be reversed from SHA256. Preserve the
        // storage IDs themselves, so even unreferenced private objects are copied.
        return { backend: 'disk', snapshot: { version: before, data }, objects: copied };
      },
    },
  };
}

/** Postgres (Supabase ou qualquer outro): hospedagem serverless, como a Vercel. */
export function postgresStores(url: string, schema = 'proex'): BackendStores {
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
    backup: {
      async authoritySnapshot(limits) {
        const [row] = await sql<{ version: string; bytes: number; data: Uint8Array | null }[]>`select version,octet_length(data) AS bytes,CASE WHEN octet_length(data)<=${limits.totalBytes} THEN data ELSE NULL END AS data from ${snapshot} where id=1`;
        if (!row) captureError('backup_source');
        if (row.bytes > limits.totalBytes) captureError('backup_limit');
        const version = Number(row.version);
        if (!row.data || !Number.isSafeInteger(version) || version < 1) captureError('backup_source');
        return { version, data: new Uint8Array(row.data) };
      },
      async capture(limits) {
        return await sql.begin('isolation level repeatable read read only', async tx => {
          await tx`set local statement_timeout = '15000'`;
          const [meta] = await tx<{ count: string; bytes: string; largest: number }[]>`select count(*)::text AS count,coalesce(sum(octet_length(data)),0)::text AS bytes,coalesce(max(octet_length(data)),0) AS largest from ${objects}`;
          const [snapshotMeta] = await tx<{ bytes: number }[]>`select octet_length(data) AS bytes from ${snapshot} where id=1`;
          if (!snapshotMeta) captureError('backup_source');
          if (Number(meta.count) > limits.objects || meta.largest > limits.objectBytes || Number(meta.bytes) + snapshotMeta.bytes > limits.totalBytes) captureError('backup_limit');
          const [row] = await tx<{ version: string; data: Uint8Array }[]>`select version,data from ${snapshot} where id=1`;
          const copied = await tx<{ key: string; content_type: string; size: number; data: Uint8Array }[]>`select key,content_type,size,data from ${objects} order by key COLLATE "C"`;
          const version = Number(row.version);
          if (!Number.isSafeInteger(version) || version < 1 || copied.length !== Number(meta.count) || copied.some(object => Number(object.size) !== object.data.byteLength)) captureError('backup_source');
          return { backend: 'postgres' as const, snapshot: { version, data: new Uint8Array(row.data) }, objects: copied.map(object => ({ storageId: createHash('sha256').update(object.key).digest('hex'), key: object.key, contentType: object.content_type, data: new Uint8Array(object.data) })) };
        }) as BackupCapture;
      },
    },
  };
}
