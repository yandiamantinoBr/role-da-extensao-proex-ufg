import { database } from '../platform';
import { all } from '../database';
import { HttpError } from '../errors';
export { database, all };
/** Same-origin JSON action, as in the other portal routes. */
export function requireAction(request: Request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1' || !request.headers.get('Content-Type')?.includes('application/json')) throw new HttpError(403, 'Atualize a página e tente novamente.', 'invalid_origin');
}
export function privateResponse(response: Response) { response.headers.set('Cache-Control', 'private, no-store'); return response; }
