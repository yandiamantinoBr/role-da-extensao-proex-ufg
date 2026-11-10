import { getActor } from '@/lib/access';
import { assistantCredentialKeys, database, inviteSecret, speechEnvironment } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { matchOperationProjects, roleChat, roleStatus, roleSuggestionList } from '@/lib/assistant/role';
import { estimateAssistantPlan } from '@/lib/assistant/service';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function failed(error: unknown) { const response = publicError(error); for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response; }

export async function GET(request: Request): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), secret = inviteSecret();
    if (!actor) throw new HttpError(401, 'Entre para conversar com o Rolê.', 'unauthenticated');
    if (!secret) throw new HttpError(503, 'O Rolê precisa da configuração de segurança do portal.', 'assistant_unavailable');
    const params = new URL(request.url).searchParams;
    if (params.get('suggestions') === '1') return Response.json(await roleSuggestionList(db, actor, { projectId: params.get('projectId') }), { headers });
    const status = await roleStatus(db, actor, { projectId: params.get('projectId') }, secret, { keys: assistantCredentialKeys(), speech: speechEnvironment() });
    return Response.json(status, { headers });
  } catch (error) { return failed(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(403, 'Atualize o portal antes de usar o Rolê.', 'invalid_origin');
    const db = database(), actor = await getActor(db, await getPortalUser()), secret = inviteSecret();
    if (!actor) throw new HttpError(401, 'Entre para conversar com o Rolê.', 'unauthenticated');
    if (!secret) throw new HttpError(503, 'O Rolê precisa da configuração de segurança do portal.', 'assistant_unavailable');
    // A imagem reduzida no navegador cabe em 1,5 MB; base64 + conversa ficam abaixo de 2,2 MB.
    const input = await boundedJson(request, 2_200_000);
    if (input.action === 'chat') return Response.json(await roleChat(db, actor, input, secret, { keys: assistantCredentialKeys(), speech: speechEnvironment(), signal: request.signal }), { headers });
    if (input.action === 'match.operation') return Response.json(await matchOperationProjects(db, actor, String(input.request ?? '')), { headers });
    if (input.action === 'estimate.operation') {
      const { action: _action, ...rest } = input;
      void _action;
      return Response.json(await estimateAssistantPlan(db, actor, { projectId: rest.projectId, request: rest.request }, secret, { keys: assistantCredentialKeys() }), { headers });
    }
    throw new HttpError(400, 'Escolha uma ação válida do Rolê.', 'role_action');
  } catch (error) { return failed(error); }
}
