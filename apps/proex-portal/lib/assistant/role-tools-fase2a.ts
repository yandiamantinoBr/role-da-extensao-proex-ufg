/**
 * Ferramentas de leitura do Rolê para Projetos, Demandas e Agenda (Fase 2a).
 * Mesma política das telas: projetos por projectAuthoritySql (lib/access.ts, como projectSummary em
 * lib/projects.ts), demandas por authority (lib/follow-up/scope.ts, como Demandas e Meu trabalho) e
 * agenda por calendarEntries (lib/calendar.ts, a própria tela Agenda). Cada chamada reconfere o acesso
 * no SQL. Nada é gravado. Não saem nomes, e-mails nem identificadores de pessoas: só "responsável definido".
 *
 * Este arquivo não importa valores de role-tools.ts (evita importação circular): o despachante de lá
 * entrega pack e visibleProjects em `ctx`.
 */
import { projectAuthoritySql, type PortalActor } from '../access';
import { all, type Row } from '../database';
import { HttpError } from '../errors';
import { calendarEntries, calendarRange, type CalendarEntry } from '../calendar';
import { activeAccount, authority, assignedRecipient, publicTaskAuthority } from '../follow-up/scope';
import { serverWorkClock } from '../follow-up/time';
import { responsibilityRead, taskDirect } from '../responsibilities/scope';
import type { ResolvedScope, RoleToolResult, RoleToolSource } from './role-tools';

/**
 * ÚNICO ponto de visibilidade de demanda destas ferramentas. Toda leitura de followup_tasks aqui passa
 * por esta condição. Demanda privada (PR #212) nunca vai para o Rolê, nem para quem participa:
 * `publicTaskAuthority` é o `authority` com a exclusão de `followup_task_privacy`.
 */
export const roleTaskVisible = (userSql: string, alias = 't') => publicTaskAuthority(userSql, alias);

const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const fn = (name: string, description: string, properties: Record<string, unknown>) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, additionalProperties: false } } });
const projeto = { type: 'string', description: 'Nome ou sigla do projeto.', maxLength: 120 };
export const FASE2A_TOOLS = [
  fn('consultar_projetos', 'Projetos visíveis: tipo, fase, unidade, se há responsável, demandas abertas e atrasadas, próximos eventos. Um projeto só: a ficha.', { projeto }),
  fn('filtrar_demandas', 'Demandas comigo (eu ou minha equipe), atrasadas (prazo vencido), por projeto e situação.', { projeto, comigo: { type: 'boolean' }, atrasadas: { type: 'boolean' }, situacao: { type: 'string', enum: ['abertas', 'em_andamento', 'bloqueadas', 'concluidas', 'todas'] } }),
  fn('minha_agenda', 'Atividades, eventos e turnos dos meus projetos e prazos das minhas demandas. Sem datas: esta semana. Prazo citado: use as datas dele.', { de: day, ate: day, projeto }),
];
export const FASE2A_TOOL_NAMES = FASE2A_TOOLS.map(tool => tool.function.name);

type Pack = (kind: string, items: Record<string, unknown>[], sources: RoleToolSource[], budget: number, note?: string, extra?: Record<string, unknown>) => RoleToolResult;
export type Fase2aContext = { db: D1Database; actor: PortalActor; organizationId: string; args: Record<string, unknown>; budget: number; scope: ResolvedScope | null; pack: Pack; visibleProjects: (wanted: string) => Promise<Map<string, string>> };

const ARGS: Record<string, string[]> = { consultar_projetos: ['projeto'], filtrar_demandas: ['projeto', 'comigo', 'atrasadas', 'situacao'], minha_agenda: ['de', 'ate', 'projeto'] };

