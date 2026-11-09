'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Inbox, MessageSquareHeart, ShieldCheck, ShieldQuestion } from 'lucide-react';
import type { ModuleId } from './navigation-model';
import { communityGet, errorText } from './community-api';
import { FeedbackForm, FeedbackManagement, type CommunityEvent } from './community-feedback';
import { OmbudsInbox, OmbudsReporter } from './community-ombuds';
import styles from './community.module.css';

type Access = { manageFeedback: boolean; ombuds: boolean; events: CommunityEvent[] };
type Tab = 'feedback' | 'ombuds' | 'manage' | 'ombuds-inbox';
export type CommunityPrefill = { area: ModuleId; projectId: string; nonce: number };

/** Community module, phase 1: feedback box, anonymous ombuds and the management boxes. */
export default function CommunityPanel({ userId, projects, prefill }: { userId: string; projects: { id: string; name: string }[]; prefill: CommunityPrefill | null }) {
  const id = useId(), [access, setAccess] = useState<Access | null>(null), [error, setError] = useState(''), [tab, setTab] = useState<Tab>('feedback');
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    const controller = new AbortController();
    communityGet<Access>('/api/community', controller.signal).then(setAccess).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause, 'Não foi possível abrir a Comunidade.')); });
    return () => controller.abort();
  }, [userId]);
  const [seenPrefill, setSeenPrefill] = useState(prefill?.nonce ?? 0);
  if (prefill && prefill.nonce !== seenPrefill) { setSeenPrefill(prefill.nonce); setTab('feedback'); }
  const available: { id: Tab; label: string; icon: typeof Inbox }[] = [
    { id: 'feedback', label: 'Enviar retorno', icon: MessageSquareHeart },
    { id: 'ombuds', label: 'Ouvidoria anônima', icon: ShieldQuestion },
    ...(access?.manageFeedback ? [{ id: 'manage' as Tab, label: 'Caixa da gestão', icon: Inbox }] : []),
    ...(access?.ombuds ? [{ id: 'ombuds-inbox' as Tab, label: 'Relatos recebidos', icon: ShieldCheck }] : []),
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
    <div className={styles.tabs} role="tablist" aria-label="Seções da Comunidade" onKeyDown={keyboard}>
      {available.map(item => { const Icon = item.icon; return <button key={item.id} ref={node => { tabs.current[item.id] = node; }} type="button" role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-${item.id}-panel`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}><Icon size={17} aria-hidden="true"/>{item.label}</button>; })}
    </div>
    <div role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}`} className={styles.tabPanel}>
      {tab === 'feedback' && <FeedbackForm key={prefill?.nonce ?? 0} projects={projects} events={access?.events ?? []} prefill={prefill} onOmbuds={() => setTab('ombuds')}/>}
      {tab === 'ombuds' && <OmbudsReporter/>}
      {tab === 'manage' && access?.manageFeedback && <FeedbackManagement/>}
      {tab === 'ombuds-inbox' && access?.ombuds && <OmbudsInbox/>}
    </div>
  </div>;
}
