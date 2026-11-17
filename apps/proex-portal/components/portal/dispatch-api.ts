/** Cliente do painel de Despachos (demandas privadas). O servidor filtra tudo; aqui só se confere o formato. */
export type DispatchKind = 'signature' | 'question' | 'decision' | 'document_review' | 'referral' | 'agenda';
export type DispatchUrgency = 'immediate' | 'high' | 'medium' | 'low';
export type DispatchStatus = 'open' | 'in_progress' | 'blocked' | 'completed';
export type DispatchTask = {
  id: string; title: string; status: DispatchStatus; dueAt: string | null; version: number; updatedAt: string; isAuthor: boolean;
  visibility: 'participants' | 'leadership'; kind: DispatchKind; documentKind: string | null; holderUserId: string | null; holderName: string | null;
  documentRef: string; urgency: DispatchUrgency; onAgenda: boolean;
};
export type DispatchPerson = { userId: string; name: string; inLeadership: boolean };
export type DispatchWorkspace = {
  organizationId: string; withUserId: string | null; group: boolean; inLeadership: boolean; today: string;
  counts: { open: number; needsCounterpart: number; dueSoon: number; overdue: number };
  people: DispatchPerson[]; tasks: DispatchTask[];
};
export type DispatchDetail = {
  task: { id: string; title: string; body: string; status: DispatchStatus; due_at: string | null; version: number; privacy: string | null; isAuthor: boolean;
    participants: { userId: string; name: string }[];
    dispatch: { kind: DispatchKind; documentKind: string | null; holderUserId: string | null; documentRef: string; urgency: DispatchUrgency; onAgenda: boolean } | null };
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function message(data: unknown, fallback: string) {
  if (!object(data)) return fallback;
  const error = data.error;
  return typeof error === 'string' ? error : object(error) && typeof error.message === 'string' ? error.message : fallback;
}
function workspaceShape(value: unknown): value is DispatchWorkspace {
  return object(value) && typeof value.organizationId === 'string' && object(value.counts) && Array.isArray(value.tasks) && Array.isArray(value.people)
    && value.tasks.every(task => object(task) && typeof task.id === 'string' && typeof task.title === 'string' && typeof task.version === 'number');
}
export async function loadDispatchWorkspace(query: { organizationId: string; withUserId?: string; group?: boolean }, signal?: AbortSignal): Promise<DispatchWorkspace> {
  const params = new URLSearchParams({ view: 'dispatch', organizationId: query.organizationId });
  if (query.group) params.set('group', '1'); else if (query.withUserId) params.set('withUserId', query.withUserId);
  const response = await fetch(`/api/follow-up?${params}`, { credentials: 'same-origin', cache: 'no-store', signal });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(message(data, 'Não foi possível carregar os despachos. Atualize e tente novamente.'));
  if (!workspaceShape(data)) throw new Error('A resposta chegou incompleta. Atualize e tente novamente.');
  return data;
}
export async function loadDispatchDetail(taskId: string, signal?: AbortSignal): Promise<DispatchDetail> {
  const response = await fetch(`/api/follow-up?${new URLSearchParams({ view: 'detail', id: taskId })}`, { credentials: 'same-origin', cache: 'no-store', signal });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(message(data, 'Esta demanda não está mais disponível para você.'));
  if (!object(data) || !object(data.task) || typeof data.task.id !== 'string') throw new Error('A resposta chegou incompleta. Atualize e tente novamente.');
  return data as unknown as DispatchDetail;
}
export async function saveDispatch(body: Record<string, unknown>): Promise<{ taskId: string }> {
  const response = await fetch('/api/follow-up', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(message(data, 'Não foi possível salvar. Seus campos foram preservados; tente de novo.'));
  if (!object(data) || (typeof data.taskId !== 'string' && typeof data.organizationId !== 'string')) throw new Error('A confirmação chegou incompleta. Atualize para conferir.');
  return data as { taskId: string };
}
