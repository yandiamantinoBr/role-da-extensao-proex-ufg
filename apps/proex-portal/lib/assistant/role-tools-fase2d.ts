/**
 * Ação "abrir esta tela" do Rolê (Fase 2d). Só leitura: devolve o endereço interno exato da tela (e, se pedido,
 * da ficha de um projeto, demanda, material, empréstimo ou dinâmica) para a tela do Rolê mostrar um botão.
 * Nada navega sozinho: só o toque da pessoa no botão abre. Nada é gravado.
 *
 * A permissão de cada tela é a mesma do menu do portal (allowedTabs em app/portal-client.tsx), conferida aqui
 * com as funções de autoridade do servidor, ao vivo no SQL (o acesso pode mudar no meio da conversa):
 * projectAuthoritySql, organizationAuthoritySql, platformOwnerAuthoritySql, aiConfigurationAuthority e
 * volunteerCampaignSql (lib/access.ts). Alvos só entre os que a pessoa vê, no escopo da conversa: projetos
 * por visibleProjects (role-tools.ts), demandas por roleTaskVisible (publicTaskAuthority: demanda privada
 * nunca é alvo), materiais por inventory.read (a mesma regra de canOpenRecord da tela), empréstimos por
 * loans.read e dinâmicas pelas permissões da tela Dinâmicas. Fora do alcance e inexistente respondem igual.
 */
import { aiConfigurationAuthority, organizationAuthoritySql, platformOwnerAuthoritySql, projectAuthoritySql, volunteerCampaignSql, type PortalActor } from '../access';
import { all, one, type Row } from '../database';
import { HttpError } from '../errors';
import { REPORT_DATASETS } from '../reports';
import { REPORT_DATASET_IDS, type ReportDatasetId } from '../report-links';
import { roleTaskVisible } from './role-tools-fase2a';
import type { ResolvedScope, RoleToolResult, RoleToolSource } from './role-tools';

/** Telas que o Rolê sabe abrir, com o módulo do portal (navigation-model.ts) e o rótulo do botão. */
const SCREENS = {
  inicio: { module: 'overview', label: 'Início' },
  meu_trabalho: { module: 'my-work', label: 'Meu trabalho' },
  projetos: { module: 'projects', label: 'Projetos' },
  demandas: { module: 'demands', label: 'Demandas' },
  equipes: { module: 'work-teams', label: 'Equipes e organograma' },
  agenda: { module: 'calendar', label: 'Agenda' },
  materiais: { module: 'materials', label: 'Materiais' },
  emprestimos: { module: 'loans', label: 'Empréstimos' },
  dinamicas: { module: 'events', label: 'Dinâmicas' },
  convocacoes: { module: 'convocations', label: 'Convocações' },
  registros: { module: 'records', label: 'Registros' },
  comunidade: { module: 'community', label: 'Comunidade' },
  pessoas: { module: 'team', label: 'Pessoas e acessos' },
  relatorios: { module: 'reports', label: 'Relatórios' },
  gestao: { module: 'management', label: 'Gestão' },
  guia: { module: 'management', label: 'Guia da organização' },
  configuracoes: { module: 'settings', label: 'Configurações' },
  conta: { module: 'profile', label: 'Conta' },
} as const;
type Screen = keyof typeof SCREENS;
const SCREEN_IDS = Object.keys(SCREENS) as Screen[];

const text = (description: string) => ({ type: 'string', description, maxLength: 120 });
export const FASE2D_TOOLS = [{ type: 'function', function: { name: 'abrir_tela', description: 'Botão para a pessoa abrir uma tela ou ficha (projeto, demanda, material, empréstimo, dinâmica). Confere o acesso.', parameters: { type: 'object', properties: {
  tela: { type: 'string', enum: SCREEN_IDS }, alvo: text('Ficha ou relatório.'), projeto: text('Projeto ou sigla.'), atrasadas: { type: 'boolean' },
}, required: ['tela'], additionalProperties: false } } }];
export const FASE2D_TOOL_NAMES = FASE2D_TOOLS.map(tool => tool.function.name);

export type RoleNavigation = { href: string; label: string };
type Pack = (kind: string, items: Record<string, unknown>[], sources: RoleToolSource[], budget: number, note?: string, extra?: Record<string, unknown>) => RoleToolResult;
export type Fase2dContext = {
  db: D1Database; actor: PortalActor; organizationId: string; args: Record<string, unknown>; budget: number; scope: ResolvedScope | null; pack: Pack;
  /** Projetos visíveis (followup authority) pelo nome; com `scoped`, só os do escopo da conversa. */
  visibleProjects: (wanted: string, scoped: boolean) => Promise<Map<string, string>>;
  terms: (value: string) => string[]; score: (haystack: string, wanted: string[]) => number;
};

