import { accessibleProjects, type PortalActor } from '../access';
import { all, type Row } from '../database';
import { HttpError } from '../errors';
import { reportRows } from '../reports';
import { activityFeed } from '../activity';
import { authority as followAuthority } from '../follow-up/scope';
import { identifier, projectAuthoritySql, requireActor, requireOrganizationMember } from './scope';
import { risksWorkspace } from './risks';

/*
 * Painel estratégico da gestão. Tudo vem das leituras que já aplicam permissão (relatórios,
 * registros e riscos), filtradas pela organização; a resposta leva só agregados e links.
 */
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
// Data civil de Brasília: datas puras ficam como estão; instantes (UTC) são convertidos.
const civil = (value: unknown) => { const text = String(value ?? ''); if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text; const time = typeof value === 'number' ? value : Date.parse(text); return Number.isFinite(time) ? new Date(time - 3 * 3600_000).toISOString().slice(0, 10) : ''; };
function shift(day: string, days: number) { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function validDay(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Informe datas válidas (AAAA-MM-DD).', 'invalid_dashboard_date');
  return value;
}
function months(from: string, to: string): string[] {
  const list: string[] = [];
  for (let [year, month] = from.split('-').map(Number); `${year}-${String(month).padStart(2, '0')}` <= to.slice(0, 7) && list.length < 24; month === 12 ? (year++, month = 1) : month++) list.push(`${year}-${String(month).padStart(2, '0')}`);
  return list;
}
const link = (module: string, projectId?: unknown) => `/?module=${module}${projectId ? `&project=${encodeURIComponent(String(projectId))}` : ''}`;

export async function managementDashboard(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor), organizationId = identifier(input.organizationId, 'a organização');
  await requireOrganizationMember(db, actor, organizationId);
  const projectId = typeof input.projectId === 'string' && input.projectId ? identifier(input.projectId, 'o projeto') : null;
  const to = validDay(input.to) ?? today(), from = validDay(input.from) ?? shift(to, -89);
  if (from > to) throw new HttpError(400, 'A data inicial deve vir antes da final.', 'invalid_dashboard_date');
  const scope = { organizationId, ...(projectId ? { projectId } : {}) };
  const visible = projectAuthoritySql(actor, [], 'p.id');
  const safe = <T,>(promise: Promise<T>) => promise.catch(error => { if (error instanceof HttpError && [401, 403, 404].includes(error.status)) return null; throw error; });
  const activityFrom = from < shift(to, -91) ? shift(to, -91) : from;
  // Seção sem permissão em nenhum projeto fica de fora (null), em vez de aparecer zerada.
  const can = (...capabilities: string[]) => capabilities.some(capability => { const scope = accessibleProjects(actor, capability); return scope === null || scope.length > 0; });
  const seesMaterials = can('inventory.read', 'reports.read'), seesCampaigns = can('reports.read', 'campaigns.manage');
  const [projects, demands, movements, campaigns, materials, risks, completions, schedule, activity] = await Promise.all([
    all(db, `SELECT p.id,p.name FROM projects p WHERE p.organization_id=? AND p.status='active' AND ${visible.sql} ORDER BY p.name LIMIT 200`, [organizationId, ...visible.values]),
    safe(reportRows(db, actor, { dataset: 'demands', ...scope })),
    seesMaterials ? safe(reportRows(db, actor, { dataset: 'movements', ...scope, from, to })) : Promise.resolve(null),
    seesCampaigns ? safe(reportRows(db, actor, { dataset: 'campaigns', ...scope })) : Promise.resolve(null),
    seesMaterials ? safe(reportRows(db, actor, { dataset: 'materials', ...scope })) : Promise.resolve(null),
    safe(risksWorkspace(db, actor, { organizationId, ...(projectId ? { projectId } : {}) })),
    all(db, `SELECT h.task_id id,MIN(h.created_at) at FROM followup_history h JOIN followup_tasks f ON f.id=h.task_id
      WHERE f.organization_id=? AND (? IS NULL OR f.project_id=?) AND json_extract(h.snapshot_json,'$.status')='completed' AND ${followAuthority('?', 'f.organization_id', 'f.project_id')}
      GROUP BY h.task_id LIMIT 5000`, [organizationId, projectId, projectId, actor.userId]),
    all(db, `SELECT s.title,s.starts_at,p.id project_id,p.name project FROM project_schedule_items s JOIN projects p ON p.id=s.project_id
      WHERE p.organization_id=? AND (? IS NULL OR p.id=?) AND s.status='planned' AND date(s.starts_at,'-3 hours') BETWEEN ? AND ? AND ${visible.sql} ORDER BY s.starts_at LIMIT 12`,
      [organizationId, projectId, projectId, today(), shift(today(), 45), ...visible.values]),
    safe(activityFeed(db, actor, { from: activityFrom, to, ...(projectId ? { projectId } : {}) })),
  ]);
  const projectIds = new Set(projects.map(row => String(row.id)));
  const axis = months(from, to);
  const demandRows: Row[] = demands?.rows ?? [];
  const completedAt = new Map(completions.map(row => [String(row.id), civil(row.at)]));
  const openDemands = demandRows.filter(row => ['open', 'in_progress', 'blocked'].includes(String(row.situacao)));
  const createdIn = demandRows.filter(row => String(row.data) >= from && String(row.data) <= to);
  const completedIn = demandRows.filter(row => row.situacao === 'completed').map(row => completedAt.get(String(row.id)) || civil(row.atualizada_em)).filter(day => day >= from && day <= to);
  const outflows = (movements?.rows ?? []).filter(row => Number(row.quantidade) < 0 && ['distribute', 'redeem'].includes(String(row.tipo)));
  const campaignRows: Row[] = campaigns?.rows ?? [];
  const materialRows: Row[] = materials?.rows ?? [];
  const riskRows = risks?.risks ?? [];
  const openRisks = riskRows.filter(risk => risk.status === 'open' || risk.status === 'monitoring');
  const matrix = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
  for (const risk of openRisks) matrix[5 - risk.impact][risk.probability - 1]++;
  const byProject = new Map<string, { project: string; projectId: string; open: number; overdue: number; completed: number }>();
  for (const row of demandRows) {
    const key = String(row.projeto);
    const entry = byProject.get(key) ?? { project: key, projectId: '', open: 0, overdue: 0, completed: 0 };
    if (['open', 'in_progress', 'blocked'].includes(String(row.situacao))) entry.open++;
    if (row.em_atraso === 'sim') entry.overdue++;
    if (row.situacao === 'completed' && (completedAt.get(String(row.id)) || civil(row.atualizada_em)) >= from) entry.completed++;
    byProject.set(key, entry);
  }
  const nameToId = new Map(projects.map(row => [String(row.name), String(row.id)]));
  const upcomingCampaigns = campaignRows.filter(row => civil(row.inicio) >= today() && civil(row.inicio) <= shift(today(), 45))
    .map(row => ({ date: civil(row.inicio), title: String(row.evento), project: String(row.projeto), kind: 'Dinâmica', href: link('events', nameToId.get(String(row.projeto))) }));
  const upcoming = [...schedule.map(row => ({ date: civil(row.starts_at), title: String(row.title), project: String(row.project), kind: 'Agenda', href: link('calendar', row.project_id) })), ...upcomingCampaigns]
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  const days = activity?.summary.days ?? [];
  return {
    period: { from, to, activityFrom }, today: today(),
    projects: projects.map(row => ({ id: row.id, name: row.name })),
    kpis: {
      demandsOpen: openDemands.length,
      demandsOverdue: demandRows.filter(row => row.em_atraso === 'sim').length,
      demandsHighOpen: openDemands.filter(row => row.prioridade === 'high').length,
      demandsCompleted: completedIn.length,
      itemsOut: outflows.reduce((total, row) => total + Math.abs(Number(row.quantidade) || 0), 0),
      campaignsActive: campaigns ? campaignRows.filter(row => row.situacao === 'active').length : null,
      participations: campaigns ? campaignRows.filter(row => civil(row.inicio) >= from && civil(row.inicio) <= to).reduce((total, row) => total + (Number(row.participacoes) || 0), 0) : null,
      lowStock: materials ? materialRows.filter(row => row.situacao_estoque === 'baixo').length : null,
      risksOpen: risks ? openRisks.length : null,
      risksHigh: risks ? openRisks.filter(risk => risk.level === 'alto' || risk.level === 'critico').length : null,
      risksReviewOverdue: risks ? riskRows.filter(risk => risk.reviewOverdue).length : null,
    },
    demandsByMonth: axis.map(month => ({ month, created: createdIn.filter(row => String(row.data).startsWith(month)).length, completed: completedIn.filter(day => day.startsWith(month)).length })),
    deliveriesByMonth: movements ? axis.map(month => ({ month, itemsOut: outflows.filter(row => String(row.data).startsWith(month)).reduce((total, row) => total + Math.abs(Number(row.quantidade) || 0), 0) })) : null,
    byProject: [...byProject.values()].map(entry => ({ ...entry, projectId: nameToId.get(entry.project) ?? '' })).filter(entry => !entry.projectId || projectIds.has(entry.projectId))
      .sort((a, b) => b.open - a.open || b.overdue - a.overdue).slice(0, 8),
    upcoming,
    lowStock: materials ? materialRows.filter(row => row.situacao_estoque === 'baixo').slice(0, 6).map(row => ({ material: row.material, project: row.projeto, available: Number(row.disponivel) || 0, unit: row.unidade_medida, href: link('materials', nameToId.get(String(row.projeto))) })) : null,
    risks: risks ? { matrix, overdue: riskRows.filter(risk => risk.reviewOverdue).slice(0, 5).map(risk => ({ id: risk.id, title: risk.title, reviewOn: risk.reviewOn, level: risk.level })), total: riskRows.length } : null,
    activity: activity ? { days: days.map(day => ({ day: day.day, total: day.materials + day.demandsOpened + day.demandsCompleted + day.agenda })), activePeople: activity.team?.activePeople ?? null, deadlines: activity.deadlines } : null,
  };
}
