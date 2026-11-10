'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Clock, LoaderCircle, RefreshCw } from 'lucide-react';
import styles from './material-attention-inbox.module.css';

export const CONVOCATIONS_CHANGED = 'proex:convocations-changed';
type Item = { convocationId: string; title: string; edition: string; eventDate: string; responseDeadline: string | null; newResponses: number; silentProjects: string[]; deadlineSoon: boolean; unread: boolean };
const dateLabel = (value: string) => new Date(`${value}T12:00:00-03:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' });

/** Bell pane: convocations the person follows (responsible or manager of an invited project). Counts only; no names. */
export default function ConvocationInbox({ userId, onUnreadChange, onOpen }: { userId: string; onUnreadChange?: (count: number) => void; onOpen?: (convocationId: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null), [error, setError] = useState(''), callback = useRef(onUnreadChange);
  useEffect(() => { callback.current = onUnreadChange; }, [onUnreadChange]);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/convocations?view=inbox', { cache: 'no-store', credentials: 'same-origin' });
      const body = await response.json() as { items?: Item[]; unread?: number; error?: string };
      if (!response.ok) throw new Error(body.error || 'Não foi possível consultar as convocações.');
      setItems(body.items ?? []); setError(''); callback.current?.(Number(body.unread ?? 0));
    } catch (failure) { setItems([]); setError(failure instanceof Error ? failure.message : 'Não foi possível consultar as convocações.'); callback.current?.(0); }
  }, []);
  useEffect(() => {
    const start = window.setTimeout(() => void load(), 0), changed = () => void load();
    let last = 0; const focused = () => { if (Date.now() - last > 15000) { last = Date.now(); void load(); } };
    window.addEventListener(CONVOCATIONS_CHANGED, changed); window.addEventListener('focus', focused);
    return () => { window.clearTimeout(start); window.removeEventListener(CONVOCATIONS_CHANGED, changed); window.removeEventListener('focus', focused); };
  }, [load, userId]);
  return <section className={styles.panel} aria-label="Avisos de convocações">
    <div className={styles.heading}><h3><ClipboardCheck size={18}/>Convocações</h3><button type="button" className={styles.iconButton} onClick={() => void load()} aria-label="Atualizar avisos de convocações"><RefreshCw size={16}/></button></div>
    <p className={styles.hint}>Respostas novas e projetos que ainda não confirmaram presença. Escolha os avisos em Convocações → Meus avisos.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!items && !error && <p className={styles.hint} role="status"><LoaderCircle size={15} className="p-spin"/>Consultando…</p>}
    {items && (items.length ? <ul className={styles.list}>{items.map(item => <li key={item.convocationId} className={styles.card}>
      <button type="button" className="p-text-link" onClick={() => onOpen?.(item.convocationId)} style={{ textAlign: 'left', minHeight: 44 }}><strong>{item.title}{item.edition ? ` · ${item.edition}` : ''}</strong></button>
      <p className={styles.hint}>{dateLabel(item.eventDate)}{item.newResponses > 0 ? ` · ${item.newResponses} ${item.newResponses === 1 ? 'resposta nova' : 'respostas novas'}` : ''}</p>
      {item.silentProjects.length > 0 && <p className={styles.hint}>Sem resposta: {item.silentProjects.slice(0, 4).join(', ')}{item.silentProjects.length > 4 ? ` e mais ${item.silentProjects.length - 4}` : ''}</p>}
      {item.deadlineSoon && <p className={styles.hint}><Clock size={14}/> O prazo termina em menos de 2 dias.</p>}
    </li>)}</ul> : <p className={styles.hint}>Nada pendente nas convocações que você acompanha.</p>)}
  </section>;
}
