import { getActor } from '../../../lib/access';
import { HttpError, publicError } from '../../../lib/errors';
import { boundedJson } from '../../../lib/http';
import { bucket, database } from '../../../lib/platform';
import { createRecord, listRecords, readRecordForm, requireRecordMutation, uploadRecordAttachment } from '../../../lib/records';
import { getPortalUser } from '../../../lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function privateResponse(response: Response): Response {
  Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}
export async function GET(request: Request): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), url = new URL(request.url);
    return privateResponse(Response.json(await listRecords(db, actor, { projectId: url.searchParams.get('projectId'), from: url.searchParams.get('from'), to: url.searchParams.get('to'), limit: url.searchParams.get('limit') })));
  } catch (error) { return privateResponse(publicError(error)); }
}
export async function POST(request: Request): Promise<Response> {
  try {
    const multipart = /^multipart\/form-data\s*;/i.test(request.headers.get('Content-Type') ?? '');
    requireRecordMutation(request, multipart ? 'form' : 'json');
    const db = database(), actor = await getActor(db, await getPortalUser());
    if (!actor) throw new HttpError(401, 'Entre para enviar um registro.', 'unauthenticated');
    if (multipart) return privateResponse(Response.json({ ok: true, ...await uploadRecordAttachment(db, bucket(), actor, await readRecordForm(request)) }, { status: 201 }));
    const input = await boundedJson(request, 16000);
    if (input.action !== 'create') throw new HttpError(400, 'Ação de registro inválida.', 'invalid_action');
    return privateResponse(Response.json({ ok: true, ...await createRecord(db, actor, input) }, { status: 201 }));
  } catch (error) { return privateResponse(publicError(error)); }
}
