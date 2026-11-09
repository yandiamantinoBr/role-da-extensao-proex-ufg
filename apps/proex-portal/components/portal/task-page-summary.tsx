'use client';

import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, CircleDot } from 'lucide-react';
import { TASK_PRIORITIES, TASK_STATES, type Task } from '@/lib/follow-up/contracts';
import { isWorkDay, taskDeadline } from '@/lib/follow-up/presentation';
import { TaskPriorityBadge, TaskStateBadge } from './work-signals';
import styles from './task-page-summary.module.css';

type Props = {
 tasks: Task[];
 today: string;
 page?: number;
 hasMore?: boolean;
 selectedId?: string;
 disabled?: boolean;
 onOpen?: (id: string, trigger?: HTMLButtonElement) => void;
};

type DeadlineGroup = {
 label: string;
 tasks: { task: Task; deadline: ReturnType<typeof taskDeadline> }[];
};

export function TaskPageSummary({ tasks, today, page = 1, hasMore = false, selectedId, disabled, onOpen }: Props) {
 const deadlineKnown = isWorkDay(today);
 const states = { open: 0, in_progress: 0, blocked: 0, completed: 0, cancelled: 0 };
 const priorities = { high: 0, medium: 0, low: 0 };
 const due = new Map<string, DeadlineGroup>();
 let overdue = 0;
 let withoutDeadline = 0;

 for (const task of tasks) {
  states[task.status]++;
  priorities[task.priority]++;
  const deadline = taskDeadline(task.due_at, task.status, today);
  if (deadline.kind === 'overdue') overdue++;
  if (!task.due_at || !deadline.date) {
   withoutDeadline++;
   continue;
  }
  const group = due.get(task.due_at) ?? { label: deadline.date, tasks: [] };
  group.tasks.push({ task, deadline });
  due.set(task.due_at, group);
 }

 const metrics = [
  { label: 'Prazo vencido', count: deadlineKnown ? overdue : null, Icon: AlertTriangle, tone: 'danger' },
  { label: 'Em andamento', count: states.in_progress, Icon: CircleDot, tone: 'info' },
  { label: 'Concluídas', count: states.completed, Icon: CheckCircle2, tone: 'success' },
 ];

 return <section className={styles.summary} aria-label="Resumo desta página de demandas">
  <p className={styles.caption}>Nesta página · {tasks.length} {tasks.length === 1 ? 'demanda' : 'demandas'}</p>
  <dl className={styles.metrics}>{metrics.map(({ label, count, Icon, tone }) => <div key={label} data-tone={tone}>
   <dt><Icon size={17} aria-hidden="true"/>{label}</dt>
   <dd>{count ?? '—'}</dd>
  </div>)}</dl>
  {!deadlineKnown && <p className={styles.caption}>Atualize para conferir os prazos.</p>}
  {tasks.length > 0 && <>
   <p className={styles.caption}>Página {page} · Com os filtros acima{hasMore && ' · Há mais na próxima página'}</p>
   <details className={styles.visual} open>
    <summary>Distribuição por estado e prioridade</summary>
    <div className={styles.breakdown}>
     <div>
      <h4>Estados</h4>
      <dl>{TASK_STATES.map(status => <div key={status}>
       <dt><TaskStateBadge status={status}/></dt>
       <dd><span className={styles.track} aria-hidden="true"><span style={{ inlineSize: `${states[status] / tasks.length * 100}%` }}/></span>{states[status]}</dd>
      </div>)}</dl>
     </div>
     <div>
      <h4>Prioridades cadastradas</h4>
      <dl>{TASK_PRIORITIES.map(priority => <div key={priority}>
       <dt><TaskPriorityBadge priority={priority}/></dt>
       <dd><span className={styles.track} aria-hidden="true"><span style={{ inlineSize: `${priorities[priority] / tasks.length * 100}%` }}/></span>{priorities[priority]}</dd>
      </div>)}</dl>
     </div>
    </div>
   </details>
   <details className={styles.visual}>
    <summary>Linha do tempo de prazos</summary>
    <p className={styles.caption}>Nesta página, cada ponto marca uma data de vencimento registrada.</p>
    {!!due.size && <ol className={styles.timeline}>
     {[...due].sort(([left], [right]) => left.localeCompare(right)).map(([date, group]) => <li key={date}>
       <h4><CalendarDays size={16} aria-hidden="true"/><time dateTime={date}>{group.label}</time>{date === today && <span>Hoje</span>}</h4>
       <ul>{group.tasks.map(({ task, deadline }) => <li key={task.id}>
        {onOpen
         ? <button type="button" aria-label={`Abrir demanda: ${task.title}`} aria-expanded={selectedId === task.id} disabled={disabled} onClick={event => onOpen(task.id,event?.currentTarget)}>{task.title}<ChevronRight size={16} aria-hidden="true"/></button>
         : <strong>{task.title}</strong>}
        <div className={styles.signals}>
         <TaskStateBadge status={task.status}/>
         <TaskPriorityBadge priority={task.priority}/>
         {['overdue', 'today', 'soon'].includes(deadline.kind) && <span data-tone={deadline.tone} className={styles.deadline}>{deadline.label}</span>}
        </div>
       </li>)}</ul>
      </li>)}
    </ol>}
    {withoutDeadline > 0 && <p className={styles.caption}>{withoutDeadline} {withoutDeadline === 1 ? 'demanda sem prazo válido' : 'demandas sem prazo válido'} · Consulte a lista abaixo.</p>}
   </details>
  </>}
 </section>;
}
