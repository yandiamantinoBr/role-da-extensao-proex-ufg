'use client';
/** Small JSON client for the Community routes: same-origin action header, readable errors, abortable reads. */
export class CommunityError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
export async function communityGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', signal });
  const result = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) throw new CommunityError(result.error || 'Não foi possível consultar. Tente novamente.', response.status, result.code);
  return result;
}
export async function communityPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) throw new CommunityError(result.error || 'Falha de conexão. Seu texto foi preservado.', response.status, result.code);
  return result;
}
/** Fired when unread recados or conversations may have changed, so the bell re-reads its Community pane. */
export const COMMUNITY_CHANGED = 'proex:community-changed';
export const errorText = (error: unknown, fallback = 'Falha de conexão. Tente novamente.') => error instanceof Error && error.message ? error.message : fallback;
/** Brazilian short date from a civil day (AAAA-MM-DD), without timezone drift. */
export const civilDay = (value: string | null | undefined) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '';
export const instantDay = (value: string | null | undefined) => { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(date) : ''; };
