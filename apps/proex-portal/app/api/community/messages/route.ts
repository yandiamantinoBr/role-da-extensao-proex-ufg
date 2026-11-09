import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { publicError } from '@/lib/errors';
import { database, privateResponse, requireAction } from '@/lib/community/route-support';
import { messageAction, messageList, messagePeople } from '@/lib/community/messages';
import { messageEmailPreference, messageEmailState } from '@/lib/community/message-email';
import { HttpError } from '@/lib/errors';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser());
    if (new URL(request.url).searchParams.get('view') === 'people') return privateResponse(Response.json(await messagePeople(db, actor)));
    const list = await messageList(db, actor);
    return privateResponse(Response.json({ ...list, email: await messageEmailState(db, actor!.userId) }));
  } catch (error) { return privateResponse(publicError(error)); }
}
export async function POST(request: Request) {
  try {
    requireAction(request); const input = await boundedJson(request, 8000), db = database(), actor = await getActor(db, await getPortalUser());
    if (input.action === 'email') {
      if (!actor) throw new HttpError(401, 'Entre para continuar.', 'unauthenticated');
      if (Object.keys(input).some(key => !['action', 'enabled'].includes(key)) || typeof input.enabled !== 'boolean') throw new HttpError(400, 'Escolha se quer receber o aviso por e-mail.', 'invalid_input');
      await messageList(db, actor); // same admission as the list (active internal member)
      return privateResponse(Response.json(await messageEmailPreference(db, actor.userId, input.enabled)));
    }
    return privateResponse(Response.json(await messageAction(db, actor, input)));
  }
  catch (error) { return privateResponse(publicError(error)); }
}
