import type { PortalActor } from '../access';
import { HttpError } from '../errors';
/** Active internal account with at least one unrevoked membership, evaluated in SQL with the request. */
export function internalMemberSql(actor: PortalActor) {
  return { sql: `EXISTS(SELECT 1 FROM members m JOIN portal_users u ON u.user_id=m.user_id WHERE m.user_id=? AND m.revoked_at IS NULL AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL)`, values: [actor.userId] };
}
export function requireActor(actor: PortalActor | null): PortalActor {
  if (!actor) throw new HttpError(401, 'Entre para continuar.', 'unauthenticated');
  return actor;
}
export async function requireInternalMember(db: D1Database, actor: PortalActor) {
  const member = internalMemberSql(actor);
  if (!await db.prepare(`SELECT 1 AS ok WHERE ${member.sql}`).bind(...member.values).first()) throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'community_access_changed');
  return member;
}
/** Plain text from a person: NFC, trimmed, no control characters except line breaks and tabs. */
export function personText(value: unknown, min: number, max: number, message: string): string {
  const text = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  const length = Array.from(text).length;
  if (length < min || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new HttpError(400, message, 'invalid_text');
  return text;
}
export function only(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some(key => !keys.includes(key))) throw new HttpError(400, 'Há campos não permitidos nesta operação.', 'invalid_input');
}
export function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new HttpError(400, `Selecione ${label}.`, 'invalid_input');
  return value;
}
export function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpError(400, 'Atualize a página e tente novamente.', 'invalid_version');
  return value as number;
}
