import { type PortalActor } from '../access';
import { all } from '../database';
import { HttpError } from '../errors';
import { date } from './contracts';
import { authority, activeAccount } from './scope';

export async function followupReportRows(db: D1Database, actor: PortalActor, dataset: 'demands' | 'reviews', input: Record<string, unknown>, limit: number) {
  const conditions = [authority('?', 'f.organization_id', 'f.project_id')], values: unknown[] = [actor.userId];
  for (const [key, column] of [['projectId', 'f.project_id'], ['organizationId', 'f.organization_id'], ['unitId', 'p.unit_id'], ['thematicArea', 'p.thematic_area']] as const) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.length > 200) throw new HttpError(400, 'Confira os filtros do relatório.', 'invalid_report_filter');
    if (value === '__none__') conditions.push(`(${column} IS NULL OR ${column}='')`);
    else { conditions.push(`${column}=?`); values.push(value); }
  }
  const from = date(input.from), to = date(input.to);
  if (from && to && from > to) throw new HttpError(400, 'A data inicial precisa anteceder a final.', 'invalid_report_date');
  const created = dataset === 'demands' ? 'f.created_at' : 'c.created_at';
  if (from) { conditions.push(`date(${created},'-3 hours')>=?`); values.push(from); }
  if (to) { conditions.push(`date(${created},'-3 hours')<=?`); values.push(to); }
  const shared = `o.name AS organizacao,COALESCE(p.name,'Organização (sem projeto)') AS projeto,
    COALESCE(u.acronym,'') AS unidade_sigla,COALESCE(u.name,'') AS unidade,COALESCE(u.group_label,'') AS unidade_grupo,
    COALESCE(p.thematic_area,'') AS area_tematica,COALESCE(pt.label,'') AS modalidade,f.title AS demanda`;
  const joins = `JOIN organizations o ON o.id=f.organization_id LEFT JOIN projects p ON p.id=f.project_id
    LEFT JOIN organizational_units u ON u.id=p.unit_id LEFT JOIN project_types pt ON pt.id=p.type_id`;
  const base = `followup_tasks f ${joins}`;
  let query: string;
  if (dataset === 'demands') {
    query = `SELECT f.id,${shared},f.priority AS prioridade,f.status AS situacao,f.due_at AS prazo,
      date(f.created_at,'-3 hours') AS data,date(f.updated_at,'-3 hours') AS atualizada_em,
      CASE WHEN f.status IN ('open','in_progress','blocked') AND f.due_at<date('now','-3 hours') THEN 'sim' ELSE 'nao' END AS em_atraso,
      COALESCE(ev.name,'') AS evento,COALESCE(i.name,'') AS material,
      (SELECT COUNT(*) FROM followup_assignees a JOIN portal_users recipient ON recipient.user_id=a.user_id
       WHERE a.task_id=f.id AND a.removed_at IS NULL AND ${activeAccount('recipient')} AND ${authority('recipient.user_id', 'f.organization_id', 'f.project_id')}) AS responsaveis_ativos,
      (SELECT COUNT(*) FROM followup_assignees a JOIN followup_teams team ON team.id=a.team_id
       WHERE a.task_id=f.id AND a.removed_at IS NULL AND team.status='active' AND team.organization_id=f.organization_id) AS equipes_ativas,
      (SELECT COUNT(*) FROM followup_checklist_items r JOIN followup_checklists c ON c.id=r.checklist_id WHERE c.task_id=f.id) AS itens_conferencia,
      (SELECT COUNT(*) FROM followup_checklist_items r JOIN followup_checklists c ON c.id=r.checklist_id WHERE c.task_id=f.id AND r.counted IS NULL) AS contagens_pendentes
      FROM ${base} LEFT JOIN campaigns ev ON ev.id=f.campaign_id LEFT JOIN items i ON i.id=f.item_id
      WHERE ${conditions.join(' AND ')} ORDER BY CASE f.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,f.due_at IS NULL,f.due_at,f.created_at DESC,f.id`;
  } else {
    query = `SELECT r.id,c.id AS conferencia_id,${shared},c.title AS conferencia,c.status AS situacao,
      date(c.created_at,'-3 hours') AS data,COALESCE(ev.name,'') AS evento,i.name AS material,i.unit AS unidade_medida,r.size AS tamanho,
      r.expected AS esperado,r.counted AS contado,r.damaged AS avariado,
      CASE WHEN r.counted IS NULL THEN NULL ELSE r.counted-r.expected END AS divergencia,
      CASE WHEN r.counted IS NULL THEN NULL ELSE r.counted-r.damaged END AS sem_avarias,
      CASE WHEN r.counted IS NULL THEN 'sim' ELSE 'nao' END AS contagem_pendente,
      (SELECT COUNT(*) FROM followup_checklist_actions a WHERE a.checklist_id=c.id AND a.row_id=r.id) AS acompanhamentos
      FROM followup_checklist_items r JOIN followup_checklists c ON c.id=r.checklist_id JOIN followup_tasks f ON f.id=c.task_id ${joins}
      JOIN items i ON i.id=r.item_id LEFT JOIN campaigns ev ON ev.id=c.campaign_id
      WHERE ${conditions.join(' AND ')} ORDER BY c.created_at DESC,c.id,i.name,r.size,r.id`;
  }
  const rows = await all(db, `${query} LIMIT ?`, [...values, limit + 1]);
  return { dataset, rows: rows.slice(0, limit), truncated: rows.length > limit };
}
