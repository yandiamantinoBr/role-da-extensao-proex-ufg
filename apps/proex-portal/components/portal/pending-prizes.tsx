'use client';

import { useRef, useState } from 'react';
import { Check, Copy, Gift, LoaderCircle } from 'lucide-react';
// Explicit server projection of reserved entitlements, scoped by delivery permission.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Props = { prizes: Row[]; mutate: (action: string, payload: Record<string, unknown>) => Promise<Row> };

function PendingPrize({ prize, mutate }: { prize: Row; mutate: Props['mutate'] }) {
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const key = useRef<string | null>(null);
  const code = String(prize.entitlement_id ?? prize.id);
  async function deliver() {
    if (saving) return;
    setSaving(true); setError(''); key.current ??= crypto.randomUUID();
    try { await mutate('prize.redeem', { code, operationKey: key.current }); key.current = null; setConfirm(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível confirmar a entrega.'); }
    finally { setSaving(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); }
    catch { setError('Selecione o código abaixo e copie pelo menu do aparelho.'); }
  }
  return <article className="p-card p-pending-prize"><div className="p-card-title"><span className="p-icon-tile"><Gift size={19} /></span><div><h3>{prize.offer_name || prize.offerName || 'Prêmio reservado'}</h3><p>{prize.campaign_name || prize.campaignName || 'Campanha oficial'}</p></div><span className="p-badge p-status-pending">Aguardando entrega</span></div><label className="p-field"><span>Código de retirada</span><div className="p-copy-row"><input value={code} readOnly onFocus={e => e.target.select()} aria-label="Código de retirada do prêmio reservado" /><button type="button" className="p-button p-button-subtle" onClick={() => void copy()}><Copy size={15} />{copied ? 'Copiado' : 'Copiar'}</button></div></label>{!confirm ? <button className="p-text-link" onClick={() => setConfirm(true)}>Registrar entrega deste prêmio</button> : <div className="p-prize-confirm"><p>Confira o código com a pessoa e entregue os materiais antes de confirmar.</p><div className="p-inline"><button className="p-button p-button-primary" disabled={saving} onClick={() => void deliver()}>{saving ? <LoaderCircle size={16} className="p-spin" /> : <Check size={16} />}Confirmar entrega</button><button className="p-button p-button-subtle" disabled={saving} onClick={() => setConfirm(false)}>Voltar</button></div></div>}{error && <p className="p-inline-error" role="alert">{error}</p>}</article>;
}

export default function PendingPrizes({ prizes, mutate }: Props) {
  return <div className="p-prize-list">{prizes.map(prize => <PendingPrize key={prize.id} prize={prize} mutate={mutate} />)}</div>;
}
