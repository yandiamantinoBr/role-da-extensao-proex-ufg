'use client';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Bell, Check, LoaderCircle, Pencil, Plus, Settings2, Sparkles, StickyNote, Trash2, X } from 'lucide-react';
import DateField from './date-field';
import { civilDay, communityGet, communityPost, errorText } from './community-api';
import styles from './personal-widgets.module.css';

type Settings = { notes: boolean; reminders: boolean; roleShortcut: boolean; version: number };
type Note = { id: string; body: string; version: number; updatedAt: string };
type Reminder = { id: string; body: string; dueOn: string | null; dueTime: string | null; doneAt: string | null; version: number };
type State = { settings: Settings; notes: Note[]; reminders: Reminder[] };
const ROLE_LAUNCHER = 'button[aria-keyshortcuts="Alt+R"]';

/**
 * Optional personal widgets on the home page. Off by default; when off, only one quiet line is shown.
 * The Rolê widget is a shortcut to the existing assistant (it presses the same floating button), not a copy.
 */
export default function PersonalWidgets({ userId, serverDay, roleAvailable }: { userId: string; serverDay: string; roleAvailable: boolean }) {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(''), [customizing, setCustomizing] = useState(false);
  const generation = useRef(0);
  const load = useCallback(() => {
    const epoch = ++generation.current, current = generation;
    return communityGet<State>('/api/community/widgets')
      .then(result => { if (epoch === current.current) { setState(result); setError(''); } })
      .catch(cause => { if (epoch === current.current) setError(errorText(cause, 'Não foi possível abrir seus widgets.')); });
  }, []);
  useEffect(() => {
    const epoch = ++generation.current, current = generation;
    communityGet<State>('/api/community/widgets')
      .then(result => { if (epoch === current.current) { setState(result); setError(''); } })
      .catch(cause => { if (epoch === current.current) setError(errorText(cause, 'Não foi possível abrir seus widgets.')); });
    return () => { current.current++; };
  }, [userId]);
  if (!state) return error ? <p className={styles.quiet} role="status">{error} <button type="button" className="p-text-link" onClick={() => void load()}>Tentar de novo</button></p> : null;
  const { settings } = state, anyOn = settings.notes || settings.reminders || (settings.roleShortcut && roleAvailable);
  if (!anyOn && !customizing) return <p className={styles.quiet}><StickyNote size={16} aria-hidden="true"/><span>Anotações e lembretes pessoais estão desligados.</span><button type="button" className={styles.linkButton} onClick={() => setCustomizing(true)}>Ativar widgets</button></p>;
  return <section className={styles.panel} aria-labelledby={`widgets-${userId}`}>
    <div className={styles.heading}>
      <div><h2 id={`widgets-${userId}`}>Seus widgets</h2><p>Só você vê. Ligue apenas o que ajuda no seu dia.</p></div>
      <button type="button" className="p-button p-button-subtle" aria-expanded={customizing} aria-label={customizing ? 'Fechar personalização dos widgets' : 'Personalizar widgets'} onClick={() => setCustomizing(value => !value)}>{customizing ? <X size={16}/> : <Settings2 size={16}/>}<span>{customizing ? 'Fechar' : 'Personalizar'}</span></button>
    </div>
    {customizing && <WidgetSettings settings={settings} roleAvailable={roleAvailable} onSaved={next => { setState(current => current && { ...current, settings: next }); setCustomizing(false); void load(); }}/>}
    {anyOn && <div className={styles.grid}>
      {settings.roleShortcut && roleAvailable && <RoleShortcut/>}
      {settings.reminders && <Reminders items={state.reminders} serverDay={serverDay} onChange={load}/>}
      {settings.notes && <Notes items={state.notes} onChange={load}/>}
    </div>}
  </section>;
}

function WidgetSettings({ settings, roleAvailable, onSaved }: { settings: Settings; roleAvailable: boolean; onSaved(next: Settings): void }) {
  const [draft, setDraft] = useState(settings), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const options: [keyof Omit<Settings, 'version'>, string, string][] = [
    ['reminders', 'Lembretes', 'Datas e horários que você não quer esquecer.'],
    ['notes', 'Anotações', 'Recados curtos para você mesmo.'],
    ...(roleAvailable ? [['roleShortcut', 'Atalho do Rolê', 'Abre o assistente que já existe no portal.'] as [keyof Omit<Settings, 'version'>, string, string]] : []),
  ];
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await communityPost<{ settings: Settings }>('/api/community/widgets', { action: 'settings', notes: draft.notes, reminders: draft.reminders, roleShortcut: roleAvailable ? draft.roleShortcut : settings.roleShortcut, expectedVersion: settings.version }); onSaved(result.settings); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <form className={styles.settings} onSubmit={save}>
    <fieldset disabled={busy}><legend>Escolha os widgets</legend>
      {options.map(([key, label, help]) => <label key={key} className={styles.toggle}><input type="checkbox" checked={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.checked }))}/><span><strong>{label}</strong><small>{help}</small></span></label>)}
    </fieldset>
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    <div className={styles.actions}><button type="submit" className="p-button p-button-primary" disabled={busy}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Check size={16}/>}Salvar escolha</button></div>
  </form>;
}

