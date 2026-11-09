import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { publicError } from '@/lib/errors';
import { database, privateResponse, requireAction } from '@/lib/community/route-support';
import { messageAction, messageList, messagePeople } from '@/lib/community/messages';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser());
    return privateResponse(Response.json(new URL(request.url).searchParams.get('view') === 'people' ? await messagePeople(db, actor) : await messageList(db, actor)));
  } catch (error) { return privateResponse(publicError(error)); }
}
export async function POST(request: Request) {
  try { requireAction(request); const input = await boundedJson(request, 8000), db = database(); return privateResponse(Response.json(await messageAction(db, await getActor(db, await getPortalUser()), input))); }
  catch (error) { return privateResponse(publicError(error)); }
}
