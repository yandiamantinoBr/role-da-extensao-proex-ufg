'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, BarChart3, Boxes, CalendarRange, ClipboardList, Columns3, FileJson, FileSpreadsheet, FileText, FolderKanban, LoaderCircle, Printer, RefreshCw, Repeat2, Save, Search, Trash2, Truck, X } from 'lucide-react';
import { areaLabel } from '@/lib/extension-catalog';
import { quantityTotal } from '@/lib/report-quantities';
import Image from 'next/image';
import BrandMark from '@/components/theme/brand-mark';
import type { ReportPdfPresentation } from './report-pdf';
import { download, toDocx, toJson, toXlsx, type ExportColumn, type ExportRow } from './report-export';
import { SheetShortcuts } from './sheet-shortcuts';
import type { SheetTabKey } from '@/lib/sync/sheet-tab-catalog';
import styles from './reports-center.module.css';

type DatasetId = 'projects' | 'materials' | 'movements' | 'outflows' | 'outflow_details' | 'loans' | 'records' | 'campaigns' | 'demands' | 'reviews';
const SHEET_TAB_BY_DATASET: Partial<Record<DatasetId, SheetTabKey>> = {
  projects: 'projects', materials: 'items', movements: 'stock_movements', loans: 'loans',
  records: 'records', campaigns: 'campaigns', demands: 'followup_tasks', reviews: 'followup_checklists',
};
type Column = ExportColumn & { date?: boolean; nonAdditive?: boolean };
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
const OUTFLOW_NOTES: Column[] = [
  { key: 'finalidade_registrada', label: 'Motivo/finalidade registrada (texto livre)' },
  { key: 'observacao_atividade', label: 'Observação da atividade (texto livre)' },
  { key: 'condicao_saida', label: 'Condição na retirada (texto livre)' },
  { key: 'condicao_retorno', label: 'Condição na devolução (texto livre)' },
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
    columns: [...shared, { key: 'sigla', label: 'Sigla' }, { key: 'linha_extensao', label: 'Linha de extensão' }, { key: 'abrangencia', label: 'Abrangência' }, { key: 'situacao', label: 'Situação' }, { key: 'etapa', label: 'Etapa' }, { key: 'inicio', label: 'Início', date: true }, { key: 'fim', label: 'Fim', date: true }, { key: 'local', label: 'Local' }, { key: 'materiais', label: 'Materiais', numeric: true }, { key: 'eventos', label: 'Dinâmicas cadastradas', numeric: true }, { key: 'marcos_agenda', label: 'Marcos na Agenda', numeric: true }, { key: 'emprestimos', label: 'Empréstimos', numeric: true }, { key: 'registros', label: 'Registros', numeric: true }, { key: 'criado_em', label: 'Cadastrado em', date: true }],
    defaults: ['projeto', 'unidade_sigla', 'area_tematica', 'modalidade', 'abrangencia', 'etapa', 'materiais', 'eventos', 'marcos_agenda', 'emprestimos', 'registros'],
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
  outflow_details: {
    label: 'Saídas rastreáveis', description: 'Um registro por distribuição, prêmio entregue ou retirada efetiva de equipamento. Reservas, ajustes e consumo não são saídas deste relatório. Unidade e saldo são os atuais do cadastro; datas previstas não substituem retiradas ausentes.', icon: Truck,
    columns: [...shared, { key: 'data_saida', label: 'Saída (Brasília)', date: true }, { key: 'material', label: 'Material' }, { key: 'classe', label: 'Classe' }, { key: 'categoria', label: 'Categoria' }, { key: 'unidade_medida', label: 'Unidade de medida atual' },
      { key: 'tipo', label: 'Tipo da saída' }, { key: 'quantidade', label: 'Quantidade da saída', numeric: true }, { key: 'acao', label: 'Ação registrada' }, { key: 'acao_fonte', label: 'Fonte da ação' },
      { key: 'registrado_por', label: 'Operador do registro (nome atual)' }, { key: 'operador_fonte', label: 'Fonte do operador' },
      { key: 'situacao_retorno', label: 'Devolução' }, { key: 'devolucao_prevista', label: 'Devolução prevista', date: true }, { key: 'devolucao_registrada', label: 'Devolução registrada', date: true },
      { key: 'saldo_atual', label: 'Saldo atual', numeric: true, nonAdditive: true }, { key: 'reservado_atual', label: 'Reservado atual', numeric: true, nonAdditive: true }, { key: 'disponivel_atual', label: 'Saldo menos reservas atuais', numeric: true, nonAdditive: true },
      { key: 'saldo_origem', label: 'Referência do saldo' }, { key: 'unidade_origem', label: 'Referência da unidade' }, { key: 'fonte_data', label: 'Fonte da data' }, { key: 'instante_saida_utc', label: 'Instante registrado (UTC)' },
      { key: 'origem', label: 'Origem do registro' }, { key: 'origem_id', label: 'ID do registro de origem' }, { key: 'atividade_id', label: 'ID da atividade' }, { key: 'evento_id', label: 'ID do evento' }],
    defaults: ['data_saida', 'projeto', 'acao', 'material', 'unidade_medida', 'tipo', 'quantidade', 'registrado_por', 'situacao_retorno'],
    groups: ['projeto', 'acao', 'material', 'tipo', 'situacao_retorno', 'unidade_medida', 'mes'], dateKey: 'data_saida',
    kpis: rows => [{ label: 'Registros de saída', value: rows.length }, { label: 'Materiais', value: distinct(rows, 'material') }, { label: 'Quantidade das saídas', value: quantityTotal(rows, 'quantidade') }, { label: 'Retornos pendentes', value: count(rows, row => row.situacao_retorno === 'out'), tone: 'warn' }],
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
    kpis: rows => [{ label: 'Conferências', value: distinct(rows, 'conferencia_id') }, { label: 'Contagens pendentes', value: count(rows, row => row.contagem_pendente === 'sim'), tone: 'warn' }, { label: 'Avarias registradas', value: quantityTotal(rows, 'avariado') }, { label: 'Linhas com divergência ou avaria', value: count(rows, row => num(row.avariado) > 0 || (row.divergencia !== null && num(row.divergencia) !== 0)) }],
  },
};
const ORDER: DatasetId[] = ['projects', 'materials', 'movements', 'outflows', 'outflow_details', 'loans', 'records', 'campaigns', 'demands', 'reviews'];
const PHYSICAL_MEASURES = ['saldo', 'reservado', 'disponivel', 'alerta_minimo', 'quantidade', 'esperado', 'contado', 'avariado', 'divergencia', 'sem_avarias'];
const LABELS: Record<string, Record<string, string>> = {
  abrangencia: { internal: 'Interno PROEX', external: 'Externo' },
  etapa: { active: 'Em andamento', past: 'Encerrado', catalog: 'Catálogo' },
  classe: { gift: 'Brinde', equipment: 'Equipamento', distribution: 'Distribuição', consumption: 'Consumo' },
  condicao: { active: 'Em uso', maintenance: 'Em manutenção', inactive: 'Inativo' },
  situacao_estoque: { baixo: 'Estoque baixo', ok: 'Adequado' },
  tipo: { receive: 'Entrada', distribute: 'Distribuição', consume: 'Consumo', adjust: 'Ajuste', redeem: 'Resgate de prêmio', transfer: 'Transferência', loan: 'Retirada de equipamento' },
  situacao_retorno: { not_applicable: 'Não se aplica (distribuição/prêmio)', out: 'Retorno pendente', returned: 'Devolvido' },
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
const LEGACY_PRESETS_KEY = 'proex.reports.presets.v1';
const PRESETS_PREFIX = 'proex.reports.presets.v2:';
const PAGE_SIZES = [25, 50, 100];
const EMPTY_ROWS: ExportRow[] = [];
const CURRENT_POSITION_PERIOD = 'Posição atual (sem filtro de período)';

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
function reportNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function readPresets(key: string): Preset[] {
  try {
    localStorage.removeItem(LEGACY_PRESETS_KEY);
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(preset => preset && typeof preset.name === 'string' && Object.hasOwn(DATASETS, preset.dataset) &&
      Array.isArray(preset.columns) && preset.columns.every((column: unknown) => typeof column === 'string') &&
      typeof preset.groupBy === 'string' && typeof preset.measure === 'string' && typeof preset.search === 'string').slice(0, 20);
  } catch { return []; }
}
function writePresets(key: string, presets: Preset[]) {
  try { localStorage.setItem(key, JSON.stringify(presets)); } catch { /* armazenamento indisponível */ }
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return <div className={styles.tooltip}><strong>{label}</strong>{payload.map(item => <span key={item.name}><i style={{ background: item.color }} />{item.name}<b>{formatNumber(Number(item.value) || 0)} {unit}</b></span>)}</div>;
}

async function requestReport(query: URLSearchParams, signal: AbortSignal): Promise<{ rows: ExportRow[]; truncated: boolean }> {
  const response = await fetch(`/api/reports?${query}`, { credentials: 'same-origin', cache: 'no-store', signal });
  let value: unknown;
  try {
    value = await response.json();
  } catch (reason) {
    if (signal.aborted) throw reason;
    throw new Error('Não foi possível carregar o relatório: resposta incompleta ou inválida.');
  }
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!response.ok) {
    const detail = body?.error;
    throw new Error((typeof detail === 'string' ? detail : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string' ? detail.message : typeof body?.message === 'string' ? body.message : '') || 'Não foi possível carregar o relatório.');
  }
  if (!body || body.dataset !== query.get('dataset') || !Array.isArray(body.rows) || !body.rows.every(row => row !== null && typeof row === 'object' && !Array.isArray(row)) || typeof body.truncated !== 'boolean') {
    throw new Error('Não foi possível carregar o relatório: resposta incompleta ou inválida.');
  }
  return { rows: body.rows as ExportRow[], truncated: body.truncated };
}

type DocumentFormat = 'xlsx' | 'docx' | 'pdf';

function reportDocument(format: DocumentFormat, title: string, columns: ExportColumn[], rows: ExportRow[], value: (row: ExportRow, key: string) => unknown, info: [string, string][], presentation?: ReportPdfPresentation): Blob | Promise<Blob> {
  if (format === 'xlsx') return toXlsx(title, columns, rows, value, info);
  if (format === 'docx') return toDocx(title, columns, rows, value, info);
  return import('./report-pdf').then(({ toPdf }) => toPdf(title, columns, rows, value, info, { presentation }));
}

const projectReportMetrics = [
  { key: 'materiais', label: 'Materiais' },
  { key: 'eventos', label: 'Dinâmicas' },
  { key: 'emprestimos', label: 'Empréstimos' },
  { key: 'registros', label: 'Registros' },
] as const;

type ProjectBrand = NonNullable<ReportPdfPresentation['projectBrand']>;

const ROLE_PROJECT_ID = 'role-da-extensao';
const CONPEEX_2026_PROJECT_ID = 'ad875870-a443-4f47-9c06-5dd0a6178de0';

function projectBrandFor(id: unknown, name: unknown, address: unknown): ProjectBrand | undefined {
  if (typeof name !== 'string') return;
  const title = name.normalize('NFC').trim().toLocaleLowerCase('pt-BR');
  const isRole = id === ROLE_PROJECT_ID && title === 'rolê da extensão';
  const isConpeex = id === CONPEEX_2026_PROJECT_ID &&
    (title === '23º conpeex' || title === '23º conpeex — congresso de pesquisa, ensino e extensão');
  if (!isRole && !isConpeex) return;
  if (isRole && (address == null || (typeof address === 'string' && !address.trim()))) return 'role-da-extensao';
  if (typeof address !== 'string') return;
  let source: URL;
  try { source = new URL(address); } catch { return; }
  if (source.username || source.password) return;
  const path = source.pathname.replace(/\/$/, '');
  if (isRole && source.origin === 'https://proex.ufg.br' &&
      (path === '/p/60194-role-da-extensao' || path === '/p/53193-role-da-extensao')) return 'role-da-extensao';
  if (isConpeex) {
    if (source.origin === 'https://23conpeex.plateia.ufg.br' && !path) return 'conpeex-2026';
    if (source.origin === 'https://ufg.br' && path === '/e/39456-23-congresso-de-pesquisa-ensino-e-extensao-conpeex') return 'conpeex-2026';
  }
}

function projectReportPresentation(row: ExportRow, officialUrl?: unknown): ReportPdfPresentation {
  const projectBrand = projectBrandFor(row.id, row.projeto, officialUrl);
  return {
    projectName: typeof row.projeto === 'string' && row.projeto.trim() ? row.projeto.trim() : 'Projeto selecionado',
    metrics: projectReportMetrics.map(({ key, label }) => ({ label, value: reportNumber(row[key]) })),
    ...(projectBrand ? { projectBrand } : {}),
  };
}

function ReportMasthead({ label, title, description, project = false, projectBrand }: { label: string; title: string; description: string; project?: boolean; projectBrand?: ProjectBrand }) {
  const Heading = project ? 'h3' : 'h2';
  return <header className={styles.masthead}>
    <div className={styles.mastheadCopy}>
      <span className={styles.mastheadLabel}>{label}</span>
      <Heading>{title}</Heading>
      <p>{description}</p>
    </div>
    <div className={styles.brandGroup}>
      <BrandMark variant="light" emphasis="university" className={styles.mastheadBrand} />
      {projectBrand === 'role-da-extensao' && <Image className={styles.projectBrand} src="/brand/role-da-extensao.png" alt="Rolê da Extensão" width={86} height={54} unoptimized/>}
      {projectBrand === 'conpeex-2026' && <Image className={`${styles.projectBrand} ${styles.conpeexBrand}`} src="/brand/conpeex-2026.png" alt="23º CONPEEX" width={94} height={54} unoptimized/>}
    </div>
  </header>;
}

function ReportMetrics({ metrics }: { metrics: readonly Kpi[] }) {
  return <dl className={styles.kpis} aria-label="Indicadores do relatório">
    {metrics.map(({ label, value, detail, tone }) => <div key={label} className={`${styles.kpi} ${tone === 'warn' && (value ?? 0) > 0 ? styles.kpiWarn : ''}`}>
      <dt>{label}</dt><dd>{value === null ? <span className={styles.metricAbsent}>Não informado</span> : formatNumber(value)}</dd>
      {detail && <dd className={styles.metricDetail}>{detail}</dd>}
    </div>)}
  </dl>;
}

export function ProjectReportExports({ projectId, projectName, officialUrl, hasLinkedSpreadsheets }: { projectId: string; projectName?: string; officialUrl?: string; hasLinkedSpreadsheets?: boolean }) {
  const pending = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState<DocumentFormat | 'preview' | null>(null);
  const [preview, setPreview] = useState<{ row: ExportRow; checkedAt: Date } | null>(null);
  const previewRow = preview?.row.id === projectId ? preview.row : null;
  const [error, setError] = useState('');
  const detach = useCallback((element: HTMLElement | null) => {
    if (!element) pending.current?.abort();
  }, []);

  async function save(format: DocumentFormat | 'preview') {
    if (!projectId || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setExporting(format);
    setError('');
    let verified = false;
    try {
      const { rows, truncated } = await requestReport(new URLSearchParams({ dataset: 'projects', projectId }), controller.signal);
      if (controller.signal.aborted) return;
      if (!rows.length) throw new Error('O resumo do projeto está indisponível. Atualize o projeto e confira seu acesso.');
      if (truncated || rows.length !== 1 || rows[0].id !== projectId) throw new Error('A resposta não corresponde ao projeto selecionado.');
      verified = true;
      const [row] = rows;
      const presentation = projectReportPresentation(row, officialUrl);
      const now = new Date();
      setPreview(current => format === 'preview' || current?.row.id === projectId ? { row, checkedAt: now } : current);
      if (format === 'preview') return;
      const project = DATASETS.projects;
      const columns = project.columns.filter(column => project.defaults.includes(column.key));
      const info: [string, string][] = [
        ['Relatório', project.label],
        ['Recorte', presentation.projectName ?? 'Projeto selecionado'],
        ['Período', CURRENT_POSITION_PERIOD],
        ['Linhas', '1'],
        ['Gerado em', now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (Brasília)'],
      ];
      const file = await reportDocument(format, project.label, columns, rows, (record, key) => display('projects', record, key), info, presentation);
      if (controller.signal.aborted) return;
      download(`proex-resumo-projeto-${now.toISOString().slice(0, 10)}.${format}`, file);
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (!verified) setPreview(null);
        setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o resumo.');
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (!controller.signal.aborted) setExporting(null);
      }
    }
  }

  const summary = previewRow ? projectReportPresentation(previewRow, officialUrl) : null;
  const details = previewRow ? DATASETS.projects.columns.filter(column =>
    ['unidade_sigla', 'area_tematica', 'modalidade', 'abrangencia', 'etapa', 'marcos_agenda'].includes(column.key)) : [];
  return <section ref={detach} className={`p-card ${styles.projectReport}`} aria-label="Baixar resumo do projeto">
    <ReportMasthead label="Relatório do projeto" title={summary?.projectName || projectName || 'Resumo do projeto'} description="Ficha e totais da posição atual" project projectBrand={summary ? summary.projectBrand : projectBrandFor(projectId, projectName, officialUrl)}/>
    <div className={styles.projectReportBody}>
      <div className={styles.projectReportActions}>
        <p className={styles.reportHelp}>Para escolher dados, colunas ou datas, abra Relatórios do projeto.</p>
        <button type="button" className="p-button p-button-subtle" aria-controls="project-report-preview" aria-expanded={!!previewRow} disabled={!!exporting}
          onClick={() => previewRow ? setPreview(null) : void save('preview')}><BarChart3 size={16} aria-hidden="true"/>{previewRow ? 'Ocultar prévia' : 'Ver prévia'}</button>
      </div>
      <div className={styles.projectFormats} role="group" aria-label="Formatos do resumo">
        <button type="button" className="p-button p-button-primary" disabled={!!exporting} onClick={() => void save('pdf')}><FileText size={16} aria-hidden="true"/>PDF</button>
        <button type="button" className="p-button p-button-subtle" disabled={!!exporting} onClick={() => void save('xlsx')}><FileSpreadsheet size={16} aria-hidden="true"/>Excel (XLSX)</button>
        <button type="button" className="p-button p-button-subtle" disabled={!!exporting} onClick={() => void save('docx')}><FileText size={16} aria-hidden="true"/>Word (DOCX)</button>
      </div>
      {hasLinkedSpreadsheets && <div className={styles.projectReportActions}>
        <p className={styles.reportHelp}>Para usar no Google Sheets, importe o XLSX em uma planilha que você pode editar.</p>
        <a className="p-button p-button-subtle" href="#project-spreadsheets">Planilhas do projeto</a>
      </div>}
      <div id="project-report-preview" className={styles.projectPreview}>
        {summary && previewRow && preview && <>
          <div className={styles.previewHead}>
            <h4>Prévia do resumo</h4>
            <p>Consultado às {preview.checkedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}, horário de Brasília.</p>
          </div>
          <ReportMetrics metrics={summary.metrics ?? []}/>
          <dl className={styles.projectFacts}>
            {details.map(column => <div key={column.key}><dt>{column.label}</dt><dd>{String(display('projects', previewRow, column.key)) || 'Não informado'}</dd></div>)}
          </dl>
        </>}
      </div>
      {exporting && <p className={styles.reportHelp} role="status">{exporting === 'preview' ? 'Consultando o resumo…' : `Preparando o resumo em ${exporting.toUpperCase()}…`}</p>}
      {error && <p className="p-inline-error" role="alert">{error}</p>}
    </div>
  </section>;
}

export default function ReportsCenter({ userId, projectId, unitId, area, from, to, scopeLabel, available, initialDataset, projectIdentity, canSync = false }: {
  userId: string; projectId: string; unitId: string; area: string; from: string; to: string; scopeLabel: string; available: DatasetId[]; initialDataset?: DatasetId; projectIdentity?: ExportRow; canSync?: boolean;
}) {
  const datasets = ORDER.filter(id => available.includes(id));
  const [dataset, setDataset] = useState<DatasetId>(initialDataset && datasets.includes(initialDataset) ? initialDataset : datasets[0] ?? 'projects');
  const [assetDetails, setAssetDetails] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false), [outflowType, setOutflowType] = useState('all'), [returnState, setReturnState] = useState('all');
  const config = useMemo(() => dataset === 'materials' && assetDetails ? { ...DATASETS.materials, columns: [...DATASETS.materials.columns, ...ASSET_COLUMNS] }
    : dataset === 'outflow_details' && includeNotes ? { ...DATASETS.outflow_details, columns: [...DATASETS.outflow_details.columns, ...OUTFLOW_NOTES] } : DATASETS[dataset], [dataset, assetDetails, includeNotes]);
  const [columns, setColumns] = useState<string[]>(config.defaults);
  const [groupBy, setGroupBy] = useState(config.groups[0]);
  const [measure, setMeasure] = useState('__count__');
  const [searchState, setSearchState] = useState({ userId, value: '' });
  const search = searchState.userId === userId ? searchState.value : '';
  const setSearch = (value: string) => setSearchState({ userId, value });
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [pageSize, setPageSize] = useState(25);
  const queryKey = JSON.stringify([userId, dataset, projectId, unitId, area, from, to, assetDetails, includeNotes, outflowType, returnState]);
  const initialView = { queryKey, focus: '', measurementUnit: '', page: 0 };
  const [view, setView] = useState(initialView);
  if (view.queryKey !== queryKey) setView(initialView);
  const { focus, measurementUnit, page } = view.queryKey === queryKey ? view : initialView;
  const updateView = (changes: Partial<Omit<typeof view, 'queryKey'>>) => setView(current => ({ ...current, ...changes }));
  const [loadedQueryKey, setLoadedQueryKey] = useState('');
  const [loadedRows, setRows] = useState<ExportRow[]>([]), [truncated, setTruncated] = useState(false);
  const [fetching, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<{ key: string; message: string } | null>(null);
  const [exportError, setExportError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const rows = loadedQueryKey === queryKey ? loadedRows : EMPTY_ROWS;
  const loading = fetching || loadedQueryKey !== queryKey;
  const queryFailure = !loading && queryError?.key === queryKey ? queryError.message : '';
  const presetKey = userId ? PRESETS_PREFIX + encodeURIComponent(userId) : '';
  const [presetState, setPresetState] = useState<{ key: string; values: Preset[]; name: string }>({ key: '', values: [], name: '' });
  const presetsReady = Boolean(presetKey) && presetState.key === presetKey;
  const presetName = presetsReady ? presetState.name : '';
  const visiblePresets = presetsReady ? presetState.values.filter(preset => datasets.includes(preset.dataset)) : [];
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [categoryAxisWidth, setCategoryAxisWidth] = useState(150);
  const chartsRef = useRef<HTMLDivElement>(null);
  const reportSearchRef = useRef<HTMLInputElement>(null);
  const reportResultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!presetKey) return;
    const timer = window.setTimeout(() => setPresetState({ key: presetKey, values: readPresets(presetKey), name: '' }), 0);
    return () => window.clearTimeout(timer);
  }, [presetKey]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ dataset });
    if (dataset === 'materials' && assetDetails) query.set('assetDetails', '1');
    if (dataset === 'outflow_details') { query.set('outflowType', outflowType); query.set('returnState', returnState); if (includeNotes) query.set('includeNotes', '1'); }
    if (projectId) query.set('projectId', projectId);
    if (unitId) query.set('unitId', unitId === '__unassigned__' ? '__none__' : unitId);
    if (area) query.set('thematicArea', area);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const start = window.setTimeout(() => setLoading(true), 0);
    requestReport(query, controller.signal)
      .then(body => {
        if (controller.signal.aborted) return;
        window.clearTimeout(start);
        setRows(body.rows);
        setLoadedQueryKey(queryKey);
        setTruncated(body.truncated);
        setQueryError(null);
        setLoading(false);
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        window.clearTimeout(start);
        setRows([]);
        setLoadedQueryKey(queryKey);
        setTruncated(false);
        setQueryError({ key: queryKey, message: reason instanceof Error ? reason.message : 'Não foi possível carregar o relatório.' });
        setLoading(false);
      });
    return () => { window.clearTimeout(start); controller.abort(); };
  }, [dataset, projectId, unitId, area, from, to, queryKey, assetDetails, includeNotes, outflowType, returnState, attempt]);

  function retryReport() {
    reportResultRef.current?.focus();
    setQueryError(null);
    setLoading(true);
    setAttempt(value => value + 1);
  }

  function chooseDataset(id: DatasetId, preset?: Preset) {
    if (!datasets.includes(id)) return;
    const next = DATASETS[id];
    setDataset(id); setAssetDetails(false); setIncludeNotes(false); setOutflowType('all'); setReturnState('all'); setColumns(preset?.columns.filter(key => next.columns.some(column => column.key === key)) ?? next.defaults);
    setGroupBy(preset && next.groups.includes(preset.groupBy) ? preset.groupBy : next.groups[0]);
    setMeasure(preset && (preset.measure === '__count__' || next.columns.some(column => column.key === preset.measure && column.numeric && !column.nonAdditive)) ? preset.measure : '__count__');
    setSearch(preset?.search ?? ''); updateView({ measurementUnit: '', focus: '', page: 0 }); setSort(null);
  }

  const valueOf = (row: ExportRow, key: string) => display(dataset, row, key);
  const numericColumns = config.columns.filter(column => column.numeric && !column.nonAdditive);
  const unitOptions = [...new Set(rows.map(row => String(row.unidade_medida ?? '').trim()).filter(Boolean))].sort();
  const searched = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    const measured = measurementUnit ? rows.filter(row => String(row.unidade_medida ?? '').trim() === measurementUnit) : rows;
    if (!needle) return measured;
    return measured.filter(row => config.columns.some(column => String(display(dataset, row, column.key) ?? '').toLocaleLowerCase('pt-BR').includes(needle)));
  }, [rows, search, config, dataset, measurementUnit]);
  const mixedUnits = ['materials', 'movements', 'outflows', 'outflow_details', 'reviews'].includes(dataset) && quantityTotal(searched, 'quantidade') === null;
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
  const reportProject = projectId && projectIdentity?.id === projectId ? projectIdentity : null;
  const reportProjectName = typeof reportProject?.name === 'string' ? reportProject.name : undefined;
  const reportBrand = projectBrandFor(reportProject?.id, reportProjectName, reportProject?.official_url);
  const exportColumns: Column[] = chosen;
  const stamp = new Date().toISOString().slice(0, 10);
  const fileBase = `proex-${dataset}-${stamp}${truncated ? '-parcial' : ''}`;
  const exportValue = (row: ExportRow, key: string) => { const column = config.columns.find(item => item.key === key); const value = valueOf(row, key); return column?.date ? dateLabel(value) : column?.numeric ? reportNumber(value) : value; };
  const positionOnly = dataset === 'projects' || dataset === 'materials';
  let periodLabel = 'Todo o período';
  if (positionOnly) periodLabel = CURRENT_POSITION_PERIOD;
  else if (from && to) periodLabel = `${dateLabel(from)} a ${dateLabel(to)}`;
  else if (from) periodLabel = `A partir de ${dateLabel(from)}`;
  else if (to) periodLabel = `Até ${dateLabel(to)}`;
  const info: [string, string][] = [['Relatório', config.label], ['Recorte', scopeLabel || 'Todos os projetos que você pode consultar'], ['Período', periodLabel], ['Unidade de medida', measurementUnit || 'Todas, separadas em cada registro'], ['Busca', search || '—'], ['Destaque', focus ? `${config.columns.find(column => column.key === groupBy)?.label ?? 'Mês'}: ${focus}` : '—'], ['Linhas', String(sorted.length)], ['Gerado em', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (Brasília)'], ['Compartilhamento', 'Recorte das suas permissões. Revise os textos livres antes de compartilhar.']];
  if (dataset === 'outflow_details') info.push(['Tipo de saída', outflowType === 'all' ? 'Todos' : LABELS.tipo[outflowType]], ['Devolução', returnState === 'all' ? 'Todas' : LABELS.situacao_retorno[returnState]],
    ['Referências', 'Unidade e saldo atuais do cadastro. Saldos repetidos por registro não devem ser somados. Uma unidade individual por retirada de equipamento; retornos não criam nova saída.'], ['Datas ausentes', 'Sem filtro de período é possível consultar retiradas sem data efetiva; previsões não substituem o histórico.'],
    ['Operador', 'Nome atual do perfil, somente para quem tem permissão operacional vigente; não identifica o beneficiário.'], ['Textos livres', includeNotes ? 'Consulta opcional sujeita à permissão operacional atual; confira as colunas antes de compartilhar.' : 'Não consultados nem exportados.'],
    ['Cobertura', truncated ? 'Consulta parcial por limite de linhas ou tamanho. Refine os filtros antes de considerar o relatório completo.' : 'Registros do recorte retornados pela consulta.']);

  async function exportDocument(format: 'pdf' | 'docx') {
    if (exporting || loading || !chosen.length || !sorted.length) return;
    setExporting(format); setExportError(null);
    try {
      const blob = await reportDocument(format, config.label, exportColumns, sorted, exportValue, info, reportProjectName ? { projectName: reportProjectName, projectBrand: reportBrand } : undefined);
      download(`${fileBase}.${format}`, blob);
    } catch (cause) {
      setExportError({ key: queryKey, message: cause instanceof Error ? cause.message : 'Não foi possível gerar o documento. Tente novamente.' });
    } finally { setExporting(null); }
  }

  function toggleColumn(key: string) { setColumns(current => current.includes(key) ? current.filter(item => item !== key) : config.columns.map(column => column.key).filter(item => item === key || current.includes(item))); }
  function savePreset() {
    const name = presetName.trim().slice(0, 60);
    if (!presetsReady || !name) return;
    const values = [{ name, dataset, columns, groupBy, measure, search }, ...presetState.values.filter(preset => preset.name !== name)].slice(0, 20);
    setPresetState({ key: presetKey, values, name: '' });
    writePresets(presetKey, values);
  }
  function removePreset(name: string) {
    if (!presetsReady) return;
    const values = presetState.values.filter(preset => preset.name !== name);
    setPresetState({ ...presetState, values });
    writePresets(presetKey, values);
  }
  function print() {
    if (loading || !chosen.length || !sorted.length) return;
    setExportError(null);
    const popup = window.open('', '_blank', 'width=1100,height=800');
    if (!popup) {
      setExportError({ key: queryKey, message: 'O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente de novo.' });
      return;
    }
    const charts = chartsRef.current?.querySelectorAll('svg.recharts-surface') ?? [];
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));
    popup.opener = null;
    const brandBase = escape(window.location.origin);
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escape(config.label)} — PROEX/UFG</title><style>
      :root{--rc-1:#2a78d6;--rc-2:#eb6834;--rc-grid:#e6e1ec;--rc-axis:#6b6275}body{font:12px/1.5 system-ui,sans-serif;color:#231b2b;margin:28px}h1{font-size:20px;margin:0 0 4px;color:#54216c}dl{display:grid;grid-template-columns:140px 1fr;gap:2px 12px;margin:12px 0 18px}dt{color:#6b6275}dd{margin:0}.k{display:flex;gap:10px;margin-bottom:16px}.k div{border:1px solid #ddd3e6;border-radius:8px;padding:8px 12px;min-width:120px}.k b{display:block;font-size:20px;color:#54216c}.c{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px}.c svg{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#54216c;color:#fff;text-align:left;padding:5px}td{border-bottom:1px solid #e6e1ec;padding:4px 5px}td.n{text-align:right;font-variant-numeric:tabular-nums}@media print{body{margin:10mm}} .masthead{display:flex;justify-content:space-between;align-items:center;gap:14px;border-bottom:3px solid #ffaa3d;margin:0 0 14px;padding-bottom:12px}.masthead p{margin:0}.logos{display:flex;gap:10px;align-items:center;flex-shrink:0}.logos img{width:70px;height:40px;object-fit:contain;filter:brightness(0)}.k{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}.k div{min-width:0;break-inside:avoid}thead{display:table-header-group}tr{break-inside:avoid}th,td{overflow-wrap:anywhere}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}</style></head><body>
      <header class="masthead"><div><h1>${escape(config.label)}</h1><p>Pró-Reitoria de Extensão da UFG</p></div><div class="logos"><img src="${brandBase}/brand/proex.png" alt="PROEX"><img src="${brandBase}/brand/ufg-white.png" alt="Universidade Federal de Goiás"></div></header><dl>${info.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>
      <div class="k">${kpis.map(kpi => `<div>${escape(kpi.label)}<b>${formatNumber(kpi.value)}</b></div>`).join('')}</div>
      ${focus && charts.length ? '<p>A distribuição por grupo compara todos os grupos do recorte. Os demais dados refletem o grupo selecionado.</p>' : ''}
      <div class="c">${[...charts].map(svg => svg.outerHTML).join('')}</div>
      <table><thead><tr>${exportColumns.map(column => `<th>${escape(column.label)}</th>`).join('')}</tr></thead><tbody>${sorted.slice(0, 2000).map(row => `<tr>${exportColumns.map(column => `<td${column.numeric ? ' class="n"' : ''}>${escape(exportValue(row, column.key))}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${sorted.length > 2000 ? '<p>Impressão limitada às primeiras 2.000 linhas. Use a exportação em planilha para o conjunto completo.</p>' : ''}
      <script>window.addEventListener('load',function(){print()},{once:true})</script></body></html>`);
    popup.document.close();
  }

  if (!datasets.length) return null;
  const groupLabel = groupBy === 'mes' ? 'Mês' : config.columns.find(column => column.key === groupBy)?.label ?? groupBy;
  const focusLabel = groupBy === 'mes' && /^\d{4}-\d{2}$/.test(focus) ? monthLabel(focus) : focus;
  const setGroupFocus = (value: string) => updateView({ focus: value, page: 0 });
  const categoryLabelLimit = Math.floor((categoryAxisWidth - 10) / 6);
  const chartMeasureLabel = effectiveMeasure === '__count__' ? 'Total' : `Soma de ${measureLabel}`;
  const monthColumns = config.series ?? [{ key: 'value', label: chartMeasureLabel }];
  const sheetTab = SHEET_TAB_BY_DATASET[dataset];
  const Icon = config.icon;
  const activeOptions = [assetDetails ? 'metadados patrimoniais' : '', includeNotes ? 'textos livres' : '', outflowType !== 'all' ? LABELS.tipo[outflowType] : '', returnState !== 'all' ? LABELS.situacao_retorno[returnState] : '', measurementUnit].filter(Boolean);
  return <section className={styles.root} aria-label="Central de relatórios">
    <ReportMasthead label="Central de relatórios" title={config.label} description={scopeLabel || 'Escolha o assunto e confira os dados antes de exportar.'} projectBrand={reportBrand}/>

    <label className={`p-field ${styles.subject}`}><span>Assunto do relatório</span><select value={dataset} onChange={event => chooseDataset(event.target.value as DatasetId)}>{datasets.map(id => <option key={id} value={id}>{DATASETS[id].label}</option>)}</select></label>

    <div className={styles.primaryControls}>
      <label className={`p-field ${styles.search}`}><span>Buscar nas linhas</span><span className={styles.searchBox}><Search size={15} /><input ref={reportSearchRef} value={search} onChange={event => { setSearch(event.target.value); updateView({ page: 0 }); }} placeholder="Nome, material, título, observação…" />{search && <button type="button" aria-label="Limpar busca" onClick={() => { setSearch(''); updateView({ page: 0 }); }}><X size={14} /></button>}</span></label>
    </div>
    <details className={styles.options}><summary>Ajustar recorte e colunas <span>{chosen.length} colunas · {visiblePresets.length} modelos</span>{activeOptions.length > 0 && <small>{activeOptions.join(' · ')}</small>}</summary><div className={styles.optionsBody}>
    {dataset === 'materials' && <label className="p-form-help"><input type="checkbox" checked={assetDetails} onChange={event => { setAssetDetails(event.target.checked); setColumns(DATASETS.materials.defaults); setRows([]); setMeasure('__count__'); }}/>{' '}Consultar metadados patrimoniais privados (somente projetos com permissão vigente de inventário). A referência de responsável, processo e valor documentado só entra na exportação ao escolher essas colunas.</label>}
    {dataset === 'outflow_details' && <div className="space-y-3"><p className="p-form-help">A ação aparece quando foi vinculada no registro. O operador é quem registrou a saída, com nome atual do perfil; beneficiários e contatos não são consultados. Saldo e unidade são os atuais do cadastro.</p><label className="p-form-help"><input type="checkbox" checked={includeNotes} onChange={event => { setIncludeNotes(event.target.checked); setColumns(DATASETS.outflow_details.defaults); setRows([]); setMeasure('__count__'); }}/>{' '}Disponibilizar motivos, observações e condições com permissão operacional vigente (textos livres podem conter dados pessoais). Selecione essas colunas e revise seu conteúdo antes de exportar.</label></div>}
    <div className={styles.controls}>
      {dataset === 'outflow_details' && <><label className="p-field"><span>Tipo de saída</span><select value={outflowType} onChange={event => setOutflowType(event.target.value)}><option value="all">Todas as saídas</option>{['distribute', 'redeem', 'loan'].map(type => <option value={type} key={type}>{LABELS.tipo[type]}</option>)}</select></label><label className="p-field"><span>Situação da devolução</span><select value={returnState} onChange={event => setReturnState(event.target.value)}><option value="all">Todas as situações</option>{['not_applicable', 'out', 'returned'].map(state => <option value={state} key={state}>{LABELS.situacao_retorno[state]}</option>)}</select></label></>}
      <label className="p-field"><span>Agrupar gráfico por</span><select value={groupBy} onChange={event => { setGroupBy(event.target.value); updateView({ focus: '', page: 0 }); }}>{config.groups.map(key => <option key={key} value={key}>{key === 'mes' ? 'Mês' : config.columns.find(column => column.key === key)?.label}</option>)}</select></label>
      <label className="p-field"><span>Medida</span><select value={effectiveMeasure} onChange={event => setMeasure(event.target.value)}><option value="__count__">Quantidade de {dataset === 'movements' ? 'movimentações' : 'linhas'}</option>{numericColumns.map(column => <option key={column.key} value={column.key} disabled={mixedUnits && PHYSICAL_MEASURES.includes(column.key)}>Soma de {column.label.toLowerCase()}</option>)}</select></label>
      {unitOptions.length > 0 && <label className="p-field"><span>Unidade de medida</span><select value={measurementUnit} onChange={event => updateView({ measurementUnit: event.target.value, focus: '', page: 0 })}><option value="">Todas as medidas</option>{unitOptions.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label>}
      <details className={styles.columns}>
        <summary><Columns3 size={16} />Colunas ({chosen.length}/{config.columns.length})</summary>
        <div>
          <div className={styles.columnActions}><button type="button" onClick={() => setColumns(config.columns.map(column => column.key))}>Todas</button><button type="button" onClick={() => setColumns(config.defaults)}>Padrão</button><button type="button" onClick={() => setColumns([])}>Nenhuma</button></div>
          {config.columns.map(column => <label key={column.key}><input type="checkbox" checked={columns.includes(column.key)} onChange={() => toggleColumn(column.key)} />{column.label}</label>)}
        </div>
      </details>
    </div>
    <div className={styles.presets}>
      <span><Save size={14} />Modelos salvos</span>
      {visiblePresets.length ? visiblePresets.map(preset => <span key={preset.name} className={styles.preset}><button type="button" onClick={() => chooseDataset(preset.dataset, preset)} title={`${DATASETS[preset.dataset]?.label}`}>{preset.name}</button><button type="button" aria-label={`Excluir modelo ${preset.name}`} onClick={() => removePreset(preset.name)}><Trash2 size={13} /></button></span>) : <small>Nenhum ainda. Salve a combinação atual de assunto, colunas e agrupamento.</small>}
      <form onSubmit={event => { event.preventDefault(); savePreset(); }}><input value={presetName} disabled={!presetsReady} onChange={event => setPresetState({ ...presetState, name: event.target.value })} placeholder="Nome do modelo" aria-label="Nome do modelo" maxLength={60} /><button type="submit" className="p-button p-button-subtle" disabled={!presetsReady || !presetName.trim()}>Salvar</button></form>
    </div>

    </div></details>
    {canSync && <SheetShortcuts canSync={canSync} userId={userId} context="reports" projectScoped={Boolean(projectId)} tabKeys={sheetTab ? [sheetTab] : []}/>}
    {mixedUnits && <p className="p-form-help" role="status">Há medidas físicas diferentes neste recorte. Selecione uma unidade de medida para somar quantidades; os gráficos mostram contagens de registros.</p>}

    {includeNotes && <p className="p-form-help" role="status">Textos livres ativos: podem conter dados pessoais. Revise as colunas escolhidas antes de exportar.</p>}
    <div className={styles.summary} ref={reportResultRef} tabIndex={-1} role="group" aria-label="Resultado da consulta">
      <span className={styles.summaryIcon}><Icon size={20} /></span>
      <p role="status"><strong>{config.label}</strong> · {loading ? 'carregando…' : queryFailure ? 'consulta indisponível' : `${formatNumber(filtered.length)} ${filtered.length === 1 ? 'linha' : 'linhas'}`}{scopeLabel ? ` · ${scopeLabel}` : ''}{positionOnly || from || to ? ` · ${periodLabel}` : ''}</p>
      {focus && <button type="button" className={styles.focusChip} aria-label={`Limpar filtro de grupo: ${focusLabel}`} onClick={event => { setGroupFocus(''); if (event.detail === 0) reportSearchRef.current?.focus(); }}>{groupLabel}: {focusLabel}<X size={13} aria-hidden="true" /></button>}
      {!loading && truncated && <small className={styles.warn}>{dataset === 'outflow_details' ? 'Consulta parcial: limite de 5.000 linhas ou 3 MiB. Refine o recorte para consultar e exportar tudo.' : 'Mostrando as primeiras 5.000 linhas. Refine o recorte para ver tudo.'}</small>}
    </div>

    {!loading && filtered.length > 0 && <ReportMetrics metrics={kpis}/>}

    <div role="alert">{queryFailure && <p className="p-notice p-notice-error">{queryFailure}</p>}</div>
    {queryFailure && <button type="button" className="p-button p-button-subtle" onClick={retryReport}><RefreshCw size={16} aria-hidden="true" />Tentar carregar relatório novamente</button>}
    {loading ? <div className={styles.loading}><LoaderCircle className="p-spin" size={22} aria-hidden="true" />Carregando dados…</div> : queryFailure ? null : !rows.length ? <div className={styles.empty}><FileText size={22} aria-hidden="true" /><strong>Nada para mostrar neste recorte</strong><span>Altere os filtros, o período ou escolha outro assunto.</span></div> : <>
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
            return <td key={column.key} className={column.numeric ? styles.numeric : ''}>{tone ? <span className={`${styles.badge} ${tone}`}>{String(value)}</span> : column.date ? dateLabel(value) : column.numeric ? formatNumber(reportNumber(value)) : String(value ?? '') || '—'}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <div className={styles.pager}>
        <span>{sorted.length ? `${current * pageSize + 1}–${Math.min(sorted.length, (current + 1) * pageSize)} de ${formatNumber(sorted.length)}` : 'Nenhuma linha com esta busca'}</span>
        <label>Por página <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); updateView({ page: 0 }); }}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <button type="button" className="p-button p-button-subtle" disabled={current === 0} onClick={() => updateView({ page: current - 1 })}>Anterior</button>
        <button type="button" className="p-button p-button-subtle" disabled={current >= pages - 1} onClick={() => updateView({ page: current + 1 })}>Próxima</button>
      </div>
    </>}
    <details className={styles.exportOptions}><summary>Exportar linhas deste recorte</summary>
      <div className={styles.exportBar} role="group" aria-label="Exportar relatório">
        <button type="button" className="p-button p-button-primary" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={() => download(`${fileBase}.xlsx`, toXlsx(config.label, exportColumns, sorted, exportValue, info))}><FileSpreadsheet size={16} />Excel</button>
        <button type="button" className="p-button p-button-subtle" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={() => void exportDocument('pdf')}>{exporting === 'pdf' ? <LoaderCircle size={16} className="animate-spin" /> : <FileText size={16} />}PDF</button>
        <button type="button" className="p-button p-button-subtle" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={() => void exportDocument('docx')}>{exporting === 'docx' ? <LoaderCircle size={16} className="animate-spin" /> : <FileText size={16} />}Word</button>
        <button type="button" className="p-button p-button-subtle" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={() => download(`${fileBase}.json`, toJson({ relatorio: config.label, filtros: Object.fromEntries(info) }, exportColumns, sorted, exportValue))}><FileJson size={16} />JSON</button>
        <button type="button" className="p-button p-button-subtle" disabled={loading || !chosen.length || !sorted.length || !!exporting} onClick={print}><Printer size={16} />Imprimir</button>
      </div>
      <div role="alert">{exportError?.key === queryKey && <p className="p-notice p-notice-error">{exportError.message}</p>}</div>
    </details>
    {!loading && breakdown.length > 0 && <>
      <div className={styles.charts} ref={chartsRef}>
        <figure className={styles.chart}>
          <figcaption><strong>{effectiveMeasure === '__count__' ? 'Distribuição' : `Soma de ${measureLabel}`} por {groupLabel.toLowerCase()}</strong><small>Selecione um grupo ou toque em uma barra para filtrar as linhas da tabela.</small></figcaption>
          <label className={`p-field ${styles.chartGroup}`}><span>Filtrar tabela por grupo</span>
            <select value={focus} onChange={event => setGroupFocus(event.target.value)}>
              <option value="">Todos os grupos</option>
              {focus && !breakdown.some(item => item.raw === focus) && <option value={focus}>{focusLabel}</option>}
              {breakdown.filter(item => item.raw).map(item => <option key={item.raw} value={item.raw}>{item.name}</option>)}
            </select>
          </label>
          {breakdown.some(item => !item.raw) && <p className={styles.chartHelp}>“Outros” reúne os grupos menores. Esses grupos aparecem só no gráfico, sem seleção individual.</p>}
          <div style={{ height: Math.max(180, breakdown.length * 34 + 40) }} role="img" aria-label={`Gráfico de barras: ${breakdown.map(item => `${item.name} ${formatNumber(item.value)}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%" onResize={width => setCategoryAxisWidth(Math.max(70, Math.min(150, Math.floor(width / 3))))}>
              <BarChart data={breakdown} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }} barCategoryGap={6}>
                <CartesianGrid horizontal={false} stroke="var(--rc-grid)" />
                <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--rc-axis)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={categoryAxisWidth} tick={{ fill: 'var(--rc-axis)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value: string) => value.length > categoryLabelLimit ? `${value.slice(0, categoryLabelLimit - 1)}…` : value} />
                <Tooltip cursor={{ fill: 'var(--rc-hover)' }} content={<ChartTooltip unit={measureLabel} />} />
                <Bar dataKey="value" name={chartMeasureLabel} fill="var(--rc-1)" radius={[0, 4, 4, 0]} maxBarSize={22} cursor="pointer" label={{ position: 'right', fill: 'var(--rc-axis)', fontSize: 11, formatter: (value: unknown) => formatNumber(Number(value) || 0) }}
                  onClick={(entry: { payload?: { raw?: string } }) => { const raw = entry?.payload?.raw; if (raw) setGroupFocus(focus === raw ? '' : raw); }} />
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
                </> : <Bar dataKey="value" name={chartMeasureLabel} fill="var(--rc-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className={styles.monthValues}>
            <summary>Ver valores por mês</summary>
            <table>
              <caption className="sr-only">Valores da evolução por mês</caption>
              <thead><tr><th scope="col">Mês</th>{monthColumns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
              <tbody>{timeline.map(point => <tr key={point.name}><th scope="row">{point.name}</th>{monthColumns.map(column => <td key={column.key}>{formatNumber(reportNumber(point[column.key]))}</td>)}</tr>)}</tbody>
            </table>
          </details>
        </figure>}
      </div>

    </>}
  </section>;
}