export const NO_ACCESS = 'Você não tem acesso a esta tela.';
const KIND = 'abrir_tela';
const bad = (message: string): never => { throw new HttpError(400, message, 'role_tool_input'); };
function optionalText(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 120) bad(`Confira ${label}.`);
  return (value as string).trim();
}
const norm = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const inList = (ids: string[]) => ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)';
const enc = encodeURIComponent;
const short = (value: string) => value.length > 60 ? `${value.slice(0, 59).trimEnd()}…` : value;
const orgActive = `JOIN organizations o ON o.id=p.organization_id AND o.status='active'`;

/* ---------- Permissão da tela: a mesma regra de allowedTabs (app/portal-client.tsx), ao vivo no SQL ---------- */
const EVENTS = ['campaigns.manage', 'participation.operate', 'inventory.deliver'];
const CAPS: Partial<Record<Screen, string[]>> = {
  materiais: ['inventory.read', 'inventory.manage', 'inventory.deliver'],
  emprestimos: ['loans.read', 'loans.manage', 'loans.checkout'],
  dinamicas: EVENTS,
  // Agenda: alguma categoria legível (calendarAvailable em lib/calendar.ts).
  agenda: ['reports.read', 'campaigns.manage', 'inventory.read', 'loans.read'],
  convocacoes: ['campaigns.manage', 'reports.read'],
};
const yes = async (db: D1Database, check: { sql: string; values: unknown[] }) => !!await one(db, `SELECT 1 ok WHERE ${check.sql}`, check.values);
/** Algum projeto ativo desta organização (ou o projeto pedido) em que a pessoa tem uma destas permissões. */
async function anyProject(ctx: Fase2dContext, capabilities: readonly string[], projectId: string | null): Promise<boolean> {
  const auth = projectAuthoritySql(ctx.actor, capabilities, 'p.id');
  return !!await one(ctx.db, `SELECT 1 ok FROM projects p ${orgActive} WHERE p.organization_id=? AND ${auth.sql}${projectId ? ' AND p.id=?' : ''} LIMIT 1`, [ctx.organizationId, ...auth.values, ...(projectId ? [projectId] : [])]);
}
/** Voluntário por ação vê Dinâmicas da ação em que está escalado (lib/access.ts). */
async function volunteer(ctx: Fase2dContext, projectId: string | null): Promise<boolean> {
  const grant = volunteerCampaignSql(ctx.actor, 'c.id');
  return !!await one(ctx.db, `SELECT 1 ok FROM campaigns c JOIN projects p ON p.id=c.project_id ${orgActive} WHERE p.organization_id=? AND ${grant.sql}${projectId ? ' AND p.id=?' : ''} LIMIT 1`, [ctx.organizationId, ...grant.values, ...(projectId ? [projectId] : [])]);
}
/**
 * Pode abrir a tela (e filtrar pelo projeto, quando houver)? Base de tudo, como no portal: acompanhar o trabalho
 * (administra a organização ou vê algum projeto dela). Sem isso, nenhuma tela.
 */
async function screenAllowed(ctx: Fase2dContext, screen: Screen, projectId: string | null, dataset: ReportDatasetId | null): Promise<boolean> {
  const manages = await yes(ctx.db, organizationAuthoritySql(ctx.actor, ctx.organizationId));
  if (!manages && !(await ctx.visibleProjects('', false)).size) return false;
  if (screen === 'configuracoes') return await yes(ctx.db, platformOwnerAuthoritySql(ctx.actor)) || await yes(ctx.db, aiConfigurationAuthority(ctx.actor, ctx.organizationId));
  if (screen === 'pessoas') return (!projectId && manages) || anyProject(ctx, ['access.invite', 'access.manage'], projectId);
  if (screen === 'relatorios' && dataset) return anyProject(ctx, REPORT_DATASETS[dataset].capabilities, projectId);
  const capabilities = CAPS[screen];
  if (capabilities) return await anyProject(ctx, capabilities, projectId) || (screen === 'dinamicas' && volunteer(ctx, projectId));
  return true;
}

