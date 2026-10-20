'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Dices, LoaderCircle, Plus, Ticket } from 'lucide-react';

// Public projections contain module-specific result fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RecordData = Record<string, any>;
type Props = {
  campaigns: RecordData[];
  tickets: RecordData[];
  mutate: (action: string, payload: Record<string, unknown>) => Promise<RecordData>;
};
const resultNames: Record<string, string> = { brinde: 'Brinde', super: 'Super Brinde', miss: 'Não foi desta vez', retry: 'Tente novamente' };

export default function PhysicalAttendance({ campaigns, tickets, mutate }: Props) {
  const [campaignId, setCampaignId] = useState('');
  const [ticket, setTicket] = useState<RecordData | null>(null);
  const [result, setResult] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cancelPrompt, setCancelPrompt] = useState(false);
  const [cancelReason, setCancelReason] = useState('abandoned');
  const key = useRef<string | null>(null);
  const participation = ticket?.participation ?? ticket;
  const state = participation?.state ?? ticket?.state;
  const participationId = participation?.id ?? ticket?.participationId;
  const attemptId = ticket?.attempt?.id ?? ticket?.attemptId;
  const code = ticket?.entitlement?.id ?? ticket?.redemptionCode ?? ticket?.redemption_code ?? ticket?.prize?.code ?? ticket?.attempt?.redemption_code ?? ticket?.attempt?.redemptionCode;
  const cancelled = state === 'cancelled';
  const complete = state === 'complete' || cancelled;
  const retry = state === 'retry_ready';
  const active = campaigns.filter(c => c.status === 'active');
  const pendingTickets = tickets.filter(t => ['physical_pending', 'retry_ready'].includes(t.state));
  function resume(t: RecordData) { setCampaignId(t.campaign_id); setResult(''); setError(''); key.current = null; setTicket({ participation: { id: t.participation_id, state: t.state }, attempt: { id: t.attempt_id, result: t.result } }); }

  async function start(continuation = false) {
    if (saving || !campaignId) return;
    setSaving(true); setError(''); key.current ??= crypto.randomUUID();
    try {
      const response = await mutate('participation.ticket', {
        campaignId, modality: 'physical', operationKey: key.current,
        ...(continuation ? { participationId } : {}),
      });
      setTicket(response); setResult(''); setCancelPrompt(false); key.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível abrir o atendimento.'); }
    finally { setSaving(false); }
  }

  async function confirm() {
    if (saving || !attemptId || !result) return;
    setSaving(true); setError(''); key.current ??= crypto.randomUUID();
    try {
      const response = await mutate('participation.physical', { attemptId, result, operationKey: key.current });
      setTicket(response); key.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível registrar a face observada.'); }
    finally { setSaving(false); }
  }

  async function cancel() {
    if (saving || !attemptId) return;
    setSaving(true); setError(''); key.current ??= crypto.randomUUID();
    try {
      const response = await mutate('participation.cancel', { attemptId, reason: cancelReason, operationKey: key.current });
      setTicket({ ...response, participation: { ...(response.participation ?? participation), state: 'cancelled' } });
      setCancelPrompt(false); key.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível cancelar o atendimento.'); }
    finally { setSaving(false); }
  }

  return <div className="p-card p-physical">
    <div className="p-card-title"><span className="p-icon-tile"><Dices size={21} /></span><div><h3>Atendimento presencial</h3><p>Registre o resultado observado no dado ou na roleta física.</p></div></div>
    <p className="p-form-help">Cada tíquete representa um atendimento assistido. Ele não comprova uma pessoa única nem seguimento no Instagram. Não abra outro tíquete para repetir a mesma participação.</p>
    {!ticket && pendingTickets.length > 0 && <div className="p-pending-tickets"><strong>{pendingTickets.length} atendimento(s) nesta fila</strong><p>Até 200 atendimentos recentes. As reservas de brindes continuam vinculadas a eles. Retome o tíquete da pessoa antes de abrir outro.</p>{pendingTickets.map(t => <div key={t.participation_id}><span><strong>{t.campaign_name}</strong><small>{String(t.participation_id).slice(0, 12)} · {t.state === 'retry_ready' ? 'Repetição autorizada' : 'Resultado pendente'}</small></span><button className="p-button p-button-subtle" onClick={() => resume(t)}>Retomar</button></div>)}</div>}
    {!ticket ? <><label className="p-field"><span>Evento ativo</span><select value={campaignId} onChange={e => { setCampaignId(e.target.value); key.current = null; }} disabled={saving}><option value="">Selecione o evento</option>{active.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="p-button p-button-primary" disabled={saving || !campaignId} onClick={() => void start()}>{saving ? <LoaderCircle size={17} className="p-spin" /> : <Ticket size={17} />}Abrir atendimento</button>{!active.length && <p className="p-form-help">Ative um evento com regras e ofertas completas para iniciar o atendimento.</p>}</> : <>
      <div className="p-physical-ticket"><Ticket size={18} /><span>Atendimento <strong>{String(participationId ?? '').slice(0, 12)}</strong></span>{complete && <span className={`p-badge ${cancelled ? 'p-status-cancelled' : 'p-status-returned'}`}>{cancelled ? 'Cancelado' : 'Concluído'}</span>}</div>
      {complete ? <div className="p-physical-complete"><CheckCircle2 size={23} /><div><strong>{cancelled ? 'Atendimento cancelado' : 'Resultado registrado'}</strong><p>{cancelled ? 'O estoque reservado foi liberado. Este atendimento foi encerrado, sem nova tentativa.' : <>{resultNames[ticket?.attempt?.result ?? result] ?? 'Atendimento concluído'}.{code ? ' Confirme a entrega do prêmio separadamente.' : ' Não há entrega de prêmio indicada neste atendimento.'}</>}</p>{!cancelled && code && <p>Código de retirada: <code>{code}</code></p>}</div></div> : retry ? <div className="p-explainer"><Dices size={20} /><div><h3>Repetição autorizada pela campanha</h3><p>Continue o mesmo atendimento. O limite é aplicado no servidor.</p><button className="p-button p-button-primary" disabled={saving} onClick={() => void start(true)}>{saving && <LoaderCircle size={17} className="p-spin" />}Abrir próxima tentativa</button></div></div> : <><label className="p-field"><span>Face observada pela equipe</span><select value={result} disabled={saving} onChange={e => { setResult(e.target.value); key.current = null; }}><option value="">Selecione o resultado real</option>{Object.entries(resultNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="p-button p-button-primary" disabled={saving || !result || !attemptId} onClick={() => void confirm()}>{saving ? <LoaderCircle size={17} className="p-spin" /> : <CheckCircle2 size={17} />}Confirmar resultado observado</button></>}
      {!complete && !retry && <div className="p-cancel-ticket">{!cancelPrompt ? <button className="p-text-link" disabled={saving} onClick={() => { setCancelPrompt(true); key.current = null; }}>Cancelar este atendimento</button> : <><label className="p-field"><span>Motivo do cancelamento</span><select value={cancelReason} disabled={saving} onChange={e => { setCancelReason(e.target.value); key.current = null; }}><option value="abandoned">A pessoa desistiu ou se ausentou</option><option value="staff_error">Atendimento aberto por engano</option></select></label><p>O cancelamento encerra este atendimento e libera as reservas. Ele não registra uma derrota nem concede outra tentativa.</p><div className="p-inline"><button className="p-button p-button-danger" disabled={saving} onClick={() => void cancel()}>{saving && <LoaderCircle size={16} className="p-spin" />}Confirmar cancelamento</button><button className="p-button p-button-subtle" disabled={saving} onClick={() => setCancelPrompt(false)}>Voltar</button></div></>}</div>}
      {complete && <button className="p-text-link" onClick={() => { setTicket(null); setResult(''); key.current = null; }}><Plus size={16} />Atender outra pessoa</button>}
    </>}
    {error && <p className="p-inline-error" role="alert">{error}</p>}
  </div>;
}
