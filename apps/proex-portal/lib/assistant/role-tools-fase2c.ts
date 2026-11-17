/**
 * Ferramentas de leitura do Rolê · Fase 2c: equipes, organograma, registros, relatório do projeto e Gestão.
 * Cada uma chama o mesmo serviço que a tela usa (que confere a permissão no banco, na hora); nada é gravado.
 * Saem só campos que a tela mostra a quem pergunta: nomes de integrantes só na lista de equipes (como a tela
 * Equipes mostra), nunca e-mail, telefone, identificador de pessoa ou responsável de risco.
 *
 * Demandas: nenhuma ferramenta daqui lê `followup_tasks` direto. As contagens e títulos vêm de
 * reportRows('demands') (lib/follow-up/reports.ts), teamsWorkspace e managementDashboard; quando as demandas
 * privadas (PR #212) entrarem, essas leituras passam a usar publicTaskAuthority e a demanda privada não chega aqui.
 * Se alguma ferramenta daqui precisar ler demandas, use só `roleDemandRows` abaixo.
 */
import type { PortalActor } from '../access';
import { HttpError } from '../errors';
import { reportRows } from '../reports';
import { teamsWorkspace } from '../follow-up/teams';
import { structureWorkspace } from '../institutional-structure/service';
import { kindLabels, relationLabels } from '../institutional-structure/contracts';
import { listRecords } from '../records';
import { projectReportData } from '../project-report';
import { managementDashboard } from '../management/dashboard';
import { risksWorkspace } from '../management/risks';
import type { ResolvedScope, RoleToolResult, RoleToolSource } from './role-tools';

type Pack = (kind: string, items: Record<string, unknown>[], sources: RoleToolSource[], budget: number, note?: string, extra?: Record<string, unknown>) => RoleToolResult;
/** O que role-tools.ts entrega (sem import circular): projetos visíveis no escopo, conferidos no banco a cada chamada. */
export type Fase2cContext = { db: D1Database; actor: PortalActor; organizationId: string; scope: ResolvedScope | null; budget: number; pack: Pack; projects: () => Promise<Map<string, string>> };

/** Único ponto de leitura de demandas destas ferramentas. Com a #212 na main, já filtra as privadas (publicTaskAuthority). */
export const roleDemandRows = (db: D1Database, actor: PortalActor, input: Record<string, unknown>) => reportRows(db, actor, { ...input, dataset: 'demands' });

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
const brasilia = (iso: unknown) => { const t = Date.parse(String(iso)); return Number.isFinite(t) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(t)) : String(iso ?? ''); };
const projectLink = (module: string, projectId: string, extra = '') => `/?module=${module}&project=${encodeURIComponent(projectId)}${extra}`;

/**
 * Projetos citados, só entre os que a pessoa vê no escopo. Nome conferido palavra por palavra (siglas de uma
 * letra contam: "Projeto B" nunca vira "Projeto A"); com mais de um, o nome idêntico decide.
 */
async function pickProjects(ctx: Fase2cContext, wanted: string): Promise<[string, string][]> {
  const visible = [...(await ctx.projects())];
  const asked = words(wanted).filter(word => !LINKING.has(word));
  if (!asked.length) return visible;
  const matches = visible.filter(([id, name]) => id === wanted || asked.every(word => words(name).includes(word)));
  const exact = matches.filter(([, name]) => words(name).filter(word => !LINKING.has(word)).join(' ') === asked.join(' '));
  return exact.length === 1 ? exact : matches;
}
const noProject = (ctx: Fase2cContext, kind: string) => ctx.pack(kind, [], [], ctx.budget, ctx.scope && ctx.scope.kind !== 'org' ? `Nada visível para você em ${ctx.scope.label} com esse filtro.` : 'Nenhum projeto visível para você com esse nome.');
/** Um projeto só (relatório, Gestão por projeto): com vários, devolve a lista para a pessoa escolher. */
async function oneProject(ctx: Fase2cContext, kind: string, wanted: string): Promise<[string, string] | RoleToolResult> {
  const chosen = await pickProjects(ctx, wanted);
  if (!chosen.length) return noProject(ctx, kind);
  if (chosen.length > 1) return ctx.pack(kind, [], [], ctx.budget, 'Pergunte de qual projeto.', { projetos: chosen.slice(0, 8).map(([, name]) => name) });
  return chosen[0];
}