function useOperation() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = useCallback(async (body: Record<string, unknown>, after: () => unknown) => {
    setBusy(true); setError('');
    try { await communityPost('/api/community/widgets', body); await after(); return true; }
    catch (cause) { setError(errorText(cause)); return false; } finally { setBusy(false); }
  }, []);
  return { busy, error, run };
}

function Notes({ items, onChange }: { items: Note[]; onChange(): Promise<void> }) {
  const id = useId(), [body, setBody] = useState(''), key = useRef(''), { busy, error, run } = useOperation();
  async function add(event: FormEvent) {
    event.preventDefault(); if (!body.trim()) return; key.current ||= crypto.randomUUID();
    if (await run({ action: 'create', kind: 'note', body, operationKey: key.current }, onChange)) { setBody(''); key.current = ''; }
  }
  return <article className={styles.card} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}><StickyNote size={17} aria-hidden="true"/>Anotações</h3>
    <form className={styles.addRow} onSubmit={add}>
      <label className="visually-hidden" htmlFor={`${id}-new`}>Nova anotação</label>
      <input id={`${id}-new`} value={body} maxLength={500} placeholder="Escreva uma anotação" disabled={busy} onChange={event => { setBody(event.target.value); key.current = ''; }}/>
      <button type="submit" className="p-icon-button" aria-label="Adicionar anotação" disabled={busy || !body.trim()}>{busy ? <LoaderCircle className="p-spin" size={18}/> : <Plus size={18}/>}</button>
    </form>
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    {items.length ? <ul className={styles.list}>{items.map(note => <EditableItem key={note.id} item={note} onChange={onChange}/>)}</ul> : <p className={styles.empty}>Nenhuma anotação ainda.</p>}
  </article>;
}

function Reminders({ items, serverDay, onChange }: { items: Reminder[]; serverDay: string; onChange(): Promise<void> }) {
  const id = useId(), [body, setBody] = useState(''), [dueOn, setDueOn] = useState(''), [dueTime, setDueTime] = useState(''), key = useRef(''), { busy, error, run } = useOperation();
  const open = items.filter(item => !item.doneAt), done = items.filter(item => item.doneAt);
  async function add(event: FormEvent) {
    event.preventDefault(); if (!body.trim()) return; key.current ||= crypto.randomUUID();
    if (await run({ action: 'create', kind: 'reminder', body, dueOn: dueOn || null, dueTime: dueTime || null, operationKey: key.current }, onChange)) { setBody(''); setDueOn(''); setDueTime(''); key.current = ''; }
  }
  const late = open.filter(item => item.dueOn && serverDay && item.dueOn < serverDay).length;
  return <article className={styles.card} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}><Bell size={17} aria-hidden="true"/>Lembretes{late > 0 && <span className={styles.badge} data-tone="late">{late} {late === 1 ? 'atrasado' : 'atrasados'}</span>}</h3>
    <form className={styles.reminderForm} onSubmit={add}>
      <label className={styles.field}><span>Lembrar de</span><input value={body} maxLength={500} placeholder="Ex.: devolver a chave da sala" disabled={busy} onChange={event => { setBody(event.target.value); key.current = ''; }}/></label>
      <div className={styles.when}>
        <label className={styles.field}><span>Data (opcional)</span><DateField value={dueOn} onValueChange={value => { setDueOn(value); key.current = ''; }} disabled={busy} aria-label="Data do lembrete"/></label>
        <label className={styles.field}><span>Hora</span><input inputMode="numeric" placeholder="14:30" value={dueTime} maxLength={5} disabled={busy || !dueOn} onChange={event => { const digits = event.target.value.replace(/\D/g, '').slice(0, 4); setDueTime(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits); key.current = ''; }} aria-describedby={`${id}-time`}/></label>
      </div>
      <small id={`${id}-time`} className={styles.help}>{dueOn ? 'Hora opcional, em 24 horas.' : 'Escolha a data para poder informar a hora.'}</small>
      <button type="submit" className="p-button p-button-primary" disabled={busy || !body.trim()}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Plus size={16}/>}Adicionar lembrete</button>
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
    <label className={styles.check}><input type="checkbox" checked={!!item.doneAt} disabled={busy} onChange={event => void run({ action: 'done', id: item.id, done: event.target.checked, expectedVersion: item.version }, onChange)}/>
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
    <input id={`edit-${item.id}`} autoFocus value={body} maxLength={500} disabled={busy} onChange={event => setBody(event.target.value)}/>
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

function RoleShortcut() {
  const [message, setMessage] = useState('');
  function open() {
    const launcher = document.querySelector<HTMLButtonElement>(ROLE_LAUNCHER);
    if (launcher) { setMessage(''); launcher.click(); } else setMessage('O Rolê ainda está carregando ou está desligado para você. Tente em instantes; a gestão liga o Rolê em Configurações.');
  }
  return <article className={`${styles.card} ${styles.roleCard}`}>
    <h3><Sparkles size={17} aria-hidden="true"/>Rolê</h3>
    <p>Peça ajuda com materiais, saídas e demandas, por texto, foto ou áudio.</p>
    <button type="button" className="p-button p-button-subtle" onClick={open} title="Atalho: Alt + R"><Sparkles size={16}/>Falar com o Rolê</button>
    {message && <p role="status" className={styles.help}>{message}</p>}
  </article>;
}
