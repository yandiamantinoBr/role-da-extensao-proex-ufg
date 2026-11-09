'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Ban, EyeOff, LoaderCircle, Lock, Mail, MailOpen, RefreshCw, Reply, Send } from 'lucide-react';
import { toast } from 'sonner';
import { communityGet, communityPost, errorText, instantDay } from './community-api';
import styles from './community.module.css';

type Person = { id: string; name: string };
type Organization = { id: string; name: string; people: Person[] };
type Message = { id: string; organizationId: string; organizationName: string; body: string; createdAt: string; readAt: string | null; senderId: string; senderName: string; recipientId: string; recipientName: string };
type List = { inbox: Message[]; sent: Message[]; unread: number };
const API = '/api/community/messages';

/** Direct messages between people of the same organization. Only sender and recipient read them. */
export function CommunityMessages({ onUnreadChange }: { onUnreadChange?(count: number): void }) {
  const [people, setPeople] = useState<{ organizations: Organization[]; blocked: string[] } | null>(null), [list, setList] = useState<List | null>(null);
  const [error, setError] = useState(''), [box, setBox] = useState<'inbox' | 'sent'>('inbox'), [revision, setRevision] = useState(0), [replyTo, setReplyTo] = useState<{ organizationId: string; recipientId: string; nonce: number } | null>(null);
  const unreadCallback = useRef(onUnreadChange);
  useEffect(() => { unreadCallback.current = onUnreadChange; }, [onUnreadChange]);
  useEffect(() => {
    let live = true;
    Promise.all([communityGet<{ organizations: Organization[]; blocked: string[] }>(`${API}?view=people`), communityGet<List>(API)])
      .then(([nextPeople, nextList]) => { if (!live) return; setPeople(nextPeople); setList(nextList); setError(''); unreadCallback.current?.(nextList.unread); })
      .catch(cause => { if (live) setError(errorText(cause, 'Não foi possível abrir os recados.')); });
    return () => { live = false; };
  }, [revision]);
  const refresh = () => setRevision(value => value + 1);
  async function act(body: Record<string, unknown>, done?: string) {
    try { await communityPost(API, body); if (done) toast.success(done); refresh(); }
    catch (cause) { toast.error(errorText(cause)); }
  }
  if (error) return <p role="alert" className="p-inline-error">{error}</p>;
  if (!people || !list) return <p role="status" className={styles.help}>Abrindo recados…</p>;
  const messages = box === 'inbox' ? list.inbox : list.sent;
  const blocked = people.organizations.flatMap(org => org.people).filter((person, index, all) => people.blocked.includes(person.id) && all.findIndex(other => other.id === person.id) === index);
  return <div className={`${styles.split} ${styles.messagesSplit}`}>
    <NewMessage key={replyTo?.nonce ?? 0} organizations={people.organizations} blocked={people.blocked} initial={replyTo} onSent={refresh}/>
    <section className={styles.card} aria-labelledby="community-messages-title">
      <div className={styles.cardHead}><div><h2 id="community-messages-title">Seus recados</h2><p>Só você e a outra pessoa leem. A gestão não vê seus recados pelo portal.</p></div><button type="button" className="p-icon-button" aria-label="Atualizar recados" onClick={refresh}><RefreshCw size={18}/></button></div>
      <div className={styles.segmented} role="group" aria-label="Caixa de recados">
        <button type="button" aria-pressed={box === 'inbox'} onClick={() => setBox('inbox')}><Mail size={16} aria-hidden="true"/>Recebidos{list.unread > 0 && <span className={styles.count}>{list.unread}</span>}</button>
        <button type="button" aria-pressed={box === 'sent'} onClick={() => setBox('sent')}><Send size={16} aria-hidden="true"/>Enviados</button>
      </div>
      {!messages.length ? <p className={styles.empty}>{box === 'inbox' ? 'Nenhum recado recebido.' : 'Você ainda não enviou recados.'}</p>
        : <ul className={styles.entries}>{messages.map(message => {
          const incoming = box === 'inbox', unread = incoming && !message.readAt;
          return <li key={message.id} className={styles.entry} data-unread={unread || undefined}>
            <div className={styles.entryMeta}>{unread && <span className={styles.status} data-status="new">Novo</span>}<strong className={styles.person}>{incoming ? `De ${message.senderName}` : `Para ${message.recipientName}`}</strong><small>{message.organizationName} · {instantDay(message.createdAt)}{!incoming && (message.readAt ? ' · lido' : ' · ainda não lido')}</small></div>
            <p className={styles.entryBody}>{message.body}</p>
            <div className={styles.manageRow}>
              {incoming && <button type="button" className="p-button p-button-subtle" onClick={() => { setReplyTo({ organizationId: message.organizationId, recipientId: message.senderId, nonce: Date.now() }); if (unread) void act({ action: 'read', id: message.id }); }}><Reply size={16}/>Responder</button>}
              {unread && <button type="button" className={styles.textButton} onClick={() => void act({ action: 'read', id: message.id })}><MailOpen size={15} aria-hidden="true"/>Marcar como lido</button>}
              <span className={styles.quietActions}>
                <button type="button" className={styles.iconAction} aria-label="Ocultar este recado" title="Ocultar" onClick={() => void act({ action: 'hide', id: message.id }, 'Recado ocultado')}><EyeOff size={17}/></button>
                {incoming && <button type="button" className={styles.textButton} aria-label={`Bloquear ${message.senderName}`} onClick={() => void act({ action: 'block', userId: message.senderId }, `${message.senderName} não pode mais mandar recados para você`)}><Ban size={15} aria-hidden="true"/>Bloquear</button>}
              </span>
            </div>
          </li>;
        })}</ul>}
      {blocked.length > 0 && <details className={styles.anonymity}><summary><Ban size={16} aria-hidden="true"/>Pessoas bloqueadas ({blocked.length})</summary><ul>{blocked.map(person => <li key={person.id}>{person.name} <button type="button" className={styles.textButton} onClick={() => void act({ action: 'unblock', userId: person.id }, 'Desbloqueado')}>Desbloquear</button></li>)}</ul></details>}
      <p className={styles.help}>Mostramos os 100 mais recentes de cada caixa. Para denunciar abuso sem se identificar, use a ouvidoria.</p>
    </section>
  </div>;
}

