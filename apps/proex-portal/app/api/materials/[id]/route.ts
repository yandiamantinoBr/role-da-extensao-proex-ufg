import { getActor } from '../../../../lib/access';
import { publicError } from '../../../../lib/errors';
import { materialDetail } from '../../../../lib/materials';
import { database } from '../../../../lib/platform';
import { getPortalUser } from '../../../../lib/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let response: Response;
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), { id } = await context.params, url = new URL(request.url);
    response = Response.json(await materialDetail(db, actor, id, { before: url.searchParams.get('before'), limit: url.searchParams.get('limit') ?? undefined }));
  } catch (error) { response = publicError(error); }
  response.headers.set('Cache-Control', 'private, no-store'); response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
