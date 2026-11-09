'use client';
/* eslint-disable @next/next/no-img-element -- mascote em SVG estático e imagens locais em data URL */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ImagePlus, LoaderCircle, MessageSquarePlus, Mic, Send, Square, Trash2, X } from 'lucide-react';
import { safeRequest, type AssistantPlan } from '@/lib/assistant/contracts';
import {
  ROLE_MAX_HISTORY, ROLE_MAX_HISTORY_CHARS, ROLE_MAX_IMAGE_BYTES, ROLE_MAX_IMAGE_SIDE, ROLE_MAX_MESSAGE_CHARS, ROLE_MODELS,
  formatMicros, friendlyMicros, roleConversationBytes, roleEstimate, roleSpeechCeilingMicros, type RoleTurn,
} from '@/lib/assistant/role-contracts';
import { prepareSpeechWav } from './speech-audio';
import styles from './role-assistant.module.css';

type Project = { id: string; name: string; organization_id?: string };
type Props = { projects: Project[]; defaultProjectId?: string; onApplied?: () => void | Promise<void>; onOpenSettings?: () => void };
type Status = { available: boolean; reason: string | null; provider: 'deepseek' | 'groq'; model: string; visionAvailable: boolean; operationsAvailable: boolean; speech: { available: boolean; provider: 'groq' | 'deepgram' }; dailyLimitMicros: number; reservedTodayMicros: number };
type Operation = { request: string; stage: 'idle' | 'estimated' | 'preview' | 'done'; costMicros?: number; provider?: string; jev?: boolean; shareConsent?: boolean; stale?: boolean; preview?: { plan: Omit<AssistantPlan, 'actorId'>; planToken: string; undoReason: string }; confirmed?: boolean; receipt?: string; key: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; image?: string; meta?: string; operation?: Operation };
type Picked = { dataUrl: string; bytes: number };
type Recorded = { file: File; seconds: number; url: string };

const intentLabels: Record<string, string> = { 'stock.query': 'Consultar estoque', 'stock.receive': 'Registrar entrada', 'stock.distribute': 'Registrar distribuição', 'stock.consume': 'Registrar consumo', 'record.create': 'Criar registro' };
const suggestions = ['Como registro a entrega de brindes no CONPEEX?', 'Escreva um aviso curto para a equipe sobre o plantão de amanhã.', 'Quais materiais devo conferir antes de uma dinâmica?'];

/** "320 unidades": plural simples para as unidades mais comuns. */
function quantity(value: number, unit: string): string {
  const plural: Record<string, string> = { unidade: 'unidades', caixa: 'caixas', pacote: 'pacotes', kit: 'kits', folha: 'folhas', par: 'pares' };
  return `${value} ${value === 1 ? unit : plural[unit] ?? unit}`;
}

class RequestError extends Error { constructor(readonly status: number, message: string, readonly code?: string) { super(message); } }
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, ...init });
    const body = await response.json().catch(() => null) as (Record<string, unknown> | null);
    if (!response.ok) throw new RequestError(response.status, typeof body?.error === 'string' ? body.error : 'O Rolê não conseguiu responder agora.', typeof body?.code === 'string' ? body.code : undefined);
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('A resposta demorou demais. Nada foi repetido automaticamente.');
    throw error;
  } finally { window.clearTimeout(timer); }
}
const post = <T,>(path: string, body: unknown) => call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) });

/** Reduz no navegador: o original nunca sai do aparelho. */
async function shrinkImage(file: File): Promise<Picked> {
  if (!/^image\/(jpeg|png|webp|heic|heif|gif)$/i.test(file.type)) throw new Error('Escolha uma foto ou imagem (JPG, PNG ou WebP).');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error('Não foi possível abrir esta imagem.')); element.src = url; });
    const scale = Math.min(1, ROLE_MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Este navegador não conseguiu preparar a imagem.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality), bytes = Math.floor((dataUrl.length - 23) * 3 / 4);
      if (bytes <= ROLE_MAX_IMAGE_BYTES) return { dataUrl, bytes };
    }
    throw new Error('A imagem continua grande demais. Tente uma foto menor.');
  } finally { URL.revokeObjectURL(url); }
}

