'use client';
/* eslint-disable @next/next/no-img-element -- mascote em SVG estático e imagens locais em data URL */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, Film, FileAudio, FileText, ImagePlus, Landmark, LoaderCircle, MessageSquarePlus, Mic, Send, Square, Trash2, X } from 'lucide-react';
import { safeRequest, type AssistantPlan } from '@/lib/assistant/contracts';
import {
  ROLE_MAX_HISTORY, ROLE_MAX_HISTORY_CHARS, ROLE_MAX_IMAGE_BYTES, ROLE_MAX_IMAGE_SIDE, ROLE_MAX_MESSAGE_CHARS, ROLE_MODELS,
  formatMicros, friendlyMicros, operationConferenceText, operationsConferenceSentence, operationsServiceText, roleConversationBytes, roleEstimate, roleSpeechCeilingMicros, shownRouteName, speechRouteCeilingMicros, speechRouteName, type RoleTurn, type SpeechRouteModel,
} from '@/lib/assistant/role-contracts';
import { prepareSpeechWav } from './speech-audio';
import { RoleLocalPlayer, type RoleLocalMedia } from './role-local-media';
import RoleDocumentCard, { type RoleDocumentRevision } from './role-document-card';
import RoleTaskDraftCard, { roleTaskDraftFrom, type RoleTaskDraftStatus, type RoleTaskDraftView } from './role-task-draft-card';
import RoleScannedPdfCard, { roleScannedPdfFrom, type RoleScannedPdfOffer } from './role-scanned-pdf-card';
import { ROLE_DOCUMENT_EXCERPT_LIMIT, roleDocumentExcerpt, roleDocumentMessage, type RoleDocumentExcerpt, type RoleDocumentPreview } from '@/lib/assistant/role-document-contracts';
import { MAX_UPLOAD_FILE_BYTES } from '@/lib/upload-limits';
import AiPeopleUsage from './ai-people-usage';
import { createPortal } from 'react-dom';
import { useDockItem, useMobileDockToolbar } from './floating-dock';
import DestinationField, { destinationFields, loadDestinations } from './destination-field';
import { officialRoute, roleComposerMode } from '@/lib/assistant/official-search-intent';
import { officialPdfUrl } from '@/lib/assistant/official-pdf-url';
import { ROLE_VIDEO_MAX_BYTES, ROLE_VIDEO_MAX_SECONDS, ROLE_VIDEO_MIN_SECONDS, ROLE_VIDEO_MIME, ROLE_VIDEO_EFFORT_LABELS, roleVideoEstimate, type RoleVideoStatus } from '@/lib/assistant/role-video-contracts';
import { roleHistoryForPolicy } from '@/lib/assistant/role-policy';
import styles from './role-assistant.module.css';

type Project = { id: string; name: string; organization_id?: string };
type Props = { projects: Project[]; defaultProjectId?: string; onApplied?: () => void | Promise<void>; onOpenSettings?: () => void; onOpenLimits?: () => void };
type Pricing = { model: string; label: string; inputMicrosPerToken: number; outputMicrosPerToken: number };
type Status = { document?: { approval: string; canSaveToRecords: boolean }; video?: RoleVideoStatus; policy?: { historyMessages: number; inputCeiling: number; maxOutputTokens: number; reasoningCarry: boolean; publicSearch: boolean }; available: boolean; reason: string | null; provider: string; model: string; textPricing?: Pricing | null; visionPricing?: Pricing | null; visionAvailable: boolean; operationsAvailable: boolean; speech: { available: boolean; provider: 'groq' | 'deepgram'; route?: string; routeModel?: SpeechRouteModel }; decisionRouteName?: string; dailyLimitMicros: number; reservedTodayMicros: number; canConfigure?: boolean; organizationId?: string; tools?: { text: boolean; vision: boolean }; scopes?: { units: { id: string; name: string }[]; events: { id: string; name: string; projectId: string }[] } };
type Match = { projectId: string; projectName: string; itemName: string; score: number };
type Operation = { request: string; stage: 'idle' | 'estimated' | 'preview' | 'done'; costMicros?: number; provider?: string; jev?: boolean; /** Modelo que confere, como veio da estimativa (vazio = padrão do portal). É o nome que o aviso mostra e que vai no preparo. */ decisionDestination?: string; decisionApproval?: string; stale?: boolean; projectId?: string; matches?: Match[]; ambiguous?: boolean; error?: string; limit?: boolean; preview?: { plan: Omit<AssistantPlan, 'actorId'>; planToken: string; undoReason: string }; confirmed?: boolean; receipt?: string; key: string; /** Pedido exatamente como foi enviado para preparar a prévia; vai junto na confirmação. */ prepared?: string; destinationDefault?: string; movementId?: string; destination?: string | null; revise?: 'correct' | 'undo' | null; reviseKey?: string };
type Source = { label: string; href: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; image?: string; video?: true; official?: true; isolated?: true; document?: RoleDocumentPreview; documentRevision?: RoleDocumentRevision; media?: RoleLocalMedia; meta?: string; operation?: Operation; sources?: Source[]; taskDraft?: RoleTaskDraftView; taskDraftStatus?: RoleTaskDraftStatus; pdfReading?: RoleScannedPdfOffer; notice?: string; focusOnShow?: true };
type Picked = { dataUrl: string; bytes: number };
type Recorded = { file: File; seconds: number };

const intentLabels: Record<string, string> = { 'stock.query': 'Consultar estoque', 'stock.receive': 'Registrar entrada', 'stock.distribute': 'Registrar distribuição', 'stock.consume': 'Registrar consumo', 'record.create': 'Criar registro' };
const fallbackSuggestions = ['Como registro a entrega de brindes no CONPEEX?', 'Escreva um aviso curto para a equipe sobre o plantão de amanhã.', 'Quais materiais devo conferir antes de uma dinâmica?'];

/** "320 unidades": plural simples para as unidades mais comuns. */
function quantity(value: number, unit: string): string {
  const plural: Record<string, string> = { unidade: 'unidades', caixa: 'caixas', pacote: 'pacotes', kit: 'kits', folha: 'folhas', par: 'pares' };
  return `${value} ${value === 1 ? unit : plural[unit] ?? unit}`;
}

/** Leva o foco à nova resposta da leitura com IA, como o cartão do rascunho faz. */
const focusOnMount = (node: HTMLElement | null) => { node?.focus(); };

class RequestError extends Error { constructor(readonly status: number, message: string, readonly code?: string) { super(message); } }
/** Recusa por limite diário (da organização ou a parte de cada pessoa). */
const isLimit = (cause: unknown) => cause instanceof RequestError && (cause.code === 'assistant_quota' || cause.code === 'role_user_quota');
const CONSENT_STORAGE = 'proex-role-ciencia';
/** Preferência da pessoa neste aparelho: 'off' esconde as sugestões e nem consulta o portal. */
const TIPS_STORAGE = 'proex-role-sugestoes';
/** Links externos aceitos nas fontes: só os sites oficiais copiados e publicações do Instagram. */
const OFFICIAL_LINK = /^https:\/\/(proex\.ufg\.br|23conpeex\.plateia\.ufg\.br|analisa\.ufg\.br|centrodeeventos\.ufg\.br|www\.instagram\.com|instagram\.com)\//;
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
  if (status.operationsAvailable) parts.push(operationsServiceText());
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0];
}
async function call<T>(path: string, init?: RequestInit, timeoutMs = 45_000): Promise<T> {
  const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), timeoutMs);
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
const post = <T,>(path: string, body: unknown, timeoutMs?: number) => call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) }, timeoutMs);

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

