'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Boxes, CalendarDays, FileText, ListChecks, RefreshCw, Sparkles, TriangleAlert, Truck, type LucideIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateField from './date-field';
import styles from './activity-panel.module.css';

type ActivityType = 'materials' | 'loans' | 'demands' | 'agenda' | 'records';
type ActivityEvent = { id: string; type: ActivityType; action: string; title: string; detail: string; at: string; day: string; projectId: string | null; projectName: string; actorId: string | null; actorName: string; viaRole: boolean; href: string | null; quantity: number | null };
type Feed = { range: { from: string; to: string; days: string[] }; types: ActivityType[]; events: ActivityEvent[]; truncated: boolean; people: { id: string; name: string }[]; loansNow: { active: number; late: number } | null; summary: { days: { day: string; materials: number; demandsOpened: number; demandsCompleted: number; agenda: number }[]; stock: { name: string; projectId: string; href: string; entradas: number; saidas: number }[] } };
type Props = { projects: { id: string; name: string }[]; initialProjectId?: string };
type Period = 'today' | '7' | '30' | 'month' | 'custom';

const TYPES: { id: ActivityType; label: string; Icon: LucideIcon }[] = [
  { id: 'materials', label: 'Estoque', Icon: Boxes }, { id: 'loans', label: 'Empréstimos', Icon: Truck },
  { id: 'demands', label: 'Demandas', Icon: ListChecks }, { id: 'agenda', label: 'Agenda', Icon: CalendarDays },
  { id: 'records', label: 'Registros', Icon: FileText },
];
const PERIODS: { id: Period; label: string }[] = [{ id: 'today', label: 'Hoje' }, { id: '7', label: '7 dias' }, { id: '30', label: '30 dias' }, { id: 'month', label: 'Este mês' }, { id: 'custom', label: 'Escolher datas' }];
const DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const SHORT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' });
const civilDate = (day: string) => new Date(`${day}T12:00:00Z`);
const capital = (text: string) => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
function today(): string { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); }
function shift(day: string, delta: number): string { const date = civilDate(day); date.setUTCDate(date.getUTCDate() + delta); return date.toISOString().slice(0, 10); }
export function periodRange(period: Period, now = today()): { from: string; to: string } {
  if (period === 'today') return { from: now, to: now };
  if (period === '7') return { from: shift(now, -6), to: now };
  if (period === 'month') return { from: `${now.slice(0, 8)}01`, to: now };
  return { from: shift(now, -29), to: now };
}

/** Clicar num gráfico navega como um link do portal (sem recarregar a página). */
function follow(container: HTMLElement | null, href: string | null) {
  if (!href || !container) return;
  const anchor = document.createElement('a');
  anchor.href = href; anchor.hidden = true;
  container.appendChild(anchor); anchor.click(); anchor.remove();
}
function projectLink(module: string, projectId: string) { return projectId ? `/?module=${module}&project=${encodeURIComponent(projectId)}` : `/?module=${module}`; }

