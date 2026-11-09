'use client';
import { useEffect, useState } from 'react';
import { DESTINATION_KIND_NAMES, loadDestinations, type DestinationOption } from './destination-field';

type Unit = { id: string; name: string; acronym?: string };
/** Owner (the project, or an organizational unit such as the gabinete) and the event the material is set aside for. */
export default function MaterialOwnershipFields({ projectId, projectName, ownerUnitId, eventDestinationId }: { projectId: string; projectName: string; ownerUnitId: string | null; eventDestinationId: string | null }) {
  const [units, setUnits] = useState<Unit[]>([]), [destinations, setDestinations] = useState<DestinationOption[]>([]), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`/api/materials/context?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' }).then(async response => { const body = await response.json() as { units?: Unit[]; error?: string }; if (!response.ok) throw new Error(body.error || 'Unidades indisponíveis.'); if (active) setUnits(body.units ?? []); }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Unidades indisponíveis.'); });
    loadDestinations(projectId).then(rows => { if (active) setDestinations(rows); }).catch(() => undefined);
    return () => { active = false; };
  }, [projectId]);
  const unitOptions = ownerUnitId && !units.some(unit => unit.id === ownerUnitId) ? [...units, { id: ownerUnitId, name: 'Unidade atual (arquivada)' }] : units;
  const destinationOptions = destinations.filter(row => row.status === 'active' || row.id === eventDestinationId);
  return <>
    <label>Dono do material<select name="ownerUnitId" defaultValue={ownerUnitId ?? ''} key={`owner:${units.length}`}><option value="">{projectName} (o projeto)</option>{unitOptions.map(unit => <option key={unit.id} value={unit.id}>{unit.acronym ? `${unit.acronym} · ` : ''}{unit.name}</option>)}</select><small>Ex.: brindes da Comunicação ou do Gabinete guardados neste estoque. Quem movimenta continua sendo a equipe deste projeto.{error && ` ${error}`}</small></label>
    <label>Destinado a<select name="eventDestinationId" defaultValue={eventDestinationId ?? ''} key={`destination:${destinations.length}`}><option value="">Sem destino definido</option>{destinationOptions.map(row => <option key={row.id} value={row.id}>{row.name} · {DESTINATION_KIND_NAMES[row.kind] ?? 'destino'}{row.status !== 'active' ? ' (arquivado)' : ''}</option>)}</select><small>O evento ou local para onde este material está reservado. Destinos novos são criados ao registrar uma movimentação.</small></label>
  </>;
}
