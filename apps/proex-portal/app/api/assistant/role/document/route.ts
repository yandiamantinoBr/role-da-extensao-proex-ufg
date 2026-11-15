import { getActor } from '@/lib/access';
import { requireRoleDocumentAccess } from '@/lib/assistant/role';
import { previewRoleDocument } from '@/lib/assistant/role-documents';
import { HttpError, publicError } from '@/lib/errors';
import { boundedImportForm } from '@/lib/importer/documents';
import { assistantCredentialKeys, database, inviteSecret, speechEnvironment } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.headers.get('Origin') !== url.origin || request.headers.get('X-Proex-Action') !== '1') throw new HttpError(403, 'Atualize o Portal antes de enviar o documento.', 'invalid_origin');
    const db = database(), actor = await getActor(db, await getPortalUser()), secret = inviteSecret();
    if (!actor) throw new HttpError(401, 'Entre para anexar o documento.', 'unauthenticated');
    if (!secret) throw new HttpError(503, 'O Rolê está indisponível.', 'assistant_unavailable');
    const check = await requireRoleDocumentAccess(db, actor, url.searchParams.get('projectId'), secret, { keys: assistantCredentialKeys(), speech: speechEnvironment() });
    const form = await boundedImportForm(request), file = form.get('file');
    if (!(file instanceof File) || [...form.keys()].length !== 1) throw new HttpError(400, 'Envie um arquivo por vez.', 'role_document_file');
    const document = await previewRoleDocument(file);
    await check();
    return Response.json(document, { headers });
  } catch (error) {
    const response = publicError(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
