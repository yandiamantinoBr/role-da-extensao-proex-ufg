'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, FolderKanban, LoaderCircle, Mail, MessagesSquare, User } from 'lucide-react';
import styles from './community-inbox.module.css';
import { COMMUNITY_CHANGED, communityGet, errorText } from './community-api';

type Conversation = { key: string; kind: 'project' | 'direct'; title: string; unread: number };
type Inbox = { messages: number; conversations: Conversation[]; moreConversations: number; unread: number };
export type CommunityTarget = { tab: 'messages' } | { tab: 'chat'; key?: string };
const news = (count: number) => `${count} ${count === 1 ? 'mensagem nova' : 'mensagens novas'}`;
const unreadRecados = (count: number) => `${count} ${count === 1 ? 'não lido' : 'não lidos'}`;
const shown = (count: number) => count > 99 ? '99+' : String(count);

/**
 * Bell pane: unread recados and conversations with new messages. Counts and titles only; the text stays in the
 * Community. Every number here is a count of messages, and they add up to the number on the bell.
 */
export default function CommunityInbox({ userId, onUnreadChange, onOpen }: { userId: string; onUnreadChange?: (count: number) => void; onOpen?: (target: CommunityTarget) => void }) {
  const [inbox, setInbox] = useState<Inbox | null>(null), [error, setError] = useState(''), callback = useRef(onUnreadChange);
  useEffect(() => { callback.current = onUnreadChange; }, [onUnreadChange]);
  const load = useCallback(async () => {
    try { const result = await communityGet<Inbox>('/api/community?view=inbox'); setInbox(result); setError(''); callback.current?.(Number(result.unread ?? 0)); }
    catch (failure) { setInbox({ messages: 0, conversations: [], moreConversations: 0, unread: 0 }); setError(errorText(failure, 'Não foi possível consultar a Comunidade.')); callback.current?.(0); }
  }, []);
  useEffect(() => {
    const start = window.setTimeout(() => void load(), 0), changed = () => void load();
    let last = 0; const focused = () => { if (Date.now() - last > 15000) { last = Date.now(); void load(); } };
    window.addEventListener(COMMUNITY_CHANGED, changed); window.addEventListener('focus', focused);
    return () => { window.clearTimeout(start); window.removeEventListener(COMMUNITY_CHANGED, changed); window.removeEventListener('focus', focused); };
  }, [load, userId]);
  const empty = inbox && !inbox.messages && !inbox.conversations.length;
  return <section className={styles.pane} aria-label="Avisos da Comunidade">
    <p className={styles.hint}>Recados não lidos e conversas com mensagens novas. O conteúdo das mensagens só aparece na Comunidade.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!inbox && !error && <p className={styles.status} role="status"><LoaderCircle size={15} className="p-spin"/>Consultando…</p>}
    {inbox && !empty && <ul className={styles.list}>
      {inbox.messages > 0 && <li>
        <button type="button" className={styles.row} aria-label={`Recados: ${unreadRecados(inbox.messages)}. Abrir a caixa de recados.`} onClick={() => onOpen?.({ tab: 'messages' })}>
          <span className={styles.icon} aria-hidden="true"><Mail size={18}/></span>
          <span className={styles.text}><strong>Recados</strong><small>{unreadRecados(inbox.messages)}</small></span>
          <span className={styles.count} aria-hidden="true">{shown(inbox.messages)}</span><ChevronRight className={styles.chevron} size={18} aria-hidden="true"/>
        </button>
      </li>}
      {inbox.conversations.map(row => { const Icon = row.kind === 'project' ? FolderKanban : User, kind = row.kind === 'project' ? 'Conversa do projeto' : 'Conversa direta'; return <li key={row.key}>
        <button type="button" className={styles.row} aria-label={`${row.title}, ${kind.toLowerCase()}: ${news(row.unread)}. Abrir a conversa.`} onClick={() => onOpen?.({ tab: 'chat', key: row.key })}>
          <span className={styles.icon} aria-hidden="true"><Icon size={18}/></span>
          <span className={styles.text}><strong>{row.title}</strong><small>{kind} · {news(row.unread)}</small></span>
          <span className={styles.count} aria-hidden="true">{shown(row.unread)}</span><ChevronRight className={styles.chevron} size={18} aria-hidden="true"/>
        </button>
      </li>; })}
      {inbox.moreConversations > 0 && <li>
        <button type="button" className={styles.row} onClick={() => onOpen?.({ tab: 'chat' })}>
          <span className={styles.icon} aria-hidden="true"><MessagesSquare size={18}/></span>
          <span className={styles.text}><strong>Mais {inbox.moreConversations} {inbox.moreConversations === 1 ? 'conversa' : 'conversas'} com novidade</strong><small>Ver todas em Conversas</small></span>
          <span/><ChevronRight className={styles.chevron} size={18} aria-hidden="true"/>
        </button>
      </li>}
    </ul>}
    {empty && !error && <p className={styles.status}><MessagesSquare size={16} aria-hidden="true"/>Nenhum recado ou conversa com novidade.</p>}
  </section>;
}
