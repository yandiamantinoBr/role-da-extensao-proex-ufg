import { getActor } from '@/lib/access';
import { instagramAction, OFFICIAL_SOURCES, readOfficialSnapshot } from '@/lib/assistant/official-sources';
import { HttpError, publicError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const fail = (error: unknown) => { const response = publicError(error); for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response; };

/** GET ?organizationId= : estado da cópia das páginas oficiais e publicações do Instagram cadastradas. */
export async function GET(request: Request): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser());
    if (!actor) throw new HttpError(401, 'Entre para ver as fontes do Rolê.', 'unauthenticated');
    const organizationId = new URL(request.url).searchParams.get('organizationId');
    const snapshot = await readOfficialSnapshot(db);
    const { posts } = await instagramAction(db, actor, { action: 'list', organizationId });
    return Response.json({ refreshedAt: snapshot.refreshedAt, pages: OFFICIAL_SOURCES.map(source => { const page = snapshot.pages.find(entry => entry.id === source.id); return { id: source.id, label: source.label, url: source.url, fetchedAt: page?.fetchedAt ?? null, ok: !!page?.fetchedAt && !page.error }; }), posts }, { headers });
  } catch (error) { return fail(error); }
}
/** POST { action: 'add' | 'remove', organizationId, ... } : publicações do Instagram (administração ou quem configura a IA). */
export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('X-Proex-Action') !== '1') throw new HttpError(403, 'Pedido sem confirmação de origem.', 'csrf');
    const db = database(), actor = await getActor(db, await getPortalUser());
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || typeof input !== 'object' || !['add', 'remove'].includes(String(input.action))) throw new HttpError(400, 'Ação inválida.', 'instagram_action');
    return Response.json(await instagramAction(db, actor, input), { headers });
  } catch (error) { return fail(error); }
}
