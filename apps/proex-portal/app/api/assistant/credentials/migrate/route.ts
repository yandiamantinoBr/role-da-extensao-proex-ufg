import { getActor } from '@/lib/access';
import { migrateAssistantCredentials } from '@/lib/assistant/credential-migration';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { assistantCredentialKeys, database, inviteSecret } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1' ||
        !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
      throw new HttpError(403, 'Atualize o portal antes de migrar credenciais.', 'invalid_origin');
    }
    const db = database(), actor = await getActor(db, await getPortalUser()), authSecret = inviteSecret();
    if (!actor) throw new HttpError(401, 'Entre para acessar as credenciais.', 'unauthenticated');
    if (!authSecret) throw new HttpError(503, 'A configuração de segurança do portal está indisponível.', 'assistant_unavailable');
    const result = await migrateAssistantCredentials(db, actor, await boundedJson(request, 1024), authSecret, assistantCredentialKeys());
    return Response.json(result, { headers });
  } catch (error) {
    const response = publicError(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