/* ---------- Alvos: só entre os que a pessoa vê, no escopo da conversa ---------- */
type Found<T> = { one: T | null; many: T[] };
/** O melhor pelo nome: nome idêntico, único resultado ou o de maior pontuação; empate devolve as opções. */
function best<T extends Row>(ctx: Fase2dContext, rows: T[], name: (row: T) => string, wanted: string): Found<T> {
  const words = ctx.terms(wanted);
  if (!words.length) return { one: null, many: [] };
  const hits = rows.map(row => ({ row, s: ctx.score(name(row), words) })).filter(entry => entry.s > 0).sort((a, b) => b.s - a.s);
  const exact = hits.filter(entry => norm(name(entry.row)) === norm(wanted));
  if (exact.length === 1) return { one: exact[0].row, many: [] };
  if (hits.length === 1 || (hits.length > 1 && hits[0].s > hits[1].s)) return { one: hits[0].row, many: [] };
  return { one: null, many: hits.slice(0, 5).map(entry => entry.row) };
}
const notFound = (what: string) => `Não encontrei ${what} visível para você com esse nome. Nada foi aberto.`;

type Target = { href: string; label: string } | { options: { label: string; href: string }[] } | { note: string };
const projectRecord = (id: string) => `/?module=projects&project=${enc(id)}&detailProject=${enc(id)}`;

async function projectTarget(ctx: Fase2dContext, wanted: string): Promise<{ id: string; name: string } | { options: { label: string; href: string }[] } | { note: string }> {
  const found = [...(await ctx.visibleProjects(wanted, true))];
  if (found.length === 1) return { id: found[0][0], name: found[0][1] };
  if (found.length > 1) return { options: found.slice(0, 5).map(([id, name]) => ({ label: name, href: projectRecord(id) })) };
  // Nome de evento ou dinâmica ("CONPEEX"): o projeto que hospeda, se for um só.
  const visible = await ctx.visibleProjects('', true), ids = [...visible.keys()], words = ctx.terms(wanted);
  const events = ids.length && words.length ? await all(ctx.db, `SELECT c.name,c.project_id FROM campaigns c WHERE c.project_id IN ${inList(ids)} ORDER BY c.starts_at DESC LIMIT 400`, ids) : [];
  const hosts = [...new Set(events.filter(row => ctx.score(String(row.name), words) > 0).map(row => String(row.project_id)))];
  if (hosts.length === 1) return { id: hosts[0], name: visible.get(hosts[0])! };
  return { note: notFound('projeto') };
}

async function demandTarget(ctx: Fase2dContext, wanted: string, ids: string[], organizationWide: boolean): Promise<Target> {
  const rows = await all(ctx.db, `SELECT t.id,t.title,t.project_id,p.name project_name FROM followup_tasks t JOIN (SELECT ? user_id) caller LEFT JOIN projects p ON p.id=t.project_id
    WHERE ${roleTaskVisible('caller.user_id', 't')} AND t.organization_id=? AND (t.project_id IN ${inList(ids)}${organizationWide ? ' OR t.project_id IS NULL' : ''}) AND t.status!='cancelled'
    ORDER BY CASE WHEN t.status IN ('completed') THEN 1 ELSE 0 END,t.updated_at DESC LIMIT 600`, [ctx.actor.userId, ctx.organizationId, ...ids]);
  const href = (row: Row) => `/?module=demands${row.project_id ? `&project=${enc(String(row.project_id))}` : ''}&demandId=${enc(String(row.id))}`;
  const found = best(ctx, rows, row => String(row.title), wanted);
  if (found.one) return { href: href(found.one), label: `demanda “${short(String(found.one.title))}”` };
  if (found.many.length) return { options: found.many.map(row => ({ label: `${short(String(row.title))} · ${row.project_name ?? 'geral'}`, href: href(row) })) };
  return { note: notFound('demanda') };
}

async function itemTarget(ctx: Fase2dContext, wanted: string, ids: string[]): Promise<Target> {
  const auth = projectAuthoritySql(ctx.actor, ['inventory.read'], 'p.id');
  const rows = await all(ctx.db, `SELECT i.id,i.name,p.id project_id,p.name project_name FROM items i JOIN projects p ON p.id=i.project_id ${orgActive}
    WHERE p.organization_id=? AND ${auth.sql} AND p.id IN ${inList(ids)} AND i.condition!='inactive' ORDER BY i.name LIMIT 2000`, [ctx.organizationId, ...auth.values, ...ids]);
  const href = (row: Row) => `/?module=materials&project=${enc(String(row.project_id))}&itemId=${enc(String(row.id))}`;
  const found = best(ctx, rows, row => String(row.name), wanted);
  if (found.one) return { href: href(found.one), label: `material ${short(String(found.one.name))}` };
  if (found.many.length) return { options: found.many.map(row => ({ label: `${short(String(row.name))} · ${row.project_name}`, href: href(row) })) };
  return { note: notFound('material') };
}

