'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ClipboardList } from 'lucide-react';
import { priorityLabels, TASK_PRIORITIES, type TaskPriority } from '@/lib/follow-up/contracts';
import { followupApi, followupChanged } from './follow-up-api';
import styles from './role-assistant.module.css';

/** Rascunho que o Rolê preparou (resposta do chat). Nada é gravado até o toque em "Criar demanda". */
export type RoleTaskDraftView = {
  organizationId: string; projectId: string; projectName: string; title: string; description: string;
  dueAt: string | null; priority: TaskPriority; assigneeId?: string; assigneeName?: string; afterUntrusted?: true; expiresAt: number; signature: string;
};
/**
 * Estado do cartão guardado na mensagem: sobrevive a recargas e remontagens da conversa.
 * Com operationKey, os campos ficam travados e uma nova tentativa usa a mesma chave (nunca duas demandas).
 */
export type RoleTaskDraftStatus = {
  createdId?: string; discarded?: true; maybeCreated?: true; operationKey?: string;
  title?: string; description?: string; dueAt?: string; priority?: TaskPriority; keepAssignee?: boolean;
};

const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
/** Confere o formato antes de mostrar o cartão; qualquer coisa estranha some sem quebrar a conversa. */
export function roleTaskDraftFrom(value: unknown): RoleTaskDraftView | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const draft = value as Record<string, unknown>;
  const valid = text(draft.organizationId, 200) && text(draft.projectId, 200) && text(draft.projectName, 400) && text(draft.title, 160) && !!String(draft.title).trim()
    && text(draft.description, 4000) && (draft.dueAt === null || typeof draft.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(draft.dueAt))
    && TASK_PRIORITIES.includes(draft.priority as TaskPriority) && (draft.assigneeId === undefined || text(draft.assigneeId, 200) && text(draft.assigneeName, 400))
    && (draft.afterUntrusted === undefined || draft.afterUntrusted === true) && typeof draft.expiresAt === 'number' && text(draft.signature, 2000);
  return valid ? draft as RoleTaskDraftView : undefined;
}

/** Erros em que a demanda pode já existir (toque anterior gravou, ou o rascunho venceu): não convidar a criar de novo. */
const MAYBE_CREATED = new Set(['operation_changed', 'role_task_draft_invalid']);
const demandsOf = (projectId: string) => `/?module=demands&project=${encodeURIComponent(projectId)}`;

type Props = { draft: RoleTaskDraftView; status?: RoleTaskDraftStatus; onStatus: (status: RoleTaskDraftStatus) => void; onOpen?: () => void };

