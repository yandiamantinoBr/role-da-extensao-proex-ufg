import { accountAccess } from '@/lib/account-access';
import { HttpError, publicError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cache = { 'Cache-Control': 'private, no-store' };
  try {
    const user = await getPortalUser({ refresh: false });
    if (!user) throw new HttpError(401, 'Entre para consultar seus acessos.', 'unauthenticated');
    if (request.headers.get('X-Proex-Account') !== user.userId) {
      throw new HttpError(403, 'A conta desta aba mudou. Atualize a página.', 'account_changed');
    }
    return Response.json(await accountAccess(database(), user.userId), { headers: cache });
  } catch (error) {
    const response = publicError(error);
    response.headers.set('Cache-Control', cache['Cache-Control']);
    return response;
  }
}
