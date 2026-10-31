import { getActor } from '@/lib/access';
import { database, inviteSecret } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { applyImport, previewImport } from '@/lib/importer/service';

export const dynamic = 'force-dynamic';
export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1' || !request.headers.get('Content-Type')?.includes('application/json')) throw new HttpError(403, 'Atualize a página antes de importar.', 'invalid_origin');
    const input = await boundedJson(request, 384 * 1024), db = database(), actor = await getActor(db, await getPortalUser());
    if (!actor) throw new HttpError(401, 'Entre para importar um cadastro.', 'unauthenticated');
    const secret = inviteSecret();
    if (!secret) throw new HttpError(503, 'A importação está indisponível até a configuração do portal ser concluída.', 'import_unavailable');
    const result = input.action === 'preview' ? await previewImport(db, actor, input, secret) : input.action === 'apply' ? await applyImport(db, actor, input, secret) : null;
    if (!result) throw new HttpError(400, 'Escolha preparar prévia ou confirmar importação.', 'invalid_action');
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return publicError(error); }
}
