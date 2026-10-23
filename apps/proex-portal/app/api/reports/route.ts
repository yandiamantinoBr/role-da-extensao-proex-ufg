import { getActor } from '@/lib/access';
import { HttpError, publicError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { reportRows } from '@/lib/reports';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getPortalUser();
    if (!user) throw new HttpError(401, 'Entre com sua conta para consultar relatórios.', 'unauthenticated');
    const db = database();
    const actor = await getActor(db, user);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const result = await reportRows(db, actor, params);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return publicError(error);
  }
}
