import { getActor } from '@/lib/access';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { database } from '@/lib/platform';
import { reportRows } from '@/lib/reports';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

async function read(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const isPost = request.method === 'POST';
    if (isPost && (request.headers.get('Origin') !== url.origin || request.headers.get('X-Proex-Action') !== '1'
      || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))) {
      throw new HttpError(403, 'Atualize a página e tente novamente.', 'invalid_origin');
    }
    const user = await getPortalUser({ refresh: false });
    if (!user) throw new HttpError(401, 'Entre com sua conta para consultar relatórios.', 'unauthenticated');
    const viewer = request.headers.get('X-Proex-Viewer');
    if ((isPost || viewer !== null) && viewer !== user.userId) {
      throw new HttpError(403, 'A conta ativa mudou. Atualize a página antes de consultar.', 'report_context');
    }
    const params = isPost ? await boundedJson(request, 4096) : Object.fromEntries(url.searchParams);
    const db = database();
    const actor = await getActor(db, user);
    const result = await reportRows(db, actor, params);
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    const response = publicError(error);
    for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
    return response;
  }
}

export const GET = read;
export const POST = read;
