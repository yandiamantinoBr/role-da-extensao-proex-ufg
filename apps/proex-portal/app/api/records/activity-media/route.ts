import { getActor } from '@/lib/access';
import { activityMediaFolder, activityMediaFolderUrl, saveActivityMediaFolder } from '@/lib/google-drive/activity-media';
import { privateResponse, driveError, requireAction } from '@/lib/google-drive/route-support';
import { boundedJson } from '@/lib/http';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser());
    const params = new URL(request.url).searchParams;
    const input = { projectId: params.get('projectId'), scheduleItemId: params.get('scheduleItemId') };
    if (params.get('view') === 'open') {
      const url = await activityMediaFolderUrl(db, actor, input);
      return privateResponse(new Response(null, { status: 302, headers: { Location: url } }));
    }
    return privateResponse(Response.json(await activityMediaFolder(db, actor, input)));
  } catch (error) {
    return privateResponse(driveError(error));
  }
}

export async function POST(request: Request) {
  try {
    requireAction(request);
    const input = await boundedJson(request, 6000);
    const db = database(), actor = await getActor(db, await getPortalUser());
    return privateResponse(Response.json(await saveActivityMediaFolder(db, actor, input)));
  } catch (error) {
    return privateResponse(driveError(error));
  }
}
