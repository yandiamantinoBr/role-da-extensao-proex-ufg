import { getActor } from '@/lib/access';
import { aiSpending, aiSpendingDay } from '@/lib/assistant/spending';
import { HttpError, publicError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

function failed(error: unknown) {
  const response = publicError(error);
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

/** GET ?organizationId=&from=&to= (período) ou ?organizationId=&day= (chamadas de um dia). Somente administração geral. */
export async function GET(request: Request): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser());
    if (!actor) throw new HttpError(401, 'Entre para ver os gastos de IA.', 'unauthenticated');
    const params = new URL(request.url).searchParams, organizationId = params.get('organizationId'), day = params.get('day');
    if (day !== null) return Response.json(await aiSpendingDay(db, actor, { organizationId, day }), { headers });
    return Response.json(await aiSpending(db, actor, { organizationId, from: params.get('from'), to: params.get('to') }), { headers });
  } catch (error) { return failed(error); }
}
