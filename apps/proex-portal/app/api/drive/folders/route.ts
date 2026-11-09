import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { database } from '@/lib/platform';
import { folderAction, folderAdminView } from '@/lib/google-drive/folders';
import { driveDeps, driveError, privateResponse, requireAction } from '@/lib/google-drive/route-support';
export const dynamic = 'force-dynamic';

/** Registro de pastas: só a administração da organização vê e altera. */
export async function GET() {
  try { const db = database(); return privateResponse(Response.json(await folderAdminView(db, await getActor(db, await getPortalUser())))); }
  catch (error) { return privateResponse(driveError(error)); }
}
export async function POST(request: Request) {
  try {
    requireAction(request);
    const input = await boundedJson(request, 6000), db = database();
    return privateResponse(Response.json(await folderAction(db, await getActor(db, await getPortalUser()), input, driveDeps())));
  } catch (error) { return privateResponse(driveError(error)); }
}
