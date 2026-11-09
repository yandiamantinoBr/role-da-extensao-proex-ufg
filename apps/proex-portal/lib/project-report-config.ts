// Relatório do projeto: catálogo de seções, período e validação dos modelos salvos.
// Compartilhado entre a tela (montador) e o servidor (modelos por projeto). Sem dados reais.

export const REPORT_SECTIONS = [
  { id: 'summary', title: 'Resumo', hint: 'Ficha, unidade e totais' },
  { id: 'team', title: 'Equipe', hint: 'Equipes e integrantes' },
  { id: 'demands', title: 'Demandas', hint: 'Situação e gráfico mensal' },
  { id: 'materials', title: 'Materiais e movimentações', hint: 'Saldo, saídas, correções, anexos' },
  { id: 'loans', title: 'Empréstimos', hint: 'Retiradas, devoluções, atrasos' },
  { id: 'schedule', title: 'Agenda', hint: 'Marcos e atividades' },
  { id: 'campaigns', title: 'Dinâmicas e brindes', hint: 'Participações e prêmios' },
  { id: 'timeline', title: 'Linha do tempo', hint: 'Acontecimentos por data' },
  { id: 'history', title: 'Históricos e versões do cadastro', hint: 'O que mudou, quando e quem' },
  { id: 'notes', title: 'Observações', hint: 'Texto livre da equipe' },
  { id: 'references', title: 'Referências', hint: 'Links, planilhas e documentos' },
] as const;

export type ReportSectionId = typeof REPORT_SECTIONS[number]['id'];
export type ReportPeriod = { mode: 'all' } | { mode: 'month'; month: string } | { mode: 'range'; from: string; to: string };
export type ReportConfig = {
  title: string;
  /** Ordem e escolha das seções. Referências ficam sempre no fim, quando marcadas. */
  sections: { id: ReportSectionId; on: boolean }[];
  period: ReportPeriod;
  notes: string;
  /** Observação da equipe no fim de uma seção (opcional). */
  sectionNotes: Partial<Record<ReportSectionId, string>>;
  /** Endereços das referências deixadas de fora; as novas entram marcadas. */
  excludedReferences: string[];
  /** Linha do tempo: só marcos (demandas resumidas por mês) ou tudo. */
  timeline: 'milestones' | 'all';
};

export const REPORT_SECTION_IDS = REPORT_SECTIONS.map(section => section.id) as ReportSectionId[];
export const REPORT_TITLE_LIMIT = 120;
export const REPORT_NOTES_LIMIT = 6000;
export const REPORT_TEMPLATE_NAME_LIMIT = 80;
export const REPORT_TEMPLATE_LIMIT = 30;
export const REPORT_SECTION_NOTE_LIMIT = 1500;

export function sectionTitle(id: ReportSectionId): string {
  return REPORT_SECTIONS.find(section => section.id === id)?.title ?? id;
}

export function defaultReportConfig(): ReportConfig {
  return {
    title: '',
    sections: REPORT_SECTION_IDS.map(id => ({ id, on: id !== 'history' && id !== 'notes' })),
    period: { mode: 'all' },
    notes: '',
    sectionNotes: {},
    excludedReferences: [],
    timeline: 'milestones',
  };
}

/** Modelos de partida: aparecem para todos e podem ser salvos com outro nome. */
export function starterTemplates(today: string): { name: string; config: ReportConfig }[] {
  const month = /^\d{4}-\d{2}/.test(today) ? today.slice(0, 7) : '2026-01';
  const pick = (ids: ReportSectionId[]) => [...ids.map(id => ({ id, on: true })), ...REPORT_SECTION_IDS.filter(id => !ids.includes(id)).map(id => ({ id, on: false }))];
  return [
    { name: 'Completo', config: { ...defaultReportConfig(), sections: REPORT_SECTION_IDS.map(id => ({ id, on: true })) } },
    { name: 'Prestação mensal', config: { title: 'Prestação de contas mensal', period: { mode: 'month', month }, notes: '', sectionNotes: {}, excludedReferences: [], timeline: 'milestones',
      sections: pick(['summary', 'demands', 'materials', 'loans', 'campaigns', 'timeline', 'notes', 'references']) } },
    { name: 'Relatório do CONPEEX', config: { title: 'Relatório para o CONPEEX', period: { mode: 'all' }, notes: '', sectionNotes: {}, excludedReferences: [], timeline: 'milestones',
      sections: pick(['summary', 'team', 'schedule', 'campaigns', 'materials', 'timeline', 'notes', 'references']) } },
  ];
}

const civil = /^\d{4}-\d{2}-\d{2}$/;
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !civil.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
function validMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2200;
}

/** Datas inclusivas do recorte (AAAA-MM-DD). `null` = sem filtro de período. */
export function periodRange(period: ReportPeriod): { from: string; to: string } | null {
  if (period.mode === 'month') {
    const [year, month] = period.month.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: `${period.month}-01`, to: `${period.month}-${String(last).padStart(2, '0')}` };
  }
  if (period.mode === 'range') return { from: period.from, to: period.to };
  return null;
}

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function brDate(value: string): string { return civil.test(value) ? value.split('-').reverse().join('/') : value; }
export function periodLabel(period: ReportPeriod): string {
  if (period.mode === 'month') return `${MONTH_NAMES[Number(period.month.slice(5, 7)) - 1]} de ${period.month.slice(0, 4)}`;
  if (period.mode === 'range') return period.from === period.to ? brDate(period.from) : `${brDate(period.from)} a ${brDate(period.to)}`;
  return 'Todo o período registrado';
}

