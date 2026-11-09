'use client';
import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { ArrowRight, Gift, MapPin, Package, SlidersHorizontal, X } from 'lucide-react';
import styles from './material-catalog.module.css';

type CatalogMaterial = {
  id: string;
  name: string;
  category: string;
  project: string;
  assetCode: string;
  condition: string;
  unit: string;
  physical: number | string;
  reserved: number | string;
  available: number;
  availabilityNote: string;
  lowStock: boolean;
  canOpen: boolean;
  /** Foto principal (já autorizada pelo servidor); sem ela, um marcador neutro. */
  photoUrl?: string | null;
  /** Filtros: tipo de controle, categoria própria, dono (projeto ou unidade) e destino reservado. */
  typeKey?: string;
  categoryLabel?: string;
  ownerKey?: string;
  ownerLabel?: string;
  destinationName?: string;
};
export type CatalogKit = { id: string; name: string; kind: string; project: string; active: boolean; components: { name: string; quantity: number; unit: string; available: number }[] };
type Filters = { owner: string; type: string; category: string; situation: string; photo: string };
const EMPTY: Filters = { owner: '', type: '', category: '', situation: '', photo: '' };
const TYPE_NAMES: Record<string, string> = { gift: 'Brindes', equipment: 'Equipamentos', distribution: 'Distribuição institucional', consumption: 'Consumo interno', kit: 'Kits de brinde' };
const SITUATIONS: Record<string, string> = { active: 'Em uso', low: 'Estoque baixo', empty: 'Sem saldo disponível', maintenance: 'Em manutenção', inactive: 'Fora de uso' };
function matches(material: CatalogMaterial, filters: Filters): boolean {
  if (filters.type === 'kit') return false;
  if (filters.owner && material.ownerKey !== filters.owner) return false;
  if (filters.type && material.typeKey !== filters.type) return false;
  if (filters.category && (material.categoryLabel || '') !== filters.category) return false;
  if (filters.photo && (filters.photo === 'with') !== Boolean(material.photoUrl)) return false;
  if (filters.situation === 'low') return material.lowStock;
  if (filters.situation === 'empty') return material.condition === 'active' && material.available <= 0;
  if (filters.situation) return material.condition === filters.situation;
  return true;
}

