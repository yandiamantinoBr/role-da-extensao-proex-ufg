'use client';
/* eslint-disable @next/next/no-img-element -- mascote em SVG estático e imagens locais em data URL */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ImagePlus, LoaderCircle, MessageSquarePlus, Mic, Send, Square, Trash2, X } from 'lucide-react';
import { safeRequest, type AssistantPlan } from '@/lib/assistant/contracts';
import {
  ROLE_MAX_HISTORY, ROLE_MAX_HISTORY_CHARS, ROLE_MAX_IMAGE_BYTES, ROLE_MAX_IMAGE_SIDE, ROLE_MAX_MESSAGE_CHARS, ROLE_MODELS,
  formatMicros, friendlyMicros, operationConferenceText, operationsServiceText, roleConversationBytes, roleEstimate, roleSpeechCeilingMicros, speechRouteCeilingMicros, speechRouteName, type RoleTurn, type SpeechRouteModel,
} from '@/lib/assistant/role-contracts';
import { prepareSpeechWav } from './speech-audio';
import AiPeopleUsage from './ai-people-usage';
import { useDockItem } from './floating-dock';
import DestinationField, { destinationFields, loadDestinations } from './destination-field';
import styles from './role-assistant.module.css';

type Project = { id: string; name: string; organization_id?: string };
type Props = { projects: Project[]; defaultProjectId?: string; onApplied?: () => void | Promise<void>; onOpenSettings?: () => void; onOpenLimits?: () => void };
type Pricing = { model: string; label: string; inputMicrosPerToken: number; outputMicrosPerToken: number };
type Status = { available: boolean; reason: string | null; provider: string; model: string; textPricing?: Pricing | null; visionPricing?: Pricing | null; visionAvailable: boolean; operationsAvailable: boolean; speech: { available: boolean; provider: 'groq' | 'deepgram'; route?: string; routeModel?: SpeechRouteModel }; decisionRouteName?: string; dailyLimitMicros: number; reservedTodayMicros: number; canConfigure?: boolean; organizationId?: string; tools?: { text: boolean; vision: boolean }; scopes?: { units: { id: string; name: string }[]; events: { id: string; name: string; projectId: string }[] } };
type Match = { projectId: string; projectName: string; itemName: string; score: number };
type Operation = { request: string; stage: 'idle' | 'estimated' | 'preview' | 'done'; costMicros?: number; provider?: string; jev?: boolean; stale?: boolean; projectId?: string; matches?: Match[]; ambiguous?: boolean; error?: string; limit?: boolean; preview?: { plan: Omit<AssistantPlan, 'actorId'>; planToken: string; undoReason: string }; confirmed?: boolean; receipt?: string; key: string; /** Pedido exatamente como foi enviado para preparar a prévia; vai junto na confirmação. */ prepared?: string; destinationDefault?: string; movementId?: string; destination?: string | null; revise?: 'correct' | 'undo' | null; reviseKey?: string };
type Source = { label: string; href: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; image?: string; meta?: string; operation?: Operation; sources?: Source[] };
type Picked = { dataUrl: string; bytes: number };
type Recorded = { file: File; seconds: number; url: string };

const intentLabels: Record<string, string> = { 'stock.query': 'Consultar estoque', 'stock.receive': 'Registrar entrada', 'stock.distribute': 'Registrar distribuição', 'stock.consume': 'Registrar consumo', 'record.create': 'Criar registro' };
const fallbackSuggestions = ['Como registro a entrega de brindes no CONPEEX?', 'Escreva um aviso curto para a equipe sobre o plantão de amanhã.', 'Quais materiais devo conferir antes de uma dinâmica?'];

/** "320 unidades": plural simples para as unidades mais comuns. */
function quantity(value: number, unit: string): string {
  const plural: Record<string, string> = { unidade: 'unidades', caixa: 'caixas', pacote: 'pacotes', kit: 'kits', folha: 'folhas', par: 'pares' };
  return `${value} ${value === 1 ? unit : plural[unit] ?? unit}`;
}

