import { effectiveMovementSql } from './movement-ledger';
import { aiConfigurationAuthority, projectAuthoritySql, type PortalActor } from './access';
import { describeChange, CONFIG_FIELDS, type ConfigChange } from './assistant/quota';
import { builtinModelName } from './assistant/model-catalog';
import { isCivilDate, offsetCivilDate } from './civil-date';
import { all, type Row } from './database';
import { HttpError } from './errors';
import { authority as followupAuthority } from './follow-up/scope';
import { listRecords } from './records';

/**
 * Histórico unificado (Registros). Cada fonte repete a autoridade do próprio módulo no SQL,
 * então a visibilidade é decidida no servidor: quem tem escopo da organização vê todos os
 * projetos dela; quem é membro de projetos vê só esses projetos (os próprios registros e os
 * dos colegas do mesmo projeto). Nada de contato, observação livre, nome de quem pegou
 * emprestado ou identificador interno sai daqui.
 */
export const ACTIVITY_TYPES = ['materials', 'loans', 'demands', 'agenda', 'records', 'convocations', 'access', 'ai'] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];
export type ActivityEvent = {
  id: string; type: ActivityType; action: string; title: string; detail: string;
  at: string; day: string; projectId: string | null; projectName: string;
  actorId: string | null; actorName: string; viaRole: boolean; href: string | null; quantity: number | null;
  /** Situação de movimentos de estoque revistos: versão substituída (corrigida), desfeita, ou a versão nova (correção). */
  status?: 'corrected' | 'undone' | 'correction'; statusReason?: string; statusById?: string | null; statusBy?: string;
};
export const ACTIVITY_SUBJECTS = ['item', 'loan', 'task', 'campaign'] as const;
export type ActivitySubjectKind = typeof ACTIVITY_SUBJECTS[number];
/** Fontes que têm acontecimentos de cada assunto. As demais ficam de fora quando o histórico é de um assunto só. */
const SUBJECT_SOURCES: Record<ActivitySubjectKind, ActivityType[]> = { item: ['materials', 'loans', 'demands', 'records'], loan: ['loans', 'demands', 'records'], task: ['demands'], campaign: ['demands', 'access'] };
export type ActivityFeed = {
  range: { from: string; to: string; days: string[] };
  types: ActivityType[];
  events: ActivityEvent[];
  truncated: boolean;
  /** Histórico de um assunto só (ficha de material, empréstimo, demanda ou dinâmica). O nome só vem se a pessoa pode ler o assunto. */
  subject: { kind: ActivitySubjectKind; id: string; name: string } | null;
  people: { id: string; name: string }[];
  loansNow: { active: number; late: number } | null;
  /** Só quem configura a IA de alguma organização vê o tipo "Configuração de IA". */
  aiVisible: boolean;
  /** Totais por dia e por material calculados no banco: não dependem do corte da lista. */
  summary: { days: { day: string; materials: number; demandsOpened: number; demandsCompleted: number; agenda: number }[]; stock: { name: string; projectId: string; href: string; entradas: number; saidas: number }[] };
  /** Prazos das demandas: concluídas no período (no prazo, com atraso, sem prazo) e abertas já vencidas agora. */
  deadlines: { onTime: number; late: number; noDue: number; overdueNow: number } | null;
  /**
   * Atividade registrada por pessoa (não é registro de login). Só para quem gerencia acessos
   * (access.manage) e só com acontecimentos dos projetos que essa pessoa gerencia.
   */
  team: { activePeople: number; perDay: { day: string; people: number }[]; people: { id: string; name: string; days: number; actions: number; last: string }[] } | null;
};

export const MAX_RANGE_DAYS = 92;
const MAX_PER_SOURCE = 600, MAX_EVENTS = 400;
const ZONE_OFFSET_HOURS = 3; // America/Sao_Paulo, sem horário de verão desde 2019.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function civil(input: unknown, label: string): string | null {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string' || !isCivilDate(input)) throw new HttpError(400, `Informe ${label} como data (aaaa-mm-dd).`, 'invalid_activity_date');
  return input;
}
export function todayInBrasilia(now = Date.now()): string { return new Date(now - ZONE_OFFSET_HOURS * 3600000).toISOString().slice(0, 10); }
export function activityRange(fromInput: unknown, toInput: unknown, now = Date.now()) {
  const to = civil(toInput, 'o fim do período') ?? todayInBrasilia(now);
  const from = civil(fromInput, 'o início do período') ?? offsetCivilDate(to, -29);
  if (from > to) throw new HttpError(400, 'O início do período precisa vir antes do fim.', 'invalid_activity_interval');
  const days: string[] = [];
  for (let day = from; day <= to; day = offsetCivilDate(day, 1)) {
    days.push(day);
    if (days.length > MAX_RANGE_DAYS) throw new HttpError(400, `Escolha um período de até ${MAX_RANGE_DAYS} dias.`, 'activity_range_too_long');
  }
  // Limites em UTC equivalentes a 00:00 e 24:00 de Brasília.
  return { from, to, days, startsAt: `${from}T0${ZONE_OFFSET_HOURS}:00:00.000Z`, endsAt: `${offsetCivilDate(to, 1)}T0${ZONE_OFFSET_HOURS}:00:00.000Z` };
}
export function brasiliaDay(iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time - ZONE_OFFSET_HOURS * 3600000).toISOString().slice(0, 10) : '';
}
function types(input: unknown): ActivityType[] {
  if (input === undefined || input === null || input === '') return [...ACTIVITY_TYPES];
  const list = String(input).split(',').filter(Boolean);
  if (!list.length || list.some(type => !(ACTIVITY_TYPES as readonly string[]).includes(type))) throw new HttpError(400, 'Escolha tipos de registro válidos.', 'invalid_activity_type');
  return [...new Set(list)] as ActivityType[];
}
function optionalId(input: unknown, label: string): string | null {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string' || !ID.test(input)) throw new HttpError(400, `Identificador inválido para ${label}.`, 'invalid_identifier');
  return input;
}
const CONVOCATION_LABELS: Record<string, string> = { created: 'Convocação criada', updated: 'Convocação editada', closed: 'Convocação encerrada', reopened: 'Convocação reaberta', invite_created: 'Link de convite gerado', invite_revoked: 'Link de convite encerrado', response_created: 'Presença respondida', response_updated: 'Resposta alterada', response_deleted: 'Resposta apagada pela pessoa', purged: 'Dados dos convidados apagados' };
const CONVOCATION_ANSWERS: Record<string, string> = { yes: 'Vai', maybe: 'Talvez', no: 'Não vai' };
const link = (module: string, projectId: string | null, extra = '') => projectId ? `/?module=${module}&project=${encodeURIComponent(projectId)}${extra}` : `/?module=${module}`;
const plural = (count: number, one: string, many: string) => `${count} ${Math.abs(count) === 1 ? one : many}`;
const MOVEMENT_LABELS: Record<string, string> = { receive: 'Entrada', distribute: 'Distribuição', consume: 'Consumo', adjust: 'Ajuste', redeem: 'Brinde entregue', reserve: 'Reserva', release: 'Reserva liberada' };
const RECORD_LABELS: Record<string, string> = { observation: 'Observação', maintenance: 'Manutenção', distribution: 'Distribuição', consumption: 'Consumo', project: 'Atividade do projeto', material: 'Material', loan: 'Empréstimo' };

