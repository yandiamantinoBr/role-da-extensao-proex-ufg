import { publicError } from '../../../../../lib/errors';
import { bucket, database } from '../../../../../lib/platform';
import { consumeAttachmentTicket } from '../../../../../lib/sync/attachments';
export const dynamic = 'force-dynamic';
function privateResponse(response: Response) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Content-Security-Policy', "sandbox; default-src 'none'");
  return response;
}
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  try {
    const { token } = await context.params, attachment = await consumeAttachmentTicket(database(), bucket(), token);
    const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[attachment.mime] ?? 'bin';
    return privateResponse(new Response(new Uint8Array(attachment.bytes).buffer, { headers: {
      'Content-Type': attachment.mime, 'Content-Length': String(attachment.size),
      'Content-Disposition': `attachment; filename="${attachment.kind}-${attachment.id.replace(/[^A-Za-z0-9_-]/g, '_')}.${extension}"`,
      'X-Proex-Content-SHA256': attachment.contentHash,
    } }));
  } catch (error) { return privateResponse(publicError(error)); }
}