export default function ActivityPanel({ projects, initialProjectId = '' }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState<Period>('30');
  const [custom, setCustom] = useState(() => periodRange('30'));
  const [projectId, setProjectId] = useState(initialProjectId);
  const [person, setPerson] = useState('');
  const [types, setTypes] = useState<ActivityType[]>(TYPES.map(type => type.id));
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; feed?: Feed; error?: string } | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = root.current; if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 560));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const range = period === 'custom' ? custom : periodRange(period);
  const key = JSON.stringify([range.from, range.to, projectId, person, types, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: range.from, to: range.to, types: types.join(',') });
    if (projectId) params.set('projectId', projectId);
    if (person) params.set('person', person);
    fetch(`/api/activity?${params}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json().catch(() => ({})) as { error?: unknown }; if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Não foi possível carregar o histórico.'); return body as Feed; })
      .then(feed => { if (!controller.signal.aborted) setState({ key, feed }); })
      .catch(error => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : 'Não foi possível carregar o histórico.' }); });
    return () => controller.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = state?.key === key ? state : null, feed = current?.feed, loading = !current;
  // Enquanto atualiza, mantém o resultado anterior do mesmo usuário na tela, marcado como "atualizando".
  const shown = feed ?? state?.feed;
  const events = useMemo(() => shown?.events ?? [], [shown]);
  const days = useMemo(() => shown?.range.days ?? [], [shown]);
  const byDay = useMemo(() => { const map = new Map<string, ActivityEvent[]>(); for (const event of events) map.set(event.day, [...(map.get(event.day) ?? []), event]); return map; }, [events]);
  const summaryDays = useMemo(() => shown?.summary.days ?? [], [shown]);
  const demandSeries = useMemo(() => summaryDays.map(row => ({ day: row.day, label: SHORT.format(civilDate(row.day)), criadas: row.demandsOpened, concluidas: row.demandsCompleted })), [summaryDays]);
  const agendaSeries = useMemo(() => summaryDays.map(row => ({ day: row.day, label: SHORT.format(civilDate(row.day)), atividades: row.agenda })), [summaryDays]);
  const stock = shown?.summary.stock ?? [];
  const sum = (key: 'materials' | 'demandsOpened' | 'demandsCompleted' | 'agenda') => summaryDays.reduce((total, row) => total + row[key], 0);
  const totals = { movements: sum('materials'), demandsOpened: sum('demandsOpened'), demandsDone: sum('demandsCompleted'), agenda: sum('agenda') };
  const months = useMemo(() => { const seen = new Map<string, number>(); for (const event of events) seen.set(event.day.slice(0, 7), (seen.get(event.day.slice(0, 7)) ?? 0) + 1); return [...seen]; }, [events]);
  const firstDayOf = (month: string) => [...byDay.keys()].filter(day => day.startsWith(month)).sort().at(-1);
  const toggle = (type: ActivityType) => setTypes(list => list.includes(type) ? (list.length > 1 ? list.filter(item => item !== type) : list) : [...list, type]);
  const showDemands = types.includes('demands') && demandSeries.some(row => row.criadas || row.concluidas);
  const showStock = types.includes('materials') && stock.length > 0;
  const showAgenda = types.includes('agenda') && agendaSeries.some(row => row.atividades);

  return <div className={styles.panel} ref={root}>
    <section className={styles.filters} aria-label="Filtros do histórico">
      <div className={styles.periods} role="group" aria-label="Período">{PERIODS.map(item => <button key={item.id} type="button" aria-pressed={period === item.id} onClick={() => { if (item.id === 'custom') setCustom(range); setPeriod(item.id); }}>{item.label}</button>)}</div>
      {period === 'custom' && <div className={styles.dates}><label className="p-field"><span>De</span><DateField value={custom.from} max={custom.to} onValueChange={from => setCustom(value => ({ ...value, from: from || value.from }))}/></label><label className="p-field"><span>Até</span><DateField value={custom.to} min={custom.from} onValueChange={to => setCustom(value => ({ ...value, to: to || value.to }))}/></label></div>}
      <div className={styles.selects}>
        <label className="p-field"><span>Projeto</span><select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Todos os projetos</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="p-field"><span>Pessoa</span><select value={person} onChange={event => setPerson(event.target.value)}><option value="">Todas as pessoas</option>{(shown?.people ?? []).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      </div>
      <div className={styles.types} role="group" aria-label="Tipos de registro">{TYPES.map(({ id, label, Icon }) => <button key={id} type="button" data-type={id} aria-pressed={types.includes(id)} onClick={() => toggle(id)}><Icon size={15} aria-hidden="true"/>{label}</button>)}</div>
    </section>

    {current?.error && <p className="p-notice p-notice-error" role="alert">{current.error} <button type="button" className="p-text-link" onClick={() => setRevision(value => value + 1)}>Tentar de novo</button></p>}
    <p className={styles.status} role="status" aria-live="polite">{loading ? (shown ? 'Atualizando o histórico…' : 'Carregando o histórico…') : shown ? `${capital(DAY.format(civilDate(shown.range.from)))} a ${DAY.format(civilDate(shown.range.to))} · ${events.length} ${events.length === 1 ? 'acontecimento' : 'acontecimentos'}${shown.truncated ? ' · mostrando os mais recentes' : ''}` : ''}<button type="button" className={styles.refresh} onClick={() => setRevision(value => value + 1)} aria-label="Atualizar histórico"><RefreshCw size={15} aria-hidden="true"/></button></p>

    {shown && <div className={styles.kpis} aria-busy={loading}>
      {types.includes('materials') && <a className={styles.kpi} href={projectLink('materials', projectId)}><span><Boxes size={17} aria-hidden="true"/>Estoque</span><strong>{totals.movements}</strong><small>{totals.movements === 1 ? 'movimentação no período' : 'movimentações no período'}</small></a>}
      {types.includes('loans') && shown.loansNow && <a className={styles.kpi} data-alert={shown.loansNow.late > 0 ? 'true' : 'false'} href={projectLink('loans', projectId)}><span><Truck size={17} aria-hidden="true"/>Empréstimos</span><strong>{shown.loansNow.active}</strong><small>{shown.loansNow.active === 1 ? 'ativo agora' : 'ativos agora'}{shown.loansNow.late > 0 && <em><TriangleAlert size={13} aria-hidden="true"/>{shown.loansNow.late} {shown.loansNow.late === 1 ? 'em atraso' : 'em atraso'}</em>}</small></a>}
      {types.includes('demands') && <a className={styles.kpi} href={projectLink('demands', projectId)}><span><ListChecks size={17} aria-hidden="true"/>Demandas</span><strong>{totals.demandsOpened}</strong><small>{totals.demandsOpened === 1 ? 'criada' : 'criadas'} · {totals.demandsDone} {totals.demandsDone === 1 ? 'concluída' : 'concluídas'}</small></a>}
      {types.includes('agenda') && <a className={styles.kpi} href={projectLink('calendar', projectId)}><span><CalendarDays size={17} aria-hidden="true"/>Agenda</span><strong>{totals.agenda}</strong><small>{totals.agenda === 1 ? 'atividade no período' : 'atividades no período'}</small></a>}
    </div>}

    {shown && (showDemands || showStock || showAgenda) && <div className={styles.charts}>
      {showDemands && <figure className={styles.chart}>
        <figcaption><strong>Demandas ao longo do tempo</strong><span>Toque numa barra para abrir as demandas.</span></figcaption>
        <div className={styles.plot}><ResponsiveContainer width="100%" height="100%"><BarChart data={demandSeries} barGap={2} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)"/>
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
          <Tooltip cursor={{ fill: 'var(--viz-hover)' }} content={<VizTooltip/>}/>
          <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, color: 'var(--viz-text)' }}/>
          <Bar dataKey="criadas" name="Criadas" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={22} cursor="pointer" onClick={() => follow(root.current, projectLink('demands', projectId))}/>
          <Bar dataKey="concluidas" name="Concluídas" fill="var(--viz-2)" radius={[4, 4, 0, 0]} maxBarSize={22} cursor="pointer" onClick={() => follow(root.current, projectLink('demands', projectId))}/>
        </BarChart></ResponsiveContainer></div>
        <DataTable caption="Demandas por dia" columns={['Dia', 'Criadas', 'Concluídas']} rows={demandSeries.filter(row => row.criadas || row.concluidas).map(row => [row.label, row.criadas, row.concluidas])} href={projectLink('demands', projectId)} linkLabel="Abrir Demandas"/>
      </figure>}
      {showStock && <figure className={styles.chart}>
        <figcaption><strong>Movimento de estoque por material</strong><span>Toque num material para abrir a ficha dele.</span></figcaption>
        <div className={styles.plot} style={{ height: Math.max(180, stock.length * 44 + 60) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={stock} layout="vertical" barGap={2} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)"/>
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={narrow ? 104 : 150} tick={{ fill: 'var(--viz-text)', fontSize: 11 }} tickFormatter={(name: string) => { const max = narrow ? 15 : 24; return name.length > max ? `…${name.slice(-(max - 1))}` : name; }}/>
          <Tooltip cursor={{ fill: 'var(--viz-hover)' }} content={<VizTooltip/>}/>
          <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, color: 'var(--viz-text)' }}/>
          <Bar dataKey="entradas" name="Entradas" fill="var(--viz-3)" radius={[0, 4, 4, 0]} maxBarSize={16} cursor="pointer" onClick={(data: { payload?: { href?: string | null } }) => follow(root.current, data?.payload?.href ?? null)}/>
          <Bar dataKey="saidas" name="Saídas" fill="var(--viz-2)" radius={[0, 4, 4, 0]} maxBarSize={16} cursor="pointer" onClick={(data: { payload?: { href?: string | null } }) => follow(root.current, data?.payload?.href ?? null)}/>
        </BarChart></ResponsiveContainer></div>
        <DataTable caption="Movimento por material" columns={['Material', 'Entradas', 'Saídas']} rows={stock.map(row => [row.name, row.entradas, row.saidas])} rowHrefs={stock.map(row => row.href)}/>
      </figure>}
      {showAgenda && <figure className={styles.chart}>
        <figcaption><strong>Ocupação da agenda</strong><span>Atividades por dia. Toque para abrir a Agenda.</span></figcaption>
        <div className={styles.plot}><ResponsiveContainer width="100%" height="100%"><BarChart data={agendaSeries} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)"/>
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
          <Tooltip cursor={{ fill: 'var(--viz-hover)' }} content={<VizTooltip/>}/>
          <Bar dataKey="atividades" name="Atividades" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={22} cursor="pointer" onClick={() => follow(root.current, projectLink('calendar', projectId))}/>
        </BarChart></ResponsiveContainer></div>
        <DataTable caption="Atividades por dia" columns={['Dia', 'Atividades']} rows={agendaSeries.filter(row => row.atividades).map(row => [row.label, row.atividades])} href={projectLink('calendar', projectId)} linkLabel="Abrir Agenda"/>
      </figure>}
    </div>}

    {shown && <section className={styles.timeline} aria-label="Linha do tempo">
      <div className={styles.timelineHeading}><h2>Linha do tempo</h2>{months.length > 1 && <nav className={styles.months} aria-label="Ir para o mês">{months.map(([month, count]) => <a key={month} href={`#activity-day-${firstDayOf(month)}`}>{capital(MONTH.format(civilDate(`${month}-15`)))} <span>{count}</span></a>)}</nav>}</div>
      {events.length === 0 ? <div className="p-empty"><span><FileText size={22} aria-hidden="true"/></span><h3>Nada registrado neste período</h3><p>Escolha outro período, projeto ou tipo. Só aparecem os projetos que você pode acessar.</p></div>
      : [...byDay.keys()].sort().reverse().map(day => <div key={day} className={styles.day} id={`activity-day-${day}`}>
        <h3 className={styles.dayHeading}>{capital(DAY.format(civilDate(day)))}<span>{byDay.get(day)!.length}</span></h3>
        <ol className={styles.events}>{byDay.get(day)!.map(event => { const meta = TYPES.find(type => type.id === event.type)!; return <li key={event.id} data-type={event.type}>
          <span className={styles.icon} aria-hidden="true"><meta.Icon size={16}/></span>
          <div className={styles.body}>
            <p className={styles.line}><strong>{event.action}</strong>{event.title && <> · {event.title}</>}{event.detail && <span className={styles.detail}>{event.detail}</span>}</p>
            <p className={styles.meta}>{event.type !== 'agenda' && <time dateTime={event.at}>{TIME.format(new Date(event.at))}</time>}{event.projectName && <span>{event.projectName}</span>}{event.actorName && <span>{event.actorName}</span>}{event.viaRole && <span className={styles.role}><Sparkles size={13} aria-hidden="true"/>Pedido ao Rolê{event.actorName ? `, confirmado por ${event.actorName}` : ''}</span>}</p>
          </div>
          {event.href && <a className={styles.open} href={event.href} aria-label={`Abrir ${event.title || event.action}`}><ArrowUpRight size={16} aria-hidden="true"/></a>}
        </li>; })}</ol>
      </div>)}
    </section>}
  </div>;
}

function VizTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className={styles.tooltip}><strong>{label}</strong>{payload.map(item => <span key={item.name}><i style={{ background: item.color }}/>{item.name}: <b>{item.value}</b></span>)}</div>;
}
function DataTable({ caption, columns, rows, href, linkLabel, rowHrefs }: { caption: string; columns: string[]; rows: (string | number)[][]; href?: string; linkLabel?: string; rowHrefs?: (string | null)[] }) {
  return <details className={styles.table}><summary>Ver em tabela</summary><table><caption className="sr-only">{caption}</caption><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cellIndex === 0 && rowHrefs?.[index] ? <a href={rowHrefs[index]!}>{cell}</a> : cell}</td>)}</tr>)}</tbody></table>
    {href && <a className="p-text-link" href={href}>{linkLabel}<ArrowUpRight size={14} aria-hidden="true"/></a>}</details>;
}