type Source = { sql: string; values: unknown[] };
const dayOf = (column: string) => `date(datetime(${column},'-${ZONE_OFFSET_HOURS} hours'))`;
function scoped(actor: PortalActor, capabilities: string[], projectSql: string, projectId: string | null, organizationId: string | null = null): Source {
  const auth = projectAuthoritySql(actor, capabilities, projectSql);
  const base = projectId ? { sql: `(${auth.sql}) AND ${projectSql}=?`, values: [...auth.values, projectId] } : { sql: `(${auth.sql})`, values: auth.values };
  // Recorte opcional por organização (painel da gestão): só projetos dela.
  return organizationId ? { sql: `${base.sql} AND EXISTS(SELECT 1 FROM projects scope_org WHERE scope_org.id=${projectSql} AND scope_org.organization_id=?)`, values: [...base.values, organizationId] } : base;
}

/** Registros manuais que o Rolê gravou depois da confirmação da pessoa. O texto do pedido não entra no histórico geral: fica no detalhe. */
async function recordsByRole(db: D1Database, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90);
    for (const row of await all(db, `SELECT json_extract(result_json,'$.recordId') id FROM ai_plans WHERE status='applied' AND json_valid(result_json) AND json_extract(result_json,'$.recordId') IN (${chunk.map(() => '?').join(',')})`, chunk)) found.add(String(row.id));
  }
  return found;
}

function subjectOf(input: Record<string, unknown>): { kind: ActivitySubjectKind; id: string } | null {
  const given = ([['item', input.itemId, 'o material'], ['loan', input.loanId, 'o empréstimo'], ['task', input.taskId, 'a demanda'], ['campaign', input.campaignId, 'a dinâmica']] as const)
    .flatMap(([kind, value, label]) => { const id = optionalId(value, label); return id ? [{ kind, id }] : []; });
  if (given.length > 1) throw new HttpError(400, 'Escolha um assunto só para o histórico.', 'invalid_activity_subject');
  return given[0] ?? null;
}

