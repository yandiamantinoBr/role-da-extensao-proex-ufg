'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Notes, Reminders, type Note, type Reminder } from './personal-widgets';
import { communityGet, errorText } from './community-api';

/** Notes and reminders inside the floating dock (loaded only when their panel opens). */
type State = { notes: Note[]; reminders: Reminder[] };
function usePersonalItems() {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(''), generation = useRef(0);
  const load = useCallback(() => {
    const epoch = ++generation.current, current = generation;
    return communityGet<State>('/api/community/widgets').then(result => { if (epoch === current.current) { setState(result); setError(''); } }).catch(cause => { if (epoch === current.current) setError(errorText(cause, 'Não foi possível abrir.')); });
  }, []);
  useEffect(() => {
    const epoch = ++generation.current, current = generation;
    communityGet<State>('/api/community/widgets').then(result => { if (epoch === current.current) { setState(result); setError(''); } }).catch(cause => { if (epoch === current.current) setError(errorText(cause, 'Não foi possível abrir.')); });
    return () => { current.current++; };
  }, []);
  return { state, error, load };
}
export function NotesWidget() {
  const { state, error, load } = usePersonalItems();
  if (error) return <p role="alert" className="p-inline-error">{error}</p>;
  if (!state) return <p role="status">Abrindo anotações…</p>;
  return <Notes items={state.notes} onChange={load} bare/>;
}
export function RemindersWidget({ serverDay, onBadge }: { serverDay: string; onBadge(count: number): void }) {
  const { state, error, load } = usePersonalItems();
  const badge = useRef(onBadge);
  useEffect(() => { badge.current = onBadge; }, [onBadge]);
  useEffect(() => { if (state) badge.current(state.reminders.filter(item => !item.doneAt && item.dueOn && serverDay && item.dueOn <= serverDay).length); }, [state, serverDay]);
  if (error) return <p role="alert" className="p-inline-error">{error}</p>;
  if (!state) return <p role="status">Abrindo lembretes…</p>;
  return <Reminders items={state.reminders} serverDay={serverDay} onChange={load} bare/>;
}