export default function RoleTaskDraftCard({ draft, status, onStatus, onOpen }: Props) {
  // Começa do que a mensagem guardou (edições, chave, avisos); sem nada guardado, do rascunho do Rolê.
  const [title, setTitle] = useState(status?.title ?? draft.title), [description, setDescription] = useState(status?.description ?? draft.description);
  const [dueAt, setDueAt] = useState(status?.dueAt ?? draft.dueAt ?? ''), [priority, setPriority] = useState<TaskPriority>(status?.priority ?? draft.priority);
  // O responsável começa desmarcado: só entra se a pessoa marcar.
  const [keepAssignee, setKeepAssignee] = useState(status?.keepAssignee ?? false);
  const [saving, setSaving] = useState(false), [locked, setLocked] = useState(!!status?.operationKey);
  const [error, setError] = useState(''), [maybeCreated, setMaybeCreated] = useState(!!status?.maybeCreated);
  // Uma chave por cartão: dois toques (ou uma nova tentativa depois de erro de rede) não criam duas demandas.
  // Com a chave criada, os campos ficam travados para que a nova tentativa envie exatamente o mesmo.
  const running = useRef(false), operation = useRef<string | null>(status?.operationKey ?? null);
  const saved = useRef<RoleTaskDraftStatus>(status ?? {});
  const remember = (patch: RoleTaskDraftStatus) => { saved.current = { ...saved.current, ...patch }; onStatus(saved.current); };
  const focusNext = useRef<'open' | 'note' | null>(null), openLink = useRef<HTMLAnchorElement | null>(null), note = useRef<HTMLParagraphElement | null>(null);
  const ready = !!title.trim() && title.trim().length <= 160 && description.trim().length <= 4000;
  const frozen = saving || locked;

  // Foco depois da ação da pessoa: no link da demanda criada ou no aviso de descarte.
  useEffect(() => {
    const target = focusNext.current === 'open' ? openLink.current : focusNext.current === 'note' ? note.current : null;
    focusNext.current = null;
    target?.focus();
  }, [status?.createdId, status?.discarded]);

  if (status?.createdId) {
    const href = `${demandsOf(draft.projectId)}&demandId=${encodeURIComponent(status.createdId)}`;
    return <div className={`${styles.operation} ${styles.taskDraft}`} role="status">
      <p className={styles.operationTitle}><Check size={16} aria-hidden="true"/>Demanda criada</p>
      <p>{title.trim() || draft.title} · <strong>{draft.projectName}</strong></p>
      <a ref={openLink} className={`p-button p-button-subtle ${styles.taskDraftOpen}`} href={href} onClick={() => onOpen?.()}>Abrir demanda</a>
    </div>;
  }
  if (status?.discarded) return <p ref={note} tabIndex={-1} role="status" className={`${styles.help} ${styles.taskDraftNote}`}>Rascunho descartado. Nada foi criado.</p>;

  async function create() {
    if (running.current || !ready || maybeCreated) return;
    running.current = true; setSaving(true); setLocked(true); setError('');
    operation.current ??= crypto.randomUUID();
    remember({ operationKey: operation.current, title, description, dueAt, priority, keepAssignee });
    try {
      const result = await followupApi<{ task: { id: string } }>('', {
        action: 'task.create', projectId: draft.projectId, title: title.trim(), body: description.trim(), priority, dueAt: dueAt || null,
        userIds: keepAssignee && draft.assigneeId ? [draft.assigneeId] : [], operationKey: operation.current, roleDraft: draft.signature,
      });
      focusNext.current = 'open';
      remember({ createdId: result.task.id });
      followupChanged();
    } catch (cause) {
      const code = cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code?: unknown }).code) : '';
      if (MAYBE_CREATED.has(code)) { setMaybeCreated(true); remember({ maybeCreated: true }); }
      else setError(cause instanceof Error ? cause.message : 'Não foi possível criar a demanda.');
    } finally { running.current = false; setSaving(false); }
  }

  return <section className={`${styles.operation} ${styles.documentEditor} ${styles.taskDraft}`} aria-label="Rascunho de demanda">
    <p className={styles.operationTitle}><ClipboardList size={16} aria-hidden="true"/>Rascunho de demanda</p>
    <p>Projeto: <strong>{draft.projectName}</strong></p>
    <p className={styles.help}><strong>Nada foi criado ainda.</strong> Confira os campos e escolha Criar demanda.</p>
    <p className={styles.help}>Este rascunho vale por 30 minutos.</p>
    {draft.afterUntrusted && <p className={styles.searchOnlyNotice}>Preparado depois de ler conteúdo do portal ou da internet. Confira links e responsável antes de criar.</p>}
    <label className={styles.editable}><span>Título</span><textarea className={styles.taskDraftTitle} rows={2} value={title} maxLength={160} required disabled={frozen}
      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} onChange={event => { const value = event.target.value.replace(/\s*[\r\n]+\s*/g, ' '); setTitle(value); remember({ title: value }); }}/></label>
    <label className={styles.editable}><span>Descrição</span><textarea className={styles.taskDraftBody} rows={4} value={description} maxLength={4000} disabled={frozen} onChange={event => { setDescription(event.target.value); remember({ description: event.target.value }); }}/></label>
    <label className={styles.editable}><span>Prazo</span><input type="date" value={dueAt} disabled={frozen} onChange={event => { setDueAt(event.target.value); remember({ dueAt: event.target.value }); }}/></label>
    <label className={styles.editable}><span>Prioridade</span><select value={priority} disabled={frozen} onChange={event => { const value = event.target.value as TaskPriority; setPriority(value); remember({ priority: value }); }}>
      {TASK_PRIORITIES.map(value => <option key={value} value={value}>{priorityLabels[value]}</option>)}
    </select></label>
    {draft.assigneeId && <label className={`${styles.videoConsent} min-h-11 items-center`}><input type="checkbox" checked={keepAssignee} disabled={frozen} onChange={event => { setKeepAssignee(event.target.checked); remember({ keepAssignee: event.target.checked }); }}/><span>Responsável: {draft.assigneeName}</span></label>}
    <div className={styles.reviseActions}>
      <button type="button" className="p-button p-button-primary" disabled={saving || !ready || maybeCreated} onClick={() => void create()}>Criar demanda</button>
      <button type="button" className="p-button p-button-subtle" disabled={saving} onClick={() => { focusNext.current = 'note'; remember({ discarded: true }); }}>Descartar</button>
    </div>
    {saving && <p role="status">Criando a demanda…</p>}
    {maybeCreated && <>
      <p role="alert" className={styles.error}>A demanda pode já ter sido criada. Confira em Demandas antes de criar de novo.</p>
      <a className={`p-button p-button-subtle ${styles.taskDraftOpen}`} href={demandsOf(draft.projectId)} onClick={() => onOpen?.()}>Abrir Demandas do projeto</a>
    </>}
    {error && <p role="alert" className={styles.error}>{error} O rascunho continua aqui. Os campos ficam travados para a nova tentativa não criar a demanda em dobro.</p>}
  </section>;
}
