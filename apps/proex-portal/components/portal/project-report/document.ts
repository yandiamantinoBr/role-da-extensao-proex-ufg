// Monta o documento do relatório a partir dos dados autorizados e do modelo escolhido.
// A prévia, o PDF, o DOCX e o XLSX desenham exatamente esta estrutura.
import {
  brDate, periodLabel, REFERENCE_TYPE_LABEL, sectionTitle, type ReportConfig, type ReportSectionId,
} from '../../../lib/project-report-config';

type Row = Record<string, unknown>;
export type Column = { label: string; numeric?: boolean; width?: number };
export type ReportReference = { number: number; title: string; type: string; url: string; source: string };
export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'facts'; items: [string, string][] }
  | { kind: 'metrics'; items: { label: string; value: string; detail?: string }[] }
  | { kind: 'table'; title?: string; columns: Column[]; rows: string[][]; note?: string }
  | { kind: 'chart'; title: string; categories: string[]; series: { label: string; values: number[] }[]; note?: string }
  | { kind: 'timeline'; items: { date: string; month: string; tag: string; title: string; detail?: string }[]; note?: string }
  | { kind: 'callout'; title: string; text: string }
  | { kind: 'subheading'; text: string }
  | { kind: 'references'; items: ReportReference[] }
  | { kind: 'note'; text: string };
export type ReportSection = { id: ReportSectionId; number: number; title: string; blocks: Block[] };
export type ReportDocument = {
  /** Rótulo acima do título na capa (padrão: Relatório do projeto). */
  kicker?: string;
  title: string; projectName: string; subtitle: string; period: string; generatedAt: string; generatedIso: string;
  sections: ReportSection[];
  /** Seções marcadas que a pessoa não pode ver: não entram no documento e aparecem só na tela. */
  unavailable: string[];
};
export type ReportData = {
  generatedAt: string;
  period: { from: string | null; to: string | null };
  project: {
    id: string; name: string; shortName: string; description: string; status: string; lifecycle: string; unit: string; type: string;
    thematicArea: string; thematicAreaLabel?: string; extensionLine: string; extensionLineLabel?: string; scope: string; location: string;
    startsAt: string | null; endsAt: string | null; officialUrl: string | null; prizesEnabled: boolean; counts: Row | null;
  };
  sections: {
    team: { teams: { name: string; status: string; members: string[]; counts: Record<string, number> }[]; truncated: boolean } | null;
    demands: { rows: Row[]; truncated: boolean };
    materials: { items: Row[]; movements: Row[]; corrections: Row[]; attachments: Row[]; truncated: boolean; detailed: boolean } | null;
    loans: { rows: Row[]; truncated: boolean } | null;
    campaigns: { rows: Row[]; truncated: boolean } | null;
    schedule: { rows: Row[] };
    records: { rows: Row[]; truncated: boolean };
    history: { rows: Row[] } | null;
    references: { rows: Row[] };
  };
};

/** Mesmo limite nos três formatos e na prévia, para que todos mostrem as mesmas linhas. */
export const TABLE_ROW_LIMIT = 400;
export const TIMELINE_LIMIT = 400;