/* ---------- Nome de projeto: palavra inteira, aceitando letra, sigla curta e número ---------- */
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas', 'para', 'com', 'por', 'um', 'uma']);
const words = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** Letra, sigla curta ou número: só a palavra inteira ("B" não casa com "Bem-Estar"). Palavras longas aceitam plural e abreviação. */
const wordHit = (word: string, own: string[]) => word.length < 4 || /\d/.test(word) ? own.includes(word) : own.some(name => name === word || (name.length >= 4 && (name.startsWith(word) || word.startsWith(name))));
/**
 * Filtra projetos pelo nome pedido. Corrige o descarte de palavras curtas de terms() (role-tools.ts) só para
 * nome de projeto: "Projeto B" devolve B e só B; "Projeto A" não some porque "a" é palavra comum. Primeiro
 * tenta com todas as palavras; sem resultado, tenta sem as palavras comuns. Nome idêntico tem preferência.
 */
export function matchProjectNames<T extends Record<string, unknown>>(rows: T[], wanted: string): T[] {
  const query = words(wanted);
  if (!query.length) return rows;
  const attempt = (list: string[]) => { const need = list.length <= 2 ? list.length : Math.ceil(list.length * 0.6); return rows.filter(row => { const own = words(`${row.name} ${row.short_name ?? ''} ${row.id}`); return list.filter(word => wordHit(word, own)).length >= need; }); };
  let found = attempt(query);
  // A letra final fica ("Projeto A" nunca vira "projeto", que casaria com todos).
  const content = query.filter((word, index) => !STOP.has(word) || (word.length === 1 && index === query.length - 1));
  if (!found.length && content.length && content.length < query.length) found = attempt(content);
  // Nome ou sigla idênticos ao pedido têm preferência ("PB" é o Programa de Bolsas, não "PB Extra").
  const exact = found.filter(row => [row.name, row.short_name].some(label => label && words(String(label)).join(' ') === query.join(' ')));
  return exact.length ? exact : found;
}

