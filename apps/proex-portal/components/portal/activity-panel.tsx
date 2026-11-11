'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Boxes, CalendarDays, Check, ListChecks, TriangleAlert, Truck, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateField from './date-field';
import HistoryTimeline, { HISTORY_SUBJECTS, HISTORY_TYPES as TYPES, type ActivityEvent, type ActivityType, type HistorySubject } from './history-timeline';
import styles from './activity-panel.module.css';

type SummaryDay = { day: string; materials: number; demandsOpened: number; demandsCompleted: number; agenda: number };
type StockRow = { name: string; projectId: string; href: string; entradas: number; saidas: number };
type Feed = { range: { from: string; to: string; days: string[] }; types: ActivityType[]; events: ActivityEvent[]; truncated: boolean; subject?: { kind: HistorySubject['kind']; id: string; name: string } | null; people: { id: string; name: string }[]; loansNow: { active: number; late: number } | null; aiVisible?: boolean; summary: { days: SummaryDay[]; stock: StockRow[] }; deadlines: { onTime: number; late: number; noDue: number; overdueNow: number } | null; team: { activePeople: number; perDay: { day: string; people: number }[]; people: { id: string; name: string; days: number; actions: number; last: string }[] } | null };
type Props = { projects: { id: string; name: string }[]; initialProjectId?: string; /** Histórico de um assunto só, vindo do atalho "Ver histórico" de uma ficha. */ subject?: HistorySubject | null; onClearSubject?: () => void };
type Period = 'today' | '7' | '30' | '90' | 'month' | 'custom';

const PERIODS: { id: Period; label: string }[] = [{ id: 'today', label: 'Hoje' }, { id: '7', label: '7 dias' }, { id: '30', label: '30 dias' }, { id: '90', label: '90 dias' }, { id: 'month', label: 'Este mês' }, { id: 'custom', label: 'Escolher datas' }];
const SUBJECT_PARAM = { item: 'itemId', loan: 'loanId', task: 'taskId', campaign: 'campaignId' } as const;
const DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const SHORT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const COMPACT = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const civilDate = (day: string) => new Date(`${day}T12:00:00Z`);
const capital = (text: string) => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
const short = (day: string) => COMPACT.format(civilDate(day)).replace('.', '');
function today(): string { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); }
function shift(day: string, delta: number): string { const date = civilDate(day); date.setUTCDate(date.getUTCDate() + delta); return date.toISOString().slice(0, 10); }
export function periodRange(period: Period, now = today()): { from: string; to: string } {
  if (period === 'today') return { from: now, to: now };
  if (period === '7') return { from: shift(now, -6), to: now };
  if (period === 'month') return { from: `${now.slice(0, 8)}01`, to: now };
  if (period === '90') return { from: shift(now, -89), to: now };
  return { from: shift(now, -29), to: now };
}
/** Períodos longos viram semanas (segunda a domingo) para as barras terem largura de toque. */
export function bucketDays(days: SummaryDay[]): { label: string; title: string; criadas: number; concluidas: number; atividades: number }[] {
  if (days.length <= 14) return days.map(row => ({ label: SHORT.format(civilDate(row.day)), title: capital(DAY.format(civilDate(row.day))), criadas: row.demandsOpened, concluidas: row.demandsCompleted, atividades: row.agenda }));
  const weeks = new Map<string, { start: string; end: string; criadas: number; concluidas: number; atividades: number }>();
  for (const row of days) {
    const weekday = (civilDate(row.day).getUTCDay() + 6) % 7, start = shift(row.day, -weekday);
    const week = weeks.get(start) ?? { start: row.day, end: row.day, criadas: 0, concluidas: 0, atividades: 0 };
    week.end = row.day; week.criadas += row.demandsOpened; week.concluidas += row.demandsCompleted; week.atividades += row.agenda;
    weeks.set(start, week);
  }
  return [...weeks].map(([monday, week]) => ({ label: SHORT.format(civilDate(monday)), title: week.start === week.end ? capital(DAY.format(civilDate(week.start))) : `Semana de ${short(week.start)} a ${short(week.end)}`, criadas: week.criadas, concluidas: week.concluidas, atividades: week.atividades }));
}

