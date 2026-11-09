'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ExternalLink, LoaderCircle, MapPin, Pencil, X } from 'lucide-react';
import { DESTINATION_KIND_NAMES } from './destination-field';
import { MOVEMENT_NAMES, when } from './material-movement-history';
import styles from './material-movements.module.css';

type Page = {
  destination: { id: string; name: string; kind: string; kindLabel: string; officialUrl: string; status: string; description: string; version: number; unit: { id: string; name: string; acronym: string; officialUrl: string } | null };
  movements: { id: string; delta: number; kind: string; note: string; occurredAt: string; itemId: string; itemName: string; unit: string; projectName: string; actorName: string; status: 'current' | 'corrected' | 'undone'; isCorrection: boolean; linkSource: string; materialHref: string }[];
  movementsTruncated: boolean;
  totals: { itemId: string; itemName: string; unit: string; projectName: string; outgoing: number; incoming: number; movementCount: number; materialHref: string }[];
  destinedItems: { id: string; name: string; unit: string; stock: number; available: number; projectName: string; materialHref: string }[];
  permissions: { canManage: boolean }; notice: string;
};
const STATUS: Record<string, string> = { corrected: 'corrigida', undone: 'desfeita' };

/** Page of a destination (event, place, partner or unit): official link and everything that went there. */
export default function DestinationDialog({ destinationId, onClose, onOpenMaterial }: { destinationId: string; onClose: () => void; onOpenMaterial?: (itemId: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const [page, setPage] = useState<Page | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const response = await fetch(`/api/materials/destinations?id=${encodeURIComponent(destinationId)}`, { cache: 'no-store' });
    const body = await response.json() as Page & { error?: string };
    if (!response.ok) throw new Error(body.error || 'Não foi possível abrir o destino.');
    setPage(body);
  }, [destinationId]);
  useEffect(() => {
    const node = dialog.current, opener = document.activeElement;
    node?.showModal(); heading.current?.focus({ preventScroll: true });
    const start = window.setTimeout(() => void reload().catch(failure => setError(failure instanceof Error ? failure.message : 'Não foi possível abrir o destino.')), 0);
    return () => { window.clearTimeout(start); if (node?.open) node.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }); };
  }, [reload]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!page || busy) return;
    const fields = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      const response = await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: 'destination.update', id: page.destination.id, expectedVersion: page.destination.version, name: fields.get('name'), kind: fields.get('kind'), officialUrl: fields.get('officialUrl'), description: fields.get('description'), status: fields.get('status') }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Não foi possível salvar o destino.');
      setEditing(false); setNotice('Destino atualizado.'); await reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar o destino.'); }
    finally { setBusy(false); }
  }
  const open = (itemId: string) => { if (onOpenMaterial) { onClose(); onOpenMaterial(itemId); } };
  const destination = page?.destination;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="destination-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }} onClose={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={styles.shell}>
      <header className={styles.head}><div><span className={styles.eyebrow}>DESTINO DE MATERIAIS</span><h2 id="destination-title" ref={heading} tabIndex={-1}><MapPin size={18} aria-hidden="true"/> {destination?.name ?? 'Carregando destino…'}</h2>{destination && <p className={styles.destHead}><span className={`${styles.chip} ${styles.chipRole}`}>{destination.kindLabel}</span>{destination.status !== 'active' && <span className={`${styles.chip} ${styles.chipUndone}`}>Arquivado</span>}</p>}</div><button type="button" className="p-icon-button" aria-label="Fechar destino" onClick={onClose} disabled={busy}><X size={20}/></button></header>
      <div className={styles.body}>
        {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
        {!page || !destination ? !error && <div className={styles.loading}><LoaderCircle className="p-spin" size={22}/>Carregando…</div> : <>
          {destination.description && <p className="p-form-help">{destination.description}</p>}
          <div className={styles.actions}>
            {destination.officialUrl && <a className="p-button p-button-primary" href={destination.officialUrl} target="_blank" rel="noreferrer noopener">Página oficial <ExternalLink size={15} aria-hidden="true"/></a>}
            {destination.unit?.officialUrl && <a className="p-button p-button-subtle" href={destination.unit.officialUrl} target="_blank" rel="noreferrer noopener">{destination.unit.acronym || destination.unit.name} <ExternalLink size={15} aria-hidden="true"/></a>}
            {!destination.officialUrl && <p className={styles.hint}>Sem link oficial cadastrado{page.permissions.canManage ? '. Use Editar destino para incluir a página do evento ou do local.' : '.'}</p>}
            {page.permissions.canManage && !editing && <button type="button" className="p-button p-button-subtle" onClick={() => setEditing(true)}><Pencil size={15} aria-hidden="true"/>Editar destino</button>}
          </div>
          {editing && <form className={styles.form} onSubmit={save}><fieldset disabled={busy} style={{ display: 'contents' }}>
            <h3>Editar destino</h3>
            <div className={styles.grid2}><label>Nome<input name="name" required minLength={2} maxLength={160} defaultValue={destination.name}/></label><label>Tipo<select name="kind" defaultValue={destination.kind}>{Object.entries(DESTINATION_KIND_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
            <label>Link oficial<input name="officialUrl" type="url" maxLength={500} placeholder="https://" defaultValue={destination.officialUrl}/><small>Página do evento, do local ou do parceiro. Use https://.</small></label>
            <label>Descrição<textarea name="description" rows={2} maxLength={1000} defaultValue={destination.description}/></label>
            <label>Situação<select name="status" defaultValue={destination.status}><option value="active">Ativo (aparece nas sugestões)</option><option value="archived">Arquivado (não recebe novas movimentações)</option></select></label>
            <div className={styles.actions}><button type="submit" className="p-button p-button-primary">{busy ? <LoaderCircle className="p-spin" size={16}/> : <Check size={16} aria-hidden="true"/>}Salvar destino</button><button type="button" className="p-button p-button-subtle" onClick={() => setEditing(false)}>Cancelar</button></div>
          </fieldset></form>}
          <section className={styles.section} aria-labelledby="destination-totals"><h3 id="destination-totals">O que foi para este destino</h3>
            {page.totals.length ? <ul className={styles.rows}>{page.totals.map(total => <li key={`${total.itemId}:${total.unit}`}><span>{onOpenMaterial ? <button type="button" className={styles.linkButton} onClick={() => open(total.itemId)}>{total.itemName}</button> : <a className={styles.linkButton} href={total.materialHref}>{total.itemName}</a>}</span><b className={styles.negative}>saiu {total.outgoing} {total.unit}</b><small>{total.projectName} · {total.movementCount} {total.movementCount === 1 ? 'movimentação vigente' : 'movimentações vigentes'}{total.incoming ? ` · entrou ${total.incoming} ${total.unit}` : ''}</small></li>)}</ul> : <p className="p-form-help">Nenhuma movimentação vigente para este destino nos projetos que você consulta.</p>}
          </section>
          {page.destinedItems.length > 0 && <section className={styles.section} aria-labelledby="destination-items"><h3 id="destination-items">Materiais reservados para este destino</h3><ul className={styles.rows}>{page.destinedItems.map(item => <li key={item.id}>{onOpenMaterial ? <button type="button" className={styles.linkButton} onClick={() => open(item.id)}>{item.name}</button> : <a className={styles.linkButton} href={item.materialHref}>{item.name}</a>}<span>{item.available} {item.unit} disponíveis</span><small>{item.projectName}</small></li>)}</ul></section>}
          {page.movements.length > 0 && <section className={styles.section} aria-labelledby="destination-moves"><h3 id="destination-moves">Movimentações</h3><ul className={styles.rows}>{page.movements.map(row => <li key={row.id}><span>{onOpenMaterial ? <button type="button" className={styles.linkButton} onClick={() => open(row.itemId)}>{row.itemName}</button> : <a className={styles.linkButton} href={row.materialHref}>{row.itemName}</a>} · {MOVEMENT_NAMES[row.kind] ?? row.kind}{row.status !== 'current' && <> · <span className={`${styles.chip} ${row.status === 'undone' ? styles.chipUndone : styles.chipCorrected}`}>{STATUS[row.status]}</span></>}{row.isCorrection && row.status === 'current' && <> · <span className={`${styles.chip} ${styles.chipRole}`}>versão corrigida</span></>}</span><b className={row.status !== 'current' ? styles.struck : row.delta < 0 ? styles.negative : styles.positive}>{row.delta > 0 ? '+' : '−'}{Math.abs(row.delta)} {row.unit}</b><small>{when(row.occurredAt)} · {row.actorName} · {row.projectName}{row.linkSource === 'unit' ? ' · pela unidade informada' : ''}{row.note ? ` · ${row.note}` : ''}</small></li>)}</ul>{page.movementsTruncated && <p className="p-form-help">Mostrando as 300 mais recentes.</p>}</section>}
          <p className="p-form-help">{page.notice}</p>
        </>}
      </div>
    </div>
  </dialog>;
}