export async function activityFeed(db: D1Database, actor: PortalActor | null, input: Record<string, unknown> = {}, now = Date.now()): Promise<ActivityFeed> {
  if (!actor) throw new HttpError(401, 'Entre para consultar os registros.', 'unauthenticated');
  const subject = subjectOf(input);
  // Sem período informado, o histórico de um assunto cobre o máximo permitido (92 dias).
  const range = activityRange(subject && !input.from ? offsetCivilDate(civil(input.to, 'o fim do período') ?? todayInBrasilia(now), 1 - MAX_RANGE_DAYS) : input.from, input.to, now);
  // Um assunto só usa as fontes em que ele aparece; cada fonte continua com a regra de leitura do próprio módulo.
  const wanted = subject ? types(input.types).filter(type => SUBJECT_SOURCES[subject.kind].includes(type)) : types(input.types);
  const about = (kind: ActivitySubjectKind, column: string): Source => subject?.kind === kind ? { sql: ` AND ${column}=?`, values: [subject.id] } : { sql: '', values: [] };
  const projectId = optionalId(input.projectId, 'o projeto'), organizationId = optionalId(input.organizationId, 'a organização');
  let person = optionalId(input.person, 'a pessoa');
  // Filtro por pessoa só para contas ativas e não anonimizadas; senão, nada corresponde.
  if (person && !(await all(db, 'SELECT 1 FROM portal_users WHERE user_id=? AND anonymized_at IS NULL LIMIT 1', [person])).length) person = 'conta-indisponivel';
  const events: ActivityEvent[] = [];
  let truncated = false, loansNow: ActivityFeed['loansNow'] = null;
  const perDay = new Map(range.days.map(day => [day, { day, materials: 0, demandsOpened: 0, demandsCompleted: 0, agenda: 0 }]));
  const bump = (rows: Row[], key: 'materials' | 'demandsOpened' | 'demandsCompleted' | 'agenda') => { for (const row of rows) { const entry = perDay.get(String(row.day)); if (entry) entry[key] += Number(row.n) || 0; } };
  let stock: ActivityFeed['summary']['stock'] = [];
  let deadlines: ActivityFeed['deadlines'] = null;
  const actorFilter = (column: string) => person ? { sql: ` AND ${column}=?`, values: [person] } : { sql: '', values: [] };
  const take = (rows: Row[]) => { if (rows.length > MAX_PER_SOURCE) { truncated = true; return rows.slice(0, MAX_PER_SOURCE); } return rows; };

  if (wanted.includes('materials')) {
    const scope = scoped(actor, ['inventory.read'], 'p.id', projectId, organizationId), item = about('item', 'i.id');
    const rows = take(await all(db, `SELECT m.id,m.kind,m.delta,m.created_at,m.actor_id,m.ref_id,i.id item_id,i.name item_name,i.unit,p.id project_id,p.name project_name,
        sup.kind sup_kind,sup.reason sup_reason,sup.actor_id sup_actor,rep.reason rep_reason,rep.actor_id rep_actor
      FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id
      LEFT JOIN stock_movement_revisions sup ON sup.target_movement_id=m.id LEFT JOIN stock_movement_revisions rep ON rep.replacement_movement_id=m.id
      WHERE ${scope.sql}${item.sql} AND m.created_at>=? AND m.created_at<? AND NOT EXISTS(SELECT 1 FROM stock_movement_revisions mirror WHERE mirror.reversal_movement_id=m.id) ORDER BY m.created_at DESC LIMIT ${MAX_PER_SOURCE + 1}`, [...scope.values, ...item.values, range.startsAt, range.endsAt]));
    for (const row of rows) {
      const delta = Number(row.delta) || 0, unitName = String(row.unit || 'unidade'), unit = Math.abs(delta) === 1 || /s$/i.test(unitName) ? unitName : `${unitName}s`;
      events.push({ id: `materials:${row.id}`, type: 'materials', action: MOVEMENT_LABELS[String(row.kind)] ?? 'Movimentação', title: String(row.item_name), detail: `${delta > 0 ? '+' : ''}${delta} ${unit}`,
        at: String(row.created_at), day: brasiliaDay(String(row.created_at)), projectId: String(row.project_id), projectName: String(row.project_name),
        actorId: row.actor_id ? String(row.actor_id) : null, actorName: '', viaRole: /^manual:[^:]+:ai_/.test(String(row.ref_id ?? '')),
        href: link('materials', String(row.project_id), `&itemId=${encodeURIComponent(String(row.item_id))}`), quantity: delta,
        ...(row.sup_kind ? { status: row.sup_kind === 'reversal' ? 'undone' as const : 'corrected' as const, statusReason: String(row.sup_reason ?? ''), statusById: row.sup_actor ? String(row.sup_actor) : null }
          : row.rep_reason !== null && row.rep_reason !== undefined ? { status: 'correction' as const, statusReason: String(row.rep_reason), statusById: row.rep_actor ? String(row.rep_actor) : null } : {}) });
    }

    if (!subject) {
    const who = actorFilter('m.actor_id');
    bump(await all(db, `SELECT ${dayOf('m.created_at')} day,COUNT(*) n FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id
      WHERE ${scope.sql} AND m.created_at>=? AND m.created_at<?${who.sql} AND NOT EXISTS(SELECT 1 FROM stock_movement_revisions mirror WHERE mirror.reversal_movement_id=m.id) GROUP BY day`, [...scope.values, range.startsAt, range.endsAt, ...who.values]), 'materials');
    stock = (await all(db, `SELECT i.id item_id,i.name,p.id project_id,SUM(CASE WHEN m.delta>0 THEN m.delta ELSE 0 END) entradas,SUM(CASE WHEN m.delta<0 THEN -m.delta ELSE 0 END) saidas
      FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id
      WHERE ${scope.sql} AND m.created_at>=? AND m.created_at<?${who.sql} AND ${effectiveMovementSql('m')} GROUP BY i.id ORDER BY entradas+saidas DESC,i.name LIMIT 8`, [...scope.values, range.startsAt, range.endsAt, ...who.values]))
      .map(row => ({ name: String(row.name), projectId: String(row.project_id), href: link('materials', String(row.project_id), `&itemId=${encodeURIComponent(String(row.item_id))}`), entradas: Number(row.entradas) || 0, saidas: Number(row.saidas) || 0 }));
    }
  }

  if (wanted.includes('loans')) {
    const scope = scoped(actor, ['loans.read'], 'p.id', projectId, organizationId), only = subject?.kind === 'item' ? about('item', 'l.item_id') : about('loan', 'l.id');
    const rows = take(await all(db, `SELECT l.id,l.status,l.action_name,l.created_at,l.checked_out_at,l.returned_at,l.ends_at,l.created_by,i.name item_name,p.id project_id,p.name project_name
      FROM loans l JOIN items i ON i.id=l.item_id AND i.project_id=l.project_id JOIN projects p ON p.id=l.project_id
      WHERE ${scope.sql}${only.sql} AND ((l.created_at>=? AND l.created_at<?) OR (l.checked_out_at>=? AND l.checked_out_at<?) OR (l.returned_at>=? AND l.returned_at<?))
      ORDER BY COALESCE(l.returned_at,l.checked_out_at,l.created_at) DESC LIMIT ${MAX_PER_SOURCE + 1}`,
    [...scope.values, ...only.values, range.startsAt, range.endsAt, range.startsAt, range.endsAt, range.startsAt, range.endsAt]));
    for (const row of rows) {
      const base = { type: 'loans' as const, title: String(row.item_name), detail: String(row.action_name || ''), projectId: String(row.project_id), projectName: String(row.project_name),
        actorName: '', viaRole: false, href: link('loans', String(row.project_id), `&loanId=${encodeURIComponent(String(row.id))}`), quantity: null };
      const within = (value: unknown) => typeof value === 'string' && value >= range.startsAt && value < range.endsAt;
      if (within(row.created_at)) events.push({ ...base, id: `loans:${row.id}:created`, action: 'Reserva registrada', at: String(row.created_at), day: brasiliaDay(String(row.created_at)), actorId: row.created_by ? String(row.created_by) : null });
      if (within(row.checked_out_at)) events.push({ ...base, id: `loans:${row.id}:out`, action: 'Retirada', at: String(row.checked_out_at), day: brasiliaDay(String(row.checked_out_at)), actorId: null });
      if (within(row.returned_at)) events.push({ ...base, id: `loans:${row.id}:returned`, action: 'Devolução', at: String(row.returned_at), day: brasiliaDay(String(row.returned_at)), actorId: null });
    }
    const reachable = scoped(actor, ['loans.read'], 'p.id', projectId, organizationId);
    if (!subject && (await all(db, `SELECT 1 FROM projects p WHERE ${reachable.sql} LIMIT 1`, reachable.values)).length) {
    // loans.ends_at é inteiro (milissegundos): comparar com número, nunca com texto ISO.
    const current = scoped(actor, ['loans.read'], 'l.project_id', projectId, organizationId);
    const [counts] = await all(db, `SELECT SUM(CASE WHEN l.status IN ('reserved','out') THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN l.status='out' AND CAST(l.ends_at AS INTEGER)<? THEN 1 ELSE 0 END) late FROM loans l WHERE ${current.sql}`, [now, ...current.values]);
    loansNow = { active: Number(counts?.active) || 0, late: Number(counts?.late) || 0 };
    }
  }

  if (wanted.includes('demands')) {
    const visible = followupAuthority('?', 'f.organization_id', 'f.project_id'), demandColumn = { item: 'f.item_id', loan: 'f.loan_id', task: 'f.id', campaign: 'f.campaign_id' } as const;
    const projectFilter = `${projectId ? ' AND f.project_id=?' : ''}${organizationId ? ' AND f.organization_id=?' : ''}${subject ? ` AND ${demandColumn[subject.kind]}=?` : ''}`;
    const values = [actor.userId, ...(projectId ? [projectId] : []), ...(organizationId ? [organizationId] : []), ...(subject ? [subject.id] : [])];
    const opened = take(await all(db, `SELECT f.id,f.title,f.priority,f.created_at,f.created_by,f.project_id,COALESCE(p.name,o.name) project_name
      FROM followup_tasks f JOIN organizations o ON o.id=f.organization_id LEFT JOIN projects p ON p.id=f.project_id
      WHERE ${visible}${projectFilter} AND f.created_at>=? AND f.created_at<? ORDER BY f.created_at DESC LIMIT ${MAX_PER_SOURCE + 1}`, [...values, range.startsAt, range.endsAt]));
    for (const row of opened) events.push({ id: `demands:${row.id}:opened`, type: 'demands', action: 'Demanda criada', title: String(row.title), detail: row.priority === 'high' ? 'Prioridade alta' : row.priority === 'low' ? 'Prioridade baixa' : 'Prioridade média',
      at: String(row.created_at), day: brasiliaDay(String(row.created_at)), projectId: row.project_id ? String(row.project_id) : null, projectName: String(row.project_name),
      actorId: row.created_by ? String(row.created_by) : null, actorName: '', viaRole: false, href: link('demands', row.project_id ? String(row.project_id) : null, `&demandId=${encodeURIComponent(String(row.id))}`), quantity: null });
    // Conclusão = primeira versão do histórico com estado "completed" depois de outro estado.
    const completed = take(await all(db, `SELECT h.task_id id,h.created_at,h.actor_id,f.title,f.project_id,COALESCE(p.name,o.name) project_name
      FROM followup_history h JOIN followup_tasks f ON f.id=h.task_id JOIN organizations o ON o.id=f.organization_id LEFT JOIN projects p ON p.id=f.project_id
      WHERE ${visible}${projectFilter} AND h.created_at>=? AND h.created_at<? AND json_extract(h.snapshot_json,'$.status')='completed'
        AND NOT EXISTS(SELECT 1 FROM followup_history prev WHERE prev.task_id=h.task_id AND prev.version=h.version-1 AND json_extract(prev.snapshot_json,'$.status')='completed')
      ORDER BY h.created_at DESC LIMIT ${MAX_PER_SOURCE + 1}`, [...values, range.startsAt, range.endsAt]));
    for (const row of completed) events.push({ id: `demands:${row.id}:completed:${row.created_at}`, type: 'demands', action: 'Demanda concluída', title: String(row.title), detail: '',
      at: String(row.created_at), day: brasiliaDay(String(row.created_at)), projectId: row.project_id ? String(row.project_id) : null, projectName: String(row.project_name),
      actorId: row.actor_id ? String(row.actor_id) : null, actorName: '', viaRole: false, href: link('demands', row.project_id ? String(row.project_id) : null, `&demandId=${encodeURIComponent(String(row.id))}`), quantity: null });

    if (!subject) {
    const opener = actorFilter('f.created_by'), closer = actorFilter('h.actor_id');
    bump(await all(db, `SELECT ${dayOf('f.created_at')} day,COUNT(*) n FROM followup_tasks f WHERE ${visible}${projectFilter} AND f.created_at>=? AND f.created_at<?${opener.sql} GROUP BY day`, [...values, range.startsAt, range.endsAt, ...opener.values]), 'demandsOpened');
    bump(await all(db, `SELECT ${dayOf('h.created_at')} day,COUNT(*) n FROM followup_history h JOIN followup_tasks f ON f.id=h.task_id
      WHERE ${visible}${projectFilter} AND h.created_at>=? AND h.created_at<?${closer.sql} AND json_extract(h.snapshot_json,'$.status')='completed'
        AND NOT EXISTS(SELECT 1 FROM followup_history prev WHERE prev.task_id=h.task_id AND prev.version=h.version-1 AND json_extract(prev.snapshot_json,'$.status')='completed') GROUP BY day`, [...values, range.startsAt, range.endsAt, ...closer.values]), 'demandsCompleted');
    // f.due_at é data civil (aaaa-mm-dd) ou vazio; "no prazo" = concluída até o fim do dia do prazo, em Brasília.
    const [due] = await all(db, `SELECT
        SUM(CASE WHEN f.due_at IS NULL OR f.due_at='' THEN 1 ELSE 0 END) no_due,
        SUM(CASE WHEN f.due_at IS NOT NULL AND f.due_at<>'' AND ${dayOf('h.created_at')}<=substr(f.due_at,1,10) THEN 1 ELSE 0 END) on_time,
        SUM(CASE WHEN f.due_at IS NOT NULL AND f.due_at<>'' AND ${dayOf('h.created_at')}>substr(f.due_at,1,10) THEN 1 ELSE 0 END) late
      FROM followup_history h JOIN followup_tasks f ON f.id=h.task_id
      WHERE ${visible}${projectFilter} AND h.created_at>=? AND h.created_at<?${closer.sql} AND json_extract(h.snapshot_json,'$.status')='completed'
        AND NOT EXISTS(SELECT 1 FROM followup_history prev WHERE prev.task_id=h.task_id AND prev.version=h.version-1 AND json_extract(prev.snapshot_json,'$.status')='completed')`, [...values, range.startsAt, range.endsAt, ...closer.values]);
    const [open] = await all(db, `SELECT COUNT(*) n FROM followup_tasks f WHERE ${visible}${projectFilter} AND f.status IN ('open','in_progress','blocked') AND f.due_at IS NOT NULL AND f.due_at<>'' AND substr(f.due_at,1,10)<?${opener.sql}`, [...values, todayInBrasilia(now), ...opener.values]);
    deadlines = { onTime: Number(due?.on_time) || 0, late: Number(due?.late) || 0, noDue: Number(due?.no_due) || 0, overdueNow: Number(open?.n) || 0 };
    }
  }

  if (wanted.includes('agenda')) {
    const scope = scoped(actor, ['reports.read', 'campaigns.manage'], 'p.id', projectId, organizationId);
    const rows = take(await all(db, `SELECT s.id,s.title,s.starts_at,s.status,p.id project_id,p.name project_name
      FROM project_schedule_items s JOIN projects p ON p.id=s.project_id
      WHERE ${scope.sql} AND s.status!='cancelled' AND substr(s.starts_at,1,10)>=? AND substr(s.starts_at,1,10)<=? ORDER BY s.starts_at DESC LIMIT ${MAX_PER_SOURCE + 1}`, [...scope.values, offsetCivilDate(range.from, -1), range.to]));
    for (const row of rows) {
      const starts = String(row.starts_at), day = isCivilDate(starts) ? starts : brasiliaDay(starts);
      if (!day || day < range.from || day > range.to) continue;
      events.push({ id: `agenda:${row.id}`, type: 'agenda', action: row.status === 'completed' ? 'Atividade realizada' : 'Atividade na agenda', title: String(row.title), detail: isCivilDate(starts) ? 'Dia inteiro' : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo', hourCycle: 'h23' }).format(new Date(starts)),
        at: isCivilDate(starts) ? `${starts}T15:00:00.000Z` : starts, day, projectId: String(row.project_id), projectName: String(row.project_name), actorId: null, actorName: '', viaRole: false, href: link('calendar', String(row.project_id)), quantity: null });
    }

    if (!person) bump(await all(db, `SELECT CASE WHEN length(s.starts_at)=10 THEN s.starts_at ELSE ${dayOf('s.starts_at')} END day,COUNT(*) n FROM project_schedule_items s JOIN projects p ON p.id=s.project_id
      WHERE ${scope.sql} AND s.status!='cancelled' AND substr(s.starts_at,1,10)>=? AND substr(s.starts_at,1,10)<=? GROUP BY day`, [...scope.values, offsetCivilDate(range.from, -1), range.to]), 'agenda');
  }

  if (wanted.includes('records')) {
    // Reaproveita a regra de leitura dos registros manuais (inclui papel por tipo de registro).
    let listed: Awaited<ReturnType<typeof listRecords>> = { records: [], limit: 100, truncated: false };
    try { listed = await listRecords(db, actor, { projectId, from: range.startsAt, to: range.endsAt, limit: 100, itemId: subject?.kind === 'item' ? subject.id : null, loanId: subject?.kind === 'loan' ? subject.id : null }); }
    catch (error) { if (!(error instanceof HttpError && error.status === 403)) throw error; } // Projeto fora do alcance: sem registros, como nas outras fontes.
    const { records, truncated: more } = listed;
    if (more) truncated = true;
    const names = await projectNames(db, records.map(record => String(record.project_id)));
    const authors = records.length ? await all(db, `SELECT id,created_by FROM records WHERE id IN (${records.map(() => '?').join(',')})`, records.map(record => record.id)) : [];
    const authorOf = new Map(authors.map(row => [String(row.id), row.created_by ? String(row.created_by) : null]));
    const written = await recordsByRole(db, records.map(record => String(record.id)));
    for (const record of records) events.push({ id: `records:${record.id}`, type: 'records', action: RECORD_LABELS[String(record.kind)] ?? 'Registro', title: String(record.title), detail: record.attachments?.length ? plural(record.attachments.length, 'anexo', 'anexos') : '',
      at: String(record.occurred_at), day: brasiliaDay(String(record.occurred_at)), projectId: String(record.project_id), projectName: names.get(String(record.project_id)) ?? '',
      actorId: authorOf.get(String(record.id)) ?? null, actorName: '', viaRole: written.has(String(record.id)), href: link('records', String(record.project_id)), quantity: null });
  }

  if (wanted.includes('convocations')) {
    // Convocações: o registro de eventos não guarda nome nem matrícula de convidados; só a ação, o projeto e quem fez.
    const scope = scoped(actor, ['reports.read', 'campaigns.manage'], 'p.id', projectId);
    const rows = take(await all(db, `SELECT e.id,e.kind,e.created_at,e.actor_id,e.details,c.id convocation_id,c.title,p.id project_id,p.name project_name,gp.name guest_project
      FROM convocation_events e JOIN convocations c ON c.id=e.convocation_id JOIN projects p ON p.id=c.project_id LEFT JOIN projects gp ON gp.id=e.project_id
      WHERE ${scope.sql} AND e.created_at>=? AND e.created_at<? ORDER BY e.created_at DESC LIMIT ${MAX_PER_SOURCE + 1}`, [...scope.values, range.startsAt, range.endsAt]));
    for (const row of rows) {
      let details: Row = {}; try { details = JSON.parse(String(row.details ?? '{}')); } catch { /* registro antigo */ }
      const answer = CONVOCATION_ANSWERS[String(details.response ?? '')] ?? '';
      const detail = row.kind === 'response_created' || row.kind === 'response_updated' ? [answer, row.guest_project ? String(row.guest_project) : ''].filter(Boolean).join(' · ')
        : row.kind === 'invite_created' ? plural(Number(details.maxUses ?? 0), 'resposta no máximo', 'respostas no máximo') : row.kind === 'purged' ? plural(Number(details.removed ?? 0), 'resposta apagada', 'respostas apagadas') : '';
      events.push({ id: `convocations:${row.id}`, type: 'convocations', action: CONVOCATION_LABELS[String(row.kind)] ?? 'Convocação', title: String(row.title), detail,
        at: String(row.created_at), day: brasiliaDay(String(row.created_at)), projectId: String(row.project_id), projectName: String(row.project_name),
        actorId: row.actor_id ? String(row.actor_id) : null, actorName: row.actor_id ? '' : 'Convidado(a) pelo link', viaRole: false,
        href: `/?module=convocations&convocation=${encodeURIComponent(String(row.convocation_id))}`, quantity: null });
    }
  }

  if (wanted.includes('access')) {
    // Acessos de voluntário por ação: concessão, vencimento (o prazo encerra sozinho) e encerramento antecipado.
    const scope = scoped(actor, ['access.manage', 'campaigns.manage'], 'p.id', projectId, organizationId), campaign = about('campaign', 'v.campaign_id');
    const rows = take(await all(db, `SELECT v.id,v.created_at,v.granted_by,v.ends_at,v.revoked_at,v.revoked_by,v.revoke_reason,c.name campaign_name,p.id project_id,p.name project_name,
        COALESCE(NULLIF(pr.display_name,''),'Voluntário(a)') person
      FROM campaign_volunteers v JOIN campaigns c ON c.id=v.campaign_id JOIN projects p ON p.id=v.project_id LEFT JOIN profiles pr ON pr.user_id=v.user_id
      WHERE ${scope.sql}${campaign.sql} AND ((v.created_at>=? AND v.created_at<?) OR (v.revoked_at>=? AND v.revoked_at<?))
      ORDER BY COALESCE(v.revoked_at,v.created_at) DESC LIMIT ${MAX_PER_SOURCE + 1}`, [...scope.values, ...campaign.values, range.startsAt, range.endsAt, range.startsAt, range.endsAt]));
    const until = (iso: string) => { const time = Date.parse(iso); return Number.isFinite(time) ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(new Date(time)).replace(',', ' às') : ''; };
    const inRange = (at: unknown) => typeof at === 'string' && at >= range.startsAt && at < range.endsAt;
    for (const row of rows) {
      const base = { type: 'access' as const, title: String(row.campaign_name), projectId: String(row.project_id), projectName: String(row.project_name), viaRole: false, href: link('team', String(row.project_id)), quantity: null };
      if (inRange(row.created_at)) events.push({ ...base, id: `access:${row.id}:grant`, action: 'Voluntário recebeu acesso', detail: `${row.person} · até ${until(String(row.ends_at))}`,
        at: String(row.created_at), day: brasiliaDay(String(row.created_at)), actorId: row.granted_by ? String(row.granted_by) : null, actorName: '' });
      if (inRange(row.revoked_at)) events.push({ ...base, id: `access:${row.id}:end`, action: row.revoke_reason === 'expired' ? 'Acesso de voluntário venceu' : 'Acesso de voluntário encerrado',
        detail: row.revoke_reason === 'expired' ? `${row.person} · o prazo terminou` : String(row.person), at: String(row.revoked_at), day: brasiliaDay(String(row.revoked_at)),
        actorId: row.revoke_reason === 'expired' || !row.revoked_by ? null : String(row.revoked_by), actorName: row.revoke_reason === 'expired' ? 'Prazo do acesso' : '' });
    }
  }

  // Configuração de IA: limites, funções e permissões, com antes e depois. Visível só para quem
  // pode configurar a IA daquela organização (ou a administração geral); não pertence a projeto.
  const configurable: Row[] = [];
  for (const organization of await all(db, "SELECT id,name FROM organizations WHERE status='active' ORDER BY name")) {
    const auth = aiConfigurationAuthority(actor, String(organization.id));
    if ((await all(db, `SELECT 1 WHERE ${auth.sql}`, auth.values)).length) configurable.push(organization);
    if (configurable.length && !(wanted.includes('ai') && !projectId)) break; // basta saber que o tipo aparece
  }
  if (wanted.includes('ai') && !projectId && configurable.length) {
    const names = new Map(configurable.map(row => [String(row.id), String(row.name)]));
    const rows = take(await all(db, `SELECT id,actor_id,organization_id,action,details,created_at FROM audit
      WHERE action IN ('assistant.configure','assistant.grant.create','assistant.grant.revoke','assistant.route.fallback') AND organization_id IN (${configurable.map(() => '?').join(',')})
      AND created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT ${MAX_PER_SOURCE + 1}`, [...configurable.map(row => row.id), range.startsAt, range.endsAt]));
    for (const row of rows) events.push({ id: `ai:${row.id}`, type: 'ai', ...aiConfigurationEvent(String(row.action), String(row.details ?? '{}')),
      at: String(row.created_at), day: brasiliaDay(String(row.created_at)), projectId: null, projectName: names.get(String(row.organization_id)) ?? '',
      // O aviso de queda não tem autoria: quem só usou a IA naquele momento não mudou configuração nenhuma.
      actorId: row.actor_id && row.action !== 'assistant.route.fallback' ? String(row.actor_id) : null, actorName: '', viaRole: false, href: '/?module=settings', quantity: null });
  }

  // Nomes só das pessoas que aparecem em eventos já autorizados; conta removida não tem nome.
  const ids = [...new Set(events.flatMap(event => [event.actorId, event.statusById ?? null]).filter((id): id is string => Boolean(id)))];
  const people = ids.length ? await all(db, `SELECT u.user_id id,COALESCE(NULLIF(pr.display_name,''),'Pessoa da equipe') name FROM portal_users u LEFT JOIN profiles pr ON pr.user_id=u.user_id
    WHERE u.user_id IN (${ids.map(() => '?').join(',')}) AND u.anonymized_at IS NULL`, ids) : [];
  const nameOf = new Map(people.map(row => [String(row.id), String(row.name)]));
  // Conta anonimizada: sem nome e sem identificador, para as ações dela não ficarem ligadas entre si.
  for (const event of events) {
    if (event.actorId && !nameOf.has(event.actorId)) { event.actorId = null; event.actorName = 'Pessoa removida'; }
    else event.actorName = event.actorId ? nameOf.get(event.actorId)! : event.actorName;
    if (event.status) { if (event.statusById && !nameOf.has(event.statusById)) { event.statusById = null; event.statusBy = 'Pessoa removida'; } else event.statusBy = event.statusById ? nameOf.get(event.statusById)! : ''; }
  }
  const filtered = person ? (nameOf.has(person) ? events.filter(event => event.actorId === person) : []) : events;
  filtered.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  let team: ActivityFeed['team'] = null;
  const managing = scoped(actor, ['access.manage'], 'p.id', projectId, organizationId);
  const managed = new Set((await all(db, `SELECT p.id FROM projects p WHERE ${managing.sql}`, managing.values)).map(row => String(row.id)));
  if (managed.size && !subject) {
    const perPerson = new Map<string, { days: Set<string>; actions: number; last: string }>(), activeByDay = new Map<string, Set<string>>();
    for (const event of filtered) {
      if (!event.actorId || !event.projectId || !managed.has(event.projectId) || event.type === 'agenda') continue;
      const entry = perPerson.get(event.actorId) ?? { days: new Set<string>(), actions: 0, last: '' };
      entry.days.add(event.day); entry.actions++; if (event.at > entry.last) entry.last = event.at;
      perPerson.set(event.actorId, entry);
      activeByDay.set(event.day, (activeByDay.get(event.day) ?? new Set()).add(event.actorId));
    }
    team = { activePeople: perPerson.size, perDay: range.days.map(day => ({ day, people: activeByDay.get(day)?.size ?? 0 })),
      people: [...perPerson].map(([id, entry]) => ({ id, name: nameOf.get(id) ?? 'Pessoa da equipe', days: entry.days.size, actions: entry.actions, last: entry.last }))
        .sort((a, b) => b.days - a.days || b.actions - a.actions || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 20) };
  }
  if (filtered.length > MAX_EVENTS) truncated = true;
  return { range: { from: range.from, to: range.to, days: range.days }, types: wanted, events: filtered.slice(0, MAX_EVENTS), truncated, subject: subject ? { ...subject, name: await subjectName(db, actor, subject, projectId, organizationId) } : null,
    people: [...nameOf].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), loansNow, aiVisible: configurable.length > 0,
    summary: { days: [...perDay.values()], stock }, deadlines, team };
}

