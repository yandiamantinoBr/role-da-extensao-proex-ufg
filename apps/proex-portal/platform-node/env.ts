// Substitui o módulo `cloudflare:workers` quando o portal é compilado para Node
// (Vercel, VPS ou servidor da UFG). Mantém a mesma forma de acesso usada em
// lib/platform.ts e db/index.ts: `env.DB`, `env.BUCKET` e variáveis de ambiente.
import { SnapshotD1, type Migration } from './d1';
import { fileStores, postgresStores, type ObjectStore } from './store';

const sources = import.meta.glob('../drizzle/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const migrations: Migration[] = Object.entries(sources)
  .map(([path, sql]) => ({ name: path.split('/').pop()!, sql }))
  .sort((a, b) => a.name.localeCompare(b.name));

class ObjectBucket {
  constructor(private readonly store: ObjectStore) {}
  async put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }) {
    const data = typeof value === 'string' ? new TextEncoder().encode(value)
      : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    await this.store.put(key, data, options?.httpMetadata?.contentType ?? 'application/octet-stream');
    return { key, size: data.byteLength };
  }
  async get(key: string) {
    const found = await this.store.get(key);
    if (!found) return null;
    const { data, contentType } = found;
    return {
      key, size: data.byteLength, httpMetadata: { contentType },
      get body() { return new Response(data).body!; },
      arrayBuffer: async () => data.slice().buffer, text: async () => new TextDecoder().decode(data),
    };
  }
  async head(key: string) { const found = await this.get(key); return found && { key, size: found.size, httpMetadata: found.httpMetadata }; }
  async delete(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) await this.store.delete(key); }
}

let stores: ReturnType<typeof fileStores> | undefined, db: SnapshotD1 | undefined, bucket: ObjectBucket | undefined;
function backend() {
  if (stores) return stores;
  const url = process.env.PROEX_DATABASE_URL;
  stores = url && /^postgres(ql)?:\/\//.test(url) ? postgresStores(url) : fileStores(process.env.PROEX_DATA_DIR || '.data');
  return stores;
}

export const env = new Proxy({} as Record<string, unknown>, {
  get(_target, key: string) {
    if (key === 'DB') return db ??= new SnapshotD1(backend().snapshots, migrations);
    if (key === 'BUCKET') return bucket ??= new ObjectBucket(backend().objects);
    // Fora do Sites não existe identidade nativa: força o modo de hospedagem própria.
    if (key === 'PROEX_STANDALONE') return '1';
    return process.env[key];
  },
});
export default { env };
