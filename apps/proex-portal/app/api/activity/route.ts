import { getActor } from '../../../lib/access';
import { activityFeed } from '../../../lib/activity';
import { publicError } from '../../../lib/errors';
import { database } from '../../../lib/platform';
import { getPortalUser } from '../../../lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function privateResponse(response: Response): Response {
  Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}
export async function GET(request: Request): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), url = new URL(request.url);
    const input = Object.fromEntries(['from', 'to', 'projectId', 'types', 'person'].map(key => [key, url.searchParams.get(key)]));
    return privateResponse(Response.json(await activityFeed(db, actor, input)));
  } catch (error) { return privateResponse(publicError(error)); }
}