/** Nome do assunto, só para quem pode lê-lo no módulo de origem. Fora do alcance e inexistente respondem igual: sem nome. */
async function subjectName(
  db: D1Database, actor: PortalActor, subject: { kind: ActivitySubjectKind; id: string },
  projectId: string | null, organizationId: string | null,
): Promise<string> {
  if (subject.kind === 'task') {
    const projectFilter = projectId ? ' AND f.project_id=?' : '';
    const organizationFilter = organizationId ? ' AND f.organization_id=?' : '';
    const [row] = await all(db, `SELECT f.title name FROM followup_tasks f WHERE ${followupAuthority('?', 'f.organization_id', 'f.project_id')} AND f.id=?${projectFilter}${organizationFilter} LIMIT 1`,
      [actor.userId, subject.id, ...(projectId ? [projectId] : []), ...(organizationId ? [organizationId] : [])]);
    return row ? String(row.name) : '';
  }
  // Material: quem lê o estoque vê qualquer material do projeto; quem só lê empréstimos vê equipamentos, como no módulo.
  const sources = { item: [{ capabilities: ['inventory.read'], from: 'items s JOIN projects p ON p.id=s.project_id', name: 's.name', extra: '' }, { capabilities: ['loans.read'], from: 'items s JOIN projects p ON p.id=s.project_id', name: 's.name', extra: " AND s.category='equipment'" }],
    loan: [{ capabilities: ['loans.read'], from: 'loans s JOIN items i ON i.id=s.item_id AND i.project_id=s.project_id JOIN projects p ON p.id=s.project_id', name: 'i.name', extra: '' }],
    campaign: [{ capabilities: ['campaigns.manage', 'access.manage', 'reports.read'], from: 'campaigns s JOIN projects p ON p.id=s.project_id', name: 's.name', extra: '' }] }[subject.kind];
  for (const source of sources) {
    const scope = scoped(actor, source.capabilities, 'p.id', projectId, organizationId);
    const [row] = await all(db, `SELECT ${source.name} name FROM ${source.from} WHERE ${scope.sql}${source.extra} AND s.id=? LIMIT 1`, [...scope.values, subject.id]);
    if (row) return String(row.name);
  }
  return '';
}

