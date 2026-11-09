import { HttpError } from '../errors';

/*
 * Cliente mínimo do Google (OAuth 2.0 e Drive API v3). Toda chamada recebe `fetcher` para os testes.
 * Nada aqui registra corpo de resposta, token ou cabeçalho: os erros viram códigos e frases fixas.
 * Fontes conferidas em 2026-11-09: developers.google.com/identity/protocols/oauth2/web-server,
 * developers.google.com/workspace/drive/api/guides/api-specific-auth e .../reference/rest/v3/files/create.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const OAUTH_SCOPES = ['openid', 'email', DRIVE_SCOPE] as const;
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TIMEOUT_MS = 20000;
export type Fetcher = typeof fetch;
export type GoogleClient = { clientId: string; clientSecret: string };

const unreachable = () => new HttpError(502, 'O Google não respondeu agora. Tente de novo em alguns minutos.', 'drive_google_unavailable');
export const clientMisconfigured = () => new HttpError(503, 'A conexão do portal com o Google está mal configurada. Nada foi apagado; avise a administração geral.', 'drive_client_misconfigured');
export const reconnectRequired = () => new HttpError(409, 'O Google não aceita mais a autorização desta conta (ela foi revogada ou expirou). Conecte de novo em Conta › Google Drive.', 'drive_reconnect_required');

async function call(fetcher: Fetcher, url: string, init: RequestInit): Promise<Response> {
  try { return await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch { throw unreachable(); }
}
async function json(response: Response): Promise<Record<string, unknown>> {
  try { const value = await response.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  catch { return {}; }
}
const str = (value: unknown) => typeof value === 'string' ? value : '';

export function authorizationUrl(input: { clientId: string; redirectUri: string; state: string; challenge: string; loginHint?: string }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId, redirect_uri: input.redirectUri, response_type: 'code', scope: OAUTH_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false', state: input.state,
    code_challenge: input.challenge, code_challenge_method: 'S256', ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  }).toString();
  return url.toString();
}

export async function exchangeCode(fetcher: Fetcher, client: GoogleClient, input: { code: string; verifier: string; redirectUri: string }) {
  const response = await call(fetcher, TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
    grant_type: 'authorization_code', code: input.code, code_verifier: input.verifier, redirect_uri: input.redirectUri, client_id: client.clientId, client_secret: client.clientSecret,
  }) });
  const body = await json(response);
  if (!response.ok) throw new HttpError(400, 'O Google recusou a conexão. Tente conectar de novo.', 'drive_oauth_rejected');
  const scopes = str(body.scope).split(/\s+/).filter(Boolean);
  return { accessToken: str(body.access_token), refreshToken: str(body.refresh_token), scopes };
}

export async function userInfo(fetcher: Fetcher, accessToken: string): Promise<{ sub: string; email: string }> {
  const response = await call(fetcher, USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await json(response);
  const sub = str(body.sub), email = str(body.email).trim().toLowerCase();
  if (!response.ok || !/^[0-9]{5,64}$/.test(sub) || body.email_verified !== true || !/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) {
    throw new HttpError(400, 'Não foi possível confirmar a conta Google. Use uma conta com e-mail verificado.', 'drive_oauth_identity');
  }
  return { sub, email };
}

/** Pede um token de acesso de curta duração. `invalid_grant` = revogado na conta Google ou expirado. */
export async function refreshAccessToken(fetcher: Fetcher, client: GoogleClient, refreshToken: string): Promise<string> {
  const response = await call(fetcher, TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret,
  }) });
  const body = await json(response);
  if (response.ok && str(body.access_token)) {
    const scopes = str(body.scope).split(/\s+/);
    if (body.scope !== undefined && !scopes.includes(DRIVE_SCOPE)) throw reconnectRequired();
    return str(body.access_token);
  }
  // Só `invalid_grant` prova que a permissão da pessoa acabou. Cliente errado ou trocado (401, invalid_client,
  // unauthorized_client) é configuração do servidor: não pode apagar as conexões de todo mundo.
  if (response.status === 400 && body.error === 'invalid_grant') throw reconnectRequired();
  if (response.status === 401 || body.error === 'invalid_client' || body.error === 'unauthorized_client') throw clientMisconfigured();
  throw unreachable();
}

