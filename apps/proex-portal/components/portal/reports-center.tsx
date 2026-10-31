'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, BarChart3, Boxes, CalendarRange, ClipboardList, Columns3, FileJson, FileSpreadsheet, FileText, FolderKanban, LoaderCircle, Printer, Repeat2, Save, Search, Sheet, Trash2, Truck, X } from 'lucide-react';
import { areaLabel } from '@/lib/extension-catalog';
import { quantityTotal } from '@/lib/report-quantities';
import { download, toCsv, toDocx, toJson, toXlsx, type ExportColumn, type ExportRow } from './report-export';
import styles from './reports-center.module.css';

type DatasetId = 'projects' | 'materials' | 'movements' | 'outflows' | 'loans' | 'records' | 'campaigns' | 'demands' | 'reviews';
type Column = ExportColumn & { date?: boolean };
type Kpi = { label: string; value: number | null; detail?: string; tone?: 'warn' };
type Series = { key: string; label: string; value: (row: ExportRow) => number };
type Dataset = {
  label: string; description: string; icon: typeof Boxes; columns: Column[]; defaults: string[];
  groups: string[]; dateKey?: string; kpis: (rows: ExportRow[]) => Kpi[]; series?: Series[];
};
type Preset = { name: string; dataset: DatasetId; columns: string[]; groupBy: string; measure: string; search: string };

const num = (value: unknown) => typeof value === 'number' ? value : Number(value) || 0;
const sum = (rows: ExportRow[], key: string) => rows.reduce((total, row) => total + num(row[key]), 0);
const count = (rows: ExportRow[], test: (row: ExportRow) => boolean) => rows.filter(test).length;
const distinct = (rows: ExportRow[], key: string) => new Set(rows.map(row => row[key]).filter(Boolean)).size;
const shared: Column[] = [
  { key: 'projeto', label: 'Projeto' }, { key: 'unidade_sigla', label: 'Unidade' }, { key: 'unidade', label: 'Unidade (nome)' },
  { key: 'unidade_grupo', label: 'Tipo de unidade' }, { key: 'area_tematica', label: 'Área temática' }, { key: 'modalidade', label: 'Modalidade' },
];
const ASSET_COLUMNS: Column[] = [
  { key: 'descricao_bem', label: 'Descrição do bem' }, { key: 'marca', label: 'Marca' }, { key: 'modelo', label: 'Modelo' }, { key: 'numero_serie', label: 'Número de série' },
  { key: 'localizacao_bem', label: 'Localização do bem' }, { key: 'unidade_responsavel', label: 'Unidade responsável' }, { key: 'responsavel_documentado', label: 'Responsável na fonte' },
  { key: 'conservacao', label: 'Conservação observada' }, { key: 'situacao_patrimonial', label: 'Situação patrimonial informada' }, { key: 'origem', label: 'Origem informada' }, { key: 'destino', label: 'Destino informado' },
  { key: 'processo', label: 'Referência do processo' }, { key: 'termo_responsabilidade', label: 'Termo de responsabilidade' }, { key: 'nota_fiscal', label: 'Referência da nota fiscal' },
  { key: 'data_aquisicao', label: 'Aquisição documentada', date: true }, { key: 'valor_aquisicao_centavos', label: 'Valor documentado (centavos)' }, { key: 'fonte_cadastro', label: 'Fonte do cadastro' },
];

