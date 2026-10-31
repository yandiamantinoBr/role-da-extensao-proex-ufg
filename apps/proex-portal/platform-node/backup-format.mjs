// Complete application backups. Plaintext is held in memory only; no environment
// secrets or provider credentials are part of the format. The restore CLI is the
// only component allowed to materialize decrypted data, in a new isolated folder.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';

export const BACKUP_LIMITS = Object.freeze({ totalBytes: 64 * 1024 * 1024, sqliteBytes: 64 * 1024 * 1024, objectBytes: 16 * 1024 * 1024, objects: 10000, manifestBytes: 4 * 1024 * 1024 });
export const MAX_ENCRYPTED_BYTES = BACKUP_LIMITS.totalBytes + BACKUP_LIMITS.manifestBytes + 4096;
const MAGIC = Buffer.from('PROEXBK1'), KDF = Object.freeze({ N: 131072, r: 8, p: 1 }), derive = promisify(scrypt);
const messages = {
  backup_password: 'Use uma frase de proteção com 16 a 256 caracteres.',
  backup_limit: 'O backup excede o limite desta ferramenta. Nenhum arquivo parcial foi confirmado.',
  backup_invalid: 'O arquivo não é um backup completo PROEX válido.',
  backup_authentication: 'Frase de proteção incorreta ou arquivo adulterado.',
  backup_sqlite: 'O banco do backup não passou nas verificações de integridade e vínculos.',
  backup_objects: 'O inventário de arquivos está incompleto ou diverge do banco.',
  backup_forbidden: 'Somente a administração geral ativa pode gerar o backup completo.',
  backup_runtime: 'O backup completo requer Node.js 24.16 ou posterior com SQLite em memória.',
  backup_source: 'Não foi possível obter uma cópia consistente da origem.',
};
export class BackupError extends Error { constructor(code) { super(messages[code] ?? messages.backup_invalid); this.name = 'BackupError'; this.code = code; } }
const fail = code => { throw new BackupError(code); };
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const migrationHash = sql => sha256(sql.replace(/\r\n/g, '\n'));
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
function exactKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === keys.slice().sort().join('|'); }
export function validatePassword(password) {
  if (typeof password !== 'string' || [...password].length < 16 || [...password].length > 256 || Buffer.byteLength(password, 'utf8') > 1024 || /[\r\n\0]/.test(password)) fail('backup_password');
}

export function assertOwnerInSqlite(db, userId) {
  // Legacy snapshots predate organizations. Once the column exists, an owner
  // of a single organization must never export the entire platform database.
  const platformScope = db.prepare('PRAGMA table_info(members)').all().some(column => column.name === 'organization_id') ? ' AND m.organization_id IS NULL' : '';
  const owner = db.prepare(`SELECT 1 FROM members m LEFT JOIN portal_users u ON u.user_id=m.user_id
    WHERE m.user_id=? AND m.role='owner' AND m.project_id IS NULL AND m.revoked_at IS NULL
    AND COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0 AND u.anonymized_at IS NULL${platformScope} LIMIT 1`).get(userId);
  if (!owner) fail('backup_forbidden');
}

function sqlite(snapshot) {
  let raw, db;
  try {
    if (!(snapshot instanceof Uint8Array) || snapshot.byteLength > BACKUP_LIMITS.totalBytes) fail('backup_limit');
    raw = gunzipSync(snapshot, { maxOutputLength: BACKUP_LIMITS.sqliteBytes });
    if (!raw.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) fail('backup_sqlite');
    db = new DatabaseSync(':memory:', { allowExtension: false });
    if (typeof db.deserialize !== 'function') fail('backup_runtime');
    db.deserialize(raw);
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA foreign_keys=ON;');
    const integrity = Object.values(db.prepare('PRAGMA integrity_check(1)').get() ?? {})[0];
    if (integrity !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) fail('backup_sqlite');
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    for (const name of ['d1_migrations', 'members', 'portal_users', 'profiles', 'documents', 'record_attachments']) if (!tables.includes(name)) fail('backup_sqlite');
    return { db, raw, tables };
  } catch (error) { db?.close(); raw?.fill(0); if (error instanceof BackupError) throw error; fail('backup_sqlite'); }
}
export function assertOwnerInSnapshot(snapshot, userId) {
  const opened = sqlite(snapshot);
  try { assertOwnerInSqlite(opened.db, userId); }
  finally { opened.db.close(); opened.raw.fill(0); }
}

