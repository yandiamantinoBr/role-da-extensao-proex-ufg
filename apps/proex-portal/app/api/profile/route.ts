import { getActor } from '../../../lib/access';
import { HttpError, publicError } from '../../../lib/errors';
import { boundedJson } from '../../../lib/http';
import { bucket, database } from '../../../lib/platform';
import { getOwnProfile, readAvatarForm, replaceOwnAvatar, requireProfileMutation, updateOwnProfile } from '../../../lib/profile';
import { getPortalUser } from '../../../lib/session';

export const dynamic = 'force-dynamic';
function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
async function principal() {
  const user = await getPortalUser();
  if (!user) throw new HttpError(401, 'Entre para acessar seu perfil.', 'unauthenticated');
  const db = database();
  // Admission is handled by the canonical session resolver; no owner bootstrap runs here.
  await getActor(db, user);
  return { db, user };
}
export async function GET(): Promise<Response> {
  try {
    const { db, user } = await principal();
    return privateResponse(Response.json(await getOwnProfile(db, user, user.hasPassword)));
  } catch (error) { return privateResponse(publicError(error)); }
}
export async function PUT(request: Request): Promise<Response> {
  try {
    requireProfileMutation(request, 'json');
    const { db, user } = await principal();
    const input = await boundedJson(request, 4096);
    return privateResponse(Response.json(await updateOwnProfile(db, user, input, user.hasPassword)));
  } catch (error) { return privateResponse(publicError(error)); }
}
export async function POST(request: Request): Promise<Response> {
  try {
    requireProfileMutation(request, 'form');
    const { db, user } = await principal();
    const form = await readAvatarForm(request);
    return privateResponse(Response.json(await replaceOwnAvatar(db, bucket(), user, form.bytes, form.expectedVersion, user.hasPassword)));
  } catch (error) { return privateResponse(publicError(error)); }
}
