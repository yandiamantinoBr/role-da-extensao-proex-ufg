import { getActor } from '@/lib/access';
import { effortProbeStatus, runEffortProbe } from '@/lib/assistant/effort-probe';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { assistantCredentialKeys, database, inviteSecret } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

async function context() {
  const db = database(), actor = await getActor(db, await getPortalUser());
  if (!actor) throw new HttpError(401, 'Entre para testar os modelos.', 'unauthenticated');
  const secret = inviteSecret();
  if (!secret) throw new HttpError(503, 'A segurança do assistente está indisponível.', 'assistant_unavailable');
  return { db, actor, secret, keys: assistantCredentialKeys() };
}

function failed(error: unknown) {
  const response = publicError(error);
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export async function GET(request: Request) {
  try {
    const { db, actor, secret, keys } = await context();
    const status = await effortProbeStatus(db, actor, new URL(request.url).searchParams.get('organizationId'), secret, { keys });
    return Response.json(status, { headers });
  } catch (error) { return failed(error); }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin ||
        request.headers.get('X-Proex-Action') !== '1' ||
        !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
      throw new HttpError(403, 'Atualize o Portal antes de testar.', 'invalid_origin');
    }
    const { db, actor, secret, keys } = await context();
    const input = await boundedJson(request, 1024);
    const status = await runEffortProbe(db, actor, input, secret, { keys, signal: request.signal });
    return Response.json(status, { headers });
  } catch (error) { return failed(error); }
}
