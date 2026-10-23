'use client';

import { useEffect, useId, useState } from 'react';
import { LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';

type PrivacyRequest = { id: string; userId: string; status: 'pending' | 'cleanup_pending' | 'completed' | 'rejected'; requestedAt: string; reviewedAt: string | null; completedAt: string | null; email: string | null; displayName: string | null };
type PrivacyPayload = { requests: PrivacyRequest[]; canReview: boolean; notice: string };
const LABELS: Record<PrivacyRequest['status'], string> = { pending: 'Aguardando análise', cleanup_pending: 'Limpeza de arquivos pendente', completed: 'Concluída', rejected: 'Não aprovada' };
async function readRequests(signal?: AbortSignal): Promise<PrivacyPayload> {
 const response = await fetch('/api/account?action=privacy', { credentials: 'same-origin', cache: 'no-store', signal });
 const body = await response.json().catch(() => ({})) as Partial<PrivacyPayload> & { error?: unknown };
 if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error.slice(0, 500) : 'Não foi possível carregar as solicitações.');
 if (typeof body.canReview !== 'boolean' || !Array.isArray(body.requests)) throw new Error('Atualize a página para recuperar as solicitações.');
 return { requests: body.requests, canReview: body.canReview, notice: typeof body.notice === 'string' ? body.notice : '' };
}
function dateLabel(value: string | null) { if (!value) return '—'; const date = new Date(value); return Number.isFinite(+date) ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Data indisponível'; }

function RequestReview({ request, onResolved }: { request: PrivacyRequest; onResolved(): Promise<void> }) {
 const prefix = useId(), [password, setPassword] = useState(''), [acknowledged, setAcknowledged] = useState(false);
 const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
 const actionable = request.status === 'pending' || request.status === 'cleanup_pending';
 async function resolve(decision: 'anonymize' | 'reject') {
  if (busy || !actionable) return;
  setError(''); setMessage('');
  if (!password) { setError('Confirme sua senha atual para decidir esta solicitação.'); return; }
  if (decision === 'anonymize' && !acknowledged) { setError('Confirme que leu as consequências antes de continuar.'); return; }
  setBusy(true);
  try {
   const response = await fetch('/api/account', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: 'privacy.resolve', requestId: request.id, decision, currentPassword: password }) });
   const body = await response.json().catch(() => ({})) as { error?: unknown; status?: unknown };
   if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error.slice(0, 500) : 'Não foi possível registrar a decisão.');
   await onResolved(); setAcknowledged(false);
   setMessage(body.status === 'cleanup_pending' ? 'A conta foi anonimizada. Alguns arquivos ainda aguardam limpeza; tente concluir novamente.' : decision === 'reject' ? 'Decisão registrada.' : 'Atendimento concluído.');
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a decisão.'); }
  finally { setPassword(''); setBusy(false); }
 }
 return <article aria-labelledby={`${prefix}-title`} style={{ padding: 20, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)' }}>
  <div className="p-row-between" style={{ gap: 12, flexWrap: 'wrap' }}><h3 id={`${prefix}-title`} style={{ margin: 0, overflowWrap: 'anywhere' }}>{request.displayName || request.email || 'Conta sem identificação'}</h3><span className="p-badge">{LABELS[request.status] || 'Atualize a página'}</span></div>
  {request.displayName && request.email && <p className="p-form-help" style={{ overflowWrap: 'anywhere' }}>{request.email}</p>}
  <p className="p-form-help">Solicitada em {dateLabel(request.requestedAt)}{request.completedAt ? ` · Concluída em ${dateLabel(request.completedAt)}` : request.reviewedAt ? ` · Analisada em ${dateLabel(request.reviewedAt)}` : ''}</p>
  {actionable && <form className="p-form" onSubmit={event => { event.preventDefault(); void resolve('anonymize'); }}><fieldset disabled={busy}>
   <p className="p-form-help">{request.status === 'cleanup_pending' ? 'O acesso já foi encerrado. Esta ação tenta novamente remover os arquivos privados que restaram.' : 'A anonimização encerra o acesso e remove credenciais, contatos e arquivos privados da conta. Os totais e o histórico operacional necessário permanecem. A ação é irreversível.'}</p>
   <label className="p-field" style={{ maxWidth: 420 }}><span>Sua senha atual de administrador</span><input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
   <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '18px 0', fontSize: 14 }}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} style={{ marginTop: 3, flexShrink: 0 }} /><span>{request.status === 'cleanup_pending' ? 'Confirmo que quero tentar concluir a limpeza dos arquivos desta conta.' : 'Conferi a solicitação e autorizo a anonimização irreversível desta conta.'}</span></label>
   <div className="p-form-footer" style={{ gap: 10, flexWrap: 'wrap' }}><button className="p-button p-button-primary" type="submit">{busy ? <LoaderCircle size={16} className="p-spin" /> : <ShieldCheck size={16} />}{busy ? 'Processando…' : request.status === 'cleanup_pending' ? 'Tentar concluir limpeza' : 'Anonimizar conta'}</button>{request.status === 'pending' && <button type="button" className="p-button p-button-subtle" onClick={() => void resolve('reject')}>Não aprovar solicitação</button>}</div>
  </fieldset></form>}
  {error && <p role="alert" className="p-inline-error">{error}</p>}{message && <p role="status" style={{ color: 'var(--success-ink)' }}>{message}</p>}
 </article>;
}

export default function AdminPrivacyPanel() {
 const prefix = useId(), [data, setData] = useState<PrivacyPayload | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
 async function refresh() { const latest = await readRequests(); setData(latest); setError(''); }
 useEffect(() => {
  const controller = new AbortController();
  void readRequests(controller.signal).then(value => { if (!controller.signal.aborted) setData(value); }, cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as solicitações.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  return () => controller.abort();
 }, []);
 if (data && !data.canReview) return null;
 return <section className="p-card" aria-labelledby={`${prefix}-title`} style={{ padding: 'clamp(18px,4vw,30px)', marginTop: 24 }}>
  <div className="p-row-between" style={{ gap: 14, flexWrap: 'wrap' }}><h2 id={`${prefix}-title`} style={{ margin: '0 0 10px' }}>Solicitações de privacidade</h2><button className="p-button p-button-subtle" type="button" disabled={loading} onClick={() => { setLoading(true); void refresh().catch(cause => setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar.')).finally(() => setLoading(false)); }}><RefreshCw size={16} />Atualizar</button></div>
  <p className="p-form-help" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data?.notice}</p>
  {loading && <p role="status"><LoaderCircle size={16} className="p-spin" /> Atualizando solicitações…</p>}{error && <p role="alert" className="p-inline-error">{error}</p>}
  <div style={{ display: 'grid', gap: 14 }}>{data?.requests.map(request => <RequestReview key={request.id} request={request} onResolved={refresh} />)}</div>
  {data && !data.requests.length && <p className="p-form-help">Nenhuma solicitação registrada.</p>}
 </section>;
}
