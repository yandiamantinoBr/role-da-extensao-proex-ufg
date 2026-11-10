'use client';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CalendarClock, CheckCircle2, LoaderCircle, PackageMinus, RefreshCw, ShieldAlert } from 'lucide-react';
import { brDate, managementGet, monthLabel } from './api';
import styles from './management.module.css';

type Dashboard = {
  period: { from: string; to: string; activityFrom: string }; today: string; projects: { id: string; name: string }[];
  kpis: Record<'demandsOpen' | 'demandsOverdue' | 'demandsHighOpen' | 'demandsCreated' | 'demandsCompleted' | 'itemsOut', number> & Record<'campaignsActive' | 'participations' | 'lowStock' | 'risksOpen' | 'risksHigh' | 'risksCritical' | 'risksReviewOverdue', number | null>;
  previous: { from: string; to: string; demandsCreated: number; demandsCompleted: number; itemsOut: number | null };
  demandsByMonth: { month: string; created: number; completed: number }[];
  deliveriesByMonth: { month: string; itemsOut: number }[] | null;
  byProject: { project: string; projectId: string; open: number; overdue: number; completed: number }[];
  upcoming: { date: string; title: string; project: string; kind: string; href: string }[];
  lowStock: { material: string; project: string; available: number; unit: string; href: string }[] | null;
  risks: { matrix: number[][]; overdue: { id: string; title: string; reviewOn: string; level: string }[]; total: number } | null;
  activity: { days: { day: string; total: number }[]; activePeople: number | null } | null;
};
const PERIODS = [{ id: '30', label: 'Últimos 30 dias' }, { id: '90', label: 'Últimos 90 dias' }, { id: '180', label: 'Últimos 6 meses' }, { id: '365', label: 'Últimos 12 meses' }];
const level = (probability: number, impact: number) => { const score = probability * impact; return score >= 15 ? 'critico' : score >= 10 ? 'alto' : score >= 5 ? 'moderado' : 'baixo'; };
const fmt = (value: number) => value.toLocaleString('pt-BR');
const link = (module: string, projectId: string) => `/?module=${module}${projectId ? `&project=${encodeURIComponent(projectId)}` : ''}`;
/** "↑ 2 em relação ao período anterior" (ou igual). */
function versus(now: number, before: number | null | undefined): string {
  if (before === null || before === undefined) return '';
  const diff = now - before;
  return diff === 0 ? 'igual ao período anterior' : `${diff > 0 ? '↑' : '↓'} ${fmt(Math.abs(diff))} em relação ao período anterior`;
}

function VizTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className={styles.tooltip}><strong>{label}</strong>{payload.map(item => <span key={item.name}><i style={{ background: item.color }}/>{item.name}: {fmt(Number(item.value) || 0)}</span>)}</div>;
}