async function loanTarget(ctx: Fase2dContext, wanted: string, ids: string[]): Promise<Target> {
  const auth = projectAuthoritySql(ctx.actor, ['loans.read'], 'p.id');
  // Sem quem pegou: o empréstimo é achado pelo equipamento ou pela ação; os em curso vêm primeiro.
  const rows = await all(ctx.db, `SELECT l.id,l.action_name,i.name item_name,p.id project_id,p.name project_name FROM loans l JOIN items i ON i.id=l.item_id JOIN projects p ON p.id=l.project_id ${orgActive}
    WHERE p.organization_id=? AND ${auth.sql} AND p.id IN ${inList(ids)} ORDER BY CASE WHEN l.status IN ('reserved','out') THEN 0 ELSE 1 END,l.ends_at DESC LIMIT 400`, [ctx.organizationId, ...auth.values, ...ids]);
  const href = (row: Row) => `/?module=loans&project=${enc(String(row.project_id))}&loanId=${enc(String(row.id))}`;
  const words = ctx.terms(wanted), hits = words.length ? rows.filter(row => ctx.score(`${row.item_name} ${row.action_name ?? ''}`, words) > 0) : [];
  // Vários empréstimos do mesmo equipamento: o primeiro (em curso, o mais recente).
  if (hits.length && hits.every(row => row.item_name === hits[0].item_name)) return { href: href(hits[0]), label: `empréstimo de ${short(String(hits[0].item_name))}` };
  if (hits.length) return { options: [...new Map(hits.map(row => [String(row.item_name), row])).values()].slice(0, 5).map(row => ({ label: `${short(String(row.item_name))} · ${row.project_name}`, href: href(row) })) };
  return { note: notFound('empréstimo') };
}

async function campaignTarget(ctx: Fase2dContext, wanted: string, ids: string[]): Promise<Target> {
  const auth = projectAuthoritySql(ctx.actor, EVENTS, 'c.project_id'), grant = volunteerCampaignSql(ctx.actor, 'c.id');
  const rows = await all(ctx.db, `SELECT c.id,c.name,p.id project_id,p.name project_name FROM campaigns c JOIN projects p ON p.id=c.project_id ${orgActive}
    WHERE p.organization_id=? AND (${auth.sql} OR ${grant.sql}) AND p.id IN ${inList(ids)} ORDER BY CASE WHEN c.status='closed' THEN 1 ELSE 0 END,c.starts_at DESC LIMIT 400`, [ctx.organizationId, ...auth.values, ...grant.values, ...ids]);
  const href = (row: Row) => `/?module=events&project=${enc(String(row.project_id))}&campaignId=${enc(String(row.id))}`;
  const found = best(ctx, rows, row => String(row.name), wanted);
  if (found.one) return { href: href(found.one), label: `dinâmica ${short(String(found.one.name))}` };
  if (found.many.length) return { options: found.many.map(row => ({ label: `${short(String(row.name))} · ${row.project_name}`, href: href(row) })) };
  return { note: notFound('dinâmica') };
}

/** Relatório pelo nome: rótulo de lib/reports.ts e palavras do dia a dia. */
const DATASET_WORDS: [string, ReportDatasetId][] = [['saidas rastreaveis', 'outflow_details'], ['por dia', 'campaign_days'], ['moviment', 'movements'], ['saida', 'outflows'], ['estoque', 'materials'], ['material', 'materials'], ['emprest', 'loans'], ['registro', 'records'], ['dinamica', 'campaigns'], ['evento', 'campaigns'], ['demanda', 'demands'], ['conferencia', 'reviews'], ['avaria', 'reviews'], ['projeto', 'projects']];
function datasetOf(wanted: string): ReportDatasetId | null {
  const value = norm(wanted);
  if (!value) return null;
  const byLabel = REPORT_DATASET_IDS.find(id => norm(REPORT_DATASETS[id].label) === value || id === value);
  return byLabel ?? DATASET_WORDS.find(([word]) => value.includes(word))?.[1] ?? null;
}