export async function runFase2cTool(ctx: Fase2cContext, name: string, args: Record<string, unknown>): Promise<RoleToolResult> {
  if (Object.keys(args).some(key => !ALLOWED[name]?.includes(key))) throw new HttpError(400, 'Consulta com campos não permitidos.', 'role_tool_input');
  if (name === 'registros_recentes') return recordsTool(ctx, args);
  if (name === 'consultar_equipes') return teamsTool(ctx, str(args.projeto, 'o projeto'));
  if (name === 'consultar_organograma') return structureTool(ctx, str(args.texto, 'a unidade'));
  if (name === 'resumir_relatorio_projeto') return reportTool(ctx, args);
  return managementTool(ctx, str(args.projeto, 'o projeto'));
}

/** Mesma leitura da tela Registros (listRecords). Tipo e período estreitam; nunca ampliam. */
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
  const results: Record<string, unknown>[] = [], sources: RoleToolSource[] = [];
  try {
    const { records } = await listRecords(ctx.db, ctx.actor, { projectId: chosen.length === 1 ? chosen[0][0] : null, limit: 100, ...(from ? { from: `${from}T03:00:00.000Z` } : {}), ...(to ? { to: next(to) } : {}) });
    for (const record of records.filter(entry => projects.has(String(entry.project_id)) && (!type || entry.kind === RECORD_KINDS[type])).slice(0, 20)) {
      const projectId = String(record.project_id), projectName = projects.get(projectId);
      // Link para a ficha do material ou do empréstimo quando houver; senão, a tela Registros do projeto.
      const href = record.item_id && record.kind !== 'loan' && !record.loan_id ? projectLink('materials', projectId, `&itemId=${encodeURIComponent(String(record.item_id))}`)
        : record.loan_id ? projectLink('loans', projectId, `&loanId=${encodeURIComponent(String(record.loan_id))}`) : projectLink('records', projectId);
      results.push({ registro: record.title, tipo: RECORD_LABELS[String(record.kind)] ?? record.kind, quando: brasilia(record.occurred_at), projeto: projectName, link: href });
      sources.push({ label: `${String(record.title).slice(0, 60)} · ${projectName}`, href });
    }
  } catch (error) { if (!denied(error)) throw error; }
  return ctx.pack(kind, results, sources, ctx.budget, results.length ? '' : 'Nenhum registro que você possa ver com esse filtro.');
}

/** Mesma leitura da tela Equipes (teamsWorkspace): integrantes que essa tela mostra a quem pergunta. Sem contagem de demandas. */
async function teamsTool(ctx: Fase2cContext, wanted: string): Promise<RoleToolResult> {
  const kind = 'consultar_equipes';
  const chosen = await pickProjects(ctx, wanted);
  if (!chosen.length) return noProject(ctx, kind);
  type Workspace = Awaited<ReturnType<typeof teamsWorkspace>>;
  const workspaces: Workspace[] = [];
  const read = async (input: Record<string, unknown>) => { try { workspaces.push(await teamsWorkspace(ctx.db, ctx.actor, input)); return true; } catch (error) { if (!denied(error)) throw error; return false; } };
  // Organização inteira só para quem a tela mostra assim (administração) e sem filtro de projeto ou escopo menor.
  const whole = !wanted && (!ctx.scope || ctx.scope.kind === 'org') && await read({ organizationId: ctx.organizationId });
  if (!whole) for (const [projectId] of chosen.slice(0, 6)) await read({ projectId });
  const teams = new Map<string, { item: { equipe: string; situacao: string; minha: boolean; link: string }; members: Set<string>; units: Set<string>; projects: Set<string> }>();
  for (const workspace of workspaces) for (const team of workspace.teams) {
    const entry = teams.get(String(team.id)) ?? { item: { equipe: team.name, situacao: team.status === 'active' ? 'ativa' : 'arquivada', minha: team.isMine, link: `/?module=work-teams&teamId=${encodeURIComponent(String(team.id))}&organizationId=${encodeURIComponent(workspace.scope.organizationId)}` }, members: new Set<string>(), units: new Set<string>(), projects: new Set<string>() };
    team.members.forEach(member => entry.members.add(String(member.name)));
    team.units.forEach(unit => entry.units.add(unit.acronym ? `${unit.acronym} — ${unit.name}` : String(unit.name)));
    team.projects.forEach(project => entry.projects.add(String(project.name)));
    teams.set(String(team.id), entry);
  }
  const items = [...teams.values()].sort((a, b) => Number(b.item.minha) - Number(a.item.minha) || String(a.item.equipe).localeCompare(String(b.item.equipe), 'pt-BR')).map(entry => {
    const members = [...entry.members].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return { ...entry.item, integrantes: members.slice(0, 15), ...(members.length > 15 ? { maisIntegrantes: members.length - 15 } : {}), unidades: [...entry.units], projetos: [...entry.projects].slice(0, 8) };
  });
  const sources = items.map(item => ({ label: `Equipe ${item.equipe}`, href: String(item.link) }));
  return ctx.pack(kind, items, sources, ctx.budget, items.length ? 'Integrantes como a tela Equipes mostra para você.' : 'Nenhuma equipe que você possa ver nesse recorte.');
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
      equipes: workspace.links.filter(entry => entry.nodeId === node.id).map(entry => teamName.get(entry.teamId)).filter(Boolean), link: href }));
  const source = workspace.source ? { fonte: workspace.source.label, revisao: workspace.source.revision, emitidoEm: workspace.source.issuedOn, ...(workspace.source.referenceUrl ? { documento: workspace.source.referenceUrl } : {}) } : null;
  return ctx.pack(kind, items, items.length ? [{ label: 'Organograma', href }] : [], ctx.budget, items.length ? '' : asked.length ? 'Nenhuma unidade do organograma com esse nome.' : 'O organograma ainda não foi cadastrado.', source ? { fonte: source } : {});
}

