import { getActor } from '@/lib/access';
import { assistantCredentialVault, manageAssistantCredential } from '@/lib/assistant/credential-vault';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { assistantCredentialKeys, database, inviteSecret, speechEnvironment } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

async function context() {
  const db = database(), actor = await getActor(db, await getPortalUser()), secret = inviteSecret();
  if (!actor) throw new HttpError(401, 'Entre para acessar as credenciais.', 'unauthenticated');
  if (!secret) throw new HttpError(503, 'A configuração de segurança do portal está indisponível.', 'assistant_unavailable');
  return { db, actor, secret, keys: assistantCredentialKeys(), speech: speechEnvironment() };
}

function failed(error: unknown) {
  const response = publicError(error);
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { db, actor, secret, keys, speech } = await context();
    return Response.json(await assistantCredentialVault(db, actor, new URL(request.url).searchParams.get('organizationId'), secret, keys, speech), { headers });
  } catch (error) { return failed(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1' ||
        !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
      throw new HttpError(403, 'Atualize o portal antes de salvar a credencial.', 'invalid_origin');
    }
    const { db, actor, secret, keys, speech } = await context();
    return Response.json(await manageAssistantCredential(db, actor, await boundedJson(request, 2048), secret, keys, speech), { headers });
  } catch (error) { return failed(error); }
}
