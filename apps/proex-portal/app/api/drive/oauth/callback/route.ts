import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { HttpError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { completeConnection, OAUTH_COOKIE } from '@/lib/google-drive/connection';
import { cookie, driveDeps, privateResponse, readCookie } from '@/lib/google-drive/route-support';
export const dynamic = 'force-dynamic';

const RESULT_COOKIE = 'proex.gdrive.result';
/**
 * Volta do Google. O resultado vai num cookie curto e legível pela tela (só "connected" ou um código de erro),
 * nunca na URL; o cookie do estado é apagado em qualquer caso. Código, estado e tokens não são registrados.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  let result = 'connected', returnTo = '/?module=profile#google-drive';
  try {
    const db = database(), actor = await getActor(db, await getPortalUser());
    const done = await completeConnection(db, actor, driveDeps(), {
      code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error'), cookie: readCookie(request, OAUTH_COOKIE),
    });
    returnTo = done.returnTo;
  } catch (error) {
    result = error instanceof HttpError && /^[a-z_]{3,60}$/.test(error.code) ? error.code : 'drive_oauth_failed';
    if (!(error instanceof HttpError)) console.error('Google Drive callback failed:', error instanceof Error ? error.name : 'UnknownError');
  }
  const response = new Response(null, { status: 303, headers: { Location: new URL(returnTo, url.origin).toString() } });
  response.headers.append('Set-Cookie', cookie(OAUTH_COOKIE, '', { maxAge: 0, path: '/api/drive/oauth', httpOnly: true }));
  response.headers.append('Set-Cookie', cookie(RESULT_COOKIE, result, { maxAge: 120, path: '/', httpOnly: false }));
  return privateResponse(response);
}
