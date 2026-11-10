'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
const isTab = (value: unknown): value is Tab => TABS.some(entry => entry.id === value);

/** Gestão da organização: painel estratégico, guia vivo, riscos e equipes-modelo. */
export default function ManagementPanel({ organizations, defaultOrganizationId = '' }: { organizations: { id: string; name: string }[]; defaultOrganizationId?: string }) {
  const [organizationId, setOrganizationId] = useState(organizations.some(organization => organization.id === defaultOrganizationId) ? defaultOrganizationId : organizations[0]?.id ?? '');
  const [tab, setTab] = useState<Tab>('dashboard'), [riskFilter, setRiskFilter] = useState('all');
  // Edição do guia em aberto: trocar de aba ou de organização pede confirmação.
  const guideDirty = useRef(false);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ dashboard: null, guide: null, risks: null, teams: null });
  useEffect(() => {
    // A aba fica no endereço (&tab=riscos…), para recarregar ou mandar o link a um colega.
    const timer = window.setTimeout(() => { const wanted = new URLSearchParams(window.location.search).get('tab'); if (isTab(wanted)) setTab(wanted); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function leaveGuide(): boolean {
    if (!guideDirty.current) return true;
    if (!window.confirm('Sair da edição do guia sem salvar?')) return false;
    guideDirty.current = false; return true;
  }
  function choose(next: Tab, focus = false) {
    if (next === tab || !leaveGuide()) return;
    if (next !== 'risks') setRiskFilter('all');
    setTab(next);
    try { const url = new URL(window.location.href); url.searchParams.set('tab', next); window.history.replaceState(window.history.state, '', url); } catch { /* endereço é conveniência */ }
    if (focus) tabRefs.current[next]?.focus();
  }
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex(entry => entry.id === tab);
    const target = event.key === 'ArrowRight' ? TABS[(index + 1) % TABS.length] : event.key === 'ArrowLeft' ? TABS[(index + TABS.length - 1) % TABS.length] : event.key === 'Home' ? TABS[0] : event.key === 'End' ? TABS[TABS.length - 1] : null;
    if (!target) return;
    event.preventDefault(); choose(target.id, true);
  }
  if (!organizationId) return <p className="p-card">Nenhuma organização disponível para a sua conta.</p>;
  return <section className={styles.root} aria-label="Gestão da organização">
    <div className={styles.toolbar} style={{ justifyContent: 'space-between' }}>
      <div className={styles.tabs} role="tablist" aria-label="Áreas da gestão">
        {TABS.map(({ id, label, icon: Icon }) => <button key={id} ref={node => { tabRefs.current[id] = node; }} type="button" role="tab" id={`management-tab-${id}`} aria-controls={`management-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onKeyDown={onTabKey} onClick={() => choose(id)}><Icon size={17} aria-hidden="true"/>{label}</button>)}
      </div>
      {organizations.length > 1 && <label className="p-field"><span>Organização</span><select value={organizationId} onChange={event => { if (leaveGuide()) setOrganizationId(event.target.value); }}>{organizations.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
    </div>
    <div role="tabpanel" id={`management-panel-${tab}`} aria-labelledby={`management-tab-${tab}`} key={`${tab}:${organizationId}`}>
      {tab === 'dashboard' && <DashboardPanel organizationId={organizationId} onOpenRisks={filter => { setRiskFilter(filter ?? 'all'); choose('risks'); }}/>}
      {tab === 'guide' && <GuidePanel organizationId={organizationId} onDirtyChange={dirty => { guideDirty.current = dirty; }}/>}
      {tab === 'risks' && <RisksPanel organizationId={organizationId} initialFilter={riskFilter}/>}
      {tab === 'teams' && <div className={styles.root}>
        <p className={styles.help}>Modelos de equipe com papéis, responsabilidades, acessos sugeridos e rotinas. Quem gerencia a organização cria a equipe a partir do modelo aqui ou na página Equipes; a equipe nasce sem pessoas.</p>
        <TeamTemplates organizationId={organizationId} catalogOnly/>
        <a className="p-button p-button-subtle" style={{ justifySelf: 'start' }} href={moduleLink('work-teams')}>Abrir Equipes</a>
      </div>}
    </div>
  </section>;
}
