import { aiConfigurationAuthority, projectAuthoritySql, type PortalActor } from './access';
import { describeChange, CONFIG_FIELDS, type ConfigChange } from './assistant/quota';
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
export const ACTIVITY_TYPES = ['materials', 'loans', 'demands', 'agenda', 'records', 'ai'] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];
export type ActivityEvent = {
  id: string; type: ActivityType; action: string; title: string; detail: string;
  at: string; day: string; projectId: string | null; projectName: string;
  actorId: string | null; actorName: string; viaRole: boolean; href: string | null; quantity: number | null;
};
export type ActivityFeed = {
  range: { from: string; to: string; days: string[] };
  types: ActivityType[];
  events: ActivityEvent[];
  truncated: boolean;
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
const link = (module: string, projectId: string | null, extra = '') => projectId ? `/?module=${module}&project=${encodeURIComponent(projectId)}${extra}` : `/?module=${module}`;
const plural = (count: number, one: string, many: string) => `${count} ${Math.abs(count) === 1 ? one : many}`;
const MOVEMENT_LABELS: Record<string, string> = { receive: 'Entrada', distribute: 'Distribuição', consume: 'Consumo', adjust: 'Ajuste', redeem: 'Brinde entregue', reserve: 'Reserva', release: 'Reserva liberada' };
const RECORD_LABELS: Record<string, string> = { observation: 'Observação', maintenance: 'Manutenção', distribution: 'Distribuição', consumption: 'Consumo', project: 'Atividade do projeto', material: 'Material', loan: 'Empréstimo' };

type Source = { sql: string; values: unknown[] };
const dayOf = (column: string) => `date(datetime(${column},'-${ZONE_OFFSET_HOURS} hours'))`;
function scoped(actor: PortalActor, capabilities: string[], projectSql: string, projectId: string | null): Source {
  const auth = projectAuthoritySql(actor, capabilities, projectSql);
  return projectId ? { sql: `(${auth.sql}) AND ${projectSql}=?`, values: [...auth.values, projectId] } : { sql: auth.sql, values: auth.values };
}

export async function activityFeed(db: D1Database, actor: PortalActor | null, input: Record<string, unknown> = {}, now = Date.now()): Promise<ActivityFeed> {
  if (!actor) throw new HttpError(401, 'Entre para consultar os registros.', 'unauthenticated');
  const range = activityRange(input.from, input.to, now), wanted = types(input.types);
  const projectId = optionalId(input.projectId, 'o projeto');
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
    const scope = scoped(actor, ['inventory.read'], 'p.id', projectId);
    const rows = take(await all(db, `SELECT m.id,m.kind,m.delta,m.created_at,m.actor_id,m.ref_id,i.id item_id,i.name item_name,i.unit,p.id project_id,p.name project_name
      FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id
      WHERE ${scope.sql} AND m.created_at>=? AND m.created_at<? ORDER BY m.created_at DESC LIMIT ${MAX_PER_SOURCE + 1}`, [...scope.values, range.startsAt, range.endsAt]));
    for (const row of rows) {
      const delta = Number(row.delta) || 0, unitName = String(row.unit || 'unidade'), unit = Math.abs(delta) === 1 || /s$/i.test(unitName) ? unitName : `${unitName}s`;
      events.push({ id: `materials:${row.id}`, type: 'materials', action: MOVEMENT_LABELS[String(row.kind)] ?? 'Movimentação', title: String(row.item_name), detail: `${delta > 0 ? '+' : ''}${delta} ${unit}`,
        at: String(row.created_at), day: brasiliaDay(String(row.created_at)), projectId: String(row.project_id), projectName: String(row.project_name),
        actorId: row.actor_id ? String(row.actor_id) : null, actorName: '', viaRole: /^manual:[^:]+:ai_/.test(String(row.ref_id ?? '')),
        href: link('materials', String(row.project_id), `&itemId=${encodeURIComponent(String(row.item_id))}`), quantity: delta });
    }

    const who = actorFilter('m.actor_id');
    bump(await all(db, `SELECT ${dayOf('m.created_at')} day,COUNT(*) n FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id
      WHERE ${scope.sql} AND m.created_at>=? AND m.created_at<?${who.sql} GROUP BY day`, [...scope.values, range.startsAt, range.endsAt, ...who.values]), 'materials');
    stock = (await all(db, `SELECT i.id item_id,i.name,p.id project_id,SUM(CASE WHEN m.delta>0 THEN m.delta ELSE 0 END) entradas,SUM(CASE WHEN m.delta<0 THEN -m.delta ELSE 0 END) saidas
      FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id
      WHERE ${scope.sql} AND m.created_at>=? AND m.created_at<?${who.sql} GROUP BY i.id ORDER BY entradas+saidas DESC,i.name LIMIT 8`, [...scope.values, range.startsAt, range.endsAt, ...who.values]))
      .map(row => ({ name: String(row.name), projectId: String(row.project_id), href: link('materials', String(row.project_id), `&itemId=${encodeURIComponent(String(row.item_id))}`), entradas: Number(row.entradas) || 0, saidas: Number(row.saidas) || 0 }));
  }

  if (wanted.includes('loans')) {
    const scope = scoped(actor, ['loans.read'], 'p.id', projectId);
    const rows = take(await all(db, `SELECT l.id,l.status,l.action_name,l.created_at,l.checked_out_at,l.returned_at,l.ends_at,l.created_by,i.name item_name,p.id project_id,p.name project_name
      FROM loans l JOIN items i ON i.id=l.item_id AND i.project_id=l.project_id JOIN projects p ON p.id=l.project_id
      WHERE ${scope.sql} AND ((l.created_at>=? AND l.created_at<?) OR (l.checked_out_at>=? AND l.checked_out_at<?) OR (l.returned_at>=? AND l.returned_at<?))
      ORDER BY COALESCE(l.returned_at,l.checked_out_at,l.created_at) DESC LIMIT ${MAX_PER_SOURCE + 1}`,
    [...scope.values, range.startsAt, range.endsAt, range.startsAt, range.endsAt, range.startsAt, range.endsAt]));
    for (const row of rows) {
      const base = { type: 'loans' as const, title: String(row.item_name), detail: String(row.action_name || ''), projectId: String(row.project_id), projectName: String(row.project_name),
        actorName: '', viaRole: false, href: link('loans', String(row.project_id), `&loanId=${encodeURIComponent(String(row.id))}`), quantity: null };
      const within = (value: unknown) => typeof value === 'string' && value >= range.startsAt && value < range.endsAt;
      if (within(row.created_at)) events.push({ ...base, id: `loans:${row.id}:created`, action: 'Reserva registrada', at: String(row.created_at), day: brasiliaDay(String(row.created_at)), actorId: row.created_by ? String(row.created_by) : null });
      if (within(row.checked_out_at)) events.push({ ...base, id: `loans:${row.id}:out`, action: 'Retirada', at: String(row.checked_out_at), day: brasiliaDay(String(row.checked_out_at)), actorId: null });
      if (within(row.returned_at)) events.push({ ...base, id: `loans:${row.id}:returned`, action: 'Devolução', at: String(row.returned_at), day: brasiliaDay(String(row.returned_at)), actorId: null });
    }
    const reachable = scoped(actor, ['loans.read'], 'p.id', projectId);
    if ((await all(db, `SELECT 1 FROM projects p WHERE ${reachable.sql} LIMIT 1`, reachable.values)).length) {
    // loans.ends_at é inteiro (milissegundos): comparar com número, nunca com texto ISO.
    const current = scoped(actor, ['loans.read'], 'l.project_id', projectId);
    const [counts] = await all(db, `SELECT SUM(CASE WHEN l.status IN ('reserved','out') THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN l.status='out' AND CAST(l.ends_at AS INTEGER)<? THEN 1 ELSE 0 END) late FROM loans l WHERE ${current.sql}`, [now, ...current.values]);
    loansNow = { active: Number(counts?.active) || 0, late: Number(counts?.late) || 0 };
    }
  }

  if (wanted.includes('demands')) {
    const visible = followupAuthority('?', 'f.organization_id', 'f.project_id'), projectFilter = projectId ? ' AND f.project_id=?' : '';
    const values = [actor.userId, ...(projectId ? [projectId] : [])];
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

  if (wanted.includes('agenda')) {
    const scope = scoped(actor, ['reports.read', 'campaigns.manage'], 'p.id', projectId);
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
    try { listed = await listRecords(db, actor, { projectId, from: range.startsAt, to: range.endsAt, limit: 100 }); }
    catch (error) { if (!(error instanceof HttpError && error.status === 403)) throw error; } // Projeto fora do alcance: sem registros, como nas outras fontes.
    const { records, truncated: more } = listed;
    if (more) truncated = true;
    const names = await projectNames(db, records.map(record => String(record.project_id)));
    const authors = records.length ? await all(db, `SELECT id,created_by FROM records WHERE id IN (${records.map(() => '?').join(',')})`, records.map(record => record.id)) : [];
    const authorOf = new Map(authors.map(row => [String(row.id), row.created_by ? String(row.created_by) : null]));
    for (const record of records) events.push({ id: `records:${record.id}`, type: 'records', action: RECORD_LABELS[String(record.kind)] ?? 'Registro', title: String(record.title), detail: record.attachments?.length ? plural(record.attachments.length, 'anexo', 'anexos') : '',
      at: String(record.occurred_at), day: brasiliaDay(String(record.occurred_at)), projectId: String(record.project_id), projectName: names.get(String(record.project_id)) ?? '',
      actorId: authorOf.get(String(record.id)) ?? null, actorName: '', viaRole: false, href: link('records', String(record.project_id)), quantity: null });
  }

  // Configuração de IA: limites, funções e permissões, com antes e depois. Visível só para quem
  // pode configurar a IA daquela organização (ou a administração geral); não pertence a projeto.
  const configurable: Row[] = [];
  for (const organization of await all(db, "SELECT id,name FROM organizations WHERE status='active' ORDER BY name LIMIT 50")) {
    const auth = aiConfigurationAuthority(actor, String(organization.id));
    if ((await all(db, `SELECT 1 WHERE ${auth.sql}`, auth.values)).length) configurable.push(organization);
  }
  if (wanted.includes('ai') && !projectId && configurable.length) {
    const names = new Map(configurable.map(row => [String(row.id), String(row.name)]));
    const rows = take(await all(db, `SELECT id,actor_id,organization_id,action,details,created_at FROM audit
      WHERE action IN ('assistant.configure','assistant.grant.create','assistant.grant.revoke') AND organization_id IN (${configurable.map(() => '?').join(',')})
      AND created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT ${MAX_PER_SOURCE + 1}`, [...configurable.map(row => row.id), range.startsAt, range.endsAt]));
    for (const row of rows) events.push({ id: `ai:${row.id}`, type: 'ai', ...aiConfigurationEvent(String(row.action), String(row.details ?? '{}')),
      at: String(row.created_at), day: brasiliaDay(String(row.created_at)), projectId: null, projectName: names.get(String(row.organization_id)) ?? '',
      actorId: row.actor_id ? String(row.actor_id) : null, actorName: '', viaRole: false, href: '/?module=settings', quantity: null });
  }

  // Nomes só das pessoas que aparecem em eventos já autorizados; conta removida não tem nome.
  const ids = [...new Set(events.map(event => event.actorId).filter((id): id is string => Boolean(id)))];
  const people = ids.length ? await all(db, `SELECT u.user_id id,COALESCE(NULLIF(pr.display_name,''),'Pessoa da equipe') name FROM portal_users u LEFT JOIN profiles pr ON pr.user_id=u.user_id
    WHERE u.user_id IN (${ids.map(() => '?').join(',')}) AND u.anonymized_at IS NULL`, ids) : [];
  const nameOf = new Map(people.map(row => [String(row.id), String(row.name)]));
  // Conta anonimizada: sem nome e sem identificador, para as ações dela não ficarem ligadas entre si.
  for (const event of events) {
    if (event.actorId && !nameOf.has(event.actorId)) { event.actorId = null; event.actorName = 'Pessoa removida'; }
    else event.actorName = event.actorId ? nameOf.get(event.actorId)! : '';
  }
  const filtered = person ? (nameOf.has(person) ? events.filter(event => event.actorId === person) : []) : events;
  filtered.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  let team: ActivityFeed['team'] = null;
  const managing = scoped(actor, ['access.manage'], 'p.id', projectId);
  const managed = new Set((await all(db, `SELECT p.id FROM projects p WHERE ${managing.sql}`, managing.values)).map(row => String(row.id)));
  if (managed.size) {
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
  return { range: { from: range.from, to: range.to, days: range.days }, types: wanted, events: filtered.slice(0, MAX_EVENTS), truncated,
    people: [...nameOf].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), loansNow, aiVisible: configurable.length > 0,
    summary: { days: [...perDay.values()], stock }, deadlines, team };
}

const LIMIT_FIELDS = new Set(['dailyUsdMicros', 'dailyTokens', 'dailyCalls', 'dailyMs', 'timeoutMs', 'maxOutputTokens']);
/** Texto de um registro de configuração de IA: o que mudou, de quanto para quanto. Sem chave nem identificador. */
export function aiConfigurationEvent(action: string, raw: string): { action: string; title: string; detail: string } {
  if (action === 'assistant.grant.create') return { action: 'Configuração de IA', title: 'Permissão para configurar concedida', detail: '' };
  if (action === 'assistant.grant.revoke') return { action: 'Configuração de IA', title: 'Permissão para configurar revogada', detail: '' };
  let details: Record<string, unknown> = {};
  try { const parsed: unknown = JSON.parse(raw); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) details = parsed as Record<string, unknown>; } catch { /* registro antigo sem detalhes */ }
  const known = new Set(CONFIG_FIELDS.map(field => String(field.key)));
  const changes = Array.isArray(details.changes) ? (details.changes as ConfigChange[]).filter(change => change && known.has(String(change.field))) : null;
  if (!changes) return { action: 'Configuração de IA', title: 'Configuração salva', detail: 'Registro anterior ao histórico detalhado' };
  if (!changes.length) return { action: 'Configuração de IA', title: 'Configuração salva', detail: 'Nenhum valor mudou' };
  const test = changes.find(change => change.field === 'testMode');
  const title = test ? (test.after ? 'Modo de testes ligado' : 'Modo de testes desligado') : changes.every(change => LIMIT_FIELDS.has(change.field)) ? 'Limites alterados' : changes.some(change => LIMIT_FIELDS.has(change.field)) ? 'Funções e limites alterados' : 'Funções alteradas';
  const lines = changes.filter(change => change.field !== 'testMode').map(describeChange).filter(Boolean);
  return { action: 'Configuração de IA', title, detail: lines.length > 5 ? `${lines.slice(0, 5).join(' · ')} · e mais ${lines.length - 5}` : lines.join(' · ') };
}

async function projectNames(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await all(db, `SELECT id,name FROM projects WHERE id IN (${unique.map(() => '?').join(',')})`, unique);
  return new Map(rows.map(row => [String(row.id), String(row.name)]));
}
