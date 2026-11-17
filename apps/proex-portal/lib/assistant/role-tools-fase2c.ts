/**
 * Ferramentas de leitura do Rolê · Fase 2c: equipes, organograma, registros, relatório do projeto e Gestão.
 * Cada uma chama o mesmo serviço que a tela usa (que confere a permissão no banco, na hora); nada é gravado.
 * Saem só campos que a tela mostra a quem pergunta: nomes de integrantes só na lista de equipes (como a tela
 * Equipes mostra), nunca e-mail, telefone, identificador de pessoa ou responsável de risco.
 *
 * Demandas: nenhuma ferramenta daqui lê `followup_tasks` direto. Contagens e títulos vêm de reportRows('demands')
 * e de managementDashboard, que já usam publicTaskAuthority (lib/follow-up/scope.ts): a demanda privada não chega aqui.
 * Relatório, equipes e Gestão são leituras caras: contam no limite `role-heavy` por pessoa.
 */
import { requireCapability, type PortalActor } from '../access';
import { HttpError } from '../errors';
import { rateLimitAll } from '../rate-limit';
import { reportRows } from '../reports';
import { projectDetail } from '../projects';
import { teamsWorkspace } from '../follow-up/teams';
import { structureWorkspace } from '../institutional-structure/service';
import { kindLabels, relationLabels } from '../institutional-structure/contracts';
import { listRecords } from '../records';
import { managementDashboard } from '../management/dashboard';
import { risksWorkspace } from '../management/risks';
import type { ResolvedScope, RoleToolResult, RoleToolSource } from './role-tools';

type Pack = (kind: string, items: Record<string, unknown>[], sources: RoleToolSource[], budget: number, note?: string, extra?: Record<string, unknown>) => RoleToolResult;
/**
 * O que role-tools.ts entrega (sem import circular): `projects(nome)` devolve os projetos visíveis no escopo que
 * casam com o nome (visibleProjects + matchProjectNames: sigla, letra final e preferência pelo nome exato),
 * conferidos no banco a cada chamada.
 */
export type Fase2cContext = { db: D1Database; actor: PortalActor; organizationId: string; scope: ResolvedScope | null; budget: number; pack: Pack; projects: (wanted?: string) => Promise<Map<string, string>> };

// Esquema enxuto (conta no teto ROLE_TOOLS_SCHEMA_BYTES): sem campos obrigatórios; datas conferidas no servidor.
const text = (description: string) => ({ type: 'string', description, maxLength: 120 });
const day = { type: 'string', description: 'AAAA-MM-DD' };
const fn = (name: string, description: string, properties: Record<string, unknown>) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, additionalProperties: false } } });
const projeto = text('Nome ou sigla do projeto.');
const RECORD_KINDS: Record<string, string> = { observacao: 'observation', manutencao: 'maintenance', distribuicao: 'distribution', consumo: 'consumption', projeto: 'project', material: 'material', emprestimo: 'loan' };
const RECORD_LABELS: Record<string, string> = { observation: 'observação', maintenance: 'manutenção', distribution: 'distribuição', consumption: 'consumo', project: 'atividade do projeto', material: 'material', loan: 'empréstimo' };

export const FASE2C_TOOLS = [
  fn('registros_recentes', 'Últimos registros de atividades, por tipo e período.', { projeto, tipo: { type: 'string', enum: Object.keys(RECORD_KINDS) }, de: day, ate: day }),
  fn('consultar_equipes', 'Equipes de trabalho: integrantes, unidades e projetos.', { projeto }),
  fn('consultar_organograma', 'Organograma: unidades, a quem respondem e equipes ligadas.', { texto: text('Unidade ou sigla.') }),
  fn('resumir_relatorio_projeto', 'Resumo do relatório de um projeto (totais, demandas, materiais).', { projeto, de: day, ate: day }),
  fn('consultar_gestao', 'Indicadores e riscos da Gestão (organização ou projeto).', { projeto }),
];
export const FASE2C_TOOL_NAMES = new Set(FASE2C_TOOLS.map(tool => tool.function.name));
const ALLOWED: Record<string, string[]> = { registros_recentes: ['projeto', 'tipo', 'de', 'ate'], consultar_equipes: ['projeto'], consultar_organograma: ['texto'], resumir_relatorio_projeto: ['projeto', 'de', 'ate'], consultar_gestao: ['projeto'] };
/** Leituras caras: relatório, equipes e Gestão. Por pessoa, por minuto. */
export const ROLE_HEAVY_LIMIT = 10;
const HEAVY = new Set(['consultar_equipes', 'resumir_relatorio_projeto', 'consultar_gestao']);

