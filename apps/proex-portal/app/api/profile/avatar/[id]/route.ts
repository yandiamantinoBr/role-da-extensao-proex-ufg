import { getActor } from '../../../../../lib/access';
import { HttpError, publicError } from '../../../../../lib/errors';
import { bucket, database } from '../../../../../lib/platform';
import { getOwnAvatar } from '../../../../../lib/profile';
import { getPortalUser } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';
function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const user = await getPortalUser();
    if (!user) throw new HttpError(401, 'Entre para acessar sua foto.', 'unauthenticated');
    const db = database();
    await getActor(db, user);
    const { id } = await context.params;
    const avatar = await getOwnAvatar(db, user, id);
    const object = await bucket().get(avatar.key);
    if (!object) throw new HttpError(404, 'Foto não encontrada.', 'avatar_not_found');
    // Recheck account status after storage I/O, including a block during the download request.
    await getOwnAvatar(db, user, id);
    return privateResponse(new Response(object.body, {
      headers: {
        'Content-Type': 'image/png', 'Content-Length': String(object.size),
        'Content-Disposition': 'inline; filename="avatar.png"',
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    }));
  } catch (error) { return privateResponse(publicError(error)); }
}