const DATASETS: Record<DatasetId, Dataset> = {
  projects: {
    label: 'Projetos e ações', description: 'Cadastro, classificação e volume de operação de cada iniciativa.', icon: FolderKanban,
    columns: [...shared, { key: 'sigla', label: 'Sigla' }, { key: 'linha_extensao', label: 'Linha de extensão' }, { key: 'abrangencia', label: 'Abrangência' }, { key: 'situacao', label: 'Situação' }, { key: 'etapa', label: 'Etapa' }, { key: 'inicio', label: 'Início', date: true }, { key: 'fim', label: 'Fim', date: true }, { key: 'local', label: 'Local' }, { key: 'materiais', label: 'Materiais', numeric: true }, { key: 'eventos', label: 'Eventos', numeric: true }, { key: 'emprestimos', label: 'Empréstimos', numeric: true }, { key: 'registros', label: 'Registros', numeric: true }, { key: 'criado_em', label: 'Cadastrado em', date: true }],
    defaults: ['projeto', 'unidade_sigla', 'area_tematica', 'modalidade', 'abrangencia', 'etapa', 'materiais', 'eventos', 'emprestimos', 'registros'],
    groups: ['unidade_sigla', 'area_tematica', 'modalidade', 'abrangencia', 'etapa', 'unidade_grupo'], dateKey: 'inicio',
    kpis: rows => [{ label: 'Projetos', value: rows.length }, { label: 'Em andamento', value: count(rows, row => row.etapa === 'active') }, { label: 'Externos à PROEX', value: count(rows, row => row.abrangencia === 'external') }, { label: 'Unidades envolvidas', value: distinct(rows, 'unidade_sigla') }],
  },
  materials: {
    label: 'Materiais e estoque', description: 'Saldo, reservas, disponibilidade e alertas de cada item.', icon: Boxes,
    columns: [...shared, { key: 'material', label: 'Material' }, { key: 'classe', label: 'Classe' }, { key: 'categoria', label: 'Categoria' }, { key: 'unidade_medida', label: 'Unidade de medida' }, { key: 'saldo', label: 'Saldo físico', numeric: true }, { key: 'reservado', label: 'Reservado', numeric: true }, { key: 'disponivel', label: 'Disponível', numeric: true }, { key: 'alerta_minimo', label: 'Alerta mínimo', numeric: true }, { key: 'situacao_estoque', label: 'Situação do estoque' }, { key: 'condicao', label: 'Condição' }, { key: 'patrimonio', label: 'Patrimônio' }, { key: 'atualizado_em', label: 'Atualizado em', date: true }],
    defaults: ['material', 'projeto', 'classe', 'categoria', 'unidade_medida', 'saldo', 'reservado', 'disponivel', 'situacao_estoque', 'condicao'],
    groups: ['classe', 'categoria', 'projeto', 'unidade_sigla', 'situacao_estoque', 'condicao', 'area_tematica'],
    kpis: rows => [{ label: 'Itens', value: rows.length }, { label: 'Quantidade em saldo', value: quantityTotal(rows, 'saldo') }, { label: 'Disponíveis', value: quantityTotal(rows, 'disponivel') }, { label: 'Com estoque baixo', value: count(rows, row => row.situacao_estoque === 'baixo'), tone: 'warn' }],
  },
  movements: {
    label: 'Movimentações', description: 'Histórico de entradas, distribuições, consumos e ajustes de estoque.', icon: Repeat2,
    columns: [{ key: 'data', label: 'Data', date: true }, ...shared, { key: 'material', label: 'Material' }, { key: 'classe', label: 'Classe' }, { key: 'unidade_medida', label: 'Unidade de medida' }, { key: 'tipo', label: 'Tipo' }, { key: 'sentido', label: 'Sentido' }, { key: 'quantidade', label: 'Quantidade', numeric: true }, { key: 'observacao', label: 'Observação' }],
    defaults: ['data', 'material', 'projeto', 'unidade_medida', 'tipo', 'sentido', 'quantidade', 'observacao'],
    groups: ['tipo', 'material', 'projeto', 'classe', 'unidade_sigla', 'mes'], dateKey: 'data',
    series: [{ key: 'in', label: 'Entradas', value: row => Math.max(num(row.quantidade), 0) }, { key: 'out', label: 'Saídas', value: row => Math.max(-num(row.quantidade), 0) }],
    kpis: rows => [{ label: 'Movimentações', value: rows.length }, { label: 'Quantidade que entrou', value: quantityTotal(rows, 'quantidade', 'in') }, { label: 'Quantidade que saiu', value: quantityTotal(rows, 'quantidade', 'out') }, { label: 'Materiais movimentados', value: distinct(rows, 'material') }],
  },
  outflows: {
    label: 'Saídas institucionais', description: 'Distribuições e prêmios entregues, por projeto, material e unidade de medida. Ajustes, consumo e reservas ficam em seus próprios relatórios.', icon: Truck,
    columns: [...shared, { key: 'material', label: 'Material' }, { key: 'classe', label: 'Classe' }, { key: 'unidade_medida', label: 'Unidade de medida' }, { key: 'tipo', label: 'Finalidade da saída' }, { key: 'quantidade', label: 'Quantidade entregue', numeric: true }, { key: 'movimentacoes', label: 'Movimentações', numeric: true }, { key: 'primeira_saida', label: 'Primeira saída', date: true }, { key: 'ultima_saida', label: 'Última saída', date: true }],
    defaults: ['projeto', 'material', 'unidade_medida', 'tipo', 'quantidade', 'movimentacoes', 'primeira_saida', 'ultima_saida'],
    groups: ['projeto', 'material', 'unidade_sigla', 'tipo', 'unidade_medida'],
    kpis: rows => [{ label: 'Projetos atendidos', value: distinct(rows, 'projeto') }, { label: 'Materiais', value: distinct(rows, 'material') }, { label: 'Quantidade entregue', value: quantityTotal(rows, 'quantidade') }, { label: 'Movimentações', value: sum(rows, 'movimentacoes') }],
  },
  loans: {
    label: 'Empréstimos', description: 'Agenda, retiradas, devoluções e atrasos. Não inclui dados de contato.', icon: Truck,
    columns: [...shared, { key: 'material', label: 'Material' }, { key: 'acao', label: 'Ação' }, { key: 'inicio', label: 'Início', date: true }, { key: 'fim', label: 'Devolução prevista', date: true }, { key: 'situacao', label: 'Situação' }, { key: 'em_atraso', label: 'Em atraso' }, { key: 'retirado_em', label: 'Retirado em', date: true }, { key: 'devolvido_em', label: 'Devolvido em', date: true }, { key: 'condicao_saida', label: 'Condição na saída' }, { key: 'condicao_retorno', label: 'Condição no retorno' }],
    defaults: ['material', 'projeto', 'acao', 'inicio', 'fim', 'situacao', 'em_atraso', 'devolvido_em'],
    groups: ['situacao', 'material', 'projeto', 'unidade_sigla', 'em_atraso', 'mes'], dateKey: 'inicio',
    kpis: rows => [{ label: 'Empréstimos', value: rows.length }, { label: 'Com a equipe agora', value: count(rows, row => row.situacao === 'out') }, { label: 'Em atraso', value: count(rows, row => row.em_atraso === 'sim'), tone: 'warn' }, { label: 'Devolvidos', value: count(rows, row => row.situacao === 'returned') }],
  },
  records: {
    label: 'Registros', description: 'Histórico de observações, manutenções, distribuições e documentos.', icon: ClipboardList,
    columns: [{ key: 'data', label: 'Data', date: true }, ...shared, { key: 'categoria', label: 'Categoria' }, { key: 'titulo', label: 'Título' }, { key: 'descricao', label: 'Descrição' }, { key: 'anexos', label: 'Anexos', numeric: true }],
    defaults: ['data', 'projeto', 'categoria', 'titulo', 'anexos'],
    groups: ['categoria', 'projeto', 'unidade_sigla', 'area_tematica', 'mes'], dateKey: 'data',
    kpis: rows => [{ label: 'Registros', value: rows.length }, { label: 'Com anexos', value: count(rows, row => num(row.anexos) > 0) }, { label: 'Anexos', value: sum(rows, 'anexos') }, { label: 'Projetos com registro', value: distinct(rows, 'projeto') }],
  },
  campaigns: {
    label: 'Eventos e dinâmicas', description: 'Participações, tentativas e prêmios entregues por evento.', icon: CalendarRange,
    columns: [...shared, { key: 'evento', label: 'Evento' }, { key: 'local', label: 'Local' }, { key: 'inicio', label: 'Início', date: true }, { key: 'fim', label: 'Fim', date: true }, { key: 'situacao', label: 'Situação' }, { key: 'participacoes', label: 'Participações', numeric: true }, { key: 'tentativas', label: 'Tentativas', numeric: true }, { key: 'premios_entregues', label: 'Prêmios entregues', numeric: true }],
    defaults: ['evento', 'projeto', 'inicio', 'situacao', 'participacoes', 'tentativas', 'premios_entregues'],
    groups: ['projeto', 'situacao', 'unidade_sigla', 'area_tematica', 'mes'], dateKey: 'inicio',
    kpis: rows => [{ label: 'Eventos', value: rows.length }, { label: 'Participações', value: sum(rows, 'participacoes') }, { label: 'Tentativas', value: sum(rows, 'tentativas') }, { label: 'Prêmios entregues', value: sum(rows, 'premios_entregues') }],
  },
  demands: {
    label: 'Demandas e prioridades', description: 'Pendências, responsáveis ativos e prazos. O período filtra a criação; atraso considera o prazo em Brasília. Não inclui contatos ou corpo privado.', icon: ClipboardList,
    columns: [{ key: 'organizacao', label: 'Organização' }, ...shared, { key: 'demanda', label: 'Demanda' }, { key: 'prioridade', label: 'Prioridade' }, { key: 'situacao', label: 'Situação' }, { key: 'prazo', label: 'Prazo', date: true }, { key: 'em_atraso', label: 'Em atraso' }, { key: 'data', label: 'Criada em', date: true }, { key: 'atualizada_em', label: 'Atualizada em', date: true }, { key: 'evento', label: 'Evento vinculado' }, { key: 'material', label: 'Material vinculado' }, { key: 'responsaveis_ativos', label: 'Responsáveis individuais ativos', numeric: true }, { key: 'equipes_ativas', label: 'Equipes ativas', numeric: true }, { key: 'itens_conferencia', label: 'Itens da conferência', numeric: true }, { key: 'contagens_pendentes', label: 'Contagens pendentes', numeric: true }],
    defaults: ['organizacao', 'projeto', 'demanda', 'prioridade', 'situacao', 'prazo', 'em_atraso', 'equipes_ativas'],
    groups: ['prioridade', 'situacao', 'organizacao', 'projeto', 'em_atraso', 'mes'], dateKey: 'data',
    kpis: rows => [{ label: 'Demandas', value: rows.length }, { label: 'Pendentes', value: count(rows, row => !['completed', 'cancelled'].includes(String(row.situacao))) }, { label: 'Em atraso', value: count(rows, row => row.em_atraso === 'sim'), tone: 'warn' }, { label: 'Contagens pendentes', value: sum(rows, 'contagens_pendentes') }],
  },
  reviews: {
    label: 'Conferências e avarias', description: 'Uma linha por material e tamanho, com contagem e avaria registradas. O período filtra a criação da conferência. Conferir não movimenta o estoque.', icon: ClipboardList,
    columns: [{ key: 'organizacao', label: 'Organização' }, ...shared, { key: 'conferencia', label: 'Conferência' }, { key: 'demanda', label: 'Demanda vinculada' }, { key: 'situacao', label: 'Situação' }, { key: 'data', label: 'Criada em', date: true }, { key: 'evento', label: 'Evento vinculado' }, { key: 'material', label: 'Material' }, { key: 'tamanho', label: 'Tamanho' }, { key: 'unidade_medida', label: 'Unidade de medida' }, { key: 'esperado', label: 'Esperado', numeric: true }, { key: 'contado', label: 'Contado', numeric: true }, { key: 'avariado', label: 'Avarias registradas', numeric: true }, { key: 'divergencia', label: 'Diferença para o esperado', numeric: true }, { key: 'sem_avarias', label: 'Contados sem avaria', numeric: true }, { key: 'contagem_pendente', label: 'Contagem pendente' }, { key: 'acompanhamentos', label: 'Acompanhamentos criados', numeric: true }],
    defaults: ['organizacao', 'projeto', 'conferencia', 'material', 'tamanho', 'unidade_medida', 'esperado', 'contado', 'avariado', 'divergencia', 'situacao'],
    groups: ['conferencia', 'material', 'tamanho', 'unidade_medida', 'situacao', 'organizacao', 'mes'], dateKey: 'data',
    kpis: rows => [{ label: 'Conferências', value: distinct(rows, 'conferencia_id') }, { label: 'Contagens pendentes', value: count(rows, row => row.contagem_pendente === 'sim'), tone: 'warn' }, { label: 'Avarias registradas', value: quantityTotal(rows, 'avariado') }, { label: 'Linhas com divergência', value: count(rows, row => row.divergencia !== null && num(row.divergencia) !== 0) }],
  },
};
const ORDER: DatasetId[] = ['projects', 'materials', 'movements', 'outflows', 'loans', 'records', 'campaigns', 'demands', 'reviews'];
const PHYSICAL_MEASURES = ['saldo', 'reservado', 'disponivel', 'alerta_minimo', 'quantidade', 'esperado', 'contado', 'avariado', 'divergencia', 'sem_avarias'];
const LABELS: Record<string, Record<string, string>> = {
  abrangencia: { internal: 'Interno PROEX', external: 'Externo' },
  etapa: { active: 'Em andamento', past: 'Encerrado', catalog: 'Catálogo' },
  classe: { gift: 'Brinde', equipment: 'Equipamento', distribution: 'Distribuição', consumption: 'Consumo' },
  condicao: { active: 'Em uso', maintenance: 'Em manutenção', inactive: 'Inativo' },
  situacao_estoque: { baixo: 'Estoque baixo', ok: 'Adequado' },
  tipo: { receive: 'Entrada', distribute: 'Distribuição', consume: 'Consumo', adjust: 'Ajuste', redeem: 'Resgate de prêmio', transfer: 'Transferência' },
  sentido: { entrada: 'Entrada', saida: 'Saída' },
  em_atraso: { sim: 'Sim', nao: 'Não' },
  contagem_pendente: { sim: 'Sim', nao: 'Não' },
  prioridade: { high: 'Alta', medium: 'Média', low: 'Baixa' },
  categoria: { observation: 'Observação', maintenance: 'Manutenção', distribution: 'Distribuição', consumption: 'Consumo', project: 'Projeto', material: 'Material', loan: 'Empréstimo' },
};
const STATUS: Partial<Record<DatasetId, Record<string, string>>> = {
  projects: { active: 'Ativo', archived: 'Arquivado' },
  loans: { reserved: 'Reservado', out: 'Retirado', returned: 'Devolvido', cancelled: 'Cancelado' },
  campaigns: { draft: 'Rascunho', active: 'Ativo', paused: 'Pausado', closed: 'Encerrado' },
  demands: { open: 'Aberta', in_progress: 'Em andamento', blocked: 'Bloqueada', completed: 'Concluída', cancelled: 'Cancelada' },
  reviews: { open: 'Aberta', completed: 'Concluída' },
};
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const PRESETS_KEY = 'proex.reports.presets.v1';
const PAGE_SIZES = [25, 50, 100];
const EMPTY_ROWS: ExportRow[] = [];