/** Miniatura decorativa: o nome ao lado já identifica o material para leitores de tela. */
function MaterialThumb({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = Boolean(url) && failed !== url;
  return <span className={`${styles.thumb} ${showPhoto ? '' : styles.thumbEmpty}`} aria-hidden="true">
    {/* eslint-disable-next-line @next/next/no-img-element -- foto privada da API de anexos; o otimizador de imagens não recebe a sessão. */}
    {showPhoto ? <img src={url!} alt="" width={48} height={48} loading="lazy" decoding="async" onError={() => setFailed(url!)}/> : <Package size={20}/>}
  </span>;
}

/** Catalog with filters (owner, type, category, situation, photo) and the gift kits of the selection. */
export function FilterableMaterialCatalog({ materials: everything, kits = [], onOpen, empty }: {
  materials: CatalogMaterial[];
  kits?: CatalogKit[];
  onOpen: (id: string) => void;
  empty?: ReactNode;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY), [open, setOpen] = useState(false);
  const options = useMemo(() => {
    const owners = new Map<string, string>(), categories = new Set<string>(), types = new Set<string>();
    for (const material of everything) { if (material.ownerKey) owners.set(material.ownerKey, material.ownerLabel || material.ownerKey); if (material.categoryLabel) categories.add(material.categoryLabel); if (material.typeKey) types.add(material.typeKey); }
    if (kits.length) types.add('kit');
    return { owners: [...owners].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), categories: [...categories].sort((a, b) => a.localeCompare(b, 'pt-BR')), types: [...types] };
  }, [everything, kits.length]);
  const materials = everything.filter(material => matches(material, filters));
  const showKits = kits.length > 0 && (!filters.type || filters.type === 'kit' || filters.type === 'gift') && !filters.category && !filters.situation && !filters.photo && !filters.owner;
  const active = Object.values(filters).filter(Boolean).length;
  const set = (key: keyof Filters) => (event: ChangeEvent<HTMLSelectElement>) => setFilters(current => ({ ...current, [key]: event.target.value }));
  const select = (key: keyof Filters, label: string, entries: [string, string][], allLabel: string) => entries.length > (key === 'photo' || key === 'situation' ? 0 : 1) || filters[key] ? <label className={styles.filter}><span>{label}</span><select name={`materialFilter-${key}`} value={filters[key]} onChange={set(key)}><option value="">{allLabel}</option>{entries.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label> : null;
  return <div className={styles.catalog}>
    {everything.length > 0 && <div className={styles.filterBar}>
      <button type="button" className={`p-button p-button-subtle ${styles.filterToggle}`} aria-expanded={open} aria-controls="material-filters" onClick={() => setOpen(value => !value)}><SlidersHorizontal size={16} aria-hidden="true"/>Filtros{active ? ` (${active})` : ''}</button>
      <div id="material-filters" className={`${styles.filterBody} ${open ? styles.filterOpen : ''}`} role="group" aria-label="Filtrar catálogo de materiais">
        {select('owner', 'Dono', options.owners, 'Todos os donos')}
        {select('type', 'Tipo', options.types.map(type => [type, TYPE_NAMES[type] ?? type] as [string, string]), 'Todos os tipos')}
        {select('category', 'Categoria', options.categories.map(label => [label, label] as [string, string]), 'Todas as categorias')}
        {select('situation', 'Situação', Object.entries(SITUATIONS), 'Todas')}
        {select('photo', 'Foto', [['with', 'Com foto'], ['without', 'Sem foto']], 'Todas')}
      </div>
      <p className={styles.filterCount} role="status">{filters.type === 'kit' ? `${kits.length} ${kits.length === 1 ? 'kit' : 'kits'}` : `${materials.length} de ${everything.length} ${everything.length === 1 ? 'material' : 'materiais'}`}{active > 0 && <button type="button" className="p-text-link" onClick={() => setFilters(EMPTY)}><X size={14} aria-hidden="true"/>Limpar filtros</button>}</p>
    </div>}
    {materials.length === 0 && filters.type !== 'kit' && (everything.length ? <p className={styles.noResults}>Nenhum material com esses filtros.</p> : empty)}
    {materials.length > 0 && <MaterialCatalog materials={materials} onOpen={onOpen}/>}
    {showKits && <section className={styles.kits} aria-labelledby="catalog-kits"><h3 id="catalog-kits"><Gift size={17} aria-hidden="true"/>Kits de brinde</h3><ul>{kits.map(kit => { const possible = kit.components.length ? Math.max(0, Math.min(...kit.components.map(component => Math.floor(component.available / Math.max(1, component.quantity))))) : 0; return <li key={kit.id}><div><strong>{kit.name}</strong><small>{kit.kind === 'super' ? 'Super brinde' : 'Brinde'} · {kit.project}{kit.active ? '' : ' · inativo'}</small><small>{kit.components.map(component => `${component.quantity} × ${component.name}`).join(' + ')}</small></div><span className={possible > 0 ? styles.available : styles.low}>{possible}<small> {possible === 1 ? 'kit possível' : 'kits possíveis'}</small></span></li>; })}</ul></section>}
  </div>;
}

/** Plain balance table (no hooks): rows already filtered by the caller. */
export default function MaterialCatalog({ materials, onOpen }: {
  materials: CatalogMaterial[];
  onOpen: (id: string) => void;
}) {
  return <div className={styles.catalog}>
    <div className={`p-card p-table-wrap ${styles.frame}`}>
      {/* The narrow layout changes CSS display, so keep table roles explicit. */}
      <table className={styles.table} role="table" aria-label="Saldo de materiais">
        <thead className={styles.header} role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">Material</th>
            <th scope="col" role="columnheader">Físico</th>
            <th scope="col" role="columnheader">Reservado</th>
            <th scope="col" role="columnheader">Disponível</th>
            <th scope="col" role="columnheader">Ações</th>
          </tr>
        </thead>
        <tbody className={styles.rows} role="rowgroup">
          {materials.map(material => {
            const detailsLabel = `Abrir detalhes de ${material.name}`;
            const availabilityColor = material.lowStock ? styles.low : material.available > 0 ? styles.available : '';
            return <tr className={styles.row} key={material.id} role="row">
              <td className={styles.identity} role="rowheader">
                <div className={styles.identityRow}>
                <MaterialThumb url={material.canOpen ? material.photoUrl : null}/>
                <div className={styles.identityText}>
                {material.canOpen && <button type="button" className={`p-text-link ${styles.nameLink}`} aria-label={detailsLabel} onClick={() => onOpen(material.id)}>
                  <strong>{material.name}</strong>
                </button>}
                <strong className={`${styles.materialName} ${material.canOpen ? styles.mobileName : ''}`}>{material.name}</strong>
                <small>{material.category} · {material.ownerLabel && material.ownerLabel !== material.project ? `${material.ownerLabel} (em ${material.project})` : material.project}</small>
                {material.destinationName && <small className={styles.destination}><MapPin size={12} aria-hidden="true"/>Para {material.destinationName}</small>}
                {material.assetCode && <small>Código: {material.assetCode}</small>}
                {material.availabilityNote && <span className={`p-badge p-status-paused ${styles.mobileNote}`}>{material.availabilityNote}</span>}
                {material.condition !== 'active' && <span className="p-badge p-status-paused">
                  {material.condition === 'maintenance' ? 'Em manutenção' : 'Inativo'}
                </span>}
                </div>
                </div>
              </td>
              <td className={styles.metric} role="cell">
                <span className={styles.metricLabel} aria-hidden="true">Físico <span className={styles.labelUnit}>({material.unit})</span></span>
                <span className={styles.number}>{material.physical}</span>
                <small className={styles.unit}>({material.unit})</small>
              </td>
              <td className={styles.metric} role="cell">
                <span className={styles.metricLabel} aria-hidden="true">Reservado</span>
                <span className={styles.number}>{material.reserved}</span>
              </td>
              <td className={styles.metric} role="cell">
                <span className={styles.metricLabel} aria-hidden="true">Disponível</span>
                <span className={`${styles.number} ${availabilityColor}`}>{material.available}</span>
                {material.lowStock && <small className={styles.warning}>Estoque baixo</small>}
                {material.availabilityNote && <small className={styles.desktopNote}>{material.availabilityNote}</small>}
              </td>
              <td className={styles.actions} role="cell">
                {material.canOpen ? <button type="button" className="p-button p-button-subtle" aria-label={detailsLabel} onClick={() => onOpen(material.id)}>
                  Detalhes <ArrowRight size={15} aria-hidden="true" />
                </button> : <small>Somente consulta de saldo</small>}
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}
