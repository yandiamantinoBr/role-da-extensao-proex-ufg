import { calendarFeed, CALENDAR_LABELS, serializeCalendar } from '@/lib/calendar';
import { database } from '@/lib/platform';
import { publicError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
  try {
    const { token } = await context.params;
    const feed = await calendarFeed(database(), token);
    return new Response(serializeCalendar(feed.entries, `PROEX · ${CALENDAR_LABELS[feed.category]}`), { headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8' } });
  } catch (error) { const response = publicError(error); Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value)); return response; }
}
