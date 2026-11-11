'use client';

import { useState } from 'react';
import { ArrowUpRight, Users } from 'lucide-react';
import type { WorkArea } from '@/lib/my-work/contracts';
import ResponsibilityManager from './responsibility-manager';
import styles from './work-context-panel.module.css';

type Props = { userId: string; projectId: string | null; area: WorkArea; itemId?: string | null; loanId?: string | null; campaignId?: string | null; onPersonal: () => void; onDemands?: () => void; onCreateTeam?: () => void };

/**
 * "Responsáveis e demandas" de uma ficha ou cartão (projeto, material, empréstimo ou dinâmica).
 * A versão larga que ficava no topo de Materiais, Empréstimos e Dinâmicas saiu (R4): quem cuida da área
 * inteira fica na ficha do projeto, em "Quem cuida de cada área".
 */
export default function WorkContextPanel({ userId, projectId, area, itemId, loanId, campaignId, onPersonal, onDemands, onCreateTeam }: Props) {
 const owner = JSON.stringify([userId, projectId, area, itemId ?? null, loanId ?? null, campaignId ?? null]);
 const [openedOwner, setOpenedOwner] = useState<string | null>(null);
 const actions = <div className={styles.actions}><button type="button" className="p-button p-button-subtle" onClick={onPersonal}>Meu trabalho<ArrowUpRight size={15} aria-hidden="true"/></button>{onDemands && <button type="button" className="p-button p-button-subtle" onClick={onDemands}>{projectId ? 'Demandas deste projeto' : 'Demandas'}</button>}</div>;
 const manager = projectId ? openedOwner === owner && <ResponsibilityManager key={owner} userId={userId} projectId={projectId} area={area} itemId={itemId} loanId={loanId} campaignId={campaignId} onCreateTeam={onCreateTeam}/> : <p>Selecione um projeto no filtro para consultar ou nomear responsáveis. A nomeação organiza o trabalho e não concede acesso.</p>;
 return <details key={owner} className={styles.compact} onToggle={event => { if (event.currentTarget.open) setOpenedOwner(owner); }}><summary><Users size={16} aria-hidden="true"/>Responsáveis e demandas</summary><div className={styles.compactBody}>{actions}{manager}</div></details>;
}
