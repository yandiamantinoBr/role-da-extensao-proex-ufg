import { accountBatch, requireLiveAccount, writeAudit, type PortalActor } from '../access';
import { iso, one } from '../database';
import { HttpError } from '../errors';
import type { CredentialKeys } from '../assistant/crypto';
import { driveKeyId, openOAuthState, openRefreshToken, pkceChallenge, randomToken, sealOAuthState, sealRefreshToken } from './crypto';
import { authorizationUrl, DRIVE_SCOPE, exchangeCode, reconnectRequired, refreshAccessToken, revokeToken, userInfo, type Fetcher, type GoogleClient } from './google';

export type DriveEnvironment = { clientId?: string; clientSecret?: string; pickerApiKey?: string; appId?: string; origin?: string };
export type DriveDeps = { env: DriveEnvironment; keys: CredentialKeys; authSecret: string; fetcher?: Fetcher; now?: number };
export const OAUTH_COOKIE = 'proex.gdrive.oauth';
export const CALLBACK_PATH = '/api/drive/oauth/callback';
const DEFAULT_RETURN = '/?module=profile#google-drive';
const RETURN_PATHS = new Set([DEFAULT_RETURN, '/']);

export function driveConfigured(deps: DriveDeps): boolean {
  const { clientId, clientSecret, origin } = deps.env;
  return !!(clientId && clientSecret && origin && deps.keys.current && deps.keys.current.length >= 32 && deps.keys.current !== deps.authSecret);
}
export function requireConfigured(deps: DriveDeps): GoogleClient & { origin: string } {
  if (!driveConfigured(deps)) throw new HttpError(503, 'A conexão com o Google Drive ainda não foi configurada no servidor. Procure a administração geral.', 'drive_unconfigured');
  return { clientId: deps.env.clientId!, clientSecret: deps.env.clientSecret!, origin: deps.env.origin! };
}
function requireActor(actor: PortalActor | null): PortalActor {
  if (!actor) throw new HttpError(401, 'Entre no portal para conectar o Google Drive.', 'unauthenticated');
  return actor;
}
const fetcherOf = (deps: DriveDeps) => deps.fetcher ?? fetch;

/** Mostra a conta da própria pessoa; e-mail parcialmente oculto para quem olhar por cima do ombro. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return 'conta Google';
  return `${name.slice(0, Math.min(3, Math.max(1, name.length - 1)))}…@${domain}`;
}

export type ConnectionView = { status: 'unconfigured' | 'not_connected' | 'connected' | 'revoked'; account: string | null; connectedAt: string | null; lastUsedAt: string | null; revokedAt: string | null };
/** E-mail completo da própria conta, só para o seletor do Google abrir na conta certa (nunca para outra pessoa). */
export async function ownLoginHint(db: D1Database, actor: PortalActor): Promise<string | null> {
  const row = await one(db, "SELECT google_email FROM google_drive_connections WHERE user_id=? AND status='active'", [actor.userId]);
  return row ? String(row.google_email) : null;
}
export async function connectionView(db: D1Database, actor: PortalActor, deps: DriveDeps): Promise<ConnectionView> {
  if (!driveConfigured(deps)) return { status: 'unconfigured', account: null, connectedAt: null, lastUsedAt: null, revokedAt: null };
  const row = await one(db, 'SELECT google_email,status,connected_at,last_used_at,revoked_at FROM google_drive_connections WHERE user_id=?', [actor.userId]);
  if (!row) return { status: 'not_connected', account: null, connectedAt: null, lastUsedAt: null, revokedAt: null };
  return { status: row.status === 'active' ? 'connected' : 'revoked', account: maskEmail(String(row.google_email)), connectedAt: row.connected_at, lastUsedAt: row.last_used_at ?? null, revokedAt: row.revoked_at ?? null };
}

/** Início do OAuth: estado e verificador PKCE só no cookie cifrado; a URL leva apenas o desafio. */
export async function startConnection(db: D1Database, actor: PortalActor | null, deps: DriveDeps, returnTo = DEFAULT_RETURN) {
  const current = requireActor(actor), client = requireConfigured(deps);
  await requireLiveAccount(db, current.userId);
  await driveKeyId(deps.keys, deps.authSecret);
  const now = deps.now ?? Date.now(), state = randomToken(24), verifier = randomToken(48);
  const cookie = await sealOAuthState({ userId: current.userId, state, verifier, expiresAt: now + 10 * 60000, returnTo: RETURN_PATHS.has(returnTo) ? returnTo : '/' }, deps.keys.current!);
  const url = authorizationUrl({ clientId: client.clientId, redirectUri: client.origin + CALLBACK_PATH, state, challenge: await pkceChallenge(verifier) });
  return { url, cookie, maxAge: 600 };
}

