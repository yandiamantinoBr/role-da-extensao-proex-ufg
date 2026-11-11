import { platformOwnerAuthoritySql, projectAuthoritySql, type PortalActor } from '../access';
import { all, one, uid, iso } from '../database';
import { HttpError } from '../errors';
import { prepareMutation } from '../mutations';
import { storageUsage } from '../platform';
import { messagePairSql } from './messages';
import { identifier, only, personText, requireActor, requireInternalMember } from './shared';
import type { MediaStore } from './media-store';

/*
 * Chat (phase 3, premises of 2026-11-09):
 * - one conversation per project, open to whoever can read the project;
 * - direct conversations between two people with the same reach as direct messages (recados), never across organizations;
 * - images are re-encoded in the browser (no EXIF/GPS), validated here by their real bytes, kept for 180 days;
 * - storage goes through MediaStore (lib/community/media-store.ts) so it can move to Supabase Storage later.
 * Polling never writes: reading marks nothing; the client marks a conversation as read explicitly.
 */
export const CHAT_BODY_MAX = 2000, CHAT_DAILY_MESSAGES = 300, CHAT_DAILY_IMAGES = 20;
export const CHAT_IMAGE_MAX_BYTES = 1572864, CHAT_ORG_ACTIVE_BYTES = 150 * 1024 * 1024, CHAT_RETENTION_DAYS = 180;
export const PLAN_DATABASE_BYTES = 500 * 1024 * 1024, PLAN_ALERT_RATIO = 0.7;
const PAGE = 100;

function conversationAccess(actor: PortalActor, conversationSql = '?') {
  // Own aliases (cva/cvo/cvp): the caller may pass an outer `cv.id` without being shadowed.
  const project = projectAuthoritySql(actor, [], 'cva.project_id');
  return {
    sql: `EXISTS(SELECT 1 FROM chat_conversations cva JOIN organizations cvo ON cvo.id=cva.organization_id AND cvo.status='active' WHERE cva.id=${conversationSql} AND (
      (cva.kind='project' AND EXISTS(SELECT 1 FROM projects cvp WHERE cvp.id=cva.project_id AND cvp.status='active') AND ${project.sql})
      OR (cva.kind='direct' AND (cva.user_a=? OR cva.user_b=?)
        AND EXISTS(SELECT 1 FROM (SELECT ? me) cme WHERE ${messagePairSql('cme.me', 'CASE WHEN cva.user_a=cme.me THEN cva.user_b ELSE cva.user_a END', 'cva.organization_id')})
        AND NOT EXISTS(SELECT 1 FROM community_blocks cb WHERE (cb.user_id=cva.user_a AND cb.blocked_id=cva.user_b) OR (cb.user_id=cva.user_b AND cb.blocked_id=cva.user_a)))))`,
    values: (conversationId: string) => [...(conversationSql === '?' ? [conversationId] : []), ...project.values, actor.userId, actor.userId, actor.userId],
  };
}
async function requireConversation(db: D1Database, actor: PortalActor, conversationId: string) {
  const access = conversationAccess(actor);
  const row = await one(db, `SELECT id,kind,organization_id,project_id FROM chat_conversations WHERE id=? AND ${access.sql}`, [conversationId, ...access.values(conversationId)]);
  if (!row) throw new HttpError(404, 'Conversa não encontrada ou sem acesso.', 'chat_not_found');
  return row;
}
function failure(error: unknown): never {
  const text = String(error);
  if (text.includes('chat_access_changed')) throw new HttpError(403, 'Seu acesso a esta conversa mudou. Atualize a página.', 'chat_access_changed');
  if (text.includes('chat_daily_limit')) throw new HttpError(429, 'Você enviou muitas mensagens nas últimas 24 horas. Tente mais tarde.', 'chat_daily_limit');
  if (text.includes('chat_image_limit')) throw new HttpError(429, `Limite de ${CHAT_DAILY_IMAGES} imagens em 24 horas atingido.`, 'chat_image_limit');
  if (text.includes('chat_org_space')) throw new HttpError(507, 'O espaço de imagens desta organização está cheio. Peça à administração para revisar.', 'chat_org_space');
  if (text.includes('chat_attachment_invalid')) throw new HttpError(409, 'A imagem não pertence a esta conversa ou já foi usada. Envie de novo.', 'chat_attachment_invalid');
  throw error;
}

