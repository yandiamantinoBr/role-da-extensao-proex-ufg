import { getChatGPTUser } from '../../../chatgpt-auth';
import { getActor, requireCapability } from '../../../../lib/access';
import { one } from '../../../../lib/database';
import { HttpError, publicError } from '../../../../lib/errors';
import { bucket, database, ownerEmail } from '../../../../lib/platform';

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export async function GET(
  _request: Request, context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const db = database();
    const user = await getChatGPTUser();
    let actor = await getActor(db, user, ownerEmail());
    requireCapability(actor, 'loans.read');
    const { id } = await context.params;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) {
      throw new HttpError(404, 'Anexo não encontrado.', 'document_not_found');
    }
    const document = await one(db, `SELECT d.* FROM documents d
      JOIN loans l ON l.id=d.loan_id AND l.project_id=d.project_id WHERE d.id=?`, [id]);
    if (!document) throw new HttpError(404, 'Anexo não encontrado.', 'document_not_found');
    requireCapability(actor, 'loans.read', document.project_id);
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(document.mime)) {
      throw new HttpError(415, 'Este tipo de anexo não está disponível.', 'unsupported_file');
    }
    const object = await bucket().get(document.object_key);
    if (!object) throw new HttpError(404, 'Arquivo não encontrado.', 'document_not_found');
    actor = await getActor(db, user, ownerEmail());
    requireCapability(actor, 'loans.read', document.project_id);
    const name = String(document.name).replace(/[\r\n\x00-\x1f\x7f"\\/]/g, '_').slice(0, 160) || 'anexo';
    const fallback = name.replace(/[^\x20-\x7e]/g, '_');
    const encoded = encodeURIComponent(name).replace(/['()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return privateResponse(new Response(object.body, {
      headers: {
        'Content-Type': document.mime,
        'Content-Length': String(object.size),
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    }));
  } catch (error) {
    return privateResponse(publicError(error));
  }
}
