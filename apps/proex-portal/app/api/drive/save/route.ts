import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { HttpError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { MAX_UPLOAD_BODY_BYTES, UPLOAD_LIMIT_MESSAGE } from '@/lib/upload-limits';
import { driveSaveApply, driveSaveOptions, driveSavePrepare } from '@/lib/google-drive/save';
import { driveDeps, driveError, privateResponse, requireAction } from '@/lib/google-drive/route-support';
export const dynamic = 'force-dynamic';

/** Lê o formulário com teto, mesmo quando o corpo chega em pedaços. */
async function boundedForm(request: Request): Promise<FormData> {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_UPLOAD_BODY_BYTES)) throw new HttpError(413, UPLOAD_LIMIT_MESSAGE, 'file_too_large');
  if (!request.body) throw new HttpError(400, 'Escolha um arquivo.', 'missing_file');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BODY_BYTES) { await reader.cancel(); throw new HttpError(413, UPLOAD_LIMIT_MESSAGE, 'file_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return await new Response(body, { headers: { 'Content-Type': request.headers.get('Content-Type')! } }).formData(); }
  catch { throw new HttpError(400, 'Não foi possível ler o arquivo enviado.', 'invalid_form'); }
}

/**
 * options | prepare | apply. A tela e o Rolê usam a mesma rota (campo `via`).
 * O apply de um arquivo novo (foto mandada no chat do Rolê) chega em multipart com `planToken` e `file`.
 */
export async function POST(request: Request) {
  try {
    const multipart = /^multipart\/form-data\s*;/i.test(request.headers.get('Content-Type') ?? '');
    requireAction(request, multipart ? 'form' : 'json');
    const db = database(), actor = await getActor(db, await getPortalUser());
    if (multipart) {
      const form = await boundedForm(request), file = form.get('file');
      if (form.get('action') !== 'apply' || !(file instanceof File)) throw new HttpError(400, 'Envie o arquivo junto com a confirmação.', 'missing_file');
      const result = await driveSaveApply(db, actor, { planToken: form.get('planToken') }, driveDeps({ storage: true }), new Uint8Array(await file.arrayBuffer()));
      return privateResponse(Response.json(result));
    }
    const input = await boundedJson(request, 8000);
    if (input.action === 'options') return privateResponse(Response.json(await driveSaveOptions(db, actor, input, driveDeps())));
    if (input.action === 'prepare') return privateResponse(Response.json(await driveSavePrepare(db, actor, input, driveDeps())));
    if (input.action === 'apply') return privateResponse(Response.json(await driveSaveApply(db, actor, input, driveDeps({ storage: true }))));
    throw new HttpError(400, 'Ação desconhecida.', 'invalid_input');
  } catch (error) { return privateResponse(driveError(error)); }
}
