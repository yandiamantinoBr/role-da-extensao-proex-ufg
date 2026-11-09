import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { publicError } from '@/lib/errors';
import { database, privateResponse } from '@/lib/community/route-support';
import { communityStorageReport } from '@/lib/community/chat';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { const db = database(); return privateResponse(Response.json(await communityStorageReport(db, await getActor(db, await getPortalUser())))); }
  catch (error) { return privateResponse(publicError(error)); }
}
