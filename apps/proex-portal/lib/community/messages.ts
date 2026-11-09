import { LEGACY_ORGANIZATION_ID, type PortalActor } from '../access';
import { all, one, uid, iso } from '../database';
import { HttpError } from '../errors';
import { prepareMutation } from '../mutations';
import { identifier, only, personText, requireActor, requireInternalMember } from './shared';

/*
 * Direct messages (recados) between active internal people who share an organization.
 * Private to sender and recipient: management has no reading path. A person can block another.
 * The message text is not part of the idempotency fingerprint (mutation_keys outlives a hidden message).
 */
export const DAILY_MESSAGES = 60;
export const MESSAGE_LIST_LIMIT = 100;
/** Does the user (SQL expression) belong to the organization (SQL expression)? Active account, unrevoked membership. */
export function organizationMemberSql(userSql: string, orgSql: string) {
  return `EXISTS(SELECT 1 FROM members om JOIN portal_users ou ON ou.user_id=om.user_id WHERE om.user_id=${userSql} AND om.revoked_at IS NULL
    AND ou.status='active' AND ou.activation_pending=0 AND ou.anonymized_at IS NULL AND (
      om.organization_id=${orgSql}
      OR (om.role='owner' AND om.project_id IS NULL AND om.organization_id IS NULL)
      OR (om.project_id IS NULL AND om.organization_id IS NULL AND ${orgSql}='${LEGACY_ORGANIZATION_ID}')
      OR (om.project_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects op WHERE op.id=om.project_id AND op.organization_id=${orgSql}))))`;
}
/** Organization-wide membership (not tied to one project): organization members/owners, legacy portal-wide members, global owners. */
function organizationLevelSql(userSql: string, orgSql: string) {
  return `EXISTS(SELECT 1 FROM members ol JOIN portal_users olu ON olu.user_id=ol.user_id WHERE ol.user_id=${userSql} AND ol.revoked_at IS NULL AND ol.project_id IS NULL
    AND olu.status='active' AND olu.activation_pending=0 AND olu.anonymized_at IS NULL
    AND (ol.organization_id=${orgSql} OR (ol.role='owner' AND ol.organization_id IS NULL) OR (ol.organization_id IS NULL AND ${orgSql}='${LEGACY_ORGANIZATION_ID}')))`;
}
/**
 * Who may message whom inside an organization: both belong to it AND (either has organization-wide access OR they share a project).
 * A person who only works in one project does not see or reach the whole organization (same reach as the rest of the portal).
 */
export function messagePairSql(aSql: string, bSql: string, orgSql: string) {
  return `(${organizationMemberSql(aSql, orgSql)} AND ${organizationMemberSql(bSql, orgSql)} AND (${organizationLevelSql(aSql, orgSql)} OR ${organizationLevelSql(bSql, orgSql)}
    OR EXISTS(SELECT 1 FROM members pa JOIN members pb ON pb.project_id=pa.project_id AND pb.user_id=${bSql} AND pb.revoked_at IS NULL
      JOIN projects pp ON pp.id=pa.project_id AND pp.organization_id=${orgSql} WHERE pa.user_id=${aSql} AND pa.revoked_at IS NULL)))`;
}
function failure(error: unknown): never {
  const text = String(error);
  if (text.includes('message_sender_changed')) throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'community_access_changed');
  if (text.includes('message_recipient_unavailable')) throw new HttpError(409, 'Esta pessoa não pode receber recados nesta organização agora.', 'message_recipient_unavailable');
  if (text.includes('message_daily_limit')) throw new HttpError(429, `Você já enviou ${DAILY_MESSAGES} recados nas últimas 24 horas. Tente mais tarde.`, 'message_daily_limit');
  throw error;
}

/** People the actor can write to, grouped by shared organization. Names only, never e-mails. */
export async function messagePeople(db: D1Database, rawActor: PortalActor | null) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const rows = await all(db, `SELECT o.id organization_id,o.name organization_name,u.user_id,COALESCE(NULLIF(p.display_name,''),'Pessoa da equipe') name
    FROM (SELECT ? me) x JOIN organizations o ON o.status='active' JOIN portal_users u ON u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL AND u.user_id!=x.me
    LEFT JOIN profiles p ON p.user_id=u.user_id
    WHERE ${messagePairSql('x.me', 'u.user_id', 'o.id')}
    ORDER BY o.name,name,u.user_id LIMIT 2001`, [actor.userId]);
  const truncated = rows.length > 2000;
  const organizations = new Map<string, { id: string; name: string; people: { id: string; name: string }[] }>();
  for (const row of rows.slice(0, 2000)) {
    const entry = organizations.get(row.organization_id) ?? { id: String(row.organization_id), name: String(row.organization_name), people: [] };
    entry.people.push({ id: String(row.user_id), name: String(row.name) }); organizations.set(entry.id, entry);
  }
  const blocked = (await all(db, 'SELECT blocked_id FROM community_blocks WHERE user_id=?', [actor.userId])).map(row => String(row.blocked_id));
  return { organizations: [...organizations.values()], blocked, truncated };
}