/** Conversations the person can see, with unread counts. Project conversations exist virtually until opened. */
export async function chatOverview(db: D1Database, rawActor: PortalActor | null) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const read = projectAuthoritySql(actor, [], 'p.id');
  const unreadSql = (cvSql: string) => `(SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id=${cvSql} AND m.sender_id!=? AND m.deleted_at IS NULL
    AND m.created_at>COALESCE((SELECT last_read_at FROM chat_reads r WHERE r.conversation_id=${cvSql} AND r.user_id=?),''))`;
  const projects = await all(db, `SELECT p.id projectId,p.name,o.name organizationName,cv.id conversationId,cv.last_message_at lastMessageAt,
    CASE WHEN cv.id IS NULL THEN 0 ELSE ${unreadSql('cv.id')} END unread
    FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.status='active' LEFT JOIN chat_conversations cv ON cv.kind='project' AND cv.project_id=p.id
    WHERE p.status='active' AND ${read.sql} ORDER BY cv.last_message_at IS NULL, cv.last_message_at DESC, p.name LIMIT 200`, [actor.userId, actor.userId, ...read.values]);
  const access = conversationAccess(actor, 'cv.id');
  const directs = await all(db, `SELECT cv.id conversationId,cv.organization_id organizationId,o.name organizationName,cv.last_message_at lastMessageAt,
    CASE WHEN cv.user_a=? THEN cv.user_b ELSE cv.user_a END otherId,COALESCE(NULLIF(op.display_name,''),'Pessoa da equipe') otherName,${unreadSql('cv.id')} unread
    FROM chat_conversations cv JOIN organizations o ON o.id=cv.organization_id
    LEFT JOIN profiles op ON op.user_id=CASE WHEN cv.user_a=? THEN cv.user_b ELSE cv.user_a END
    WHERE cv.kind='direct' AND (cv.user_a=? OR cv.user_b=?) AND ${access.sql}
    ORDER BY cv.last_message_at IS NULL, cv.last_message_at DESC LIMIT 200`, [actor.userId, actor.userId, actor.userId, actor.userId, actor.userId, actor.userId, ...access.values('')]);
  return { projects, directs, limits: { bodyMax: CHAT_BODY_MAX, imageMaxBytes: CHAT_IMAGE_MAX_BYTES, retentionDays: CHAT_RETENTION_DAYS } };
}

/** Finds or creates the conversation after checking access. Project: read access. Direct: same reach as recados. */
export async function openConversation(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const now = iso();
  if (input.kind === 'project') {
    only(input, ['action', 'kind', 'projectId']);
    const projectId = identifier(input.projectId, 'o projeto');
    const read = projectAuthoritySql(actor, [], 'p.id');
    const project = await one(db, `SELECT p.id,p.organization_id FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.status='active' WHERE p.id=? AND p.status='active' AND ${read.sql}`, [projectId, ...read.values]);
    if (!project) throw new HttpError(404, 'Projeto não encontrado ou sem acesso.', 'chat_not_found');
    await db.prepare("INSERT INTO chat_conversations(id,kind,organization_id,project_id,created_at) VALUES(?,'project',?,?,?) ON CONFLICT DO NOTHING").bind(uid(), project.organization_id, projectId, now).run();
    return { conversationId: String((await one(db, "SELECT id FROM chat_conversations WHERE kind='project' AND project_id=?", [projectId]))!.id) };
  }
  if (input.kind === 'direct') {
    only(input, ['action', 'kind', 'organizationId', 'userId']);
    const organizationId = identifier(input.organizationId, 'a organização'), other = identifier(input.userId, 'a pessoa');
    if (other === actor.userId) throw new HttpError(400, 'Escolha outra pessoa.', 'invalid_recipient');
    const allowed = await one(db, `SELECT 1 ok FROM (SELECT ? me,? other,? org) x JOIN organizations o ON o.id=x.org AND o.status='active'
      WHERE ${messagePairSql('x.me', 'x.other', 'x.org')} AND NOT EXISTS(SELECT 1 FROM community_blocks b WHERE (b.user_id=x.me AND b.blocked_id=x.other) OR (b.user_id=x.other AND b.blocked_id=x.me))`, [actor.userId, other, organizationId]);
    if (!allowed) throw new HttpError(409, 'Não é possível conversar com esta pessoa nesta organização.', 'chat_pair_unavailable');
    const [a, b] = [actor.userId, other].sort();
    await db.prepare("INSERT INTO chat_conversations(id,kind,organization_id,user_a,user_b,created_at) VALUES(?,'direct',?,?,?,?) ON CONFLICT DO NOTHING").bind(uid(), organizationId, a, b, now).run();
    return { conversationId: String((await one(db, "SELECT id FROM chat_conversations WHERE kind='direct' AND organization_id=? AND user_a=? AND user_b=?", [organizationId, a, b]))!.id) };
  }
  throw new HttpError(400, 'Escolha um projeto ou uma pessoa.', 'invalid_conversation');
}

