import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { publicError } from '@/lib/errors';
import { database, privateResponse, requireAction } from '@/lib/community/route-support';
import { dockState, saveDock, widgetAction, widgetState } from '@/lib/community/widgets';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { const db = database(), actor = await getActor(db, await getPortalUser()); return privateResponse(Response.json(new URL(request.url).searchParams.get('view') === 'dock' ? await dockState(db, actor) : await widgetState(db, actor))); }
  catch (error) { return privateResponse(publicError(error)); }
}
export async function POST(request: Request) {
  try { requireAction(request); const input = await boundedJson(request, 8000), db = database(), actor = await getActor(db, await getPortalUser()); return privateResponse(Response.json(input.action === 'dock' ? await saveDock(db, actor, input) : await widgetAction(db, actor, input))); }
  catch (error) { return privateResponse(publicError(error)); }
}