/** Volta do Google: mesma pessoa, mesmo navegador (cookie), estado igual, escopo do Drive concedido. */
export async function completeConnection(db: D1Database, actor: PortalActor | null, deps: DriveDeps, input: { code: string | null; state: string | null; error: string | null; cookie: string | undefined }) {
  const current = requireActor(actor), client = requireConfigured(deps), fetcher = fetcherOf(deps);
  const saved = await openOAuthState(input.cookie, deps.keys.current!, deps.now);
  if (!saved || !input.state || saved.state !== input.state) throw new HttpError(400, 'A conexão expirou ou foi aberta em outra aba. Comece de novo pelo botão Conectar.', 'drive_oauth_state');
  if (saved.userId !== current.userId) throw new HttpError(403, 'A conexão foi iniciada por outra pessoa neste navegador. Comece de novo.', 'drive_oauth_state');
  if (input.error) throw new HttpError(400, input.error === 'access_denied' ? 'Você não autorizou o acesso. Nada foi conectado.' : 'O Google interrompeu a conexão. Tente de novo.', 'drive_oauth_denied');
  if (!input.code || input.code.length > 2000) throw new HttpError(400, 'O Google não devolveu o código de conexão. Tente de novo.', 'drive_oauth_code');
  const tokens = await exchangeCode(fetcher, client, { code: input.code, verifier: saved.verifier, redirectUri: client.origin + CALLBACK_PATH });
  if (!tokens.scopes.includes(DRIVE_SCOPE)) {
    for (const token of [tokens.refreshToken, tokens.accessToken]) if (token) await revokeToken(fetcher, token);
    throw new HttpError(400, 'A permissão do Google Drive ficou desmarcada. Conecte de novo e marque "Ver, editar, criar e excluir apenas os arquivos do Google Drive que você usa com este app".', 'drive_oauth_scope');
  }
  if (!tokens.refreshToken || !tokens.accessToken) throw new HttpError(502, 'O Google não devolveu uma autorização duradoura. Tente conectar de novo.', 'drive_oauth_token');
  const identity = await userInfo(fetcher, tokens.accessToken);
  const sealed = await sealRefreshToken(tokens.refreshToken, { userId: current.userId, googleSub: identity.sub }, deps.keys, deps.authSecret);
  const previous = await one(db, 'SELECT google_sub,token_ciphertext FROM google_drive_connections WHERE user_id=?', [current.userId]);
  const now = iso();
  await accountBatch(db, current.userId, [
    db.prepare(`INSERT INTO google_drive_connections(user_id,google_sub,google_email,scopes,token_ciphertext,key_id,status,connected_at,updated_at,last_used_at,revoked_at,version)
      VALUES(?,?,?,?,?,?,'active',?,?,NULL,NULL,1)
      ON CONFLICT(user_id) DO UPDATE SET google_sub=excluded.google_sub,google_email=excluded.google_email,scopes=excluded.scopes,token_ciphertext=excluded.token_ciphertext,key_id=excluded.key_id,status='active',connected_at=excluded.connected_at,updated_at=excluded.updated_at,last_used_at=NULL,revoked_at=NULL,version=google_drive_connections.version+1`)
      .bind(current.userId, identity.sub, identity.email, tokens.scopes.join(' ').slice(0, 1000), sealed.ciphertext, sealed.keyId, now, now),
    // Confirmações de pasta valem para a conta Google que as fez; outra conta precisa confirmar de novo.
    db.prepare('DELETE FROM google_drive_folder_grants WHERE user_id=? AND google_sub!=?').bind(current.userId, identity.sub),
  ]);
  // Trocou de conta Google: a autorização antiga deixa de ser usada, então é revogada (melhor esforço).
  if (previous?.token_ciphertext && previous.google_sub !== identity.sub) {
    try { await revokeToken(fetcher, await openRefreshToken(previous.token_ciphertext, { userId: current.userId, googleSub: previous.google_sub }, deps.keys, deps.authSecret)); } catch { /* já ilegível */ }
  }
  await writeAudit(db, current, 'google_drive.connect', current.userId, null, { accountChanged: !!previous && previous.google_sub !== identity.sub });
  return { returnTo: saved.returnTo };
}