const DEMAND_STATUS: Record<string, string> = { open: 'Aberta', in_progress: 'Em andamento', blocked: 'Bloqueada', completed: 'Concluída', cancelled: 'Cancelada' };
const PRIORITY: Record<string, string> = { high: 'Alta', medium: 'Média', low: 'Baixa' };
const MOVEMENT: Record<string, string> = { receive: 'Entrada', distribute: 'Distribuição', consume: 'Consumo', adjust: 'Correção de saldo', redeem: 'Resgate de prêmio', transfer: 'Transferência' };
const LOAN: Record<string, string> = { reserved: 'Reservado', out: 'Retirado', returned: 'Devolvido', cancelled: 'Cancelado' };
const CAMPAIGN: Record<string, string> = { draft: 'Rascunho', active: 'Ativa', paused: 'Pausada', closed: 'Encerrada' };
const SCHEDULE: Record<string, string> = { planned: 'Planejada', completed: 'Realizada', cancelled: 'Cancelada' };
const PROJECT_STATUS: Record<string, string> = { active: 'Ativo', archived: 'Arquivado' };
const LIFECYCLE: Record<string, string> = { active: 'Em andamento', past: 'Encerrado', catalog: 'Catálogo' };
const CATEGORY: Record<string, string> = { gift: 'Brinde', equipment: 'Equipamento', distribution: 'Distribuição', consumption: 'Consumo' };
const RECORD: Record<string, string> = { observation: 'Observação', maintenance: 'Manutenção', distribution: 'Distribuição', consumption: 'Consumo', project: 'Projeto', material: 'Material', loan: 'Empréstimo' };
const ENTITY: Record<string, string> = { project: 'Cadastro do projeto', call: 'Edital', project_link: 'Link', project_schedule_item: 'Agenda' };
const FIELD: Record<string, string> = {
  name: 'Nome', short_name: 'Sigla', description: 'Descrição', status: 'Situação', lifecycle: 'Etapa', type_id: 'Modalidade', parent_id: 'Programa',
  unit_id: 'Unidade', prizes_enabled: 'Brindes', scope: 'Abrangência', thematic_area: 'Área temática', extension_line: 'Linha de extensão', color: 'Cor',
  official_url: 'Página oficial', starts_at: 'Início', ends_at: 'Fim', location: 'Local', label: 'Nome', url: 'Endereço', kind: 'Tipo',
  communication_channel: 'Canal', communication_note: 'Nota da arte', title: 'Título', note: 'Observação', reference_code: 'Referência',
  opens_at: 'Abertura', closes_at: 'Encerramento', linked_project_ids: 'Projetos vinculados', category: 'Classe', category_id: 'Categoria', unit: 'Unidade de medida',
  low_stock: 'Alerta mínimo', condition: 'Condição', asset_code: 'Patrimônio', brand: 'Marca', model: 'Modelo', serial_number: 'Número de série',
  asset_location: 'Localização', conservation_state: 'Conservação', asset_status: 'Situação patrimonial', origin: 'Origem', destination: 'Destino',
  process_reference: 'Processo', responsibility_term: 'Termo', invoice_reference: 'Nota fiscal', acquisition_date: 'Data de aquisição',
  acquisition_value_cents: 'Valor de aquisição', responsible_unit: 'Unidade responsável', responsible_reference: 'Responsável', source_reference: 'Fonte',
};

