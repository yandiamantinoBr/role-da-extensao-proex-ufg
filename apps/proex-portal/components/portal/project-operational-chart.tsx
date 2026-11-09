'use client';
import { useState } from 'react';
import { ArrowUpRight, BarChart3, CalendarDays, CheckCircle2, CircleDot, Clock3, Package, TriangleAlert } from 'lucide-react';
import type { Row } from '@/lib/database';
import styles from './project-operational-chart.module.css';
type Props = { projectId?: string; schedule: Row[] | null; items?: Row[] | null; loans?: Row[] | null; now: number; variant?: 'project' | 'overview'; title?: string };
type Group = { id: string; label: string; rows: Row[]; tone: string; Icon: typeof Package };
type Dataset = { id: string; label: string; unit: string; rows: Row[]; groups: Group[]; target?: 'materials' | 'loans' };
function loanLate(loan: Row, now: number) { const end = loan.ends_at ? new Date(loan.ends_at).getTime() : NaN; return loan.status === 'out' && Number.isFinite(end) && end < now; }
/** Counts records, never mixed stock units or an inferred completion percentage. */
export function projectOperationalDatasets({ schedule, items, loans, now, variant = 'project' }: Props): Dataset[] {
 const datasets: Dataset[] = [];
 if (schedule) datasets.push({ id: 'schedule', label: 'Atividades', unit: 'atividades cadastradas', rows: schedule, groups: [
  { id: 'planned', label: 'Planejadas', rows: schedule.filter(row => row.status === 'planned'), tone: 'brand', Icon: CalendarDays },
  { id: 'completed', label: 'Realizadas', rows: schedule.filter(row => row.status === 'completed'), tone: 'success', Icon: CheckCircle2 },
  { id: 'cancelled', label: 'Canceladas', rows: schedule.filter(row => row.status === 'cancelled'), tone: 'muted', Icon: CircleDot },
 ] });
 if (items) datasets.push({ id: 'materials', label: 'Materiais', unit: 'tipos de material cadastrados', rows: items, target: 'materials', groups: [
  { id: 'unavailable', label: 'Sem disponibilidade', rows: items.filter(row => row.condition === 'active' && typeof row.available === 'number' && row.available <= 0), tone: 'danger', Icon: TriangleAlert },
  { id: 'low', label: 'Saldo no mínimo', rows: items.filter(row => row.condition === 'active' && typeof row.available === 'number' && row.available > 0 && row.available <= Number(row.low_stock || 0)), tone: 'brand', Icon: TriangleAlert },
  { id: 'available', label: 'Acima do mínimo', rows: items.filter(row => row.condition === 'active' && typeof row.available === 'number' && row.available > Number(row.low_stock || 0)), tone: 'success', Icon: Package },
  { id: 'other', label: 'Outras condições', rows: items.filter(row => row.condition !== 'active' || typeof row.available !== 'number'), tone: 'muted', Icon: CircleDot },
 ] });
 if (loans) datasets.push({ id: 'loans', label: 'Empréstimos', unit: variant === 'overview' ? 'empréstimos nos projetos selecionados' : 'empréstimos carregados · até 100 mais recentes', rows: loans, target: 'loans', groups: [
  { id: 'late', label: 'Em atraso', rows: loans.filter(row => loanLate(row, now)), tone: 'danger', Icon: TriangleAlert },
  { id: 'current', label: 'Em andamento', rows: loans.filter(row => row.status === 'reserved' || row.status === 'out' && !loanLate(row, now)), tone: 'brand', Icon: Clock3 },
  { id: 'returned', label: 'Devolvidos', rows: loans.filter(row => row.status === 'returned'), tone: 'success', Icon: CheckCircle2 },
  { id: 'cancelled', label: 'Cancelados', rows: loans.filter(row => row.status === 'cancelled'), tone: 'muted', Icon: CircleDot },
 ] });
 return datasets;
}
export default function ProjectOperationalChart(props: Props) {
 const datasets = projectOperationalDatasets(props);
 const overview = props.variant === 'overview';
 const [selection, setSelection] = useState({ dataset: datasets[0]?.id ?? 'schedule', group: '' });
 const dataset = datasets.find(item => item.id === selection.dataset) ?? datasets[0];
 if (!dataset) return null;
 // In the Início the rows come from several projects, so each link keeps its own project.
 const rowProject = (row: Row) => String((overview ? row.project_id ?? row.projectId : props.projectId) ?? '');
 const listHref = `/?module=${dataset.target}${props.projectId ? `&project=${encodeURIComponent(props.projectId)}` : ''}`;
 const selected = dataset.groups.find(group => group.id === selection.group);
 const rows = selected ? selected.rows : dataset.rows;
 const total = dataset.rows.length;
 const detailHref = (row: Row) => dataset.target ? `/?module=${dataset.target}&project=${encodeURIComponent(rowProject(row))}&${dataset.target === 'materials' ? 'itemId' : 'loanId'}=${encodeURIComponent(row.id)}` : '#project-timeline';
 return <section className={`p-card ${styles.chart}`} aria-label={overview ? 'Panorama visual dos seus projetos' : 'Panorama visual do projeto'}>
  <div className={styles.heading}><div><h3><BarChart3 size={18} aria-hidden="true"/>{props.title ?? (overview ? 'Panorama dos seus projetos' : 'Panorama do projeto')}</h3><p>Toque em uma barra para conferir os registros.</p></div></div>
  {datasets.length > 1 && <div className={styles.tabs} role="group" aria-label="Dados do panorama">{datasets.map(item => <button type="button" key={item.id} aria-pressed={item.id === dataset.id} onClick={() => setSelection({ dataset: item.id, group: '' })}>{item.label}<span>{item.rows.length}</span></button>)}</div>}
  <p className={styles.caption}>{total} {dataset.unit}{dataset.id === 'materials' ? ' · saldo disponível agora' : ''}.</p>
  {total > 0 ? <div className={styles.body}>
   <div className={styles.visual}>
    {/* Barra empilhada para toque e mouse; os botões da legenda abaixo dão o mesmo controle ao teclado e ao leitor de tela. */}
    <div className={styles.stack} aria-hidden="true" data-has-selection={selected ? 'true' : 'false'}>{dataset.groups.filter(group => group.rows.length > 0).map(({ id, label, rows, tone }) => <span key={id} data-tone={tone} data-selected={selected?.id === id ? 'true' : 'false'} style={{ flexGrow: rows.length }} title={`${label}: ${rows.length} de ${total}`} onClick={() => setSelection({ dataset: dataset.id, group: selected?.id === id ? '' : id })}/>)}</div>
    <div className={styles.bars} role="group" aria-label={`Distribuição de ${dataset.label.toLocaleLowerCase('pt-BR')}`}>
     {dataset.groups.map(({ id, label, rows, tone, Icon }) => <button key={id} type="button" data-tone={tone} aria-pressed={selected?.id === id} title={`${label}: ${rows.length} de ${total}`} onClick={() => setSelection({ dataset: dataset.id, group: selected?.id === id ? '' : id })}><span className={styles.barLabel}><Icon size={16} aria-hidden="true"/>{label}<strong>{rows.length}</strong></span><span className={styles.share} aria-hidden="true">{Math.round(rows.length / total * 100)}%</span></button>)}
    </div>
   </div>
   <div className={styles.records} aria-live="polite" data-has-selection={selected ? 'true' : 'false'}><div className={styles.recordsHeading}><strong>{selected?.label ?? 'Todos os registros'} <span>({rows.length})</span></strong>{selected && <button type="button" onClick={() => setSelection({ dataset: dataset.id, group: '' })}>Ver todos</button>}</div>{rows.length ? <ul>{rows.slice(0, 5).map(row => <li key={row.id}><a href={detailHref(row)}>{row.title || row.name || row.item_name || row.action_name}<ArrowUpRight size={15} aria-hidden="true"/></a></li>)}</ul> : <p>Nenhum registro nesta situação.</p>}{rows.length > 5 && <p>Exibindo 5 de {rows.length}. {dataset.target ? <a href={listHref}>Abrir todos</a> : <a href="#project-timeline">Ver linha do tempo</a>}</p>}</div>
  </div> : <p className={styles.empty}>{dataset.id === 'loans' ? 'Nenhum registro carregado.' : 'Nenhum registro nesta área.'} {dataset.id === 'schedule' ? 'Cadastre uma atividade na linha do tempo abaixo.' : 'Os registros cadastrados aparecerão aqui.'}</p>}
 </section>;
}