const norm = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const words = (value: string) => norm(value).split(/[^a-z0-9]+/).filter(Boolean);
const LINKING = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a']);
function str(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 120) throw new HttpError(400, `Confira ${label}.`, 'role_tool_input');
  return value.trim();
}
function civilDay(value: unknown, label: string): string | null {
  const raw = str(value, label);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString().slice(0, 10) !== raw) throw new HttpError(400, `Use ${label} no formato AAAA-MM-DD.`, 'role_tool_input');
  return raw;
}
const denied = (error: unknown) => error instanceof HttpError && [401, 403, 404, 409].includes(error.status);
const permitted = (actor: PortalActor, capability: string, projectId: string) => { try { requireCapability(actor, capability, projectId); return true; } catch { return false; } };
const brasilia = (iso: unknown) => { const t = Date.parse(String(iso)); return Number.isFinite(t) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(t)) : String(iso ?? ''); };
const projectLink = (module: string, projectId: string, extra = '') => `/?module=${module}&project=${encodeURIComponent(projectId)}${extra}`;

/** Projetos citados, entre os visíveis no escopo (busca de role-tools.ts). Com vários, o nome idêntico decide. */
async function pickProjects(ctx: Fase2cContext, wanted: string): Promise<[string, string][]> {
  const found = [...await ctx.projects(wanted)];
  const asked = words(wanted).filter(word => !LINKING.has(word)).join(' ');
  const exact = asked ? found.filter(([, name]) => words(name).filter(word => !LINKING.has(word)).join(' ') === asked) : [];
  return exact.length === 1 ? exact : found;
}
const noProject = (ctx: Fase2cContext, kind: string) => ctx.pack(kind, [], [], ctx.budget, ctx.scope && ctx.scope.kind !== 'org' ? `Nada visível para você em ${ctx.scope.label} com esse filtro.` : 'Nenhum projeto visível para você com esse nome.');
const askProject = (ctx: Fase2cContext, kind: string, chosen: [string, string][]) => ctx.pack(kind, [], [], ctx.budget, 'Pergunte de qual projeto.', { projetos: chosen.slice(0, 8).map(([, name]) => name) });

export async function runFase2cTool(ctx: Fase2cContext, name: string, args: Record<string, unknown>): Promise<RoleToolResult> {
  if (Object.keys(args).some(key => !ALLOWED[name]?.includes(key))) throw new HttpError(400, 'Consulta com campos não permitidos.', 'role_tool_input');
  if (HEAVY.has(name)) {
    try { await rateLimitAll(ctx.db, [{ bucket: `role-heavy:${ctx.actor.userId}`, limit: ROLE_HEAVY_LIMIT, windowMs: 60_000 }]); }
    catch (error) { if (error instanceof HttpError && error.code === 'rate_limited') return ctx.pack(name, [], [], ctx.budget, 'Muitas consultas de relatório, equipes ou Gestão seguidas. Espere um minuto e pergunte de novo.'); throw error; }
  }
  if (name === 'registros_recentes') return recordsTool(ctx, args);
  if (name === 'consultar_equipes') return teamsTool(ctx, str(args.projeto, 'o projeto'));
  if (name === 'consultar_organograma') return structureTool(ctx, str(args.texto, 'a unidade'));
  if (name === 'resumir_relatorio_projeto') return reportTool(ctx, args);
  return managementTool(ctx, str(args.projeto, 'o projeto'));
}

