import { getActor, projectAuthoritySql, type PortalActor } from '../access';
import { all, one, type Row } from '../database';
import { HttpError } from '../errors';

export const MCP_SCOPES = ['project.summary', 'tasks.read'] as const;
export type McpScope = typeof MCP_SCOPES[number];
const DAY = 86_400_000;
function fail(status: number, message: string, code = 'mcp_token_invalid'): never { throw new HttpError(status, message, code); }
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Confira os dados da conexão.'); return value as Record<string, unknown>; }
function only(input: Record<string, unknown>, keys: string[]) { if (Object.keys(input).some(key => !keys.includes(key))) fail(400, 'A conexão contém campos não permitidos.'); }
export function mcpScopes(value: unknown): McpScope[] {
  if (!Array.isArray(value) || !value.length || value.length > MCP_SCOPES.length || value.some(scope => !MCP_SCOPES.includes(scope)) || new Set(value).size !== value.length) fail(400, 'Escolha apenas as consultas disponíveis.', 'mcp_scope');
  return value as McpScope[];
}
function projectIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 20 || value.some(id => !identifier(id)) || new Set(value).size !== value.length) fail(400, 'Escolha de um a vinte projetos, sem acesso geral.', 'mcp_scope');
  return value as string[];
}
async function digest(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
const active = "u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL";
async function liveActor(db: D1Database, userId: string): Promise<PortalActor> {
  const account = await one(db, `SELECT u.user_id,u.email,p.display_name FROM portal_users u LEFT JOIN profiles p ON p.user_id=u.user_id WHERE u.user_id=? AND ${active}`, [userId]);
  const actor = account && await getActor(db, { userId: account.user_id, email: account.email, displayName: account.display_name || account.email });
  if (!actor) fail(401, 'Entre novamente ou confira se a conexão continua ativa.');
  return actor;
}
async function projectAccess(db: D1Database, actor: PortalActor, ids: string[]) {
  const guard = projectAuthoritySql(actor, [], 'p.id');
  const projects = await all(db, `SELECT p.id,p.name FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.status='active' WHERE p.id IN (${ids.map(() => '?').join(',')}) AND ${guard.sql}`, [...ids, ...guard.values]);
  if (projects.length !== ids.length) fail(403, 'Seu acesso a um dos projetos mudou. Gere uma conexão com os projetos permitidos.', 'mcp_scope');
  return projects;
}
export async function listMcpTokens(db: D1Database, supplied: PortalActor | null) {
  if (!supplied) fail(401, 'Entre para gerenciar suas conexões.');
  const actor = await liveActor(db, supplied.userId), guard = projectAuthoritySql(actor, [], 'p.id');
  const projects = await all(db, `SELECT p.id,p.name FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.status='active' WHERE ${guard.sql} ORDER BY p.name,p.id`, guard.values);
  const tokens = await all(db, 'SELECT id,label,scope_json,projects_json,expires_at,revoked_at,created_at FROM mcp_personal_tokens WHERE user_id=? ORDER BY CASE WHEN revoked_at IS NULL AND expires_at>? THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 100', [actor.userId, new Date().toISOString()]);
  const current = await liveActor(db, actor.userId);
  if (projects.length) await projectAccess(db, current, projects.map(project => project.id));
  return { projects, tokens: tokens.map(row => ({ id: row.id, label: row.label, scopes: JSON.parse(row.scope_json), projectIds: JSON.parse(row.projects_json), expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at })) };
}
export async function manageMcpToken(db: D1Database, supplied: PortalActor | null, raw: unknown, now = Date.now()) {
  if (!supplied) fail(401, 'Entre para gerenciar suas conexões.');
  const input = object(raw), actor = await liveActor(db, supplied.userId);
  if (input.action === 'revoke') {
    only(input, ['action', 'id']); if (!identifier(input.id)) fail(400, 'Escolha uma conexão sua.');
    const at = new Date(now).toISOString();
    const result = await db.batch([
      db.prepare(`UPDATE mcp_personal_tokens SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=? AND ${active})`).bind(at, input.id, actor.userId, actor.userId),
      db.prepare("INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) SELECT ?,?,'mcp.token.revoke',?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(), actor.userId, input.id, at),
    ]);
    if (!result[0].meta.changes && !await one(db, 'SELECT id FROM mcp_personal_tokens WHERE id=? AND user_id=? AND revoked_at IS NOT NULL', [input.id, actor.userId])) fail(404, 'Conexão não encontrada.');
    return { id: input.id, revoked: true };
  }
  only(input, ['action', 'label', 'projectIds', 'scopes', 'days', 'requestId']);
  if (input.action !== 'create' || typeof input.label !== 'string' || !input.label.trim() || input.label.trim().length > 80 || /[\u0000-\u001f]|pxm_|pxs_|gsk_|nvapi-|Bearer\s|sk-/i.test(input.label) || /^[A-Za-z0-9_-]{32,}$/.test(input.label.trim()) || typeof input.requestId !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.requestId)) fail(400, 'Informe um nome curto e refaça o envio pela plataforma.');
  const ids = projectIds(input.projectIds), scopes = mcpScopes(input.scopes), days = input.days ?? 7;
  if (!Number.isInteger(days) || Number(days) < 1 || Number(days) > 30) fail(400, 'Escolha validade entre um e trinta dias.');
  await projectAccess(db, actor, ids);
  if (await one(db, 'SELECT id FROM mcp_personal_tokens WHERE user_id=? AND request_id=?', [actor.userId, input.requestId])) fail(409, 'Esta conexão já foi criada. Consulte a lista; se perdeu a chave, revogue e gere outra.', 'mcp_token_created');
  const id = crypto.randomUUID(), bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = 'pxm_' + btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); bytes.fill(0);
  const hash = await digest(token), at = new Date(now).toISOString(), expires = new Date(now + Number(days) * DAY).toISOString();
  const checks = ids.map(projectId => { const guard = projectAuthoritySql(actor, [], 'p.id'); return { sql: `EXISTS(SELECT 1 FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.status='active' WHERE p.id=? AND ${guard.sql})`, values: [projectId, ...guard.values] }; });
  const guard = `EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=? AND ${active}) AND (SELECT COUNT(*) FROM mcp_personal_tokens WHERE user_id=? AND created_at>=?)<20 AND (SELECT COUNT(*) FROM mcp_personal_tokens WHERE user_id=? AND revoked_at IS NULL AND expires_at>?)<20 AND ${checks.map(check => check.sql).join(' AND ')}`;
  const guardValues = [actor.userId, actor.userId, new Date(now - DAY).toISOString(), actor.userId, at, ...checks.flatMap(check => check.values)];
  let result: D1Result[];
  try { result = await db.batch([
    db.prepare(`INSERT INTO mcp_personal_tokens(id,user_id,label,token_hash,scope_json,projects_json,request_id,expires_at,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(id, actor.userId, input.label.trim(), hash, JSON.stringify(scopes), JSON.stringify(ids), input.requestId, expires, at, ...guardValues),
    db.prepare("INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) SELECT ?,?,'mcp.token.create',?,?,? WHERE changes()=1").bind(crypto.randomUUID(), actor.userId, id, JSON.stringify({ projects: ids, scopes, expiresAt: expires }), at),
  ]); } catch (error) {
    if (await one(db, 'SELECT id FROM mcp_personal_tokens WHERE user_id=? AND request_id=?', [actor.userId, input.requestId])) fail(409, 'Esta conexão já foi criada. Se perdeu a chave, revogue e gere outra.', 'mcp_token_created');
    throw error;
  }
  if (result[0].meta.changes !== 1) fail(403, 'Seu acesso mudou ou o limite de vinte conexões ativas/emissões por dia foi alcançado. Revogue conexões antigas ou tente novamente mais tarde.', 'mcp_token_limit');
  return { id, token, expiresAt: expires };
}
export type McpIdentity = { tokenId: string; actor: PortalActor; scopes: McpScope[]; projectIds: string[]; projects: Row[] };
export async function mcpIdentity(db: D1Database, authorization: string | null, now = Date.now()): Promise<McpIdentity> {
  if (!authorization || !/^Bearer pxm_[A-Za-z0-9_-]{43}$/i.test(authorization)) fail(401, 'Use uma credencial pessoal MCP válida.');
  const hash = await digest(authorization.slice(7));
  const token = await one(db, `SELECT t.id,t.user_id,t.scope_json,t.projects_json FROM mcp_personal_tokens t JOIN portal_users u ON u.user_id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>? AND ${active}`, [hash, new Date(now).toISOString()]);
  if (!token) fail(401, 'Esta conexão expirou ou foi revogada. Gere outra na sua conta.');
  const actor = await liveActor(db, token.user_id), ids = projectIds(JSON.parse(token.projects_json)), scopes = mcpScopes(JSON.parse(token.scope_json)), projects = await projectAccess(db, actor, ids);
  return { tokenId: token.id, actor, scopes, projectIds: ids, projects };
}
