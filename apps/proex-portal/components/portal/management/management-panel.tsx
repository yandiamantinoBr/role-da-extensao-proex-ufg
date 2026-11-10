'use client';
import { useState } from 'react';
import { BookOpen, Gauge, ShieldAlert, Users } from 'lucide-react';
import DashboardPanel from './dashboard-panel';
import GuidePanel from './guide-panel';
import RisksPanel from './risks-panel';
import TeamTemplates from './team-templates';
import styles from './management.module.css';

const moduleLink = (module: string) => `/?module=${module}`;
type Tab = 'dashboard' | 'guide' | 'risks' | 'teams';
const TABS: { id: Tab; label: string; icon: typeof Gauge }[] = [
  { id: 'dashboard', label: 'Painel', icon: Gauge }, { id: 'guide', label: 'Guia da organização', icon: BookOpen },
  { id: 'risks', label: 'Riscos', icon: ShieldAlert }, { id: 'teams', label: 'Equipes-modelo', icon: Users },
];

/** Gestão da organização: painel estratégico, guia vivo, riscos e equipes-modelo. */
export default function ManagementPanel({ organizations, defaultOrganizationId = '' }: { organizations: { id: string; name: string }[]; defaultOrganizationId?: string }) {
  const [organizationId, setOrganizationId] = useState(organizations.some(organization => organization.id === defaultOrganizationId) ? defaultOrganizationId : organizations[0]?.id ?? '');
  const [tab, setTab] = useState<Tab>('dashboard');
  if (!organizationId) return <p className="p-card">Nenhuma organização disponível para a sua conta.</p>;
  return <section className={styles.root} aria-label="Gestão da organização">
    <div className={styles.toolbar} style={{ justifyContent: 'space-between' }}>
      <div className={styles.tabs} role="tablist" aria-label="Áreas da gestão">
        {TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" id={`management-tab-${id}`} aria-controls={`management-panel-${id}`} aria-selected={tab === id} onClick={() => setTab(id)}><Icon size={17} aria-hidden="true"/>{label}</button>)}
      </div>
      {organizations.length > 1 && <label className="p-field"><span>Organização</span><select value={organizationId} onChange={event => setOrganizationId(event.target.value)}>{organizations.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
    </div>
    <div role="tabpanel" id={`management-panel-${tab}`} aria-labelledby={`management-tab-${tab}`} key={`${tab}:${organizationId}`}>
      {tab === 'dashboard' && <DashboardPanel organizationId={organizationId} onOpenRisks={() => setTab('risks')}/>}
      {tab === 'guide' && <GuidePanel organizationId={organizationId}/>}
      {tab === 'risks' && <RisksPanel organizationId={organizationId}/>}
      {tab === 'teams' && <div className={styles.root}>
        <p className={styles.help}>Modelos de equipe com papéis, responsabilidades e acessos sugeridos. Quem gerencia a organização aplica o modelo aqui ou na página Equipes; a equipe nasce vazia.</p>
        <TeamTemplates organizationId={organizationId} catalogOnly/>
        <a className="p-button p-button-subtle" style={{ justifySelf: 'start' }} href={moduleLink('work-teams')}>Abrir Equipes</a>
      </div>}
    </div>
  </section>;
}
