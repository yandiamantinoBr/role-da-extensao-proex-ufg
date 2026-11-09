import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { publicError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { OAUTH_COOKIE, startConnection } from '@/lib/google-drive/connection';
import { cookie, driveDeps, privateResponse, requireAction } from '@/lib/google-drive/route-support';
export const dynamic = 'force-dynamic';

/** Começa a conexão: devolve o endereço do Google; estado e PKCE ficam num cookie cifrado de 10 minutos. */
export async function POST(request: Request) {
  try {
    requireAction(request);
    const db = database(), actor = await getActor(db, await getPortalUser());
    const started = await startConnection(db, actor, driveDeps());
    const response = Response.json({ url: started.url });
    response.headers.append('Set-Cookie', cookie(OAUTH_COOKIE, started.cookie, { maxAge: started.maxAge, path: '/api/drive/oauth', httpOnly: true }));
    return privateResponse(response);
  } catch (error) { return privateResponse(publicError(error)); }
}
