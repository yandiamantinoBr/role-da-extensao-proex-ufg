import { structureExportReport } from '@/components/portal/institutional-structure-export';
import { toDocx, toXlsx, type ExportRow } from '@/components/portal/report-export';
import { toPdf } from '@/components/portal/report-pdf';
import { getActor } from '@/lib/access';
import { HttpError, publicError } from '@/lib/errors';
import { structureWorkspace } from '@/lib/institutional-structure/service';
import { structureDigest, structureFingerprint } from '@/lib/institutional-structure/snapshot';
import { pdfAssets } from '@/lib/pdf-assets';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const fields = ['organizationId', 'projectId', 'includeArchived', 'format'];
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const format = query.get('format'), archived = query.get('includeArchived') ?? 'false';
    if ([...query.keys()].some(key => !fields.includes(key) || query.getAll(key).length !== 1)
      || (format !== 'xlsx' && format !== 'docx' && format !== 'pdf')
      || (archived !== 'true' && archived !== 'false')) {
      throw new HttpError(400, 'Escolha um recorte e um formato válidos.', 'structure_export_query');
    }

    const db = database();
    const includeArchived = archived === 'true';
    const scope = { organizationId: query.get('organizationId'), projectId: query.get('projectId'), includeArchived };
    const read = async () => {
      request.signal.throwIfAborted();
      const user = await getPortalUser({ refresh: false });
      if (!user) throw new HttpError(401, 'Entre para baixar a estrutura institucional.', 'unauthenticated');
      if (request.headers.get('X-Proex-Viewer') !== user.userId) {
        throw new HttpError(403, 'A conta ativa mudou. Atualize a página antes de baixar.', 'structure_context');
      }
      return structureWorkspace(db, await getActor(db, user), scope);
    };

    const initial = await read();
    if (!initial.nodes.length) throw new HttpError(409, 'Nenhuma unidade para exportar neste recorte.', 'structure_export_empty');
    const fingerprint = structureFingerprint(initial);
    const report = structureExportReport(initial, includeArchived);
    const { title, columns, rows, info, presentation } = report;
    const display = (row: ExportRow, key: string) => row[key] ?? '';
    const artifact = format === 'pdf'
      ? await toPdf(title, columns, rows, display, info, { ...await pdfAssets(request), presentation })
      : format === 'docx' ? toDocx(title, columns, rows, display, info) : toXlsx(title, columns, rows, display, info);
    const snapshot = await structureDigest(fingerprint);
    const current = await read();
    request.signal.throwIfAborted();
    if (structureFingerprint(current) !== fingerprint) {
      throw new HttpError(409, 'A estrutura ou seus acessos mudaram. Atualize o recorte e tente novamente.', 'structure_export_changed');
    }
    return new Response(artifact, { headers: {
      ...privateHeaders,
      'Content-Type': artifact.type,
      'Content-Disposition': `attachment; filename="proex-estrutura-institucional.${format}"`,
      'X-Proex-Structure-Snapshot': snapshot,
    } });
  } catch (error) {
    const response = publicError(error);
    for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  }
}
