'use client';
import DateTimeField from './date-time-field';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, PackagePlus, Truck, X } from 'lucide-react';
import { useFormDraft, DraftNotice } from './use-form-draft';
import styles from './project-quick-entry.module.css';
import type { Row } from '@/lib/database';

export type QuickProjectEntry = 'material' | 'loan';
type Props = { kind: QuickProjectEntry; project: Row; items: Row[]; mutate: (action: string, payload: Row) => Promise<Row>; onClose: () => void; onSaved: (itemId?: string) => void };

/** The server rechecks the specific inventory/loan capability at commit time. */
export default function ProjectQuickEntry({ kind, project, items, mutate, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), form = useRef<HTMLFormElement>(null), opener = useRef<HTMLElement | null>(null);
  const key = useRef<string | null>(null), savingRef = useRef(false), alive=useRef(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const draft = useFormDraft(form, `project-quick:${kind}:${project.id}`);
  useEffect(() => {
    alive.current=true;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current;
    node?.showModal();
    const first = node?.querySelector('[data-entry-focus]');
    if (first instanceof HTMLElement) first.focus();
    return () => { alive.current=false; if (node?.open) node.close(); if (opener.current?.isConnected) opener.current.focus({preventScroll:true}); };
  }, []);
  function close() { if (!savingRef.current) onClose(); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(''); key.current ??= crypto.randomUUID();
    const fields = new FormData(event.currentTarget);
    try {
      const payload: Row = { projectId: project.id, operationKey: key.current };
      if (kind === 'material') {
        for (const name of ['name','category','unit','description','assetCode']) payload[name] = fields.get(name);
        payload.lowStock = Number(fields.get('lowStock'));
      } else {
        for (const name of ['itemId','actionName','borrowerName','borrowerContact','note']) payload[name] = fields.get(name);
        payload.startsAt = new Date(String(fields.get('startsAt'))).toISOString();
        payload.endsAt = new Date(String(fields.get('endsAt'))).toISOString();
      }
      const result = await mutate(kind === 'material' ? 'item.create' : 'loan.create', payload);
      draft.clear(); key.current = null; if(!alive.current)return; onSaved(kind === 'material' ? String(result.item?.id ?? result.id ?? '') || undefined : undefined);
    } catch (failure) { if(alive.current)setError(failure instanceof Error ? failure.message : 'Não foi possível salvar. Seu preenchimento foi mantido.'); }
    finally { savingRef.current = false; if(alive.current)setSaving(false); }
  }
  const equipment = items.filter(item => item.category === 'equipment');
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="quick-entry-title" onCancel={event => {event.preventDefault(); close();}}>
    <header className={styles.header}><div><span className="p-kicker">{project.name}</span><h2 id="quick-entry-title">{kind === 'material' ? <><PackagePlus size={21}/>Adicionar material</> : <><Truck size={21}/>Reservar equipamento</>}</h2></div><button type="button" className="p-icon-button" aria-label="Fechar cadastro" disabled={saving} onClick={close}><X size={20}/></button></header>
    <form ref={form} onSubmit={save} onChange={() => {if (!savingRef.current) key.current = null;}}>
      <DraftNotice draft={draft}/><fieldset disabled={saving}>
      <div className={styles.fields}>
      {kind === 'material' ? <>
        <label className={`p-field ${styles.wide}`}><span>Nome *</span><input data-entry-focus name="name" required maxLength={120}/></label>
        <label className="p-field"><span>Tipo de material</span><select name="category"><option value="gift">Brinde</option><option value="consumption">Consumo interno</option><option value="distribution">Distribuição institucional</option><option value="equipment">Equipamento retornável</option></select></label>
        <label className="p-field"><span>Unidade de controle *</span><input name="unit" defaultValue="unidade" required maxLength={40}/></label>
        <label className="p-field"><span>Avisar quando disponível até *</span><input name="lowStock" type="number" min="0" step="1" defaultValue="0" required/></label>
        <label className="p-field"><span>Código do equipamento</span><input name="assetCode" maxLength={100}/></label>
        <label className={`p-field ${styles.wide}`}><span>Descrição</span><textarea name="description" maxLength={500} rows={2}/></label>
      </> : <>
        <label className={`p-field ${styles.wide}`}><span>Equipamento *</span><select data-entry-focus name="itemId" required defaultValue=""><option value="">Selecione um equipamento</option>{equipment.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{!equipment.length && <small>Cadastre um equipamento neste projeto antes de fazer a reserva.</small>}</label>
        <label className={`p-field ${styles.wide}`}><span>Ação atendida *</span><input name="actionName" required maxLength={160} defaultValue={project.name}/></label>
        <label className="p-field"><span>Responsável pela retirada *</span><input name="borrowerName" required maxLength={120}/></label>
        <label className="p-field"><span>Contato para o empréstimo</span><input name="borrowerContact" maxLength={150}/></label>
        <label className="p-field"><span>Retirada prevista *</span><DateTimeField aria-label="Retirada prevista" name="startsAt"  required/></label>
        <label className="p-field"><span>Devolução prevista *</span><DateTimeField aria-label="Devolução prevista" name="endsAt"  required/></label>
        <label className={`p-field ${styles.wide}`}><span>Observações</span><textarea name="note" rows={2} maxLength={1000}/></label>
      </>}
      </div>
      <p className="p-form-help">{kind === 'material' ? 'Começa com saldo zero. Depois da contagem, abra Movimentar para registrar o recebimento.' : 'Horários do aparelho. A disponibilidade é conferida antes de confirmar.'}</p>
      {error && <p role="alert" className="p-inline-error">{error}</p>}
      <footer className={styles.footer}><button type="button" className="p-button p-button-subtle" onClick={close}>Cancelar</button><button className="p-button p-button-primary" type="submit" disabled={kind === 'loan' && !equipment.length}>{saving ? <LoaderCircle size={17} className="p-spin"/> : <Check size={17}/>}Salvar {kind === 'material' ? 'material' : 'reserva'}</button></footer>
      </fieldset>
    </form>
  </dialog>;
}
