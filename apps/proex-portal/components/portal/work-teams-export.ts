import { priorityLabels, stateLabels, type TaskStatus } from '@/lib/follow-up/contracts';
import type { TeamsWorkspace } from '@/lib/follow-up/teams-contract';
import type { ExportColumn, ExportRow } from './report-export';
import { TeamsApiError } from './work-teams-api';

const columns: ExportColumn[] = [
  { key: 'title', label: 'Demanda' },
  { key: 'project_name', label: 'Projeto' },
  { key: 'status', label: 'Estado' },
  { key: 'priority', label: 'Prioridade' },
  { key: 'due_at', label: 'Prazo' },
];

function exportTeam(workspace: TeamsWorkspace) {
  const team = workspace.teams.find(entry => entry.id === workspace.selectedTeamId);
  if (!team) throw new TeamsApiError('A equipe não está disponível neste recorte.', 403);
  return team;
}

/** Compare the exported content and scope without timestamps or other teams' records. */
function snapshot(workspace: TeamsWorkspace) {
  const team = exportTeam(workspace);
  return JSON.stringify([
    workspace.viewerId, workspace.scope, workspace.today, workspace.hasMore, team.id, team.name, team.status,
    workspace.tasks.map(task => [task.id, task.project_id, task.project_name, task.title, task.status, task.priority, task.due_at]),
  ]);
}

export function teamExportDocument(workspace: TeamsWorkspace, status: TaskStatus | '') {
  const team = exportTeam(workspace);
  const rows = workspace.tasks.map(task => ({
    title: task.title,
    project_name: task.project_name,
    status: stateLabels[task.status],
    priority: priorityLabels[task.priority],
    due_at: task.due_at?.split('-').reverse().join('/') ?? 'Sem prazo',
  }));
  const info: [string, string][] = [
    ['Organização', workspace.scope.organizationName], ['Recorte', workspace.scope.projectName], ['Equipe', team.name],
    ['Estado', status ? stateLabels[status] : 'Todos'], ['Linhas', String(rows.length)],
    ['Gerado em', new Date(workspace.asOf).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (Brasília)'],
  ];
  const metrics = [
    { label: 'Demandas no arquivo', value: rows.length },
    { label: 'Pendentes de prioridade alta', value: workspace.tasks.filter(task => task.priority === 'high' && !['completed', 'cancelled'].includes(task.status)).length },
  ];
  return { title: `Demandas · ${team.name}`, columns, rows, info, display: (row: ExportRow, column: string) => row[column] ?? '', metrics };
}

/** Deliver only after a second authorized read of the same team, project and status. */
export async function prepareTeamExport<T>(
  read: () => Promise<TeamsWorkspace>,
  render: (fresh: TeamsWorkspace) => Promise<T>,
  guard: () => void,
) {
  guard();
  const fresh = await read();
  guard();
  if (fresh.hasMore) throw new TeamsApiError('Este recorte passa de 5.000 demandas. Escolha um projeto ou estado para exportar o conjunto completo.', 413);
  const expected = snapshot(fresh);
  const artifact = await render(fresh);
  guard();
  const current = await read();
  guard();
  if (snapshot(current) !== expected) {
    throw new TeamsApiError('As demandas ou seus acessos mudaram durante a preparação. Atualize a equipe e baixe novamente.', 409);
  }
  return artifact;
}
