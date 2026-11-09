'use client';
import { useEffect, useId, useState } from 'react';
import styles from './material-movements.module.css';

export type DestinationOption = { id: string; name: string; kind: string; status: string; movementCount?: number };
export const DESTINATION_KIND_NAMES: Record<string, string> = { event: 'Evento', place: 'Local', unit: 'Unidade ou órgão', partner: 'Parceiro', other: 'Outro destino' };
const cache = new Map<string, Promise<DestinationOption[]>>();
/** Destinations of the project's organization; shared by every field on the page and refreshed after a save. */
export function loadDestinations(projectId: string, refresh = false): Promise<DestinationOption[]> {
  if (!projectId) return Promise.resolve([]);
  if (refresh || !cache.has(projectId)) {
    cache.set(projectId, fetch(`/api/materials/destinations?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' }).then(async response => {
      const body = await response.json() as { destinations?: DestinationOption[]; error?: string };
      if (!response.ok) throw new Error(body.error || 'Não foi possível carregar os destinos.');
      return body.destinations ?? [];
    }).catch(error => { cache.delete(projectId); throw error; }));
  }
  return cache.get(projectId)!;
}
const key = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
/** Fields sent with stock.move / stock.revise. The server matches the typed name or creates the destination. */
export function destinationFields(form: FormData): Record<string, string> {
  const name = String(form.get('destinationName') ?? '').trim();
  return name ? { destinationName: name, destinationKind: String(form.get('destinationKind') || 'place') } : {};
}
export default function DestinationField({ projectId, kind, defaultName = '' }: { projectId: string; kind: string; defaultName?: string }) {
  const listId = useId(), [options, setOptions] = useState<DestinationOption[]>([]), [value, setValue] = useState(defaultName), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    loadDestinations(projectId).then(rows => { if (active) { setOptions(rows.filter(row => row.status === 'active')); setError(''); } }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Destinos indisponíveis.'); });
    return () => { active = false; };
  }, [projectId]);
  const match = value.trim() ? options.find(option => key(option.name) === key(value)) : undefined;
  const label = kind === 'receive' ? 'Veio de (evento, parceiro ou local)' : kind === 'adjust' ? 'Evento ou local relacionado' : 'Para onde foi (evento, local ou parceiro)';
  return <div className={styles.destinationField}>
    <div className={value.trim() && !match ? styles.grid2 : undefined}>
      <label className="p-field"><span>{label}</span>
        <input name="destinationName" list={listId} value={value} maxLength={160} autoComplete="off" placeholder="Ex.: Centro de Eventos da UFG" onChange={event => setValue(event.target.value)}/>
        <datalist id={listId}>{options.map(option => <option key={option.id} value={option.name}>{DESTINATION_KIND_NAMES[option.kind] ?? ''}</option>)}</datalist>
        <small>{match ? `Destino já cadastrado (${DESTINATION_KIND_NAMES[match.kind] ?? 'destino'}). A movimentação aparecerá na página dele.` : value.trim() ? 'Novo destino: ele ganha uma página própria ao salvar.' : 'Opcional. Escolha um destino existente ou digite um novo.'}{error && ` ${error}`}</small>
      </label>
      {value.trim() && !match ? <label className="p-field"><span>Tipo do novo destino</span><select name="destinationKind" defaultValue="place">{Object.entries(DESTINATION_KIND_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label> : <input type="hidden" name="destinationKind" value={match?.kind ?? 'place'}/>}
    </div>
  </div>;
}
