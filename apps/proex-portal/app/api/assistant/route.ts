import { getActor } from '@/lib/access';
import { database, inviteSecret } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { applyAssistantPlan, assistantStatus, configureAssistant, manageAssistantGrant, prepareAssistantPlan } from '@/lib/assistant/service';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request): Promise<Response> {
 try { const secret = inviteSecret(); if (!secret) throw new HttpError(503, 'O assistente precisa da configuração de segurança do portal.', 'assistant_unavailable'); const db = database(); return Response.json(await assistantStatus(db, await getActor(db, await getPortalUser()), secret, new URL(request.url).searchParams.get('organizationId') ?? undefined), { headers }); }
 catch (error) { return publicError(error); }
}
export async function POST(request: Request): Promise<Response> {
 try {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1' || !request.headers.get('Content-Type')?.includes('application/json')) throw new HttpError(403, 'Atualize o portal antes de usar o assistente.', 'invalid_origin');
  const input = await boundedJson(request, 16 * 1024), db = database(), actor = await getActor(db, await getPortalUser()), secret = inviteSecret();
  if (!actor) throw new HttpError(401, 'Entre para usar o assistente.', 'unauthenticated');
  if (!secret) throw new HttpError(503, 'O assistente precisa da configuração de segurança do portal.', 'assistant_unavailable');
  const result = input.action === 'configure' ? await configureAssistant(db, actor, input, secret) : input.action === 'grant.create' || input.action === 'grant.revoke' ? await manageAssistantGrant(db,actor,input) : input.action === 'prepare' ? await prepareAssistantPlan(db, actor, input, secret) : input.action === 'apply' ? await applyAssistantPlan(db, actor, input, secret) : null;
  if (!result) throw new HttpError(400, 'Escolha uma operação válida do assistente.', 'assistant_action');
  return Response.json(result, { headers });
 } catch (error) { return publicError(error); }
}
