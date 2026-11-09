import { getPortalUser } from '@/lib/session';
import { getActor, projectAuthoritySql } from '@/lib/access';
import { database, all } from '@/lib/community/route-support';
import { publicError } from '@/lib/errors';
import { canManageFeedback } from '@/lib/feedback';
import { canReadOmbuds } from '@/lib/community/ombuds';
import { requireActor, requireInternalMember } from '@/lib/community/shared';
export const dynamic = 'force-dynamic';
/** What the Community module may show to this person: management boxes and the events they can give feedback on. */
export async function GET() {
  try {
    // No session refresh: opening the Community tab must not write anything about the account (ombuds lives here).
    const db = database(), actor = requireActor(await getActor(db, await getPortalUser({ refresh: false })));
    await requireInternalMember(db, actor);
    const read = projectAuthoritySql(actor, [], 'c.project_id');
    const events = await all(db, `SELECT c.id,c.name,c.project_id projectId,p.name projectName,c.starts_at startsAt FROM campaigns c JOIN projects p ON p.id=c.project_id
      WHERE ${read.sql} ORDER BY c.starts_at DESC,c.id LIMIT 200`, read.values);
    const response = Response.json({ manageFeedback: canManageFeedback(actor), ombuds: await canReadOmbuds(db, actor), events });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) { const response = publicError(error); response.headers.set('Cache-Control', 'private, no-store'); return response; }
}