class RequestError extends Error { constructor(readonly status: number, message: string, readonly code?: string) { super(message); } }
/** Recusa por limite diário (da organização ou a parte de cada pessoa). */
const isLimit = (cause: unknown) => cause instanceof RequestError && (cause.code === 'assistant_quota' || cause.code === 'role_user_quota');
const CONSENT_STORAGE = 'proex-role-ciencia';
/** Preferência da pessoa neste aparelho: 'off' esconde as sugestões e nem consulta o portal. */
const TIPS_STORAGE = 'proex-role-sugestoes';
/** Links externos aceitos nas fontes: só os sites oficiais copiados e publicações do Instagram. */
const OFFICIAL_LINK = /^https:\/\/(proex\.ufg\.br|23conpeex\.plateia\.ufg\.br|www\.instagram\.com|instagram\.com)\//;
const PROVIDER_NAMES: Record<string, string> = { deepseek: 'DeepSeek', groq: 'Groq', openai: 'OpenAI', anthropic: 'Anthropic', nvidia: 'NVIDIA', deepgram: 'Deepgram' };
const providerName = (id: string) => PROVIDER_NAMES[id] ?? id.replace(/^./, letter => letter.toUpperCase());
function modelLabelFor(status: Status, photo: boolean) { return photo ? status.visionPricing?.label ?? ROLE_MODELS.deepseek.label : status.textPricing?.label ?? status.model; }
/** Modelo de voz escolhido no catálogo (destino real do áudio); null quando vale o padrão de hoje. */
function speechRoute(status: Status): { id: string; model: SpeechRouteModel } | null { return status.speech.route && status.speech.routeModel ? { id: status.speech.route, model: status.speech.routeModel } : null; }
/** "DeepSeek (conversa e fotos) e Groq (voz)": só os serviços ligados nesta organização. */
function servicesList(status: Status): string {
  const parts = [`${providerName(status.provider)} (conversa${status.visionAvailable ? ' e fotos' : ''})`];
  const route = speechRoute(status);
  if (status.speech.available) parts.push(route ? `o modelo de voz ${speechRouteName(route.model)}` : `${providerName(status.speech.provider)} (voz)`);
  if (status.operationsAvailable) parts.push(operationsServiceText(status.decisionRouteName));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0];
}
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

