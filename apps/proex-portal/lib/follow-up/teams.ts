import type { PortalActor } from '../access';
import { all, one } from '../database';
import { HttpError } from '../errors';
import { choices, id, integer, TASK_STATES } from './contracts';
import { activeAccount, actorRequired, authority, requireScope } from './scope';
import { serverWorkClock } from './time';
import { TEAM_TASK_PAGE_SIZE, type TeamsWorkspace } from './teams-contract';

/** Teams organize assignments. Every projection still requires live project/organization authority. */
export async function teamsWorkspace(db: D1Database, actor: PortalActor | null, input: Record<string, unknown> = {}, exporting = false): Promise<TeamsWorkspace> {
 actorRequired(actor);
 const projectId = id(input.projectId, true), requestedOrg = id(input.organizationId, true), requestedTeam = id(input.teamId, true);
 const offset = input.offset === undefined ? 0 : integer(input.offset, 50000);
 const status = input.status === undefined || input.status === '' ? '' : choices(input.status, TASK_STATES);
 const project = projectId ? await one(db, 'SELECT id,name,organization_id FROM projects WHERE id=?', [projectId]) : null;
 if (projectId && !project) throw new HttpError(404, 'Projeto não encontrado neste recorte.', 'team_scope_not_found');
 const organizationId = project?.organization_id ?? requestedOrg;
 if (!organizationId || requestedOrg && requestedOrg !== organizationId) throw new HttpError(400, 'Escolha a organização e um projeto correspondente.', 'team_scope_invalid');
 const scope = { organizationId, projectId };
 await requireScope(db, actor, scope);
 const organization = await one(db, 'SELECT name FROM organizations WHERE id=?', [organizationId]);
 const management = await one(db, `SELECT 1 allowed FROM (SELECT ? organization_id) scope WHERE ${authority('?', 'scope.organization_id', 'NULL', true)}`, [organizationId, actor.userId]);
 const canManage = Boolean(management), clock = serverWorkClock();
 const readVisibleTeams = () => all(db, `SELECT team.id,team.name,team.status,team.version,
 EXISTS(SELECT 1 FROM followup_team_members mine WHERE mine.team_id=team.id AND mine.user_id=caller.user_id AND mine.removed_at IS NULL) is_mine
 FROM followup_teams team JOIN(SELECT ? user_id,? project_id) caller
 WHERE team.organization_id=? AND (team.status='active' OR ?=1)
 AND ${authority('caller.user_id', 'team.organization_id', 'caller.project_id')}
 AND (?=1 OR EXISTS(SELECT 1 FROM followup_team_members mine WHERE mine.team_id=team.id AND mine.user_id=caller.user_id AND mine.removed_at IS NULL)
 OR EXISTS(SELECT 1 FROM followup_assignees a JOIN followup_tasks t ON t.id=a.task_id WHERE a.team_id=team.id AND a.removed_at IS NULL AND t.organization_id=team.organization_id
 AND (caller.project_id IS NULL OR t.project_id=caller.project_id) AND ${authority('caller.user_id', 't.organization_id', 't.project_id')}))
 ORDER BY is_mine DESC,team.name,team.id LIMIT 201`, [actor.userId, projectId, organizationId, canManage ? 1 : 0, canManage ? 1 : 0]);
 const rows = await readVisibleTeams();
 const visibleTeams = rows.slice(0, 200), teamIds = visibleTeams.map(team => team.id as string);
 if (requestedTeam && !teamIds.includes(requestedTeam)) throw new HttpError(404, 'Equipe não encontrada neste recorte ou seu acesso mudou.', 'team_not_found');
 // One bounded roster query; project users only see members who can also read this project.
 const readRoster = () => teamIds.length ? all(db, `SELECT tm.team_id,tm.user_id userId,COALESCE(NULLIF(profile.display_name,''),'Integrante') name
 FROM followup_team_members tm JOIN followup_teams team ON team.id=tm.team_id JOIN portal_users person ON person.user_id=tm.user_id
 LEFT JOIN profiles profile ON profile.user_id=tm.user_id JOIN(SELECT ? project_id,? user_id) caller
 WHERE tm.removed_at IS NULL AND team.id IN (${teamIds.map(() => '?').join(',')}) AND ${activeAccount('person')}
 AND ${authority('caller.user_id', 'team.organization_id', 'caller.project_id')}
 AND (${projectId ? authority('person.user_id', 'team.organization_id', 'caller.project_id') : "EXISTS(SELECT 1 FROM members member WHERE member.user_id=person.user_id AND member.revoked_at IS NULL AND (member.organization_id=team.organization_id OR (member.role='owner' AND member.project_id IS NULL AND member.organization_id IS NULL)))"})
 ORDER BY name,tm.user_id`, [projectId, actor.userId, ...teamIds]) : Promise.resolve([]);
 const roster = await readRoster();
 const counts = teamIds.length ? await all(db, `SELECT a.team_id,COUNT(DISTINCT t.id) total,
 COUNT(DISTINCT CASE WHEN t.status='open' THEN t.id END) open,
 COUNT(DISTINCT CASE WHEN t.status='in_progress' THEN t.id END) in_progress,
 COUNT(DISTINCT CASE WHEN t.status='blocked' THEN t.id END) blocked,
 COUNT(DISTINCT CASE WHEN t.status='completed' THEN t.id END) completed,
 COUNT(DISTINCT CASE WHEN t.status='cancelled' THEN t.id END) cancelled,
 COUNT(DISTINCT CASE WHEN t.priority='high' AND t.status NOT IN ('completed','cancelled') THEN t.id END) high,
 COUNT(DISTINCT CASE WHEN t.due_at<? AND t.status NOT IN ('completed','cancelled') THEN t.id END) overdue
 FROM followup_assignees a JOIN followup_tasks t ON t.id=a.task_id JOIN followup_teams team ON team.id=a.team_id
 JOIN(SELECT ? user_id,? project_id) caller WHERE a.removed_at IS NULL AND a.team_id IN (${teamIds.map(() => '?').join(',')})
 AND t.organization_id=team.organization_id AND (caller.project_id IS NULL OR t.project_id=caller.project_id)
 AND ${authority('caller.user_id', 't.organization_id', 't.project_id')} GROUP BY a.team_id`, [clock.today, actor.userId, projectId, ...teamIds]) : [];
 const ranked = [...visibleTeams].sort((a,b) => Number(b.is_mine)-Number(a.is_mine) || (counts.find(row=>row.team_id===b.id)?.total ?? 0)-(counts.find(row=>row.team_id===a.id)?.total ?? 0) || String(a.name).localeCompare(String(b.name),'pt-BR'));
 const selectedTeamId = requestedTeam ?? ranked[0]?.id ?? '';
 const people = canManage ? await all(db, `SELECT DISTINCT person.user_id userId,COALESCE(NULLIF(profile.display_name,''),'Integrante') name
 FROM portal_users person JOIN members member ON member.user_id=person.user_id LEFT JOIN profiles profile ON profile.user_id=person.user_id
 WHERE ${activeAccount('person')} AND member.revoked_at IS NULL AND (member.organization_id=? OR (member.role='owner' AND member.project_id IS NULL AND member.organization_id IS NULL)) ORDER BY name,person.user_id`, [organizationId]) : [];
 const limit = exporting ? 5000 : TEAM_TASK_PAGE_SIZE;
 const tasks = selectedTeamId ? await all(db, `SELECT t.id,t.title,t.status,t.priority,t.due_at,t.project_id,COALESCE(p.name,'Demandas da organização') project_name,o.name organization_name
 FROM followup_tasks t JOIN organizations o ON o.id=t.organization_id LEFT JOIN projects p ON p.id=t.project_id JOIN(SELECT ? user_id,? project_id) caller
 WHERE t.organization_id=? AND (caller.project_id IS NULL OR t.project_id=caller.project_id) AND (?='' OR t.status=?)
 AND EXISTS(SELECT 1 FROM followup_assignees a JOIN followup_teams team ON team.id=a.team_id WHERE a.task_id=t.id AND a.team_id=? AND a.removed_at IS NULL AND team.organization_id=t.organization_id)
 AND ${authority('caller.user_id', 't.organization_id', 't.project_id')}
 ORDER BY CASE t.status WHEN 'completed' THEN 1 WHEN 'cancelled' THEN 1 ELSE 0 END,CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,COALESCE(t.due_at,'9999'),t.id LIMIT ? OFFSET ?`, [actor.userId, projectId, organizationId, status, status, selectedTeamId, limit + 1, exporting ? 0 : offset]) : [];
 // Team visibility is narrower than project authority. Recheck both affiliation/assignment and the roster.
 const currentTeams = await readVisibleTeams(), currentRoster = await readRoster();
 const stillManager = await one(db, `SELECT 1 allowed FROM (SELECT ? organization_id) scope WHERE ${authority('?', 'scope.organization_id', 'NULL', true)}`, [organizationId, actor.userId]);
 await requireScope(db, actor, scope);
 if (canManage !== Boolean(stillManager) || JSON.stringify(rows) !== JSON.stringify(currentTeams) || JSON.stringify(roster) !== JSON.stringify(currentRoster)) throw new HttpError(403, 'Seus vínculos ou o contexto da equipe mudaram. Atualize a página.', 'team_access_changed');
 return {
  viewerId: actor.userId, scope: { organizationId, organizationName: organization!.name, projectId, projectName: project?.name ?? 'Todos os projetos da organização', canManage },
  teams: visibleTeams.map(team => { const count = counts.find(row => row.team_id === team.id); return { id: team.id, name: team.name, status: team.status, version: team.version, isMine: Boolean(team.is_mine), members: roster.filter(row => row.team_id === team.id).map(row => ({ userId: row.userId, name: row.name })), counts: { total: count?.total ?? 0, open: count?.open ?? 0, in_progress: count?.in_progress ?? 0, blocked: count?.blocked ?? 0, completed: count?.completed ?? 0, cancelled: count?.cancelled ?? 0, high: count?.high ?? 0, overdue: count?.overdue ?? 0 } }; }),
  people: people.map(person => ({ userId: person.userId, name: person.name })), teamsTruncated: rows.length > 200,
  selectedTeamId, tasks: tasks.slice(0, limit).map(task => ({ ...task, assignees: [{ user_id: null, team_id: selectedTeamId, name: visibleTeams.find(team => team.id === selectedTeamId)!.name }] })) as TeamsWorkspace['tasks'],
  hasMore: tasks.length > limit, nextOffset: tasks.length > limit ? offset + limit : null, ...clock,
 };
}
