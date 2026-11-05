import { getActor } from '@/lib/access';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { publicError, HttpError } from '@/lib/errors';
import { teamsWorkspace } from '@/lib/follow-up/teams';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
 let response: Response;
 try {
  const query = new URL(request.url).searchParams;
  const view = query.get('view') ?? 'workspace';
  if (view !== 'workspace' && view !== 'export') throw new HttpError(400, 'Escolha uma consulta válida.', 'team_view');
  const db = database(), actor = await getActor(db, await getPortalUser());
  response = Response.json(await teamsWorkspace(db, actor, { projectId: query.get('projectId') ?? undefined, organizationId: query.get('organizationId') ?? undefined, teamId: query.get('teamId') ?? undefined, status: query.get('status') ?? undefined, offset: query.has('offset') ? Number(query.get('offset')) : undefined }, view === 'export'));
 } catch (error) { response = publicError(error); }
 response.headers.set('Cache-Control', 'private, no-store');
 response.headers.set('X-Content-Type-Options', 'nosniff');
 return response;
}