/** Messages of one conversation; `after` returns only newer ones (polling). Never writes. */
export async function chatMessages(db: D1Database, rawActor: PortalActor | null, conversationId: unknown, after: unknown) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const id = identifier(conversationId, 'a conversa');
  const conversation = await requireConversation(db, actor, id);
  const since = typeof after === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(after) ? after : null;
  const rows = await all(db, `SELECT * FROM (SELECT m.id,m.sender_id senderId,COALESCE(NULLIF(p.display_name,''),'Pessoa da equipe') senderName,
      CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END body,m.created_at createdAt,m.deleted_at IS NOT NULL deleted,
      CASE WHEN a.id IS NOT NULL AND a.deleted_at IS NULL AND a.expires_at>? AND m.deleted_at IS NULL THEN a.id END attachmentId,
      CASE WHEN a.id IS NOT NULL AND (a.deleted_at IS NOT NULL OR a.expires_at<=?) THEN 1 ELSE 0 END attachmentExpired
    FROM chat_messages m LEFT JOIN profiles p ON p.user_id=m.sender_id LEFT JOIN chat_attachments a ON a.id=m.attachment_id
    WHERE m.conversation_id=? ${since ? 'AND m.created_at>?' : ''} ORDER BY m.created_at DESC,m.id DESC LIMIT ?) ORDER BY createdAt,id`,
    [iso(), iso(), id, ...(since ? [since] : []), PAGE]);
  const lastRead = await one(db, 'SELECT last_read_at FROM chat_reads WHERE conversation_id=? AND user_id=?', [id, actor.userId]);
  return { conversation: { id, kind: conversation.kind, projectId: conversation.project_id ?? null }, messages: rows.map(row => ({ ...row, mine: row.senderId === actor.userId, deleted: !!row.deleted, attachmentExpired: !!row.attachmentExpired })), lastReadAt: lastRead?.last_read_at ?? null };
}

