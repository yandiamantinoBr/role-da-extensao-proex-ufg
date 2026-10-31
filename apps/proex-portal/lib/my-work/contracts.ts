import type { Task } from '../follow-up/contracts';

export const WORK_AREAS = ['projects', 'materials', 'loans', 'campaigns'] as const;
export type WorkArea = typeof WORK_AREAS[number];
export type OperationalArea = WorkArea | 'general';
export type AssignmentVia = 'direct' | 'team' | 'both';
export type AssignmentFilter = 'all' | 'direct' | 'team';
export type MyWorkStatus = 'pending' | 'all' | 'completed';
export type WorkAssignee = { user_id: string | null; team_id: string | null; name: string };
export type WorkTarget = { kind: OperationalArea; id: string | null; name: string | null; canOpen: boolean; href: string | null };
export type TaskCounts = { total: number; pending: number; attention: number; overdue: number; dueToday: number; inProgress: number; blocked: number; completed: number; cancelled: number };
export type MyWorkTask = Task & { assignmentVia: AssignmentVia; area: OperationalArea; href: string; target: WorkTarget };
export type Responsibility = {
 id: string; organization_id: string; project_id: string; organization_name: string; project_name: string;
 area: WorkArea; item_id: string | null; loan_id: string | null; campaign_id: string | null;
 status: 'active' | 'revoked'; version: number; created_at: string; updated_at: string;
 assignees: WorkAssignee[]; assignmentVia: AssignmentVia | null; canEdit: boolean; target: WorkTarget;
};
export type WorkPage<T> = { items: T[]; total: number; hasMore: boolean; nextOffset: number | null };
export type MyWorkResponse = {
 version: 1; asOf: string; today: string; timeZone: 'America/Sao_Paulo';
 scope: { organizationId: string | null; projectId: string | null; assignment: AssignmentFilter; status: MyWorkStatus };
 /** Status and pagination affect lists only; these counts cover the full assigned population. */
 totalsScope: 'organization-project-assignment';
 totals: { tasks: TaskCounts; responsibilities: { total: number } };
 areas: { area: OperationalArea; taskCounts: TaskCounts; responsibilityCount: number }[];
 tasks: WorkPage<MyWorkTask>; responsibilities: WorkPage<Responsibility>;
};
export type ResponsibilityCatalog = {
 projects: { id: string; name: string; organization_id: string; canManage: boolean }[];
 people: { userId: string; name: string }[]; teams: { id: string; name: string }[];
 items: { id: string; name: string }[]; loans: { id: string; name: string }[]; campaigns: { id: string; name: string }[];
 canManage: boolean;
};
export type ResponsibilityListResponse = WorkPage<Responsibility>;
export type ResponsibilityResult = { responsibility: Responsibility; duplicate?: boolean };
export type ResponsibilitySave = {
 action: 'responsibility.save'; projectId: string; area: WorkArea; itemId?: string | null; loanId?: string | null; campaignId?: string | null;
 expectedVersion: number; userIds: string[]; teamIds: string[]; operationKey: string;
};
export type ResponsibilityRevoke = { action: 'responsibility.revoke'; id: string; expectedVersion: number; operationKey: string };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const internal = (value: unknown) => typeof value === 'string' && value.startsWith('/?') && !value.includes('\\') && !/[\r\n]/.test(value);
const area = (value: unknown) => typeof value === 'string' && [...WORK_AREAS, 'general'].includes(value as OperationalArea);
const counts = (value: unknown) => object(value) && ['total', 'pending', 'attention', 'overdue', 'dueToday', 'inProgress', 'blocked', 'completed', 'cancelled'].every(key => count(value[key]));
const target = (value: unknown) => object(value) && area(value.kind) && (value.id === null || typeof value.id === 'string') && (value.name === null || typeof value.name === 'string') && typeof value.canOpen === 'boolean' && (value.href === null || internal(value.href)) && (!value.canOpen || internal(value.href));
const via = (value: unknown) => ['direct', 'team', 'both'].includes(String(value));
const assignees = (value: unknown) => Array.isArray(value) && value.every(row => object(row) && typeof row.name === 'string' && (row.user_id === null || typeof row.user_id === 'string') && (row.team_id === null || typeof row.team_id === 'string') && (row.user_id === null) !== (row.team_id === null));
export function isResponsibility(value: unknown): value is Responsibility {
 return object(value) && typeof value.id === 'string' && typeof value.project_id === 'string' && typeof value.organization_id === 'string' && typeof value.project_name === 'string' && typeof value.organization_name === 'string' && WORK_AREAS.includes(value.area as WorkArea) && ['active', 'revoked'].includes(String(value.status)) && count(value.version) && Number(value.version) > 0 && typeof value.created_at === 'string' && typeof value.updated_at === 'string' && assignees(value.assignees) && (value.assignmentVia === null || via(value.assignmentVia)) && typeof value.canEdit === 'boolean' && target(value.target) && ['item_id', 'loan_id', 'campaign_id'].every(key => value[key] === null || typeof value[key] === 'string');
}
export function isMyWorkResponse(value: unknown): value is MyWorkResponse {
 if (!object(value) || value.version !== 1 || value.timeZone !== 'America/Sao_Paulo' || typeof value.asOf !== 'string' || typeof value.today !== 'string' || value.totalsScope !== 'organization-project-assignment' || !object(value.scope) || !['all', 'direct', 'team'].includes(String(value.scope.assignment)) || !['pending', 'all', 'completed'].includes(String(value.scope.status)) || !object(value.totals) || !counts(value.totals.tasks) || !object(value.totals.responsibilities) || !count(value.totals.responsibilities.total)) return false;
 if (!['organizationId', 'projectId'].every(key => value.scope && object(value.scope) && (value.scope[key] === null || typeof value.scope[key] === 'string'))) return false;
 if (!Array.isArray(value.areas) || !value.areas.every(row => object(row) && area(row.area) && counts(row.taskCounts) && count(row.responsibilityCount))) return false;
 const page = (input: unknown, validate: (row: unknown) => boolean) => object(input) && count(input.total) && typeof input.hasMore === 'boolean' && (input.nextOffset === null || count(input.nextOffset)) && Array.isArray(input.items) && input.items.length <= 50 && input.items.every(validate);
 return page(value.responsibilities, isResponsibility) && page(value.tasks, row => object(row) && typeof row.id === 'string' && typeof row.title === 'string' && typeof row.organization_id === 'string' && (row.project_id === null || typeof row.project_id === 'string') && typeof row.project_name === 'string' && typeof row.organization_name === 'string' && ['open', 'in_progress', 'blocked', 'completed', 'cancelled'].includes(String(row.status)) && ['high', 'medium', 'low'].includes(String(row.priority)) && (row.due_at === null || typeof row.due_at === 'string') && count(row.version) && typeof row.canEdit === 'boolean' && typeof row.canWork === 'boolean' && typeof row.canDelegateWork === 'boolean' && assignees(row.assignees) && via(row.assignmentVia) && area(row.area) && internal(row.href) && target(row.target));
}
export function isResponsibilityCatalog(value: unknown): value is ResponsibilityCatalog {
 const named = (input: unknown, user = false) => Array.isArray(input) && input.every(row => object(row) && typeof row[user ? 'userId' : 'id'] === 'string' && typeof row.name === 'string');
 return object(value) && typeof value.canManage === 'boolean' && Array.isArray(value.projects) && value.projects.every(row => object(row) && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.organization_id === 'string' && typeof row.canManage === 'boolean') && named(value.people, true) && named(value.teams) && named(value.items) && named(value.loans) && named(value.campaigns);
}
export function isResponsibilityList(value: unknown): value is ResponsibilityListResponse {return object(value) && count(value.total) && typeof value.hasMore === 'boolean' && (value.nextOffset === null || count(value.nextOffset)) && Array.isArray(value.items) && value.items.length <= 50 && value.items.every(isResponsibility);}
export function isResponsibilityResult(value: unknown): value is ResponsibilityResult {return object(value) && isResponsibility(value.responsibility) && (value.duplicate === undefined || typeof value.duplicate === 'boolean');}
