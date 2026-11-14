'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Boxes, Dices, Truck, UsersRound, type LucideIcon } from 'lucide-react';
import { isResponsibilityCatalog, isResponsibilityList, type Responsibility, type WorkArea } from '@/lib/my-work/contracts';
import { projectAccessHref } from '@/lib/team-access-labels';
import { workApi } from './my-work-api';
import ResponsibilityManager from './responsibility-manager';
import styles from './project-area-owners.module.css';

/**
 * Ficha do projeto: "Quem cuida de cada área" (R4 da revisão de 09/11). A escolha de quem cuida do
 * estoque, dos empréstimos ou das dinâmicas inteiras de um projeto só existia no painel do topo desses
 * módulos. Aqui ela usa o mesmo ResponsibilityManager, com a mesma área e sem alvo: mesma rota, mesma
 * permissão e a mesma linha gravada. Indicar organiza o trabalho e não dá acesso a nada.
 */
export type OwnedArea = Exclude<WorkArea, 'projects'>;
export const OWNED_AREAS: { area: OwnedArea; label: string; heading: string; Icon: LucideIcon }[] = [
  { area: 'materials', label: 'Estoque', heading: 'Quem cuida do estoque deste projeto', Icon: Boxes },
  { area: 'loans', label: 'Empréstimos', heading: 'Quem cuida dos empréstimos deste projeto', Icon: Truck },
  { area: 'campaigns', label: 'Dinâmicas', heading: 'Quem cuida das dinâmicas deste projeto', Icon: Dices },
];
type Props = { userId: string; projectId: string; areas: readonly OwnedArea[]; canManageAccess?: boolean; onCreateTeam?: () => void };
type Loaded = { key: string; owner: string; rows?: Responsibility[]; canManage?: boolean; error?: string };

/** Designação da área inteira: sem material, empréstimo nem dinâmica específica. */
export function areaOwners(rows: readonly Responsibility[], projectId: string, area: OwnedArea): string[] {
  const row = rows.find(entry => entry.project_id === projectId && entry.area === area && entry.status === 'active' && !entry.item_id && !entry.loan_id && !entry.campaign_id);
  return row ? row.assignees.map(person => person.name).filter(Boolean) : [];
}

export default function ProjectAreaOwners({ userId, projectId, areas, canManageAccess, onCreateTeam }: Props) {
  const [revision, setRevision] = useState(0), [state, setState] = useState<Loaded | null>(null), [open, setOpen] = useState<{ owner: string; area: OwnedArea } | null>(null);
  const owner = JSON.stringify([userId, projectId]), key = JSON.stringify([owner, revision]), any = areas.length > 0;
  useEffect(() => {
    if (!any) return; // sem área para mostrar, nada é consultado
    const controller = new AbortController();
    const query = new URLSearchParams({ view: 'list', projectId, target: 'area', status: 'active', limit: '50' });
    // O catálogo sem projeto é leve: só diz em quais projetos a pessoa gerencia responsáveis (quem não gerencia não vê botão).
    Promise.all([workApi(`/api/responsibilities?${query}`, isResponsibilityList, controller.signal), workApi('/api/responsibilities?view=catalog', isResponsibilityCatalog, controller.signal)])
      .then(([list, catalog]) => {
        if (controller.signal.aborted) return;
        if (list.viewerId !== userId || catalog.viewerId !== userId || list.projectId !== projectId || catalog.projectId !== null) {
          throw new Error('A sessão ou o projeto da resposta mudou. Atualize este contexto.');
        }
        setState({ key, owner, rows: list.items, canManage: catalog.projects.some(project => project.id === projectId && project.canManage) });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setOpen(null);
        setState({ key, owner, error: error instanceof Error ? error.message : 'Não foi possível consultar quem cuida de cada área.' });
      });
    return () => controller.abort();
  }, [key, owner, userId, projectId, any]);
  const shown = OWNED_AREAS.filter(entry => areas.includes(entry.area));
  if (!shown.length) return null;
  // Ao recarregar, mantém na tela o que já estava.
  const current = state?.key === key ? state : null, last = state?.owner === owner ? state : null, rows = last?.rows, canManage = Boolean(last?.canManage);
  const opened = canManage && open?.owner === owner ? open.area : null;
  return <section className={`p-card ${styles.card}`} aria-labelledby="project-area-owners-title">
    <div className={styles.head}><span className={styles.icon}><UsersRound size={17} aria-hidden="true"/></span><div><h3 id="project-area-owners-title">Quem cuida de cada área</h3><p>Pessoas e equipes de referência para o estoque, os empréstimos e as dinâmicas, com os acessos que já têm.</p></div></div>
    {current?.error && <p className="p-notice p-notice-error" role="alert">{current.error} <button type="button" className="p-text-link" onClick={() => setRevision(value => value + 1)}>Tentar de novo</button></p>}
    <ul className={styles.list}>{shown.map(({ area, label, heading, Icon }) => { const people = rows ? areaOwners(rows, projectId, area) : null, isOpen = opened === area, lower = label.toLocaleLowerCase('pt-BR'); return <li key={area} className={styles.row}>
      <div className={styles.line} data-action={canManage ? 'true' : undefined}>
        <span className={styles.area}><Icon size={16} aria-hidden="true"/>{label}</span>
        <span className={styles.people} data-empty={people && !people.length ? 'true' : undefined}>{people === null ? (current?.error ? 'Não foi possível consultar' : 'Consultando…') : people.length ? people.join(', ') : 'Ninguém indicado'}</span>
        {canManage && <button type="button" className="p-button p-button-subtle" aria-expanded={isOpen} aria-controls={`project-area-owners-${area}`} onClick={() => setOpen(isOpen ? null : { owner, area })}>{isOpen ? 'Fechar' : people?.length ? 'Alterar' : 'Indicar'}<span className="sr-only"> quem cuida de {lower}</span></button>}
      </div>
      {isOpen && <div id={`project-area-owners-${area}`} className={styles.manager}><ResponsibilityManager key={`${owner}:${area}`} userId={userId} projectId={projectId} area={area} heading={heading} onCreateTeam={onCreateTeam} onChanged={() => setRevision(value => value + 1)}/></div>}
    </li>; })}</ul>
    {canManageAccess && <a className={`p-button p-button-subtle ${styles.access}`} href={projectAccessHref(projectId)}>Acessos do projeto<ArrowUpRight size={15} aria-hidden="true"/></a>}
    {rows && !canManage && <p className={styles.foot}>Só quem gerencia este projeto pode indicar ou trocar quem cuida de cada área.</p>}
  </section>;
}
