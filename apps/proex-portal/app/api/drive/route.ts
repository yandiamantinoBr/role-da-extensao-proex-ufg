import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { HttpError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { connectionView, disconnect, driveConfigured, ownLoginHint } from '@/lib/google-drive/connection';
import { confirmFolder, usableFolders } from '@/lib/google-drive/folders';
import { driveDeps, driveError, privateResponse, requireAction } from '@/lib/google-drive/route-support';
export const dynamic = 'force-dynamic';

/** Estado da conexão da própria pessoa, as pastas que ela pode usar e os dados públicos do seletor do Google. */
export async function GET() {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser());
    if (!actor) throw new HttpError(401, 'Entre no portal para ver o Google Drive.', 'unauthenticated');
    const deps = driveDeps(), configured = driveConfigured(deps);
    const canManageFolders = (actor.organizations ?? []).some(organization => organization.canManage && organization.status === 'active');
    return privateResponse(Response.json({
      configured, connection: await connectionView(db, actor, deps),
      picker: configured && deps.env.pickerApiKey && deps.env.appId ? { clientId: deps.env.clientId, apiKey: deps.env.pickerApiKey, appId: deps.env.appId, loginHint: await ownLoginHint(db, actor) } : null,
      folders: configured ? await usableFolders(db, actor) : [], canManageFolders,
    }));
  } catch (error) { return privateResponse(driveError(error)); }
}

export async function POST(request: Request) {
  try {
    requireAction(request);
    const input = await boundedJson(request, 4000), db = database(), actor = await getActor(db, await getPortalUser()), deps = driveDeps();
    if (input.action === 'disconnect') return privateResponse(Response.json(await disconnect(db, actor, deps, input.revoke === true)));
    if (input.action === 'confirm-folder') return privateResponse(Response.json(await confirmFolder(db, actor, input, deps)));
    throw new HttpError(400, 'Ação desconhecida.', 'invalid_input');
  } catch (error) { return privateResponse(driveError(error)); }
}
