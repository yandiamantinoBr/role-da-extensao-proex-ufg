import { projectAuthoritySql, type PortalActor } from '../access';
import { authority } from '../follow-up/scope';
import type { WorkArea } from '../my-work/contracts';

export const responsibilityRead = (user: string, scope = 's') => authority(user, `${scope}.organization_id`, `${scope}.project_id`);
export const responsibilityManage = (user: string, scope = 's') => authority(user, `${scope}.organization_id`, `${scope}.project_id`, true, true);
export function responsibilityDirect(user: string, scope = 's') {return `EXISTS(SELECT 1 FROM work_responsibility_assignees a WHERE a.scope_id=${scope}.id AND a.revoked_at IS NULL AND a.user_id=${user})`;}
export function responsibilityTeam(user: string, scope = 's') {return `EXISTS(SELECT 1 FROM work_responsibility_assignees a JOIN followup_teams team ON team.id=a.team_id AND team.organization_id=${scope}.organization_id AND team.status='active' JOIN followup_team_members tm ON tm.team_id=team.id AND tm.removed_at IS NULL WHERE a.scope_id=${scope}.id AND a.revoked_at IS NULL AND tm.user_id=${user})`;}
export function taskDirect(user: string, task = 't') {return `EXISTS(SELECT 1 FROM followup_assignees a WHERE a.task_id=${task}.id AND a.removed_at IS NULL AND a.user_id=${user})`;}
export function taskTeam(user: string, task = 't') {return `EXISTS(SELECT 1 FROM followup_assignees a JOIN followup_teams team ON team.id=a.team_id AND team.organization_id=${task}.organization_id AND team.status='active' JOIN followup_team_members tm ON tm.team_id=team.id AND tm.removed_at IS NULL WHERE a.task_id=${task}.id AND a.removed_at IS NULL AND tm.user_id=${user})`;}
/** Only domain-authorized rows may reveal an entity label or a contextual link. */
export function targetAccess(actor: PortalActor, area: WorkArea, project: string) {return projectAuthoritySql(actor, area === 'materials' ? ['inventory.read'] : area === 'loans' ? ['loans.read'] : area === 'campaigns' ? ['campaigns.manage', 'participation.operate'] : [], project);}
export const assignmentVia = (direct: unknown, team: unknown) => direct && team ? 'both' as const : direct ? 'direct' as const : team ? 'team' as const : null;
