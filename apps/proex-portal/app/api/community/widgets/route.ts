import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { publicError } from '@/lib/errors';
import { database, privateResponse, requireAction } from '@/lib/community/route-support';
import { widgetAction, widgetState } from '@/lib/community/widgets';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { const db = database(); return privateResponse(Response.json(await widgetState(db, await getActor(db, await getPortalUser())))); }
  catch (error) { return privateResponse(publicError(error)); }
}
export async function POST(request: Request) {
  try { requireAction(request); const input = await boundedJson(request, 8000), db = database(); return privateResponse(Response.json(await widgetAction(db, await getActor(db, await getPortalUser()), input))); }
  catch (error) { return privateResponse(publicError(error)); }
}