function NewMessage({ organizations, blocked, initial, onSent }: { organizations: Organization[]; blocked: string[]; initial: { organizationId: string; recipientId: string } | null; onSent(): void }) {
  const id = useId(), key = useRef('');
  const [organizationId, setOrganizationId] = useState(initial?.organizationId ?? organizations[0]?.id ?? ''), [recipientId, setRecipientId] = useState(initial?.recipientId ?? ''), [body, setBody] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const organization = organizations.find(org => org.id === organizationId), recipients = (organization?.people ?? []).filter(person => !blocked.includes(person.id));
  const missing = [!recipientId && 'escolher a pessoa', !body.trim() && 'escrever o recado'].filter(Boolean) as string[];
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || missing.length) return; setBusy(true); setError(''); key.current ||= crypto.randomUUID();
    try { await communityPost(API, { action: 'send', organizationId, recipientId, body, operationKey: key.current }); key.current = ''; setBody(''); toast.success('Recado enviado'); onSent(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  if (!organizations.length) return <section className={styles.card}><div className={styles.cardHead}><h2>Novo recado</h2><p>Ainda não há outras pessoas na sua organização para receber recados.</p></div></section>;
  return <form className={styles.card} onSubmit={submit} aria-labelledby={`${id}-title`}>
    <div className={styles.cardHead}><h2 id={`${id}-title`}>Novo recado</h2><p>Uma mensagem direta, sem WhatsApp nem e-mail.</p></div>
    <div className={styles.fields}>
      {organizations.length > 1 && <label className={styles.field}><span>Organização</span><select value={organizationId} disabled={busy} onChange={event => { setOrganizationId(event.target.value); setRecipientId(''); key.current = ''; }}>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
      <label className={styles.field}><span>Para</span><select value={recipientId} disabled={busy} onChange={event => { setRecipientId(event.target.value); key.current = ''; }}><option value="">Escolha a pessoa</option>{recipients.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    </div>
    <label className={styles.field} htmlFor={`${id}-body`}><span>Recado</span></label>
    <textarea id={`${id}-body`} className={styles.textarea} maxLength={1000} value={body} disabled={busy} onChange={event => { setBody(event.target.value); key.current = ''; }} placeholder="Escreva o recado. Para passar uma demanda, use a transferência em Demandas e avise por aqui." aria-describedby={`${id}-help`}/>
    <p id={`${id}-help`} className={styles.help}>{body.length}/1.000{missing.length ? ` · Para enviar, falta ${missing.join(' e ')}.` : ''}</p>
    <p className={styles.callout}><Lock size={16} aria-hidden="true"/><span>Só você e a pessoa leem este recado. Não use para senhas ou dados pessoais desnecessários.</span></p>
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    <button type="submit" className="p-button p-button-primary" disabled={busy || missing.length > 0}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Send size={16}/>}Enviar recado</button>
  </form>;
}