/**
 * Mesma leitura da tela Registros (listRecords). Tipo e período estreitam; nunca ampliam. Com até 5 projetos
 * escolhidos, consulta um a um (100 por projeto) antes de filtrar o tipo; com mais, uma consulta só, já filtrada pela
 * organização da conversa antes do limite (registros de outra organização não empurram os desta para fora).
 */
async function recordsTool(ctx: Fase2cContext, args: Record<string, unknown>): Promise<RoleToolResult> {
  const kind = 'registros_recentes';
  const type = str(args.tipo, 'o tipo');
  if (type && !RECORD_KINDS[type]) throw new HttpError(400, 'Confira o tipo de registro.', 'role_tool_input');
  const from = civilDay(args.de, 'a data inicial'), to = civilDay(args.ate, 'a data final');
  if (from && to && to < from) throw new HttpError(400, 'A data final deve vir depois da inicial.', 'role_tool_input');
  const chosen = await pickProjects(ctx, str(args.projeto, 'o projeto'));
  if (!chosen.length) return noProject(ctx, kind);
  const projects = new Map(chosen);
  // Dias civis de Brasília (UTC-3): de 00:00 do início até 00:00 do dia seguinte ao fim.
  const next = (value: string) => new Date(Date.parse(`${value}T03:00:00.000Z`) + 86400000).toISOString();
  const period = { ...(from ? { from: `${from}T03:00:00.000Z` } : {}), ...(to ? { to: next(to) } : {}) };
  const wanted = (entry: Record<string, unknown>) => projects.has(String(entry.project_id)) && (!type || entry.kind === RECORD_KINDS[type]);
  const rows: Record<string, unknown>[] = [];
  for (const projectId of chosen.length <= 5 ? chosen.map(([id]) => id) : [null]) {
    // Páginas de 100 para trás no tempo (o fim é exclusivo), até 5 páginas ou 20 registros do tipo pedido.
    let before = period.to, hits = 0;
    for (let page = 0; page < 5 && hits < 20; page++) {
      let result: Awaited<ReturnType<typeof listRecords>>;
      try { result = await listRecords(ctx.db, ctx.actor, { projectId, ...(projectId ? {} : { organizationId: ctx.organizationId }), limit: 100, ...period, ...(before ? { to: before } : {}) }); }
      catch (error) { if (!denied(error)) throw error; break; }
      rows.push(...result.records); hits += result.records.filter(wanted).length;
      const oldest = result.records.at(-1)?.occurred_at;
      if (!result.truncated || !oldest || oldest === before || (period.from && String(oldest) <= period.from)) break;
      before = String(oldest);
    }
  }
  const seen = new Set<string>();
  const found = rows.filter(entry => wanted(entry) && !seen.has(String(entry.id)) && !!seen.add(String(entry.id)))
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at))).slice(0, 20);
  const results: Record<string, unknown>[] = [], sources: RoleToolSource[] = [];
  for (const record of found) {
    const projectId = String(record.project_id), projectName = projects.get(projectId);
    // Link para a ficha do material ou do empréstimo quando houver; senão, a tela Registros do projeto.
    const href = record.item_id && record.kind !== 'loan' && !record.loan_id ? projectLink('materials', projectId, `&itemId=${encodeURIComponent(String(record.item_id))}`)
      : record.loan_id ? projectLink('loans', projectId, `&loanId=${encodeURIComponent(String(record.loan_id))}`) : projectLink('records', projectId);
    results.push({ registro: record.title, tipo: RECORD_LABELS[String(record.kind)] ?? record.kind, quando: brasilia(record.occurred_at), projeto: projectName, link: href });
    sources.push({ label: `${String(record.title).slice(0, 60)} · ${projectName}`, href });
  }
  return ctx.pack(kind, results, sources, ctx.budget, results.length ? '' : 'Nenhum registro que você possa ver com esse filtro.');
}

/**
 * Mesma leitura da tela Equipes (teamsWorkspace): integrantes que essa tela mostra a quem pergunta. Sem contagem
 * de demandas. Administração sem projeto: uma chamada para a organização; senão, no máximo 3 projetos.
 */
