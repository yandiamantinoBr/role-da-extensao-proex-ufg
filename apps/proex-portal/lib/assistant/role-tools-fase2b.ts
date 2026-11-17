/**
 * Ferramentas de leitura do Rolê para Materiais, Empréstimos, Dinâmicas e "quem cuida" (Fase 2b).
 * Mesmas regras de role-tools.ts: só leitura, com a identidade de quem pergunta, e a permissão é
 * conferida de novo no SQL de cada consulta (o acesso pode mudar no meio da conversa).
 * - Estoque: projectAuthoritySql(['inventory.read']) de lib/access.ts, como a tela Materiais.
 * - Empréstimos: projectAuthoritySql(['loans.read']), sem quem pegou nem contato.
 * - Níveis: prizeTiersWorkspace (lib/prize-tiers/service.ts), o mesmo serviço do painel de níveis.
 * - Quem cuida: responsibilityList (lib/responsibilities/service.ts), o mesmo da ficha do projeto.
 * Um nome de evento ou dinâmica ("CONPEEX") também leva ao projeto que hospeda a dinâmica, onde
 * fica o estoque dela.
 */
import { projectAuthoritySql, type PortalActor } from '../access';
import { all } from '../database';
import { HttpError } from '../errors';
import { authority } from '../follow-up/scope';
import { loanDisplayState } from '../loan-lifecycle';
import { loanStates } from '../loan-list-filters';
import { PRIZE_TIERS, TIER_LABELS, type PrizeOption } from '../prize-tiers/contracts';
import { prizeTiersWorkspace } from '../prize-tiers/service';
import { contextLink, responsibilityList } from '../responsibilities/service';
import type { WorkArea } from '../my-work/contracts';
import type { ResolvedScope, RoleToolResult, RoleToolSource } from './role-tools';

const txt = (description: string) => ({ type: 'string', description, maxLength: 120 });
const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const def = (name: string, description: string, properties: Record<string, unknown>) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required: [] as string[], additionalProperties: false } } });
const projeto = txt('Projeto, sigla ou dinâmica. Omita para todos.');
export const ROLE_TOOLS_FASE2B = [
  def('consultar_estoque', 'Saldo, disponível e limite de alerta dos materiais, com resumo por projeto. saldo_baixo=true: só os no alerta.', { material: txt('Nome (ou parte) do material.'), projeto, saldo_baixo: { type: 'boolean' } }),
  def('consultar_niveis_dinamica', 'Níveis Brinde, Super e Super Super de uma dinâmica, com as opções como cadastradas.', { dinamica: txt('Nome (ou parte) da dinâmica.'), projeto }),
  def('consultar_emprestimos', 'Empréstimos de equipamentos (retirados, reservas, atrasos, devoluções), sem quem pegou. de/ate: em curso no período.', { projeto, situacao: { type: 'string', enum: ['abertos', 'retirados', 'reservados', 'atrasados', 'todos'] }, de: day, ate: day }),
  def('consultar_responsaveis', 'Quem cuida do estoque, empréstimos, dinâmicas ou projeto.', { projeto, area: { type: 'string', enum: ['estoque', 'emprestimos', 'dinamicas', 'projeto'] } }),
];
export const ROLE_TOOL_NAMES_FASE2B = new Set(ROLE_TOOLS_FASE2B.map(tool => tool.function.name));

/** Funções de role-tools.ts, passadas na chamada (evita import circular). */
export type Fase2bKit = {
  pack: (kind: string, items: Record<string, unknown>[], sources: RoleToolSource[], budget: number, note?: string, extra?: Record<string, unknown>) => RoleToolResult;
  visibleProjects: (db: D1Database, actor: PortalActor, organizationId: string, wanted: string, scope?: ResolvedScope | null) => Promise<Map<string, string>>;
  terms: (value: string) => string[];
  score: (haystack: string, wanted: string[]) => number;
};
type Ctx = { db: D1Database; actor: PortalActor; organizationId: string; args: Record<string, unknown>; budget: number; scope: ResolvedScope | null; kit: Fase2bKit };