const LIMIT_FIELDS = new Set(['dailyUsdMicros', 'dailyTokens', 'dailyCalls', 'dailyMs', 'timeoutMs', 'maxOutputTokens']);
const ROUTED_TASK_LABELS: Record<string, string> = { document: 'documentos', decision: 'conferência e triagem', speech: 'voz' };
/** Texto de um registro de configuração de IA: o que mudou, de quanto para quanto. Sem chave nem identificador. */
export function aiConfigurationEvent(action: string, raw: string): { action: string; title: string; detail: string } {
  if (action === 'assistant.grant.create') return { action: 'Configuração de IA', title: 'Permissão para configurar concedida', detail: '' };
  if (action === 'assistant.grant.revoke') return { action: 'Configuração de IA', title: 'Permissão para configurar revogada', detail: '' };
  let details: Record<string, unknown> = {};
  try { const parsed: unknown = JSON.parse(raw); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) details = parsed as Record<string, unknown>; } catch { /* registro antigo sem detalhes */ }
  if (action === 'assistant.route.fallback') {
    // O modelo escolhido para a tarefa não recebeu o pedido (ou recusou) e a tarefa seguiu pelo padrão.
    // É um aviso, não uma mudança de configuração. O nome vem do registro; registro antigo só tem o código.
    const task = ROUTED_TASK_LABELS[String(details.task)] ?? 'uma tarefa com IA';
    const code = typeof details.model === 'string' ? details.model.slice(0, 60) : '';
    const name = typeof details.name === 'string' && details.name ? details.name.slice(0, 120) : code ? builtinModelName(code) ?? code : '';
    const lines = [name ? `Modelo: ${name}` : '', typeof details.reason === 'string' && details.reason ? `Motivo: ${details.reason.slice(0, 200)}` : '', 'O portal usou o padrão.'];
    return { action: 'Aviso de IA', title: `O modelo escolhido para ${task} não respondeu`, detail: lines.filter(Boolean).join('\n') };
  }
  const known = new Set(CONFIG_FIELDS.map(field => String(field.key)));
  const changes = Array.isArray(details.changes) ? (details.changes as ConfigChange[]).filter(change => change && known.has(String(change.field))) : null;
  if (!changes) return { action: 'Configuração de IA', title: 'Configuração salva', detail: 'Registro anterior ao histórico detalhado' };
  if (!changes.length) return { action: 'Configuração de IA', title: 'Configuração salva', detail: 'Nenhum valor mudou' };
  const test = changes.find(change => change.field === 'testMode');
  const title = test ? (test.after ? 'Modo de testes ligado' : 'Modo de testes desligado') : changes.every(change => LIMIT_FIELDS.has(change.field)) ? 'Limites alterados' : changes.some(change => LIMIT_FIELDS.has(change.field)) ? 'Funções e limites alterados' : 'Funções alteradas';
  // Uma mudança por linha (a tela mostra cada uma em sua linha).
  const modelNames = details.modelNames && typeof details.modelNames === 'object' && !Array.isArray(details.modelNames) ? Object.fromEntries(Object.entries(details.modelNames as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1])) : {};
  const lines = changes.filter(change => change.field !== 'testMode').map(change => describeChange(change, modelNames)).filter(Boolean);
  return { action: 'Configuração de IA', title, detail: lines.length > 6 ? [...lines.slice(0, 6), `e mais ${lines.length - 6}`].join('\n') : lines.join('\n') };
}

async function projectNames(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await all(db, `SELECT id,name FROM projects WHERE id IN (${unique.map(() => '?').join(',')})`, unique);
  return new Map(rows.map(row => [String(row.id), String(row.name)]));
}
