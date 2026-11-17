'use client';

import { useRef, useState } from 'react';
import { Check, ClipboardList } from 'lucide-react';
import { priorityLabels, TASK_PRIORITIES, type TaskPriority } from '@/lib/follow-up/contracts';
import { followupApi, followupChanged } from './follow-up-api';
import styles from './role-assistant.module.css';

/** Rascunho que o Rolê preparou (resposta do chat). Nada é gravado até o toque em "Criar demanda". */
export type RoleTaskDraftView = {
  organizationId: string; projectId: string; projectName: string; title: string; description: string;
  dueAt: string | null; priority: TaskPriority; assigneeId?: string; assigneeName?: string; expiresAt: number; signature: string;
};
export type RoleTaskDraftStatus = { createdId?: string; discarded?: true };

const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
/** Confere o formato antes de mostrar o cartão; qualquer coisa estranha some sem quebrar a conversa. */
export function roleTaskDraftFrom(value: unknown): RoleTaskDraftView | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const draft = value as Record<string, unknown>;
  const valid = text(draft.organizationId, 200) && text(draft.projectId, 200) && text(draft.projectName, 400) && text(draft.title, 160) && !!String(draft.title).trim()
    && text(draft.description, 4000) && (draft.dueAt === null || typeof draft.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(draft.dueAt))
    && TASK_PRIORITIES.includes(draft.priority as TaskPriority) && (draft.assigneeId === undefined || text(draft.assigneeId, 200) && text(draft.assigneeName, 400))
    && typeof draft.expiresAt === 'number' && text(draft.signature, 2000);
  return valid ? draft as RoleTaskDraftView : undefined;
}

type Props = { draft: RoleTaskDraftView; status?: RoleTaskDraftStatus; onStatus: (status: RoleTaskDraftStatus) => void; onOpen?: () => void };

export default function RoleTaskDraftCard({ draft, status, onStatus, onOpen }: Props) {
  const [title, setTitle] = useState(draft.title), [description, setDescription] = useState(draft.description);
  const [dueAt, setDueAt] = useState(draft.dueAt ?? ''), [priority, setPriority] = useState<TaskPriority>(draft.priority);
  const [keepAssignee, setKeepAssignee] = useState(!!draft.assigneeId);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  // Uma chave por cartão: dois toques (ou uma nova tentativa depois de erro de rede) não criam duas demandas.
  const running = useRef(false), operation = useRef<string | null>(null);
  const ready = !!title.trim() && title.trim().length <= 160 && description.trim().length <= 4000;

  if (status?.createdId) {
    const href = `/?module=demands&project=${encodeURIComponent(draft.projectId)}&demandId=${encodeURIComponent(status.createdId)}`;
    return <div className={styles.operation} role="status">
      <p className={styles.operationTitle}><Check size={16} aria-hidden="true"/> Demanda criada</p>
      <p>{title.trim() || draft.title} · <strong>{draft.projectName}</strong></p>
      <a className="p-text-link" href={href} onClick={() => onOpen?.()}>Abrir demanda</a>
    </div>;
  }
  if (status?.discarded) return <p className={styles.help}>Rascunho descartado. Nada foi criado.</p>;

  async function create() {
    if (running.current || !ready) return;
    running.current = true; setSaving(true); setError('');
    operation.current ??= crypto.randomUUID();
    try {
      const result = await followupApi<{ task: { id: string } }>('', {
        action: 'task.create', projectId: draft.projectId, title: title.trim(), body: description.trim(), priority, dueAt: dueAt || null,
        userIds: keepAssignee && draft.assigneeId ? [draft.assigneeId] : [], operationKey: operation.current, roleDraft: draft.signature,
      });
      onStatus({ createdId: result.task.id });
      followupChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a demanda.');
    } finally { running.current = false; setSaving(false); }
  }

  return <section className={`${styles.operation} ${styles.documentEditor}`} aria-label="Rascunho de demanda">
    <p className={styles.operationTitle}><ClipboardList size={16} aria-hidden="true"/> Rascunho de demanda</p>
    <p>Projeto: <strong>{draft.projectName}</strong></p>
    <p className={styles.help}>Nada foi criado ainda. Confira e toque em Criar demanda.</p>
    <label className={styles.editable}><span>Título</span><input value={title} maxLength={160} required disabled={saving} onChange={event => setTitle(event.target.value)}/></label>
    <label className={styles.editable}><span>Descrição</span><textarea rows={4} value={description} maxLength={4000} disabled={saving} onChange={event => setDescription(event.target.value)}/></label>
    <label className={styles.editable}><span>Prazo</span><input type="date" value={dueAt} disabled={saving} onChange={event => setDueAt(event.target.value)}/></label>
    <label className={styles.editable}><span>Prioridade</span><select value={priority} disabled={saving} onChange={event => setPriority(event.target.value as TaskPriority)}>
      {TASK_PRIORITIES.map(value => <option key={value} value={value}>{priorityLabels[value]}</option>)}
    </select></label>
    {draft.assigneeId && <label className={`${styles.videoConsent} min-h-11 items-center`}><input type="checkbox" checked={keepAssignee} disabled={saving} onChange={event => setKeepAssignee(event.target.checked)}/><span>Responsável: {draft.assigneeName}</span></label>}
    <div className={styles.reviseActions}>
      <button type="button" className="p-button p-button-primary" disabled={saving || !ready} onClick={() => void create()}>Criar demanda</button>
      <button type="button" className="p-button p-button-subtle" disabled={saving} onClick={() => onStatus({ discarded: true })}>Descartar</button>
    </div>
    {saving && <p role="status">Criando a demanda…</p>}
    {error && <p role="alert">{error} O rascunho continua aqui.</p>}
  </section>;
}
