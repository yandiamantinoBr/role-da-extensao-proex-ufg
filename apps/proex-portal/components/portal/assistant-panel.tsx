'use client';

import { useEffect, useRef, useState } from 'react';
import { type AssistantPlan } from '@/lib/assistant/contracts';
import type { SpeechProvider } from '@/lib/assistant/settings';
import type { SpeechRouteModel } from '@/lib/assistant/role-contracts';
import SpeechInput from './speech-input';
import { startReviewedDictation, type DictationConstructor } from '@/lib/assistant/dictation';

type Status = { available:boolean; organizationId?:string; organizations?:{id:string;name:string;available:boolean;sttAvailable:boolean;sttProvider?:SpeechProvider;sttRoute?:string;sttRouteModel?:SpeechRouteModel}[] };
type Preview = { plan: Omit<AssistantPlan, 'actorId'>; planToken: string; undoReason: string };
type Props = { projects: { id: string; name: string; organization_id?: string }[]; defaultProjectId?: string; onApplied?: () => void | Promise<void> };
type SpeechWindow = Window & { SpeechRecognition?: DictationConstructor; webkitSpeechRecognition?: DictationConstructor };
const field = 'w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]';
const button = 'min-h-11 rounded-xl bg-[var(--purple)] px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 font-semibold text-[var(--text)] disabled:opacity-50';
const labels: Record<string, string> = { 'stock.query': 'Consultar estoque', 'stock.receive': 'Registrar entrada', 'stock.distribute': 'Registrar distribuição', 'stock.consume': 'Registrar consumo', 'record.create': 'Criar registro' };
async function api<T = Record<string, unknown>>(input?: Record<string, unknown>, organizationId?: string): Promise<T> {
 const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 30_000);
 try { const response = await fetch(`/api/assistant${!input && organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`, input ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(input), signal: controller.signal, redirect: 'error' } : { cache: 'no-store', signal: controller.signal }); const body = await response.json() as Record<string, unknown>; if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Não foi possível usar o assistente.'); return body as T; }
 catch (error) { if (error instanceof Error && error.name === 'AbortError') throw new Error('A resposta demorou. Use o mesmo pedido para conferir o resultado.'); throw error; } finally { window.clearTimeout(timer); }
}