export default function RoleAssistant({ projects, defaultProjectId, onApplied, onOpenSettings, onOpenLimits }: Props) {
  const [open, setOpen] = useState(false), [chosenProjectId, setProjectId] = useState(defaultProjectId ?? '');
  // "Procurar em": toda a PROEX (padrão), uma unidade, um projeto ou um evento. O projeto de cobrança e de escrita
  // é o do escopo quando há um; senão, o projeto padrão da pessoa.
  const [scopeValue, setScopeValue] = useState(defaultProjectId ? `project:${defaultProjectId}` : 'org');
  const baseProjectId = projects.some(item => item.id === chosenProjectId) ? chosenProjectId : projects[0]?.id ?? '';
  const [scopeKind, scopeId] = scopeValue === 'org' ? ['org', ''] : [scopeValue.slice(0, scopeValue.indexOf(':')), scopeValue.slice(scopeValue.indexOf(':') + 1)];
  const projectId = scopeKind === 'project' && projects.some(item => item.id === scopeId) ? scopeId : baseProjectId;
  const [status, setStatus] = useState<Status | null>(null), [statusError, setStatusError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState(''), [picked, setPicked] = useState<Picked | null>(null);
  const [ackTick, setAckTick] = useState(0), [sessionAck, setSessionAck] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [limitHit, setLimitHit] = useState(false), [usageOpen, setUsageOpen] = useState(false);
  const usageRange = useMemo(() => { const day = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - offset * 86400000)); return { from: day(29), to: day(0) }; }, [usageOpen]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Doca comum de widgets: quando existe, ela desenha o botão (com o X para esconder); o painel e o Alt+R continuam aqui.
  const dock = useDockItem(ready ? { id: 'role', label: 'Rolê', icon: <img src="/brand/role-mascote/role-rosto.svg" alt="" width={28} height={28}/>, onOpen: openRole, shortcut: 'Alt+R' } : null);
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

  const [tips, setTips] = useState<{ key: string; list: string[] } | null>(null), [tipsTick, setTipsTick] = useState(0);
  const tipsOff = useMemo(() => { try { return window.localStorage.getItem(TIPS_STORAGE) === 'off'; } catch { return false; } }, [tipsTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const tipsWanted = open && !!status?.available && !tipsOff;
  // As sugestões seguem o "Procurar em": ao trocar, as antigas somem na hora e as novas chegam do recorte escolhido.
  const tipsKey = `${projectId}|${scopeValue}`;
  useEffect(() => {
    if (!tipsWanted || !projectId) return;
    let alive = true;
    call<{ suggestions: { text: string }[] }>(`/api/assistant/role?projectId=${encodeURIComponent(projectId)}&suggestions=1&scopeKind=${encodeURIComponent(scopeKind)}${scopeKind === 'org' ? '' : `&scopeId=${encodeURIComponent(scopeId)}`}`).then(result => { if (alive) setTips({ key: tipsKey, list: result.suggestions.map(entry => entry.text).slice(0, 4) }); }).catch(() => { if (alive) setTips({ key: tipsKey, list: [] }); });
    return () => { alive = false; };
  }, [tipsWanted, projectId, scopeKind, scopeId, tipsKey]);
  const suggestions = tips?.key === tipsKey && tips.list.length ? tips.list : tips?.key === tipsKey ? fallbackSuggestions : [];
  function toggleTips() { try { if (tipsOff) window.localStorage.removeItem(TIPS_STORAGE); else window.localStorage.setItem(TIPS_STORAGE, 'off'); } catch { /* sem armazenamento: nada muda */ } setTipsTick(tick => tick + 1); }
  const sanitized = useMemo(() => { if (!draft.trim()) return { text: '', problem: '' }; try { return { text: safeRequest(draft), problem: '' }; } catch (cause) { return { text: '', problem: cause instanceof Error ? cause.message : 'Revise a mensagem.' }; } }, [draft]);
  const history = useMemo(() => trimmedHistory(messages), [messages]);
  const estimate = useMemo(() => status && sanitized.text ? roleEstimate({ textProvider: status.provider === 'groq' ? 'groq' : 'deepseek', textBytes: roleConversationBytes(history, sanitized.text, project?.name ?? ''), hasImage: !!picked, text: status.textPricing, vision: status.visionPricing, tools: picked ? !!status.tools?.vision : !!status.tools?.text }) : null, [status, sanitized.text, history, project?.name, picked]);
  const tooLong = draft.length > ROLE_MAX_MESSAGE_CHARS;
  const modelLabel = status ? modelLabelFor(status, !!picked) : '';
  // Ciência única: guardada neste aparelho e refeita só quando os serviços de IA mudarem.
  const servicesKey = status ? [status.organizationId ?? '', status.provider, modelLabelFor(status, false), status.visionAvailable ? modelLabelFor(status, true) : '', status.speech.available ? speechRoute(status)?.id ?? status.speech.provider : '', status.operationsAvailable ? `ops${status.decisionRouteName ? `:${status.decisionRouteName}` : ''}` : ''].join('|') : '';
  const stored = useMemo(() => { if (!servicesKey) return null; try { return window.localStorage.getItem(CONSENT_STORAGE); } catch { return null; } }, [servicesKey, ackTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const consent = !!servicesKey && (stored === servicesKey || sessionAck === servicesKey);
  function rememberConsent() {
    setSessionAck(servicesKey);
    try { window.localStorage.setItem(CONSENT_STORAGE, servicesKey); } catch { /* sem armazenamento: vale só nesta visita */ }
    setAckTick(value => value + 1);
  }
  const servicesChanged = !!stored && stored !== servicesKey;
  const canSend = !!status?.available && !!estimate && !busy && !tooLong && consent && (!picked || status.visionAvailable);

  // Só em memória: some ao recarregar ou trocar de conta.

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend || !estimate || !status) return;
    const text = sanitized.text, image = picked?.dataUrl;
    const user: Message = { id: crypto.randomUUID(), role: 'user', content: text, image };
    setMessages(current => [...current, user]); setDraft(''); setPicked(null); setBusy(true); setError(''); setNotice(''); setLimitHit(false);
    try {
      const result = await post<{ reply: string; operation: string | null; operationDropped?: boolean; model: string; costMicros: number; reservedMicros: number; sources?: Source[]; lookups?: number }>('/api/assistant/role', {
        action: 'chat', projectId, scope: scopeKind === 'org' ? { kind: 'org' } : { kind: scopeKind, id: scopeId }, operationKey: crypto.randomUUID(), consent: true, history, message: text, ...(image ? { image } : {}), acceptedCostMicros: estimate.costMicros,
      });
      if (!mounted.current) return;
      const reply: Message = { id: crypto.randomUUID(), role: 'assistant', content: result.reply, sources: (result.sources ?? []).filter(source => source.href.startsWith('/?module=') || OFFICIAL_LINK.test(source.href)).slice(0, 6), meta: `Custou ${friendlyMicros(result.costMicros)}${result.lookups ? ` · consultou o portal ${result.lookups === 1 ? '1 vez' : `${result.lookups} vezes`}` : ''}${result.operationDropped ? ' · Não preparei operação: a quantidade não estava na sua mensagem.' : ''}`,
        operation: result.operation ? { request: result.operation, stage: 'idle', key: crypto.randomUUID() } : undefined };
      setMessages(current => [...current, reply]);
      if (reply.operation && status.operationsAvailable) void locateOperation(reply);
      void loadStatus(projectId);
    } catch (cause) {
      if (!mounted.current) return;
      setMessages(current => current.filter(message => message.id !== user.id)); setDraft(text); if (image && picked) setPicked(picked);
      setError(cause instanceof Error ? limitText(cause) : 'O Rolê não conseguiu responder.'); setLimitHit(isLimit(cause));
      if (cause instanceof RequestError && (cause.status === 401 || cause.status === 403)) void loadStatus(projectId);
    } finally { if (mounted.current) setBusy(false); }
  }

  function updateOperation(messageId: string, change: Partial<Operation>) {
    setMessages(current => current.map(message => message.id === messageId && message.operation ? { ...message, operation: { ...message.operation, ...change } } : message));
  }
  /** Grátis: descobre em quais projetos da pessoa existe o material citado e escolhe sozinho só quando não há empate. */
  async function locateOperation(message: Message) {
    if (!message.operation) return;
    let chosen = projectId, matches: Match[] = [], ambiguous = false;
    try {
      const found = await post<{ matches: Match[]; ambiguous: boolean }>('/api/assistant/role', { action: 'match.operation', request: message.operation.request });
      matches = found.matches.filter(match => projects.some(item => item.id === match.projectId)); ambiguous = found.ambiguous;
      const top = matches[0];
      chosen = top ? (matches.some(match => match.projectId === projectId && match.score === top.score) ? projectId : ambiguous ? '' : top.projectId) : projectId;
    } catch { /* sem sugestão: fica o projeto da conversa */ }
    const located = { ...message.operation, projectId: chosen, matches, ambiguous };
    updateOperation(message.id, { projectId: chosen, matches, ambiguous });
    if (chosen) void estimateOperation({ ...message, operation: located });
    else updateOperation(message.id, { stage: 'estimated', stale: true });
  }
  async function estimateOperation(message: Message) {
    if (!message.operation?.projectId) return;
    updateOperation(message.id, { error: '' });
    try { const result = await post<{ costMicros: number; provider: string; jev: boolean }>('/api/assistant/role', { action: 'estimate.operation', projectId: message.operation.projectId, request: message.operation.request }); updateOperation(message.id, { stage: 'estimated', costMicros: result.costMicros, provider: result.provider, jev: result.jev, stale: false }); }
    catch (cause) { updateOperation(message.id, { stage: 'estimated', stale: true, error: cause instanceof Error ? cause.message : 'Não foi possível calcular o custo da operação.' }); }
  }
  function newConversation() { setMessages([]); setDraft(''); setPicked(null); discardRecording(); setError(''); setNotice(''); window.requestAnimationFrame(() => input.current?.focus()); }
  async function prepareOperation(message: Message) {
    if (!message.operation?.projectId) return;
    setBusy(true); setError(''); updateOperation(message.id, { error: '', limit: false });
    try { const preview = await post<Operation['preview']>('/api/assistant', { action: 'prepare', projectId: message.operation.projectId, request: message.operation.request, consent: true, operationKey: message.operation.key, acceptedCostMicros: message.operation.costMicros }); updateOperation(message.id, { stage: 'preview', preview, confirmed: false, prepared: message.operation.request }); if (preview) void suggestDestination(message.id, preview.plan.projectId, message.operation.request); }
    catch (cause) {
      // O servidor respondeu: a próxima tentativa é outra chamada paga, com chave nova e custo mostrado de novo.
      // Tempo esgotado mantém a chave para recuperar o resultado sem pagar duas vezes.
      const answered = cause instanceof RequestError && cause.code !== 'assistant_call_replay';
      updateOperation(message.id, { error: cause instanceof Error ? limitText(cause) : 'Não foi possível preparar a operação.', limit: isLimit(cause), ...(answered ? { key: crypto.randomUUID() } : {}) });
    }
    finally { setBusy(false); }
  }
  /** Pré-preenche o destino quando o pedido cita um destino já cadastrado (ex.: "no CONPEEX"). A pessoa confere e pode trocar. */
  async function suggestDestination(id: string, project: string, request: string) {
    try {
      const options = (await loadDestinations(project)).filter(option => option.status === 'active');
      const text = request.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
      const hit = options.map(option => ({ option, key: option.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() })).filter(entry => entry.key.length >= 3 && text.includes(entry.key)).sort((a, b) => b.key.length - a.key.length)[0];
      if (hit && mounted.current) updateOperation(id, { destinationDefault: hit.option.name });
    } catch { /* sem sugestões: a pessoa digita */ }
  }
  async function applyOperation(message: Message, form?: HTMLFormElement) {
    const operation = message.operation;
    if (!operation?.preview || !operation.confirmed) return;
    const destination = form ? destinationFields(new FormData(form)) : {};
    if (operation.preview.plan.proposal.intent === 'stock.distribute' && !destination.destinationName) { updateOperation(message.id, { error: 'Diga para onde foi a distribuição (evento, local ou parceiro).' }); return; }
    setBusy(true); setError(''); updateOperation(message.id, { error: '' });
    try {
      const saved = await post<{ queried?: boolean; replayed?: boolean; movementId?: string; destination?: { name?: string } | null }>('/api/assistant', { action: 'apply', planToken: operation.preview.planToken, confirmed: true, ...destination, ...(operation.prepared ? { origin: operation.prepared } : {}) });
      updateOperation(message.id, { stage: 'done', movementId: typeof saved.movementId === 'string' ? saved.movementId : undefined, destination: saved.destination?.name ?? destination.destinationName ?? null,
        receipt: saved.queried ? 'Consulta conferida com o saldo atual.' : saved.replayed ? 'Esta operação já tinha sido feita; nada foi repetido.' : `Operação concluída e registrada no histórico${saved.destination?.name ?? destination.destinationName ? ` (destino: ${saved.destination?.name ?? destination.destinationName})` : ''}.` });
      await onApplied?.();
    } catch (cause) { updateOperation(message.id, { error: cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.' }); }
    finally { setBusy(false); }
  }
  /** Corrigir (quantidade ou destino) ou desfazer pelo próprio cartão: mesma regra de Materiais (stock.revise). */
  async function reviseOperation(message: Message, form: HTMLFormElement) {
    const operation = message.operation, plan = operation?.preview?.plan;
    if (!operation?.movementId || !operation.revise || !plan) return;
    const fields = new FormData(form), reason = String(fields.get('reason') ?? '').trim();
    if (reason.length < 3) { updateOperation(message.id, { error: 'Escreva o motivo (pelo menos 3 letras).' }); return; }
    const payload: Record<string, unknown> = { action: 'stock.revise', movementId: operation.movementId, mode: operation.revise, reason, operationKey: operation.reviseKey ?? `role_${crypto.randomUUID().replaceAll('-', '')}` };
    if (operation.revise === 'correct') Object.assign(payload, { quantity: Number(fields.get('quantity')), note: plan.proposal.body || plan.proposal.title, ...destinationFields(fields) });
    setBusy(true); updateOperation(message.id, { error: '', reviseKey: String(payload.operationKey) });
    try {
      const result = await post<{ currentMovementId?: string | null; item?: { stock?: number; unit?: string } }>('/api/portal', payload);
      const next = typeof result.currentMovementId === 'string' ? result.currentMovementId : undefined;
      updateOperation(message.id, { revise: null, reviseKey: undefined, movementId: operation.revise === 'undo' ? undefined : next ?? operation.movementId,
        receipt: operation.revise === 'undo' ? 'Movimentação desfeita. O saldo voltou e o registro original continua no histórico.' : `Correção salva${typeof result.item?.stock === 'number' ? `: saldo agora ${quantity(result.item.stock, result.item.unit ?? 'unidade')}` : ''}.` });
      await onApplied?.();
    } catch (cause) { updateOperation(message.id, { error: cause instanceof Error ? cause.message : 'Não foi possível salvar a correção.' }); }
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
    if (!recorded || !status?.speech.available || transcribing || !consent) return;
    setTranscribing(true); setError(''); setLimitHit(false);
    try {
      const body = new FormData();
      body.set('audio', recorded.file); body.set('projectId', projectId); body.set('operationKey', crypto.randomUUID()); body.set('consent', 'true'); body.set('provider', speechRoute(status)?.id ?? status.speech.provider);
      const result = await call<{ transcript?: string }>('/api/assistant/speech', { method: 'POST', headers: { 'X-Proex-Action': '1' }, body });
      if (typeof result.transcript !== 'string') throw new Error('A transcrição voltou vazia.');
      setDraft(current => (current ? current + ' ' : '') + result.transcript); discardRecording();
      setNotice('Áudio transcrito. Revise o texto antes de enviar.');
      window.requestAnimationFrame(() => input.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? limitText(cause) : 'Não foi possível transcrever.'); setLimitHit(isLimit(cause));
      // O destino do áudio mudou com a tela aberta: nada foi enviado. Recarrega para a pessoa ver o destino novo e confirmar de novo.
      if (cause instanceof RequestError && (cause.code === 'speech_provider_changed' || cause.code === 'speech_configuration_changed')) void loadStatus(projectId);
    }
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
  const voiceRoute = status ? speechRoute(status) : null;
  const speechCost = recorded && status ? formatMicros(voiceRoute ? speechRouteCeilingMicros(voiceRoute.model.style, recorded.seconds, voiceRoute.model.perHour) : roleSpeechCeilingMicros(status.speech.provider, recorded.seconds)) : '';
  // Com o botão na tela, a mensagem aponta para ele em vez de repetir o caminho do menu.
  const limitText = (cause: Error) => isLimit(cause) && status?.canConfigure && onOpenLimits ? cause.message.replace(/Você pode aumentar [^.]*\.$/, 'Use o botão Ajustar limites abaixo.') : cause.message;
  // Quem pode configurar vai direto a Limites e cotas; os outros já recebem na mensagem o nome de quem ajusta.
  const limitsButton = status?.canConfigure && onOpenLimits ? <button type="button" className={`p-button p-button-primary ${styles.limitsButton}`} onClick={() => { close(); onOpenLimits(); }}>Ajustar limites</button> : null;

  return <>
    {!open && ready && !dock.registered && <button ref={trigger} type="button" className={styles.launcher} aria-haspopup="dialog" aria-keyshortcuts="Alt+R" onClick={openRole} title="Falar com o Rolê (Alt + R)">
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
        <label className={styles.project}><span>Procurar em</span><select value={scopeValue} disabled={busy} onChange={event => {
          const value = event.target.value; setScopeValue(value);
          const event_ = value.startsWith('event:') ? status?.scopes?.events.find(entry => entry.id === value.slice(6)) : null;
          const next = value.startsWith('project:') ? value.slice(8) : event_?.projectId && projects.some(item => item.id === event_.projectId) ? event_.projectId : '';
          if (next && next !== projectId) { setProjectId(next); void loadStatus(next); }
        }}>
          <option value="org">Toda a PROEX</option>
          {!!status?.scopes?.units.length && <optgroup label="Unidades">{status.scopes.units.map(unit => <option key={unit.id} value={`unit:${unit.id}`}>{unit.name}</option>)}</optgroup>}
          <optgroup label="Projetos">{projects.map(item => <option key={item.id} value={`project:${item.id}`}>{item.name}</option>)}</optgroup>
          {!!status?.scopes?.events.length && <optgroup label="Eventos e dinâmicas">{status.scopes.events.map(entry => <option key={entry.id} value={`event:${entry.id}`}>{entry.name}</option>)}</optgroup>}
        </select></label>
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
              <div className={styles.tips}>
                <div className={styles.tipsHead}><p id="role-tips-title">{tipsOff ? 'Sugestões escondidas neste aparelho.' : 'Sugestões para você'}</p><button type="button" className={styles.tipsToggle} onClick={toggleTips}>{tipsOff ? 'Mostrar sugestões' : 'Esconder'}</button></div>
                {!tipsOff && <ul className={styles.suggestions} aria-labelledby="role-tips-title">{suggestions.map(text => <li key={text}><button type="button" onClick={() => { setDraft(text); input.current?.focus(); }}>{text}</button></li>)}</ul>}
                {!tipsOff && suggestions.length > 0 && <p className={styles.tipsNote}>Feitas com regras do portal, sem custo de IA: olham a agenda, o que você registrou e o que a sua equipe vê, dentro do que você escolheu em “Procurar em”. Mudam a cada 3 dias.</p>}
              </div>
            </div>}
            <ol ref={log} className={styles.log} aria-live="polite" aria-label="Conversa com o Rolê">
              {messages.map(message => <li key={message.id} className={message.role === 'user' ? styles.mine : styles.theirs}>
                {message.role === 'assistant' && <img className={styles.bubbleAvatar} src="/brand/role-mascote/role-rosto.svg" alt="" width={32} height={32}/>}
                <div className={styles.bubble}>
                  <span className="visually-hidden">{message.role === 'user' ? 'Você disse:' : 'Rolê respondeu:'}</span>
                  {message.image && <img className={styles.sentImage} src={message.image} alt="Imagem enviada ao Rolê"/>}
                  <p>{message.content}</p>
                  {!!message.sources?.length && <div className={styles.sources}><span>Fontes no portal</span><ul>{message.sources.map(source => <li key={source.href}>{source.href.startsWith('/') ? <a href={source.href} onClick={() => close()}>{source.label}</a> : <a href={source.href} target="_blank" rel="noopener noreferrer">{source.label} ↗</a>}</li>)}</ul></div>}
                  {message.meta && <small>{message.meta}</small>}
                  {message.operation && <div className={styles.operation}>
                    <p className={styles.operationTitle}>Posso preparar isto para você</p>
                    {(message.operation.stage === 'idle' || message.operation.stage === 'estimated') && status?.operationsAvailable
                      ? <label className={styles.editable}><span>Revise ou corrija o pedido:</span><textarea value={message.operation.request} maxLength={600} rows={2} disabled={busy} onChange={event => updateOperation(message.id, { request: event.target.value, stale: true })}/></label>
                      : message.operation.stage !== 'preview' && message.operation.stage !== 'done' && <p>{message.operation.request}</p>}
                    {message.operation.stage === 'idle' && !status?.operationsAvailable && <p className={styles.help}>As operações pelo Rolê estão desligadas nesta organização. Faça o registro em Materiais.</p>}
                    {message.operation.stage === 'idle' && status?.operationsAvailable && <p className={styles.loadingLine}><LoaderCircle size={14} className="p-spin" aria-hidden="true"/> Calculando o custo…</p>}
                    {(message.operation.stage === 'idle' || message.operation.stage === 'estimated') && status?.operationsAvailable && <label className={styles.editable}><span>Projeto da operação</span>
                      <select value={message.operation.projectId ?? ''} disabled={busy} onChange={event => { updateOperation(message.id, { projectId: event.target.value, stale: true, key: crypto.randomUUID(), error: '' }); }}>
                        <option value="" disabled>Escolha o projeto</option>
                        {projects.map(item => { const match = message.operation?.matches?.find(entry => entry.projectId === item.id); return <option key={item.id} value={item.id}>{item.name}{match ? ` · tem “${match.itemName}”` : ''}</option>; })}
                      </select>
                      {message.operation.ambiguous && !message.operation.projectId && <span className={styles.warn}>Encontrei este material em mais de um projeto. Escolha qual.</span>}
                      {!!message.operation.matches && !message.operation.matches.length && <span className={styles.warn}>Não achei esse material nos seus projetos. Confira o nome ou o projeto.</span>}
                    </label>}
                    {message.operation.stage === 'estimated' && <>
                      {message.operation.stale
                        ? <button type="button" className="p-button p-button-subtle" disabled={busy || !message.operation.projectId} onClick={() => void estimateOperation(message)}>Calcular o custo</button>
                        : <p><strong>Custo máximo: {friendlyMicros(message.operation.costMicros ?? 0)}.</strong> Nada muda no estoque até você confirmar.</p>}
                      <p className={styles.sendsTo}>O pedido e a lista de materiais do projeto vão para {message.operation.provider === 'openai' ? 'a OpenAI' : 'a DeepSeek'}{message.operation.jev ? operationConferenceText(status?.decisionRouteName) : ''}.</p>
                      <button type="button" className="p-button p-button-primary" disabled={busy || message.operation.stale || !message.operation.projectId} onClick={() => void prepareOperation(message)}>{message.operation.error ? 'Preparar de novo' : 'Preparar registro'}</button>
                    </>}
                    {message.operation.stage === 'preview' && message.operation.preview && <div className={styles.preview}>
                      <p><strong>Confira: {intentLabels[message.operation.preview.plan.proposal.intent] ?? 'Operação'}</strong></p>
                      <p>{message.operation.preview.plan.before?.name ?? message.operation.preview.plan.proposal.title}</p>
                      {message.operation.preview.plan.before && message.operation.preview.plan.after && <dl className={styles.beforeAfter}><div><dt>Antes</dt><dd>{quantity(message.operation.preview.plan.before.stock, message.operation.preview.plan.before.unit)}</dd></div><div><dt>Depois</dt><dd>{quantity(message.operation.preview.plan.after.stock, message.operation.preview.plan.before.unit)}</dd></div></dl>}
                      <p>Quantidade: {message.operation.preview.plan.proposal.quantity || 'sem movimentação'} · Projeto: {projects.find(item => item.id === message.operation?.preview?.plan.projectId)?.name ?? 'projeto escolhido'}</p>
                      {message.operation.preview.plan.proposal.body && <p className={styles.proposalBody}><span>Texto que será gravado:</span> {message.operation.preview.plan.proposal.body}</p>}
                      <form className={styles.confirmForm} onSubmit={event => { event.preventDefault(); void applyOperation(message, event.currentTarget); }}>
                      {['stock.distribute', 'stock.receive', 'stock.consume'].includes(message.operation.preview.plan.proposal.intent) && <DestinationField key={`${message.operation.preview.planToken}:${message.operation.destinationDefault ?? ''}`} projectId={message.operation.preview.plan.projectId} kind={message.operation.preview.plan.proposal.intent.slice(6)} defaultName={message.operation.destinationDefault ?? ''} required={message.operation.preview.plan.proposal.intent === 'stock.distribute'}/>}
                      <label className={styles.check}><input type="checkbox" checked={!!message.operation.confirmed} disabled={busy} onChange={event => updateOperation(message.id, { confirmed: event.target.checked })}/>Conferi os dados acima e autorizo {message.operation.preview.plan.proposal.intent === 'record.create' ? 'gravar o registro' : 'gravar no estoque'}.</label>
                      {message.operation.preview.plan.proposal.intent !== 'stock.query' && <p className={styles.sendsTo}>O histórico vai mostrar que foi feito pelo Rolê a seu pedido{message.operation.prepared ? <>, com este texto: <span className="break-words" style={{ overflowWrap: 'anywhere' }}>“{message.operation.prepared}”</span></> : null}. A equipe do projeto pode ver.</p>}
                      <button type="submit" className="p-button p-button-primary" disabled={busy || !message.operation.confirmed}>{message.operation.preview.plan.proposal.intent === 'stock.query' ? 'Conferir saldo atual' : message.operation.preview.plan.proposal.intent === 'record.create' ? 'Gravar o registro' : 'Gravar no estoque'}</button>
                      </form>
                    </div>}
                    {message.operation.error && <p role="alert" className={styles.error}>{message.operation.error}</p>}
                    {message.operation.limit && limitsButton}
                    {message.operation.stage === 'done' && <p role="status" className={styles.done}>{message.operation.receipt}</p>}
                    {message.operation.stage === 'done' && message.operation.movementId && message.operation.preview && !message.operation.revise && <div className={styles.reviseActions}>
                      <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => updateOperation(message.id, { revise: 'correct', error: '' })}>Corrigir</button>
                      <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => updateOperation(message.id, { revise: 'undo', error: '' })}>Desfazer</button>
                    </div>}
                    {message.operation.stage === 'done' && message.operation.revise && message.operation.preview && <form className={styles.confirmForm} aria-label={message.operation.revise === 'correct' ? 'Corrigir a movimentação' : 'Desfazer a movimentação'} onSubmit={event => { event.preventDefault(); void reviseOperation(message, event.currentTarget); }}>
                      {message.operation.revise === 'correct' && <>
                        <label className="p-field"><span>Quantidade certa</span><input name="quantity" type="number" inputMode="numeric" min={1} max={1000000} step={1} required defaultValue={message.operation.preview.plan.proposal.quantity}/></label>
                        {message.operation.preview.plan.proposal.intent !== 'stock.consume' && <DestinationField projectId={message.operation.preview.plan.projectId} kind={message.operation.preview.plan.proposal.intent.slice(6)} defaultName={message.operation.destination ?? ''} required={message.operation.preview.plan.proposal.intent === 'stock.distribute'}/>}
                      </>}
                      {message.operation.revise === 'undo' && <p className={styles.sendsTo}>O saldo volta ao que era. A movimentação original continua no histórico, marcada como desfeita.</p>}
                      <label className="p-field"><span>Motivo</span><input name="reason" required minLength={3} maxLength={2000} placeholder={message.operation.revise === 'correct' ? 'Ex.: contei de novo, foram 150' : 'Ex.: registrei no projeto errado'}/></label>
                      <div className={styles.reviseActions}>
                        <button type="submit" className="p-button p-button-primary" disabled={busy}>{message.operation.revise === 'correct' ? 'Salvar correção' : 'Desfazer movimentação'}</button>
                        <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => updateOperation(message.id, { revise: null, error: '' })}>Cancelar</button>
                      </div>
                    </form>}
                  </div>}
                </div>
              </li>)}
              {busy && <li className={styles.theirs}><img className={styles.bubbleAvatar} src="/brand/role-mascote/role-rosto.svg" alt="" width={32} height={32}/><div className={styles.bubble}><p className={styles.typing}><LoaderCircle size={16} className="p-spin" aria-hidden="true"/>Pensando…</p></div></li>}
            </ol>
          </>}
        </div>
        {status?.available && <form className={styles.composer} onSubmit={send}>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {error && limitHit && limitsButton}
          {notice && !error && <p role="status" className={styles.notice}>{notice}</p>}
          {!consent && status && <div className={styles.dataNotice} role="note">
            <p><strong>{servicesChanged ? 'O serviço de IA mudou' : 'Antes de começar'}</strong> O que você escrever, fotografar ou gravar vai para {servicesList(status)}, escolhidos pela PROEX, junto com dados do portal que você já pode ver. Não envie senhas, CPF nem dados pessoais.</p>
            <button type="button" className="p-button p-button-primary" onClick={rememberConsent}>Entendi</button>
          </div>}
          {picked && <div className={styles.attachment}><img src={picked.dataUrl} alt="Imagem anexada"/><span>Imagem pronta ({Math.round(picked.bytes / 1024)} KB, reduzida no aparelho)</span><button type="button" className={styles.iconButton} onClick={() => setPicked(null)} aria-label="Remover imagem"><Trash2 size={18} aria-hidden="true"/></button></div>}
          {recorded && <div className={styles.attachment}><audio controls src={recorded.url} aria-label="Ouvir a gravação antes de transcrever"/><button type="button" className="p-button p-button-primary" disabled={transcribing || !status.speech.available || !consent} onClick={() => void transcribe()}>{transcribing ? 'Transcrevendo…' : `Transcrever · até ${speechCost}`}</button><button type="button" className={styles.iconButton} onClick={discardRecording} aria-label="Descartar gravação"><Trash2 size={18} aria-hidden="true"/></button></div>}
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
            <p className={styles.cost} aria-live="polite">{!consent ? 'Toque em Entendi para conversar.' : estimate ? <>Custo máximo: <strong>{(() => { const [words, exact] = friendlyMicros(estimate.costMicros).split(' ('); return exact ? <><span className={styles.nowrap}>{words}</span> <span className={styles.nowrap}>({exact}</span></> : <span className={styles.nowrap}>{words}</span>; })()}</strong></> : 'O custo aparece aqui antes de enviar.'}</p>
            <button type="submit" className={styles.send} disabled={!canSend} aria-label={estimate ? `Enviar, custo máximo ${formatMicros(estimate.costMicros)}` : 'Enviar'}><Send size={18} aria-hidden="true"/><span>Enviar</span></button>
          </div>
          <p className={styles.disclaimer}>O Rolê pode errar. Confira antes de usar. Respondido por {modelLabel} ({providerName(status.provider)}).</p>
          {status.organizationId && <details className={styles.myUsage} onToggle={event => setUsageOpen(event.currentTarget.open)}><summary>Meu uso de IA nos últimos 30 dias</summary>{usageOpen && <AiPeopleUsage organizationId={status.organizationId} from={usageRange.from} to={usageRange.to}/>}</details>}
        </form>}
      </div>
    </div>}
  </>;
}
