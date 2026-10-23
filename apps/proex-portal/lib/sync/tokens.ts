import { all, one, iso, uid, text } from '../database';
import { HttpError } from '../errors';
import { getActor, type PortalActor } from '../access';
import { requireSyncOwner, syncDigest } from './contracts';

// Chaves do conector da planilha (Google Apps Script, Excel/Power Automate ou outro
// cliente). A chave age em nome de quem a criou e só enquanto essa pessoa continuar
// responsável global ativa: perder o papel, bloquear a conta ou revogar a chave
// interrompe imediatamente o acesso. O valor aparece uma única vez; guardamos o hash.
export const SYNC_TOKEN_PREFIX = 'pxs_';
const TOKEN_DAYS = 365;
const MAX_ACTIVE_TOKENS = 5;

function randomToken(): string {
 const bytes = crypto.getRandomValues(new Uint8Array(32));
 return SYNC_TOKEN_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function createSyncToken(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>) {
 await requireSyncOwner(db, actor);
 if (!actor) throw new HttpError(401, 'Entre para continuar.');
 const now = iso(), active = await one(db, 'SELECT COUNT(*) AS n FROM sync_tokens WHERE user_id=? AND revoked_at IS NULL AND expires_at>?', [actor.userId, now]);
 if (Number(active?.n ?? 0) >= MAX_ACTIVE_TOKENS) throw new HttpError(409, 'Revogue uma chave antiga antes de criar outra.', 'sync_token_limit');
 const token = randomToken(), id = uid(), label = text(input.label, 80) || 'Planilha Google';
 const expiresAt = new Date(Date.now() + TOKEN_DAYS * 86400000).toISOString();
 await db.batch([
  db.prepare('INSERT INTO sync_tokens(id,token_hash,user_id,label,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id, await syncDigest(token), actor.userId, label, now, expiresAt),
  db.prepare("INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) VALUES(?,?,'sync.token.create',?,'{}',?)").bind(uid(), actor.userId, id, now),
 ]);
 return { id, label, token, expiresAt };
}
export async function listSyncTokens(db: D1Database, actor: PortalActor | null) {
 await requireSyncOwner(db, actor);
 return all(db, 'SELECT id,label,created_at,expires_at,revoked_at,last_used_at FROM sync_tokens ORDER BY created_at DESC LIMIT 50');
}
export async function revokeSyncToken(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>) {
 await requireSyncOwner(db, actor);
 if (!actor) throw new HttpError(401, 'Entre para continuar.');
 const id = text(input.id, 80), now = iso();
 const result = await db.prepare('UPDATE sync_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(now, id).run();
 if (!result.meta.changes) throw new HttpError(404, 'Chave não encontrada ou já revogada.', 'sync_token_not_found');
 await db.prepare("INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) VALUES(?,?,'sync.token.revoke',?,'{}',?)").bind(uid(), actor.userId, id, now).run();
 return { id, revokedAt: now };
}
/** Resolve `Authorization: Bearer pxs_…` para o responsável que criou a chave. */
export async function actorFromSyncToken(db: D1Database, authorization: string | null): Promise<PortalActor> {
 const match = /^Bearer\s+(pxs_[A-Za-z0-9_-]{40,60})$/.exec(authorization ?? '');
 if (!match) throw new HttpError(401, 'Informe a chave de sincronização.', 'sync_token_required');
 const now = iso();
 const row = await one(db, `SELECT t.id,t.user_id,u.email,p.display_name FROM sync_tokens t
  JOIN portal_users u ON u.user_id=t.user_id LEFT JOIN profiles p ON p.user_id=t.user_id
  WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>? AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL`, [await syncDigest(match[1]), now]);
 if (!row) throw new HttpError(401, 'Chave de sincronização inválida, expirada ou revogada.', 'sync_token_invalid');
 const actor = await getActor(db, { userId: row.user_id, email: row.email, displayName: row.display_name || row.email });
 await requireSyncOwner(db, actor);
 await db.prepare('UPDATE sync_tokens SET last_used_at=? WHERE id=?').bind(now, row.id).run();
 return actor!;
}