function display(dataset: DatasetId, row: ExportRow, key: string): unknown {
  const value = key === 'mes' ? monthOf(row, DATASETS[dataset].dateKey) : row[key];
  if (value === null || value === undefined || value === '') return '';
  if (key === 'area_tematica') return areaLabel(String(value)) || String(value);
  if (key === 'situacao' && dataset !== 'materials') return STATUS[dataset]?.[String(value)] ?? value;
  if (key === 'categoria' && dataset !== 'records') return value;
  if (LABELS[key]?.[String(value)]) return LABELS[key][String(value)];
  return value;
}
function monthOf(row: ExportRow, key?: string): string { const value = key ? String(row[key] ?? '') : ''; return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : ''; }
function monthLabel(month: string) { const [year, index] = month.split('-'); return `${MONTHS[Number(index) - 1]}/${year.slice(2)}`; }
function dateLabel(value: unknown) { const text = String(value ?? ''); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.split('-').reverse().join('/') : text; }
const formatNumber = (value: number | null) => value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
function readPresets(): Preset[] { try { const parsed = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); return Array.isArray(parsed) ? parsed.slice(0, 20) : []; } catch { return []; } }
function writePresets(presets: Preset[]) { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch { /* armazenamento indisponível */ } }

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return <div className={styles.tooltip}><strong>{label}</strong>{payload.map(item => <span key={item.name}><i style={{ background: item.color }} />{item.name}<b>{formatNumber(Number(item.value) || 0)} {unit}</b></span>)}</div>;
}

