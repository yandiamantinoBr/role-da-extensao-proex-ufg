import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { database } from '@/lib/platform';
import { clientIp } from '@/lib/rate-limit';
import { convocationGuestAction } from '@/lib/convocations/guest';
export const dynamic = 'force-dynamic';
// Public guest endpoint: no portal session is read or created here. The guest's personal secret travels in the body only.
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1') throw new HttpError(403, 'Atualize a página e tente de novo.', 'invalid_origin');
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(415, 'Envie JSON.', 'invalid_content_type');
    const input = await boundedJson(request, 8000);
    return Response.json(await convocationGuestAction(database(), input, clientIp(request)), { headers });
  } catch (error) { const response = publicError(error); for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response; }
}
export async function GET(): Promise<Response> { return Response.json({ error: 'Use o link de convite.' }, { status: 405, headers }); }