function objectMetadata(object) {
  if (!object || !hex(object.storageId) || (object.key !== null && (typeof object.key !== 'string' || !object.key || object.key.length > 1024 || sha256(object.key) !== object.storageId)) || typeof object.contentType !== 'string' || !/^[\x20-\x7e]{1,200}$/.test(object.contentType) || !(object.data instanceof Uint8Array) || !integer(object.data.byteLength, BACKUP_LIMITS.objectBytes)) fail('backup_objects');
  return { storageId: object.storageId, key: object.key, contentType: object.contentType, size: object.data.byteLength, sha256: sha256(object.data) };
}

function inspectDatabase(snapshot, objects, migrations = [], ownerId) {
  const opened = sqlite(snapshot);
  try {
    if (ownerId !== undefined) assertOwnerInSqlite(opened.db, ownerId);
    const byId = new Map(objects.map(object => [object.storageId, object]));
    if (byId.size !== objects.length) fail('backup_objects');
    const refs = opened.db.prepare(`SELECT object_key AS key,mime,size,content_hash AS contentHash FROM documents
      UNION ALL SELECT object_key,mime,size,NULL FROM record_attachments WHERE deleted_at IS NULL
      UNION ALL SELECT avatar_key,mime,NULL,NULL FROM profiles WHERE avatar_key IS NOT NULL`).all();
    for (const ref of refs) {
      if (typeof ref.key !== 'string') fail('backup_objects');
      const object = byId.get(sha256(ref.key));
      if (!object || (object.key !== null && object.key !== ref.key) || (ref.mime && object.contentType !== ref.mime) || (ref.size !== null && object.data.byteLength !== ref.size) || (ref.contentHash && sha256(object.data) !== ref.contentHash)) fail('backup_objects');
    }
    const applied = opened.db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(row => row.name);
    if (applied.some(name => typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,200}\.sql$/.test(name)) || new Set(applied).size !== applied.length) fail('backup_sqlite');
    const known = new Map(migrations.map(migration => [migration.name, migrationHash(migration.sql)]));
    const migrationManifest = applied.map(name => ({ name, sha256: known.get(name) ?? null }));
    const tables = opened.tables.map(name => {
      if (typeof name !== 'string' || name.length > 200) fail('backup_sqlite');
      return { name, rows: opened.db.prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n };
    });
    return { rawSize: opened.raw.byteLength, rawSha256: sha256(opened.raw), migrations: migrationManifest, tables, references: refs.length };
  } catch (error) { if (error instanceof BackupError) throw error; fail('backup_sqlite'); }
  finally { opened.db.close(); opened.raw.fill(0); }
}