export default function ReportsCenter({ projectId, unitId, area, from, to, scopeLabel, available, initialDataset }: {
  projectId: string; unitId: string; area: string; from: string; to: string; scopeLabel: string; available: DatasetId[]; initialDataset?: DatasetId;
}) {
  const datasets = ORDER.filter(id => available.includes(id));
  const [dataset, setDataset] = useState<DatasetId>(initialDataset && datasets.includes(initialDataset) ? initialDataset : datasets[0] ?? 'projects');
  const [assetDetails, setAssetDetails] = useState(false);
  const config = useMemo(() => dataset === 'materials' && assetDetails ? { ...DATASETS.materials, columns: [...DATASETS.materials.columns, ...ASSET_COLUMNS] } : DATASETS[dataset], [dataset, assetDetails]);
  const [columns, setColumns] = useState<string[]>(config.defaults);
  const [groupBy, setGroupBy] = useState(config.groups[0]);
  const [measure, setMeasure] = useState('__count__');
  const [focus, setFocus] = useState('');
  const [search, setSearch] = useState('');
  const [measurementUnit, setMeasurementUnit] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0), [pageSize, setPageSize] = useState(25);
  const queryKey = JSON.stringify([dataset, projectId, unitId, area, from, to, assetDetails]);
  const [loadedQueryKey, setLoadedQueryKey] = useState('');
  const [loadedRows, setRows] = useState<ExportRow[]>([]), [truncated, setTruncated] = useState(false);
  const [fetching, setLoading] = useState(true), [error, setError] = useState('');
  const rows = loadedQueryKey === queryKey ? loadedRows : EMPTY_ROWS;
  const loading = fetching || loadedQueryKey !== queryKey;
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const chartsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const timer = window.setTimeout(() => setPresets(readPresets()), 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ dataset });
    if (dataset === 'materials' && assetDetails) query.set('assetDetails', '1');
    if (projectId) query.set('projectId', projectId);
    if (unitId) query.set('unitId', unitId === '__unassigned__' ? '__none__' : unitId);
    if (area) query.set('thematicArea', area);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const start = window.setTimeout(() => { setLoading(true); setError(''); }, 0);
    fetch(`/api/reports?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = (await response.json().catch(() => ({}))) as { rows?: ExportRow[]; truncated?: boolean; error?: string | { message?: string }; message?: string }; if (!response.ok) throw new Error((typeof body.error === 'string' ? body.error : body.error?.message) || body.message || 'Não foi possível carregar o relatório.'); return body; })
      .then(body => { if (controller.signal.aborted) return; setRows(Array.isArray(body.rows) ? body.rows : []); setLoadedQueryKey(queryKey); setTruncated(Boolean(body.truncated)); setLoading(false); })
      .catch(reason => { if (controller.signal.aborted) return; setRows([]); setLoadedQueryKey(queryKey); setTruncated(false); setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o relatório.'); setLoading(false); });
    return () => { window.clearTimeout(start); controller.abort(); };
  }, [dataset, projectId, unitId, area, from, to, queryKey, assetDetails]);

  function chooseDataset(id: DatasetId, preset?: Preset) {
    const next = DATASETS[id];
    setDataset(id); setAssetDetails(false); setColumns(preset?.columns.filter(key => next.columns.some(column => column.key === key)) ?? next.defaults);
    setGroupBy(preset && next.groups.includes(preset.groupBy) ? preset.groupBy : next.groups[0]);
    setMeasure(preset && (preset.measure === '__count__' || next.columns.some(column => column.key === preset.measure && column.numeric)) ? preset.measure : '__count__');
    setSearch(preset?.search ?? ''); setMeasurementUnit(''); setFocus(''); setSort(null); setPage(0);
  }

  const valueOf = (row: ExportRow, key: string) => display(dataset, row, key);
  const numericColumns = config.columns.filter(column => column.numeric);
  const unitOptions = [...new Set(rows.map(row => String(row.unidade_medida ?? '').trim()).filter(Boolean))].sort();
  const searched = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    const measured = measurementUnit ? rows.filter(row => String(row.unidade_medida ?? '').trim() === measurementUnit) : rows;
    if (!needle) return measured;
    return measured.filter(row => config.columns.some(column => String(display(dataset, row, column.key) ?? '').toLocaleLowerCase('pt-BR').includes(needle)));
  }, [rows, search, config, dataset, measurementUnit]);
  const mixedUnits = ['materials', 'movements', 'outflows', 'reviews'].includes(dataset) && quantityTotal(searched, 'quantidade') === null;
  const effectiveMeasure = mixedUnits && PHYSICAL_MEASURES.includes(measure) ? '__count__' : measure;
  const measureLabel = effectiveMeasure === '__count__' ? (dataset === 'movements' ? 'movimentações' : 'linhas') : (config.columns.find(column => column.key === effectiveMeasure)?.label.toLowerCase() ?? '');
  const filtered = useMemo(() => focus ? searched.filter(row => String(display(dataset, row, groupBy) || 'Sem informação') === focus) : searched, [searched, focus, groupBy, dataset]);

  const breakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of searched) { const key = String(display(dataset, row, groupBy) || 'Sem informação'); totals.set(key, (totals.get(key) ?? 0) + (effectiveMeasure === '__count__' ? 1 : (dataset === 'movements' && effectiveMeasure === 'quantidade' ? Math.abs(num(row[effectiveMeasure])) : num(row[effectiveMeasure])))); }
    const sorted = [...totals].sort((a, b) => groupBy === 'mes' ? a[0].localeCompare(b[0]) : b[1] - a[1]);
    if (groupBy === 'mes' || sorted.length <= 10) return sorted.map(([name, value]) => ({ name: groupBy === 'mes' && name !== 'Sem informação' ? monthLabel(name) : name, raw: name, value }));
    const top = sorted.slice(0, 9), rest = sorted.slice(9).reduce((total, [, value]) => total + value, 0);
    return [...top.map(([name, value]) => ({ name, raw: name, value })), { name: `Outros (${sorted.length - 9})`, raw: '', value: rest }];
  }, [searched, groupBy, effectiveMeasure, dataset]);

  const timeline = useMemo(() => {
    if (!config.dateKey) return [];
    const months = new Map<string, ExportRow[]>();
    for (const row of filtered) { const month = monthOf(row, config.dateKey); if (month) months.set(month, [...(months.get(month) ?? []), row]); }
    const keys = [...months.keys()].sort().slice(-18);
    return keys.map(month => {
      const bucket = months.get(month)!;
      const point: Record<string, number | string> = { name: monthLabel(month) };
      if (config.series) for (const serie of config.series) point[serie.key] = bucket.reduce((total, row) => total + (mixedUnits ? (serie.value(row) > 0 ? 1 : 0) : serie.value(row)), 0);
      else point.value = effectiveMeasure === '__count__' ? bucket.length : sum(bucket, effectiveMeasure);
      return point;
    });
  }, [filtered, config, effectiveMeasure, mixedUnits]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = config.columns.find(item => item.key === sort.key);
    return [...filtered].sort((a, b) => {
      const left = a[sort.key], right = b[sort.key];
      if (column?.numeric) return (num(left) - num(right)) * sort.dir;
      return String(display(dataset, a, sort.key) ?? '').localeCompare(String(display(dataset, b, sort.key) ?? ''), 'pt-BR', { numeric: true }) * sort.dir;
    });
  }, [filtered, sort, config, dataset]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);
  const chosen = config.columns.filter(column => columns.includes(column.key));
  const kpis = config.kpis(filtered);
  const exportColumns: Column[] = chosen;
  const stamp = new Date().toISOString().slice(0, 10);
  const fileBase = `proex-${dataset}-${stamp}`;
  const exportValue = (row: ExportRow, key: string) => { const column = config.columns.find(item => item.key === key); const value = valueOf(row, key); return column?.date ? dateLabel(value) : column?.numeric ? num(value) : value; };
  const info: [string, string][] = [['Relatório', config.label], ['Recorte', scopeLabel || 'Todos os projetos que você pode consultar'], ['Período', from || to ? `${from ? dateLabel(from) : 'início'} a ${to ? dateLabel(to) : 'hoje'}` : 'Todo o período'], ['Unidade de medida', measurementUnit || 'Todas, separadas em cada registro'], ['Busca', search || '—'], ['Destaque', focus ? `${config.columns.find(column => column.key === groupBy)?.label ?? 'Mês'}: ${focus}` : '—'], ['Linhas', String(sorted.length)], ['Gerado em', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (Brasília)'], ['Compartilhamento', 'Recorte das suas permissões. Revise os textos livres antes de compartilhar.']];

  async function exportDocument(format: 'pdf' | 'docx') {
    if (exporting || loading || !chosen.length) return;
    setExporting(format); setError('');
    try {
      const blob = format === 'docx'
        ? toDocx(config.label, exportColumns, sorted, exportValue, info)
        : await (await import('./report-pdf')).toPdf(config.label, exportColumns, sorted, exportValue, info);
      download(`${fileBase}.${format}`, blob);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o documento. Tente novamente.');
    } finally { setExporting(null); }
  }

  function toggleColumn(key: string) { setColumns(current => current.includes(key) ? current.filter(item => item !== key) : config.columns.map(column => column.key).filter(item => item === key || current.includes(item))); }
  function savePreset() {
    const name = presetName.trim().slice(0, 60); if (!name) return;
    const next = [{ name, dataset, columns, groupBy, measure, search }, ...presets.filter(preset => preset.name !== name)].slice(0, 20);
    setPresets(next); writePresets(next); setPresetName('');
  }
  function removePreset(name: string) { const next = presets.filter(preset => preset.name !== name); setPresets(next); writePresets(next); }
  function print() {
    if (loading || !chosen.length) return;
    const popup = window.open('', '_blank', 'width=1100,height=800'); if (!popup) { setError('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente de novo.'); return; }
    const charts = chartsRef.current?.querySelectorAll('svg.recharts-surface') ?? [];
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escape(config.label)} — PROEX/UFG</title><style>
      :root{--rc-1:#2a78d6;--rc-2:#eb6834;--rc-grid:#e6e1ec;--rc-axis:#6b6275}body{font:12px/1.5 system-ui,sans-serif;color:#231b2b;margin:28px}h1{font-size:20px;margin:0 0 4px;color:#54216c}dl{display:grid;grid-template-columns:140px 1fr;gap:2px 12px;margin:12px 0 18px}dt{color:#6b6275}dd{margin:0}.k{display:flex;gap:10px;margin-bottom:16px}.k div{border:1px solid #ddd3e6;border-radius:8px;padding:8px 12px;min-width:120px}.k b{display:block;font-size:20px;color:#54216c}.c{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px}.c svg{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#54216c;color:#fff;text-align:left;padding:5px}td{border-bottom:1px solid #e6e1ec;padding:4px 5px}td.n{text-align:right;font-variant-numeric:tabular-nums}@media print{body{margin:10mm}}</style></head><body>
      <h1>${escape(config.label)}</h1><div>Pró-Reitoria de Extensão — UFG</div><dl>${info.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>
      <div class="k">${kpis.map(kpi => `<div>${escape(kpi.label)}<b>${formatNumber(kpi.value)}</b></div>`).join('')}</div>
      <div class="c">${[...charts].map(svg => svg.outerHTML).join('')}</div>
      <table><thead><tr>${exportColumns.map(column => `<th>${escape(column.label)}</th>`).join('')}</tr></thead><tbody>${sorted.slice(0, 2000).map(row => `<tr>${exportColumns.map(column => `<td${column.numeric ? ' class="n"' : ''}>${escape(exportValue(row, column.key))}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${sorted.length > 2000 ? '<p>Impressão limitada às primeiras 2.000 linhas. Use a exportação em planilha para o conjunto completo.</p>' : ''}
      <script>setTimeout(function(){print()},300)</script></body></html>`);
    popup.document.close();
  }

  if (!datasets.length) return null;
  const groupLabel = groupBy === 'mes' ? 'Mês' : config.columns.find(column => column.key === groupBy)?.label ?? groupBy;
  const Icon = config.icon;
  return <section className={styles.root} aria-labelledby="reports-center-title">
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}><BarChart3 size={15} />Central de relatórios</span>
        <h2 id="reports-center-title">Monte o relatório que você precisa</h2>
        <p>Escolha o assunto, ajuste o recorte com os filtros do topo e as datas acima, veja os gráficos e exporte só as colunas que interessam.</p>
      </div>
      <div className={styles.exportBar} role="group" aria-label="Exportar relatório">
        <button type="button" className="p-button p-button-primary" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={() => download(`${fileBase}.xlsx`, toXlsx(config.label, exportColumns, sorted, exportValue, info))}><FileSpreadsheet size={16} />Excel</button>
        <button type="button" className="p-button p-button-subtle" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={() => void exportDocument('pdf')}>{exporting === 'pdf' ? <LoaderCircle size={16} className="animate-spin" /> : <FileText size={16} />}PDF</button>
        <button type="button" className="p-button p-button-subtle" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={() => void exportDocument('docx')}>{exporting === 'docx' ? <LoaderCircle size={16} className="animate-spin" /> : <FileText size={16} />}Word</button>
        <button type="button" className="p-button p-button-subtle" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={() => download(`${fileBase}.csv`, toCsv(exportColumns, sorted, exportValue))}><Sheet size={16} />CSV</button>
        <button type="button" className="p-button p-button-subtle" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={() => download(`${fileBase}.json`, toJson({ relatorio: config.label, filtros: Object.fromEntries(info) }, exportColumns, sorted, exportValue))}><FileJson size={16} />JSON</button>
        <button type="button" className="p-button p-button-subtle" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={print}><Printer size={16} />Imprimir</button>
      </div>
    </header>

    <div className={styles.datasets} role="tablist" aria-label="Assunto do relatório">
      {datasets.map(id => { const DatasetIcon = DATASETS[id].icon; return <button key={id} type="button" role="tab" aria-selected={dataset === id} className={dataset === id ? styles.active : ''} onClick={() => chooseDataset(id)}><DatasetIcon size={17} /><span>{DATASETS[id].label}</span></button>; })}
    </div>

    {dataset === 'materials' && <label className="p-form-help"><input type="checkbox" checked={assetDetails} onChange={event => { setAssetDetails(event.target.checked); setColumns(DATASETS.materials.defaults); setRows([]); setFocus(''); setMeasure('__count__'); }}/>{' '}Consultar metadados patrimoniais privados (somente projetos com permissão vigente de inventário). A referência de responsável, processo e valor documentado só entra na exportação ao escolher essas colunas.</label>}
    <div className={styles.controls}>
      <label className={`p-field ${styles.search}`}><span>Buscar nas linhas</span><span className={styles.searchBox}><Search size={15} /><input value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Nome, material, título, observação…" />{search && <button type="button" aria-label="Limpar busca" onClick={() => setSearch('')}><X size={14} /></button>}</span></label>
      <label className="p-field"><span>Agrupar gráfico por</span><select value={groupBy} onChange={event => { setGroupBy(event.target.value); setFocus(''); }}>{config.groups.map(key => <option key={key} value={key}>{key === 'mes' ? 'Mês' : config.columns.find(column => column.key === key)?.label}</option>)}</select></label>
      <label className="p-field"><span>Medida</span><select value={effectiveMeasure} onChange={event => setMeasure(event.target.value)}><option value="__count__">Quantidade de {dataset === 'movements' ? 'movimentações' : 'linhas'}</option>{numericColumns.map(column => <option key={column.key} value={column.key} disabled={mixedUnits && PHYSICAL_MEASURES.includes(column.key)}>Soma de {column.label.toLowerCase()}</option>)}</select></label>
      {unitOptions.length > 0 && <label className="p-field"><span>Unidade de medida</span><select value={measurementUnit} onChange={event => { setMeasurementUnit(event.target.value); setFocus(''); setPage(0); }}><option value="">Todas as medidas</option>{unitOptions.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label>}
      <details className={styles.columns}>
        <summary><Columns3 size={16} />Colunas ({chosen.length}/{config.columns.length})</summary>
        <div>
          <div className={styles.columnActions}><button type="button" onClick={() => setColumns(config.columns.map(column => column.key))}>Todas</button><button type="button" onClick={() => setColumns(config.defaults)}>Padrão</button><button type="button" onClick={() => setColumns([])}>Nenhuma</button></div>
          {config.columns.map(column => <label key={column.key}><input type="checkbox" checked={columns.includes(column.key)} onChange={() => toggleColumn(column.key)} />{column.label}</label>)}
        </div>
      </details>
    </div>
    {mixedUnits && <p className="p-form-help" role="status">Há medidas físicas diferentes neste recorte. Selecione uma unidade de medida para somar quantidades; os gráficos mostram contagens de registros.</p>}

    <div className={styles.presets}>
      <span><Save size={14} />Modelos salvos</span>
      {presets.length ? presets.map(preset => <span key={preset.name} className={styles.preset}><button type="button" onClick={() => chooseDataset(preset.dataset, preset)} title={`${DATASETS[preset.dataset]?.label}`}>{preset.name}</button><button type="button" aria-label={`Excluir modelo ${preset.name}`} onClick={() => removePreset(preset.name)}><Trash2 size={13} /></button></span>) : <small>Nenhum ainda. Salve a combinação atual de assunto, colunas e agrupamento.</small>}
      <form onSubmit={event => { event.preventDefault(); savePreset(); }}><input value={presetName} onChange={event => setPresetName(event.target.value)} placeholder="Nome do modelo" aria-label="Nome do modelo" maxLength={60} /><button type="submit" className="p-button p-button-subtle" disabled={!presetName.trim()}>Salvar</button></form>
    </div>

    {error ? <p className="p-notice p-notice-error" role="alert">{error}</p> : null}
    <div className={styles.summary} aria-live="polite">
      <span className={styles.summaryIcon}><Icon size={20} /></span>
      <p><strong>{config.label}</strong> · {loading ? 'carregando…' : `${formatNumber(filtered.length)} ${filtered.length === 1 ? 'linha' : 'linhas'}`}{scopeLabel ? ` · ${scopeLabel}` : ''}{from || to ? ` · ${from ? dateLabel(from) : 'início'} a ${to ? dateLabel(to) : 'hoje'}` : ''}</p>
      {focus && <button type="button" className={styles.focusChip} onClick={() => setFocus('')}>{groupLabel}: {groupBy === 'mes' && /^\d{4}-\d{2}$/.test(focus) ? monthLabel(focus) : focus}<X size={13} /></button>}
      {truncated && <small className={styles.warn}>Mostrando as primeiras 5.000 linhas. Refine o recorte para ver tudo.</small>}
    </div>

    <div className={styles.kpis}>
      {kpis.map(kpi => <div key={kpi.label} className={`${styles.kpi} ${kpi.tone === 'warn' && (kpi.value ?? 0) > 0 ? styles.kpiWarn : ''}`}><span>{kpi.label}</span><strong>{loading ? '…' : formatNumber(kpi.value)}</strong></div>)}
    </div>

    {loading ? <div className={styles.loading}><LoaderCircle className="p-spin" size={22} />Carregando dados…</div> : !rows.length ? <div className={styles.empty}><FileText size={22} /><strong>Nada para mostrar neste recorte</strong><span>Altere os filtros, o período ou escolha outro assunto.</span></div> : <>
      <div className={styles.charts} ref={chartsRef}>
        <figure className={styles.chart}>
          <figcaption><strong>{effectiveMeasure === '__count__' ? 'Distribuição' : `Soma de ${measureLabel}`} por {groupLabel.toLowerCase()}</strong><small>Clique em uma barra para destacar só aquele grupo na tabela.</small></figcaption>
          <div style={{ height: Math.max(180, breakdown.length * 34 + 40) }} role="img" aria-label={`Gráfico de barras: ${breakdown.map(item => `${item.name} ${formatNumber(item.value)}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdown} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }} barCategoryGap={6}>
                <CartesianGrid horizontal={false} stroke="var(--rc-grid)" />
                <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--rc-axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fill: 'var(--rc-axis)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value: string) => value.length > 24 ? `${value.slice(0, 23)}…` : value} />
                <Tooltip cursor={{ fill: 'var(--rc-hover)' }} content={<ChartTooltip unit={measureLabel} />} />
                <Bar dataKey="value" name={effectiveMeasure === '__count__' ? 'Total' : `Soma de ${measureLabel}`} fill="var(--rc-1)" radius={[0, 4, 4, 0]} maxBarSize={22} cursor="pointer" label={{ position: 'right', fill: 'var(--rc-axis)', fontSize: 11, formatter: (value: unknown) => formatNumber(Number(value) || 0) }}
                  onClick={(entry: { payload?: { raw?: string } }) => { const raw = entry?.payload?.raw; if (!raw) return; setFocus(current => current === raw ? '' : raw); setPage(0); }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
        {timeline.length > 0 && <figure className={styles.chart}>
          <figcaption><strong>Evolução por mês</strong><small>{config.series ? (mixedUnits ? 'Contagem de movimentações de entrada e saída, sem somar medidas diferentes.' : `Quantidades em ${measurementUnit || unitOptions[0] || 'unidade informada'} que entraram e saíram do estoque.`) : `${effectiveMeasure === '__count__' ? 'Quantidade' : `Soma de ${measureLabel}`} por mês${DATASETS[dataset].dateKey === 'inicio' ? ' de início' : ''}.`}</small></figcaption>
          <div style={{ height: 260 }} role="img" aria-label={`Gráfico mensal com ${timeline.length} meses`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeline} margin={{ top: 8, right: 8, bottom: 4, left: -12 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--rc-grid)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--rc-axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: 'var(--rc-axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'var(--rc-hover)' }} content={<ChartTooltip unit={config.series ? (mixedUnits ? 'movimentações' : measurementUnit || unitOptions[0] || 'unidades') : measureLabel} />} />
                {config.series ? <>
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: 'var(--rc-axis)' }} />
                  {config.series.map((serie, index) => <Bar key={serie.key} dataKey={serie.key} name={serie.label} fill={`var(--rc-${index + 1})`} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
                </> : <Bar dataKey="value" name={effectiveMeasure === '__count__' ? 'Total' : `Soma de ${measureLabel}`} fill="var(--rc-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>}
      </div>

      <div className={styles.tableHead}>
        <strong>Tabela detalhada</strong>
        <small>{chosen.length ? `${chosen.length} colunas · clique no título para ordenar` : 'Escolha ao menos uma coluna'}</small>
      </div>
      <div className={`p-card p-table-wrap ${styles.table}`}>
        <table>
          <thead><tr>{chosen.map(column => <th key={column.key} aria-sort={sort?.key === column.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={column.numeric ? styles.numeric : ''}>
            <button type="button" onClick={() => setSort(current => current?.key === column.key ? (current.dir === 1 ? { key: column.key, dir: -1 } : null) : { key: column.key, dir: 1 })}>{column.label}{sort?.key === column.key ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}</button>
          </th>)}</tr></thead>
          <tbody>{visible.map((row, index) => <tr key={String(row.id ?? index)}>{chosen.map(column => {
            const value = valueOf(row, column.key);
            const tone = column.key === 'situacao_estoque' && row.situacao_estoque === 'baixo' || column.key === 'em_atraso' && row.em_atraso === 'sim' ? styles.badgeWarn : column.key === 'sentido' ? (row.sentido === 'entrada' ? styles.badgeIn : styles.badgeOut) : '';
            return <td key={column.key} className={column.numeric ? styles.numeric : ''}>{tone ? <span className={`${styles.badge} ${tone}`}>{String(value)}</span> : column.date ? dateLabel(value) : column.numeric ? formatNumber(num(value)) : String(value ?? '') || '—'}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <div className={styles.pager}>
        <span>{sorted.length ? `${current * pageSize + 1}–${Math.min(sorted.length, (current + 1) * pageSize)} de ${formatNumber(sorted.length)}` : 'Nenhuma linha com esta busca'}</span>
        <label>Por página <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <button type="button" className="p-button p-button-subtle" disabled={current === 0} onClick={() => setPage(current - 1)}>Anterior</button>
        <button type="button" className="p-button p-button-subtle" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Próxima</button>
      </div>
    </>}
  </section>;
}
