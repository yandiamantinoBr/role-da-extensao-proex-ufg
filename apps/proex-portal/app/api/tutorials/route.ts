import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { publicError } from '@/lib/errors';
import { database, privateResponse, requireAction } from '@/lib/community/route-support';
import { tutorialAction, tutorialWorkspace } from '@/lib/tutorials/service';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const db = database(), url = new URL(request.url);
    return privateResponse(Response.json(await tutorialWorkspace(db, await getActor(db, await getPortalUser()), { projectId: url.searchParams.get('projectId') ?? '' })));
  } catch (error) { return privateResponse(publicError(error)); }
}
export async function POST(request: Request) {
  try {
    requireAction(request);
    const input = await boundedJson(request, 2000), db = database();
    return privateResponse(Response.json(await tutorialAction(db, await getActor(db, await getPortalUser()), input)));
  } catch (error) { return privateResponse(publicError(error)); }
}
