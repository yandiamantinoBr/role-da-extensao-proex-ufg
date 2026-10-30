import { HttpError } from '../errors';
import { one } from '../database';
import { type PortalActor } from '../access';

export const PORTABLE_VERSION = 1;
export const MAX_PORTABLE_PAGE = 100;
export const MAX_PORTABLE_TABLE_ROWS = 5000;
export const MAX_PORTABLE_TABLE_BYTES = 8 * 1024 * 1024;
export const MAX_SYNC_CHANGES = 25;
export type PortableCell = string | number | boolean | null;
export type PortableColumn = { name: string; label: string; type: 'text' | 'number' | 'boolean' | 'datetime'; editable: boolean; required: boolean; system: boolean; private: false };
export type PortableSchema = { table: string; label: string; sheetName: string; columns: PortableColumn[]; mode: 'metadata' | 'append_only' | 'read_only'; updateAction?: string; versionColumn?: string; omitted: string[] };
export type PortableRow = Record<string, PortableCell> & { _rowKey: string; _rowHash: string };
export type PortableChange = { changeKey: string; table?: string; id?: string; expectedVersion?: number; fields?: Record<string, unknown>; action?: string; input?: Record<string, unknown> };
export type PortableChangeResult = { changeKey: string; status: 'applied' | 'duplicate' | 'conflict' | 'rejected'; entityId?: string | null; conflictId?: string; code?: string };

// This predicate is also evaluated inside every imported domain transaction. A stale
// actor object or spreadsheet cell can never establish organization authority.
export const SYNC_OWNER_SQL = `EXISTS(SELECT 1 FROM members m LEFT JOIN portal_users u ON u.user_id=m.user_id
 WHERE m.user_id=? AND m.role='owner' AND m.project_id IS NULL AND m.revoked_at IS NULL
 AND COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0 AND u.anonymized_at IS NULL)`;
export async function requireSyncOwner(db: D1Database, actor: PortalActor | null): Promise<void> {
 if (!actor) throw new HttpError(401, 'Entre para acessar a integração.', 'unauthenticated');
 if (!await one(db, `SELECT 1 AS allowed WHERE ${SYNC_OWNER_SQL}`, [actor.userId])) throw new HttpError(403, 'Somente a administração geral pode sincronizar dados.', 'sync_forbidden');
}
export function canonicalSyncJson(value: unknown): string {
 const ordered = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(ordered);
  if (v && typeof v === 'object') { const fields = v as Record<string, unknown>; return Object.fromEntries(Object.keys(fields).filter(k => fields[k] !== undefined).sort().map(k => [k, ordered(fields[k])])); }
  return v;
 };
 return JSON.stringify(ordered(value));
}
export async function syncDigest(value: string): Promise<string> {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
