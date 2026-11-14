import { getActor } from '@/lib/access';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { pdfAssets } from '@/lib/pdf-assets';
import { database } from '@/lib/platform';
import { projectBrandFor } from '@/lib/project-brand';
import { listReportTemplates, projectReportData, reportTemplateAction } from '@/lib/project-report';
import { normalizeReportConfig, periodRange, ReportConfigError } from '@/lib/project-report-config';
import { requireAction } from '@/lib/community/route-support';
import { getPortalUser } from '@/lib/session';
import { buildReportDocument } from '@/components/portal/project-report/document';
import { reportDocumentDigest } from '@/components/portal/project-report/fingerprint';
import { toReportPdf } from '@/components/portal/project-report/pdf';

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

async function exportPdf(request: Request, input: Record<string, unknown>, id: string) {
  if (!request.headers.get('X-Proex-Viewer')) throw new HttpError(400, 'Atualize a página antes de baixar o relatório.', 'report_viewer_required');
  const { digest, generatedAt } = input;
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || typeof generatedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt))) {
    throw new HttpError(400, 'Atualize a prévia antes de baixar o relatório.', 'report_preview_required');
  }
  const previewDate = new Date(generatedAt);
  const config = normalizeReportConfig(input.config);
  const period = periodRange(config.period);
  const db = database();
  async function read() {
    request.signal.throwIfAborted();
    const user = await reportViewer(request);
    if (!user) throw new HttpError(401, 'Entre com sua conta para baixar o relatório.', 'unauthenticated');
    const project = await projectReportData(db, await getActor(db, user), id, period ?? {});
    const doc = buildReportDocument(project, config, previewDate);
    if (await reportDocumentDigest(doc) !== digest) {
      throw new HttpError(409, 'Os dados ou seus acessos mudaram. Confira a prévia atualizada e baixe novamente.', 'report_preview_changed');
    }
    return { project: project.project, doc };
  }
  const { project, doc } = await read();
  if (!doc.sections.length) throw new HttpError(400, 'Marque ao menos uma seção antes de baixar.', 'report_empty');
  const brand = projectBrandFor(project.id, project.name, project.officialUrl);
  const { fontBytes, brandBytes } = await pdfAssets(request, brand);
  let pdf: Blob;
  try { pdf = await toReportPdf(doc, { fontBytes, marks: brandBytes }); }
  catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('O relatório passou de 400 páginas.')) {
      throw new HttpError(413, cause.message, 'report_pdf_too_large');
    }
    throw cause;
  }
  await read();
  request.signal.throwIfAborted();
  const user = await reportViewer(request);
  if (!user) throw new HttpError(401, 'Entre com sua conta para baixar o relatório.', 'unauthenticated');
  return privateResponse(new Response(pdf, { headers: {
    'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="relatorio-projeto.pdf"',
    'X-Proex-Viewer': user.userId, 'X-Proex-Report': digest,
  } }));
}

/** Baixar PDF ou salvar/apagar um modelo de relatório deste projeto. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    requireAction(request);
    const input = await boundedJson(request, 96000), { id } = await context.params;
    if (input.action === 'export.pdf') return await exportPdf(request, input, id);
    const db = database(), actor = await getActor(db, await reportViewer(request));
    return privateResponse(Response.json(await reportTemplateAction(db, actor, id, input)));
  } catch (error) {
    if (error instanceof ReportConfigError) return privateResponse(publicError(new HttpError(400, error.message, 'invalid_report_config')));
    return privateResponse(publicError(error));
  }
}
