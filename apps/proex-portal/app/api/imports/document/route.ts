import { getActor } from '@/lib/access';
import { database, inviteSecret } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { HttpError, publicError } from '@/lib/errors';
import { authorizeImportTarget, previewImport } from '@/lib/importer/service';
import { boundedImportForm, extractImportFile } from '@/lib/importer/documents';

export const dynamic = 'force-dynamic';
export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1') throw new HttpError(403, 'Atualize a página antes de importar.', 'invalid_origin');
    const db = database(), actor = await getActor(db, await getPortalUser()), secret = inviteSecret();
    if (!actor) throw new HttpError(401, 'Entre para importar um documento.', 'unauthenticated');
    if (!secret) throw new HttpError(503, 'A importação está indisponível até a configuração do portal ser concluída.', 'import_unavailable');
    const form = await boundedImportForm(request), kind = form.get('kind'), projectId = String(form.get('projectId') ?? '') || null, itemId = String(form.get('itemId') ?? '') || null;
    if (kind !== 'project' && kind !== 'asset') throw new HttpError(400, 'Escolha projeto ou bem patrimonial.', 'import_kind');
    await authorizeImportTarget(db, actor, kind, projectId, itemId, String(form.get('organizationId') ?? '') || null);
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Selecione um arquivo para preparar a prévia.', 'import_file_form');
    const extractedText = form.get('extractedText'), pageCount = Number(form.get('pageCount'));
    const extracted = await extractImportFile(file.name, new Uint8Array(await file.arrayBuffer()), typeof extractedText === 'string' ? { text: extractedText, pageCount } : undefined);
    const preview = await previewImport(db, actor, { kind, projectId, itemId, organizationId: String(form.get('organizationId') ?? ''), sourceMode: 'document', sourceUrl: String(form.get('sourceUrl') ?? ''), content: extracted.content, format: extracted.format }, secret, undefined, extracted.provenance);
    // Warnings are presentation-only; provenance is already bound to reviewToken.
    for (const candidate of preview.candidates) candidate.warnings.push(...extracted.warnings);
    return Response.json(preview, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return publicError(error); }
}