async function teamsTool(ctx: Fase2cContext, wanted: string): Promise<RoleToolResult> {
  const kind = 'consultar_equipes';
  const chosen = await pickProjects(ctx, wanted);
  if (!chosen.length) return noProject(ctx, kind);
  type Workspace = Awaited<ReturnType<typeof teamsWorkspace>>;
  const workspaces: { workspace: Workspace; projectId: string | null }[] = [];
  const read = async (projectId: string | null) => {
    try { workspaces.push({ workspace: await teamsWorkspace(ctx.db, ctx.actor, projectId ? { projectId } : { organizationId: ctx.organizationId }), projectId }); return true; }
    catch (error) { if (!denied(error)) throw error; return false; }
  };
  // Visão da organização só para a administração (o serviço confere de novo no banco), sem projeto e sem escopo menor.
  const administration = ctx.actor.members.some(member => member.role === 'owner' && !member.project_id && !member.revoked_at);
  const whole = administration && !wanted && (!ctx.scope || ctx.scope.kind === 'org') && await read(null);
  if (!whole) for (const [projectId] of chosen.slice(0, 3)) await read(projectId);
  const teams = new Map<string, { item: { equipe: string; situacao: string; minha: boolean; link: string }; members: Set<string>; units: Set<string>; projects: Set<string> }>();
  for (const { workspace, projectId } of workspaces) for (const team of workspace.teams) {
    // Quem gerencia vê todas as equipes da organização mesmo no recorte do projeto: fica só o que é do projeto ou da pessoa.
    if (projectId && workspace.scope.canManage && !team.isMine && !team.projects.some(project => project.id === projectId)) continue;
    const entry = teams.get(String(team.id)) ?? { item: { equipe: String(team.name), situacao: team.status === 'active' ? 'ativa' : 'arquivada', minha: Boolean(team.isMine), link: `/?module=work-teams&teamId=${encodeURIComponent(String(team.id))}&organizationId=${encodeURIComponent(workspace.scope.organizationId)}` }, members: new Set<string>(), units: new Set<string>(), projects: new Set<string>() };
    team.members.forEach(member => entry.members.add(String(member.name)));
    team.units.forEach(unit => entry.units.add(unit.acronym ? `${unit.acronym} — ${unit.name}` : String(unit.name)));
    team.projects.forEach(project => entry.projects.add(String(project.name)));
    teams.set(String(team.id), entry);
  }
  const items = [...teams.values()].sort((a, b) => Number(b.item.minha) - Number(a.item.minha) || a.item.equipe.localeCompare(b.item.equipe, 'pt-BR')).map(entry => {
    const members = [...entry.members].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return { ...entry.item, integrantes: members.slice(0, 15), ...(members.length > 15 ? { maisIntegrantes: members.length - 15 } : {}), unidades: [...entry.units], projetos: [...entry.projects].slice(0, 8) };
  });
  const sources = items.map(item => ({ label: `Equipe ${item.equipe}`, href: item.link }));
  const more = !whole && chosen.length > 3 ? ` Mostrei as equipes de 3 dos ${chosen.length} projetos; peça um projeto para ver as outras.` : '';
  return ctx.pack(kind, items, sources, ctx.budget, items.length ? `Integrantes como a tela Equipes mostra para você.${more}` : 'Nenhuma equipe que você possa ver nesse recorte.');
}

