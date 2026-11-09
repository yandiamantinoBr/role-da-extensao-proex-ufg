'use client';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, FolderKanban, ImagePlus, LoaderCircle, MessageCirclePlus, RefreshCw, Send, Smile, Trash2, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { communityGet, communityPost, CommunityError, errorText } from './community-api';
import styles from './community-chat.module.css';

type ProjectRow = { projectId: string; name: string; organizationName: string; conversationId: string | null; lastMessageAt: string | null; unread: number };
type DirectRow = { conversationId: string; organizationId: string; organizationName: string; otherId: string; otherName: string; lastMessageAt: string | null; unread: number };
type Overview = { projects: ProjectRow[]; directs: DirectRow[]; limits: { bodyMax: number; imageMaxBytes: number; retentionDays: number } };
type ChatMessage = { id: string; senderId: string; senderName: string; body: string; createdAt: string; deleted: boolean; attachmentId: string | null; attachmentExpired: boolean; mine: boolean };
type Thread = { conversation: { id: string; kind: 'project' | 'direct' }; messages: ChatMessage[]; lastReadAt: string | null };
type Selected = { key: string; title: string; subtitle: string; open: Record<string, unknown> };
type People = { organizations: { id: string; name: string; people: { id: string; name: string }[] }[]; blocked: string[] };
const API = '/api/community/chat';
const EMOJI = ['😀', '😂', '😊', '😍', '🙏', '👏', '👍', '👎', '🎉', '🙌', '💜', '🔥', '✅', '❗', '❓', '👀', '🤝', '💡', '📌', '📦', '📅', '⏰', '☕', '🚀'];
const time = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value));

/** Re-encodes in the browser: removes EXIF/GPS, keeps orientation, at most 1600 px and about 1 MB. */
export async function prepareChatImage(file: File, maxBytes = 1024 * 1024): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use uma foto JPEG, PNG ou WebP. GIF e HEIC ainda não são aceitos.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('Não foi possível abrir esta imagem. Tente outra foto.'); }
  for (const side of [1600, 1280, 960]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.6]) {
      const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/webp', quality)) ?? await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/jpeg', quality));
      if (blob && blob.size <= maxBytes) { bitmap.close(); return blob; }
    }
  }
  bitmap.close();
  throw new Error('A imagem continua grande demais depois de reduzida. Tente outra.');
}

