import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { HttpError, publicError } from '@/lib/errors';
import { database, privateResponse } from '@/lib/community/route-support';
import { CHAT_IMAGE_MAX_BYTES, chatUpload } from '@/lib/community/chat';
import { chatMediaStore } from '@/lib/community/media-store';
export const dynamic = 'force-dynamic';
const MAX_BODY = CHAT_IMAGE_MAX_BYTES + 64 * 1024;
/** Multipart upload of one already re-encoded image: fields conversationId and file. */
export async function POST(request: Request) {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1') throw new HttpError(403, 'Atualize a página e tente novamente.', 'invalid_origin');
    const length = request.headers.get('Content-Length');
    if (!length || !/^\d+$/.test(length) || Number(length) > MAX_BODY) throw new HttpError(413, 'A imagem passou do limite de 1,5 MB.', 'chat_image_size');
    // Read with a hard ceiling even if Content-Length lies, then parse the bounded bytes.
    const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, 'Escolha uma imagem.', 'missing_file');
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BODY) { await reader.cancel(); throw new HttpError(413, 'A imagem passou do limite de 1,5 MB.', 'chat_image_size'); } chunks.push(value); }
    const body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const form = await new Response(body, { headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' } }).formData();
    if ([...form.keys()].some(key => !['conversationId', 'file'].includes(key)) || form.getAll('file').length !== 1) throw new HttpError(400, 'Envie uma conversa e uma imagem.', 'invalid_form');
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'Escolha uma imagem.', 'missing_file');
    const db = database();
    return privateResponse(Response.json(await chatUpload(db, await getActor(db, await getPortalUser()), form.get('conversationId'), new Uint8Array(await file.arrayBuffer()), chatMediaStore()), { status: 201 }));
  } catch (error) { return privateResponse(publicError(error)); }
}
