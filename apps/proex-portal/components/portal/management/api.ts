// Chamadas da área de Gestão (GET com a sessão; POST de mesma origem).
function message(body: unknown, fallback: string): string {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message : null;
  const detail = value && typeof value === 'object' && 'message' in value ? (value as { message?: unknown }).message : value;
  return typeof detail === 'string' && detail ? detail : fallback;
}
export async function managementGet<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/management?${new URLSearchParams(params)}`, { credentials: 'same-origin', cache: 'no-store', signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(message(body, 'Não foi possível carregar os dados.'));
  return body as T;
}
export async function managementPost<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/management', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(message(body, 'Não foi possível salvar.'));
  return body as T;
}
export const brDate = (day: string | null | undefined) => day && /^\d{4}-\d{2}-\d{2}/.test(day) ? day.slice(0, 10).split('-').reverse().join('/') : '';
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(2, 4)}`;