/** Clicar num gráfico navega como um link do portal (sem recarregar a página). */
function follow(container: HTMLElement | null, href: string | null) {
  if (!href || !container) return;
  const anchor = document.createElement('a');
  anchor.href = href; anchor.hidden = true;
  container.appendChild(anchor); anchor.click(); anchor.remove();
}
function projectLink(module: string, projectId: string) { return projectId ? `/?module=${module}&project=${encodeURIComponent(projectId)}` : `/?module=${module}`; }

export default function ActivityPanel({ projects, initialProjectId = '', subject = null, onClearSubject }: Props) {
  const root = useRef<HTMLDivElement>(null);
  // O histórico de um assunto começa no período mais largo; o geral continua em 30 dias.
  const [period, setPeriod] = useState<Period>(subject ? '90' : '30');
  const [custom, setCustom] = useState(() => periodRange(subject ? '90' : '30'));
  const [projectId, setProjectId] = useState(initialProjectId);
  const [person, setPerson] = useState('');
  const [types, setTypes] = useState<ActivityType[]>(TYPES.map(type => type.id));
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; feed?: Feed; error?: string } | null>(null);
  const range = period === 'custom' ? custom : periodRange(period);
  const key = JSON.stringify([range.from, range.to, projectId, person, types, revision, subject?.kind ?? '', subject?.id ?? '']);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: range.from, to: range.to, types: types.join(',') });
    // No histórico de um assunto o seletor de projeto some; o assunto já diz de que projeto é.
    if (projectId && !subject) params.set('projectId', projectId);
    if (person) params.set('person', person);
    if (subject) params.set(SUBJECT_PARAM[subject.kind], subject.id);
    fetch(`/api/activity?${params}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json().catch(() => ({})) as { error?: unknown }; if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Não foi possível carregar o histórico.'); return body as Feed; })
      .then(feed => { if (!controller.signal.aborted) setState({ key, feed }); })
      .catch(error => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : 'Não foi possível carregar o histórico.' }); });
    return () => controller.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = state?.key === key ? state : null, loading = !current;
  // Enquanto atualiza, mantém o resultado anterior na tela, marcado como "atualizando".
  const shown = current?.feed ?? state?.feed;
  const events = useMemo(() => shown?.events ?? [], [shown]);
  const summaryDays = useMemo(() => shown?.summary.days ?? [], [shown]);
  const buckets = useMemo(() => bucketDays(summaryDays), [summaryDays]);
  const weekly = summaryDays.length > 14;
  const stock = shown?.summary.stock ?? [];
  const stockMax = Math.max(1, ...stock.map(row => Math.max(row.entradas, row.saidas)));
  const sum = (key: keyof Omit<SummaryDay, 'day'>) => summaryDays.reduce((total, row) => total + row[key], 0);
  const totals = { movements: sum('materials'), demandsOpened: sum('demandsOpened'), demandsDone: sum('demandsCompleted'), agenda: sum('agenda') };
  const toggle = (type: ActivityType) => setTypes(list => list.includes(type) ? (list.length > 1 ? list.filter(item => item !== type) : list) : [...list, type]);
  const demandBuckets = buckets.filter(row => row.criadas || row.concluidas), agendaBuckets = buckets.filter(row => row.atividades);
  const concentrated = (rows: unknown[]) => rows.length > 0 && rows.length <= 2 && buckets.length > 4;
  const rangeLabel = shown ? (shown.range.from === shown.range.to ? capital(DAY.format(civilDate(shown.range.from))) : `${short(shown.range.from)} – ${short(shown.range.to)} ${shown.range.to.slice(0, 4)}`) : '';

  return <div className={styles.panel} ref={root}>
    <section className={styles.filters} aria-label="Filtros do histórico">
      {subject && <div className={styles.subject} role="status"><span><small>Só o histórico {HISTORY_SUBJECTS[subject.kind].article}</small><strong>{shown?.subject?.id === subject.id && shown.subject.name ? shown.subject.name : HISTORY_SUBJECTS[subject.kind].label}</strong></span>{onClearSubject && <button type="button" className="p-button p-button-subtle" onClick={onClearSubject}><X size={15} aria-hidden="true"/>Ver histórico de tudo</button>}</div>}
      <div className={styles.filterRow}><span className={styles.filterLabel} id="activity-period">Período</span><div className={styles.chips} role="group" aria-labelledby="activity-period">{PERIODS.filter(item => item.id !== '90' || subject).map(item => <button key={item.id} type="button" aria-pressed={period === item.id} onClick={() => { if (item.id === 'custom') setCustom(range); setPeriod(item.id); }}>{period === item.id && <Check size={14} aria-hidden="true"/>}{item.label}</button>)}</div></div>
      {period === 'custom' && <div className={styles.dates}><label className="p-field"><span>De</span><DateField value={custom.from} max={custom.to} onValueChange={from => setCustom(value => ({ ...value, from: from || value.from }))}/></label><label className="p-field"><span>Até</span><DateField value={custom.to} min={custom.from} onValueChange={to => setCustom(value => ({ ...value, to: to || value.to }))}/></label></div>}
      {!subject && <div className={styles.filterRow}><span className={styles.filterLabel} id="activity-types">Tipo</span><div className={styles.chips} role="group" aria-labelledby="activity-types">{TYPES.filter(type => type.id !== 'ai' || shown?.aiVisible).map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={types.includes(id)} onClick={() => toggle(id)}>{types.includes(id) ? <Check size={14} aria-hidden="true"/> : <Icon size={14} aria-hidden="true"/>}{label}</button>)}</div></div>}
      <div className={styles.selects}>
        {!subject && <label className="p-field"><span>Projeto</span><select id="activity-project" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Todos os projetos</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
        <label className="p-field"><span>Pessoa</span><select id="activity-person" value={person} onChange={event => setPerson(event.target.value)}><option value="">Todas as pessoas</option>{(shown?.people ?? []).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      </div>
    </section>

    {current?.error && <p className="p-notice p-notice-error" role="alert">{current.error} <button type="button" className="p-text-link" onClick={() => setRevision(value => value + 1)}>Tentar de novo</button></p>}
    <p className={styles.status} role="status" aria-live="polite">{loading ? (shown ? 'Atualizando o histórico…' : 'Carregando o histórico…') : shown ? <><strong>{rangeLabel}</strong> · {events.length} {events.length === 1 ? 'acontecimento' : 'acontecimentos'}{shown.truncated ? ' (os mais recentes)' : ''}</> : ''}</p>

    {shown && !subject && <div className={styles.kpis} aria-busy={loading}>
      {types.includes('materials') && <a className={styles.kpi} href={projectLink('materials', projectId)}><span><Boxes size={17} aria-hidden="true"/>Estoque</span><strong>{totals.movements}</strong><small>{totals.movements === 1 ? 'movimentação' : 'movimentações'} no período</small><i className={styles.kpiGo}>Ver materiais<ArrowRight size={14} aria-hidden="true"/></i></a>}
      {types.includes('loans') && shown.loansNow && <a className={styles.kpi} href={projectLink('loans', projectId)}><span><Truck size={17} aria-hidden="true"/>Empréstimos</span><strong>{shown.loansNow.active}</strong><small>{shown.loansNow.active === 1 ? 'ativo agora' : 'ativos agora'}{shown.loansNow.late > 0 && <em><TriangleAlert size={13} aria-hidden="true"/>{shown.loansNow.late} em atraso</em>}</small><i className={styles.kpiGo}>Ver empréstimos<ArrowRight size={14} aria-hidden="true"/></i></a>}
      {types.includes('demands') && <a className={styles.kpi} href={projectLink('demands', projectId)}><span><ListChecks size={17} aria-hidden="true"/>Demandas</span><strong>{totals.demandsOpened}</strong><small>{totals.demandsOpened === 1 ? 'criada' : 'criadas'} · {totals.demandsDone} {totals.demandsDone === 1 ? 'concluída' : 'concluídas'}</small><i className={styles.kpiGo}>Ver demandas<ArrowRight size={14} aria-hidden="true"/></i></a>}
      {types.includes('agenda') && <a className={styles.kpi} href={projectLink('calendar', projectId)}><span><CalendarDays size={17} aria-hidden="true"/>Agenda</span><strong>{totals.agenda}</strong><small>{totals.agenda === 1 ? 'atividade' : 'atividades'} no período</small><i className={styles.kpiGo}>Ver agenda<ArrowRight size={14} aria-hidden="true"/></i></a>}
    </div>}

    {shown && !subject && <div className={styles.charts}>
      {types.includes('demands') && <figure className={styles.chart} data-empty={demandBuckets.length ? 'false' : 'true'}>
        <figcaption><strong>Demandas ao longo do tempo</strong><span>{weekly ? 'Por semana. ' : 'Por dia. '}Toque numa coluna para abrir as demandas.</span></figcaption>
        {demandBuckets.length ? <>
          {concentrated(demandBuckets) && <p className={styles.insight}>{demandBuckets.length === 1 ? 'Tudo aconteceu' : 'Concentrado'} {demandBuckets.map(row => `${/^(sábado|domingo)/i.test(row.title) ? 'no' : 'na'} ${row.title.toLocaleLowerCase('pt-BR')}`).join(' e ')}: {totals.demandsOpened} {totals.demandsOpened === 1 ? 'demanda criada' : 'demandas criadas'} e {totals.demandsDone} {totals.demandsDone === 1 ? 'concluída' : 'concluídas'}.</p>}
          <div className={styles.legend} aria-hidden="true"><span><i style={{ background: 'var(--viz-1)' }}/>Criadas</span><span><i style={{ background: 'var(--viz-3)' }}/>Concluídas</span></div>
          <div className={styles.plot} onClick={() => follow(root.current, projectLink('demands', projectId))}><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}><BarChart data={buckets} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)"/>
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
            <Tooltip cursor={{ fill: 'var(--viz-hover)' }} content={<VizTooltip/>}/>
            <Bar dataKey="criadas" name="Criadas" fill="var(--viz-1)" radius={[4, 4, 0, 0]}/>
            <Bar dataKey="concluidas" name="Concluídas" fill="var(--viz-3)" radius={[4, 4, 0, 0]}/>
          </BarChart></ResponsiveContainer></div>
          <DataTable caption="Demandas no período" columns={[weekly ? 'Semana' : 'Dia', 'Criadas', 'Concluídas']} rows={demandBuckets.map(row => [row.title, row.criadas, row.concluidas])} href={projectLink('demands', projectId)} linkLabel="Abrir Demandas"/>
        </> : <ChartEmpty text="Nenhuma demanda criada ou concluída neste período." href={projectLink('demands', projectId)} label="Abrir Demandas"/>}
      </figure>}
      {types.includes('materials') && <figure className={styles.chart} data-empty={stock.length ? 'false' : 'true'}>
        <figcaption><strong>Movimento de estoque por material</strong><span>Até 8 materiais com mais movimento. Toque num material para abrir a ficha.</span></figcaption>
        {stock.length ? <>
          <div className={styles.legend} aria-hidden="true">{stock.some(row => row.entradas > 0) && <span><i style={{ background: 'var(--viz-3)' }}/>Entradas</span>}{stock.some(row => row.saidas > 0) && <span><i style={{ background: 'var(--viz-2)' }}/>Saídas</span>}</div>
          <ul className={styles.stock}>{stock.map(row => <li key={row.href}><a href={row.href} title={`${row.name}: ${row.entradas} de entrada e ${row.saidas} de saída`}>
            <span className={styles.stockName}>{row.name}</span>
            <span className={styles.stockBars} aria-hidden="true">{row.entradas > 0 && <span style={{ width: `${row.entradas / stockMax * 100}%`, background: 'var(--viz-3)' }}/>}{row.saidas > 0 && <span style={{ width: `${row.saidas / stockMax * 100}%`, background: 'var(--viz-2)' }}/>}</span>
            <span className={styles.stockValues}>{row.entradas > 0 && <b>+{row.entradas}</b>}{row.saidas > 0 && <b>−{row.saidas}</b>}</span>
          </a></li>)}</ul>
          <a className={`p-text-link ${styles.chartFoot}`} href={projectLink('materials', projectId)}>Ver todos os materiais<ArrowUpRight size={14} aria-hidden="true"/></a>
        </> : <ChartEmpty text="Nenhuma movimentação de estoque neste período." href={projectLink('materials', projectId)} label="Abrir Materiais"/>}
      </figure>}
      {types.includes('agenda') && <figure className={styles.chart} data-empty={agendaBuckets.length ? 'false' : 'true'}>
        <figcaption><strong>Ocupação da agenda</strong><span>{weekly ? 'Atividades por semana.' : 'Atividades por dia.'}{agendaBuckets.length ? ' Toque para abrir a Agenda.' : ''}</span></figcaption>
        {agendaBuckets.length ? <>
          <div className={styles.plot} onClick={() => follow(root.current, projectLink('calendar', projectId))}><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}><BarChart data={buckets} barCategoryGap="22%" margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)"/>
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
            <Tooltip cursor={{ fill: 'var(--viz-hover)' }} content={<VizTooltip/>}/>
            <Bar dataKey="atividades" name="Atividades" fill="var(--viz-1)" radius={[4, 4, 0, 0]}/>
          </BarChart></ResponsiveContainer></div>
          <DataTable caption="Atividades no período" columns={[weekly ? 'Semana' : 'Dia', 'Atividades']} rows={agendaBuckets.map(row => [row.title, row.atividades])} href={projectLink('calendar', projectId)} linkLabel="Abrir Agenda"/>
        </> : <ChartEmpty text="Nenhuma atividade na agenda neste período." href={projectLink('calendar', projectId)} label="Abrir Agenda"/>}
      </figure>}
    </div>}

    {shown && !subject && (shown.deadlines || shown.team) && <section className={styles.management} aria-labelledby="activity-management">
      <h2 id="activity-management">Prazos e equipe</h2>
      <div className={styles.charts}>
        {shown.deadlines && types.includes('demands') && <Deadlines data={shown.deadlines} href={projectLink('demands', projectId)}/>}
        {shown.team && <figure className={styles.chart}>
          <figcaption><strong>Atividade da equipe</strong><span>O que cada pessoa registrou nos projetos que você gerencia. Não é controle de ponto nem de login.</span></figcaption>
          <p className={styles.teamTotal}><b>{shown.team.activePeople}</b> {shown.team.activePeople === 1 ? 'pessoa registrou atividade' : 'pessoas registraram atividade'} no período{shown.truncated ? ' (com base nos acontecimentos mais recentes)' : ''}.</p>
          {shown.team.people.length > 0 ? <ul className={styles.people}>{shown.team.people.map(entry => <li key={entry.id}><button type="button" onClick={() => setPerson(entry.id)} title={`Ver só o que ${entry.name} registrou`}>
            <span className={styles.personName}>{entry.name}</span>
            <span className={styles.personBar} aria-hidden="true"><span style={{ width: `${entry.days / Math.max(1, summaryDays.length) * 100}%` }}/></span>
            <span className={styles.personNumbers}>{entry.days} de {summaryDays.length} {summaryDays.length === 1 ? 'dia' : 'dias'} com registro · {entry.actions} {entry.actions === 1 ? 'registro' : 'registros'}</span>
          </button></li>)}</ul> : <p className={styles.chartEmpty}>Ninguém registrou atividade neste período.</p>}
        </figure>}
      </div>
    </section>}

    {shown && <HistoryTimeline events={events} hideProject={Boolean(projectId)} hidePerson={Boolean(person)} heading={subject ? `Histórico ${HISTORY_SUBJECTS[subject.kind].article}` : 'Linha do tempo'} {...(subject ? { emptyTitle: 'Nada registrado neste período', emptyText: `Nenhum acontecimento ${HISTORY_SUBJECTS[subject.kind].article} neste período, ou você não tem acesso a ele.`, emptyHint: 'Escolha outro período ou volte ao histórico de tudo.' } : {})}/>}
  </div>;
}

function ChartEmpty({ text, href, label }: { text: string; href: string; label: string }) {
  return <p className={styles.chartEmpty}>{text} <a className="p-text-link" href={href}>{label}<ArrowUpRight size={14} aria-hidden="true"/></a></p>;
}
function VizTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: { title?: string } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className={styles.tooltip}><strong>{payload[0]?.payload?.title ?? label}</strong>{payload.map(item => <span key={item.name}><i style={{ background: item.color }}/>{item.name}: <b>{item.value}</b></span>)}<small>Toque para abrir</small></div>;
}
function DataTable({ caption, columns, rows, href, linkLabel }: { caption: string; columns: string[]; rows: (string | number)[][]; href: string; linkLabel: string }) {
  return <details className={styles.table}><summary>Ver em tabela</summary><table><caption className="sr-only">{caption}</caption><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>
    <a className="p-text-link" href={href}>{linkLabel}<ArrowUpRight size={14} aria-hidden="true"/></a></details>;
}
function Deadlines({ data, href }: { data: { onTime: number; late: number; noDue: number; overdueNow: number }; href: string }) {
  const total = data.onTime + data.late + data.noDue;
  const parts = [{ key: 'onTime', label: 'No prazo', value: data.onTime, color: 'var(--viz-3)' }, { key: 'late', label: 'Com atraso', value: data.late, color: 'var(--viz-2)' }, { key: 'noDue', label: 'Sem prazo', value: data.noDue, color: 'var(--viz-muted)' }];
  return <figure className={styles.chart}>
    <figcaption><strong>Prazos das demandas</strong><span>Comparadas com o prazo combinado.</span></figcaption>
    {total > 0 ? <>
      <p className={styles.teamTotal}><b>{total}</b> {total === 1 ? 'demanda concluída' : 'demandas concluídas'}: {parts.filter(part => part.value > 0).map(part => `${part.value} ${part.label.toLocaleLowerCase('pt-BR')}`).join(', ')}.</p>
      {total >= 5 && <div className={styles.deadlineBar} role="img" aria-label={parts.map(part => `${part.value} ${part.label.toLocaleLowerCase('pt-BR')}`).join(', ')}>{parts.filter(part => part.value > 0).map(part => <span key={part.key} style={{ flexGrow: part.value, background: part.color }} title={`${part.label}: ${part.value}`}/>)}</div>}
      {total >= 5 && <ul className={styles.deadlineLegend}>{parts.map(part => <li key={part.key}><i style={{ background: part.color }}/>{part.label}<b>{part.value}</b></li>)}</ul>}
    </> : <p className={styles.chartEmpty}>Nenhuma demanda concluída neste período.</p>}
    <a className={`${styles.overdue} ${data.overdueNow > 0 ? styles.overdueAlert : ''}`} href={href}>{data.overdueNow > 0 ? <TriangleAlert size={15} aria-hidden="true"/> : <Check size={15} aria-hidden="true"/>}{data.overdueNow > 0 ? `${data.overdueNow} ${data.overdueNow === 1 ? 'demanda aberta já passou do prazo' : 'demandas abertas já passaram do prazo'}` : 'Nenhuma demanda aberta fora do prazo'}<ArrowUpRight size={14} aria-hidden="true"/></a>
  </figure>;
}
