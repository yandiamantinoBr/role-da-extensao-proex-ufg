import { getActor } from '@/lib/access';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { convocationAction, convocationDetail, listConvocations } from '@/lib/convocations/service';
import { convocationInbox, CHANNEL_STATUS } from '@/lib/convocations/notices';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
const failure = (error: unknown) => { const response = publicError(error); for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response; };
/** ?id= panel of one convocation; ?view=inbox bell items; otherwise the list. */
export async function GET(request: Request): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), params = new URL(request.url).searchParams;
    if (params.get('view') === 'inbox') return respond(await convocationInbox(db, actor));
    if (params.get('id')) return respond(await convocationDetail(db, actor, params.get('id')));
    return respond({ ...await listConvocations(db, actor), channels: CHANNEL_STATUS });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1') throw new HttpError(403, 'Atualize a página e tente de novo.', 'invalid_origin');
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(415, 'Envie JSON.', 'invalid_content_type');
    const db = database(), actor = await getActor(db, await getPortalUser());
    if (!actor) throw new HttpError(401, 'Entre para gerenciar convocações.', 'unauthenticated');
    const input = await boundedJson(request, 32000), action = typeof input.action === 'string' ? input.action : '';
    const result = await convocationAction(db, actor, action, input);
    if (result === null) throw new HttpError(400, 'Ação não reconhecida.', 'invalid_action');
    return respond(result);
  } catch (error) { return failure(error); }
}