export async function runFase2dTool(ctx: Fase2dContext): Promise<RoleToolResult & { navigation?: RoleNavigation }> {
  if (Object.keys(ctx.args).some(key => !['tela', 'alvo', 'projeto', 'atrasadas'].includes(key))) bad('Consulta com campos não permitidos.');
  const screen = ctx.args.tela as Screen;
  if (typeof screen !== 'string' || !Object.hasOwn(SCREENS, screen)) bad('Escolha uma tela do portal.');
  if (ctx.args.atrasadas !== undefined && typeof ctx.args.atrasadas !== 'boolean') bad('Use verdadeiro ou falso em atrasadas.');
  let wantedProject = optionalText(ctx.args.projeto, 'o projeto'), alvo = optionalText(ctx.args.alvo, 'o alvo');
  // Nas telas sem ficha própria, o alvo é o projeto ("abra a agenda do CONPEEX").
  if (alvo && !wantedProject && ['projetos', 'registros', 'agenda', 'pessoas', 'equipes'].includes(screen)) { wantedProject = alvo; alvo = ''; }
  const deny = () => ctx.pack(KIND, [], [], ctx.budget, NO_ACCESS);
  const done = (href: string, label: string) => {
    const navigation = { href, label };
    return { ...ctx.pack(KIND, [{ abrir: label }], [], ctx.budget, `O botão "Abrir ${label}" aparece para a pessoa abaixo da resposta. Nada foi aberto: só o toque dela abre. Não escreva o endereço.`), rows: 1, navigation };
  };
  const options = (list: { label: string; href: string }[]) => ctx.pack(KIND, list.map(option => ({ opcao: option.label, link: option.href })), list, ctx.budget, 'Há mais de uma opção. Pergunte qual abrir; os links aparecem abaixo da resposta. Nada foi aberto.');
  const info = SCREENS[screen];

  // Demandas atrasadas: a tela Meu trabalho já filtra as atrasadas (com a pessoa ou a equipe dela).
  if (ctx.args.atrasadas === true && (screen === 'demandas' || screen === 'meu_trabalho')) {
    return await screenAllowed(ctx, 'meu_trabalho', null, null) ? done('/?module=my-work&workStatus=overdue', 'Meu trabalho: atrasadas') : deny();
  }
  const dataset = screen === 'relatorios' && alvo ? datasetOf(alvo) : null;
  if (screen === 'relatorios' && alvo && !dataset) return ctx.pack(KIND, [], [], ctx.budget, `Não encontrei esse relatório. Os relatórios são: ${REPORT_DATASET_IDS.map(id => REPORT_DATASETS[id].label).join(', ')}.`);

  // Primeiro a tela; depois, com projeto, a mesma regra naquele projeto.
  if (!await screenAllowed(ctx, screen, null, dataset)) return deny();
  let project: { id: string; name: string } | null = null;
  if (wantedProject && !['inicio', 'meu_trabalho', 'conta', 'configuracoes', 'comunidade', 'gestao', 'guia', 'convocacoes'].includes(screen)) {
    const found = await projectTarget(ctx, wantedProject);
    if ('options' in found) return options(found.options);
    if ('note' in found) return ctx.pack(KIND, [], [], ctx.budget, found.note);
    project = found;
    if (!await screenAllowed(ctx, screen, project.id, dataset)) return deny();
  }

  if (alvo && ['demandas', 'materiais', 'emprestimos', 'dinamicas'].includes(screen)) {
    const ids = project ? [project.id] : [...(await ctx.visibleProjects('', true)).keys()];
    const organizationWide = !project && (!ctx.scope || ctx.scope.kind === 'org');
    const target = screen === 'demandas' ? await demandTarget(ctx, alvo, ids, organizationWide) : screen === 'materiais' ? await itemTarget(ctx, alvo, ids) : screen === 'emprestimos' ? await loanTarget(ctx, alvo, ids) : await campaignTarget(ctx, alvo, ids);
    if ('options' in target) return options(target.options);
    if ('note' in target) return ctx.pack(KIND, [], [], ctx.budget, target.note);
    return done(target.href, target.label);
  }
  if (screen === 'projetos' && project) return done(projectRecord(project.id), `ficha do projeto ${short(project.name)}`);
  if (screen === 'guia') return done('/?module=management&gestao=guide', info.label);
  const params = [`module=${info.module}`, ...(project ? [`project=${enc(project.id)}`] : []), ...(dataset && dataset !== 'projects' ? [`report=${dataset}`] : [])];
  const label = [dataset ? `${info.label}: ${REPORT_DATASETS[dataset].label}` : info.label, project ? short(project.name) : ''].filter(Boolean).join(' · ');
  return done(`/?${params.join('&')}`, label);
}
