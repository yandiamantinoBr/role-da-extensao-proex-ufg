'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, LoaderCircle, X } from 'lucide-react';
import styles from './loan-card-actions.module.css';

type Step = 'out' | 'returned' | 'cancelled';
type Props = {
  loanId: string;
  itemName: string;
  /** 'reserved' or 'out'; other states have no action. */
  status: string;
  /** The equipment cannot leave now (maintenance, inactive or no unit); only cancelling is offered. */
  checkoutBlocked?: boolean;
  mutate: (action: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
const COPY: Record<Step, { title: string; confirm: string; field?: string; placeholder?: string; hint: string }> = {
  out: { title: 'Confirmar retirada', confirm: 'Confirmar retirada', field: 'Condição e acessórios na saída', placeholder: 'Ex.: com capa e carregador, sem avarias', hint: 'Registre como o equipamento saiu. Isso ajuda a conferir a devolução.' },
  returned: { title: 'Confirmar devolução', confirm: 'Confirmar devolução', field: 'Condição e acessórios na volta', placeholder: 'Ex.: voltou com todos os acessórios, sem avarias', hint: 'Registre como o equipamento voltou. Avarias ficam no histórico.' },
  cancelled: { title: 'Cancelar esta reserva?', confirm: 'Cancelar reserva', hint: 'O equipamento fica livre para outras reservas. O histórico continua guardado.' },
};

/** The main action of a loan card, one tap away, with a short confirmation. The server checks permission, window and state. */
export default function LoanCardActions({ loanId, itemName, status, checkoutBlocked = false, mutate }: Props) {
  const [step, setStep] = useState<Step | null>(null), [note, setNote] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const key = useRef<string | null>(null), field = useRef<HTMLTextAreaElement>(null), confirmButton = useRef<HTMLButtonElement>(null), opener = useRef<HTMLButtonElement | null>(null), alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { if (step) (field.current ?? confirmButton.current)?.focus(); }, [step]);
  if (status !== 'reserved' && status !== 'out') return null;
  const primary: Step | null = status === 'out' ? 'returned' : checkoutBlocked ? null : 'out';
  function open(next: Step, button: HTMLButtonElement) { opener.current = button; key.current = null; setError(''); setStep(next); }
  function back() { if (saving) return; setStep(null); setError(''); window.setTimeout(() => opener.current?.focus(), 0); }
  async function confirm() {
    if (!step || saving) return;
    key.current ??= crypto.randomUUID(); setSaving(true); setError('');
    const text = note.trim();
    try {
      await mutate('loan.status', { id: loanId, status: step, ...(step === 'out' ? { conditionOut: text } : step === 'returned' ? { conditionIn: text } : { note: text }), operationKey: key.current });
      key.current = null;
      if (alive.current) { setStep(null); setNote(''); }
    } catch (failure) {
      // What was typed stays; the same key is reused, so a repeated tap after a lost reply does not record twice.
      if (alive.current) setError(failure instanceof Error ? failure.message : 'Não foi possível registrar. Tente novamente.');
    } finally { if (alive.current) setSaving(false); }
  }
  if (!step) return <div className={styles.actions}>
    {primary && <button type="button" className="p-button p-button-primary" aria-label={`${primary === 'out' ? 'Registrar retirada' : 'Registrar devolução'} de ${itemName}`} onClick={event => open(primary, event.currentTarget)}>{primary === 'out' ? <ArrowUpFromLine size={17} aria-hidden="true"/> : <ArrowDownToLine size={17} aria-hidden="true"/>}{primary === 'out' ? 'Registrar retirada' : 'Registrar devolução'}</button>}
    {status === 'reserved' && <button type="button" className={checkoutBlocked ? 'p-button p-button-subtle' : `p-text-link ${styles.cancel}`} aria-label={`Cancelar a reserva de ${itemName}`} onClick={event => open('cancelled', event.currentTarget)}>{checkoutBlocked && <X size={16} aria-hidden="true"/>}Cancelar reserva</button>}
  </div>;
  const copy = COPY[step];
  return <section className={styles.confirm} aria-label={`${copy.title}: ${itemName}`}>
    <p className={styles.title}><strong>{copy.title}</strong> · {itemName}</p>
    <p className={styles.hint}>{copy.hint}</p>
    {copy.field && <label className="p-field"><span>{copy.field} <em>(opcional)</em></span><textarea ref={field} rows={2} maxLength={1000} value={note} disabled={saving} placeholder={copy.placeholder} onChange={event => { setNote(event.target.value); key.current = null; }}/></label>}
    {error && <p className="p-inline-error" role="alert">{error}</p>}
    <div className={styles.buttons}>
      <button ref={confirmButton} type="button" className={step === 'cancelled' ? 'p-button p-button-danger' : 'p-button p-button-primary'} disabled={saving} onClick={() => void confirm()}>{saving && <LoaderCircle size={16} className="p-spin" aria-hidden="true"/>}{copy.confirm}</button>
      <button type="button" className="p-button p-button-subtle" disabled={saving} onClick={back}>Voltar</button>
    </div>
  </section>;
}