export async function chatAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>, store: MediaStore) {
  const actor = requireActor(rawActor);
  const member = await requireInternalMember(db, actor);
  const now = iso();
  if (input.action === 'open') return openConversation(db, actor, input);
  if (input.action === 'read') {
    only(input, ['action', 'conversationId']);
    const id = identifier(input.conversationId, 'a conversa');
    await requireConversation(db, actor, id);
    await db.prepare('INSERT INTO chat_reads(conversation_id,user_id,last_read_at) VALUES(?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_at=MAX(last_read_at,excluded.last_read_at)').bind(id, actor.userId, now).run();
    return { conversationId: id };
  }
  if (input.action === 'send') {
    only(input, ['action', 'conversationId', 'body', 'attachmentId', 'operationKey']);
    const id = identifier(input.conversationId, 'a conversa');
    const attachmentId = input.attachmentId == null || input.attachmentId === '' ? null : identifier(input.attachmentId, 'a imagem');
    const body = attachmentId && (input.body == null || input.body === '') ? '' : personText(input.body, attachmentId ? 0 : 1, CHAT_BODY_MAX, `Escreva até ${CHAT_BODY_MAX.toLocaleString('pt-BR')} caracteres.`);
    await requireConversation(db, actor, id);
    const mutation = await prepareMutation(db, actor.userId, 'community.chat.send', { conversationId: id, kind: 'chat', operationKey: input.operationKey });
    if (mutation.existingId) return { id: mutation.existingId, duplicate: true };
    const access = conversationAccess(actor), messageId = uid();
    try {
      await db.batch([
        db.prepare(`SELECT CASE WHEN ${member.sql} AND ${access.sql} THEN 1 ELSE json_extract('[]','chat_access_changed') END`).bind(...member.values, ...access.values(id)),
        db.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM chat_messages WHERE sender_id=? AND created_at>?)<? THEN 1 ELSE json_extract('[]','chat_daily_limit') END").bind(actor.userId, new Date(Date.now() - 86400000).toISOString(), CHAT_DAILY_MESSAGES),
        ...(attachmentId ? [db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM chat_attachments a WHERE a.id=? AND a.conversation_id=? AND a.uploader_id=? AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_messages m WHERE m.attachment_id=a.id)) THEN 1 ELSE json_extract('[]','chat_attachment_invalid') END").bind(attachmentId, id, actor.userId)] : []),
        db.prepare('INSERT INTO chat_messages(id,conversation_id,sender_id,body,attachment_id,created_at) VALUES(?,?,?,?,?,?)').bind(messageId, id, actor.userId, body, attachmentId, now),
        db.prepare('UPDATE chat_conversations SET last_message_at=? WHERE id=?').bind(now, id),
        db.prepare('INSERT INTO chat_reads(conversation_id,user_id,last_read_at) VALUES(?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_at=MAX(last_read_at,excluded.last_read_at)').bind(id, actor.userId, now),
        mutation.claimStatement(messageId),
      ]);
    } catch (error) {
      if (/chat_(access_changed|daily_limit|attachment_invalid)/.test(String(error))) failure(error);
      return { id: await mutation.recover(error), duplicate: true };
    }
    await purgeExpiredChatMedia(db, store, 5).catch(() => 0);
    return { id: messageId, duplicate: false, createdAt: now };
  }
  if (input.action === 'delete') {
    only(input, ['action', 'messageId']);
    const messageId = identifier(input.messageId, 'a mensagem');
    const row = await one(db, 'SELECT m.id,m.attachment_id,a.object_key FROM chat_messages m LEFT JOIN chat_attachments a ON a.id=m.attachment_id WHERE m.id=? AND m.sender_id=? AND m.deleted_at IS NULL', [messageId, actor.userId]);
    if (!row) throw new HttpError(404, 'Mensagem não encontrada.', 'chat_message_not_found');
    await db.batch([
      db.prepare("UPDATE chat_messages SET body='',deleted_at=? WHERE id=? AND sender_id=?").bind(now, messageId, actor.userId),
      ...(row.attachment_id ? [db.prepare('UPDATE chat_attachments SET deleted_at=COALESCE(deleted_at,?) WHERE id=?').bind(now, row.attachment_id)] : []),
    ]);
    if (row.object_key) await store.delete(String(row.object_key)).catch(() => db.prepare("INSERT INTO private_object_deletions(id,user_id,object_key,mime,created_at) VALUES(?,?,?,'image/*',?)").bind(uid(), actor.userId, String(row.object_key), now).run().catch(() => undefined));
    return { id: messageId };
  }
  throw new HttpError(400, 'Operação de conversa inválida.', 'invalid_action');
}

/** Real image type from the first bytes; metadata (EXIF/XMP) is refused so location never leaks. */
export function inspectChatImage(bytes: Uint8Array): { mime: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number } {
  const has = (sequence: number[], from = 0) => sequence.every((value, index) => bytes[from + index] === value);
  const ascii = (text: string) => [...text].map(character => character.charCodeAt(0));
  const contains = (needle: number[]) => { outer: for (let i = 0; i + needle.length <= bytes.length; i++) { for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer; return true; } return false; };
  let mime: 'image/jpeg' | 'image/png' | 'image/webp';
  if (has([0xff, 0xd8, 0xff])) mime = 'image/jpeg';
  else if (has([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) mime = 'image/png';
  else if (has(ascii('RIFF')) && has(ascii('WEBP'), 8)) mime = 'image/webp';
  else throw new HttpError(415, 'Envie uma foto JPEG, PNG ou WebP.', 'chat_image_type');
  const metadata = mime === 'image/jpeg' ? contains([0xff, 0xe1]) && (contains(ascii('Exif\0\0')) || contains(ascii('http://ns.adobe.com/xap')))
    : mime === 'image/png' ? contains(ascii('eXIf')) || contains(ascii('iTXtXML:com.adobe.xmp'))
    : contains(ascii('EXIF')) || contains(ascii('XMP '));
  if (metadata) throw new HttpError(415, 'A imagem ainda tem dados de localização ou da câmera. Envie pela tela do portal, que os remove.', 'chat_image_metadata');
  const size = imageSize(bytes, mime);
  if (!size || size.width < 1 || size.height < 1 || size.width > CHAT_IMAGE_MAX_SIDE || size.height > CHAT_IMAGE_MAX_SIDE) throw new HttpError(415, `A imagem precisa ter no máximo ${CHAT_IMAGE_MAX_SIDE} px de cada lado. Envie pela tela do portal, que a reduz.`, 'chat_image_dimensions');
  return { mime, ...size };
}
export const CHAT_IMAGE_MAX_SIDE = 1600;
/** Width and height from the file header (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X). Null when unreadable. */
export function imageSize(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  const u16be = (i: number) => (bytes[i] << 8) | bytes[i + 1], u16le = (i: number) => bytes[i] | (bytes[i + 1] << 8), u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  if (mime === 'image/png') return bytes.length >= 24 ? { width: (bytes[16] << 24 >>> 0) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19], height: (bytes[20] << 24 >>> 0) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23] } : null;
  if (mime === 'image/jpeg') {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: u16be(i + 5), width: u16be(i + 7) };
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === 'VP8X' && bytes.length >= 30) return { width: u24le(24) + 1, height: u24le(27) + 1 };
  if (chunk === 'VP8L' && bytes.length >= 25) { const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24]; return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }; }
  if (chunk === 'VP8 ' && bytes.length >= 30) return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
  return null;
}

