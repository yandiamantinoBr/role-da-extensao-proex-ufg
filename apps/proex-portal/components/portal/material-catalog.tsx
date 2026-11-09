'use client';
import { useState } from 'react';
import { ArrowRight, Package } from 'lucide-react';
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
};

/** Miniatura decorativa: o nome ao lado já identifica o material para leitores de tela. */
function MaterialThumb({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = Boolean(url) && failed !== url;
  return <span className={`${styles.thumb} ${showPhoto ? '' : styles.thumbEmpty}`} aria-hidden="true">
    {showPhoto ? <img src={url!} alt="" width={48} height={48} loading="lazy" decoding="async" onError={() => setFailed(url!)}/> : <Package size={20}/>}
  </span>;
}

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
                <small>{material.category} · {material.project}</small>
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