const KEYS: Record<string, string[]> = { consultar_estoque: ['material', 'projeto', 'saldo_baixo'], consultar_niveis_dinamica: ['dinamica', 'projeto'], consultar_emprestimos: ['projeto', 'situacao', 'de', 'ate'], consultar_responsaveis: ['projeto', 'area'] };
const bad = (message: string): never => { throw new HttpError(400, message, 'role_tool_input'); };
function str(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 120) bad(`Confira ${label}.`);
  return (value as string).trim();
}
const norm = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const words = (value: string) => norm(value).split(/[^a-z0-9]+/).filter(Boolean);
const GENERIC = new Set(['projeto', 'projetos', 'evento', 'eventos', 'dinamica', 'dinamicas', 'estoque', 'do', 'da', 'de', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'e']);
/** Cada palavra pedida aparece no nome: palavra curta (sigla, letra) só igual; a partir de 3 letras, começo de palavra. */
function nameMatches(name: string, wanted: string[]): boolean {
  const own = words(name);
  return wanted.length > 0 && wanted.every(word => own.some(part => word.length < 3 ? part === word : part.startsWith(word)));
}
const link = (module: string, projectId: string, extra = '') => `/?module=${module}&project=${encodeURIComponent(projectId)}${extra}`;
const inList = (ids: string[]) => ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)';
const when = (ms: unknown) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(Number(ms)));
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

type Target = { projects: Map<string, string>; campaigns: { id: string; name: string; projectId: string }[]; hosts: string[] };
/**
 * Projetos do pedido, só entre os que a pessoa vê no escopo da conversa. O nome pode ser de projeto
 * (ou sigla) ou de dinâmica: nesse caso entra o projeto que hospeda a dinâmica.
 */
async function target(ctx: Ctx): Promise<Target> {
  const visible = await ctx.kit.visibleProjects(ctx.db, ctx.actor, ctx.organizationId, '', ctx.scope);
  const ids = [...visible.keys()], wanted = str(ctx.args.projeto, 'o projeto');
  if (!wanted || !ids.length) return { projects: visible, campaigns: [], hosts: [] };
  const [shorts, campaigns] = await Promise.all([
    all(ctx.db, `SELECT id,short_name FROM projects WHERE id IN ${inList(ids)}`, ids),
    all(ctx.db, `SELECT id,name,project_id FROM campaigns WHERE project_id IN ${inList(ids)} ORDER BY starts_at DESC LIMIT 400`, ids),
  ]);
  const short = new Map(shorts.map(row => [String(row.id), String(row.short_name ?? '')]));
  const full = words(wanted), reduced = full.filter(word => !GENERIC.has(word));
  for (const query of reduced.length && reduced.length < full.length ? [full, reduced] : [full]) {
    const projects = new Map([...visible].filter(([id, name]) => id === wanted || nameMatches(name, query) || nameMatches(short.get(id) ?? '', query)));
    const events = campaigns.filter(row => nameMatches(String(row.name), query)).map(row => ({ id: String(row.id), name: String(row.name), projectId: String(row.project_id) }));
    const hosts = [...new Set(events.map(event => event.projectId))].filter(id => !projects.has(id));
    for (const id of hosts) projects.set(id, visible.get(id)!);
    if (projects.size) return { projects, campaigns: events, hosts };
  }
  return { projects: new Map(), campaigns: [], hosts: [] };
}
function hostNote(found: Target): string {
  if (!found.hosts.length) return '';
  const names = found.hosts.map(id => `${found.projects.get(id)} (hospeda ${found.campaigns.filter(event => event.projectId === id).map(event => event.name).slice(0, 2).join(', ')})`);
  return `Inclui o projeto que hospeda a dinâmica: ${names.join('; ')}.`;
}
function empty(ctx: Ctx, name: string): RoleToolResult {
  const scoped = ctx.scope && ctx.scope.kind !== 'org';
  return ctx.kit.pack(name, [], [], ctx.budget, scoped ? `Nada visível para você em ${ctx.scope!.label} com esse filtro. Para procurar em toda a PROEX, troque "Procurar em".` : 'Nenhum projeto ou dinâmica visível para você com esse nome.');
}
const orgActive = `JOIN organizations o ON o.id=p.organization_id AND o.status='active'`;

/** Saldo baixo como no painel e nos avisos de materiais: consumível em uso com disponível no limite de alerta ou abaixo. */
const isLow = (row: Record<string, unknown>) => row.category !== 'equipment' && row.condition === 'active' && Number(row.stock) - Number(row.reserved) <= Number(row.low_stock);

