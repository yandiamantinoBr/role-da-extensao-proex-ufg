import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { publicError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { uploadHistory } from '@/lib/google-drive/save';
import { privateResponse } from '@/lib/google-drive/route-support';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try { const db = database(); return privateResponse(Response.json(await uploadHistory(db, await getActor(db, await getPortalUser()), new URL(request.url).searchParams.get('scope')))); }
  catch (error) { return privateResponse(publicError(error)); }
}
