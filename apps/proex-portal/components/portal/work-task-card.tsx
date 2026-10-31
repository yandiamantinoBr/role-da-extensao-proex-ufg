'use client';

import { ArrowUpRight, FolderKanban, UserRound, UserRoundPlus, Users } from 'lucide-react';
import type { Task } from '@/lib/follow-up/contracts';
import { TaskSignals } from './work-signals';
import styles from './work-task-card.module.css';

type CardTask = Pick<Task, 'id' | 'title' | 'status' | 'priority' | 'due_at' | 'project_name' | 'organization_name' | 'assignees'>;
type Props = { task: CardTask; today: string; onOpen: () => void; selected?: boolean; disabled?: boolean; assignmentLabel?: string };

export function WorkTaskCard({ task, today, onOpen, selected = false, disabled = false, assignmentLabel }: Props) {
 return <article className={styles.card} data-priority={task.priority} data-state={task.status} data-selected={selected}>
  <TaskSignals status={task.status} priority={task.priority} dueAt={task.due_at} today={today}/>
  <button type="button" className={styles.title} disabled={disabled} aria-expanded={selected} onClick={onOpen}><span>{task.title}</span><ArrowUpRight size={17} aria-hidden="true"/></button>
  <p className={styles.context}><FolderKanban size={15} aria-hidden="true"/><span>{task.project_name || task.organization_name}</span></p>
  <div className={styles.assignees} role="group" aria-label="Responsáveis">
   {task.assignees.length ? task.assignees.slice(0, 3).map(person => <span className={styles.person} key={person.user_id ?? person.team_id}>{person.team_id ? <Users size={14} aria-hidden="true"/> : <UserRound size={14} aria-hidden="true"/>}{person.name}</span>) : <span className={styles.unassigned}><UserRoundPlus size={15} aria-hidden="true"/>Responsável a definir</span>}
   {task.assignees.length > 3 && <span className={styles.person} title={task.assignees.slice(3).map(person => person.name).join(', ')}>+{task.assignees.length - 3}<span className="sr-only"> outros responsáveis: {task.assignees.slice(3).map(person => person.name).join(', ')}</span></span>}
  </div>
  {assignmentLabel && <p className={styles.assignment}>{assignmentLabel}</p>}
 </article>;
}