/** Mesma montagem do relatório do projeto (projectReportData), resumida: seções sem permissão ficam de fora. */
async function reportTool(ctx: Fase2cContext, args: Record<string, unknown>): Promise<RoleToolResult> {
  const kind = 'resumir_relatorio_projeto';
  const from = civilDay(args.de, 'a data inicial'), to = civilDay(args.ate, 'a data final');
  const picked = await oneProject(ctx, kind, str(args.projeto, 'o projeto'));
  if (!Array.isArray(picked)) return picked;
  const [projectId, projectName] = picked;
  let data: Awaited<ReturnType<typeof projectReportData>>;
  try { data = await projectReportData(ctx.db, ctx.actor, projectId, { ...(from ? { from } : {}), ...(to ? { to } : {}) }); }
  catch (error) { if (denied(error)) return ctx.pack(kind, [], [], ctx.budget, 'O relatório deste projeto não está disponível para você.'); throw error; }
  const sections = data.sections, demands = sections.demands.rows as Record<string, unknown>[];
  const openDemands = demands.filter(row => ['open', 'in_progress', 'blocked'].includes(String(row.situacao)));
  const STATUS: Record<string, string> = { open: 'aberta', in_progress: 'em andamento', blocked: 'bloqueada' };
  const materials = sections.materials, loans = sections.loans, campaigns = sections.campaigns;
  const sum = (rows: Record<string, unknown>[], key: string) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const href = projectLink('projects', projectId, `&detailProject=${encodeURIComponent(projectId)}`), reportsHref = projectLink('reports', projectId);
  const item = {
    projeto: data.project.name ?? projectName, ...(data.project.unit ? { unidade: data.project.unit } : {}), situacao: data.project.status, etapa: data.project.lifecycle,
    periodo: from || to ? { de: from, ate: to } : 'todo o período',
    demandas: {
      total: demands.length, abertas: openDemands.length, atrasadas: demands.filter(row => row.em_atraso === 'sim').length,
      altaPrioridadeAbertas: openDemands.filter(row => row.prioridade === 'high').length, concluidas: demands.filter(row => row.situacao === 'completed').length,
      proximas: openDemands.filter(row => row.prazo).sort((a, b) => String(a.prazo).localeCompare(String(b.prazo))).slice(0, 5).map(row => ({ demanda: row.demanda, prazo: row.prazo, situacao: STATUS[String(row.situacao)] ?? row.situacao })),
    },
    ...(materials ? { materiais: {
      itens: materials.items.length, estoqueBaixo: materials.items.filter(row => row.situacao_estoque === 'baixo').length,
      baixos: materials.items.filter(row => row.situacao_estoque === 'baixo').slice(0, 5).map(row => row.material),
      movimentacoes: materials.movements.length, saidas: Math.abs(sum(materials.movements.filter(row => Number(row.quantidade) < 0 && ['distribute', 'redeem'].includes(String(row.tipo))), 'quantidade')),
    } } : {}),
    ...(loans ? { emprestimos: { total: loans.rows.length, emAberto: loans.rows.filter(row => ['reserved', 'out'].includes(String(row.situacao))).length, atrasados: loans.rows.filter(row => row.em_atraso === 'sim').length } } : {}),
    ...(campaigns ? { dinamicas: { total: campaigns.rows.length, participacoes: sum(campaigns.rows, 'participacoes'), premiosEntregues: sum(campaigns.rows, 'premios_entregues') } } : {}),
    agenda: sections.schedule.rows.length, registros: sections.records.rows.length,
    ...(sections.team ? { equipes: sections.team.teams.length } : {}),
    relatorios: reportsHref, link: href,
  };
  const result = ctx.pack(kind, [item], [], ctx.budget, 'Resumo do relatório que você pode gerar. O documento completo (PDF) sai na ficha do projeto.');
  return { ...result, sources: result.rows ? [{ label: `Relatório · ${item.projeto}`, href }, { label: `Relatórios · ${item.projeto}`, href: reportsHref }] : [] };
}