export function CommunityChat({ onUnreadChange }: { onUnreadChange?(count: number): void }) {
  const [overview, setOverview] = useState<Overview | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0), [selected, setSelected] = useState<Selected | null>(null), [starting, setStarting] = useState(false);
  const unreadCallback = useRef(onUnreadChange);
  useEffect(() => { unreadCallback.current = onUnreadChange; }, [onUnreadChange]);
  useEffect(() => {
    let live = true;
    communityGet<Overview>(API).then(result => { if (!live) return; setOverview(result); setError(''); unreadCallback.current?.([...result.projects, ...result.directs].reduce((sum, row) => sum + Number(row.unread), 0)); }).catch(cause => { if (live) setError(errorText(cause, 'Não foi possível abrir as conversas.')); });
    return () => { live = false; };
  }, [revision]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  if (error) return <p role="alert" className="p-inline-error">{error}</p>;
  if (!overview) return <p role="status" className={styles.help}>Abrindo conversas…</p>;
  return <div className={styles.chat} data-open={selected ? 'thread' : 'list'}>
    <aside className={styles.list} aria-label="Conversas">
      <div className={styles.listHead}><h2>Conversas</h2><button type="button" className="p-icon-button" aria-label="Atualizar conversas" onClick={refresh}><RefreshCw size={18}/></button></div>
      <button type="button" className={`p-button p-button-subtle ${styles.newChat}`} aria-expanded={starting} onClick={() => setStarting(value => !value)}><MessageCirclePlus size={16}/>Nova conversa direta</button>
      {starting && <StartDirect onStart={(row) => { setStarting(false); setSelected(row); }}/>}
      <h3 className={styles.group}>Projetos</h3>
      {!overview.projects.length ? <p className={styles.help}>Você ainda não tem projetos.</p> : <ul>{overview.projects.map(row => { const key = `p:${row.projectId}`; return <li key={key}><button type="button" aria-current={selected?.key === key || undefined} onClick={() => setSelected({ key, title: row.name, subtitle: `Conversa do projeto · ${row.organizationName}`, open: { action: 'open', kind: 'project', projectId: row.projectId } })}>
        <span className={styles.avatar} data-kind="project" aria-hidden="true"><FolderKanban size={16}/></span><span className={styles.rowText}><strong>{row.name}</strong><small>{row.lastMessageAt ? `Última mensagem ${time(row.lastMessageAt)}` : 'Sem mensagens ainda'}</small></span>{row.unread > 0 && <span className={styles.unread} aria-label={`${row.unread} novas`}>{row.unread}</span>}
      </button></li>; })}</ul>}
      <h3 className={styles.group}>Diretas</h3>
      {!overview.directs.length ? <p className={styles.help}>Nenhuma conversa direta.</p> : <ul>{overview.directs.map(row => { const key = `c:${row.conversationId}`; return <li key={key}><button type="button" aria-current={selected?.key === key || undefined} onClick={() => setSelected({ key, title: row.otherName, subtitle: `Conversa direta · ${row.organizationName}`, open: { action: 'open', kind: 'direct', organizationId: row.organizationId, userId: row.otherId } })}>
        <span className={styles.avatar} aria-hidden="true"><User size={16}/></span><span className={styles.rowText}><strong>{row.otherName}</strong><small>{row.lastMessageAt ? `Última mensagem ${time(row.lastMessageAt)}` : 'Sem mensagens ainda'}</small></span>{row.unread > 0 && <span className={styles.unread} aria-label={`${row.unread} novas`}>{row.unread}</span>}
      </button></li>; })}</ul>}
      <p className={styles.help}>Fotos ficam disponíveis por {overview.limits.retentionDays} dias e saem sem dados de localização.</p>
    </aside>
    <section className={styles.thread} aria-label="Conversa aberta">
      {selected ? <ThreadView key={selected.key} selected={selected} limits={overview.limits} onBack={() => { setSelected(null); refresh(); }} onRead={refresh}/>
        : <div className={styles.emptyThread}><MessageCirclePlus size={28} aria-hidden="true"/><p>Escolha um projeto ou uma conversa direta.</p></div>}
    </section>
  </div>;
}