async function stockTool(ctx: Ctx, found: Target, ids: string[]): Promise<RoleToolResult> {
  const name = 'consultar_estoque', onlyLow = ctx.args.saldo_baixo;
  if (onlyLow !== undefined && typeof onlyLow !== 'boolean') bad('Use saldo_baixo verdadeiro ou falso.');
  const auth = projectAuthoritySql(ctx.actor, ['inventory.read'], 'p.id'), wanted = ctx.kit.terms(str(ctx.args.material, 'o material'));
  const rows = await all(ctx.db, `SELECT i.id,i.name,i.unit,i.stock,i.reserved,i.low_stock,i.category,i.condition,p.id project_id,p.name project_name FROM items i JOIN projects p ON p.id=i.project_id ${orgActive}
    WHERE p.organization_id=? AND ${auth.sql} AND p.id IN ${inList(ids)} AND i.condition!='inactive' ORDER BY p.name,i.name LIMIT 2000`, [ctx.organizationId, ...auth.values, ...ids]);
  const hits = rows.map(row => ({ row, s: ctx.kit.score(String(row.name), wanted) })).filter(entry => entry.s > 0 && (!onlyLow || isLow(entry.row))).sort((a, b) => b.s - a.s || Number(isLow(b.row)) - Number(isLow(a.row))).map(entry => entry.row);
  const sources: RoleToolSource[] = [], items = hits.map(row => {
    const available = Number(row.stock) - Number(row.reserved), href = link('materials', String(row.project_id), `&itemId=${encodeURIComponent(String(row.id))}`);
    sources.push({ label: `${row.name} · ${row.project_name}`, href });
    const situation = isLow(row) ? (available <= 0 ? 'sem saldo (atingiu o alerta)' : 'saldo baixo') : row.condition === 'maintenance' ? 'em manutenção' : 'ok';
    return { material: row.name, projeto: row.project_name, unidade: row.unit, saldo: Number(row.stock), reservado: Number(row.reserved), disponivel: available, alerta: row.category === 'equipment' ? null : Number(row.low_stock), situacao: situation, link: href };
  });
  const summary = new Map<string, { projeto: string; materiais: number; saldoBaixo: number; link: string }>();
  for (const row of hits) {
    const id = String(row.project_id), entry = summary.get(id) ?? { projeto: String(row.project_name), materiais: 0, saldoBaixo: 0, link: link('materials', id) };
    entry.materiais++; if (isLow(row)) entry.saldoBaixo++; summary.set(id, entry);
  }
  const notes = [hostNote(found), hits.length ? '' : onlyLow ? 'Nenhum material atingiu o limite de alerta nos projetos em que você vê o estoque.' : 'Nenhum material encontrado nos projetos em que você pode ver o estoque.'].filter(Boolean).join(' ');
  const result = ctx.kit.pack(name, items, sources, ctx.budget, notes, summary.size ? { porProjeto: [...summary.values()].slice(0, 12) } : {});
  // O resumo por projeto também vira fonte: leva à tela Materiais filtrada pelo projeto.
  const projectSources = [...summary.values()].slice(0, 12).map(entry => ({ label: `Materiais · ${entry.projeto}`, href: entry.link }));
  return { ...result, sources: [...result.sources, ...projectSources.filter(source => !result.sources.some(seen => seen.href === source.href))] };
}

/** Níveis como o painel mostra, na ordem Brinde, Super, Super Super; nível sem opção vem dito assim. */
export function tierLevels(options: PrizeOption[], details = true) {
  return PRIZE_TIERS.map(tier => {
    const list = options.filter(option => option.tier === tier);
    return { nivel: TIER_LABELS[tier], opcoes: list.length ? list.map(option => details ? { opcao: option.name, componentes: option.components.map(component => `${component.name} × ${component.quantity}`) } : option.name) : 'nenhuma opção cadastrada neste nível' };
  });
}
const CAMPAIGN_STATUS: Record<string, string> = { draft: 'rascunho', active: 'ativa', paused: 'pausada', closed: 'encerrada' };