/** Revoga no Google. Token já inválido também conta como revogado (o Google responde 400). */
export async function revokeToken(fetcher: Fetcher, token: string): Promise<'revoked' | 'already_invalid' | 'unreachable'> {
  try {
    const response = await call(fetcher, REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
    return response.ok ? 'revoked' : response.status === 400 ? 'already_invalid' : 'unreachable';
  } catch { return 'unreachable'; }
}

export type DriveFolder = { id: string; name: string; sharedDriveId: string | null; canAddChildren: boolean; isPublic: boolean; sharingKnown: boolean; trashed: boolean };
function driveError(status: number, body: Record<string, unknown>): HttpError {
  const reason = str((((body.error as Record<string, unknown> | undefined)?.errors as Record<string, unknown>[] | undefined)?.[0])?.reason);
  if (status === 401) return reconnectRequired();
  if (status === 404) return new HttpError(409, 'Sua conta Google ainda não liberou esta pasta para o portal, ou você não tem acesso a ela. Confirme a pasta no seletor do Google.', 'drive_folder_confirm_required');
  if (status === 403 && /rateLimit|userRateLimitExceeded|quotaExceeded/i.test(reason)) return new HttpError(429, 'O Google pediu uma pausa. Tente de novo em alguns minutos.', 'drive_rate_limited');
  if (status === 403 && /storageQuotaExceeded/i.test(reason)) return new HttpError(409, 'O Drive de destino está sem espaço. Avise quem cuida da pasta.', 'drive_storage_full');
  if (status === 403) return new HttpError(403, 'Sua conta Google não tem permissão para gravar nesta pasta. Peça acesso de editor a quem cuida dela.', 'drive_permission_denied');
  if (status === 429) return new HttpError(429, 'O Google pediu uma pausa. Tente de novo em alguns minutos.', 'drive_rate_limited');
  return unreachable();
}

export async function getFolder(fetcher: Fetcher, accessToken: string, folderId: string): Promise<DriveFolder> {
  const url = new URL(`${FILES_URL}/${encodeURIComponent(folderId)}`);
  url.search = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id,name,mimeType,driveId,trashed,permissionIds,permissions(type,role),capabilities(canAddChildren)' }).toString();
  const response = await call(fetcher, url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await json(response);
  if (!response.ok) throw driveError(response.status, body);
  if (body.mimeType !== FOLDER_MIME) throw new HttpError(400, 'O item escolhido não é uma pasta. Escolha uma pasta no seletor.', 'drive_not_folder');
  // Aberta demais = "qualquer pessoa com o link" ou "todo o domínio". A lista completa nem sempre vem
  // (drives compartilhados mostram só os ids); sem nenhuma das duas, o compartilhamento é desconhecido.
  const permissions = Array.isArray(body.permissions) ? body.permissions as Record<string, unknown>[] : null;
  const ids = Array.isArray(body.permissionIds) ? body.permissionIds.map(String) : null;
  const isPublic = !!permissions?.some(item => item?.type === 'anyone' || item?.type === 'domain') || !!ids?.some(id => id === 'anyoneWithLink' || id === 'anyone');
  return {
    id: str(body.id), name: str(body.name).slice(0, 300) || 'Pasta sem nome', sharedDriveId: str(body.driveId) || null,
    canAddChildren: (body.capabilities as Record<string, unknown> | undefined)?.canAddChildren === true,
    isPublic, sharingKnown: permissions !== null || ids !== null, trashed: body.trashed === true,
  };
}

/** Envio em uma requisição (multipart): os anexos do portal têm no máximo 4 MB, abaixo do limite de 5 MB. */
export async function uploadFile(fetcher: Fetcher, accessToken: string, input: { folderId: string; name: string; mime: string; bytes: Uint8Array; description: string }) {
  const boundary = `proex-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: input.name, parents: [input.folderId], mimeType: input.mime, description: input.description });
  const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${input.mime}\r\n\r\n`);
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + input.bytes.length + tail.length);
  body.set(head, 0); body.set(input.bytes, head.length); body.set(tail, head.length + input.bytes.length);
  const url = `${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`;
  const response = await call(fetcher, url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  const result = await json(response);
  if (!response.ok) throw driveError(response.status, result);
  const id = str(result.id), link = str(result.webViewLink);
  if (!id) throw unreachable();
  return { id, name: str(result.name) || input.name, webViewLink: /^https:\/\/(drive|docs)\.google\.com\//.test(link) ? link : `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` };
}
