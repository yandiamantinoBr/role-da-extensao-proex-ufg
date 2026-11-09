import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { publicError } from '@/lib/errors';
import { database, privateResponse, requireAction } from '@/lib/community/route-support';
import { preferencesAction, preferencesFor } from '@/lib/preferences';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { const db = database(); return privateResponse(Response.json(await preferencesFor(db, await getActor(db, await getPortalUser())))); }
  catch (error) { return privateResponse(publicError(error)); }
}
export async function POST(request: Request) {
  try { requireAction(request); const input = await boundedJson(request, 4000), db = database(); return privateResponse(Response.json(await preferencesAction(db, await getActor(db, await getPortalUser()), input))); }
  catch (error) { return privateResponse(publicError(error)); }
}