/* ---------- Apoio ---------- */
const inList = (ids: string[]) => ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)';
const projectLink = (id: string) => `/?module=projects&project=${encodeURIComponent(id)}&detailProject=${encodeURIComponent(id)}`;
const demandLink = (row: Row) => `/?module=demands${row.project_id ? `&project=${encodeURIComponent(String(row.project_id))}` : ''}&demandId=${encodeURIComponent(String(row.id))}`;
const STATUS: Record<string, string> = { open: 'aberta', in_progress: 'em andamento', blocked: 'bloqueada', completed: 'concluída', cancelled: 'cancelada' };
const PRIORITY: Record<string, string> = { high: 'alta', medium: 'média', low: 'baixa' };
const LIFECYCLE: Record<string, string> = { active: 'em andamento', past: 'encerrado', catalog: 'catálogo' };
const brDay = (value: unknown) => { const raw = String(value ?? ''); return /^\d{4}-\d{2}-\d{2}/.test(raw) ? `${raw.slice(8, 10)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}` : raw; };
const brWhen = (iso: string, allDay: boolean) => allDay ? `${brDay(iso)} (dia inteiro)` : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
const addDays = (value: string, days: number) => new Date(Date.parse(`${value}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function optionalText(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 120) throw new HttpError(400, `Confira ${label}.`, 'role_tool_input');
  return value.trim();
}
function flag(value: unknown, label: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new HttpError(400, `Use verdadeiro ou falso em ${label}.`, 'role_tool_input');
  return value;
}
const ENTRY_KIND: Record<string, string> = { 'project-schedule': 'atividade', campaign: 'evento', 'campaign-session': 'turno' };
/**
 * Atividades, eventos e turnos pela própria tela Agenda (categoria Projetos e eventos), filtrada no serviço por
 * projeto (um só) ou unidade (escopo da conversa) para não varrer o banco. calendarEntries não aceita organização:
 * o filtro por organização é a lista `ids`. Sem Agenda para a pessoa (403) ou com registros demais (422): null.
 */
async function agendaEntries(ctx: Fase2aContext, from: string, to: string, ids: string[]): Promise<CalendarEntry[] | null> {
  const allowed = new Set(ids), filter = ids.length === 1 ? { projectId: ids[0] } : ctx.scope?.kind === 'unit' && ctx.scope.id ? { unitId: ctx.scope.id } : {};
  try {
    const { entries } = await calendarEntries(ctx.db, ctx.actor, { category: 'projects', ...filter, range: calendarRange(from, to) });
    return entries.filter(entry => ENTRY_KIND[entry.sourceKind] && allowed.has(entry.projectId) && entry.status !== 'CANCELLED');
  } catch (error) { if (error instanceof HttpError && (error.status === 403 || error.status === 422)) return null; throw error; }
}
/** Até 5 projetos na lista: agenda consultada projeto a projeto. Acima disso a lista não traz eventos. */
const AGENDA_LIST_LIMIT = 5;
/** Uma fonte por link, só das que aparecem nos itens. */
const uniqueSources = (sources: RoleToolSource[]) => [...new Map(sources.map(source => [source.href, source])).values()];
/** Mesmo critério de responsável visível da tela de Demandas (lib/follow-up/service.ts): conta ativa com acesso ou equipe ativa. */
const liveAssignee = (a: string, orgSql: string, projectSql: string) => `((${a}.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM portal_users person WHERE person.user_id=${a}.user_id AND ${activeAccount('person')}) AND ${authority(`${a}.user_id`, orgSql, projectSql)})
  OR EXISTS(SELECT 1 FROM followup_teams team WHERE team.id=${a}.team_id AND team.organization_id=${orgSql} AND team.status='active'))`;
const entryLink = (entry: CalendarEntry) => entry.sourceKind === 'campaign' ? `/?module=events&project=${encodeURIComponent(entry.projectId)}&campaignId=${encodeURIComponent(entry.sourceId)}` : `/?module=calendar&project=${encodeURIComponent(entry.projectId)}`;
const entryItem = (entry: CalendarEntry) => ({ tipo: ENTRY_KIND[entry.sourceKind], titulo: entry.title.replace(/^(Atividade|Evento|Turno) · /, ''), inicio: brWhen(entry.startsAt, entry.allDay), projeto: entry.projectName, link: entryLink(entry) });

/** Demandas que a pessoa vê nos projetos permitidos (e as gerais da organização quando pedido). Sempre por roleTaskVisible. */
function taskQuery(ctx: Fase2aContext, ids: string[], organizationWide: boolean) {
  return {
    from: 'followup_tasks t JOIN (SELECT ? user_id) caller LEFT JOIN projects p ON p.id=t.project_id', fromValues: [ctx.actor.userId],
    where: `${roleTaskVisible('caller.user_id', 't')} AND t.organization_id=? AND (t.project_id IN ${inList(ids)}${organizationWide ? ' OR t.project_id IS NULL' : ''})`, whereValues: [ctx.organizationId, ...ids],
  };
}

export async function runFase2aTool(ctx: Fase2aContext, name: string): Promise<RoleToolResult> {
  if (Object.keys(ctx.args).some(key => !ARGS[name]?.includes(key))) throw new HttpError(400, 'Consulta com campos não permitidos.', 'role_tool_input');
  const wanted = optionalText(ctx.args.projeto, 'o projeto');
  const projects = await ctx.visibleProjects(wanted), ids = [...projects.keys()];
  // Demandas gerais (sem projeto) só quando a conversa é da organização inteira e nenhum projeto foi pedido; authority exige dono da organização.
  const organizationWide = !wanted && (!ctx.scope || ctx.scope.kind === 'org');
  if (!ids.length && !organizationWide) return ctx.pack(name, [], [], ctx.budget, ctx.scope && ctx.scope.kind !== 'org' ? `Nada visível para você em ${ctx.scope.label} com esse filtro.` : 'Nenhum projeto visível para você com esse nome.');
  if (name === 'consultar_projetos') return projectsTool(ctx, ids);
  if (name === 'filtrar_demandas') return tasksTool(ctx, ids, organizationWide);
  return agendaTool(ctx, ids, organizationWide);
}

/** Lista e ficha de projeto: os mesmos campos de projectSummary (lib/projects.ts), com a mesma regra de leitura. */
async function projectsTool(ctx: Fase2aContext, ids: string[]): Promise<RoleToolResult> {
  const kind = 'consultar_projetos';
  if (!ids.length) return ctx.pack(kind, [], [], ctx.budget, 'Nenhum projeto visível para você.');
  const auth = projectAuthoritySql(ctx.actor, [], 'p.id'), { today } = serverWorkClock();
  const rows = await all(ctx.db, `SELECT p.id,p.name,p.short_name,p.description,p.status,p.lifecycle,p.starts_at,p.ends_at,t.label type_label,u.name unit_name,u.acronym unit_acronym
    FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.status='active' LEFT JOIN project_types t ON t.id=p.type_id LEFT JOIN organizational_units u ON u.id=p.unit_id
    WHERE p.organization_id=? AND p.id IN ${inList(ids)} AND ${auth.sql} ORDER BY p.name LIMIT 61`, [ctx.organizationId, ...ids, ...auth.values]);
  if (!rows.length) return ctx.pack(kind, [], [], ctx.budget, 'Nenhum projeto visível para você.');
  const cut = rows.length > 60, shown = rows.slice(0, 60);
  const found = shown.map(row => String(row.id)), single = shown.length === 1, withAgenda = shown.length <= AGENDA_LIST_LIMIT;
  const tasks = taskQuery(ctx, found, false), until = addDays(today, 30);
  const [owners, counts, agendas] = await Promise.all([
    // Responsável pelo projeto (Responsabilidades, área Projetos): só se existe, nunca quem é.
    all(ctx.db, `SELECT DISTINCT s.project_id FROM work_responsibility_scopes s WHERE s.area='projects' AND s.target_key='' AND s.status='active' AND s.project_id IN ${inList(found)}
      AND ${responsibilityRead('?', 's')} AND EXISTS(SELECT 1 FROM work_responsibility_assignees a WHERE a.scope_id=s.id AND a.revoked_at IS NULL AND ${liveAssignee('a', 's.organization_id', 's.project_id')})`, [...found, ctx.actor.userId]),
    all(ctx.db, `SELECT t.project_id,COUNT(CASE WHEN t.status NOT IN ('completed','cancelled') THEN 1 END) open,COUNT(CASE WHEN t.status NOT IN ('completed','cancelled') AND t.due_at<? THEN 1 END) late
      FROM ${tasks.from} WHERE ${tasks.where} GROUP BY t.project_id`, [today, ...tasks.fromValues, ...tasks.whereValues]),
    // Agenda projeto a projeto (filtrada no serviço), só em listas curtas.
    withAgenda ? Promise.all(found.map(id => agendaEntries(ctx, today, until, [id]))) : Promise.resolve(null),
  ]);
  const owned = new Set(owners.map(row => String(row.project_id))), tally = new Map(counts.map(row => [String(row.project_id), row]));
  const sources: RoleToolSource[] = [];
  const items = shown.map((row, index) => {
    const id = String(row.id), href = projectLink(id), count = tally.get(id), agenda = agendas ? agendas[index] : undefined, next = (agenda ?? []).slice(0, single ? 6 : 2);
    sources.push({ label: `Projeto · ${row.name}`, href });
    return {
      projeto: row.name, ...(row.short_name ? { sigla: row.short_name } : {}), tipo: row.type_label ?? 'sem tipo', fase: LIFECYCLE[String(row.lifecycle)] ?? row.lifecycle, situacao: row.status === 'archived' ? 'arquivado' : 'ativo',
      unidade: row.unit_name ? (row.unit_acronym ? `${row.unit_acronym} — ${row.unit_name}` : row.unit_name) : 'sem unidade', responsavel: owned.has(id) ? 'definido' : 'não definido',
      demandasAbertas: Number(count?.open ?? 0), demandasAtrasadas: Number(count?.late ?? 0),
      ...(single ? { descricao: String(row.description ?? '').slice(0, 600), inicio: row.starts_at ? brDay(row.starts_at) : null, fim: row.ends_at ? brDay(row.ends_at) : null } : {}),
      ...(agenda === undefined ? {} : { proximosEventos: agenda === null ? 'agenda indisponível para você' : next.map(entry => ({ tipo: ENTRY_KIND[entry.sourceKind], titulo: entry.title.replace(/^(Atividade|Evento|Turno) · /, ''), inicio: brWhen(entry.startsAt, entry.allDay) })) }),
      link: href,
    };
  });
  const note = single ? 'Ficha do projeto. Próximos eventos: 30 dias.' : withAgenda ? 'Próximos eventos: 30 dias, até 2 por projeto. Para a ficha, peça um projeto só.' : `Lista sem eventos da agenda (mais de ${AGENDA_LIST_LIMIT} projetos). Para eventos e ficha, peça um projeto só.`;
  return ctx.pack(kind, items, uniqueSources(sources), ctx.budget, cut ? `${note} Mostrando 60 de ${ids.length} projetos; refine pelo nome.` : note);
}

const SITUATION: Record<string, string> = { abertas: "t.status NOT IN ('completed','cancelled')", em_andamento: "t.status='in_progress'", bloqueadas: "t.status='blocked'", concluidas: "t.status='completed'", todas: "t.status!='cancelled'" };
/** Demandas com filtros de Meu trabalho (comigo: eu ou minha equipe, assignedRecipient) e de prazo (atrasadas). */
async function tasksTool(ctx: Fase2aContext, ids: string[], organizationWide: boolean): Promise<RoleToolResult> {
  const kind = 'filtrar_demandas', mine = flag(ctx.args.comigo, 'comigo'), late = flag(ctx.args.atrasadas, 'atrasadas');
  const situation = ctx.args.situacao === undefined ? 'abertas' : String(ctx.args.situacao);
  if (!SITUATION[situation]) throw new HttpError(400, 'Use abertas, em_andamento, bloqueadas, concluidas ou todas.', 'role_tool_input');
  const { today } = serverWorkClock(), tasks = taskQuery(ctx, ids, organizationWide);
  const conditions = [tasks.where, SITUATION[situation]], values: unknown[] = [...tasks.whereValues];
  if (mine) conditions.push(assignedRecipient('caller.user_id', 't'));
  if (late) { conditions.push("t.status NOT IN ('completed','cancelled') AND t.due_at IS NOT NULL AND t.due_at<?"); values.push(today); }
  const rows = await all(ctx.db, `SELECT t.id,t.title,t.body,t.status,t.priority,t.due_at,t.project_id,COALESCE(p.name,'Organização (geral)') project_name,
    ${taskDirect('caller.user_id', 't')} direct,EXISTS(SELECT 1 FROM followup_assignees a WHERE a.task_id=t.id AND a.removed_at IS NULL AND ${liveAssignee('a', 't.organization_id', 't.project_id')}) assigned
    FROM ${tasks.from} WHERE ${conditions.join(' AND ')}
    ORDER BY CASE WHEN t.status NOT IN ('completed','cancelled') AND t.due_at<? THEN 0 ELSE 1 END,COALESCE(t.due_at,'9999'),CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,t.updated_at DESC,t.id LIMIT 81`, [...tasks.fromValues, ...values, today]);
  const shown = rows.slice(0, 80);
  const sources = shown.map(row => ({ label: `${row.title} · ${row.project_name}`, href: demandLink(row) }));
  const items = shown.map(row => ({
    demanda: row.title, projeto: row.project_name, situacao: STATUS[String(row.status)] ?? row.status, prioridade: PRIORITY[String(row.priority)] ?? row.priority,
    prazo: row.due_at ? brDay(row.due_at) : null, atrasada: !['completed', 'cancelled'].includes(String(row.status)) && !!row.due_at && String(row.due_at) < today,
    responsavel: row.assigned ? 'definido' : 'não definido', ...(mine ? { comigo: row.direct ? 'direto' : 'pela equipe' } : {}),
    resumo: String(row.body ?? '').slice(0, 280), link: demandLink(row),
  }));
  const filters = [mine ? 'comigo' : '', late ? 'atrasadas' : '', situation].filter(Boolean).join(', ');
  return ctx.pack(kind, items, uniqueSources(sources), ctx.budget, rows.length ? `Filtro: ${filters}. Hoje: ${brDay(today)}.${rows.length > 80 ? ' Há mais; refine por projeto.' : ''}` : `Nenhuma demanda (${filters}) que você possa ver.`, { total: rows.length > 80 ? '80+' : rows.length });
}

/** Minha agenda: a tela Agenda (Projetos e eventos) + prazos das demandas com a pessoa, no período. */
async function agendaTool(ctx: Fase2aContext, ids: string[], organizationWide: boolean): Promise<RoleToolResult> {
  const kind = 'minha_agenda', { today } = serverWorkClock();
  const rawFrom = optionalText(ctx.args.de, 'a data inicial'), rawTo = optionalText(ctx.args.ate, 'a data final');
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const from = rawFrom || (rawTo ? rawTo : monday), to = rawTo || (rawFrom ? rawFrom : addDays(monday, 6));
  if (!validDay(from) || !validDay(to) || to < from || Date.parse(to) - Date.parse(from) > 62 * 86400000) throw new HttpError(400, 'Use datas AAAA-MM-DD, com até 62 dias.', 'role_tool_input');
  const tasks = taskQuery(ctx, ids, organizationWide);
  const [agenda, deadlines] = await Promise.all([
    ids.length ? agendaEntries(ctx, from, to, ids) : Promise.resolve([] as CalendarEntry[]),
    all(ctx.db, `SELECT t.id,t.title,t.status,t.due_at,t.project_id,COALESCE(p.name,'Organização (geral)') project_name FROM ${tasks.from}
      WHERE ${tasks.where} AND ${assignedRecipient('caller.user_id', 't')} AND t.status NOT IN ('completed','cancelled') AND t.due_at>=? AND t.due_at<=? ORDER BY t.due_at,t.id LIMIT 60`, [...tasks.fromValues, ...tasks.whereValues, from, to]),
  ]);
  const entries = (agenda ?? []).map(entry => ({ at: entry.allDay ? entry.startsAt.slice(0, 10) : entry.startsAt, item: entryItem(entry) }));
  const due = deadlines.map(row => ({ at: String(row.due_at), item: { tipo: 'prazo de demanda', titulo: row.title, inicio: `${brDay(row.due_at)} (prazo)`, situacao: STATUS[String(row.status)] ?? row.status, projeto: row.project_name, link: demandLink(row) } }));
  const list = [...entries, ...due].sort((a, b) => a.at.localeCompare(b.at)).map(entry => entry.item as Record<string, unknown> & { link: string; titulo: unknown; projeto: unknown });
  const sources = uniqueSources(list.map(item => ({ label: item.link.startsWith('/?module=calendar') ? `Agenda · ${item.projeto}` : `${item.titulo} · ${item.projeto}`, href: item.link })));
  const period = `${brDay(from)} a ${brDay(to)}`, unavailable = agenda === null ? ' A Agenda dos projetos não está disponível agora (perfil sem Agenda ou período com registros demais: tente um projeto ou um período menor); mostro só os prazos das suas demandas.' : '';
  return ctx.pack(kind, list, sources, ctx.budget, (list.length ? `Período: ${period}.` : `Nada na sua agenda de ${period}.`) + unavailable, { periodo: period });
}
