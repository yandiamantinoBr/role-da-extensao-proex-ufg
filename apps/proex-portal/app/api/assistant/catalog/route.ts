import { getActor } from '@/lib/access';
import { assistantCredentialKeys, database, inviteSecret } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { catalogView, manageCatalog } from '@/lib/assistant/model-catalog-store';
import { compareModels } from '@/lib/assistant/model-compare';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function failed(error: unknown) { const response = publicError(error); for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response; }

export async function GET(request: Request): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), secret = inviteSecret();
    if (!actor) throw new HttpError(401, 'Entre para ver o catálogo.', 'unauthenticated');
    if (!secret) throw new HttpError(503, 'A segurança do assistente está indisponível.', 'assistant_unavailable');
    return Response.json(await catalogView(db, actor, new URL(request.url).searchParams.get('organizationId'), secret, assistantCredentialKeys()), { headers });
  } catch (error) { return failed(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(403, 'Atualize o portal antes de salvar.', 'invalid_origin');
    const db = database(), actor = await getActor(db, await getPortalUser()), secret = inviteSecret();
    if (!actor) throw new HttpError(401, 'Entre para salvar.', 'unauthenticated');
    if (!secret) throw new HttpError(503, 'A segurança do assistente está indisponível.', 'assistant_unavailable');
    const input = await boundedJson(request, 16 * 1024);
    if (input.action === 'compare') return Response.json(await compareModels(db, actor, input, secret, assistantCredentialKeys(), { signal: request.signal }), { headers });
    return Response.json(await manageCatalog(db, actor, input, secret, assistantCredentialKeys()), { headers });
  } catch (error) { return failed(error); }
}