export default function DashboardPanel({ organizationId, onOpenRisks }: { organizationId: string; onOpenRisks: () => void }) {
  const [projectId, setProjectId] = useState(''), [period, setPeriod] = useState('90');
  const [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const to = new Date(Date.now() - 3 * 3600_000), from = new Date(to.getTime() - (Number(period) - 1) * 86400_000);
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      managementGet<Dashboard>({ view: 'dashboard', organizationId, ...(projectId ? { projectId } : {}), from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }, controller.signal)
        .then(result => { if (!controller.signal.aborted) setData(result); })
        .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o painel.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [organizationId, projectId, period, reload]);
  const demands = useMemo(() => data?.demandsByMonth.map(row => ({ label: monthLabel(row.month), Criadas: row.created, Concluídas: row.completed })) ?? [], [data]);
  const deliveries = useMemo(() => data?.deliveriesByMonth?.map(row => ({ label: monthLabel(row.month), Saídas: row.itemsOut })) ?? [], [data]);
  const activity = useMemo(() => {
    const weeks: { label: string; Registros: number }[] = [];
    (data?.activity?.days ?? []).forEach((day, index) => { if (index % 7 === 0) weeks.push({ label: brDate(day.day).slice(0, 5), Registros: 0 }); weeks[weeks.length - 1].Registros += day.total; });
    return weeks;
  }, [data]);
  const k = data?.kpis;
  const soon = data ? data.upcoming.filter(item => item.date <= new Date(Date.parse(`${data.today}T12:00:00Z`) + 7 * 86400_000).toISOString().slice(0, 10)) : [];
  const attention = !data || !k ? [] : [
    k.demandsOverdue > 0 && { key: 'overdue', icon: <AlertTriangle size={18} aria-hidden="true"/>, text: `${fmt(k.demandsOverdue)} ${k.demandsOverdue === 1 ? 'demanda com prazo vencido' : 'demandas com prazo vencido'}`, href: link('demands', projectId) },
    (k.risksCritical ?? 0) > 0 && { key: 'critical', icon: <ShieldAlert size={18} aria-hidden="true"/>, text: `${fmt(k.risksCritical ?? 0)} ${k.risksCritical === 1 ? 'risco crítico aberto' : 'riscos críticos abertos'}`, action: onOpenRisks },
    (k.risksReviewOverdue ?? 0) > 0 && { key: 'review', icon: <ShieldAlert size={18} aria-hidden="true"/>, text: `${fmt(k.risksReviewOverdue ?? 0)} ${k.risksReviewOverdue === 1 ? 'risco com revisão vencida' : 'riscos com revisão vencida'}`, action: onOpenRisks },
    (k.lowStock ?? 0) > 0 && { key: 'stock', icon: <PackageMinus size={18} aria-hidden="true"/>, text: `${fmt(k.lowStock ?? 0)} ${k.lowStock === 1 ? 'material no limite do estoque' : 'materiais no limite do estoque'}`, href: link('materials', projectId) },
    soon.length > 0 && { key: 'soon', icon: <CalendarClock size={18} aria-hidden="true"/>, text: `${soon.length} ${soon.length === 1 ? 'atividade nos próximos 7 dias' : 'atividades nos próximos 7 dias'}: ${soon.slice(0, 2).map(item => item.title).join(', ')}${soon.length > 2 ? '…' : ''}`, href: link('calendar', projectId) },
  ].filter(Boolean) as { key: string; icon: React.ReactNode; text: string; href?: string; action?: () => void }[];
  const deliveriesEmpty = !!data?.deliveriesByMonth && data.deliveriesByMonth.every(row => row.itemsOut === 0);
  const card = (label: string, value: number | null | undefined, detail: string, href: string, warn = false) => value === null || value === undefined ? null
    : <a key={label} className={`${styles.kpi} ${warn && value > 0 ? styles.kpiWarn : ''}`} href={href}><span>{label}</span><strong>{fmt(value)}</strong><small>{detail}</small></a>;

  return <div className={styles.root}>
    <div className={styles.toolbar}>
      <label className="p-field"><span>Projeto</span><select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Todos os projetos que você vê</option>{data?.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className="p-field"><span>Período</span><select value={period} onChange={event => setPeriod(event.target.value)}>{PERIODS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <button type="button" className="p-button p-button-subtle" onClick={() => setReload(value => value + 1)} disabled={loading}><RefreshCw size={16} aria-hidden="true"/>Atualizar</button>
      {data && <p className={`${styles.help} ${styles.toolbarNote}`}>De {brDate(data.period.from)} a {brDate(data.period.to)}, comparado com {brDate(data.previous.from)} a {brDate(data.previous.to)}. Cada número abre o detalhe.</p>}
    </div>
    {error && <div className={styles.errorBox} role="alert"><p>{error}</p><button type="button" className="p-button p-button-subtle" onClick={() => setReload(value => value + 1)}>Tentar de novo</button></div>}
    {!data && loading && <p className={styles.loading}><LoaderCircle size={18} className="p-spin" aria-hidden="true"/>Carregando o painel…</p>}
    {data && k && <div aria-busy={loading} style={{ display: 'grid', gap: 18, opacity: loading ? .7 : 1 }}>
      <section className={styles.attention} aria-labelledby="dash-attention">
        <h3 id="dash-attention">Atenção agora</h3>
        {attention.length ? <ul>{attention.map(item => <li key={item.key}>{item.href ? <a href={item.href}>{item.icon}<span>{item.text}</span></a> : <button type="button" onClick={item.action}>{item.icon}<span>{item.text}</span></button>}</li>)}</ul>
          : <p className={styles.attentionOk}><CheckCircle2 size={18} aria-hidden="true"/>Nada pedindo decisão agora: sem atrasos, riscos críticos, revisões vencidas ou estoque no limite.</p>}
      </section>
      <div className={styles.kpis}>
        {card('Demandas abertas', k.demandsOpen, `${fmt(k.demandsHighOpen)} de prioridade alta`, link('demands', projectId))}
        {card('Demandas em atraso', k.demandsOverdue, 'prazo vencido', link('demands', projectId), true)}
        {card('Demandas criadas', k.demandsCreated, versus(k.demandsCreated, data.previous.demandsCreated), link('demands', projectId))}
        {card('Entregas no período', k.demandsCompleted, `concluídas · ${versus(k.demandsCompleted, data.previous.demandsCompleted)}`, link('demands', projectId))}
        {data.deliveriesByMonth && card('Itens distribuídos', k.itemsOut, versus(k.itemsOut, data.previous.itemsOut) || 'saídas de brindes no período', link('materials', projectId))}
        {card('Dinâmicas ativas', k.campaignsActive, `${fmt(k.participations ?? 0)} participações no período`, link('events', projectId))}
        {card('Estoque baixo', k.lowStock, 'materiais no limite', link('materials', projectId), true)}
        {k.risksOpen !== null && <button type="button" className={`${styles.kpi} ${(k.risksReviewOverdue ?? 0) > 0 ? styles.kpiWarn : ''}`} style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={onOpenRisks}>
          <span>Riscos abertos</span><strong>{fmt(k.risksOpen)}</strong><small>{fmt(k.risksHigh ?? 0)} altos ou críticos · {fmt(k.risksReviewOverdue ?? 0)} com revisão vencida</small></button>}
      </div>
      <div className={styles.grid2}>
        <figure className={styles.card}>
          <header><h3>Demandas por mês</h3><a href={link('demands', projectId)}>Abrir demandas</a></header>
          <div className={styles.legend} aria-hidden="true"><span><i style={{ background: 'var(--viz-1)' }}/>Criadas</span><span><i style={{ background: 'var(--viz-3)' }}/>Concluídas</span></div>
          <div className={styles.plot} role="img" aria-label={`Demandas por mês: ${data.demandsByMonth.map(row => `${monthLabel(row.month)} ${row.created} criadas e ${row.completed} concluídas`).join('; ')}`}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}><BarChart data={demands} barGap={2} margin={{ top: 6, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--viz-grid)"/>
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
              <Tooltip cursor={{ fill: 'var(--viz-hover)' }} content={<VizTooltip/>}/>
              <Bar dataKey="Criadas" fill="var(--viz-1)" radius={[4, 4, 0, 0]}/><Bar dataKey="Concluídas" fill="var(--viz-3)" radius={[4, 4, 0, 0]}/>
            </BarChart></ResponsiveContainer>
          </div>
        </figure>
        {data.deliveriesByMonth ? <figure className={styles.card}>
          <header><h3>Brindes distribuídos por mês</h3><a href={link('materials', projectId)}>Abrir materiais</a></header>
          {deliveriesEmpty ? <p className={styles.empty}>Nenhum brinde saiu neste período. <a href={link('materials', projectId)}>Registrar uma saída</a></p> : <>
          <div className={styles.legend} aria-hidden="true"><span><i style={{ background: 'var(--viz-2)' }}/>Unidades que saíram</span></div>
          <div className={styles.plot} role="img" aria-label={`Unidades distribuídas por mês: ${data.deliveriesByMonth.map(row => `${monthLabel(row.month)} ${row.itemsOut}`).join('; ')}`}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}><BarChart data={deliveries} margin={{ top: 6, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--viz-grid)"/>
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
              <Tooltip cursor={{ fill: 'var(--viz-hover)' }} content={<VizTooltip/>}/>
              <Bar dataKey="Saídas" fill="var(--viz-2)" radius={[4, 4, 0, 0]}/>
            </BarChart></ResponsiveContainer>
          </div></>}
        </figure> : <figure className={styles.card}><header><h3>Registros por semana</h3><a href={link('records', '')}>Abrir registros</a></header>
          <div className={styles.plot} role="img" aria-label={`Registros por semana: ${activity.map(row => `${row.label} ${row.Registros}`).join('; ')}`}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}><BarChart data={activity} margin={{ top: 6, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--viz-grid)"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/>
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: 'var(--viz-text)', fontSize: 11 }}/><Tooltip cursor={{ fill: 'var(--viz-hover)' }} content={<VizTooltip/>}/>
              <Bar dataKey="Registros" fill="var(--viz-1)" radius={[4, 4, 0, 0]}/>
            </BarChart></ResponsiveContainer>
          </div></figure>}
      </div>
      <div className={styles.grid2}>
        <section className={styles.card} aria-labelledby="dash-upcoming">
          <header><h3 id="dash-upcoming">Próximos 45 dias</h3><a href={link('calendar', projectId)}>Abrir agenda</a></header>
          {data.upcoming.length ? <ul className={styles.list}>{data.upcoming.map(item => <li key={`${item.kind}-${item.date}-${item.title}`}><a href={item.href}><time dateTime={item.date}>{brDate(item.date).slice(0, 5)}</time><span><b>{item.title}</b><small>{item.project}</small></span><span className={styles.pill}>{item.kind}</span></a></li>)}</ul>
            : <p className={styles.empty}>Nenhum marco ou dinâmica planejado nos próximos 45 dias.</p>}
        </section>
        {data.risks ? <section className={styles.card} aria-labelledby="dash-risks">
          <header><h3 id="dash-risks">Mapa de riscos abertos</h3><button type="button" className={styles.linkButton} onClick={onOpenRisks}>Abrir riscos</button></header>
          <div className={styles.matrixWrap}>
            <span className={styles.axisY}>Impacto (estrago)</span>
            <span className={styles.ticksY} aria-hidden="true">{[5, 4, 3, 2, 1].map(value => <span key={value}>{value}</span>)}</span>
            <div className={styles.matrix} role="table" aria-label="Riscos abertos por impacto (linhas, de 5 a 1) e chance (colunas, de 1 a 5)">
              {data.risks.matrix.map((row, rowIndex) => row.map((count, column) => <span key={`${rowIndex}-${column}`} role="cell" aria-label={`Chance ${column + 1}, impacto ${5 - rowIndex}: ${count} ${count === 1 ? 'risco' : 'riscos'}`} className={`${styles.cell} ${styles[`lvl-${level(column + 1, 5 - rowIndex)}`]} ${count ? '' : styles.cellZero}`}>{count || '·'}</span>))}
            </div>
            <span className={styles.ticksX} aria-hidden="true">{[1, 2, 3, 4, 5].map(value => <span key={value}>{value}</span>)}</span>
            <span className={styles.axisX}>Chance de acontecer (probabilidade)</span>
          </div>
          {data.risks.overdue.length > 0 && <p className={styles.help}><strong>Revisão vencida:</strong> {data.risks.overdue.map(risk => risk.title).join('; ')}.</p>}
          {data.risks.total === 0 && <p className={styles.empty}>Nenhum risco registrado ainda.</p>}
        </section> : <section className={styles.card}><header><h3>Riscos</h3></header><p className={styles.empty}>Os riscos da organização ficam com a administração; os de projeto aparecem para quem participa dele.</p></section>}
      </div>
      <div className={styles.grid2}>
        <section className={styles.card} aria-labelledby="dash-projects">
          <header><h3 id="dash-projects">Demandas por projeto</h3><a href={link('demands', projectId)}>Abrir demandas</a></header>
          {data.byProject.length ? <div style={{ overflowX: 'auto' }}><table className={styles.table}><thead><tr><th scope="col">Projeto</th><th scope="col">Abertas</th><th scope="col">Atrasadas</th><th scope="col">Entregues</th></tr></thead>
            <tbody>{data.byProject.map(row => <tr key={row.project}><td>{row.projectId ? <a href={link('demands', row.projectId)}>{row.project}</a> : row.project}</td><td>{row.open}</td><td>{row.overdue}</td><td>{row.completed}</td></tr>)}</tbody></table></div>
            : <p className={styles.empty}>Nenhuma demanda visível.</p>}
        </section>
        {data.lowStock ? <section className={styles.card} aria-labelledby="dash-stock">
          <header><h3 id="dash-stock">Estoque baixo</h3><a href={link('materials', projectId)}>Abrir materiais</a></header>
          {data.lowStock.length ? <ul className={styles.list}>{data.lowStock.map(item => <li key={`${item.project}-${item.material}`}><a href={item.href}><span className={styles.date}>{fmt(item.available)}</span><span><b>{item.material}</b><small>{item.project}</small></span><span className={styles.pill}>{item.unit}</span></a></li>)}</ul>
            : <p className={styles.empty}>Nenhum material no limite.</p>}
        </section> : <section className={styles.card}><header><h3>Uso do portal</h3></header>
          <p className={styles.help}>{fmt((data.activity?.days ?? []).reduce((sum, day) => sum + day.total, 0))} registros de atividade desde {brDate(data.period.activityFrom)}{data.activity?.activePeople != null ? `, por ${data.activity.activePeople} pessoas` : ''}.</p></section>}
      </div>
    </div>}
  </div>;
}
