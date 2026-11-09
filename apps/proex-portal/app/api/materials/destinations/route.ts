import { getActor } from '../../../../lib/access';
import { publicError } from '../../../../lib/errors';
import { destinationPage, listDestinations } from '../../../../lib/material-destinations';
import { database } from '../../../../lib/platform';
import { getPortalUser } from '../../../../lib/session';
export const dynamic = 'force-dynamic';
/** ?projectId= lists the destinations of the project's organization; ?id= returns one destination page. */
export async function GET(request: Request): Promise<Response> {
  let response: Response;
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), params = new URL(request.url).searchParams;
    response = Response.json(params.get('id') ? await destinationPage(db, actor, params.get('id')) : await listDestinations(db, actor, params.get('projectId')));
  } catch (error) { response = publicError(error); }
  response.headers.set('Cache-Control', 'private, no-store'); response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