async function levelsTool(ctx: Ctx, found: Target, ids: string[]): Promise<RoleToolResult> {
  const name = 'consultar_niveis_dinamica', wantedText = str(ctx.args.dinamica, 'a dinâmica'), wanted = ctx.kit.terms(wantedText);
  const rows = await all(ctx.db, `SELECT c.id,c.name,p.id project_id,p.name project_name FROM campaigns c JOIN projects p ON p.id=c.project_id ${orgActive}
    WHERE p.organization_id=? AND ${authority('?', 'p.organization_id', 'c.project_id')} AND p.id IN ${inList(ids)} AND c.status!='closed' ORDER BY c.starts_at DESC LIMIT 200`, [ctx.organizationId, ctx.actor.userId, ...ids]);
  const named = new Set(found.campaigns.map(event => event.id));
  const chosen = (!wantedText && named.size ? rows.filter(row => named.has(String(row.id))) : rows.map(row => ({ row, s: ctx.kit.score(String(row.name), wanted) })).filter(entry => entry.s > 0).sort((a, b) => b.s - a.s).map(entry => entry.row)).slice(0, 3);
  const results: Record<string, unknown>[] = [], sources: RoleToolSource[] = [];
  for (const campaign of chosen) {
    try {
      const workspace = await prizeTiersWorkspace(ctx.db, ctx.actor, { campaignId: String(campaign.id) });
      const href = link('events', String(campaign.project_id), `&campaignId=${encodeURIComponent(String(campaign.id))}`), outside = workspace.options.filter(option => !option.tier).map(option => option.name);
      const superSuper = workspace.options.some(option => option.tier === 'super_super');
      results.push({ dinamica: campaign.name, projeto: campaign.project_name, situacao: CAMPAIGN_STATUS[workspace.campaign.status] ?? workspace.campaign.status, niveis: tierLevels(workspace.options),
        ...(superSuper ? { sorteioSuperSuper: `${workspace.superSuperPercent}% dos resultados Super${workspace.percentIsDefault ? ' (padrão, não confirmado)' : ''}` } : {}),
        ...(outside.length ? { foraDestaDinamica: outside.slice(0, 12) } : {}), link: href });
      sources.push({ label: `${campaign.name} · níveis`, href });
    } catch (error) { if (!(error instanceof HttpError && error.status === 403)) throw error; }
  }
  const note = results.length ? 'Use só estes níveis e opções, como estão cadastrados: não mova opções entre níveis nem crie níveis. "foraDestaDinamica" são opções do projeto que não são prêmio desta dinâmica.' : 'Nenhuma dinâmica com esse nome nos projetos que você pode ver.';
  return ctx.kit.pack(name, results, sources, ctx.budget, [note, hostNote(found)].filter(Boolean).join(' '));
}

const LOAN_FILTER: Record<string, string> = { abertos: "l.status IN ('reserved','out')", retirados: "l.status='out'", reservados: "l.status='reserved'", atrasados: "l.status='out' AND l.ends_at<?", todos: '1=1' };
async function loansTool(ctx: Ctx, found: Target, ids: string[]): Promise<RoleToolResult> {
  const name = 'consultar_emprestimos', situation = ctx.args.situacao === undefined ? 'abertos' : String(ctx.args.situacao), now = Date.now();
  if (!LOAN_FILTER[situation]) bad('Use abertos, retirados, reservados, atrasados ou todos.');
  const from = str(ctx.args.de, 'a data inicial'), to = str(ctx.args.ate, 'a data final');
  if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && to < from)) bad('Use datas AAAA-MM-DD, com a final depois da inicial.');
  // Critério de sobreposição (decisão de 16/11), o mesmo da lista, da Agenda e dos Relatórios, em Brasília.
  const period: string[] = [], periodValues: number[] = [];
  if (from) { period.push('l.ends_at>?'); periodValues.push(Date.parse(`${from}T00:00:00-03:00`)); }
  if (to) { period.push('l.starts_at<?'); periodValues.push(Date.parse(`${to}T00:00:00-03:00`) + 86400000); }
  const auth = projectAuthoritySql(ctx.actor, ['loans.read'], 'p.id');
  const rows = await all(ctx.db, `SELECT l.id,l.status,l.close_reason,l.action_name,l.starts_at,l.ends_at,i.name item_name,p.id project_id,p.name project_name FROM loans l JOIN items i ON i.id=l.item_id JOIN projects p ON p.id=l.project_id ${orgActive}
    WHERE p.organization_id=? AND ${auth.sql} AND p.id IN ${inList(ids)} AND ${LOAN_FILTER[situation]}${period.map(clause => ` AND ${clause}`).join('')} ORDER BY l.ends_at LIMIT 200`,
  [ctx.organizationId, ...auth.values, ...ids, ...(situation === 'atrasados' ? [now] : []), ...periodValues]);
  const count = { retirados: 0, emAtraso: 0, reservados: 0 }, sources: RoleToolSource[] = [];
  const items = rows.map(row => {
    const display = loanDisplayState(row.status, row.close_reason), overdue = display === 'out' && Number(row.ends_at) < now;
    if (display === 'out') count.retirados++; if (overdue) count.emAtraso++; if (display === 'reserved') count.reservados++;
    const href = link('loans', String(row.project_id), `&loanId=${encodeURIComponent(String(row.id))}`);
    sources.push({ label: `${row.item_name} · empréstimo`, href });
    return { equipamento: row.item_name, acao: row.action_name, situacao: overdue ? loanStates.overdue : loanStates[display as keyof typeof loanStates] ?? display, inicio: when(row.starts_at), devolucaoPrevista: when(row.ends_at), projeto: row.project_name, link: href };
  });
  const notes = [from || to ? 'Período: entra o empréstimo em curso em algum momento dele (horário de Brasília).' : '', hostNote(found), rows.length ? '' : 'Nenhum empréstimo com esse filtro nos projetos em que você vê empréstimos.'].filter(Boolean).join(' ');
  return ctx.kit.pack(name, items, sources, ctx.budget, notes, { contagem: count });
}

