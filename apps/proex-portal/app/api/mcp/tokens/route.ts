import { getActor } from '@/lib/access';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { listMcpTokens, manageMcpToken } from '@/lib/mcp/tokens';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const failed = (error: unknown) => { const response = publicError(error); for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response; };
export async function GET() {
  try { const db = database(); return Response.json(await listMcpTokens(db, await getActor(db, await getPortalUser())), { headers }); }
  catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(403, 'Atualize a plataforma antes de gerenciar a conexão.', 'invalid_origin');
    const input = await boundedJson(request, 8192), db = database();
    return Response.json(await manageMcpToken(db, await getActor(db, await getPortalUser()), input), { headers });
  } catch (error) { return failed(error); }
}