/** @param {object} capture @param {{migrations?: {name:string,sql:string}[], codeRevision?:string|null, ownerId?:string, now?:string}} options */
export function createArchive(capture, { migrations = [], codeRevision = null, ownerId, now = new Date().toISOString() } = {}) {
  if (!capture?.snapshot || !integer(capture.snapshot.version) || capture.snapshot.version < 1 || !Array.isArray(capture.objects) || capture.objects.length > BACKUP_LIMITS.objects || !['postgres', 'disk'].includes(capture.backend)) fail('backup_source');
  const objects = capture.objects.slice().sort((a, b) => String(a.storageId).localeCompare(String(b.storageId)));
  const metadata = objects.map(objectMetadata);
  const totalBytes = capture.snapshot.data.byteLength + metadata.reduce((total, object) => total + object.size, 0);
  if (totalBytes > BACKUP_LIMITS.totalBytes) fail('backup_limit');
  const inspected = inspectDatabase(capture.snapshot.data, objects, migrations, ownerId);
  const manifest = { format: 'proex-complete-backup', formatVersion: 1, createdAt: now,
    source: { engine: 'sqlite', backend: capture.backend, consistency: capture.backend === 'postgres' ? 'repeatable-read' : 'single-process', snapshotVersion: capture.snapshot.version, codeRevision: typeof codeRevision === 'string' && /^[a-f0-9]{40}$/i.test(codeRevision) ? codeRevision : null },
    sqlite: { compression: 'gzip', size: capture.snapshot.data.byteLength, sha256: sha256(capture.snapshot.data), uncompressedSize: inspected.rawSize, uncompressedSha256: inspected.rawSha256, migrationHashMode: 'utf8-lf', migrations: inspected.migrations, tables: inspected.tables, references: inspected.references },
    objects: metadata, totalObjects: metadata.length, totalObjectBytes: metadata.reduce((total, object) => total + object.size, 0) };
  const encoded = Buffer.from(JSON.stringify(manifest));
  if (encoded.byteLength > BACKUP_LIMITS.manifestBytes) fail('backup_limit');
  const length = Buffer.alloc(4); length.writeUInt32BE(encoded.byteLength);
  return { manifest, bytes: Buffer.concat([length, encoded, capture.snapshot.data, ...objects.map(object => object.data)]) };
}

async function keyFor(password, salt) {
  validatePassword(password);
  const input = Buffer.from(password, 'utf8');
  try { return await derive(input, salt, 32, { ...KDF, maxmem: 192 * 1024 * 1024 }); }
  finally { input.fill(0); }
}
export async function encryptArchive(bytes, password) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ENCRYPTED_BYTES - 4096) fail('backup_limit');
  const salt = randomBytes(16), iv = randomBytes(12);
  const header = Buffer.from(JSON.stringify({ formatVersion: 1, cipher: 'AES-256-GCM', kdf: 'scrypt', ...KDF, salt: salt.toString('base64'), iv: iv.toString('base64'), tagBytes: 16 }));
  const length = Buffer.alloc(4); length.writeUInt32BE(header.byteLength);
  const aad = Buffer.concat([MAGIC, length, header]), key = await keyFor(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 }); cipher.setAAD(aad);
    return Buffer.concat([aad, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  } finally { key.fill(0); }
}
export async function decryptArchive(encrypted, password) {
  validatePassword(password);
  if (!(encrypted instanceof Uint8Array) || encrypted.byteLength > MAX_ENCRYPTED_BYTES || encrypted.byteLength < 64) fail('backup_invalid');
  const bytes = Buffer.from(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
  if (!bytes.subarray(0, 8).equals(MAGIC)) fail('backup_invalid');
  const length = bytes.readUInt32BE(8);
  if (length > 1024 || length < 2 || bytes.length < 12 + length + 16) fail('backup_invalid');
  let header;
  try { header = JSON.parse(bytes.subarray(12, 12 + length).toString('utf8')); } catch { fail('backup_invalid'); }
  if (!exactKeys(header, ['formatVersion', 'cipher', 'kdf', 'N', 'r', 'p', 'salt', 'iv', 'tagBytes']) || header.formatVersion !== 1 || header.cipher !== 'AES-256-GCM' || header.kdf !== 'scrypt' || header.N !== KDF.N || header.r !== KDF.r || header.p !== KDF.p || header.tagBytes !== 16 || typeof header.salt !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(header.salt) || typeof header.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(header.iv)) fail('backup_invalid');
  const key = await keyFor(password, Buffer.from(header.salt, 'base64')); let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'), { authTagLength: 16 });
    decipher.setAAD(bytes.subarray(0, 12 + length)); decipher.setAuthTag(bytes.subarray(-16));
    plaintext = decipher.update(bytes.subarray(12 + length, -16));
    return Buffer.concat([plaintext, decipher.final()]);
  } catch { fail('backup_authentication'); }
  finally { key.fill(0); plaintext?.fill(0); }
}

