'use client';
import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import { Bell, CalendarPlus, Check, LoaderCircle, Pencil, Plus, StickyNote, Trash2, X } from 'lucide-react';
import DateField from './date-field';
import { civilDay, communityPost, errorText } from './community-api';
import styles from './personal-widgets.module.css';

export type Note = { id: string; body: string; version: number; updatedAt: string };
export type Reminder = { id: string; body: string; dueOn: string | null; dueTime: string | null; doneAt: string | null; version: number };

/**
 * Optional personal widgets on the home page. Off by default; when off, only one quiet line is shown.
 * The Rolê widget is a shortcut to the existing assistant (it presses the same floating button), not a copy.
 */
/* The old home-page block and its settings form were replaced by the floating dock (floating-dock.tsx, 0043). */

function useOperation() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = useCallback(async (body: Record<string, unknown>, after: () => unknown) => {
    setBusy(true); setError('');
    try { await communityPost('/api/community/widgets', body); await after(); return true; }
    catch (cause) { setError(errorText(cause)); return false; } finally { setBusy(false); }
  }, []);
  return { busy, error, run };
}

export function Notes({ items, onChange, bare = false }: { items: Note[]; onChange(): Promise<void>; bare?: boolean }) {
  const id = useId(), [body, setBody] = useState(''), key = useRef(''), { busy, error, run } = useOperation();
  async function add(event: FormEvent) {
    event.preventDefault(); if (!body.trim()) return; key.current ||= crypto.randomUUID();
    if (await run({ action: 'create', kind: 'note', body, operationKey: key.current }, onChange)) { setBody(''); key.current = ''; }
  }
  return <article className={bare ? styles.bare : styles.card} aria-labelledby={bare ? undefined : `${id}-title`} aria-label={bare ? 'Anotações' : undefined}>
    {!bare && <h3 id={`${id}-title`}><StickyNote size={17} aria-hidden="true"/>Anotações</h3>}
    <form className={styles.addRow} onSubmit={add}>
      <label className="visually-hidden" htmlFor={`${id}-new`}>Nova anotação</label>
      <input name="community-field-2" id={`${id}-new`} value={body} maxLength={500} placeholder="Escreva uma anotação" disabled={busy} onChange={event => { setBody(event.target.value); key.current = ''; }}/>
      <button type="submit" className="p-icon-button" aria-label="Adicionar anotação" disabled={busy || !body.trim()}>{busy ? <LoaderCircle className="p-spin" size={18}/> : <Plus size={18}/>}</button>
    </form>
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    {items.length ? <ul className={styles.list}>{items.map(note => <EditableItem key={note.id} item={note} onChange={onChange}/>)}</ul> : <p className={styles.empty}>Nenhuma anotação ainda.</p>}
  </article>;
}

export function Reminders({ items, serverDay, onChange, bare = false }: { items: Reminder[]; serverDay: string; onChange(): Promise<void>; bare?: boolean }) {
  const id = useId(), [body, setBody] = useState(''), [dueOn, setDueOn] = useState(''), [dueTime, setDueTime] = useState(''), [withDate, setWithDate] = useState(false), key = useRef(''), { busy, error, run } = useOperation();
  const open = items.filter(item => !item.doneAt), done = items.filter(item => item.doneAt);
  async function add(event: FormEvent) {
    event.preventDefault(); if (!body.trim()) return; key.current ||= crypto.randomUUID();
    if (await run({ action: 'create', kind: 'reminder', body, dueOn: dueOn || null, dueTime: dueTime || null, operationKey: key.current }, onChange)) { setBody(''); setDueOn(''); setDueTime(''); setWithDate(false); key.current = ''; }
  }
  const late = open.filter(item => item.dueOn && serverDay && item.dueOn < serverDay).length;
  return <article className={bare ? styles.bare : styles.card} aria-labelledby={bare ? undefined : `${id}-title`} aria-label={bare ? 'Lembretes' : undefined}>
    <h3 id={`${id}-title`} className={bare ? 'visually-hidden' : undefined}><Bell size={17} aria-hidden="true"/>Lembretes{late > 0 && <span className={styles.badge} data-tone="late">{late} {late === 1 ? 'atrasado' : 'atrasados'}</span>}</h3>
    <form className={styles.reminderForm} onSubmit={add}>
      <div className={styles.addRow}>
        <label className="visually-hidden" htmlFor={`${id}-new`}>Novo lembrete</label>
        <input name="community-field-3" id={`${id}-new`} value={body} maxLength={500} placeholder="Novo lembrete" disabled={busy} onChange={event => { setBody(event.target.value); key.current = ''; }}/>
        <button type="submit" className="p-icon-button" aria-label="Adicionar lembrete" disabled={busy || !body.trim()}>{busy ? <LoaderCircle className="p-spin" size={18}/> : <Plus size={18}/>}</button>
      </div>
      {withDate ? <div className={styles.when}>
        <label className={styles.field}><span>Data</span><DateField value={dueOn} onValueChange={value => { setDueOn(value); key.current = ''; }} disabled={busy} aria-label="Data do lembrete"/></label>
        <label className={styles.field}><span>Hora (opcional)</span><input name="community-field-4" inputMode="numeric" placeholder={dueOn ? 'hh:mm' : '--:--'} value={dueTime} maxLength={5} disabled={busy || !dueOn} onChange={event => { const digits = event.target.value.replace(/\D/g, '').slice(0, 4); setDueTime(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits); key.current = ''; }} aria-describedby={`${id}-time`}/></label>
        <small id={`${id}-time`} className={styles.help}>{dueOn ? 'Hora em 24 horas, como 14:30.' : 'Escolha a data para poder informar a hora.'}</small>
      </div> : <button type="button" className={styles.linkButton} onClick={() => setWithDate(true)}><CalendarPlus size={16} aria-hidden="true"/>Pôr data e hora</button>}
    </form>
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    {open.length ? <ul className={styles.list}>{open.map(item => <ReminderItem key={item.id} item={item} serverDay={serverDay} onChange={onChange}/>)}</ul> : <p className={styles.empty}>Nada pendente. Bom trabalho.</p>}
    {done.length > 0 && <details className={styles.done}><summary>Concluídos nos últimos 7 dias ({done.length})</summary><ul className={styles.list}>{done.map(item => <ReminderItem key={item.id} item={item} serverDay={serverDay} onChange={onChange}/>)}</ul></details>}
  </article>;
}

