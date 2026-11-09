import { getActor } from '../../../../../lib/access';
import { publicError } from '../../../../../lib/errors';
import { movementDetail } from '../../../../../lib/material-movements';
import { database } from '../../../../../lib/platform';
import { getPortalUser } from '../../../../../lib/session';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let response: Response;
  try { const db = database(), actor = await getActor(db, await getPortalUser()), { id } = await context.params; response = Response.json(await movementDetail(db, actor, id)); }
  catch (error) { response = publicError(error); }
  response.headers.set('Cache-Control', 'private, no-store'); response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