export class ReportConfigError extends Error {}

/**
 * Valida e normaliza um modelo. Seções desconhecidas são recusadas; seções que faltarem
 * (modelos antigos) entram desmarcadas no fim, antes das referências.
 */
export function normalizeReportConfig(input: unknown): ReportConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ReportConfigError('Modelo de relatório inválido.');
  const value = input as Record<string, unknown>;
  const title = value.title === undefined ? '' : value.title;
  if (typeof title !== 'string' || title.length > REPORT_TITLE_LIMIT) throw new ReportConfigError(`Use um título de até ${REPORT_TITLE_LIMIT} caracteres.`);
  const notes = value.notes === undefined ? '' : value.notes;
  if (typeof notes !== 'string' || notes.length > REPORT_NOTES_LIMIT) throw new ReportConfigError(`As observações podem ter até ${REPORT_NOTES_LIMIT} caracteres.`);
  if (!Array.isArray(value.sections) || value.sections.length > REPORT_SECTION_IDS.length) throw new ReportConfigError('Escolha as seções do relatório.');
  const seen = new Set<string>();
  const sections: ReportConfig['sections'] = [];
  for (const entry of value.sections) {
    const section = entry as Record<string, unknown> | null;
    if (!section || typeof section !== 'object' || typeof section.id !== 'string' || !REPORT_SECTION_IDS.includes(section.id as ReportSectionId) || typeof section.on !== 'boolean' || seen.has(section.id)) {
      throw new ReportConfigError('Uma seção do modelo não é reconhecida.');
    }
    seen.add(section.id);
    sections.push({ id: section.id as ReportSectionId, on: section.on });
  }
  for (const id of REPORT_SECTION_IDS) if (!seen.has(id)) sections.push({ id, on: false });
  const ordered = [...sections.filter(section => section.id !== 'references'), sections.find(section => section.id === 'references')!];
  const raw = value.period as Record<string, unknown> | undefined;
  let period: ReportPeriod;
  if (!raw || typeof raw !== 'object' || raw.mode === 'all') period = { mode: 'all' };
  else if (raw.mode === 'month' && validMonth(raw.month)) period = { mode: 'month', month: raw.month };
  else if (raw.mode === 'range' && validDay(raw.from) && validDay(raw.to) && raw.from <= raw.to) period = { mode: 'range', from: raw.from, to: raw.to };
  else throw new ReportConfigError('Escolha um período válido: mês ou intervalo com início antes do fim.');
  const rawNotes = value.sectionNotes === undefined ? {} : value.sectionNotes;
  if (!rawNotes || typeof rawNotes !== 'object' || Array.isArray(rawNotes)) throw new ReportConfigError('Observações por seção inválidas.');
  const sectionNotes: ReportConfig['sectionNotes'] = {};
  for (const [id, text] of Object.entries(rawNotes as Record<string, unknown>)) {
    if (!REPORT_SECTION_IDS.includes(id as ReportSectionId) || id === 'notes' || typeof text !== 'string') throw new ReportConfigError('Uma observação de seção não é reconhecida.');
    if (text.length > REPORT_SECTION_NOTE_LIMIT) throw new ReportConfigError(`Cada observação de seção pode ter até ${REPORT_SECTION_NOTE_LIMIT} caracteres.`);
    if (text.trim()) sectionNotes[id as ReportSectionId] = text.replace(/\r\n?/g, '\n');
  }
  const rawExcluded = value.excludedReferences === undefined ? [] : value.excludedReferences;
  if (!Array.isArray(rawExcluded) || rawExcluded.length > 100 || rawExcluded.some(url => typeof url !== 'string' || url.length > 2048)) throw new ReportConfigError('Lista de referências inválida.');
  return { title: title.trim(), sections: ordered, period, notes: notes.replace(/\r\n?/g, '\n'), sectionNotes, excludedReferences: [...new Set(rawExcluded as string[])],
    timeline: value.timeline === 'all' ? 'all' : 'milestones' };
}

/** Classifica uma referência pelo endereço: planilha, documento ou link. */
export function referenceType(url: string): 'spreadsheet' | 'document' | 'link' {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'link'; }
  const host = parsed.hostname.toLowerCase(), path = parsed.pathname.toLowerCase();
  if ((host === 'docs.google.com' && path.startsWith('/spreadsheets/')) || /\.(xlsx|xls|ods|csv)$/.test(path)) return 'spreadsheet';
  if ((host === 'docs.google.com' && /^\/(document|presentation|forms)\//.test(path)) || (host === 'drive.google.com' && path.startsWith('/file/'))
    || /\.(pdf|docx?|odt|pptx?|odp|rtf)$/.test(path) || host.endsWith('sei.ufg.br')) return 'document';
  return 'link';
}
export const REFERENCE_TYPE_LABEL = { spreadsheet: 'Planilha', document: 'Documento', link: 'Link' } as const;