const str = (value: unknown) => value === null || value === undefined ? '' : String(value);
const num = (value: unknown) => typeof value === 'number' ? value : Number(value) || 0;
const fmt = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const label = (map: Record<string, string>, value: unknown) => map[str(value)] ?? str(value);
/** Data curta brasileira a partir de data civil, instante ISO ou milissegundos (horário de Brasília). */
export function shortDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return brDate(value);
  const time = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(time)) return str(value);
  return brDate(new Date(time - 3 * 3600_000).toISOString().slice(0, 10));
}
function civil(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const time = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time - 3 * 3600_000).toISOString().slice(0, 10) : '';
}
function span(start: unknown, end: unknown): string {
  const first = shortDate(start), last = shortDate(end);
  return !last || first === last ? first : `${first} a ${last}`;
}
function changes(fields: unknown): string {
  const list = Array.isArray(fields) ? fields.map(String) : [];
  if (list.includes('__created__')) return 'Cadastro criado';
  if (list.includes('__unknown__')) return 'Alterado (versão anterior fora do histórico)';
  const names = list.map(field => FIELD[field] ?? field.replace(/_/g, ' '));
  if (!names.length) return 'Salvo sem mudar campos';
  return `Alterou: ${names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0]}`;
}
const MONTH_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const monthTitle = (day: string) => `${MONTH_FULL[Number(day.slice(5, 7)) - 1]} de ${day.slice(0, 4)}`;
function limited(rows: string[][], noun: string): { rows: string[][]; note?: string } {
  return rows.length > TABLE_ROW_LIMIT
    ? { rows: rows.slice(0, TABLE_ROW_LIMIT), note: `Mostrando ${TABLE_ROW_LIMIT} de ${rows.length} ${noun}. Reduza o período para ver o restante.` }
    : { rows };
}
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** Meses contínuos entre o primeiro e o último dia informado (no máximo os 24 últimos). */
export function monthAxis(days: string[], period: { from: string | null; to: string | null }): string[] {
  const valid = days.filter(day => /^\d{4}-\d{2}/.test(day)).map(day => day.slice(0, 7)).sort();
  const first = period.from?.slice(0, 7) ?? valid[0], last = period.to?.slice(0, 7) ?? valid[valid.length - 1];
  if (!first || !last || first > last) return [];
  const months: string[] = [];
  for (let [year, month] = first.split('-').map(Number); `${year}-${String(month).padStart(2, '0')}` <= last; month === 12 ? (year++, month = 1) : month++) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    if (months.length > 600) break;
  }
  return months.slice(-24);
}
export const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(2, 4)}`;
function perMonth(months: string[], days: string[]): number[] {
  return months.map(month => days.filter(day => day.startsWith(month)).length);
}

function summarySection(data: ReportData, demands: Row[]): Block[] {
  const project = data.project, counts = project.counts ?? {};
  const facts: [string, string][] = [
    ['Unidade responsável', project.unit || 'Não informada'],
    ['Modalidade', project.type || 'Não informada'],
    ['Área temática', project.thematicAreaLabel || project.thematicArea || 'Não informada'],
    ['Linha de extensão', project.extensionLineLabel || project.extensionLine || 'Não informada'],
    ['Abrangência', project.scope === 'external' ? 'Externo à PROEX' : 'Interno PROEX'],
    ['Período do projeto', project.startsAt ? span(project.startsAt, project.endsAt) : 'Não informado'],
    ['Local', project.location || 'Não informado'],
    ['Situação', `${label(PROJECT_STATUS, project.status)} · ${label(LIFECYCLE, project.lifecycle)}`],
    ['Dinâmicas e brindes', project.prizesEnabled ? 'Habilitados' : 'Não habilitados'],
  ];
  const blocks: Block[] = [];
  if (project.description) blocks.push({ kind: 'paragraph', text: project.description });
  blocks.push({ kind: 'facts', items: facts });
  blocks.push({ kind: 'metrics', items: [
    ...(data.sections.materials ? [{ label: 'Materiais', value: fmt(num(counts.materiais)) }] : []),
    ...(data.sections.campaigns ? [{ label: 'Dinâmicas', value: fmt(num(counts.eventos)) }] : []),
    ...(data.sections.loans ? [{ label: 'Empréstimos', value: fmt(num(counts.emprestimos)) }] : []),
    { label: 'Marcos de agenda', value: fmt(num(counts.marcos_agenda)) },
    { label: 'Demandas no período', value: fmt(demands.length), detail: `${demands.filter(row => row.situacao === 'completed').length} concluídas` },
  ] });
  return blocks;
}

function demandsSection(data: ReportData): Block[] {
  const rows = data.sections.demands.rows;
  if (!rows.length) return [{ kind: 'note', text: 'Nenhuma demanda visível para você neste período.' }];
  const open = rows.filter(row => ['open', 'in_progress', 'blocked'].includes(str(row.situacao)));
  const created = rows.map(row => str(row.data)), completed = rows.map(row => str(row.concluida_em)).filter(Boolean);
  const months = monthAxis([...created, ...completed], data.period);
  const blocks: Block[] = [{ kind: 'metrics', items: [
    { label: 'Demandas', value: fmt(rows.length) },
    { label: 'Em aberto', value: fmt(open.length) },
    { label: 'Concluídas', value: fmt(rows.filter(row => row.situacao === 'completed').length) },
    { label: 'Em atraso', value: fmt(rows.filter(row => row.em_atraso === 'sim').length) },
    { label: 'Prioridade alta', value: fmt(open.filter(row => row.prioridade === 'high').length), detail: 'entre as abertas' },
  ] }];
  if (months.length) blocks.push({ kind: 'chart', title: 'Demandas ao longo do tempo', categories: months.map(monthName),
    series: [{ label: 'Criadas', values: perMonth(months, created) }, { label: 'Concluídas', values: perMonth(months, completed) }],
    note: 'Criadas pela data de cadastro; concluídas pela primeira vez em que a situação passou a concluída.' });
  const table = limited(rows.map(row => [str(row.demanda), label(PRIORITY, row.prioridade), label(DEMAND_STATUS, row.situacao), shortDate(row.data), shortDate(row.prazo), row.em_atraso === 'sim' ? 'Sim' : 'Não']), 'demandas');
  blocks.push({ kind: 'table', title: 'Demandas', columns: [{ label: 'Demanda', width: 3 }, { label: 'Prioridade' }, { label: 'Situação' }, { label: 'Criada em' }, { label: 'Prazo' }, { label: 'Atraso', width: .8 }], ...table });
  if (data.sections.demands.truncated) blocks.push({ kind: 'note', text: 'A consulta atingiu o limite de 5.000 demandas; reduza o período.' });
  return blocks;
}

function teamSection(data: ReportData): Block[] {
  const team = data.sections.team!;
  if (!team.teams.length) return [{ kind: 'note', text: 'Nenhuma equipe de trabalho visível para você neste projeto.' }];
  return [{ kind: 'table', columns: [{ label: 'Equipe', width: 1.4 }, { label: 'Integrantes', width: 3 }, { label: 'Demandas', numeric: true, width: .9 }, { label: 'Abertas', numeric: true, width: .9 }, { label: 'Concluídas', numeric: true, width: .9 }],
    rows: team.teams.map(entry => [entry.name + (entry.status === 'active' ? '' : ' (arquivada)'), entry.members.join(', ') || 'Sem integrantes visíveis', fmt(num(entry.counts.total)), fmt(num(entry.counts.open) + num(entry.counts.in_progress) + num(entry.counts.blocked)), fmt(num(entry.counts.completed))]) }];
}

function materialsSection(data: ReportData): Block[] {
  const section = data.sections.materials!;
  const low = section.items.filter(row => row.situacao_estoque === 'baixo').length;
  const blocks: Block[] = [{ kind: 'metrics', items: [
    { label: 'Materiais', value: fmt(section.items.length) },
    { label: 'Com estoque baixo', value: fmt(low) },
    { label: 'Lançamentos', value: fmt(section.movements.length), detail: 'no período' },
    ...(section.detailed ? [{ label: 'Correções no cadastro', value: fmt(section.corrections.length) }, { label: 'Anexos', value: fmt(section.attachments.length) }] : []),
  ] }];
  if (!section.items.length) blocks.push({ kind: 'note', text: 'Nenhum material cadastrado neste projeto.' });
  else blocks.push({ kind: 'table', title: 'Saldo atual', columns: [{ label: 'Material', width: 2.6 }, { label: 'Categoria' }, { label: 'Saldo', numeric: true, width: .8 }, { label: 'Disponível', numeric: true, width: .9 }, { label: 'Unidade', width: .9 }, { label: 'Situação', width: .9 }],
    ...limited(section.items.map(row => [str(row.material), str(row.categoria) || label(CATEGORY, row.classe), fmt(num(row.saldo)), fmt(num(row.disponivel)), str(row.unidade_medida), row.situacao_estoque === 'baixo' ? 'Baixo' : 'OK']), 'materiais') });
  if (section.movements.length) {
    const months = monthAxis(section.movements.map(row => str(row.data)), data.period);
    if (months.length) blocks.push({ kind: 'chart', title: 'Movimentações por mês', categories: months.map(monthName), series: [
      { label: 'Entradas', values: perMonth(months, section.movements.filter(row => num(row.quantidade) > 0).map(row => str(row.data))) },
      { label: 'Saídas', values: perMonth(months, section.movements.filter(row => num(row.quantidade) < 0).map(row => str(row.data))) },
    ], note: 'Quantidade de lançamentos por mês, não de unidades.' });
    blocks.push({ kind: 'table', title: 'Movimentações', columns: [{ label: 'Data', width: .9 }, { label: 'Material', width: 2 }, { label: 'Tipo', width: 1.2 }, { label: 'Quantidade', numeric: true, width: .9 }, { label: 'Observação', width: 2 }],
      ...limited(section.movements.map(row => [shortDate(row.data), str(row.material), label(MOVEMENT, row.tipo), `${num(row.quantidade) > 0 ? '+' : ''}${fmt(num(row.quantidade))} ${str(row.unidade_medida)}`.trim(), str(row.observacao)]), 'movimentações') });
  } else blocks.push({ kind: 'note', text: 'Nenhuma movimentação de estoque neste período.' });
  if (section.corrections.length) blocks.push({ kind: 'table', title: 'Correções no cadastro de materiais', columns: [{ label: 'Data', width: .9 }, { label: 'Material', width: 1.6 }, { label: 'O que mudou', width: 2.6 }, { label: 'Por', width: 1.2 }],
    ...limited(section.corrections.map(row => [shortDate(row.data), str(row.material), changes(row.campos), str(row.por) || '—']), 'correções') });
  if (section.attachments.length) blocks.push({ kind: 'table', title: 'Anexos dos registros de materiais', columns: [{ label: 'Data', width: .9 }, { label: 'Material', width: 1.6 }, { label: 'Registro', width: 1.6 }, { label: 'Arquivo', width: 2.2 }],
    ...limited(section.attachments.map(row => [shortDate(row.data), str(row.material), str(row.registro), str(row.arquivo)]), 'anexos') });
  if (section.truncated) blocks.push({ kind: 'note', text: 'A consulta atingiu o limite de linhas; reduza o período.' });
  return blocks;
}

function loansSection(data: ReportData): Block[] {
  const rows = data.sections.loans!.rows;
  if (!rows.length) return [{ kind: 'note', text: 'Nenhum empréstimo neste período.' }];
  return [
    { kind: 'metrics', items: [
      { label: 'Empréstimos', value: fmt(rows.length) },
      { label: 'Devolvidos', value: fmt(rows.filter(row => row.situacao === 'returned').length) },
      { label: 'Em andamento', value: fmt(rows.filter(row => row.situacao === 'out' || row.situacao === 'reserved').length) },
      { label: 'Em atraso', value: fmt(rows.filter(row => row.em_atraso === 'sim').length) },
    ] },
    { kind: 'table', columns: [{ label: 'Material', width: 1.8 }, { label: 'Ação', width: 1.8 }, { label: 'Período', width: 1.4 }, { label: 'Situação' }, { label: 'Atraso', width: .7 }],
      ...limited(rows.map(row => [str(row.material), str(row.acao), span(row.inicio, row.fim), label(LOAN, row.situacao), row.em_atraso === 'sim' ? 'Sim' : 'Não']), 'empréstimos') },
  ];
}

function scheduleSection(data: ReportData): Block[] {
  const rows = [...data.sections.schedule.rows].sort((a, b) => civil(a.inicio).localeCompare(civil(b.inicio)));
  if (!rows.length) return [{ kind: 'note', text: 'Nenhum marco de agenda neste período.' }];
  return [{ kind: 'table', columns: [{ label: 'Quando', width: 1.2 }, { label: 'Atividade', width: 2.2 }, { label: 'Situação', width: .9 }, { label: 'Observação', width: 2.2 }],
    ...limited(rows.map(row => [span(row.inicio, row.fim), str(row.titulo), label(SCHEDULE, row.situacao), str(row.observacao)]), 'marcos') }];
}

function campaignsSection(data: ReportData): Block[] {
  const rows = data.sections.campaigns!.rows;
  if (!rows.length) return [{ kind: 'note', text: 'Nenhuma dinâmica neste período.' }];
  return [
    { kind: 'metrics', items: [
      { label: 'Dinâmicas', value: fmt(rows.length) },
      { label: 'Participações', value: fmt(rows.reduce((total, row) => total + num(row.participacoes), 0)) },
      { label: 'Tentativas', value: fmt(rows.reduce((total, row) => total + num(row.tentativas), 0)) },
      { label: 'Prêmios entregues', value: fmt(rows.reduce((total, row) => total + num(row.premios_entregues), 0)) },
    ] },
    { kind: 'table', columns: [{ label: 'Dinâmica', width: 2 }, { label: 'Local', width: 1.4 }, { label: 'Período', width: 1.3 }, { label: 'Situação', width: .9 }, { label: 'Participações', numeric: true, width: 1 }, { label: 'Prêmios', numeric: true, width: .8 }],
      ...limited(rows.map(row => [str(row.evento), str(row.local), span(row.inicio, row.fim), label(CAMPAIGN, row.situacao), fmt(num(row.participacoes)), fmt(num(row.premios_entregues))]), 'dinâmicas') },
  ];
}

function timelineSection(data: ReportData, mode: ReportConfig['timeline']): Block[] {
  const { from, to } = data.period;
  const within = (day: string) => !!day && (!from || day >= from) && (!to || day <= to);
  type Event = { day: string; at: string; tag: string; title: string; detail?: string; summary?: boolean };
  const items: Event[] = [];
  const push = (value: unknown, tag: string, title: string, detail?: string, moment?: unknown) => {
    const day = civil(value); if (!within(day)) return;
    const at = typeof moment === 'string' && moment ? moment : typeof value === 'string' ? value : day;
    items.push({ day, at, tag, title, detail });
  };
  push(data.project.startsAt, 'Projeto', 'Início do projeto');
  push(data.project.endsAt, 'Projeto', 'Fim previsto do projeto');
  for (const row of data.sections.schedule.rows) push(row.inicio, 'Agenda', str(row.titulo), label(SCHEDULE, row.situacao));
  // Demandas do mesmo dia viram um acontecimento só ("3 demandas criadas"), para os marcos não sumirem.
  const grouped = (rows: Row[], key: 'data' | 'concluida_em', verb: string) => {
    const byDay = new Map<string, string[]>();
    for (const row of rows) { const day = civil(row[key]); if (day) byDay.set(day, [...(byDay.get(day) ?? []), str(row.demanda)]); }
    for (const [day, titles] of byDay) push(day, 'Demanda', titles.length === 1 ? `Demanda ${verb}: ${titles[0]}` : `${titles.length} demandas ${verb}s`, titles.length === 1 ? undefined : titles.slice(0, 4).join(' · ') + (titles.length > 4 ? ` · e mais ${titles.length - 4}` : ''));
  };
  if (mode === 'all') {
    grouped(data.sections.demands.rows, 'data', 'criada');
    grouped(data.sections.demands.rows.filter(row => row.concluida_em), 'concluida_em', 'concluída');
  } else {
    // Só marcos: as demandas viram um resumo por mês, no último dia com movimento.
    const months = new Map<string, { last: string; created: number; completed: number }>();
    const count = (value: unknown, field: 'created' | 'completed') => { const day = civil(value); if (!within(day)) return; const key = day.slice(0, 7), entry = months.get(key) ?? { last: day, created: 0, completed: 0 }; entry[field]++; if (day > entry.last) entry.last = day; months.set(key, entry); };
    for (const row of data.sections.demands.rows) { count(row.data, 'created'); if (row.concluida_em) count(row.concluida_em, 'completed'); }
    for (const [key, entry] of months) {
      const parts = [entry.created ? `${entry.created} ${entry.created === 1 ? 'criada' : 'criadas'}` : '', entry.completed ? `${entry.completed} ${entry.completed === 1 ? 'concluída' : 'concluídas'}` : ''].filter(Boolean).join(' e ');
      // Primeira linha do mês, sem data: é um resumo, não um acontecimento de um dia.
      const first = from && `${key}-01` < from ? from : `${key}-01`;
      items.push({ day: first, at: '', tag: 'Demandas', title: `Demandas no mês: ${parts}`, summary: true });
    }
  }
  for (const row of data.sections.campaigns?.rows ?? []) push(row.inicio, 'Dinâmica', str(row.evento), str(row.local));
  for (const row of data.sections.loans?.rows ?? []) push(row.inicio, 'Empréstimo', `${str(row.material)} · ${str(row.acao)}`, label(LOAN, row.situacao));
  for (const row of data.sections.records.rows) push(row.data, 'Registro', str(row.titulo), label(RECORD, row.categoria));
  for (const row of data.sections.materials?.corrections ?? []) push(row.data, 'Material', `Cadastro corrigido: ${str(row.material)}`, changes(row.campos), row.momento);
  // A criação de links, marcos e editais já aparece pela própria data; só alterações entram aqui.
  for (const row of (data.sections.history?.rows ?? []).filter(entry => entry.tipo === 'project' || !(Array.isArray(entry.campos) && entry.campos.includes('__created__'))))
    push(row.data, 'Cadastro', row.tipo === 'project' ? `${Array.isArray(row.campos) && row.campos.includes('__created__') ? 'Cadastro criado' : 'Cadastro atualizado'} (versão ${str(row.versao)})` : `${label(ENTITY, row.tipo)}${row.item ? `: ${str(row.item)}` : ''} (versão ${str(row.versao)})`, row.tipo === 'project' && Array.isArray(row.campos) && row.campos.includes('__created__') ? undefined : changes(row.campos), row.momento);
  if (!items.length) return [{ kind: 'note', text: 'Nada registrado neste período.' }];
  items.sort((a, b) => a.day.slice(0, 7).localeCompare(b.day.slice(0, 7)) || Number(!!b.summary) - Number(!!a.summary) || a.day.localeCompare(b.day) || a.at.localeCompare(b.at));
  const shown = items.slice(-TIMELINE_LIMIT);
  return [{ kind: 'timeline', items: shown.map(item => ({ date: item.summary ? '' : brDate(item.day), month: monthTitle(item.day), tag: item.tag, title: item.title, detail: item.detail })),
    note: items.length > shown.length ? `Mostrando os ${TIMELINE_LIMIT} acontecimentos mais recentes de ${items.length}. Reduza o período para ver o restante.` : undefined }];
}

function historySection(data: ReportData): Block[] {
  const rows = data.sections.history!.rows;
  if (!rows.length) return [{ kind: 'note', text: 'Nenhuma versão do cadastro registrada neste período.' }];
  return [{ kind: 'table', columns: [{ label: 'Data', width: .9 }, { label: 'Item', width: 2 }, { label: 'Versão', numeric: true, width: .7 }, { label: 'O que mudou', width: 2.4 }, { label: 'Por', width: 1.2 }],
    ...limited(rows.map(row => [shortDate(row.data), row.tipo === 'project' ? 'Cadastro do projeto' : `${label(ENTITY, row.tipo)}${row.item ? `: ${str(row.item)}` : ''}`, str(row.versao), changes(row.campos), str(row.por) || '—']), 'versões') }];
}

function notesSection(notes: string): Block[] {
  const text = notes.split(/\n{2,}/).map(part => part.trim()).filter(Boolean).join('\n\n');
  return text ? [{ kind: 'callout', title: '', text }] : [{ kind: 'note', text: 'Nenhuma observação escrita.' }];
}

function httpUrl(value: unknown): boolean {
  try { const url = new URL(String(value)); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password; } catch { return false; }
}
function referenceList(data: ReportData, excluded: Set<string>): ReportReference[] {
  return data.sections.references.rows.filter(row => httpUrl(row.url) && !excluded.has(str(row.url))).map((row, index) => ({
    number: index + 1, title: str(row.titulo), url: str(row.url), source: str(row.origem),
    type: REFERENCE_TYPE_LABEL[str(row.tipo) as keyof typeof REFERENCE_TYPE_LABEL] ?? 'Link',
  }));
}

/** Permissão por seção: `false` quando a pessoa não pode ver aqueles dados. */
export function sectionAvailable(data: ReportData, id: ReportSectionId): boolean {
  if (id === 'team') return data.sections.team !== null;
  if (id === 'materials') return data.sections.materials !== null;
  if (id === 'loans') return data.sections.loans !== null;
  if (id === 'campaigns') return data.sections.campaigns !== null;
  if (id === 'history') return data.sections.history !== null;
  return true;
}

export function buildReportDocument(data: ReportData, config: ReportConfig, now = new Date()): ReportDocument {
  const unavailable: string[] = [];
  const sections: ReportSection[] = [];
  for (const { id, on } of config.sections) {
    if (!on) continue;
    if (!sectionAvailable(data, id)) { unavailable.push(sectionTitle(id)); continue; }
    const blocks: Block[] =
      id === 'summary' ? summarySection(data, data.sections.demands.rows)
      : id === 'team' ? teamSection(data)
      : id === 'demands' ? demandsSection(data)
      : id === 'materials' ? materialsSection(data)
      : id === 'loans' ? loansSection(data)
      : id === 'schedule' ? scheduleSection(data)
      : id === 'campaigns' ? campaignsSection(data)
      : id === 'timeline' ? timelineSection(data, config.timeline)
      : id === 'history' ? historySection(data)
      : id === 'notes' ? notesSection(config.notes)
      : (() => { const items = referenceList(data, new Set(config.excludedReferences)); return items.length ? [{ kind: 'references', items } as Block] : [{ kind: 'note', text: 'Nenhum link, planilha ou documento vinculado ao projeto.' } as Block]; })();
    const remark = config.sectionNotes[id]?.trim();
    if (remark && id !== 'notes') blocks.push({ kind: 'callout', title: 'Observação da equipe', text: remark });
    sections.push({ id, number: sections.length + 1, title: sectionTitle(id), blocks });
  }
  const generated = new Date(now);
  return {
    title: config.title.trim() || 'Relatório do projeto',
    projectName: data.project.name,
    subtitle: [data.project.unit, data.project.type].filter(Boolean).join(' · '),
    period: periodLabel(config.period),
    generatedAt: `${generated.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (Brasília)`,
    generatedIso: generated.toISOString(),
    sections, unavailable,
  };
}

/** Texto simples de um bloco, usado em leitores de tela e nos testes. */
export function blockText(block: Block): string {
  switch (block.kind) {
    case 'paragraph': case 'note': return block.text;
    case 'facts': return block.items.map(([key, value]) => `${key}: ${value}`).join('\n');
    case 'metrics': return block.items.map(item => `${item.label}: ${item.value}`).join('\n');
    case 'table': return [block.title ?? '', block.columns.map(column => column.label).join(' | '), ...block.rows.map(row => row.join(' | ')), block.note ?? ''].filter(Boolean).join('\n');
    case 'chart': return [block.title, ...block.series.map(series => `${series.label}: ${series.values.join(', ')}`)].join('\n');
    case 'timeline': return block.items.map(item => `${item.date} ${item.tag} ${item.title}`).join('\n');
    case 'references': return block.items.map(item => `[${item.number}] ${item.title} ${item.url}`).join('\n');
    case 'callout': return `${block.title}: ${block.text}`;
    case 'subheading': return block.text;
  }
}
