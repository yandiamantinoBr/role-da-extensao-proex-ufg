import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { publicError } from '@/lib/errors';
import { database, privateResponse, requireAction } from '@/lib/community/route-support';
import { chatAction, chatMessages, chatOverview } from '@/lib/community/chat';
import { chatMediaStore } from '@/lib/community/media-store';
export const dynamic = 'force-dynamic';
/** GET without conversationId: list of conversations. With conversationId (and optional after): messages. Never writes. */
export async function GET(request: Request) {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), params = new URL(request.url).searchParams;
    return privateResponse(Response.json(params.has('conversationId') ? await chatMessages(db, actor, params.get('conversationId'), params.get('after')) : await chatOverview(db, actor)));
  } catch (error) { return privateResponse(publicError(error)); }
}
export async function POST(request: Request) {
  try { requireAction(request); const input = await boundedJson(request, 12000), db = database(); return privateResponse(Response.json(await chatAction(db, await getActor(db, await getPortalUser()), input, chatMediaStore()))); }
  catch (error) { return privateResponse(publicError(error)); }
}