/** Desconectar apaga o token do portal; com `revoke`, também tira a autorização do portal na conta Google. */
export async function disconnect(db: D1Database, actor: PortalActor | null, deps: DriveDeps, revoke: boolean) {
  const current = requireActor(actor), fetcher = fetcherOf(deps);
  const row = await one(db, 'SELECT google_sub,token_ciphertext FROM google_drive_connections WHERE user_id=?', [current.userId]);
  if (!row) return { status: 'not_connected' as const, revokedAtGoogle: false };
  let revokedAtGoogle: 'revoked' | 'already_invalid' | 'unreachable' | 'skipped' = 'skipped';
  if (revoke && row.token_ciphertext) {
    let token: string | null = null;
    try { token = await openRefreshToken(row.token_ciphertext, { userId: current.userId, googleSub: row.google_sub }, deps.keys, deps.authSecret); } catch { revokedAtGoogle = 'already_invalid'; }
    if (token) revokedAtGoogle = await revokeToken(fetcher, token);
    if (revokedAtGoogle === 'unreachable') throw new HttpError(502, 'O Google não respondeu e a autorização não foi revogada. Nada foi apagado; tente de novo ou use só "Desconectar deste portal".', 'drive_revoke_unreachable');
  }
  await accountBatch(db, current.userId, [
    db.prepare('DELETE FROM google_drive_folder_grants WHERE user_id=?').bind(current.userId),
    db.prepare('DELETE FROM google_drive_connections WHERE user_id=?').bind(current.userId),
  ]);
  await writeAudit(db, current, revoke ? 'google_drive.revoke' : 'google_drive.disconnect', current.userId, null, { revokedAtGoogle });
  return { status: 'not_connected' as const, revokedAtGoogle: revokedAtGoogle === 'revoked' || revokedAtGoogle === 'already_invalid' };
}

/**
 * Token de acesso curto para a própria pessoa, só no servidor. Se o Google recusar a autorização
 * (revogada em myaccount.google.com, senha trocada, inatividade), apaga o envelope e marca como revogada.
 */
export async function accessTokenFor(db: D1Database, userId: string, deps: DriveDeps): Promise<{ accessToken: string; googleSub: string }> {
  const client = requireConfigured(deps);
  const row = await one(db, 'SELECT google_sub,token_ciphertext,status FROM google_drive_connections WHERE user_id=?', [userId]);
  if (!row) throw new HttpError(409, 'Conecte sua conta Google em Conta › Google Drive antes de enviar.', 'drive_connect_required');
  if (row.status !== 'active' || !row.token_ciphertext) throw reconnectRequired();
  const owner = { userId, googleSub: String(row.google_sub) };
  const refresh = await openRefreshToken(row.token_ciphertext, owner, deps.keys, deps.authSecret);
  try {
    const accessToken = await refreshAccessToken(fetcherOf(deps), client, refresh);
    await db.prepare('UPDATE google_drive_connections SET last_used_at=? WHERE user_id=?').bind(iso(), userId).run();
    return { accessToken, googleSub: owner.googleSub };
  } catch (error) {
    if (error instanceof HttpError && error.code === 'drive_reconnect_required') await markRevoked(db, userId, String(row.token_ciphertext));
    throw error;
  }
}
/** Só a autorização que o Google recusou: se a pessoa reconectou no meio do caminho, a conexão nova fica. */
async function markRevoked(db: D1Database, userId: string, ciphertext: string) {
  const now = iso();
  await db.batch([
    db.prepare("DELETE FROM google_drive_folder_grants WHERE user_id=? AND EXISTS(SELECT 1 FROM google_drive_connections WHERE user_id=? AND token_ciphertext=?)").bind(userId, userId, ciphertext),
    db.prepare("UPDATE google_drive_connections SET status='revoked',token_ciphertext=NULL,key_id=NULL,revoked_at=?,updated_at=?,version=version+1 WHERE user_id=? AND token_ciphertext=?").bind(now, now, userId, ciphertext),
  ]);
}
