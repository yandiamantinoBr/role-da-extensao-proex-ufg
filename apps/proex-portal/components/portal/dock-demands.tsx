'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarClock, CircleDot } from 'lucide-react';
import type { MyWorkResponse } from '@/lib/my-work/contracts';
import { communityGet, errorText } from './community-api';
import { personalWorkHref } from './personal-work-summary';
import styles from './floating-dock.module.css';

const due = (value: string | null, today: string) => !value ? 'Sem prazo' : value.slice(0, 10) < today ? 'Atrasada' : value.slice(0, 10) === today ? 'Vence hoje' : `Até ${value.slice(8, 10)}/${value.slice(5, 7)}`;

/** "Minhas demandas" in the dock: pending, due today and needing attention, with links. One request, only when opened. */
export default function DemandsWidget({ serverDay }: { serverDay: string }) {
  const [data, setData] = useState<MyWorkResponse | null>(null), [error, setError] = useState('');
  useEffect(() => { let live = true; communityGet<MyWorkResponse>('/api/my-work?status=pending&limit=50').then(result => { if (live) setData(result); }).catch(cause => { if (live) setError(errorText(cause, 'Não foi possível consultar suas demandas.')); }); return () => { live = false; }; }, []);
  if (error) return <p role="alert" className="p-inline-error">{error}</p>;
  if (!data) return <p role="status" className={styles.help}>Consultando suas demandas…</p>;
  const today = data.today || serverDay, counts = data.totals.tasks;
  const tiles = [
    { label: 'Abertas', value: counts.pending, status: 'pending' as const, icon: CircleDot },
    { label: 'Vencem hoje', value: counts.dueToday, status: 'due_today' as const, icon: CalendarClock, tone: 'warning' },
    { label: 'Atrasadas', value: counts.overdue, status: 'overdue' as const, icon: AlertTriangle, tone: 'danger' },
  ];
  const urgent = data.tasks.items.filter(task => task.due_at && task.due_at.slice(0, 10) <= today).sort((a, b) => String(a.due_at).localeCompare(String(b.due_at))).slice(0, 5);
  return <div className={styles.widget}>
    <ul className={styles.tiles}>{tiles.map(tile => { const Icon = tile.icon; return <li key={tile.status}><a href={personalWorkHref(tile.status, null, null)} data-tone={tile.value ? tile.tone : undefined}><Icon size={16} aria-hidden="true"/><strong>{tile.value}</strong><span>{tile.label}</span></a></li>; })}</ul>
    {urgent.length > 0 ? <><h3 className={styles.subhead}>Para hoje ou atrasadas</h3><ul className={styles.rows}>{urgent.map(task => <li key={task.id}><a href={task.href}><span className={styles.rowTitle}>{task.title}</span><small data-tone={task.due_at && task.due_at.slice(0, 10) < today ? 'danger' : 'warning'}>{due(task.due_at, today)}{task.target.name ? ` · ${task.target.name}` : ''}</small></a></li>)}</ul></>
      : <p className={styles.help}>Nada vencendo hoje nem atrasado.</p>}
    <a className={styles.more} href={personalWorkHref('pending', null, null)}>Abrir Meu trabalho <ArrowRight size={15} aria-hidden="true"/></a>
  </div>;
}
