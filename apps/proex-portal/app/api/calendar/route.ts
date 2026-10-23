import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { calendarAction, calendarEntries, calendarFeeds, calendarRange, serializeCalendar } from '@/lib/calendar';
import { database } from '@/lib/platform';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()), url = new URL(request.url);
    const range = calendarRange(url.searchParams.get('from'), url.searchParams.get('to'));
    const data = await calendarEntries(db, actor, { category: url.searchParams.get('category'), projectId: url.searchParams.get('projectId'), range });
    if (url.searchParams.get('format') === 'ics') {
      return new Response(serializeCalendar(data.entries), { headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="agenda-proex.ics"' } });
    }
    return Response.json({ ...data, feeds: await calendarFeeds(db, actor), range }, { headers });
  } catch (error) { const response = publicError(error); Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value)); return response; }
}
export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.headers.get('X-Proex-Action') !== '1' || request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.includes('application/json')) {
      throw new HttpError(403, 'Origem da solicitação inválida.', 'invalid_origin');
    }
    const input = await boundedJson(request, 4096), db = database(), actor = await getActor(db, await getPortalUser());
    return Response.json({ ok: true, ...await calendarAction(db, actor, input, url.origin) }, { headers });
  } catch (error) { const response = publicError(error); Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value)); return response; }
}
