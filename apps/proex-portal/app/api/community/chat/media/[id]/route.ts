import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { publicError } from '@/lib/errors';
import { database, privateResponse } from '@/lib/community/route-support';
import { chatMedia } from '@/lib/community/chat';
import { chatMediaStore } from '@/lib/community/media-store';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const db = database(), { id } = await context.params;
    const { data, mime } = await chatMedia(db, await getActor(db, await getPortalUser()), id, chatMediaStore());
    const response = new Response(new Uint8Array(data), { headers: { 'Content-Type': mime, 'Content-Length': String(data.byteLength), 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' } });
    response.headers.set('Cache-Control', 'private, max-age=60');
    return response;
  } catch (error) { return privateResponse(publicError(error)); }
}
