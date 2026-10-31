'use client';

import { useState } from 'react';
import { ArrowUpRight, ClipboardList, Users } from 'lucide-react';
import type { WorkArea } from '@/lib/my-work/contracts';
import ResponsibilityManager from './responsibility-manager';
import styles from './work-context-panel.module.css';

type Props = { userId: string; projectId: string | null; area: WorkArea; itemId?: string | null; loanId?: string | null; campaignId?: string | null; compact?: boolean; onPersonal: () => void; onDemands?: () => void };

export default function WorkContextPanel({ userId, projectId, area, itemId, loanId, campaignId, compact = false, onPersonal, onDemands }: Props) {
 const owner = JSON.stringify([userId, projectId, area, itemId ?? null, loanId ?? null, campaignId ?? null]);
 const [openedOwner, setOpenedOwner] = useState<string | null>(null);
 const actions = <div className={styles.actions}><button type="button" className="p-button p-button-subtle" onClick={onPersonal}>Meu trabalho<ArrowUpRight size={15} aria-hidden="true"/></button>{onDemands && <button type="button" className="p-button p-button-subtle" onClick={onDemands}>{projectId ? 'Demandas deste projeto' : 'Demandas'}</button>}</div>;
 const manager = projectId ? openedOwner === owner && <ResponsibilityManager key={owner} userId={userId} projectId={projectId} area={area} itemId={itemId} loanId={loanId} campaignId={campaignId}/> : <p>Selecione um projeto no filtro para consultar ou nomear responsáveis. A nomeação organiza o trabalho e não concede acesso.</p>;
 if (compact) return <details key={owner} className={styles.compact} onToggle={event => { if (event.currentTarget.open) setOpenedOwner(owner); }}><summary><Users size={16} aria-hidden="true"/>Responsáveis e demandas</summary><div className={styles.compactBody}>{actions}{manager}</div></details>;
 return <section className={styles.panel} aria-label="Acompanhamento deste contexto">
  <div className={styles.heading}><span className={styles.icon}><ClipboardList size={19} aria-hidden="true"/></span><div><strong>Acompanhamento</strong><p>Responsáveis e demandas relacionados a este contexto.</p></div></div>
  {actions}
  <details key={owner} className={styles.details} onToggle={event => { if (event.currentTarget.open) setOpenedOwner(owner); }}><summary><Users size={16} aria-hidden="true"/>Responsáveis deste contexto</summary>{manager}</details>
 </section>;
}
