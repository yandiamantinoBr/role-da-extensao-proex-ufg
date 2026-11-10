import { getActor } from '@/lib/access';
import { aiPeopleUsage } from '@/lib/assistant/usage-people';
import { HttpError, publicError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

/** GET ?organizationId=&from=&to= · administração geral vê todas as pessoas; os demais, só o próprio uso. */
export async function GET(request: Request): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser());
    if (!actor) throw new HttpError(401, 'Entre para ver o uso de IA.', 'unauthenticated');
    const params = new URL(request.url).searchParams;
    return Response.json(await aiPeopleUsage(db, actor, { organizationId: params.get('organizationId'), from: params.get('from'), to: params.get('to') }), { headers });
  } catch (error) {
    const response = publicError(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