/** @param {Uint8Array} bytes @param {{migrations?: {name:string,sql:string}[]}} options */
export function validateArchive(bytes, { migrations = [] } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 5 || bytes.byteLength > MAX_ENCRYPTED_BYTES) fail('backup_invalid');
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), length = source.readUInt32BE(0);
  if (length > BACKUP_LIMITS.manifestBytes || length < 2 || length + 4 > source.length) fail('backup_invalid');
  let manifest;
  try { manifest = JSON.parse(source.subarray(4, 4 + length).toString('utf8')); } catch { fail('backup_invalid'); }
  if (!exactKeys(manifest, ['format', 'formatVersion', 'createdAt', 'source', 'sqlite', 'objects', 'totalObjects', 'totalObjectBytes']) || manifest.format !== 'proex-complete-backup' || manifest.formatVersion !== 1 || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || !exactKeys(manifest.source, ['engine', 'backend', 'consistency', 'snapshotVersion', 'codeRevision']) || manifest.source.engine !== 'sqlite' || !['postgres', 'disk'].includes(manifest.source.backend) || manifest.source.consistency !== (manifest.source.backend === 'postgres' ? 'repeatable-read' : 'single-process') || !integer(manifest.source.snapshotVersion) || manifest.source.snapshotVersion < 1 || (manifest.source.codeRevision !== null && !/^[a-f0-9]{40}$/i.test(manifest.source.codeRevision))) fail('backup_invalid');
  const sql = manifest.sqlite;
  if (!exactKeys(sql, ['compression', 'size', 'sha256', 'uncompressedSize', 'uncompressedSha256', 'migrationHashMode', 'migrations', 'tables', 'references']) || sql.compression !== 'gzip' || sql.migrationHashMode !== 'utf8-lf' || !integer(sql.size, BACKUP_LIMITS.totalBytes) || !hex(sql.sha256) || !integer(sql.uncompressedSize, BACKUP_LIMITS.sqliteBytes) || !hex(sql.uncompressedSha256) || !integer(sql.references) || !Array.isArray(sql.migrations) || !Array.isArray(sql.tables) || !Array.isArray(manifest.objects) || !integer(manifest.totalObjects, BACKUP_LIMITS.objects) || manifest.totalObjects !== manifest.objects.length || !integer(manifest.totalObjectBytes, BACKUP_LIMITS.totalBytes)) fail('backup_invalid');
  let offset = 4 + length;
  if (offset + sql.size > source.length) fail('backup_invalid');
  const snapshot = source.subarray(offset, offset += sql.size);
  if (sha256(snapshot) !== sql.sha256) fail('backup_invalid');
  const objects = manifest.objects.map(meta => {
    if (!exactKeys(meta, ['storageId', 'key', 'contentType', 'size', 'sha256']) || !integer(meta.size, BACKUP_LIMITS.objectBytes) || !hex(meta.sha256) || offset + meta.size > source.length) fail('backup_invalid');
    const data = source.subarray(offset, offset += meta.size), object = { storageId: meta.storageId, key: meta.key, contentType: meta.contentType, data };
    const checked = objectMetadata(object);
    if (checked.sha256 !== meta.sha256) fail('backup_objects');
    return object;
  });
  if (offset !== source.length || sql.size + manifest.totalObjectBytes > BACKUP_LIMITS.totalBytes || objects.reduce((total, object) => total + object.data.byteLength, 0) !== manifest.totalObjectBytes) fail('backup_invalid');
  const inspected = inspectDatabase(snapshot, objects, migrations);
  if (inspected.rawSize !== sql.uncompressedSize || inspected.rawSha256 !== sql.uncompressedSha256 || inspected.references !== sql.references || JSON.stringify(inspected.tables) !== JSON.stringify(sql.tables) || JSON.stringify(inspected.migrations.map(item => item.name)) !== JSON.stringify(sql.migrations.map(item => item.name))) fail('backup_invalid');
  for (const migration of sql.migrations) {
    if (!exactKeys(migration, ['name', 'sha256']) || (migration.sha256 !== null && !hex(migration.sha256))) fail('backup_invalid');
    const local = migrations.find(item => item.name === migration.name);
    if (local && migration.sha256 !== null && migrationHash(local.sql) !== migration.sha256) fail('backup_invalid');
  }
  return { manifest, snapshot, objects };
}
