import { HttpError, publicError } from '../errors';
import { assistantCredentialKeys, bucket, googleDriveEnvironment, inviteSecret } from '../platform';
import type { SaveDeps } from './save';

/** Dependências reais das rotas. Nenhum valor daqui vai para resposta ou log. */
export function driveDeps(options: { storage?: boolean } = {}): SaveDeps {
  const authSecret = inviteSecret();
  if (!authSecret) throw new HttpError(503, 'O portal ainda não está configurado.', 'drive_unconfigured');
  return { env: googleDriveEnvironment(), keys: assistantCredentialKeys(), authSecret, ...(options.storage ? { storage: bucket() } : {}) };
}
const HREFS: Record<string, string> = { drive_connect_required: '/?module=profile#google-drive', drive_reconnect_required: '/?module=profile#google-drive', drive_folder_confirm_required: '/?module=profile#google-drive' };
/** Erro público; nos que pedem ação da pessoa, inclui `href` (para o Rolê e a tela levarem até lá). */
export function driveError(error: unknown): Response {
  const response = publicError(error);
  if (!(error instanceof HttpError) || !HREFS[error.code]) return response;
  return Response.json({ error: error.message, code: error.code, href: HREFS[error.code] }, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
}
export function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
/** Mesma origem e cabeçalho próprio, como as outras ações do portal. */
export function requireAction(request: Request, type: 'json' | 'form' = 'json') {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1') throw new HttpError(403, 'Atualize a página e tente novamente.', 'invalid_origin');
  const contentType = request.headers.get('Content-Type') ?? '';
  if (type === 'json' ? !contentType.includes('application/json') : !/^multipart\/form-data\s*;/i.test(contentType)) throw new HttpError(415, 'Formato de envio inválido. Atualize a página.', 'invalid_content_type');
}
export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}
export function cookie(name: string, value: string, options: { maxAge: number; path: string; httpOnly: boolean }) {
  return `${name}=${value}; Path=${options.path}; Max-Age=${options.maxAge}; SameSite=Lax; Secure${options.httpOnly ? '; HttpOnly' : ''}`;
}