function trimmedHistory(messages: Message[]): RoleTurn[] {
  // Mesma limpeza do servidor (e-mail e CPF omitidos), para o custo previsto bater com o dele.
  const turns: RoleTurn[] = messages.filter(message => message.content.trim()).flatMap(message => { try { return [{ role: message.role, content: safeRequest(message.content.slice(0, 4000)) }]; } catch { return []; } });
  const recent = turns.slice(-ROLE_MAX_HISTORY);
  while (recent.length && recent.reduce((total, turn) => total + turn.content.length, 0) > ROLE_MAX_HISTORY_CHARS) recent.shift();
  return recent;
}

export default function RoleAssistant({ projects, defaultProjectId, onApplied, onOpenSettings }: Props) {
  const [open, setOpen] = useState(false), [chosenProjectId, setProjectId] = useState(defaultProjectId ?? '');
  const projectId = projects.some(item => item.id === chosenProjectId) ? chosenProjectId : projects[0]?.id ?? '';
  const [status, setStatus] = useState<Status | null>(null), [statusError, setStatusError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState(''), [picked, setPicked] = useState<Picked | null>(null);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [recording, setRecording] = useState(false), [recorded, setRecorded] = useState<Recorded | null>(null), [transcribing, setTranscribing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), log = useRef<HTMLOListElement>(null);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), stopTimer = useRef<number | null>(null), mounted = useRef(true);
  const project = projects.find(item => item.id === projectId);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stream.current?.getTracks().forEach(track => track.stop()); if (stopTimer.current) window.clearTimeout(stopTimer.current); }; }, []);

  const loadStatus = useCallback(async (id: string) => {
    if (!id) return;
    setStatus(null); setStatusError('');
    try { const next = await call<Status>(`/api/assistant/role?projectId=${encodeURIComponent(id)}`); if (mounted.current) setStatus(next); }
    catch (cause) { if (mounted.current) setStatusError(cause instanceof Error ? cause.message : 'Não foi possível consultar o Rolê.'); }
  }, []);
  const openRole = useCallback(() => { setOpen(true); void loadStatus(projectId); }, [loadStatus, projectId]);
  // Sonda grátis (sem provedor): o botão só aparece quando o Rolê está ligado para esta pessoa.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    call<Status>(`/api/assistant/role?projectId=${encodeURIComponent(projectId)}`).then(next => { if (alive) setReady(next.available); }).catch(() => { if (alive) setReady(false); });
    return () => { alive = false; };
  }, [projectId]);

  const close = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    setOpen(false);
    window.requestAnimationFrame(() => trigger.current?.focus());
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'r' || event.key === 'R')) { if (!ready && !open) return; event.preventDefault(); if (open) close(); else openRole(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, openRole, ready]);
  useEffect(() => { if (open) window.requestAnimationFrame(() => input.current?.focus()); }, [open]);
  useEffect(() => { log.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }); }, [messages, busy]);

  const sanitized = useMemo(() => { if (!draft.trim()) return { text: '', problem: '' }; try { return { text: safeRequest(draft), problem: '' }; } catch (cause) { return { text: '', problem: cause instanceof Error ? cause.message : 'Revise a mensagem.' }; } }, [draft]);
  const history = useMemo(() => trimmedHistory(messages), [messages]);
  const estimate = useMemo(() => status && sanitized.text ? roleEstimate({ textProvider: status.provider, textBytes: roleConversationBytes(history, sanitized.text, project?.name ?? ''), hasImage: !!picked }) : null, [status, sanitized.text, history, project?.name, picked]);
  const tooLong = draft.length > ROLE_MAX_MESSAGE_CHARS;
  const modelLabel = status ? (picked ? ROLE_MODELS.deepseek.label : ROLE_MODELS[status.provider].label) : '';
  const canSend = !!status?.available && !!estimate && !busy && !tooLong && consent && (!picked || status.visionAvailable);

  // Só em memória: some ao recarregar ou trocar de conta.
  function rememberConsent(value: boolean) { setConsent(value); }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend || !estimate || !status) return;
    const text = sanitized.text, image = picked?.dataUrl;
    const user: Message = { id: crypto.randomUUID(), role: 'user', content: text, image };
    setMessages(current => [...current, user]); setDraft(''); setPicked(null); setBusy(true); setError(''); setNotice('');
    try {
      const result = await post<{ reply: string; operation: string | null; model: string; costMicros: number; reservedMicros: number }>('/api/assistant/role', {
        action: 'chat', projectId, operationKey: crypto.randomUUID(), consent: true, history, message: text, ...(image ? { image } : {}), acceptedCostMicros: estimate.costMicros,
      });
      if (!mounted.current) return;
      const reply: Message = { id: crypto.randomUUID(), role: 'assistant', content: result.reply, meta: `Custou ${friendlyMicros(result.costMicros)}`,
        operation: result.operation ? { request: result.operation, stage: 'idle', key: crypto.randomUUID() } : undefined };
      setMessages(current => [...current, reply]);
      if (reply.operation && status.operationsAvailable) void estimateOperation(reply);
      void loadStatus(projectId);
    } catch (cause) {
      if (!mounted.current) return;
      setMessages(current => current.filter(message => message.id !== user.id)); setDraft(text); if (image && picked) setPicked(picked);
      setError(cause instanceof Error ? cause.message : 'O Rolê não conseguiu responder.');
      if (cause instanceof RequestError && (cause.status === 401 || cause.status === 403)) void loadStatus(projectId);
    } finally { if (mounted.current) setBusy(false); }
  }

  function updateOperation(messageId: string, change: Partial<Operation>) {
    setMessages(current => current.map(message => message.id === messageId && message.operation ? { ...message, operation: { ...message.operation, ...change } } : message));
  }
  async function estimateOperation(message: Message) {
    if (!message.operation) return;
    setError('');
    try { const result = await post<{ costMicros: number; provider: string; jev: boolean }>('/api/assistant/role', { action: 'estimate.operation', projectId, request: message.operation.request }); updateOperation(message.id, { stage: 'estimated', costMicros: result.costMicros, provider: result.provider, jev: result.jev, stale: false }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível calcular o custo da operação.'); }
  }
  function newConversation() { setMessages([]); setDraft(''); setPicked(null); discardRecording(); setError(''); setNotice(''); window.requestAnimationFrame(() => input.current?.focus()); }
  async function prepareOperation(message: Message) {
    if (!message.operation?.shareConsent) return;
    setBusy(true); setError('');
    try { const preview = await post<Operation['preview']>('/api/assistant', { action: 'prepare', projectId, request: message.operation.request, consent: true, operationKey: message.operation.key, acceptedCostMicros: message.operation.costMicros }); updateOperation(message.id, { stage: 'preview', preview, confirmed: false }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a operação.'); }
    finally { setBusy(false); }
  }
  async function applyOperation(message: Message) {
    const operation = message.operation;
    if (!operation?.preview || !operation.confirmed) return;
    setBusy(true); setError('');
    try {
      const saved = await post<{ queried?: boolean; replayed?: boolean }>('/api/assistant', { action: 'apply', planToken: operation.preview.planToken, confirmed: true });
      updateOperation(message.id, { stage: 'done', receipt: saved.queried ? 'Consulta conferida com o saldo atual.' : saved.replayed ? 'Esta operação já tinha sido feita; nada foi repetido.' : 'Operação concluída e registrada no histórico.' });
      await onApplied?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.'); }
    finally { setBusy(false); }
  }

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setError('');
    try { setPicked(await shrinkImage(file)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível usar esta imagem.'); }
  }

  async function startRecording() {
    if (recording || !consent) return;
    setError(''); setRecorded(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este navegador não grava áudio. Escreva a mensagem.');
      const media = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = media;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const instance = new MediaRecorder(media, mime ? { mimeType: mime } : undefined), chunks: BlobPart[] = [];
      recorder.current = instance;
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      instance.onstop = async () => {
        media.getTracks().forEach(track => track.stop()); stream.current = null; setRecording(false);
        if (stopTimer.current) window.clearTimeout(stopTimer.current);
        try {
          const wav = await prepareSpeechWav(new File(chunks, 'gravacao.webm', { type: instance.mimeType || 'audio/webm' }));
          const seconds = Math.max(0, (wav.size - 44) / 32000);
          if (mounted.current) setRecorded({ file: wav, seconds, url: URL.createObjectURL(wav) });
        } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o áudio.'); }
      };
      instance.start(250); setRecording(true);
      stopTimer.current = window.setTimeout(() => { if (instance.state === 'recording') instance.stop(); }, 60_000);
    } catch (cause) { stream.current?.getTracks().forEach(track => track.stop()); setRecording(false); setError(cause instanceof Error ? cause.message : 'O microfone não ficou disponível.'); }
  }
  function discardRecording() { if (recorded) URL.revokeObjectURL(recorded.url); setRecorded(null); }
  async function transcribe() {
    if (!recorded || !status?.speech.available || transcribing) return;
    setTranscribing(true); setError('');
    try {
      const body = new FormData();
      body.set('audio', recorded.file); body.set('projectId', projectId); body.set('operationKey', crypto.randomUUID()); body.set('consent', 'true'); body.set('provider', status.speech.provider);
      const result = await call<{ transcript?: string }>('/api/assistant/speech', { method: 'POST', headers: { 'X-Proex-Action': '1' }, body });
      if (typeof result.transcript !== 'string') throw new Error('A transcrição voltou vazia.');
      setDraft(current => (current ? current + ' ' : '') + result.transcript); discardRecording();
      setNotice('Áudio transcrito. Revise o texto antes de enviar.');
      window.requestAnimationFrame(() => input.current?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível transcrever.'); }
    finally { setTranscribing(false); }
  }

  function onDialogKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]),textarea:not([disabled]),select:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]')];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  if (!projects.length) return null;
  const speechCost = recorded && status ? formatMicros(roleSpeechCeilingMicros(status.speech.provider, recorded.seconds)) : '';
  return <>
    {!open && ready && <button ref={trigger} type="button" className={styles.launcher} aria-haspopup="dialog" aria-keyshortcuts="Alt+R" onClick={openRole} title="Falar com o Rolê (Alt + R)">
      <img src="/brand/role-mascote/role-rosto.svg" alt="" width={44} height={44}/>
      <span className={styles.launcherLabel}>Falar com o Rolê</span>
    </button>}
    {open && <div className={styles.backdrop} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="role-title" aria-describedby="role-subtitle" onKeyDown={onDialogKey}>
        <header className={styles.header}>
          <img className={styles.avatar} src="/brand/role-mascote/role-rosto.svg" alt="" width={48} height={48}/>
          <div className={styles.headerText}><h2 id="role-title">Rolê</h2><p id="role-subtitle">Assistente da PROEX</p></div>
          {messages.length > 0 && <button type="button" className={styles.textButton} onClick={newConversation} disabled={busy} aria-label="Nova conversa"><MessageSquarePlus size={16} aria-hidden="true"/>Nova<span> conversa</span></button>}
          <button type="button" className={styles.iconButton} onClick={close} aria-label="Fechar o Rolê"><X size={20} aria-hidden="true"/></button>
        </header>
        {projects.length > 1 && <label className={styles.project}><span>Projeto</span><select value={projectId} disabled={busy} onChange={event => { setProjectId(event.target.value); setMessages([]); void loadStatus(event.target.value); }}>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <div className={styles.body}>
          {!status && !statusError && <p className={styles.state} role="status"><LoaderCircle size={16} className="p-spin" aria-hidden="true"/>Acordando o Rolê…</p>}
          {statusError && <div className={styles.unavailable} role="alert"><p>{statusError}</p><button type="button" className="p-button p-button-subtle" onClick={() => void loadStatus(projectId)}>Tentar de novo</button></div>}
          {status && !status.available && <div className={styles.unavailable} role="status">
            <img src="/brand/role-mascote/role-frontal.svg" alt="" width={96} height={176} className={styles.fullBody}/>
            <p><strong>O Rolê ainda está desligado aqui.</strong> {status.reason}</p>
            <p className={styles.help}>A administração liga em <strong>Configurações → Chaves e modelos</strong>: cola a chave, testa e ativa o Rolê em “Funções e acesso”.</p>
            {onOpenSettings && <button type="button" className="p-button p-button-subtle" onClick={() => { close(); onOpenSettings(); }}>Abrir Configurações</button>}
          </div>}
          {status?.available && <>
            {!messages.length && <div className={styles.welcome}>
              <img src="/brand/role-mascote/role-frontal.svg" alt="" width={96} height={176} className={styles.fullBody}/>
              <div><p className={styles.hello}>Oi! Eu sou o Rolê.</p><p>Posso tirar dúvidas sobre o portal, escrever textos, olhar uma foto{status.speech.available ? ' e ouvir um áudio' : ''}. Se você pedir uma operação no estoque, eu preparo e você confere antes de valer.</p></div>
              <ul className={styles.suggestions} aria-label="Sugestões">{suggestions.map(text => <li key={text}><button type="button" onClick={() => { setDraft(text); input.current?.focus(); }}>{text}</button></li>)}</ul>
            </div>}
            <ol ref={log} className={styles.log} aria-live="polite" aria-label="Conversa com o Rolê">
              {messages.map(message => <li key={message.id} className={message.role === 'user' ? styles.mine : styles.theirs}>
                {message.role === 'assistant' && <img className={styles.bubbleAvatar} src="/brand/role-mascote/role-rosto.svg" alt="" width={32} height={32}/>}
                <div className={styles.bubble}>
                  <span className="visually-hidden">{message.role === 'user' ? 'Você disse:' : 'Rolê respondeu:'}</span>
                  {message.image && <img className={styles.sentImage} src={message.image} alt="Imagem enviada ao Rolê"/>}
                  <p>{message.content}</p>
                  {message.meta && <small>{message.meta}</small>}
                  {message.operation && <div className={styles.operation}>
                    <p className={styles.operationTitle}>Posso preparar isto para você</p>
                    {(message.operation.stage === 'idle' || message.operation.stage === 'estimated') && status?.operationsAvailable
                      ? <label className={styles.editable}><span>Revise ou corrija o pedido:</span><textarea value={message.operation.request} maxLength={600} rows={2} disabled={busy} onChange={event => updateOperation(message.id, { request: event.target.value, stale: true })}/></label>
                      : message.operation.stage !== 'preview' && message.operation.stage !== 'done' && <p>{message.operation.request}</p>}
                    {message.operation.stage === 'idle' && !status?.operationsAvailable && <p className={styles.help}>As operações pelo Rolê estão desligadas nesta organização. Faça o registro em Materiais.</p>}
                    {message.operation.stage === 'idle' && status?.operationsAvailable && <p className={styles.loadingLine}><LoaderCircle size={14} className="p-spin" aria-hidden="true"/> Calculando o custo…</p>}
                    {message.operation.stage === 'estimated' && <>
                      {message.operation.stale
                        ? <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => void estimateOperation(message)}>Atualizar o custo do pedido corrigido</button>
                        : <p><strong>Custo máximo: {friendlyMicros(message.operation.costMicros ?? 0)}.</strong> Nada muda no estoque até você confirmar.</p>}
                      <label className={styles.check}><input type="checkbox" checked={!!message.operation.shareConsent} disabled={busy} onChange={event => updateOperation(message.id, { shareConsent: event.target.checked })}/>Autorizo enviar este pedido e a lista de materiais do projeto para {message.operation.provider === 'openai' ? 'a OpenAI' : 'a DeepSeek'}{message.operation.jev ? ' e para a conferência JEV (TypeSafe)' : ''}.</label>
                      <button type="button" className="p-button p-button-primary" disabled={busy || !message.operation.shareConsent || message.operation.stale} onClick={() => void prepareOperation(message)}>Preparar registro</button>
                    </>}
                    {message.operation.stage === 'preview' && message.operation.preview && <div className={styles.preview}>
                      <p><strong>Confira: {intentLabels[message.operation.preview.plan.proposal.intent] ?? 'Operação'}</strong></p>
                      <p>{message.operation.preview.plan.before?.name ?? message.operation.preview.plan.proposal.title}</p>
                      {message.operation.preview.plan.before && message.operation.preview.plan.after && <dl className={styles.beforeAfter}><div><dt>Antes</dt><dd>{quantity(message.operation.preview.plan.before.stock, message.operation.preview.plan.before.unit)}</dd></div><div><dt>Depois</dt><dd>{quantity(message.operation.preview.plan.after.stock, message.operation.preview.plan.before.unit)}</dd></div></dl>}
                      <p>Quantidade: {message.operation.preview.plan.proposal.quantity || 'sem movimentação'} · Projeto: {projects.find(item => item.id === message.operation?.preview?.plan.projectId)?.name ?? project?.name ?? 'projeto atual'}</p>
                      {message.operation.preview.plan.proposal.body && <p className={styles.proposalBody}><span>Texto que será gravado:</span> {message.operation.preview.plan.proposal.body}</p>}
                      <label className={styles.check}><input type="checkbox" checked={!!message.operation.confirmed} disabled={busy} onChange={event => updateOperation(message.id, { confirmed: event.target.checked })}/>Conferi os dados acima e autorizo gravar no estoque.</label>
                      <button type="button" className="p-button p-button-primary" disabled={busy || !message.operation.confirmed} onClick={() => void applyOperation(message)}>{message.operation.preview.plan.proposal.intent === 'stock.query' ? 'Conferir saldo atual' : message.operation.preview.plan.proposal.intent === 'record.create' ? 'Gravar o registro' : 'Gravar no estoque'}</button>
                    </div>}
                    {message.operation.stage === 'done' && <p role="status" className={styles.done}>{message.operation.receipt}</p>}
                  </div>}
                </div>
              </li>)}
              {busy && <li className={styles.theirs}><img className={styles.bubbleAvatar} src="/brand/role-mascote/role-rosto.svg" alt="" width={32} height={32}/><div className={styles.bubble}><p className={styles.typing}><LoaderCircle size={16} className="p-spin" aria-hidden="true"/>Pensando…</p></div></li>}
            </ol>
          </>}
        </div>
        {status?.available && <form className={styles.composer} onSubmit={send}>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {notice && !error && <p role="status" className={styles.notice}>{notice}</p>}
          {!consent && <label className={styles.check}><input type="checkbox" checked={consent} onChange={event => rememberConsent(event.target.checked)}/>Entendo que minha mensagem, foto ou áudio vai para um serviço de IA escolhido pela PROEX. Não vou enviar senhas, CPF nem dados pessoais.</label>}
          {picked && <div className={styles.attachment}><img src={picked.dataUrl} alt="Imagem anexada"/><span>Imagem pronta ({Math.round(picked.bytes / 1024)} KB, reduzida no aparelho)</span><button type="button" className={styles.iconButton} onClick={() => setPicked(null)} aria-label="Remover imagem"><Trash2 size={18} aria-hidden="true"/></button></div>}
          {recorded && <div className={styles.attachment}><audio controls src={recorded.url} aria-label="Ouvir a gravação antes de transcrever"/><button type="button" className="p-button p-button-primary" disabled={transcribing || !status.speech.available} onClick={() => void transcribe()}>{transcribing ? 'Transcrevendo…' : `Transcrever · até ${speechCost}`}</button><button type="button" className={styles.iconButton} onClick={discardRecording} aria-label="Descartar gravação"><Trash2 size={18} aria-hidden="true"/></button></div>}
          <label className="visually-hidden" htmlFor="role-message">Mensagem para o Rolê</label>
          <textarea id="role-message" ref={input} value={draft} maxLength={ROLE_MAX_MESSAGE_CHARS + 200} rows={2} placeholder="Escreva para o Rolê…" disabled={busy}
            onChange={event => { setDraft(event.target.value); setNotice(''); }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }}/>
          {(sanitized.problem || tooLong) && <p className={styles.error}>{tooLong ? 'Use até 2.000 caracteres.' : sanitized.problem}</p>}
          {picked && !status.visionAvailable && <p className={styles.error}>A leitura de imagens não está ligada nesta organização.</p>}
          <div className={styles.toolbar}>
            <label className={`${styles.iconButton} ${!status.visionAvailable || busy || !consent ? styles.disabled : ''}`} title={status.visionAvailable ? 'Anexar foto' : 'Leitura de imagens desligada'}>
              <ImagePlus size={20} aria-hidden="true"/><span className="visually-hidden">Anexar foto</span>
              <input type="file" accept="image/*" disabled={!status.visionAvailable || busy || !consent} onChange={event => { void pickImage(event.target.files?.[0]); event.target.value = ''; }}/>
            </label>
            <button type="button" className={`${styles.iconButton} ${recording ? styles.recording : ''}`} disabled={!status.speech.available || !consent || busy || transcribing} onClick={() => recording ? recorder.current?.stop() : void startRecording()} aria-label={recording ? 'Parar gravação' : 'Gravar áudio'} title={status.speech.available ? (recording ? 'Parar gravação' : 'Gravar áudio (até 60 s)') : 'Transcrição desligada'}>
              {recording ? <Square size={18} aria-hidden="true"/> : <Mic size={20} aria-hidden="true"/>}
            </button>
            <p className={styles.cost} aria-live="polite">{!consent ? 'Marque o aviso acima para conversar.' : estimate ? <>Custo máximo: <strong>{(() => { const [words, exact] = friendlyMicros(estimate.costMicros).split(' ('); return exact ? <><span className={styles.nowrap}>{words}</span> <span className={styles.nowrap}>({exact}</span></> : <span className={styles.nowrap}>{words}</span>; })()}</strong></> : 'O custo aparece aqui antes de enviar.'}</p>
            <button type="submit" className={styles.send} disabled={!canSend} aria-label={estimate ? `Enviar, custo máximo ${formatMicros(estimate.costMicros)}` : 'Enviar'}><Send size={18} aria-hidden="true"/><span>Enviar</span></button>
          </div>
          <p className={styles.disclaimer}>O Rolê pode errar. Confira antes de usar. Modelo: {modelLabel}.</p>
        </form>}
      </div>
    </div>}
  </>;
}
