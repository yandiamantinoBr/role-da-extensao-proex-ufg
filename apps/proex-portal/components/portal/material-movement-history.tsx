'use client';
import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, MapPin, Paperclip, RotateCcw } from 'lucide-react';
import type { StockContext } from '@/lib/stock-context';
import styles from './material-movements.module.css';

export type HistoryMovement = {
  id: string; delta: number; kind: string; reason: string; created_at: string; actor_name: string; group_title?: string | null; context?: StockContext | null;
  status?: 'current' | 'corrected' | 'undone';
  revision?: { id: string; kind: 'correction' | 'reversal'; actorName: string; createdAt: string; reason: string; replacementMovementId: string | null } | null;
  correctionOf?: { revisionId: string; targetMovementId: string; actorName: string; createdAt: string; reason: string; before?: { delta: number } | null } | null;
  destination?: { id: string; name: string; kind: string; href: string } | null;
  origin?: { via: 'assistant' | 'manual'; label: string } | null;
  attachmentCount?: number;
};
export const MOVEMENT_NAMES: Record<string, string> = { receive: 'Recebimento', distribute: 'Distribuição', consume: 'Consumo interno', adjust: 'Ajuste de contagem', redeem: 'Entrega de brinde', transfer: 'Transferência' };
export const when = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`;
type Filter = 'all' | 'in' | 'out' | 'revised';
const FILTERS: [Filter, string][] = [['all', 'Tudo'], ['in', 'Entradas'], ['out', 'Saídas'], ['revised', 'Corrigidas ou desfeitas']];

/** Material history: one row per movement version; mirrors of corrections stay in the detail panel. */
export default function MaterialMovementHistory({ movements, unit, onOpen, onDestinationOpen }: { movements: HistoryMovement[]; unit: string; onOpen: (id: string) => void; onDestinationOpen?: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = movements.filter(movement => filter === 'all' ? true : filter === 'in' ? movement.delta > 0 : filter === 'out' ? movement.delta < 0 : movement.status !== 'current' || Boolean(movement.correctionOf));
  return <div className={styles.history}>
    <div className={styles.filters} role="group" aria-label="Filtrar movimentações">{FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    {shown.length ? <ul className={styles.list}>{shown.map(movement => {
      const superseded = movement.status === 'corrected' || movement.status === 'undone', measure = movement.context?.measurementUnit ?? unit;
      const kindName = MOVEMENT_NAMES[movement.kind] || movement.kind, label = `${kindName} de ${Math.abs(movement.delta)} ${measure}, ${when(movement.context?.dateSource === 'declared' ? movement.context.occurredAt : movement.created_at)}. Abrir detalhes`;
      return <li key={movement.id} className={`${styles.entry} ${superseded ? styles.superseded : ''}`}>
        {/* The whole row opens the detail for mouse and touch; keyboard users reach the title button. */}
        <div className={styles.entryButton} onClick={event => { if (!(event.target as Element).closest('[data-stop]')) onOpen(movement.id); }}>
          <span className={`${styles.icon} ${superseded ? styles.muted : movement.delta > 0 ? styles.in : styles.out}`} aria-hidden="true">{movement.status === 'undone' ? <RotateCcw size={17}/> : movement.delta > 0 ? <ArrowDownLeft size={17}/> : <ArrowUpRight size={17}/>}</span>
          <div className={styles.title}>
            <button type="button" data-stop className={styles.entryTitle} aria-label={label} onClick={() => onOpen(movement.id)}>{kindName}</button>
            {movement.status === 'corrected' && <span className={`${styles.chip} ${styles.chipCorrected}`}>Corrigida</span>}
            {movement.status === 'undone' && <span className={`${styles.chip} ${styles.chipUndone}`}>Desfeita</span>}
            {movement.correctionOf && movement.status === 'current' && <span className={`${styles.chip} ${styles.chipRole}`}>Versão corrigida</span>}
          </div>
          <div className={`${styles.quantity} ${superseded ? styles.struck : movement.delta > 0 ? styles.positive : styles.negative}`}>{signed(movement.delta)} {measure}{movement.correctionOf?.before && <small>antes {signed(movement.correctionOf.before.delta)}</small>}</div>
          <div className={styles.meta}>
            <p>{movement.reason || 'Sem observação adicional'}</p>
            {movement.destination && <p className={styles.place}><MapPin size={13} aria-hidden="true"/> {movement.kind === 'receive' ? 'Veio de' : 'Para'} {onDestinationOpen ? <button type="button" data-stop className={styles.destinationLink} onClick={() => onDestinationOpen(movement.destination!.id)}>{movement.destination.name}</button> : <a className={styles.destinationLink} data-stop href={movement.destination.href}>{movement.destination.name}</a>}</p>}
            {!movement.destination && movement.context?.counterpartyName && <p>{movement.kind === 'receive' ? 'Origem' : 'Destino'}: {movement.context.counterpartyName}</p>}
            {movement.group_title && <p>Ação: {movement.group_title}</p>}
            <small>{movement.origin?.label ?? `Registrado por ${movement.actor_name}`} · {when(movement.created_at)}{movement.context?.dateSource === 'declared' && !movement.correctionOf ? ` · ocorreu em ${when(movement.context.occurredAt)}` : ''}</small>
            {movement.revision && <small>{movement.revision.kind === 'reversal' ? 'Desfeita' : 'Corrigida'} por {movement.revision.actorName} em {when(movement.revision.createdAt)}: {movement.revision.reason}</small>}
            {movement.correctionOf && <small>Motivo da correção: {movement.correctionOf.reason}</small>}
            <span className={styles.chips}>{(movement.attachmentCount ?? 0) > 0 && <span className={styles.chip}><Paperclip size={12} aria-hidden="true"/>{movement.attachmentCount} {movement.attachmentCount === 1 ? 'anexo' : 'anexos'}</span>}<span className={styles.chip} aria-hidden="true">Ver detalhes <ChevronRight size={12}/></span></span>
          </div>
        </div>
      </li>;
    })}</ul> : <p className={styles.empty}>{filter === 'all' ? 'As movimentações deste material aparecerão aqui.' : 'Nenhuma movimentação neste filtro.'}</p>}
  </div>;
}