export default function AssistantPanel({ projects, defaultProjectId, onApplied }: Props) {
 const [open, setOpen] = useState(false), [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
 const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? ''), [request, setRequest] = useState(''), [consent, setConsent] = useState(false), [preview, setPreview] = useState<Preview | null>(null), [confirmed, setConfirmed] = useState(false), [receipt, setReceipt] = useState('');

 const [speechSupported, setSpeechSupported] = useState(false), [voiceConsent, setVoiceConsent] = useState(false), [listening, setListening] = useState(false), [dictated, setDictated] = useState('');
 const speech = useRef<{ stop: () => void; abort: () => void } | null>(null), operationKey = useRef<string | null>(null), statusEpoch = useRef(0), requestedOrganization = useRef('');
 useEffect(() => () => { speech.current?.abort(); }, []);
 async function loadStatus(organizationId = status?.organizationId ?? projects.find(project => project.id === projectId)?.organization_id) { const epoch=++statusEpoch.current;requestedOrganization.current=organizationId??'';setBusy(true);try{const next:Status=await api(undefined,organizationId);if(epoch!==statusEpoch.current)return;requestedOrganization.current=next.organizationId??'';setStatus(next);}finally{if(epoch===statusEpoch.current)setBusy(false);} }
 async function show() { const browser = window as SpeechWindow; setSpeechSupported(!!(browser.SpeechRecognition || browser.webkitSpeechRecognition)); setOpen(true); setBusy(true); setError(''); try { await loadStatus(); } catch (e) { setError(e instanceof Error ? e.message : 'O assistente está indisponível.'); } finally { setBusy(false); } }
 function reset() { setPreview(null); setConfirmed(false); setReceipt(''); setError(''); operationKey.current = null; }
 async function prepare() { setBusy(true); setError(''); setConfirmed(false); setReceipt(''); operationKey.current ??= crypto.randomUUID(); try { setPreview(await api<Preview>({ action: 'prepare', projectId, request, consent, operationKey: operationKey.current })); } catch (e) { const message = e instanceof Error ? e.message : 'Não foi possível preparar a proposta.'; if (!/demorou/.test(message) && !/sendo preparado/.test(message)) operationKey.current = null; setError(message); } finally { setBusy(false); } }
 async function apply() { if (!preview || !confirmed) return; setBusy(true); setError(''); try { const saved = await api({ action: 'apply', planToken: preview.planToken, confirmed }); setReceipt(saved.queried ? 'Consulta conferida com o saldo atual.' : saved.replayed ? 'Esta operação já havia sido concluída. O resultado foi recuperado.' : 'Operação concluída e registrada no histórico.'); setPreview(null); setConfirmed(false); operationKey.current = null; await onApplied?.(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); } finally { setBusy(false); } }

 function stopVoice() { speech.current?.stop(); setListening(false); }
 function startVoice() { const browser = window as SpeechWindow; if (listening) return; speech.current?.abort(); try { speech.current = startReviewedDictation(browser.SpeechRecognition || browser.webkitSpeechRecognition, { consent: voiceConsent, onText: text => setDictated(previous => (previous + text).slice(0, 4000)), onState: setListening, onError: () => setError('O ditado não ficou disponível. Você pode digitar o pedido.') }); } catch { setError('O microfone não ficou disponível. Você pode digitar o pedido.'); } }

 const activeOrgId = projects.find(project => project.id === projectId)?.organization_id ?? status?.organizationId, activeOrg = status?.organizations?.find(organization => organization.id === activeOrgId), assistantAvailable = activeOrg?.available ?? false;

 const activeSpeechProvider = activeOrg?.sttProvider ?? 'deepgram';
 if (!open) return <button type="button" className={secondary} onClick={show}>Assistente com revisão</button>;
 return <section aria-label="Assistente de operações" className="my-4 min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-[var(--text)] sm:p-6">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Assistente de operações</h2><button type="button" className={secondary} disabled={busy} onClick={() => { speech.current?.abort(); ++statusEpoch.current; setOpen(false); }}>Fechar</button></div>
  <p className="mt-2 text-sm text-[var(--text-secondary)]">Descreva uma consulta ou uma operação. Confira material, quantidade e efeito antes de confirmar. A proposta pode conter erros.</p>
  {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
  {receipt && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-900">{receipt}</p>}
  {status && !assistantAvailable && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-amber-900">O assistente está indisponível. Um responsável autorizado precisa habilitar os provedores e limites desta organização. Você pode usar as telas de Materiais e Registros.</p>}
  <fieldset disabled={busy} className="mt-4 space-y-4"><legend className="sr-only">Preparar pedido</legend>
   <label className="block font-medium">Projeto<select className={field} value={projectId} onChange={event => { reset(); setProjectId(event.target.value); const organizationId = projects.find(project => project.id === event.target.value)?.organization_id; if (organizationId) void loadStatus(organizationId).catch(() => setError('Não foi possível consultar a configuração do projeto.')); }}><option value="">Selecione um projeto</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
   <label className="block font-medium">O que você precisa?<textarea className={`${field} mt-1 min-h-28`} maxLength={4000} value={request} onChange={event => { reset(); setRequest(event.target.value); }} placeholder="Ex.: registrar entrada de 10 canetas recebidas para a oficina." /></label>
   <details className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"><summary className="min-h-11 cursor-pointer font-medium">Ditar e revisar texto</summary><p className="mt-2 text-sm">O serviço de voz do navegador pode processar áudio externamente. O portal não armazena a gravação. Para enviar uma gravação ou arquivo, use a seção de áudio abaixo.</p>
    {!speechSupported && <p className="mt-2 text-sm" role="status">O ditado não está disponível neste navegador. Digite o pedido acima.</p>}
    <label className="my-3 flex items-start gap-2"><input type="checkbox" checked={voiceConsent} onChange={event => { setVoiceConsent(event.target.checked); if (!event.target.checked) stopVoice(); }} />Autorizo usar o microfone e o serviço de voz do navegador para este ditado.</label>
    <button type="button" className={secondary} disabled={!speechSupported || !voiceConsent} onClick={listening ? stopVoice : startVoice}>{listening ? 'Parar ditado' : 'Iniciar ditado'}</button>
    <label className="mt-3 block">Texto ditado para revisão<textarea className={`${field} min-h-24`} maxLength={4000} value={dictated} onChange={event => setDictated(event.target.value)} /></label><button type="button" className={`${secondary} mt-2`} disabled={!dictated.trim() || listening} onClick={() => { reset(); setRequest(dictated); setDictated(''); }}>Usar texto revisado no pedido</button>
   </details>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => { setConsent(event.target.checked); reset(); }} />Autorizo enviar este pedido e os materiais deste projeto aos provedores configurados. Removi dados pessoais e segredos.</label>
   <button type="button" className={button} disabled={!assistantAvailable || !projectId || !request.trim() || !consent || listening} onClick={prepare}>{busy ? 'Preparando…' : 'Preparar proposta'}</button>
  </fieldset>
  <SpeechInput key={`${projectId}:${activeSpeechProvider}`} projectId={projectId} provider={activeSpeechProvider} destination={activeOrg?.sttRoute} routeModel={activeOrg?.sttRouteModel} onDestinationChanged={() => { void loadStatus().catch(() => undefined); }} available={activeOrg?.sttAvailable ?? false} onReviewedText={value => { reset(); setRequest(value); }}/>
  {preview && <div className="mt-5 space-y-3 rounded-xl border border-[var(--purple)] bg-[var(--surface)] p-4"><h3 className="text-lg font-bold">Confira: {labels[preview.plan.proposal.intent]}</h3><p>Projeto: {projects.find(project=>project.id===preview.plan.projectId)?.name??preview.plan.projectId} · Organização: {status?.organizations?.find(organization=>organization.id===preview.plan.organizationId)?.name??preview.plan.organizationId}</p><p>{preview.plan.before?.name ?? preview.plan.proposal.title}</p>
   {preview.plan.before && preview.plan.after && <div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-[var(--surface-soft)] p-3"><p className="text-sm">Antes</p><p className="font-semibold">{preview.plan.before.stock} {preview.plan.before.unit}</p><p className="text-sm">Disponível: {preview.plan.before.stock - preview.plan.before.reserved}</p></div><div className="rounded-xl bg-[var(--surface-soft)] p-3"><p className="text-sm">Depois</p><p className="font-semibold">{preview.plan.after.stock} {preview.plan.before.unit}</p><p className="text-sm">Disponível: {preview.plan.after.available}</p></div></div>}
   <p className="whitespace-pre-wrap break-words">{preview.plan.proposal.body}</p><p className="text-sm">Quantidade: {preview.plan.proposal.quantity || 'Sem movimentação'}</p>
   <div className="text-sm"><p className="font-semibold">Trechos do pedido usados na proposta</p>{preview.plan.proposal.evidence.map((evidence, index) => <blockquote className="mt-1 border-l-2 border-blue-300 pl-3" key={index}>{evidence.quote}</blockquote>)}</div>
   <p className="text-xs text-[var(--text-secondary)]">{preview.plan.provenance.provider==='openai'?'OpenAI':'DeepSeek'}: {preview.plan.provenance.returnedModel}{preview.plan.provenance.jevModel ? ` · Conferência TypeSafe: ${preview.plan.provenance.jevModel}` : ''}. Válida até {new Date(preview.plan.expiresAt).toLocaleTimeString('pt-BR')}.</p><p className="text-sm text-[var(--text-secondary)]">{preview.undoReason}</p>
   <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Conferi projeto, material, quantidade e efeito. Autorizo esta operação.</label><div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy || !confirmed} onClick={apply}>{preview.plan.proposal.intent === 'stock.query' ? 'Conferir saldo atual' : 'Confirmar operação'}</button><button type="button" className={secondary} disabled={busy} onClick={reset}>Revisar pedido</button></div>
  </div>}
 </section>;
}