const AREAS: Record<string, WorkArea> = { estoque: 'materials', emprestimos: 'loans', dinamicas: 'campaigns', projeto: 'projects' };
const ROLE_OF: Record<WorkArea, string> = { materials: 'cuida do estoque', loans: 'cuida dos empréstimos', campaigns: 'cuida das dinâmicas', projects: 'cuida do projeto' };
const LABEL_OF: Record<WorkArea, string> = { materials: 'Estoque', loans: 'Empréstimos', campaigns: 'Dinâmicas', projects: 'Projeto' };
async function responsibleTool(ctx: Ctx, found: Target, ids: string[]): Promise<RoleToolResult> {
  const name = 'consultar_responsaveis', area = ctx.args.area === undefined ? null : AREAS[String(ctx.args.area)];
  if (area === undefined) bad('Use estoque, emprestimos, dinamicas ou projeto.');
  const projects = ids.slice(0, 10), items: Record<string, unknown>[] = [], sources: RoleToolSource[] = [], missing: string[] = [];
  for (const projectId of projects) {
    // Mesmo serviço e mesma regra de leitura da ficha do projeto ("Quem cuida de cada área").
    const list = await responsibilityList(ctx.db, ctx.actor, { organizationId: ctx.organizationId, projectId, ...(area ? { area } : {}), status: 'active', limit: 50 });
    for (const row of list.items) {
      const entity = Boolean(row.item_id || row.loan_id || row.campaign_id), href = row.target.href ?? contextLink('projects', projectId);
      items.push({ projeto: row.project_name, papel: ROLE_OF[row.area], alvo: entity ? row.target.name ?? 'item que você não abre' : 'toda a área', responsaveis: row.assignees.map(person => person.team_id ? `${person.name} (equipe)` : person.name), situacao: row.assignees.length ? 'responsável definido' : 'sem responsável ativo', ...(row.assignmentVia ? { voceEstaEntre: true } : {}), link: href });
      sources.push({ label: `Quem cuida · ${row.project_name}`, href });
    }
    for (const wantedArea of area ? [area] : (['materials', 'loans', 'campaigns'] as WorkArea[])) {
      if (!list.items.some(row => row.area === wantedArea && !row.item_id && !row.loan_id && !row.campaign_id)) missing.push(`${LABEL_OF[wantedArea]} · ${found.projects.get(projectId)}`);
    }
  }
  const notes = [hostNote(found), ids.length > projects.length ? `Mostrando 10 de ${ids.length} projetos; diga o projeto para afunilar.` : '', items.length ? '' : 'Nenhuma designação de responsável nos projetos que você vê.'].filter(Boolean).join(' ');
  return ctx.kit.pack(name, items, sources, ctx.budget, notes, missing.length ? { semResponsavelDefinido: missing.slice(0, 12) } : {});
}

export async function runFase2bTool(db: D1Database, actor: PortalActor, organizationId: string, name: string, args: Record<string, unknown>, budget: number, scope: ResolvedScope | null, kit: Fase2bKit): Promise<RoleToolResult> {
  if (Object.keys(args).some(key => !KEYS[name].includes(key))) bad('Consulta com campos não permitidos.');
  const ctx: Ctx = { db, actor, organizationId, args, budget, scope, kit };
  const found = await target(ctx), ids = [...found.projects.keys()];
  if (!ids.length) return empty(ctx, name);
  if (name === 'consultar_estoque') return stockTool(ctx, found, ids);
  if (name === 'consultar_niveis_dinamica') return levelsTool(ctx, found, ids);
  if (name === 'consultar_emprestimos') return loansTool(ctx, found, ids);
  return responsibleTool(ctx, found, ids);
}