function ReminderItem({ item, serverDay, onChange }: { item: Reminder; serverDay: string; onChange(): Promise<void> }) {
  const { busy, error, run } = useOperation(), [confirming, setConfirming] = useState(false);
  const tone = item.doneAt ? 'done' : item.dueOn && serverDay ? item.dueOn < serverDay ? 'late' : item.dueOn === serverDay ? 'today' : '' : '';
  return <li className={styles.item} data-tone={tone || undefined}>
    <label className={styles.check}><input name="community-field-5" type="checkbox" checked={!!item.doneAt} disabled={busy} onChange={event => void run({ action: 'done', id: item.id, done: event.target.checked, expectedVersion: item.version }, onChange)}/>
      <span><span className={styles.body}>{item.body}</span>{item.dueOn && <small>{tone === 'late' ? 'Atrasado · ' : tone === 'today' ? 'Hoje · ' : ''}{civilDay(item.dueOn)}{item.dueTime ? ` às ${item.dueTime}` : ''}</small>}</span></label>
    {confirming ? <span className={styles.confirm}><button type="button" className="p-text-link p-text-danger" disabled={busy} onClick={() => void run({ action: 'delete', id: item.id, expectedVersion: item.version }, onChange)}>Apagar</button><button type="button" className="p-text-link" onClick={() => setConfirming(false)}>Manter</button></span>
      : <button type="button" className={styles.iconAction} aria-label={`Apagar lembrete: ${item.body}`} disabled={busy} onClick={() => setConfirming(true)}><Trash2 size={16}/></button>}
    {error && <p role="alert" className="p-inline-error">{error}</p>}
  </li>;
}

function EditableItem({ item, onChange }: { item: Note; onChange(): Promise<void> }) {
  const [editing, setEditing] = useState(false), [body, setBody] = useState(item.body), [confirming, setConfirming] = useState(false), { busy, error, run } = useOperation();
  if (editing) return <li className={styles.item}><form className={styles.addRow} onSubmit={async event => { event.preventDefault(); if (await run({ action: 'update', id: item.id, body, expectedVersion: item.version }, onChange)) setEditing(false); }}>
    <label className="visually-hidden" htmlFor={`edit-${item.id}`}>Editar anotação</label>
    <input name="community-field-6" id={`edit-${item.id}`} autoFocus value={body} maxLength={500} disabled={busy} onChange={event => setBody(event.target.value)}/>
    <button type="submit" className="p-icon-button" aria-label="Salvar anotação" disabled={busy || !body.trim()}><Check size={18}/></button>
    <button type="button" className="p-icon-button" aria-label="Cancelar edição" onClick={() => { setBody(item.body); setEditing(false); }}><X size={18}/></button>
  </form>{error && <p role="alert" className="p-inline-error">{error}</p>}</li>;
  return <li className={styles.item}>
    <span className={styles.body}>{item.body}</span>
    {confirming ? <span className={styles.confirm}><button type="button" className="p-text-link p-text-danger" disabled={busy} onClick={() => void run({ action: 'delete', id: item.id, expectedVersion: item.version }, onChange)}>Apagar</button><button type="button" className="p-text-link" onClick={() => setConfirming(false)}>Manter</button></span>
      : <span className={styles.itemActions}><button type="button" className={styles.iconAction} aria-label={`Editar anotação: ${item.body}`} onClick={() => setEditing(true)}><Pencil size={16}/></button><button type="button" className={styles.iconAction} aria-label={`Apagar anotação: ${item.body}`} onClick={() => setConfirming(true)}><Trash2 size={16}/></button></span>}
    {error && <p role="alert" className="p-inline-error">{error}</p>}
  </li>;
}
