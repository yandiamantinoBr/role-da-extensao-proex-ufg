'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, ListChecks } from 'lucide-react';
import type { MyWorkResponse } from '@/lib/my-work/contracts';
import { communityGet, errorText } from './community-api';
import styles from './floating-dock.module.css';

type Entry = { uid: string; title: string; startsAt: string; endsAt: string; allDay: boolean; projectName: string; status: string; category?: string };
type Item = { key: string; day: string; time: string; title: string; detail: string; kind: 'agenda' | 'deadline'; href?: string };
const addDays = (day: string, days: number) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const local = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString();
const label = (day: string, today: string) => day === today ? 'Hoje' : day === addDays(today, 1) ? 'Amanhã' : new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

/** Today and the next 7 days: agenda entries and the deadlines of my demands. Fetched only when opened. */
export default function CalendarWidget({ serverDay, onOpenCalendar }: { serverDay: string; onOpenCalendar(): void }) {
  const [items, setItems] = useState<Item[] | null>(null), [error, setError] = useState('');
  const [fallbackDay] = useState(() => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10));
  const today = serverDay || fallbackDay, end = addDays(today, 7);
  useEffect(() => {
    let live = true;
    Promise.all([
      communityGet<{ entries: Entry[] }>(`/api/calendar?from=${today}&to=${end}`).catch(() => ({ entries: [] as Entry[] })),
      communityGet<MyWorkResponse>('/api/my-work?status=pending&limit=50'),
    ]).then(([calendar, work]) => {
      if (!live) return;
      const agenda: Item[] = calendar.entries.filter(entry => entry.status !== 'CANCELLED' && entry.category !== 'deadlines').map(entry => {
        const day = entry.allDay ? entry.startsAt.slice(0, 10) : local(entry.startsAt).slice(0, 10);
        return { key: entry.uid, day: day < today ? today : day, time: entry.allDay ? 'Dia todo' : local(entry.startsAt).slice(11, 16), title: entry.title, detail: entry.projectName, kind: 'agenda' as const };
      });
      const deadlines: Item[] = work.tasks.items.filter(task => task.due_at && task.due_at.slice(0, 10) <= end).map(task => {
        const day = task.due_at!.slice(0, 10);
        return { key: `task:${task.id}`, day: day < today ? today : day, time: day < today ? 'Atrasada' : 'Prazo', title: task.title, detail: task.target.name ?? 'Demanda', kind: 'deadline' as const, href: task.href };
      });
      setItems([...agenda, ...deadlines].filter(item => item.day <= end).sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time)));
    }).catch(cause => { if (live) setError(errorText(cause, 'Não foi possível montar o calendário.')); });
    return () => { live = false; };
  }, [today, end]);
  if (error) return <p role="alert" className="p-inline-error">{error}</p>;
  if (!items) return <p role="status" className={styles.help}>Montando sua semana…</p>;
  const days = [...new Set(items.map(item => item.day))];
  return <div className={styles.widget}>
    {!items.length ? <p className={styles.help}>Nada na agenda nem prazos nos próximos 7 dias.</p>
      : days.map(day => <section key={day} className={styles.day} aria-label={label(day, today)}><h3 className={styles.subhead}>{label(day, today)}</h3><ul className={styles.rows}>{items.filter(item => item.day === day).map(item => {
        const Icon = item.kind === 'agenda' ? CalendarDays : ListChecks;
        const body = <><span className={styles.rowTime} data-tone={item.time === 'Atrasada' ? 'danger' : undefined}><Icon size={14} aria-hidden="true"/>{item.time}</span><span className={styles.rowTitle}>{item.title}</span><small>{item.detail}</small></>;
        return <li key={item.key}>{item.href ? <a href={item.href}>{body}</a> : <div>{body}</div>}</li>;
      })}</ul></section>)}
    <button type="button" className={styles.more} onClick={onOpenCalendar}>Abrir a Agenda <ArrowRight size={15} aria-hidden="true"/></button>
  </div>;
}