function StartDirect({ onStart }: { onStart(row: Selected): void }) {
  const [people, setPeople] = useState<People | null>(null), [error, setError] = useState(''), [choice, setChoice] = useState('');
  useEffect(() => { let live = true; communityGet<People>('/api/community/messages?view=people').then(result => { if (live) setPeople(result); }).catch(cause => { if (live) setError(errorText(cause)); }); return () => { live = false; }; }, []);
  if (error) return <p role="alert" className="p-inline-error">{error}</p>;
  if (!people) return <p className={styles.help}>Carregando pessoas…</p>;
  const options = people.organizations.flatMap(org => org.people.filter(person => !people.blocked.includes(person.id)).map(person => ({ value: `${org.id}|${person.id}`, label: person.name, org })));
  return <form className={styles.start} onSubmit={event => { event.preventDefault(); const option = options.find(item => item.value === choice); if (option) onStart({ key: `d:${choice}`, title: option.label, subtitle: `Conversa direta · ${option.org.name}`, open: { action: 'open', kind: 'direct', organizationId: option.org.id, userId: choice.split('|')[1] } }); }}>
    <label className={styles.field}><span>Com quem?</span><select name="chat-person" value={choice} onChange={event => setChoice(event.target.value)}><option value="">Escolha a pessoa</option>{people.organizations.map(org => <optgroup key={org.id} label={org.name}>{options.filter(option => option.org.id === org.id).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}</select></label>
    <button type="submit" className="p-button p-button-primary" disabled={!choice}>Abrir conversa</button>
  </form>;
}

function ThreadView({ selected, limits, onBack, onRead }: { selected: Selected; limits: Overview['limits']; onBack(): void; onRead(): void }) {
  const id = useId(), [conversationId, setConversationId] = useState<string | null>(null), [messages, setMessages] = useState<ChatMessage[]>([]), [error, setError] = useState('');
  const [body, setBody] = useState(''), [image, setImage] = useState<{ blob: Blob; url: string } | null>(null), [busy, setBusy] = useState(false), [emoji, setEmoji] = useState(false);
  const key = useRef(''), scroller = useRef<HTMLOListElement>(null), fileInput = useRef<HTMLInputElement>(null), lastRead = useRef<string | null>(null), lastAt = useRef<string | null>(null);
  const merge = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages(current => { const map = new Map(current.map(item => [item.id, item])); for (const item of incoming) map.set(item.id, item); return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)); });
    lastAt.current = incoming.reduce((max, item) => item.createdAt > max ? item.createdAt : max, lastAt.current ?? '');
  }, []);
  // Open (creates the conversation on first use), then poll every 8 s while the page is visible. Reading writes nothing.
  useEffect(() => {
    let live = true, timer = 0;
    const poll = async (cid: string) => {
      if (document.visibilityState === 'visible') {
        try { const result = await communityGet<Thread>(`${API}?conversationId=${encodeURIComponent(cid)}${lastAt.current ? `&after=${encodeURIComponent(lastAt.current)}` : ''}`); if (!live) return; lastRead.current = lastRead.current ?? result.lastReadAt; merge(result.messages); setError(''); }
        catch (cause) { if (live) setError(errorText(cause)); }
      }
      if (live) timer = window.setTimeout(() => void poll(cid), 8000);
    };
    communityPost<{ conversationId: string }>(API, selected.open).then(result => { if (!live) return; setConversationId(result.conversationId); void poll(result.conversationId); }).catch(cause => { if (live) setError(errorText(cause)); });
    return () => { live = false; window.clearTimeout(timer); };
  }, [selected, merge]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [messages.length]);
  // Mark as read only when there is something new from others (one write, not one per poll).
  useEffect(() => {
    if (!conversationId) return;
    const newest = messages.filter(item => !item.mine).at(-1);
    if (newest && (!lastRead.current || newest.createdAt > lastRead.current)) { lastRead.current = newest.createdAt; communityPost(API, { action: 'read', conversationId }).then(onRead).catch(() => undefined); }
  }, [messages, conversationId, onRead]);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  async function pick(file: File | undefined) {
    if (!file) return;
    try { const blob = await prepareChatImage(file); setImage(current => { if (current) URL.revokeObjectURL(current.url); return { blob, url: URL.createObjectURL(blob) }; }); key.current = ''; }
    catch (cause) { toast.error(errorText(cause)); } finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  async function send(event?: FormEvent) {
    event?.preventDefault(); if (!conversationId || busy || (!body.trim() && !image)) return;
    setBusy(true); setError(''); key.current ||= crypto.randomUUID();
    try {
      let attachmentId: string | null = null;
      if (image) {
        const form = new FormData(); form.append('conversationId', conversationId); form.append('file', image.blob, 'foto');
        const response = await fetch(`${API}/media`, { method: 'POST', headers: { 'X-Proex-Action': '1' }, body: form });
        const result = await response.json().catch(() => ({})) as { attachmentId?: string; error?: string; code?: string };
        if (!response.ok || !result.attachmentId) throw new CommunityError(result.error || 'Não foi possível enviar a imagem.', response.status, result.code);
        attachmentId = result.attachmentId;
      }
      await communityPost(API, { action: 'send', conversationId, body, attachmentId, operationKey: key.current });
      key.current = ''; setBody(''); setImage(null); setEmoji(false);
      const result = await communityGet<Thread>(`${API}?conversationId=${encodeURIComponent(conversationId)}${lastAt.current ? `&after=${encodeURIComponent(lastAt.current)}` : ''}`); merge(result.messages);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function remove(message: ChatMessage) {
    try { await communityPost(API, { action: 'delete', messageId: message.id }); setMessages(current => current.map(item => item.id === message.id ? { ...item, deleted: true, body: '', attachmentId: null } : item)); }
    catch (cause) { toast.error(errorText(cause)); }
  }
  function keydown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }
  return <div className={styles.threadInner}>
    <header className={styles.threadHead}>
      <button type="button" className={`p-icon-button ${styles.back}`} aria-label="Voltar às conversas" onClick={onBack}><ArrowLeft size={18}/></button>
      <div><h2 id={`${id}-title`}>{selected.title}</h2><small>{selected.subtitle} · fotos ficam {limits.retentionDays} dias</small></div>
    </header>
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    <ol ref={scroller} className={styles.messages} aria-labelledby={`${id}-title`} aria-live="polite">
      {!messages.length && <li className={styles.emptyMessages}>Nenhuma mensagem ainda. Diga oi!</li>}
      {messages.map(message => <li key={message.id} data-mine={message.mine || undefined}>
        <div className={styles.bubble}>
          {!message.mine && <strong className={styles.sender}>{message.senderName}</strong>}
          {message.deleted ? <em className={styles.deleted}>Mensagem apagada</em> : <>
            {message.attachmentId && <a href={`${API}/media/${message.attachmentId}`} target="_blank" rel="noreferrer" className={styles.photo}>{/* eslint-disable-next-line @next/next/no-img-element -- private authenticated image route, not optimizable */}
              <img src={`${API}/media/${message.attachmentId}`} alt={message.body ? `Foto enviada por ${message.senderName}` : `Foto enviada por ${message.senderName}, sem legenda`} loading="lazy"/></a>}
            {message.attachmentExpired && <em className={styles.deleted}>Foto removida após {limits.retentionDays} dias</em>}
            {message.body && <p>{message.body}</p>}
          </>}
          <span className={styles.meta}><time dateTime={message.createdAt}>{time(message.createdAt)}</time>{message.mine && !message.deleted && <button type="button" className={styles.delete} aria-label="Apagar minha mensagem" title="Apagar" onClick={() => void remove(message)}><Trash2 size={14}/></button>}</span>
        </div>
      </li>)}
    </ol>
    <form className={styles.composer} onSubmit={send}>
      {image && <div className={styles.preview}>{/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
        <img src={image.url} alt="Foto pronta para enviar"/><span>Foto reduzida, sem localização · {(image.blob.size / 1024).toFixed(0)} KB · fica disponível por {limits.retentionDays} dias</span><button type="button" className="p-icon-button" aria-label="Tirar a foto" onClick={() => setImage(null)}><X size={16}/></button></div>}
      {emoji && <div className={styles.emoji} role="group" aria-label="Emojis">{EMOJI.map(item => <button key={item} type="button" aria-label={`Inserir ${item}`} onClick={() => setBody(current => (current + item).slice(0, limits.bodyMax))}>{item}</button>)}</div>}
      <div className={styles.composerRow}>
        <button type="button" className="p-icon-button" aria-label="Emojis" aria-expanded={emoji} onClick={() => setEmoji(value => !value)}><Smile size={19}/></button>
        <button type="button" className="p-icon-button" aria-label={`Anexar foto (fica ${limits.retentionDays} dias, sem localização)`} title={`Fotos ficam ${limits.retentionDays} dias e saem sem localização`} onClick={() => fileInput.current?.click()} disabled={busy}><ImagePlus size={19}/></button>
        <input ref={fileInput} name="chat-photo" type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => void pick(event.target.files?.[0])}/>
        <label className="visually-hidden" htmlFor={`${id}-body`}>Mensagem</label>
        <textarea id={`${id}-body`} name="chat-message" rows={1} maxLength={limits.bodyMax} value={body} placeholder="Mensagem" disabled={busy || !conversationId} onKeyDown={keydown} onChange={event => { setBody(event.target.value); key.current = ''; }}/>
        <button type="submit" className="p-button p-button-primary" disabled={busy || !conversationId || (!body.trim() && !image)} aria-label="Enviar mensagem">{busy ? <LoaderCircle className="p-spin" size={16}/> : <Send size={16}/>}<span className={styles.sendLabel}>Enviar</span></button>
      </div>
      <small className={styles.help}>Enter envia; Shift + Enter quebra a linha. A gestão não lê suas conversas pelo portal; elas só entram na cópia de segurança guardada pela administração.</small>
    </form>
  </div>;
}
