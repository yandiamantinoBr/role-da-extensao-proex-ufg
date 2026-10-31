'use client';

import { AlertTriangle, CheckCircle2, CircleDot } from 'lucide-react';
import type { Task } from '@/lib/follow-up/contracts';
import { isWorkDay, taskDeadline } from '@/lib/follow-up/presentation';
import styles from './task-page-summary.module.css';

export function TaskPageSummary({ tasks, today }: { tasks: Task[]; today: string }) {
 const deadlineKnown = isWorkDay(today);
 const metrics = [
  { label: 'Prazo vencido', count: deadlineKnown ? tasks.filter(task => taskDeadline(task.due_at, task.status, today).kind === 'overdue').length : null, Icon: AlertTriangle, tone: 'danger' },
  { label: 'Em andamento', count: tasks.filter(task => task.status === 'in_progress').length, Icon: CircleDot, tone: 'info' },
  { label: 'Concluídas', count: tasks.filter(task => task.status === 'completed').length, Icon: CheckCircle2, tone: 'success' },
 ];
 return <section className={styles.summary} aria-label="Resumo desta página de demandas"><p className={styles.caption}>Nesta página · {tasks.length} {tasks.length === 1 ? 'demanda' : 'demandas'}</p><dl className={styles.metrics}>{metrics.map(({ label, count, Icon, tone }) => <div key={label} data-tone={tone}><dt><Icon size={17} aria-hidden="true"/>{label}</dt><dd>{count ?? '—'}</dd></div>)}</dl>{!deadlineKnown && <p className={styles.caption}>Atualize para conferir os prazos.</p>}</section>;
}
