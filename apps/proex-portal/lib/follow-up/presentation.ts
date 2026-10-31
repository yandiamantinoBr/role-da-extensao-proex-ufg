import type { TaskStatus } from './contracts';

export type SignalTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';
export type DeadlineSignal = { kind: 'none' | 'invalid' | 'scheduled' | 'soon' | 'today' | 'overdue' | 'closed'; tone: SignalTone; label: string; date: string | null; days: number | null };

function day(value: string | null): number | null {
 if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
 const timestamp = Date.parse(`${value}T00:00:00.000Z`);
 return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}
const dateLabel = (value: string) => value.split('-').reverse().join('/');

/** Calendar days supplied by the server/context, never the device timezone. */
export function taskDeadline(dueAt: string | null, status: TaskStatus, today: string): DeadlineSignal {
 if (!dueAt) return { kind: 'none', tone: 'neutral', label: 'Sem prazo', date: null, days: null };
 const end = day(dueAt), start = day(today);
 if (end === null || start === null) return { kind: 'invalid', tone: 'neutral', label: 'Prazo não informado', date: null, days: null };
 const days = Math.round((end - start) / 86400000), date = dateLabel(dueAt);
 if (status === 'completed' || status === 'cancelled') return { kind: 'closed', tone: 'neutral', label: `Prazo: ${date}`, date, days };
 if (days < 0) return { kind: 'overdue', tone: 'danger', label: `Prazo vencido · há ${-days} ${days === -1 ? 'dia' : 'dias'}`, date, days };
 if (days === 0) return { kind: 'today', tone: 'warning', label: 'Vence hoje', date, days };
 if (days <= 3) return { kind: 'soon', tone: 'warning', label: `Vence em ${days} ${days === 1 ? 'dia' : 'dias'}`, date, days };
 return { kind: 'scheduled', tone: 'neutral', label: `Prazo: ${date}`, date, days };
}
