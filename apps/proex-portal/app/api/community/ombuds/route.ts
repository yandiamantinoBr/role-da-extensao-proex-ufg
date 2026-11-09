import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { publicError } from '@/lib/errors';
import { database, privateResponse, requireAction } from '@/lib/community/route-support';
import { ombudsInbox, ombudsManageAction, ombudsReporterAction } from '@/lib/community/ombuds';
export const dynamic = 'force-dynamic';
/*
 * Anonymous ombuds. The session is read WITHOUT refresh (nothing about the account is written by this
 * request) and only used to admit internal members. Nothing here logs input, codes or the actor.
 * GET is the ombuds inbox (platform owners). Reporter actions and the tracking code always go in a POST body.
 */
export async function GET() {
  try { const db = database(); return privateResponse(Response.json(await ombudsInbox(db, await getActor(db, await getPortalUser())))); }
  catch (error) { return privateResponse(publicError(error)); }
}
const REPORTER = new Set(['submit', 'track', 'reply']);
export async function POST(request: Request) {
  try {
    requireAction(request);
    const input = await boundedJson(request, 20000), db = database();
    if (REPORTER.has(String(input.action))) return privateResponse(Response.json(await ombudsReporterAction(db, await getActor(db, await getPortalUser({ refresh: false })), input)));
    return privateResponse(Response.json(await ombudsManageAction(db, await getActor(db, await getPortalUser()), input)));
  } catch (error) { return privateResponse(publicError(error)); }
}