/** Mesma leitura do organograma (structureWorkspace): unidades da organização e as equipes ligadas que a pessoa vê. */
async function structureTool(ctx: Fase2cContext, wanted: string): Promise<RoleToolResult> {
  const kind = 'consultar_organograma';
  const visible = [...(await ctx.projects())];
  if (!visible.length) return noProject(ctx, kind);
  type Workspace = Awaited<ReturnType<typeof structureWorkspace>>;
  let workspace: Workspace | null = null, viaProject: string | null = null;
  // Sem ser administração da organização, a tela abre o organograma pelo recorte de um projeto que a pessoa vê.
  for (const projectId of [null, ...visible.slice(0, 3).map(([id]) => id)]) {
    try { workspace = await structureWorkspace(ctx.db, ctx.actor, { organizationId: ctx.organizationId, ...(projectId ? { projectId } : {}) }); viaProject = projectId; break; }
    catch (error) { if (!denied(error)) throw error; }
  }
  if (!workspace) return ctx.pack(kind, [], [], ctx.budget, 'O organograma desta organização não está disponível para você.');
  const href = viaProject ? projectLink('work-teams', viaProject) : '/?module=work-teams';
  const byId = new Map(workspace.nodes.map(node => [node.id, node])), teamName = new Map(workspace.teams.map(team => [team.id, team.name]));
  const asked = words(wanted).filter(word => !LINKING.has(word));
  const items = workspace.nodes.filter(node => node.status === 'active' && (!asked.length || asked.every(word => words(`${node.name} ${node.acronym} ${kindLabels[node.kind]}`).includes(word))))
    .map(node => ({ unidade: node.name, ...(node.acronym ? { sigla: node.acronym } : {}), tipo: kindLabels[node.kind] ?? node.kind, relacao: relationLabels[node.relation] ?? node.relation, superior: node.parentId ? byId.get(node.parentId)?.name ?? null : null,
      equipes: workspace.links.filter(entry => entry.nodeId === node.id).map(entry => teamName.get(entry.teamId)).filter(Boolean) }));
  const source = workspace.source ? { fonte: workspace.source.label, revisao: workspace.source.revision, emitidoEm: workspace.source.issuedOn, ...(workspace.source.referenceUrl ? { documento: workspace.source.referenceUrl } : {}) } : null;
  // Um link só, para a tela do organograma (não um por unidade).
  const result = ctx.pack(kind, items, [], ctx.budget, items.length ? '' : asked.length ? 'Nenhuma unidade do organograma com esse nome.' : 'O organograma ainda não foi cadastrado.', { link: href, ...(source ? { fonte: source } : {}) });
  return { ...result, sources: result.rows ? [{ label: 'Organograma', href }] : [] };
}

/**
 * Relatório do projeto resumido: a mesma ficha (projectDetail confere quem vê o projeto) e só os conjuntos de
 * relatório necessários (reportRows aplica a permissão de cada um), como no montador (lib/project-report.ts).
 */