function sendableVideo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === 'string' ? reader.result.split(',')[1] : null;
      if (data) resolve(`data:${ROLE_VIDEO_MIME};base64,${data}`);
      else reject(new Error('Não foi possível ler o vídeo.'));
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o vídeo.'));
    reader.readAsDataURL(file);
  });
}

function trimmedHistory(messages: Message[]): RoleTurn[] {
  // Mesma limpeza do servidor (e-mail e CPF omitidos), para o custo previsto bater com o dele.
  const turns: RoleTurn[] = messages.filter(message => !message.video && !message.official && !message.isolated && message.content.trim()).flatMap(message => { try { return [{ role: message.role, content: safeRequest(message.content.slice(0, 4000)) }]; } catch { return []; } });
  const recent = turns.slice(-ROLE_MAX_HISTORY);
  while (recent.length && recent.reduce((total, turn) => total + turn.content.length, 0) > ROLE_MAX_HISTORY_CHARS) recent.shift();
  return recent;
}

export default function RoleAssistant(props: Props) {
  const accessKey = JSON.stringify(props.projects.map(project => project.id).sort());
  return <RoleConversation key={accessKey} {...props}/>;
}

function RoleConversation({ projects, defaultProjectId, onApplied, onOpenSettings, onOpenLimits }: Props) {
  const [open, setOpen] = useState(false), [chosenProjectId, setProjectId] = useState(defaultProjectId ?? '');
  // "Procurar em": toda a PROEX (padrão), uma unidade, um projeto ou um evento. O projeto de cobrança e de escrita
  // é o do escopo quando há um; senão, o projeto padrão da pessoa.
  const [scopeValue, setScopeValue] = useState(defaultProjectId ? `project:${defaultProjectId}` : 'org');
  const baseProjectId = projects.some(item => item.id === chosenProjectId) ? chosenProjectId : projects[0]?.id ?? '';
  const [scopeKind, scopeId] = scopeValue === 'org' ? ['org', ''] : [scopeValue.slice(0, scopeValue.indexOf(':')), scopeValue.slice(scopeValue.indexOf(':') + 1)];
  const projectId = scopeKind === 'project' && projects.some(item => item.id === scopeId) ? scopeId : baseProjectId;
  const [status, setStatus] = useState<Status | null>(null), [statusError, setStatusError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState(''), [picked, setPicked] = useState<Picked | null>(null);
  const [documentDraft, setDocumentDraft] = useState<{ name: string; excerpt: RoleDocumentExcerpt } | null>(null);
  const [documentConsent, setDocumentConsent] = useState<string | null>(null), [readingDocument, setReadingDocument] = useState(false);
  const copies = useRef(new Map<string, { content: string; operationKey: string; occurredAt: string }>());
  const [video, setVideo] = useState<{ file: File; seconds: number | null } | null>(null);
  const [videoConsent, setVideoConsent] = useState(false);
  function clearVideo() { setVideo(null); setVideoConsent(false); }
  const [ackTick, setAckTick] = useState(0), [sessionAck, setSessionAck] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [limitHit, setLimitHit] = useState(false);
  const [usageRange, setUsageRange] = useState<{ from: string; to: string } | null>(null);
  // "Buscar em fontes oficiais": com a alternância ligada, o envio vai direto à busca oficial (sem IA, sem custo, sem anexo).
  const [officialMode, setOfficialMode] = useState(false);
  const [recording, setRecording] = useState(false), [recorded, setRecorded] = useState<Recorded | null>(null), [transcribing, setTranscribing] = useState(false), [preparingAudio, setPreparingAudio] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), log = useRef<HTMLOListElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), stopTimer = useRef<number | null>(null), mounted = useRef(true);
  const conversationEpoch = useRef(0), captureEpoch = useRef(0), statusEpoch = useRef(0);
  /** Chaves de leitura com IA em andamento: ignora o segundo toque no mesmo botão. */
  const pendingPdf = useRef<Set<string>>(new Set());
  // Último modo carregado: a conversa só é apagada quando a conversa com IA deixa de existir, não a cada recarga.
  const previousMode = useRef<ReturnType<typeof roleComposerMode>>('off');
  const project = projects.find(item => item.id === projectId);
  const resetConversation = useCallback(() => {
    conversationEpoch.current++;
    captureEpoch.current++;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    copies.current.clear();
    setDocumentDraft(null); setDocumentConsent(null); setReadingDocument(false);
    setMessages([]); setDraft(''); setPicked(null); setVideo(null); setVideoConsent(false);
    setRecorded(null); setRecording(false); setTranscribing(false); setPreparingAudio(false); setBusy(false);
    setError(''); setNotice(''); setLimitHit(false);
  }, []);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stream.current?.getTracks().forEach(track => track.stop()); if (stopTimer.current) window.clearTimeout(stopTimer.current); }; }, []);

  // keep: recarga depois de uma resposta não desmonta a conversa (o cartão de rascunho guarda estado vivo).
  // A conversa só é apagada quando o modo sai de "chat" (resetConversation abaixo), como antes.
  const loadStatus = useCallback(async (id: string, options?: { keep?: boolean }) => {
    if (!id) return;
    if (!options?.keep) setStatus(null);
    setStatusError('');
    const epoch = ++statusEpoch.current;
    try {
      const next = await call<Status>(`/api/assistant/role?projectId=${encodeURIComponent(id)}`);
      if (!mounted.current || statusEpoch.current !== epoch) return;
      const nextMode = roleComposerMode(next);
      if (previousMode.current === 'chat' && nextMode !== 'chat') resetConversation();
      previousMode.current = nextMode;
      // Sem botão visível, sem busca invisível ligada: o status só muda aqui e na recusa da busca desligada.
      if (nextMode !== 'chat' || !next.policy?.publicSearch) setOfficialMode(false);
      setStatus(next);
    } catch (cause) {
      if (!mounted.current || statusEpoch.current !== epoch) return;
      if (cause instanceof RequestError && (cause.status === 401 || cause.status === 403)) resetConversation();
      setStatusError(cause instanceof Error ? cause.message : 'Não foi possível consultar o Rolê.');
    }
  }, [resetConversation]);
  const openRole = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
    void loadStatus(projectId);
  }, [loadStatus, projectId]);
  // Sonda grátis (sem provedor): o botão só aparece quando o Rolê está ligado para esta pessoa.
  const [ready, setReady] = useState(false);
  // Doca comum de widgets: quando existe, ela desenha o botão (com o X para esconder); o painel e o Alt+R continuam aqui.
  const dock = useDockItem(ready ? { id: 'role', label: 'Rolê', icon: <img src="/brand/role-mascote/role-rosto.svg" alt="" width={28} height={28}/>, onOpen: openRole, shortcut: 'Alt+R' } : null);
  const toolbar = useMobileDockToolbar();
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    call<Status>(`/api/assistant/role?projectId=${encodeURIComponent(projectId)}`).then(next => { if (alive) setReady(roleComposerMode(next) !== 'off'); }).catch(() => { if (alive) setReady(false); });
    return () => { alive = false; };
  }, [projectId]);

  const close = useCallback((restoreFocus = true) => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    setOpen(false);
    setVideo(null); setVideoConsent(false);
    if (!restoreFocus) return;
    window.requestAnimationFrame(() => {
      const opener = returnFocus.current;
      const target = opener?.isConnected && opener.getClientRects().length && opener !== document.body ? opener
        : trigger.current ?? document.querySelector<HTMLElement>('[data-dock-toggle]') ?? document.getElementById('main');
      target?.focus({ preventScroll: true });
    });
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'r' || event.key === 'R')) { if (!ready && !open) return; event.preventDefault(); if (open) close(); else openRole(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, openRole, ready]);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = dialog.current;
      if (panel && (!panel.contains(document.activeElement) || document.activeElement === panel)) {
        (input.current ?? panel).focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, status?.available]);
  useEffect(() => { log.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }); }, [messages.length, busy, open, status?.available]);

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
  const history = useMemo(() => roleHistoryForPolicy(trimmedHistory(messages), status?.policy?.historyMessages ?? ROLE_MAX_HISTORY), [messages, status?.policy?.historyMessages]);
  const documentInput = useMemo(() => {
    if (!documentDraft) return { excerpt: null, problem: '' };
    try { return { excerpt: roleDocumentExcerpt(documentDraft.excerpt), problem: '' }; }
    catch (cause) { return { excerpt: null, problem: cause instanceof Error ? cause.message : 'Confira o trecho.' }; }
  }, [documentDraft]);
  // Conversa com IA, só a busca oficial (sem chave de conversa) ou nada.
  const mode = roleComposerMode(status), chatOn = mode === 'chat', searchOnly = mode === 'search';
  const attachment = !!documentDraft || !!video || !!picked;
  const officialOn = chatOn && officialMode && !!status?.policy?.publicSearch;
  const route = officialRoute({ mode, toggled: officialMode, publicSearch: !!status?.policy?.publicSearch, attachment, text: sanitized.text });
  const officialLookup = route.official;
  // Leitura com IA em andamento: o cartão já mostra "Lendo o PDF com IA…"; sem o "Pensando…" repetido.
  const readingPdf = messages.some(message => message.pdfReading?.reading);
  function toggleOfficial() { setOfficialMode(value => !value); setError(''); }
  const officialCost = <>Consulta às fontes oficiais, <span className={styles.nowrap}>sem custo de IA.</span></>;
  const videoQuote = video?.seconds && status?.video && sanitized.text ? roleVideoEstimate({
    textBytes: new TextEncoder().encode(sanitized.text).byteLength,
    maxOutputTokens: status.policy?.maxOutputTokens ?? 700,
    seconds: video.seconds, model: status.video.model,
  }) : null;
  const videoOverInput = !!videoQuote && !!status?.policy?.inputCeiling && videoQuote.inputTokens > status.policy.inputCeiling;
  const textEstimate = useMemo(() => status && sanitized.text ? roleEstimate({ textProvider: status.provider === 'groq' ? 'groq' : 'deepseek', textBytes: roleConversationBytes(documentDraft ? [] : history, documentInput.excerpt ? roleDocumentMessage(sanitized.text, documentInput.excerpt) : sanitized.text, project?.name ?? ''), hasImage: !!picked, text: status.textPricing, vision: status.visionPricing, tools: !documentDraft && (picked ? !!status.tools?.vision : !!status.tools?.text), inputCeiling: status.policy?.inputCeiling, maxOutputTokens: status.policy?.maxOutputTokens, reasoningCarry: !picked && status.policy?.reasoningCarry }) : null, [status, sanitized.text, history, project?.name, picked, documentDraft, documentInput.excerpt]);
  const estimate = video ? videoQuote : textEstimate;
  const tooLong = draft.length > ROLE_MAX_MESSAGE_CHARS;
  const videoLabel = status?.video ? `${status.video.label} · ${ROLE_VIDEO_EFFORT_LABELS[status.video.effort]}` : 'Google Gemini';
  const modelLabel = video ? videoLabel : status ? modelLabelFor(status, !!picked) : '';
  // Ciência única: guardada neste aparelho e refeita só quando os serviços de IA mudarem.
  const servicesKey = status ? [status.organizationId ?? '', status.provider, modelLabelFor(status, false), status.visionAvailable ? modelLabelFor(status, true) : '', status.speech.available ? speechRoute(status)?.model.approval ?? speechRoute(status)?.id ?? status.speech.provider : '', status.operationsAvailable ? `ops${status.decisionRouteName ? `:${status.decisionRouteName}` : ''}` : ''].join('|') : '';
  const stored = useMemo(() => { if (!servicesKey) return null; try { return window.localStorage.getItem(CONSENT_STORAGE); } catch { return null; } }, [servicesKey, ackTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const consent = !!servicesKey && (stored === servicesKey || sessionAck === servicesKey);
  function rememberConsent() {
    setSessionAck(servicesKey);
    try { window.localStorage.setItem(CONSENT_STORAGE, servicesKey); } catch { /* sem armazenamento: vale só nesta visita */ }
    setAckTick(value => value + 1);
  }
  const servicesChanged = !!stored && stored !== servicesKey;
  const canSend = officialLookup
    ? !!sanitized.text && !busy && !transcribing && !recording && !preparingAudio && !readingDocument && !tooLong && (route.explicit || consent)
    : !!status?.available && !!estimate && !busy && !transcribing && !recording && !preparingAudio && !readingDocument && !tooLong && consent && (!documentDraft || !!(documentInput.excerpt && status.document && documentConsent === status.document.approval)) && (!picked || status.visionAvailable) && (!video || !!status.video && videoConsent && !videoOverInput);

  // Só em memória: some ao recarregar ou trocar de conta.

  /** Só com o toque: o servidor baixa de novo o PDF oficial, confere a oferta assinada e o teto e manda ao Gemini uma vez por chave. */
  async function readScannedPdf(messageId: string) {
    const offer = messages.find(message => message.id === messageId)?.pdfReading;
    // Dois toques seguidos: a chave em andamento ignora o segundo antes de qualquer renderização.
    if (!offer || offer.reading || offer.done || busy || pendingPdf.current.has(offer.key)) return;
    pendingPdf.current.add(offer.key);
    const epoch = conversationEpoch.current;
    const update = (patch: Partial<RoleScannedPdfOffer>) => setMessages(current => current.map(entry => entry.id === messageId && entry.pdfReading ? { ...entry, pdfReading: { ...entry.pdfReading, ...patch } } : entry));
    update({ reading: true, error: undefined }); setBusy(true); setError(''); setLimitHit(false);
    try {
      const result = await post<{ reply: string; notice?: string; costMicros: number; sources?: Source[] }>('/api/assistant/role', {
        action: 'pdf.read', projectId, scope: scopeKind === 'org' ? { kind: 'org' } : { kind: scopeKind, id: scopeId }, operationKey: offer.key,
        consent: true, message: offer.question, url: offer.url, acceptedCostMicros: offer.costMicros, offer: offer.signature,
      }, 55_000);
      if (!mounted.current || conversationEpoch.current !== epoch) return;
      const reply: Message = { id: crypto.randomUUID(), role: 'assistant', content: result.reply, official: true, focusOnShow: true,
        ...(typeof result.notice === 'string' ? { notice: result.notice.slice(0, 200) } : {}),
        sources: (result.sources ?? []).filter(source => officialPdfUrl(source.href)).slice(0, 1), meta: `Leitura por IA (Google Gemini) · Custou ${friendlyMicros(result.costMicros)}` };
      setMessages(current => [...current.map(entry => entry.id === messageId && entry.pdfReading ? { ...entry, pdfReading: { ...entry.pdfReading, reading: false, done: true } } : entry), reply]);
      void loadStatus(projectId, { keep: true });
    } catch (cause) {
      if (!mounted.current || conversationEpoch.current !== epoch) return;
      // Só uma recusa com código do servidor encerra a tentativa e libera uma nova chave. Sem código, 502/504 ou tempo esgotado,
      // a chave fica: se a leitura tiver chegado ao Gemini, repetir não cobra de novo.
      const answered = cause instanceof RequestError && !!cause.code && cause.code !== 'assistant_call_replay' && cause.status !== 502 && cause.status !== 504;
      const closed = cause instanceof RequestError && ['role_pdf_disabled', 'role_official_disabled', 'role_pdf_has_text', 'role_pdf_pages', 'role_pdf_size', 'role_pdf_blocked', 'role_pdf_url', 'role_pdf_offer_invalid'].includes(cause.code ?? '');
      update({ reading: false, closed, error: cause instanceof Error ? limitText(cause) : 'Não foi possível ler o PDF com IA.', errorId: crypto.randomUUID(), ...(answered ? { key: crypto.randomUUID() } : {}) });
      setLimitHit(isLimit(cause));
      if (cause instanceof RequestError && cause.status === 401) void loadStatus(projectId);
    } finally {
      pendingPdf.current.delete(offer.key);
      if (mounted.current && conversationEpoch.current === epoch) setBusy(false);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend || !status || (!officialLookup && !estimate)) return;
    const epoch = conversationEpoch.current;
    const text = sanitized.text, image = picked?.dataUrl, document = documentInput.excerpt;
    const user: Message = { id: crypto.randomUUID(), role: 'user', content: text, image, ...(officialLookup ? { official: true } : {}), ...(document ? { isolated: true, meta: documentDraft?.name } : {}), ...(video ? { video: true, meta: 'Vídeo MP4' } : {}) };
    setMessages(current => [...current, user]); setDraft(''); setPicked(null); setBusy(true); setError(''); setNotice(''); setLimitHit(false);
    try {
      const encodedVideo = video && status.video ? await sendableVideo(video.file) : null;
      const result = await post<{ reply: string; operation: string | null; operationDropped?: boolean; model: string; provider?: string; costMicros: number; reservedMicros: number; inputTokens: number; outputTokens: number; reasoningTokens?: number; sources?: Source[]; lookups?: number; taskDraft?: unknown; pdfReading?: unknown }>('/api/assistant/role', {
        action: 'chat', projectId, scope: scopeKind === 'org' ? { kind: 'org' } : { kind: scopeKind, id: scopeId }, operationKey: crypto.randomUUID(), history: encodedVideo || officialLookup || document ? [] : history, message: text, ...(image ? { image } : {}),
        ...(encodedVideo ? { video: encodedVideo, videoConsent: true, videoApproval: status.video?.approval } : {}),
        ...(document ? { document, documentConsent: true, documentApproval: status.document?.approval } : {}),
        ...(route.explicit ? { officialSearch: true } : { consent: true }),
        acceptedCostMicros: officialLookup || !estimate ? 0 : estimate.costMicros,
      }, encodedVideo && status.video?.effort === 'xhigh' ? 58_000 : undefined);
      if (!mounted.current || conversationEpoch.current !== epoch) return;
      const videoUsage = encodedVideo ? ` · ${result.inputTokens} tokens de entrada · ${result.outputTokens} de saída${typeof result.reasoningTokens === 'number' ? ` (${result.reasoningTokens} de raciocínio)` : ''}` : '';
      const taskDraft = roleTaskDraftFrom(result.taskDraft);
      // PDF escaneado na busca oficial: a oferta guarda a pergunta e uma chave fixa para o toque em Ler com IA.
      const pdfReading = result.provider === 'official' ? roleScannedPdfFrom(result.pdfReading, text, crypto.randomUUID()) : undefined;
      const reply: Message = { id: crypto.randomUUID(), role: 'assistant', content: result.reply, ...(taskDraft ? { taskDraft } : {}), ...(pdfReading ? { pdfReading } : {}), ...(result.provider === 'official' ? { official: true } : {}), ...(document ? { isolated: true } : {}), ...(encodedVideo ? { video: true } : {}), sources: (result.sources ?? []).filter(source => source.href.startsWith('/?module=') || OFFICIAL_LINK.test(source.href) || officialPdfUrl(source.href)).slice(0, 6), meta: result.provider === 'official' ? (pdfReading ? 'Consulta pública · sem custo de IA (a leitura abaixo é cobrada à parte)' : 'Consulta pública · sem custo de IA') : result.provider === 'portal' ? 'Resposta do Portal · sem custo de IA' : `${encodedVideo ? `${videoLabel} · Custo estimado` : 'Custou'} ${friendlyMicros(result.costMicros)}${videoUsage}${result.lookups ? ` · consultou o portal ${result.lookups === 1 ? '1 vez' : `${result.lookups} vezes`}` : ''}${result.operationDropped ? ' · Não foi preparado rascunho. Confira suas permissões e os dados informados.' : ''}`,
        operation: result.operation ? { request: result.operation, stage: 'idle', key: crypto.randomUUID() } : undefined };
      setMessages(current => [
        ...(encodedVideo && video ? current.map(message => message.id === user.id ? { ...message, media: { kind: 'video', file: video.file } satisfies RoleLocalMedia } : message) : current),
        reply,
      ]);
      if (encodedVideo) clearVideo();
      if (document) clearDocumentDraft();
      if (reply.operation && status.operationsAvailable) void locateOperation(reply);
      void loadStatus(projectId, { keep: true });
    } catch (cause) {
      if (!mounted.current || conversationEpoch.current !== epoch) return;
      setMessages(current => current.filter(message => message.id !== user.id)); setDraft(text); if (image && picked) setPicked(picked);
      setError(cause instanceof RequestError && (cause.code === 'role_official_rate' || officialLookup && cause.code === 'rate_limited') ? 'Muitas buscas seguidas. Espere um minuto e tente de novo.' : cause instanceof Error ? limitText(cause) : 'O Rolê não conseguiu responder.'); setLimitHit(isLimit(cause));
      if (video) setVideoConsent(false);
      if (document) setDocumentConsent(null);
      if (cause instanceof RequestError && cause.code === 'role_official_disabled') {
        // Mostra o texto do servidor e tira a busca desta tela, sem recarregar (recarregar apagaria o aviso).
        setOfficialMode(false);
        setStatus(current => current?.policy ? { ...current, policy: { ...current.policy, publicSearch: false } } : current);
      } else if (cause instanceof RequestError && (cause.status === 401 || cause.status === 403 || cause.code === 'role_video_consent' || cause.code === 'role_document_consent')) void loadStatus(projectId);
    } finally { if (mounted.current && conversationEpoch.current === epoch) setBusy(false); }
  }

  function clearDocumentDraft() { setDocumentDraft(null); setDocumentConsent(null); }

  async function attachDocument(file: File | undefined) {
    if (!file || !status?.document || busy || readingDocument || preparingAudio) return;
    setError(''); setNotice('');
    if (!/\.(pdf|docx)$/i.test(file.name)) { setError('Use um PDF ou um documento Word (.docx).'); return; }
    if (!file.size || file.size > MAX_UPLOAD_FILE_BYTES) { setError('Use um arquivo de até 4 MB.'); return; }
    const epoch = conversationEpoch.current;
    setReadingDocument(true);
    try {
      const body = new FormData();
      body.set('file', file);
      const document = await call<RoleDocumentPreview>(`/api/assistant/role/document?projectId=${encodeURIComponent(projectId)}`, { method: 'POST', body, headers: { 'X-Proex-Action': '1' } });
      if (!mounted.current || epoch !== conversationEpoch.current) return;
      const message: Message = { id: crypto.randomUUID(), role: 'user', content: '', document };
      setMessages(current => [...current, message]);
    } catch (cause) {
      if (!mounted.current || epoch !== conversationEpoch.current) return;
      setError(cause instanceof Error ? cause.message : 'Não foi possível ler o documento.');
      if (cause instanceof RequestError && (cause.status === 401 || cause.status === 403)) void loadStatus(projectId);
    } finally { if (mounted.current && epoch === conversationEpoch.current) setReadingDocument(false); }
  }

  function askAboutDocument(excerpt: RoleDocumentExcerpt, name: string) {
    setPicked(null); clearVideo(); discardRecording();
    setDocumentDraft({ name, excerpt }); setDocumentConsent(null); setError('');
    window.requestAnimationFrame(() => input.current?.focus());
  }

  async function saveDocumentCopy(messageId: string, revision: RoleDocumentRevision, destination: 'download' | 'records') {
    const epoch = conversationEpoch.current;
    const currentContext = () => mounted.current && epoch === conversationEpoch.current;
    const title = revision.title.trim(), text = revision.text.trim();
    const blob = destination === 'download' ? (await import('./role-document-copy')).revisedDocx(title, text) : null;
    try {
      const current = await call<Status>(`/api/assistant/role?projectId=${encodeURIComponent(projectId)}`);
      if (!currentContext()) throw new Error('O recorte da conversa mudou.');
      if (!current.document || (destination === 'records' && !current.document.canSaveToRecords)) {
        if (!current.document) void loadStatus(projectId, { keep: true });
        throw new Error('Seu acesso a esta opção mudou. Confira o projeto.');
      }
      if (blob) {
        const url = URL.createObjectURL(blob), link = window.document.createElement('a');
        link.href = url;
        link.download = `${title.replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/^\.+/, '').slice(0, 125) || 'copia-revisada'}.docx`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      const content = JSON.stringify([title, text]);
      let request = copies.current.get(messageId);
      if (!request || content !== request.content) {
        request = { content, operationKey: crypto.randomUUID(), occurredAt: new Date().toISOString() };
        copies.current.set(messageId, request);
      }
      await post('/api/records', { action: 'create', projectId, kind: 'project', title, body: text, operationKey: request.operationKey, occurredAt: request.occurredAt });
    } catch (cause) {
      if (currentContext() && cause instanceof RequestError && (cause.status === 401 || cause.status === 403)) void loadStatus(projectId);
      throw cause;
    }
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
  /** `keep` mantém um aviso na tela enquanto o custo e o destino são conferidos de novo (ex.: o modelo que confere mudou). */
  async function estimateOperation(message: Message, keep = '') {
    if (!message.operation?.projectId) return;
    updateOperation(message.id, { error: keep });
    try { const result = await post<{ costMicros: number; provider: string; jev: boolean; decisionDestination?: unknown; decisionApproval?: string }>('/api/assistant/role', { action: 'estimate.operation', projectId: message.operation.projectId, request: message.operation.request }); updateOperation(message.id, { stage: 'estimated', costMicros: result.costMicros, provider: result.provider, jev: result.jev, decisionDestination: shownRouteName(result.decisionDestination), decisionApproval: result.decisionApproval, stale: false }); }
    catch (cause) { updateOperation(message.id, { stage: 'estimated', stale: true, error: cause instanceof Error ? cause.message : 'Não foi possível calcular o custo da operação.' }); }
  }
  function newConversation() { resetConversation(); window.requestAnimationFrame(() => input.current?.focus()); }
  async function prepareOperation(message: Message) {
    if (!message.operation?.projectId) return;
    setBusy(true); setError(''); updateOperation(message.id, { error: '', limit: false });
    try { const preview = await post<Operation['preview']>('/api/assistant', { action: 'prepare', projectId: message.operation.projectId, request: message.operation.request, consent: true, operationKey: message.operation.key, acceptedCostMicros: message.operation.costMicros, ...(message.operation.decisionDestination ? { decisionDestination: message.operation.decisionDestination, decisionApproval: message.operation.decisionApproval } : {}) }); updateOperation(message.id, { stage: 'preview', preview, confirmed: false, prepared: message.operation.request }); if (preview) void suggestDestination(message.id, preview.plan.projectId, message.operation.request); }
    catch (cause) {
      // O servidor respondeu: a próxima tentativa é outra chamada paga, com chave nova e custo mostrado de novo.
      // Tempo esgotado mantém a chave para recuperar o resultado sem pagar duas vezes.
      const answered = cause instanceof RequestError && cause.code !== 'assistant_call_replay';
      updateOperation(message.id, { error: cause instanceof Error ? limitText(cause) : 'Não foi possível preparar a operação.', limit: isLimit(cause), ...(answered ? { key: crypto.randomUUID() } : {}) });
      // O modelo que confere mudou: nada foi enviado. Volta ao aviso com o custo e o nome de agora, para a pessoa conferir antes de preparar de novo.
      if (cause instanceof RequestError && (cause.code === 'assistant_destination' || cause.code === 'assistant_cost_changed')) await estimateOperation(message, cause.message);
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
    const epoch = conversationEpoch.current;
    try {
      const image = await shrinkImage(file);
      if (!mounted.current || conversationEpoch.current !== epoch) return;
      setPicked(image); clearVideo(); discardRecording(); clearDocumentDraft();
    } catch (cause) {
      if (mounted.current && conversationEpoch.current === epoch) setError(cause instanceof Error ? cause.message : 'Não foi possível usar esta imagem.');
    }
  }

  function pickVideo(file: File | undefined) {
    if (!file) return;
    setError('');
    if (!/\.mp4$/i.test(file.name) || (file.type && file.type !== ROLE_VIDEO_MIME)) { setError('Escolha um vídeo MP4.'); return; }
    if (file.size < 1 || file.size > ROLE_VIDEO_MAX_BYTES) { setError('Use um vídeo MP4 de até 2 MB.'); return; }
    setPicked(null); discardRecording(); clearDocumentDraft(); setVideoConsent(false); setVideo({ file, seconds: null });
  }

  async function startRecording() {
    if (recording || preparingAudio || !consent) return;
    const capture = ++captureEpoch.current;
    setError(''); setRecorded(null); clearVideo(); clearDocumentDraft();
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este navegador não grava áudio. Escreva a mensagem.');
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || captureEpoch.current !== capture) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const instance = new MediaRecorder(media, mime ? { mimeType: mime } : undefined), chunks: BlobPart[] = [];
      recorder.current = instance;
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      instance.onstop = async () => {
        media.getTracks().forEach(track => track.stop());
        if (!mounted.current || captureEpoch.current !== capture) return;
        stream.current = null; setRecording(false);
        if (stopTimer.current) window.clearTimeout(stopTimer.current);
        try {
          const wav = await prepareSpeechWav(new File(chunks, 'gravacao.webm', { type: instance.mimeType || 'audio/webm' }));
          const seconds = Math.max(0, (wav.size - 44) / 32000);
          if (mounted.current && captureEpoch.current === capture) setRecorded({ file: wav, seconds });
        } catch (cause) { if (mounted.current && captureEpoch.current === capture) setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o áudio.'); }
      };
      instance.start(250); setRecording(true);
      stopTimer.current = window.setTimeout(() => { if (instance.state === 'recording') instance.stop(); }, 60_000);
    } catch (cause) {
      if (!mounted.current || captureEpoch.current !== capture) return;
      stream.current?.getTracks().forEach(track => track.stop());
      setRecording(false); setError(cause instanceof Error ? cause.message : 'O microfone não ficou disponível.');
    }
  }
  function discardRecording() { captureEpoch.current++; setRecorded(null); }
  async function attachAudioFile(file: File | undefined) {
    if (!file || !/\.wav$/i.test(file.name) || preparingAudio || !consent || !status?.speech.available) return;
    const epoch = conversationEpoch.current;
    setPreparingAudio(true); setError(''); setNotice('');
    try {
      const wav = await prepareSpeechWav(file.type ? file : new File([file], file.name, { type: 'audio/wav' }));
      if (!mounted.current || epoch !== conversationEpoch.current) return;
      setPicked(null); clearVideo(); clearDocumentDraft(); discardRecording();
      setRecorded({ file: wav, seconds: Math.max(0, (wav.size - 44) / 32000) });
    } catch (cause) {
      if (mounted.current && epoch === conversationEpoch.current) setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o áudio.');
    } finally { if (mounted.current && epoch === conversationEpoch.current) setPreparingAudio(false); }
  }

  async function transcribe() {
    if (!recorded || !status?.speech.available || transcribing || !consent) return;
    const epoch = conversationEpoch.current;
    setTranscribing(true); setError(''); setLimitHit(false);
    try {
      const body = new FormData();
      body.set('audio', recorded.file); body.set('projectId', projectId); body.set('operationKey', crypto.randomUUID()); body.set('consent', 'true'); const route = speechRoute(status); body.set('provider', route?.id ?? status.speech.provider); if (route?.model.approval) body.set('approval', route.model.approval);
      const result = await call<{ transcript?: string }>('/api/assistant/speech', { method: 'POST', headers: { 'X-Proex-Action': '1' }, body });
      if (!mounted.current || conversationEpoch.current !== epoch) return;
      if (typeof result.transcript !== 'string') throw new Error('A transcrição voltou vazia.');
      const audio: Message = { id: crypto.randomUUID(), role: 'user', content: '', media: { kind: 'audio', file: recorded.file }, meta: 'Gravação transcrita' };
      setMessages(current => [...current, audio]);
      setDraft(current => (current ? current + ' ' : '') + result.transcript); discardRecording();
      setNotice('Áudio transcrito. Revise o texto antes de enviar.');
      window.requestAnimationFrame(() => input.current?.focus());
    } catch (cause) {
      if (!mounted.current || conversationEpoch.current !== epoch) return;
      setError(cause instanceof Error ? limitText(cause) : 'Não foi possível transcrever.'); setLimitHit(isLimit(cause));
      // O destino do áudio mudou com a tela aberta: nada foi enviado. Recarrega para a pessoa ver o destino novo e confirmar de novo.
      if (cause instanceof RequestError && (cause.status === 401 || cause.status === 403 || cause.code === 'speech_provider_changed' || cause.code === 'speech_configuration_changed')) void loadStatus(projectId);
    }
    finally { if (mounted.current && conversationEpoch.current === epoch) setTranscribing(false); }
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
  const limitsButton = status?.canConfigure && onOpenLimits ? <button type="button" className={`p-button p-button-primary ${styles.limitsButton}`} onClick={() => { close(false); onOpenLimits(); }}>Ajustar limites</button> : null;
  const launcher = !open && ready && !dock.registered && <button ref={trigger} type="button" className={styles.launcher} aria-haspopup="dialog" aria-keyshortcuts="Alt+R" onClick={event => { event.currentTarget.focus({ preventScroll: true }); openRole(); }} title="Falar com o Rolê (Alt + R)">
    <img src="/brand/role-mascote/role-rosto.svg" alt="" width={44} height={44}/>
    <span className={styles.launcherLabel}>Falar com o Rolê</span>
  </button>;

  return <>
    {toolbar ? createPortal(launcher, toolbar) : launcher}
    {open && <div className={styles.backdrop} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="role-title" aria-describedby="role-subtitle" onKeyDown={onDialogKey}>
        <header className={styles.header}>
          <img className={styles.avatar} src="/brand/role-mascote/role-rosto.svg" alt="" width={48} height={48}/>
          <div className={styles.headerText}><h2 id="role-title">Rolê</h2><p id="role-subtitle">Assistente da PROEX</p></div>
          {messages.length > 0 && <button type="button" className={styles.textButton} onClick={newConversation} disabled={busy || recording || transcribing || readingDocument || preparingAudio} aria-label="Nova conversa"><MessageSquarePlus size={16} aria-hidden="true"/>Nova<span> conversa</span></button>}
          <button type="button" className={styles.iconButton} onClick={() => close()} aria-label="Fechar o Rolê"><X size={20} aria-hidden="true"/></button>
        </header>
        {!searchOnly && <label className={styles.project}><span>Procurar em</span><select value={scopeValue} disabled={officialOn || busy || recording || transcribing || readingDocument || preparingAudio} onChange={event => {
          const value = event.target.value; resetConversation(); setScopeValue(value);
          const event_ = value.startsWith('event:') ? status?.scopes?.events.find(entry => entry.id === value.slice(6)) : null;
          const next = value.startsWith('project:') ? value.slice(8) : event_?.projectId && projects.some(item => item.id === event_.projectId) ? event_.projectId : '';
          if (next && next !== projectId) setProjectId(next);
          void loadStatus(next || projectId);
        }}>
          <option value="org">Toda a PROEX</option>
          {!!status?.scopes?.units.length && <optgroup label="Unidades">{status.scopes.units.map(unit => <option key={unit.id} value={`unit:${unit.id}`}>{unit.name}</option>)}</optgroup>}
          <optgroup label="Projetos">{projects.map(item => <option key={item.id} value={`project:${item.id}`}>{item.name}</option>)}</optgroup>
          {!!status?.scopes?.events.length && <optgroup label="Eventos e dinâmicas">{status.scopes.events.map(entry => <option key={entry.id} value={`event:${entry.id}`}>{entry.name}</option>)}</optgroup>}
        </select></label>}
        <div className={styles.body}>
          {!status && !statusError && <p className={styles.state} role="status"><LoaderCircle size={16} className="p-spin" aria-hidden="true"/>Acordando o Rolê…</p>}
          {statusError && <div className={styles.unavailable} role="alert"><p>{statusError}</p><button type="button" className="p-button p-button-subtle" onClick={() => void loadStatus(projectId)}>Tentar de novo</button></div>}
          {status && mode === 'off' && <div className={styles.unavailable} role="status">
            <img src="/brand/role-mascote/role-frontal.svg" alt="" width={96} height={176} className={styles.fullBody}/>
            <p><strong>O Rolê ainda está desligado aqui.</strong> {status.reason}</p>
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <p className={styles.help}>A administração liga em <strong>Configurações → Chaves e modelos</strong>: cola a chave, testa e ativa o Rolê em “Funções e acesso”.</p>
            {onOpenSettings && <button type="button" className="p-button p-button-subtle" onClick={() => { close(); onOpenSettings(); }}>Abrir Configurações</button>}
          </div>}
          {status && mode !== 'off' && <>
            {!messages.length && <div className={styles.welcome}>
              <img src="/brand/role-mascote/role-frontal.svg" alt="" width={96} height={176} className={styles.fullBody}/>
              {searchOnly ? <div><p className={styles.hello}>Oi! Eu sou o Rolê.</p><p>Pergunte sobre editais, prazos e páginas da PROEX. Eu procuro nas fontes oficiais e mostro os links.</p></div>
              : <div><p className={styles.hello}>Oi! Eu sou o Rolê.</p><p>Posso tirar dúvidas sobre o portal, escrever textos, olhar uma foto{status.speech.available ? ' e ouvir um áudio' : ''}. Se você pedir uma operação no estoque, eu preparo e você confere antes de valer.</p></div>}
              {chatOn && <div className={styles.tips}>
                <div className={styles.tipsHead}><p id="role-tips-title">{tipsOff ? 'Sugestões escondidas neste aparelho.' : 'Sugestões para você'}</p><button type="button" className={styles.tipsToggle} onClick={toggleTips}>{tipsOff ? 'Mostrar sugestões' : 'Esconder'}</button></div>
                {!tipsOff && <ul className={styles.suggestions} aria-labelledby="role-tips-title">{suggestions.map(text => <li key={text}><button type="button" onClick={() => { setDraft(text); input.current?.focus(); }}>{text}</button></li>)}</ul>}
                {!tipsOff && suggestions.length > 0 && <p className={styles.tipsNote}>Feitas com regras do portal, sem custo de IA: olham a agenda, o que você registrou e o que a sua equipe vê, dentro do que você escolheu em “Procurar em”. Mudam a cada 3 dias.</p>}
              </div>}
            </div>}
            <ol ref={log} className={styles.log} aria-live="polite" aria-label="Conversa com o Rolê">
              {messages.map(message => <li key={message.id} className={message.role === 'user' ? styles.mine : styles.theirs}>
                {message.role === 'assistant' && <img className={styles.bubbleAvatar} src="/brand/role-mascote/role-rosto.svg" alt="" width={32} height={32}/>}
                <div className={styles.bubble} data-media={message.document ? 'document' : message.media?.kind}>
                  <span className="visually-hidden">{message.role === 'user' ? 'Você disse:' : 'Rolê respondeu:'}</span>
                  {message.image && <img className={styles.sentImage} src={message.image} alt="Imagem enviada ao Rolê"/>}
                  {message.document && <RoleDocumentCard document={message.document} revision={message.documentRevision}
                    disabled={busy || recording || transcribing || readingDocument || preparingAudio} projectName={project?.name ?? 'Projeto atual'}
                    canSave={!!status.document?.canSaveToRecords}
                    onEdit={documentRevision => setMessages(current => current.map(entry => entry.id === message.id ? { ...entry, documentRevision } : entry))}
                    onAsk={askAboutDocument} onCopy={(draft, destination) => saveDocumentCopy(message.id, draft, destination)}/>}
                  {message.media && <RoleLocalPlayer media={message.media} className={styles.sentMedia}
                    label={message.media.kind === 'video' ? 'Reproduzir vídeo enviado' : 'Ouvir gravação transcrita'}/>}
                  {message.content && <p ref={message.focusOnShow ? focusOnMount : undefined} tabIndex={message.focusOnShow ? -1 : undefined}>{message.content}</p>}
                  {message.notice && <p className={styles.help}>{message.notice}</p>}
                  {!!message.sources?.length && <div className={styles.sources}><span>Fontes da resposta</span><ul>{message.sources.map(source => <li key={source.href}>{source.href.startsWith('/') ? <a href={source.href} onClick={() => close()}>{source.label}</a> : <a href={source.href} target="_blank" rel="noopener noreferrer">{source.label} ↗</a>}</li>)}</ul></div>}
                  {message.taskDraft && <RoleTaskDraftCard draft={message.taskDraft} status={message.taskDraftStatus} onOpen={() => close()}
                    onStatus={taskDraftStatus => setMessages(current => current.map(entry => entry.id === message.id ? { ...entry, taskDraftStatus } : entry))}/>}
                  {message.meta && <small>{message.meta}</small>}
                  {message.pdfReading && <RoleScannedPdfCard offer={message.pdfReading} disabled={busy || recording || transcribing || readingDocument || preparingAudio} onRead={() => void readScannedPdf(message.id)}/>}
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
                      <p className={styles.sendsTo}>O pedido e a lista de materiais do projeto vão para {message.operation.provider === 'openai' ? 'a OpenAI' : 'a DeepSeek'}{message.operation.jev ? operationConferenceText(message.operation.decisionDestination) : ''}.</p>
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
              {busy && !readingPdf && <li className={styles.theirs}><img className={styles.bubbleAvatar} src="/brand/role-mascote/role-rosto.svg" alt="" width={32} height={32}/><div className={styles.bubble}><p className={styles.typing}><LoaderCircle size={16} className="p-spin" aria-hidden="true"/>Pensando…</p></div></li>}
            </ol>
          </>}
        </div>
        {status && mode !== 'off' && <form className={styles.composer} data-document-draft={documentDraft ? true : undefined} data-search-only={searchOnly ? true : undefined} onSubmit={send}>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {error && limitHit && limitsButton}
          {notice && !error && <p role="status" className={styles.notice}>{notice}</p>}
          {searchOnly && <p className={styles.searchOnlyNotice} role="note">Por enquanto, o Rolê só procura nas páginas oficiais da PROEX. A conversa com IA está desligada.</p>}
          {!consent && chatOn && <div className={styles.dataNotice} role="note">
            <p><strong>{servicesChanged ? 'O serviço de IA mudou' : 'Antes de começar'}</strong> O que você escrever, fotografar ou gravar vai para {servicesList(status)}, escolhidos pela PROEX, junto com dados do portal que você já pode ver.{status.operationsAvailable && status.decisionRouteName ? ` ${operationsConferenceSentence(status.decisionRouteName)}` : ''} Não envie senhas, CPF nem dados pessoais.</p>
            <button type="button" className="p-button p-button-primary" onClick={rememberConsent}>Entendi</button>
          </div>}
          {preparingAudio && <p role="status" className={styles.notice}>Preparando o áudio…</p>}
          {readingDocument && <p role="status" className={styles.notice}>Lendo o documento…</p>}
          {documentDraft && <div className={styles.documentEditor}>
            <div className={styles.attachment}><FileText size={18} aria-hidden="true"/><span>{documentDraft.name}{documentDraft.excerpt.page ? ` · p. ${documentDraft.excerpt.page}` : ''}</span>
              <button type="button" className={styles.iconButton} onClick={clearDocumentDraft} disabled={busy} aria-label="Remover trecho"><Trash2 size={18} aria-hidden="true"/></button>
            </div>
            <label className={styles.editable}><span>Trecho para enviar à IA</span><textarea rows={3} maxLength={ROLE_DOCUMENT_EXCERPT_LIMIT} value={documentDraft.excerpt.text} disabled={busy}
              onChange={event => { setDocumentDraft({ ...documentDraft, excerpt: { ...documentDraft.excerpt, text: event.target.value } }); setDocumentConsent(null); }}/></label>
            <label className={styles.videoConsent}><input type="checkbox" checked={!!status.document && documentConsent === status.document.approval} disabled={busy || !status.document} onChange={event => setDocumentConsent(event.target.checked ? status.document?.approval ?? null : null)}/>
              <span>Autorizo enviar este trecho e a pergunta a <strong>{providerName(status.provider)} · {status.model}</strong>.</span></label>
            {documentInput.problem && <p className={styles.error}>{documentInput.problem}</p>}
          </div>}
          {picked && <div className={styles.attachment}><img src={picked.dataUrl} alt="Imagem anexada"/><span>Imagem pronta ({Math.round(picked.bytes / 1024)} KB, reduzida no aparelho)</span><button type="button" className={styles.iconButton} onClick={() => setPicked(null)} aria-label="Remover imagem"><Trash2 size={18} aria-hidden="true"/></button></div>}
          {video && <div className={styles.videoNotice}>
            <div className={styles.attachment}><Film size={20} aria-hidden="true"/><span>{video.file.name} · {Math.max(1, Math.round(video.file.size / 1024))} KB{video.seconds ? ` · ${Math.ceil(video.seconds)} s` : ''}</span>
              <button type="button" className={styles.iconButton} disabled={busy} onClick={clearVideo} aria-label="Remover vídeo"><Trash2 size={18} aria-hidden="true"/></button>
            </div>
            <RoleLocalPlayer media={{ kind: 'video', file: video.file }} label="Prévia local do vídeo"
              onLoadedMetadata={event=>{
                const seconds = event.currentTarget.duration;
                if (!Number.isFinite(seconds) || seconds < ROLE_VIDEO_MIN_SECONDS || seconds > ROLE_VIDEO_MAX_SECONDS) {
                  setError(`Use um vídeo MP4 de ${ROLE_VIDEO_MIN_SECONDS} a ${ROLE_VIDEO_MAX_SECONDS} segundos.`);
                  clearVideo();
                  return;
                }
                setVideo(current=>current?.file === video.file ? {...current,seconds} : current);
              }}
              onError={()=>{setError('Não foi possível abrir este MP4.');clearVideo();}}/>
            {status.video ? <label className={styles.videoConsent}><input type="checkbox" disabled={busy} checked={videoConsent} onChange={event=>setVideoConsent(event.target.checked)}/>
              <span>Autorizo enviar este vídeo e a pergunta ao <strong>{status.video.label}</strong>. A faixa gratuita do Google pode usar o conteúdo para melhorar seus produtos. Envie material autorizado.</span>
            </label> : <p role="status">A análise de vídeo está desligada neste projeto.</p>}
            {videoOverInput && <p className={styles.error}>Este envio ultrapassa o limite de entrada por mensagem definido pela administração.</p>}
          </div>}
          {recorded && <div className={styles.attachment}><RoleLocalPlayer media={{ kind: 'audio', file: recorded.file }} label="Ouvir a gravação antes de transcrever"/><button type="button" className="p-button p-button-primary" disabled={transcribing || !status.speech.available || !consent} onClick={() => void transcribe()}>{transcribing ? 'Transcrevendo…' : `Transcrever · até ${speechCost}`}</button><button type="button" className={styles.iconButton} onClick={discardRecording} disabled={transcribing} aria-label="Descartar gravação"><Trash2 size={18} aria-hidden="true"/></button></div>}
          <label className="visually-hidden" htmlFor="role-message">Mensagem para o Rolê</label>
          <textarea id="role-message" ref={input} value={draft} maxLength={ROLE_MAX_MESSAGE_CHARS + 200} rows={2} placeholder={searchOnly || officialOn ? 'Pergunte sobre editais e páginas da PROEX…' : 'Escreva para o Rolê…'} disabled={busy}
            onChange={event => { setDraft(event.target.value); setNotice(''); }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }}/>
          {(sanitized.problem || tooLong) && <p className={styles.error}>{tooLong ? 'Use até 2.000 caracteres.' : sanitized.problem}</p>}
          {picked && !status.visionAvailable && <p className={styles.error}>A leitura de imagens não está ligada nesta organização.</p>}
          <div className={styles.toolbar}>
            {chatOn && !!status.policy?.publicSearch && <button type="button" className={styles.officialToggle} aria-pressed={officialMode} aria-label="Fontes oficiais: buscar nas páginas da PROEX" disabled={busy || attachment} title={attachment ? 'Tire o anexo para buscar nas fontes oficiais' : 'Manda a pergunta direto para as páginas oficiais da PROEX, sem custo de IA'} onClick={toggleOfficial}>{officialMode ? <Check size={18} aria-hidden="true"/> : <Landmark size={18} aria-hidden="true"/>}Fontes oficiais</button>}
            {chatOn && <>
            {status.document && <label className={`${styles.iconButton} ${busy || officialOn || recording || transcribing || readingDocument ? styles.disabled : ''}`} title="PDF ou Word de até 4 MB">
              <FileText size={20} aria-hidden="true"/><span className="visually-hidden">Anexar PDF ou Word</span>
              <input type="file" accept=".pdf,.docx" disabled={busy || officialOn || recording || transcribing || readingDocument || preparingAudio} onChange={event => { void attachDocument(event.target.files?.[0]); event.target.value = ''; }}/>
            </label>}
            {status.video && <label className={`${styles.iconButton} ${busy || officialOn || !consent || recording || transcribing || preparingAudio ? styles.disabled : ''}`} title={`MP4 de até ${ROLE_VIDEO_MAX_SECONDS} segundos e 2 MB`}>
              <Film size={20} aria-hidden="true"/><span className="visually-hidden">Anexar vídeo MP4</span>
              <input type="file" accept=".mp4,video/mp4" disabled={busy || officialOn || !consent || recording || transcribing || preparingAudio} onChange={event=>{pickVideo(event.target.files?.[0]);event.target.value='';}}/>
            </label>}
            <label className={`${styles.iconButton} ${!status.visionAvailable || officialOn || busy || !consent || recording || transcribing || preparingAudio ? styles.disabled : ''}`} title={status.visionAvailable ? 'Anexar foto' : 'Leitura de imagens desligada'}>
              <ImagePlus size={20} aria-hidden="true"/><span className="visually-hidden">Anexar foto</span>
              <input type="file" accept="image/*" disabled={!status.visionAvailable || officialOn || busy || !consent || recording || transcribing || preparingAudio} onChange={event => { void pickImage(event.target.files?.[0]); event.target.value = ''; }}/>
            </label>
            <button type="button" className={`${styles.iconButton} ${recording ? styles.recording : ''}`} disabled={!status.speech.available || officialOn || !consent || busy || transcribing || preparingAudio || readingDocument} onClick={() => recording ? recorder.current?.stop() : void startRecording()} aria-label={recording ? 'Parar gravação' : 'Gravar áudio'} title={status.speech.available ? (recording ? 'Parar gravação' : 'Gravar áudio (até 60 s)') : 'Transcrição desligada'}>
              {recording ? <Square size={18} aria-hidden="true"/> : <Mic size={20} aria-hidden="true"/>}
            </button>
            {status.speech.available && <label className={`${styles.iconButton} ${officialOn || !consent || busy || recording || transcribing || readingDocument || preparingAudio ? styles.disabled : ''}`} title="Anexar gravação WAV">
              <FileAudio size={20} aria-hidden="true"/><span className="visually-hidden">Anexar áudio WAV</span>
              <input type="file" accept=".wav,audio/wav" disabled={officialOn || !consent || busy || recording || transcribing || readingDocument || preparingAudio} onChange={event => { void attachAudioFile(event.target.files?.[0]); event.target.value = ''; }}/>
            </label>}
            </>}
            <p className={styles.cost} aria-live="polite">{route.explicit ? officialCost : !consent ? 'Toque em Entendi para conversar.' : officialLookup ? officialCost : estimate ? <>Custo máximo: <strong>{(() => { const [words, exact] = friendlyMicros(estimate.costMicros).split(' ('); return exact ? <><span className={styles.nowrap}>{words}</span> <span className={styles.nowrap}>({exact}</span></> : <span className={styles.nowrap}>{words}</span>; })()}</strong></> : 'O custo aparece aqui antes de enviar.'}</p>
            <button type="submit" className={styles.send} disabled={!canSend} aria-label={officialLookup ? 'Enviar para as fontes oficiais' : estimate ? `Enviar, custo máximo ${formatMicros(estimate.costMicros)}` : 'Enviar'}><Send size={18} aria-hidden="true"/><span>Enviar</span></button>
          </div>
          <p className={styles.disclaimer}>{searchOnly || officialLookup ? 'O Rolê pode errar. Confira no link da fonte antes de usar.' : <>O Rolê pode errar. Confira antes de usar. Respondido por {modelLabel}{video ? '.' : ` (${providerName(status.provider)}).`}</>}</p>
          {chatOn && status.organizationId && <details className={styles.myUsage} onToggle={event => { const now = Date.now(); const day = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now - offset * 86400000)); setUsageRange(event.currentTarget.open ? { from: day(29), to: day(0) } : null); }}><summary>Meu uso de IA nos últimos 30 dias</summary>{usageRange && <AiPeopleUsage organizationId={status.organizationId} from={usageRange.from} to={usageRange.to}/>}</details>}
        </form>}
      </div>
    </div>}
  </>;
}
