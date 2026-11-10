import { getActor } from '@/lib/access';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { database } from '@/lib/platform';
import { requireAction } from '@/lib/community/route-support';
import { getPortalUser } from '@/lib/session';
import { managementDashboard } from '@/lib/management/dashboard';
import { guideAction, guideHistory, guideWorkspace } from '@/lib/management/guide';
import { riskAction, risksWorkspace } from '@/lib/management/risks';
import { applyTeamTemplate, teamTemplatesState } from '@/lib/management/team-template-service';

export const dynamic = 'force-dynamic';
function privateResponse(response: Response) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

/** Gestão da organização: painel, guia, riscos e equipes-modelo. Sempre com a sessão de quem pede. */
export async function GET(request: Request): Promise<Response> {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const db = database(), actor = await getActor(db, await getPortalUser());
    const view = query.view;
    const result = view === 'dashboard' ? await managementDashboard(db, actor, query)
      : view === 'guide' ? await guideWorkspace(db, actor, query)
      : view === 'guide-history' ? await guideHistory(db, actor, query)
      : view === 'risks' ? await risksWorkspace(db, actor, query)
      : view === 'team-templates' ? await teamTemplatesState(db, actor, query)
      : null;
    if (!result) throw new HttpError(400, 'Escolha uma consulta válida.', 'invalid_view');
    return privateResponse(Response.json(result));
  } catch (error) { return privateResponse(publicError(error)); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireAction(request);
    const input = await boundedJson(request, 96000), db = database(), actor = await getActor(db, await getPortalUser());
    const action = typeof input.action === 'string' ? input.action : '';
    const [area, verb] = [action.split('.')[0], action.slice(action.indexOf('.') + 1)];
    const result = area === 'guide' ? await guideAction(db, actor, { ...input, action: verb })
      : area === 'risk' ? await riskAction(db, actor, { ...input, action: verb })
      : action === 'template.apply' ? await applyTeamTemplate(db, actor, input)
      : null;
    if (!result) throw new HttpError(400, 'Ação inválida.', 'invalid_action');
    return privateResponse(Response.json(result));
  } catch (error) { return privateResponse(publicError(error)); }
}
