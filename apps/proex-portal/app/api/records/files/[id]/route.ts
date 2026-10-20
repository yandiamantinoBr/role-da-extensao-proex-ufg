import { getActor } from '../../../../../lib/access';
import { HttpError, publicError } from '../../../../../lib/errors';
import { bucket, database } from '../../../../../lib/platform';
import { recordAttachment } from '../../../../../lib/records';
import { getPortalUser } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';
function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Content-Security-Policy', "sandbox; default-src 'none'");
  return response;
}
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), { id } = await context.params;
    const attachment = await recordAttachment(db, actor, id), object = await bucket().get(attachment.object_key);
    if (!object) throw new HttpError(404, 'Arquivo não encontrado.', 'attachment_not_found');
    // Re-check admission and the current membership after the storage read.
    await recordAttachment(db, await getActor(db, await getPortalUser()), id);
    const name = attachment.name.replace(/[\r\n\x00-\x1f\x7f"\\/]/g, '_').slice(0, 160) || 'anexo';
    const encoded = encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return privateResponse(new Response(object.body, { headers: {
      'Content-Type': attachment.mime, 'Content-Length': String(object.size),
      'Content-Disposition': `${attachment.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encoded}`,
    } }));
  } catch (error) { return privateResponse(publicError(error)); }
}
