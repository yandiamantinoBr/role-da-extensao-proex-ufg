import { getActor } from '@/lib/access';
import { publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { database } from '@/lib/platform';
import { listReportTemplates, projectReportData, reportTemplateAction } from '@/lib/project-report';
import { requireAction } from '@/lib/community/route-support';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
function privateResponse(response: Response) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

/** Dados do relatório do projeto (já filtrados pelas permissões) e modelos salvos. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), { id } = await context.params;
    const query = new URL(request.url).searchParams;
    if (query.get('view') === 'templates') return privateResponse(Response.json({ templates: await listReportTemplates(db, actor, id) }));
    const [data, templates] = await Promise.all([
      projectReportData(db, actor, id, { from: query.get('from') ?? undefined, to: query.get('to') ?? undefined }),
      listReportTemplates(db, actor, id),
    ]);
    return privateResponse(Response.json({ ...data, templates }));
  } catch (error) { return privateResponse(publicError(error)); }
}

/** Salvar ou apagar um modelo de relatório deste projeto. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    requireAction(request);
    const input = await boundedJson(request, 96000), db = database(), actor = await getActor(db, await getPortalUser()), { id } = await context.params;
    return privateResponse(Response.json(await reportTemplateAction(db, actor, id, input)));
  } catch (error) { return privateResponse(publicError(error)); }
}
