'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Award, Database, Inbox, Mail, MessageCircle, MessageSquareHeart, ShieldCheck, ShieldQuestion } from 'lucide-react';
import type { ModuleId } from './navigation-model';
import { communityGet, errorText } from './community-api';
import { FeedbackForm, FeedbackManagement, type CommunityEvent } from './community-feedback';
import { OmbudsInbox, OmbudsReporter } from './community-ombuds';
import { CommunityMessages } from './community-messages';
import { CommunityBadges } from './community-badges';
import { CommunityChat } from './community-chat';
import { CommunityStorage } from './community-storage';
import styles from './community.module.css';

type Access = { manageFeedback: boolean; ombuds: boolean; administration?: boolean; events: CommunityEvent[]; unreadMessages?: number };
type Tab = 'feedback' | 'chat' | 'messages' | 'ombuds' | 'badges' | 'manage' | 'ombuds-inbox' | 'storage';
const MANAGEMENT: Tab[] = ['manage', 'ombuds-inbox', 'storage'];
const TABS: Tab[] = ['feedback', 'chat', 'messages', 'ombuds', 'badges', 'manage', 'ombuds-inbox', 'storage'];
/** Deep link from e-mail notices: /?module=community&tab=messages. */
function initialTab(): Tab { if (typeof window === 'undefined') return 'feedback'; const value = new URLSearchParams(window.location.search).get('tab'); return TABS.includes(value as Tab) ? value as Tab : 'feedback'; }
export type CommunityPrefill = { area: ModuleId; projectId: string; nonce: number };

/** Community module, phase 1: feedback box, anonymous ombuds and the management boxes. */
export default function CommunityPanel({ userId, projects, prefill }: { userId: string; projects: { id: string; name: string }[]; prefill: CommunityPrefill | null }) {
  const id = useId(), [access, setAccess] = useState<Access | null>(null), [error, setError] = useState(''), [tab, setTab] = useState<Tab>(initialTab), [unread, setUnread] = useState<number | null>(null), [chatUnread, setChatUnread] = useState(0);
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    const controller = new AbortController();
    communityGet<Access>('/api/community', controller.signal).then(setAccess).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause, 'Não foi possível abrir a Comunidade.')); });
    return () => controller.abort();
  }, [userId]);
  const [seenPrefill, setSeenPrefill] = useState(prefill?.nonce ?? 0);
  if (prefill && prefill.nonce !== seenPrefill) { setSeenPrefill(prefill.nonce); setTab('feedback'); }
  const unreadCount = unread ?? access?.unreadMessages ?? 0;
  const available: { id: Tab; label: string; icon: typeof Inbox; count?: number }[] = [
    { id: 'feedback', label: 'Fale com a gestão', icon: MessageSquareHeart },
    { id: 'chat', label: 'Conversas', icon: MessageCircle, count: chatUnread },
    { id: 'messages', label: 'Recados', icon: Mail, count: unreadCount },
    { id: 'ombuds', label: 'Ouvidoria anônima', icon: ShieldQuestion },
    { id: 'badges', label: 'Selos', icon: Award },
    ...(access?.manageFeedback ? [{ id: 'manage' as Tab, label: 'Caixa da gestão', icon: Inbox }] : []),
    ...(access?.ombuds ? [{ id: 'ombuds-inbox' as Tab, label: 'Relatos anônimos', icon: ShieldCheck }] : []),
    ...(access?.administration ? [{ id: 'storage' as Tab, label: 'Espaço', icon: Database }] : []),
  ];
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const index = available.findIndex(item => item.id === tab);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = available[(next + available.length) % available.length];
    setTab(target.id); tabs.current[target.id]?.focus();
  }
  if (error) return <p role="alert" className="p-inline-error">{error}</p>;
  return <div className={styles.community}>
    <label className={styles.sectionPicker}><span>Seção da Comunidade</span><select name="community-section" value={tab} onChange={event => setTab(event.target.value as Tab)}>{available.map(item => <option key={item.id} value={item.id}>{item.label}{item.count ? ` (${item.count} ${item.count === 1 ? 'nova' : 'novas'})` : ''}</option>)}</select></label>
    <div className={styles.tabs} role="tablist" aria-label="Seções da Comunidade" onKeyDown={keyboard}>
      {available.map((item, index) => { const Icon = item.icon; return <button key={item.id} data-management={MANAGEMENT.includes(item.id) || undefined} data-first-management={(MANAGEMENT.includes(item.id) && !MANAGEMENT.includes(available[index - 1]?.id)) || undefined} ref={node => { tabs.current[item.id] = node; }} type="button" role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-${item.id}-panel`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}><Icon size={17} aria-hidden="true"/>{item.label}{item.count ? <span className={styles.count} aria-label={`${item.count} não lidos`}>{item.count}</span> : null}</button>; })}
    </div>
    <div role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}`} className={styles.tabPanel}>
      {tab === 'feedback' && <FeedbackForm key={prefill?.nonce ?? 0} projects={projects} events={access?.events ?? []} prefill={prefill} onOmbuds={() => setTab('ombuds')}/>}
      {tab === 'chat' && <CommunityChat onUnreadChange={setChatUnread}/>}
      {tab === 'messages' && <CommunityMessages onUnreadChange={setUnread}/>}
      {tab === 'storage' && access?.administration && <CommunityStorage/>}
      {tab === 'ombuds' && <OmbudsReporter/>}
      {tab === 'badges' && <CommunityBadges/>}
      {tab === 'manage' && access?.manageFeedback && <FeedbackManagement/>}
      {tab === 'ombuds-inbox' && access?.ombuds && <OmbudsInbox administration={!!access.administration}/>}
    </div>
  </div>;
}
