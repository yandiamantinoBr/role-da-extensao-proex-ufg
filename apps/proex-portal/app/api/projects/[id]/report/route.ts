import { getActor } from '@/lib/access';
import { HttpError, publicError } from '@/lib/errors';
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

async function reportViewer(request: Request) {
  const expected = request.headers.get('X-Proex-Viewer');
  if (expected === null) return getPortalUser();
  const user = await getPortalUser({ refresh: false });
  if (!user) throw new HttpError(401, 'Entre com sua conta para consultar o relatório.', 'unauthenticated');
  if (user.userId !== expected) {
    throw new HttpError(403, 'A conta ativa mudou. Atualize a página antes de continuar.', 'report_viewer_changed');
  }
  return user;
}

/** Dados do relatório do projeto (já filtrados pelas permissões) e modelos salvos. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const user = await reportViewer(request);
    const db = database(), actor = await getActor(db, user), { id } = await context.params;
    const query = new URL(request.url).searchParams;
    if (query.get('view') === 'templates') return privateResponse(Response.json({ templates: await listReportTemplates(db, actor, id) }));
    const [data, templates] = await Promise.all([
      projectReportData(db, actor, id, { from: query.get('from') ?? undefined, to: query.get('to') ?? undefined }),
      listReportTemplates(db, actor, id),
    ]);
    const response = privateResponse(Response.json({ ...data, templates }));
    if (request.headers.has('X-Proex-Viewer')) {
      request.signal.throwIfAborted();
      const verified = await reportViewer(request);
      if (verified) response.headers.set('X-Proex-Viewer', verified.userId);
    }
    return response;
  } catch (error) { return privateResponse(publicError(error)); }
}

/** Salvar ou apagar um modelo de relatório deste projeto. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    requireAction(request);
    const input = await boundedJson(request, 96000), db = database(), actor = await getActor(db, await reportViewer(request)), { id } = await context.params;
    return privateResponse(Response.json(await reportTemplateAction(db, actor, id, input)));
  } catch (error) { return privateResponse(publicError(error)); }
}