export async function messageList(db: D1Database, rawActor: PortalActor | null) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const select = `SELECT m.id,m.organization_id organizationId,o.name organizationName,m.body,m.created_at createdAt,m.read_at readAt,
    m.sender_id senderId,COALESCE(NULLIF(sp.display_name,''),'Pessoa da equipe') senderName,m.recipient_id recipientId,COALESCE(NULLIF(rp.display_name,''),'Pessoa da equipe') recipientName
    FROM community_messages m JOIN organizations o ON o.id=m.organization_id LEFT JOIN profiles sp ON sp.user_id=m.sender_id LEFT JOIN profiles rp ON rp.user_id=m.recipient_id`;
  const inbox = await all(db, `${select} WHERE m.recipient_id=? AND m.recipient_hidden_at IS NULL AND NOT EXISTS(SELECT 1 FROM community_blocks b WHERE b.user_id=m.recipient_id AND b.blocked_id=m.sender_id)
    ORDER BY m.created_at DESC,m.id LIMIT ?`, [actor.userId, MESSAGE_LIST_LIMIT]);
  const sent = await all(db, `${select} WHERE m.sender_id=? AND m.sender_hidden_at IS NULL ORDER BY m.created_at DESC,m.id LIMIT ?`, [actor.userId, MESSAGE_LIST_LIMIT]);
  return { inbox, sent, unread: inbox.filter(row => !row.readAt).length };
}
export async function unreadMessages(db: D1Database, userId: string) {
  const row = await one(db, `SELECT COUNT(*) n FROM community_messages m WHERE m.recipient_id=? AND m.read_at IS NULL AND m.recipient_hidden_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM community_blocks b WHERE b.user_id=m.recipient_id AND b.blocked_id=m.sender_id)`, [userId]);
  return Number(row?.n ?? 0);
}

export async function messageAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const now = iso();
  if (input.action === 'send') {
    only(input, ['action', 'organizationId', 'recipientId', 'body', 'operationKey']);
    const organizationId = identifier(input.organizationId, 'a organização'), recipientId = identifier(input.recipientId, 'a pessoa');
    if (recipientId === actor.userId) throw new HttpError(400, 'Escolha outra pessoa.', 'invalid_recipient');
    const body = personText(input.body, 1, 1000, 'Escreva o recado em até 1.000 caracteres.');
    // Minimal fingerprint: neither the text nor the recipient is kept in mutation_keys.
    const mutation = await prepareMutation(db, actor.userId, 'community.message.send', { kind: 'message', operationKey: input.operationKey });
    if (mutation.existingId) return { id: mutation.existingId, duplicate: true };
    const id = uid();
    try {
      await db.batch([
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT ? uid,? oid) x JOIN organizations xo ON xo.id=x.oid AND xo.status='active' WHERE ${organizationMemberSql('x.uid', 'x.oid')}) THEN 1 ELSE json_extract('[]','message_sender_changed') END`).bind(actor.userId, organizationId),
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT ? uid,? oid,? sid) x WHERE ${messagePairSql('x.sid', 'x.uid', 'x.oid')} AND NOT EXISTS(SELECT 1 FROM community_blocks b WHERE (b.user_id=x.uid AND b.blocked_id=x.sid) OR (b.user_id=x.sid AND b.blocked_id=x.uid))) THEN 1 ELSE json_extract('[]','message_recipient_unavailable') END`).bind(recipientId, organizationId, actor.userId),
        db.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM community_messages WHERE sender_id=? AND created_at>?)<? THEN 1 ELSE json_extract('[]','message_daily_limit') END").bind(actor.userId, new Date(Date.now() - 86400000).toISOString(), DAILY_MESSAGES),
        db.prepare('INSERT INTO community_messages(id,organization_id,sender_id,recipient_id,body,created_at) VALUES(?,?,?,?,?,?)').bind(id, organizationId, actor.userId, recipientId, body, now),
        mutation.claimStatement(id),
      ]);
    } catch (error) {
      if (/message_(sender_changed|recipient_unavailable|daily_limit)/.test(String(error))) failure(error);
      return { id: await mutation.recover(error), duplicate: true };
    }
    return { id, duplicate: false };
  }
  if (input.action === 'read' || input.action === 'hide') {
    only(input, ['action', 'id']);
    const id = identifier(input.id, 'o recado');
    const result = input.action === 'read'
      ? await db.prepare('UPDATE community_messages SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient_id=?').bind(now, id, actor.userId).run()
      : await db.prepare('UPDATE community_messages SET sender_hidden_at=CASE WHEN sender_id=? THEN COALESCE(sender_hidden_at,?) ELSE sender_hidden_at END, recipient_hidden_at=CASE WHEN recipient_id=? THEN COALESCE(recipient_hidden_at,?) ELSE recipient_hidden_at END WHERE id=? AND (sender_id=? OR recipient_id=?)').bind(actor.userId, now, actor.userId, now, id, actor.userId, actor.userId).run();
    if (result.meta.changes !== 1) throw new HttpError(404, 'Este recado não está mais disponível.', 'message_not_found');
    // Once both sides hid it, the message is deleted for real (it would otherwise survive in backups).
    if (input.action === 'hide') await db.prepare('DELETE FROM community_messages WHERE id=? AND sender_hidden_at IS NOT NULL AND recipient_hidden_at IS NOT NULL').bind(id).run();
    return { id };
  }
  if (input.action === 'block' || input.action === 'unblock') {
    only(input, ['action', 'userId']);
    const other = identifier(input.userId, 'a pessoa');
    if (other === actor.userId) throw new HttpError(400, 'Escolha outra pessoa.', 'invalid_recipient');
    if (input.action === 'block') {
      // Same answer whether or not the account exists; at most 500 blocks per person.
      await db.prepare("INSERT OR IGNORE INTO community_blocks(user_id,blocked_id,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM portal_users WHERE user_id=?) AND (SELECT COUNT(*) FROM community_blocks WHERE user_id=?)<500").bind(actor.userId, other, now, other, actor.userId).run();
    } else await db.prepare('DELETE FROM community_blocks WHERE user_id=? AND blocked_id=?').bind(actor.userId, other).run();
    return { userId: other, blocked: input.action === 'block' };
  }
  throw new HttpError(400, 'Operação de recado inválida.', 'invalid_action');
}
