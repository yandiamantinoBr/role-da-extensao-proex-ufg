import { getActor } from '../../../lib/access';
import { HttpError, publicError } from '../../../lib/errors';
import { database } from '../../../lib/platform';
import { getPortalUser } from '../../../lib/session';
import { listOrganizationalUnits } from '../../../lib/units';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  let response: Response;
  try {
    const input = new URL(request.url).searchParams.get('includeArchived');
    if (input !== null && !['0','1'].includes(input)) throw new HttpError(400, 'Filtro de unidades inválido.', 'invalid_filter');
    const db = database(), actor = await getActor(db, await getPortalUser());
    response = Response.json({ organizationalUnits: await listOrganizationalUnits(db, actor, { includeArchived: input === '1' }) });
  } catch (error) { response = publicError(error); }
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