export async function chatUpload(db: D1Database, rawActor: PortalActor | null, conversationId: unknown, bytes: Uint8Array, store: MediaStore) {
  const actor = requireActor(rawActor);
  const member = await requireInternalMember(db, actor);
  const id = identifier(conversationId, 'a conversa');
  const conversation = await requireConversation(db, actor, id);
  if (!bytes.byteLength || bytes.byteLength > CHAT_IMAGE_MAX_BYTES) throw new HttpError(413, 'A imagem passou de 1,5 MB mesmo depois de reduzida. Tente outra.', 'chat_image_size');
  const { mime } = inspectChatImage(bytes);
  await purgeExpiredChatMedia(db, store);
  const attachmentId = uid(), key = `chat/${uid()}`, now = iso(), expires = new Date(Date.now() + CHAT_RETENTION_DAYS * 86400000).toISOString();
  const access = conversationAccess(actor);
  const guards = [
    db.prepare(`SELECT CASE WHEN ${member.sql} AND ${access.sql} THEN 1 ELSE json_extract('[]','chat_access_changed') END`).bind(...member.values, ...access.values(id)),
    db.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM chat_attachments WHERE uploader_id=? AND created_at>?)<? THEN 1 ELSE json_extract('[]','chat_image_limit') END").bind(actor.userId, new Date(Date.now() - 86400000).toISOString(), CHAT_DAILY_IMAGES),
    db.prepare("SELECT CASE WHEN COALESCE((SELECT SUM(a.size) FROM chat_attachments a JOIN chat_conversations c ON c.id=a.conversation_id WHERE c.organization_id=? AND a.deleted_at IS NULL),0)+?<=? THEN 1 ELSE json_extract('[]','chat_org_space') END").bind(conversation.organization_id, bytes.byteLength, CHAT_ORG_ACTIVE_BYTES),
  ];
  // Record first, then store: a crash in between leaves a row without object (never served, purged later), never an orphan object.
  try { await db.batch([...guards, db.prepare('INSERT INTO chat_attachments(id,conversation_id,uploader_id,object_key,mime,size,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(attachmentId, id, actor.userId, key, mime, bytes.byteLength, now, expires)]); }
  catch (error) { failure(error); }
  try { await store.put(key, bytes, mime); }
  catch (error) { await db.prepare('UPDATE chat_attachments SET deleted_at=? WHERE id=?').bind(iso(), attachmentId).run(); throw error; }
  return { attachmentId, mime, size: bytes.byteLength, expiresAt: expires };
}

/** Image bytes for someone who can read the conversation; expired or deleted images are gone. */
export async function chatMedia(db: D1Database, rawActor: PortalActor | null, attachmentId: unknown, store: MediaStore) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const id = identifier(attachmentId, 'a imagem');
  const row = await one(db, 'SELECT conversation_id,object_key,mime FROM chat_attachments WHERE id=? AND deleted_at IS NULL AND expires_at>?', [id, iso()]);
  if (!row) throw new HttpError(404, 'Imagem indisponível.', 'chat_media_not_found');
  await requireConversation(db, actor, String(row.conversation_id));
  const found = await store.get(String(row.object_key));
  if (!found) throw new HttpError(404, 'Imagem indisponível.', 'chat_media_not_found');
  return { data: found.data, mime: String(row.mime) };
}

/** Removes up to `limit` images past their 180 days (object first, then the row). Opportunistic, bounded. */
export async function purgeExpiredChatMedia(db: D1Database, store: MediaStore, limit = 10, now = iso()) {
  const rows = await all(db, 'SELECT id,object_key FROM chat_attachments WHERE deleted_at IS NULL AND expires_at<=? ORDER BY expires_at LIMIT ?', [now, limit]);
  let removed = 0;
  // Chat objects whose removal failed earlier wait in private_object_deletions; retry a few each time.
  const pending = await all(db, "SELECT id,object_key FROM private_object_deletions WHERE deleted_at IS NULL AND object_key LIKE 'chat/%' ORDER BY created_at LIMIT ?", [limit]);
  for (const row of pending) {
    try { await store.delete(String(row.object_key)); } catch { continue; }
    await db.prepare('UPDATE private_object_deletions SET deleted_at=?,object_key=NULL,mime=NULL WHERE id=? AND deleted_at IS NULL').bind(now, row.id).run();
  }
  for (const row of rows) {
    try { await store.delete(String(row.object_key)); } catch { continue; } // keep the row: retried on the next purge
    await db.prepare('UPDATE chat_attachments SET deleted_at=? WHERE id=? AND deleted_at IS NULL').bind(now, row.id).run();
    removed++;
  }
  return removed;
}

/*
 * Daily routine (called from the health cron): clears every expired image in bounded batches, so the 180 days
 * hold even when nobody is using the chat. The health route is public, so a per-instance brake keeps repeated
 * calls cheap; with nothing expired it is two small reads and no write.
 */
export const SCHEDULED_PURGE_BATCH = 25, SCHEDULED_PURGE_MAX_BATCHES = 8, SCHEDULED_PURGE_MIN_INTERVAL_MS = 60 * 60 * 1000;
let lastScheduledPurge = 0;
export async function scheduledChatMediaPurge(db: D1Database, store: MediaStore, clock = Date.now()) {
  if (lastScheduledPurge && clock - lastScheduledPurge < SCHEDULED_PURGE_MIN_INTERVAL_MS) return { ran: false, removed: 0 };
  lastScheduledPurge = clock;
  let removed = 0;
  for (let batch = 0; batch < SCHEDULED_PURGE_MAX_BATCHES; batch++) {
    const count = await purgeExpiredChatMedia(db, store, SCHEDULED_PURGE_BATCH, new Date(clock).toISOString());
    removed += count;
    if (count < SCHEDULED_PURGE_BATCH) break; // nothing left, or a removal failed: the rest waits for the next run
  }
  return { ran: true, removed };
}

/** Space report for the administration: hosting database size (when measurable) and chat image totals. */
export async function communityStorageReport(db: D1Database, rawActor: PortalActor | null) {
  const actor = requireActor(rawActor);
  const owner = platformOwnerAuthoritySql(actor);
  if (!await one(db, `SELECT 1 ok WHERE ${owner.sql}`, owner.values)) throw new HttpError(403, 'Só a administração geral vê o espaço usado.', 'storage_forbidden');
  const usage = await storageUsage();
  const chat = await one(db, `SELECT COUNT(*) images,COALESCE(SUM(size),0) bytes,MIN(expires_at) nextExpiry FROM chat_attachments WHERE deleted_at IS NULL`);
  const records = await one(db, 'SELECT COALESCE(SUM(size),0) bytes FROM record_attachments WHERE deleted_at IS NULL');
  const used = usage?.databaseBytes ?? null;
  return {
    plan: { bytes: PLAN_DATABASE_BYTES, alertRatio: PLAN_ALERT_RATIO, label: 'Supabase gratuito (500 MB)' },
    database: usage, usedRatio: used === null ? null : used / PLAN_DATABASE_BYTES, alert: used !== null && used / PLAN_DATABASE_BYTES >= PLAN_ALERT_RATIO,
    chat: { images: Number(chat?.images ?? 0), bytes: Number(chat?.bytes ?? 0), nextExpiry: chat?.nextExpiry ?? null, retentionDays: CHAT_RETENTION_DAYS, perOrganizationLimit: CHAT_ORG_ACTIVE_BYTES },
    records: { bytes: Number(records?.bytes ?? 0) },
  };
}