const RISK_STATUS: Record<string, string> = { open: 'aberto', monitoring: 'em monitoramento', mitigated: 'mitigado', closed: 'encerrado' };
/** Mesma leitura da Gestão (managementDashboard e risksWorkspace): só para quem faz parte da organização; riscos como a tela mostra. */
async function managementTool(ctx: Fase2cContext, wanted: string): Promise<RoleToolResult> {
  const kind = 'consultar_gestao';
  let projectId: string | null = null;
  // Escopo menor que a organização, ou projeto citado: a Gestão daquele projeto.
  if (wanted || (ctx.scope && ctx.scope.kind !== 'org')) {
    const picked = await oneProject(ctx, kind, wanted);
    if (!Array.isArray(picked)) return picked;
    projectId = picked[0];
  } else if (!(await ctx.projects()).size) return noProject(ctx, kind);
  const input = { organizationId: ctx.organizationId, ...(projectId ? { projectId } : {}) };
  let dashboard: Awaited<ReturnType<typeof managementDashboard>>, risks: Awaited<ReturnType<typeof risksWorkspace>>;
  try { [dashboard, risks] = [await managementDashboard(ctx.db, ctx.actor, input), await risksWorkspace(ctx.db, ctx.actor, input)]; }
  catch (error) { if (denied(error)) return ctx.pack(kind, [], [], ctx.budget, 'A Gestão desta organização não está disponível para você.'); throw error; }
  const k = dashboard.kpis;
  const indicadores = Object.fromEntries(Object.entries({
    demandasAbertas: k.demandsOpen, demandasAtrasadas: k.demandsOverdue, demandasAltaPrioridade: k.demandsHighOpen, demandasCriadasNoPeriodo: k.demandsCreated, demandasConcluidasNoPeriodo: k.demandsCompleted,
    itensEntreguesNoPeriodo: k.itemsOut, dinamicasAtivas: k.campaignsActive, participacoes: k.participations, materiaisComEstoqueBaixo: k.lowStock,
    riscosAbertos: k.risksOpen, riscosAltos: k.risksHigh, riscosCriticos: k.risksCritical, riscosComRevisaoAtrasada: k.risksReviewOverdue,
  }).filter(([, value]) => value !== null && value !== undefined));
  const dashboardHref = '/?module=management&gestao=dashboard', risksHref = '/?module=management&gestao=risks';
  const items = risks.risks.filter(risk => risk.status === 'open' || risk.status === 'monitoring').slice(0, 12).map(risk => ({
    risco: risk.title, nivel: risk.level, situacao: RISK_STATUS[String(risk.status)] ?? risk.status, categoria: risk.category, probabilidade: risk.probability, impacto: risk.impact,
    projeto: risk.projectName ?? 'Organização', revisao: risk.reviewOn, ...(risk.reviewOverdue ? { revisaoAtrasada: true } : {}), ...(risk.isExample ? { exemplo: true } : {}),
    responsavel: risk.ownerLabel ? 'definido' : 'não definido', mitigacao: String(risk.mitigation ?? '').slice(0, 300), link: risksHref,
  }));
  const extra = { recorte: projectId ? (await ctx.projects()).get(projectId) : 'toda a organização', periodo: { de: dashboard.period.from, ate: dashboard.period.to }, indicadores,
    ...(dashboard.lowStock?.length ? { estoqueBaixo: dashboard.lowStock.map(row => ({ material: row.material, projeto: row.project, disponivel: row.available })) } : {}) };
  const result = ctx.pack(kind, items, [{ label: 'Riscos · Gestão', href: risksHref }], ctx.budget, items.length ? 'Riscos abertos ou em monitoramento, do mais grave ao mais leve.' : 'Nenhum risco aberto que você possa ver.', extra);
  // Os indicadores contam como um resultado: a Gestão respondeu, mesmo sem riscos abertos.
  return { ...result, rows: result.rows + 1, sources: [{ label: 'Painel da Gestão', href: dashboardHref }, ...result.sources] };
}