async function reportTool(ctx: Fase2cContext, args: Record<string, unknown>): Promise<RoleToolResult> {
  const kind = 'resumir_relatorio_projeto';
  const from = civilDay(args.de, 'a data inicial'), to = civilDay(args.ate, 'a data final');
  if (from && to && to < from) throw new HttpError(400, 'A data final deve vir depois da inicial.', 'role_tool_input');
  const chosen = await pickProjects(ctx, str(args.projeto, 'o projeto'));
  if (!chosen.length) return noProject(ctx, kind);
  if (chosen.length > 1) return askProject(ctx, kind, chosen);
  const [projectId, projectName] = chosen[0], actor = ctx.actor;
  const range = { projectId, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const rows = (dataset: string, input: Record<string, unknown> = range) => reportRows(ctx.db, actor, { ...input, dataset });
  let detail: Awaited<ReturnType<typeof projectDetail>>;
  try { detail = await projectDetail(ctx.db, actor, projectId); }
  catch (error) { if (denied(error)) return ctx.pack(kind, [], [], ctx.budget, 'O relatório deste projeto não está disponível para você.'); throw error; }
  const can = (...capabilities: string[]) => capabilities.some(capability => permitted(actor, capability, projectId));
  let demands, materials, movements, loans, campaigns, records;
  try {
    [demands, materials, movements, loans, campaigns, records] = await Promise.all([
      rows('demands'),
      can('inventory.read', 'reports.read') ? rows('materials', { projectId }) : null,
      can('inventory.read', 'reports.read') ? rows('movements') : null,
      can('loans.read', 'reports.read') ? rows('loans') : null,
      can('reports.read', 'campaigns.manage') ? rows('campaigns') : null,
      rows('records'),
    ]);
  } catch (error) { if (denied(error)) return ctx.pack(kind, [], [], ctx.budget, 'O relatório deste projeto não está disponível para você.'); throw error; }
  const project = detail.project as Record<string, unknown>;
  const cut = (set: { truncated: boolean } | null) => set?.truncated ? { truncado: true } : {};
  const openDemands = demands.rows.filter(row => ['open', 'in_progress', 'blocked'].includes(String(row.situacao)));
  const STATUS: Record<string, string> = { open: 'aberta', in_progress: 'em andamento', blocked: 'bloqueada' };
  const sum = (list: Record<string, unknown>[], key: string) => list.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const low = materials?.rows.filter(row => row.situacao_estoque === 'baixo') ?? [];
  const inPeriod = (start: unknown) => { const date = String(start ?? '').slice(0, 10); return (!from || date >= from) && (!to || date <= to); };
  const href = projectLink('projects', projectId, `&detailProject=${encodeURIComponent(projectId)}`), reportsHref = projectLink('reports', projectId);
  const item = {
    projeto: project.name ?? projectName, ...(project.unit_name ? { unidade: project.unit_acronym ? `${project.unit_acronym} · ${project.unit_name}` : project.unit_name } : {}), situacao: project.status, etapa: project.lifecycle,
    periodo: from || to ? { de: from, ate: to } : 'todo o período',
    demandas: {
      // Com período, entram as demandas criadas nele (mesmo critério do relatório).
      ...(from || to ? { recorte: 'criadas no período' } : {}),
      total: demands.rows.length, abertas: openDemands.length, atrasadas: demands.rows.filter(row => row.em_atraso === 'sim').length,
      altaPrioridadeAbertas: openDemands.filter(row => row.prioridade === 'high').length, concluidas: demands.rows.filter(row => row.situacao === 'completed').length,
      proximas: openDemands.filter(row => row.prazo).sort((a, b) => String(a.prazo).localeCompare(String(b.prazo))).slice(0, 5).map(row => ({ demanda: row.demanda, prazo: row.prazo, situacao: STATUS[String(row.situacao)] ?? row.situacao })),
      ...cut(demands),
    },
    ...(materials && movements ? { materiais: {
      itens: materials.rows.length, estoqueBaixo: low.length, baixos: low.slice(0, 5).map(row => row.material),
      movimentacoes: movements.rows.length, saidas: Math.abs(sum(movements.rows.filter(row => Number(row.quantidade) < 0 && ['distribute', 'redeem'].includes(String(row.tipo))), 'quantidade')),
      ...(materials.truncated || movements.truncated ? { truncado: true } : {}),
    } } : {}),
    ...(loans ? { emprestimos: { total: loans.rows.length, emAberto: loans.rows.filter(row => ['reserved', 'out'].includes(String(row.situacao))).length, atrasados: loans.rows.filter(row => row.em_atraso === 'sim').length, ...cut(loans) } } : {}),
    ...(campaigns ? { dinamicas: { total: campaigns.rows.length, participacoes: sum(campaigns.rows, 'participacoes'), premiosEntregues: sum(campaigns.rows, 'premios_entregues'), ...cut(campaigns) } } : {}),
    agenda: (detail.schedule as Record<string, unknown>[]).filter(entry => entry.status !== 'cancelled' && inPeriod(entry.starts_at)).length,
    registros: records.rows.length, ...(records.truncated ? { registrosTruncado: true } : {}),
    relatorios: reportsHref, link: href,
  };
  const result = ctx.pack(kind, [item], [], ctx.budget, 'Resumo do relatório que você pode gerar. O documento completo (PDF) sai na ficha do projeto.');
  return { ...result, sources: result.rows ? [{ label: `Relatório · ${item.projeto}`, href }, { label: `Relatórios · ${item.projeto}`, href: reportsHref }] : [] };
}

const RISK_STATUS: Record<string, string> = { open: 'aberto', monitoring: 'em monitoramento', mitigated: 'mitigado', closed: 'encerrado' };
/**
 * Mesma leitura da Gestão (managementDashboard e risksWorkspace): só para quem faz parte da organização; riscos como
 * a tela mostra. Organização inteira (uma leitura) ou até 3 projetos; com mais, pergunta qual.
 */
async function managementTool(ctx: Fase2cContext, wanted: string): Promise<RoleToolResult> {
  const kind = 'consultar_gestao';
  let targets: [string | null, string][] = [[null, 'toda a organização']];
  if (wanted || (ctx.scope && ctx.scope.kind !== 'org')) {
    const chosen = await pickProjects(ctx, wanted);
    if (!chosen.length) return noProject(ctx, kind);
    if (chosen.length > 3) return askProject(ctx, kind, chosen);
    targets = chosen;
  } else if (!(await ctx.projects()).size) return noProject(ctx, kind);
  const recortes: Record<string, unknown>[] = [], items: Record<string, unknown>[] = [];
  const risksHref = '/?module=management&gestao=risks', dashboardHref = '/?module=management&gestao=dashboard';
  for (const [projectId, label] of targets) {
    const input = { organizationId: ctx.organizationId, ...(projectId ? { projectId } : {}) };
    let dashboard: Awaited<ReturnType<typeof managementDashboard>>, risks: Awaited<ReturnType<typeof risksWorkspace>>;
    try { dashboard = await managementDashboard(ctx.db, ctx.actor, input); risks = await risksWorkspace(ctx.db, ctx.actor, input); }
    catch (error) { if (denied(error)) continue; throw error; }
    const k = dashboard.kpis;
    const indicadores = Object.fromEntries(Object.entries({
      demandasAbertas: k.demandsOpen, demandasAtrasadas: k.demandsOverdue, demandasAltaPrioridade: k.demandsHighOpen, demandasCriadasNoPeriodo: k.demandsCreated, demandasConcluidasNoPeriodo: k.demandsCompleted,
      // Sem acesso aos materiais o painel não mostra entregas: o zero não sai.
      itensEntreguesNoPeriodo: dashboard.deliveriesByMonth === null ? null : k.itemsOut, dinamicasAtivas: k.campaignsActive, participacoes: k.participations, materiaisComEstoqueBaixo: k.lowStock,
      riscosAbertos: k.risksOpen, riscosAltos: k.risksHigh, riscosCriticos: k.risksCritical, riscosComRevisaoAtrasada: k.risksReviewOverdue,
    }).filter(([, value]) => value !== null && value !== undefined));
    recortes.push({ recorte: label, periodo: { de: dashboard.period.from, ate: dashboard.period.to }, indicadores,
      ...(dashboard.lowStock?.length ? { estoqueBaixo: dashboard.lowStock.map(row => ({ material: row.material, projeto: row.project, disponivel: row.available })) } : {}) });
    for (const risk of risks.risks.filter(entry => entry.status === 'open' || entry.status === 'monitoring').slice(0, 12)) items.push({
      risco: risk.title, nivel: risk.level, situacao: RISK_STATUS[String(risk.status)] ?? risk.status, categoria: risk.category, probabilidade: risk.probability, impacto: risk.impact,
      projeto: risk.projectName ?? 'Organização', revisao: risk.reviewOn, ...(risk.reviewOverdue ? { revisaoAtrasada: true } : {}), ...(risk.isExample ? { exemplo: true } : {}),
      responsavel: risk.ownerLabel ? 'definido' : 'não definido', mitigacao: String(risk.mitigation ?? '').slice(0, 300), link: risksHref,
    });
  }
  if (!recortes.length) return ctx.pack(kind, [], [], ctx.budget, 'A Gestão desta organização não está disponível para você.');
  const result = ctx.pack(kind, items, [{ label: 'Riscos · Gestão', href: risksHref }], ctx.budget, items.length ? 'Riscos abertos ou em monitoramento, do mais grave ao mais leve.' : 'Nenhum risco aberto que você possa ver.', recortes.length === 1 ? recortes[0] : { recortes });
  // Os indicadores contam como resultado: a Gestão respondeu, mesmo sem riscos abertos.
  return { ...result, rows: result.rows + recortes.length, sources: [{ label: 'Painel da Gestão', href: dashboardHref }, ...result.sources] };
}
