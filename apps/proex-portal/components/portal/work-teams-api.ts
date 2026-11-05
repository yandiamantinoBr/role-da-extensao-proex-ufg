import type { TeamsWorkspace } from '@/lib/follow-up/teams-contract';
import { TASK_PRIORITIES, TASK_STATES } from '@/lib/follow-up/contracts';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown, valid: (row: unknown) => boolean) => Array.isArray(value) && value.every(valid);
const person = (value: unknown) => object(value) && typeof value.userId === 'string' && typeof value.name === 'string';
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
export class TeamsApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export function isTeamsWorkspace(value: unknown): value is TeamsWorkspace {
 if (!object(value) || typeof value.viewerId !== 'string' || !object(value.scope)) return false;
 const scope = value.scope;
 return typeof scope.organizationId === 'string' && typeof scope.organizationName === 'string' && (scope.projectId === null || typeof scope.projectId === 'string') && typeof scope.projectName === 'string' && typeof scope.canManage === 'boolean'
 && list(value.teams, row => object(row) && typeof row.id === 'string' && typeof row.name === 'string' && ['active','archived'].includes(String(row.status)) && Number.isSafeInteger(row.version) && Number(row.version) > 0 && typeof row.isMine === 'boolean' && list(row.members, person) && object(row.counts) && [...TASK_STATES,'total','high','overdue'].every(key => count((row.counts as Record<string, unknown>)[key])))
 && list(value.people, person) && typeof value.teamsTruncated === 'boolean' && typeof value.selectedTeamId === 'string'
 && list(value.tasks, row => object(row) && typeof row.id === 'string' && typeof row.title === 'string' && TASK_STATES.includes(row.status as typeof TASK_STATES[number]) && TASK_PRIORITIES.includes(row.priority as typeof TASK_PRIORITIES[number]) && (row.due_at === null || typeof row.due_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.due_at)) && (row.project_id === null || typeof row.project_id === 'string') && typeof row.project_name === 'string' && typeof row.organization_name === 'string' && list(row.assignees, a => object(a) && a.user_id === null && typeof a.team_id === 'string' && typeof a.name === 'string'))
 && typeof value.hasMore === 'boolean' && (value.nextOffset === null || count(value.nextOffset)) && typeof value.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.today) && typeof value.asOf === 'string' && Number.isFinite(Date.parse(value.asOf));
}
export async function workTeamsApi(query: URLSearchParams, viewerId: string, signal?: AbortSignal): Promise<TeamsWorkspace> {
 const response = await fetch(`/api/work-teams?${query}`, { credentials: 'same-origin', cache: 'no-store', signal });
 let value: unknown;
 try { value = await response.json(); } catch { throw new TeamsApiError('A consulta chegou incompleta. Atualize e tente novamente.', response.status); }
 if (signal?.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
 if (!response.ok) throw new TeamsApiError(object(value) && typeof value.error === 'string' ? value.error : 'Seu acesso mudou ou não foi possível consultar as equipes.', response.status);
 if (!isTeamsWorkspace(value) || value.viewerId !== viewerId || value.scope.organizationId !== query.get('organizationId') || value.scope.projectId !== (query.get('projectId') || null) || query.has('teamId') && value.selectedTeamId !== query.get('teamId')) throw new TeamsApiError('A resposta não corresponde à sua consulta. Atualize o portal.', 403);
 return value;
}

/** Uses the existing team mutation service, keeping its CSRF, CAS and idempotency contract. */
export async function saveWorkTeam(input: Record<string, unknown>): Promise<{ teamId: string }> {
 const response = await fetch('/api/follow-up', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(input) });
 let value: unknown;
 try { value = await response.json(); } catch { throw new TeamsApiError('A confirmação chegou incompleta. Atualize antes de tentar novamente com os mesmos dados.', response.status); }
 if (!response.ok) throw new TeamsApiError(object(value) && typeof value.error === 'string' ? value.error : 'Não foi possível salvar a equipe.', response.status);
 if (!object(value) || typeof value.teamId !== 'string') throw new TeamsApiError('A confirmação não corresponde à equipe. Atualize para conferir.', 502);
 return { teamId: value.teamId };
}
