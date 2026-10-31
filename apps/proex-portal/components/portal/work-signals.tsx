'use client';

import { AlertTriangle, CalendarClock, CalendarDays, CalendarX2, CheckCircle2, Circle, CircleDot, CircleX, Flag, PauseCircle } from 'lucide-react';
import { priorityLabels, stateLabels, type TaskPriority, type TaskStatus } from '@/lib/follow-up/contracts';
import { taskDeadline, type SignalTone } from '@/lib/follow-up/presentation';
import styles from './work-signals.module.css';

const states = {
 open: { Icon: Circle, tone: 'neutral' },
 in_progress: { Icon: CircleDot, tone: 'info' },
 blocked: { Icon: PauseCircle, tone: 'warning' },
 completed: { Icon: CheckCircle2, tone: 'success' },
 cancelled: { Icon: CircleX, tone: 'neutral' },
} satisfies Record<TaskStatus, { Icon: typeof Circle; tone: SignalTone }>;

export function TaskStateBadge({ status }: { status: TaskStatus }) {
 const { Icon, tone } = states[status];
 return <span className={styles.signal} data-tone={tone}><Icon size={15} aria-hidden="true"/><span>{stateLabels[status]}</span></span>;
}
export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
 const tone: SignalTone = priority === 'high' ? 'danger' : priority === 'medium' ? 'warning' : 'info';
 return <span className={styles.signal} data-tone={tone}><Flag size={14} aria-hidden="true"/><span>Prioridade {priorityLabels[priority].toLowerCase()}</span></span>;
}
export function TaskDeadlineBadge({ dueAt, status, today }: { dueAt: string | null; status: TaskStatus; today: string }) {
 const deadline = taskDeadline(dueAt, status, today);
 const Icon = deadline.kind === 'overdue' ? AlertTriangle : deadline.kind === 'today' || deadline.kind === 'soon' ? CalendarClock : deadline.kind === 'none' || deadline.kind === 'invalid' ? CalendarX2 : CalendarDays;
 return <span className={styles.signal} data-tone={deadline.tone} title={deadline.date ?? undefined}><Icon size={15} aria-hidden="true"/><span>{deadline.label}</span>{deadline.date && ['today', 'soon', 'overdue'].includes(deadline.kind) && <span className={styles.date}>{deadline.date}</span>}</span>;
}
export function TaskSignals({ status, priority, dueAt, today }: { status: TaskStatus; priority: TaskPriority; dueAt: string | null; today: string }) {
 return <div className={styles.signals} role="group" aria-label="Andamento, prioridade e prazo"><TaskStateBadge status={status}/><TaskPriorityBadge priority={priority}/><TaskDeadlineBadge dueAt={dueAt} status={status} today={today}/></div>;
}
