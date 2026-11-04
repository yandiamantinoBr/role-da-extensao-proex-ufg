import { platformOwnerAuthoritySql, type PortalActor } from '../access';
import { all, one, iso } from '../database';
import { HttpError } from '../errors';
import { object, onlyKeys } from './contracts';
import { credentialKeyId, decryptProviderCredentials, encryptProviderCredentials, type CredentialKeys } from './crypto';

const forbidden = () => new HttpError(403, 'Somente a administração geral pode migrar as credenciais.', 'assistant_key_admin');

export async function migrateAssistantCredentials(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, authSecret: string, keys: CredentialKeys) {
  if (!actor) throw new HttpError(401, 'Entre para acessar as credenciais.', 'unauthenticated');
  const authority = platformOwnerAuthoritySql(actor);
  if (!await one(db, `SELECT 1 WHERE ${authority.sql}`, authority.values)) throw forbidden();
  onlyKeys(input, ['cursor', 'limit']);
  const cursor = input.cursor ?? '', limit = input.limit ?? 5;
  if (typeof cursor !== 'string' || (cursor && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(cursor)) ||
      typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 10) {
    throw new HttpError(400, 'Use um cursor válido e um lote de até dez organizações.', 'assistant_key_migration_input');
  }
  const prefix = `v2.${await credentialKeyId(keys.current, authSecret)}.`;
  const candidates = await all(db, `SELECT organization_id,revision,credentials_ciphertext
    FROM ai_organization_settings WHERE organization_id>? AND ${authority.sql}
    ORDER BY organization_id LIMIT ?`, [cursor, ...authority.values, limit + 1]);
  let migrated = 0, changed = 0, unreadable = 0;
  for (const candidate of candidates.slice(0, limit)) {
    const organizationId = String(candidate.organization_id), previous = String(candidate.credentials_ciphertext);
    let credentials;
    try { credentials = object(await decryptProviderCredentials(authSecret, previous, organizationId, keys)); }
    catch { unreadable++; continue; }
    if (previous.startsWith(prefix)) continue;
    const ciphertext = await encryptProviderCredentials(authSecret, credentials, organizationId, keys, previous);
    const [written] = await db.batch([
      db.prepare(`UPDATE ai_organization_settings SET credentials_ciphertext=?
        WHERE organization_id=? AND revision=? AND credentials_ciphertext=? AND ${authority.sql}`)
        .bind(ciphertext, organizationId, candidate.revision, previous, ...authority.values),
      db.prepare(`INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at)
        SELECT ?,?,?,'assistant.credentials.reencrypted',?,'{"format":"v2"}',? WHERE changes()=1`)
        .bind(crypto.randomUUID(), actor.userId, organizationId, organizationId, iso()),
    ]);
    if (written.meta.changes === 1) migrated++;
    else changed++;
  }
  const summary = await one(db, `SELECT COUNT(*) AS remaining FROM ai_organization_settings
    WHERE substr(credentials_ciphertext,1,?)<>? HAVING ${authority.sql}`, [prefix.length, prefix, ...authority.values]);
  if (!summary) throw forbidden();
  return { migrated, changed, unreadable, remaining: Number(summary.remaining),
    nextCursor: candidates.length > limit ? String(candidates[limit - 1].organization_id) : null };
}
