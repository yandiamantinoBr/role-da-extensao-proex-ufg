import { type PortalActor } from '../access';
import { HttpError } from '../errors';
import { requireSyncOwner, SYNC_OWNER_SQL } from './contracts';

type Kind = 'record' | 'loan' | 'avatar';
type Row = Record<string, unknown>;
type Source = { kind: Kind; id: string; object_key: string; mime: string; size: number | null; source_user_id: string; created_at: string };
type Receipt = { kind: Kind; contentHash: string; size: number; sourceUserId: string };
const KINDS = ['record', 'loan', 'avatar'];
const SAFE_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_ACTION = 'sync.attachment.download';
function stmt(db: D1Database, sql: string, values: (string | number | null)[] = []) { return db.prepare(sql).bind(...values); }
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new HttpError(400, `Informe ${label} válido.`, 'invalid_attachment_identifier');
  return value;
}
function kindValue(value: unknown): Kind {
  if (typeof value !== 'string' || !KINDS.includes(value)) throw new HttpError(400, 'Escolha foto, termo ou avatar válido.', 'invalid_attachment_kind');
  return value as Kind;
}
async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
}
function authorization(db: D1Database, ownerId: string) {
  return stmt(db, `SELECT CASE WHEN ${SYNC_OWNER_SQL} THEN 1 ELSE json_extract('sync_forbidden','$') END`, [ownerId]);
}
function sourceSQL(): string {
  return `SELECT 'record' AS kind,a.id,a.object_key,a.mime,a.size,a.created_by AS source_user_id,a.created_at FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id WHERE a.deleted_at IS NULL
    UNION ALL SELECT 'loan',d.id,d.object_key,d.mime,d.size,d.created_by,d.created_at FROM documents d JOIN loans l ON l.id=d.loan_id AND l.project_id=d.project_id
    UNION ALL SELECT 'avatar',p.user_id,p.avatar_key,p.mime,NULL,p.user_id,p.updated_at FROM profiles p WHERE p.avatar_key IS NOT NULL AND p.mime='image/png'`;
}
async function sourceById(db: D1Database, kind: Kind, id: string): Promise<Source> {
  const row = await stmt(db, `SELECT s.* FROM (${sourceSQL()}) s WHERE s.kind=? AND s.id=?
    AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=s.source_user_id AND u.anonymized_at IS NOT NULL)`, [kind, id]).first<Source>();
  if (!row || !SAFE_MIMES.includes(row.mime)) throw new HttpError(404, 'Anexo disponível não encontrado.', 'attachment_not_found');
  return row;
}
function projection(row: Row) {
  return { kind: row.kind, id: row.id, mime: row.mime, size: row.size, createdAt: row.created_at,
    driveExport: row.export_id ? { id: row.export_id, fileId: row.drive_file_id, url: row.drive_url, contentHash: row.content_hash, size: row.export_size, exportedAt: row.exported_at, deletedAt: row.deleted_at } : null };
}
/** Owner-only inventory. Names, contact fields, private storage keys and download tokens are excluded. */
export async function listSyncAttachments(db: D1Database, actor: PortalActor | null, input: { after?: unknown; limit?: unknown; cleanupAfter?: unknown } = {}) {
  await requireSyncOwner(db, actor);
  const limit = input.limit === undefined ? 50 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'Use um limite entre 1 e 100 anexos.', 'invalid_limit');
  let after = '';
  if (input.after !== undefined && input.after !== null && input.after !== '') {
    if (typeof input.after !== 'string' || !/^(record|loan|avatar)\|[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.after)) throw new HttpError(400, 'Posição de anexos inválida.', 'invalid_cursor');
    after = input.after;
  }
  const rows = (await stmt(db, `SELECT s.kind,s.id,s.mime,s.size,s.created_at,e.id AS export_id,e.drive_file_id,e.drive_url,e.content_hash,e.size AS export_size,e.exported_at,e.deleted_at
    FROM (${sourceSQL()}) s LEFT JOIN sync_attachment_exports e ON e.attachment_kind=s.kind AND e.attachment_id=s.id
    WHERE s.mime IN ('application/pdf','image/png','image/jpeg','image/webp') AND s.kind||'|'||s.id>?
    AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=s.source_user_id AND u.anonymized_at IS NOT NULL)
    ORDER BY s.kind,s.id LIMIT ?`, [after, limit + 1]).all<Row>()).results ?? [];
  const cleanupAfter = input.cleanupAfter === undefined || input.cleanupAfter === '' ? '' : identifier(input.cleanupAfter, 'uma posição de cópia');
  const cleanupRows = (await stmt(db, `WITH owned_exports AS (SELECT e.*,
    COALESCE(CASE e.attachment_kind WHEN 'avatar' THEN e.attachment_id WHEN 'record' THEN (SELECT a.created_by FROM record_attachments a WHERE a.id=e.attachment_id) WHEN 'loan' THEN (SELECT d.created_by FROM documents d WHERE d.id=e.attachment_id) END,
      (SELECT json_extract(a.details,'$.sourceUserId') FROM audit a WHERE a.action='sync.attachment.download' AND a.entity_id=e.attachment_id AND json_extract(a.details,'$.kind')=e.attachment_kind AND json_extract(a.details,'$.contentHash')=e.content_hash ORDER BY a.created_at DESC LIMIT 1)) AS source_user_id
    FROM sync_attachment_exports e WHERE e.deleted_at IS NULL AND e.id>?)
    SELECT id,attachment_kind,attachment_id,drive_file_id,drive_url,content_hash,size,exported_at FROM owned_exports e
    WHERE EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=e.source_user_id AND u.anonymized_at IS NOT NULL)
      OR EXISTS(SELECT 1 FROM privacy_requests p WHERE p.user_id=e.source_user_id AND p.status='cleanup_pending')
    ORDER BY id LIMIT ?`, [cleanupAfter, limit + 1]).all<Row>()).results ?? [];
  await requireSyncOwner(db, actor);
  return { attachments: rows.slice(0, limit).map(projection), nextCursor: rows.length > limit ? `${rows[limit - 1].kind}|${rows[limit - 1].id}` : null,
    cleanupPendingExports: cleanupRows.slice(0, limit).map(row => ({ exportId: row.id, kind: row.attachment_kind, attachmentId: row.attachment_id, fileId: row.drive_file_id, url: row.drive_url, contentHash: row.content_hash, size: row.size, exportedAt: row.exported_at })),
    nextCleanupCursor: cleanupRows.length > limit ? cleanupRows[limit - 1].id : null };

}
export async function createAttachmentTicket(db: D1Database, actor: PortalActor | null, input: { kind: unknown; id: unknown; origin: unknown }) {
  await requireSyncOwner(db, actor);
  const kind = kindValue(input.kind), id = identifier(input.id, 'um anexo');
  await sourceById(db, kind, id);
  let origin: URL;
  try { origin = new URL(typeof input.origin === 'string' ? input.origin : ''); } catch { throw new HttpError(400, 'Origem do portal inválida.', 'invalid_origin'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new HttpError(400, 'Use somente a origem do portal.', 'invalid_origin');
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  const hash = await digest(new TextEncoder().encode(token)), now = new Date().toISOString(), expiresAt = new Date(Date.now() + 60_000).toISOString();
  await db.batch([authorization(db, actor!.userId), stmt(db, 'INSERT INTO sync_attachment_tickets(token_hash,owner_id,attachment_kind,attachment_id,expires_at,created_at) VALUES(?,?,?,?,?,?)', [hash, actor!.userId, kind, id, expiresAt, now])]);
  return { kind, id, url: `${origin.origin}/api/sync/files/${token}`, expiresAt };
}
async function bodyBytes(object: R2ObjectBody, expectedSize: number | null): Promise<Uint8Array> {
  if (object.size < 1 || object.size > MAX_BYTES || (expectedSize !== null && object.size !== expectedSize)) throw new HttpError(409, 'O arquivo mudou ou excede o limite de cópia.', 'attachment_changed');
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      count += value.byteLength; if (count > MAX_BYTES || count > object.size) { await reader.cancel(); throw new HttpError(413, 'Anexo maior que o limite de cópia.', 'attachment_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (count !== object.size) throw new HttpError(409, 'Não foi possível ler o anexo completo.', 'attachment_changed');
  const result = new Uint8Array(count); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
/** A bearer ticket claims one download and revalidates the issuing owner and the source after R2 reads. */
export async function consumeAttachmentTicket(db: D1Database, storage: R2Bucket, token: unknown) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(404, 'Link de cópia inválido.', 'ticket_not_found');
  const tokenHash = await digest(new TextEncoder().encode(token));
  const ticket = await stmt(db, 'SELECT owner_id,attachment_kind,attachment_id,expires_at,used_at FROM sync_attachment_tickets WHERE token_hash=?', [tokenHash]).first<{ owner_id: string; attachment_kind: Kind; attachment_id: string; expires_at: string; used_at: string | null }>();
  if (!ticket || ticket.used_at || Date.parse(ticket.expires_at) <= Date.now()) throw new HttpError(410, 'Este link de cópia expirou ou já foi usado.', 'ticket_expired');
  const owner = { userId: ticket.owner_id, email: '', displayName: '', members: [], capabilities: [] };
  await requireSyncOwner(db, owner);
  const source = await sourceById(db, ticket.attachment_kind, ticket.attachment_id);
  const now = new Date().toISOString();
  const claimed = await stmt(db, `UPDATE sync_attachment_tickets SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?
    AND ${SYNC_OWNER_SQL} AND NOT EXISTS(SELECT 1 FROM portal_users WHERE user_id=? AND anonymized_at IS NOT NULL) RETURNING token_hash`, [now, tokenHash, now, owner.userId, source.source_user_id]).all();
  if (!claimed.results?.length) throw new HttpError(410, 'Este link de cópia expirou ou já foi usado.', 'ticket_expired');
  const object = await storage.get(source.object_key);
  if (!object) throw new HttpError(404, 'O arquivo não está mais disponível.', 'attachment_not_found');
  const bytes = await bodyBytes(object, source.size), contentHash = await digest(bytes);
  await requireSyncOwner(db, owner);
  const current = await sourceById(db, source.kind, source.id);
  if (current.object_key !== source.object_key || current.mime !== source.mime) throw new HttpError(409, 'O arquivo mudou durante a cópia. Gere um novo link.', 'attachment_changed');
  const receipt: Receipt = { kind: source.kind, contentHash, size: bytes.byteLength, sourceUserId: source.source_user_id };
  await db.batch([
    authorization(db, owner.userId),
    stmt(db, `INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at)
      SELECT ?,?,NULL,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM portal_users WHERE user_id=? AND anonymized_at IS NOT NULL)`, [crypto.randomUUID(), owner.userId, DOWNLOAD_ACTION, source.id, JSON.stringify(receipt), new Date().toISOString(), source.source_user_id]),
  ]).then(result => { if (result[1].meta.changes !== 1) throw new HttpError(403, 'Este anexo entrou em processo de exclusão.', 'attachment_private'); });
  return { bytes, mime: source.mime, size: bytes.byteLength, contentHash, kind: source.kind, id: source.id };
}
function driveLocation(input: Record<string, unknown>): { fileId: string; url: string } {
  if (input.privateConfirmed !== true || input.readbackVerified !== true) throw new HttpError(400, 'Confirme a verificação da cópia e das permissões privadas no Drive.', 'private_copy_required');
  const fileId = input.driveFileId;
  if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new HttpError(400, 'Identificador de arquivo do Drive inválido.', 'invalid_drive_file');
  let url: URL;
  try { url = new URL(typeof input.driveUrl === 'string' ? input.driveUrl : ''); } catch { throw new HttpError(400, 'Endereço de arquivo do Drive inválido.', 'invalid_drive_url'); }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.port || url.username || url.password || url.hash || url.pathname !== `/file/d/${fileId}/view` || [...url.searchParams.keys()].some(key => key !== 'usp')) throw new HttpError(400, 'Use o endereço privado do arquivo correspondente no Drive.', 'invalid_drive_url');
  return { fileId, url: `https://drive.google.com/file/d/${fileId}/view` };
}
async function receiptByHash(db: D1Database, actor: PortalActor, kind: Kind, id: string, contentHash: string, size: number): Promise<Receipt> {
  const row = await stmt(db, `SELECT details FROM audit WHERE actor_id=? AND action=? AND entity_id=?
    AND json_extract(details,'$.kind')=? AND json_extract(details,'$.contentHash')=? AND json_extract(details,'$.size')=? ORDER BY created_at DESC LIMIT 1`, [actor.userId, DOWNLOAD_ACTION, id, kind, contentHash, size]).first<{ details: string }>();
  if (!row) throw new HttpError(409, 'A cópia não corresponde a um download verificado deste responsável.', 'attachment_receipt_required');
  return JSON.parse(row.details) as Receipt;
}
/** Called only by the owner MCP integration after native Drive readback and private permission inspection. */
export async function acknowledgeAttachmentExport(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>) {
  await requireSyncOwner(db, actor);
  const kind = kindValue(input.kind), id = identifier(input.id, 'um anexo'), location = driveLocation(input);
  const contentHash = input.contentHash, size = input.size;
  if (typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(contentHash) || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) throw new HttpError(400, 'Informe hash e tamanho da cópia verificada.', 'invalid_attachment_hash');
  const receipt = await receiptByHash(db, actor!, kind, id, contentHash, size);
  const previous = await stmt(db, 'SELECT id,drive_file_id,content_hash,size,deleted_at FROM sync_attachment_exports WHERE attachment_kind=? AND attachment_id=?', [kind, id]).first<{ id: string; drive_file_id: string; content_hash: string; size: number; deleted_at: string | null }>();
  if (previous && previous.deleted_at === null && previous.drive_file_id !== location.fileId) throw new HttpError(409, 'Já existe uma cópia ativa. Confirme a exclusão anterior antes de substituí-la.', 'attachment_export_exists');
  const exportId = previous?.id ?? crypto.randomUUID(), now = new Date().toISOString();
  try {
    await db.batch([
      authorization(db, actor!.userId),
      stmt(db, `INSERT INTO sync_attachment_exports(id,attachment_kind,attachment_id,drive_file_id,drive_url,content_hash,size,exported_at,deleted_at)
        VALUES(?,?,?,?,?,?,?,?,NULL) ON CONFLICT(attachment_kind,attachment_id) DO UPDATE SET drive_file_id=excluded.drive_file_id,drive_url=excluded.drive_url,content_hash=excluded.content_hash,size=excluded.size,exported_at=excluded.exported_at,deleted_at=NULL
        WHERE sync_attachment_exports.deleted_at IS NOT NULL OR (sync_attachment_exports.drive_file_id=excluded.drive_file_id AND (sync_attachment_exports.content_hash!=excluded.content_hash OR sync_attachment_exports.size!=excluded.size))`, [exportId, kind, id, location.fileId, location.url, contentHash, size, now]),
      stmt(db, "INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) SELECT ?,?,'sync.attachment.export',?,?,? WHERE changes()=1", [crypto.randomUUID(), actor!.userId, id, JSON.stringify({ kind, exportId, contentHash, size }), now]),
      stmt(db, `UPDATE privacy_requests SET status='cleanup_pending',completed_at=NULL WHERE user_id=? AND status='completed'
        AND EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=? AND u.anonymized_at IS NOT NULL)`, [receipt.sourceUserId, receipt.sourceUserId]),
    ]);
  } catch (error) { await requireSyncOwner(db, actor); throw error; }
  const saved = await stmt(db, 'SELECT id,drive_file_id,drive_url,content_hash,size,exported_at,deleted_at FROM sync_attachment_exports WHERE attachment_kind=? AND attachment_id=?', [kind, id]).first<Row>();
  if (!saved || saved.drive_file_id !== location.fileId || saved.content_hash !== contentHash || saved.size !== size || saved.deleted_at !== null) throw new HttpError(409, 'A cópia registrada mudou. Confira o histórico.', 'attachment_export_exists');
  return { export: saved, duplicate: previous?.deleted_at === null && previous.content_hash === contentHash && previous.size === size };
}
/** A cleanup acknowledgement records the actual owner/operator; it never itself deletes Drive files. */
export async function acknowledgeAttachmentCleanup(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>) {
  await requireSyncOwner(db, actor);
  const id = identifier(input.exportId, 'uma cópia');
  if (input.confirmedDeleted !== true || typeof input.reason !== 'string' || input.reason.trim().length < 8 || input.reason.trim().length > 500 || /[\u0000-\u001f\u007f]/u.test(input.reason)) throw new HttpError(400, 'Confirme a exclusão no Drive e descreva a verificação realizada.', 'cleanup_confirmation_required');
  const previous = await stmt(db, 'SELECT id,deleted_at FROM sync_attachment_exports WHERE id=?', [id]).first<{ id: string; deleted_at: string | null }>();
  if (!previous) throw new HttpError(404, 'Cópia externa não encontrada.', 'export_not_found');
  if (previous.deleted_at) return { id, deletedAt: previous.deleted_at, duplicate: true };
  const now = new Date().toISOString();
  await db.batch([
    authorization(db, actor!.userId),
    stmt(db, 'UPDATE sync_attachment_exports SET deleted_at=? WHERE id=? AND deleted_at IS NULL', [now, id]),
    stmt(db, "INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) SELECT ?,?,'sync.attachment.cleanup',?,?,? WHERE changes()=1", [crypto.randomUUID(), actor!.userId, id, JSON.stringify({ reason: input.reason.trim() }), now]),
  ]);
  return { id, deletedAt: now };
}
