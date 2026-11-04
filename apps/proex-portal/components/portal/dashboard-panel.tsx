'use client';
import { useState } from 'react';
import { ArrowRight, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, FolderKanban, Info, PackageSearch, Pin, Settings2, TriangleAlert, type LucideIcon } from 'lucide-react';
import { recommendedModules, type ModuleId, type PortalModule } from './navigation-model';
import styles from './dashboard-panel.module.css';
// Only server-projected records are used for business counts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Props = {
    modules: PortalModule[];
    pinned: ModuleId[];
    frequent: ModuleId[];
    onNavigate: (id: ModuleId) => void;
    onTogglePin: (id: ModuleId) => void;
    displayName: string;
    role: string;
    roleLabel: string;
    projects: Row[];
    items: Row[];
    loans: Row[];
    campaigns: Row[];
    selectedProjectId: string;
    unitName?: string;
    now: number;
    onSelectProject: (id: string) => void;
    known: {
        projects: boolean;
        items: boolean;
        loans: boolean;
        campaigns: boolean;
    };
};
type Summary = {
    id: ModuleId;
    title: string;
    value: string | number;
    detail: string;
    note?: string;
    share?: number;
    icon: LucideIcon;
};
const available = (item: Row) => Number(item.available ?? (Number(item.stock ?? 0) - Number(item.reserved ?? 0)));
const date = (value: unknown) => { const result = new Date(value as string | number); return Number.isFinite(result.getTime()) ? result.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Data não informada'; };
export default function DashboardPanel({ modules, pinned, frequent, onNavigate, onTogglePin, displayName, role, roleLabel, projects, items, loans, campaigns, selectedProjectId, unitName, now, onSelectProject, known }: Props) {
    const [customizing, setCustomizing] = useState(false);
    const allowed = modules.map(module => module.id);
    const find = (id: ModuleId) => modules.find(module => module.id === id);
    const selected = projects.find(project => project.id === selectedProjectId);
    const scopedProjects = selectedProjectId ? projects.filter(project => project.id === selectedProjectId) : projects;
    const externalProjects = scopedProjects.filter(project => project.scope === 'external').length;
    const internalProjects = scopedProjects.length - externalProjects;
    const projectScopeDetail = `${internalProjects} ${internalProjects === 1 ? 'interno' : 'internos'} · ${externalProjects} ${externalProjects === 1 ? 'externo' : 'externos'}`;
    const lowStock = items.filter(item => item.category !== 'equipment' && item.condition === 'active' && available(item) <= Number(item.low_stock ?? item.lowStock ?? 0));
    const reserved = loans.filter(loan => loan.status === 'reserved');
    const checkedOut = loans.filter(loan => loan.status === 'out');
    const late = checkedOut.filter(loan => new Date(loan.ends_at ?? loan.endsAt).getTime() < now);
    const drafts = campaigns.filter(campaign => campaign.status === 'draft');
    const activeCampaignCount = campaigns.filter(campaign => campaign.status === 'active').length;
    const currentLoanCount = reserved.length + checkedOut.length;
    const campaignCount = activeCampaignCount + drafts.length;
    const upcoming = [...reserved].filter(loan => new Date(loan.starts_at ?? loan.startsAt).getTime() >= now).sort((a, b) => new Date(a.starts_at ?? a.startsAt).getTime() - new Date(b.starts_at ?? b.startsAt).getTime()).slice(0, 3);
    const summaries: Summary[] = [];
    const projectModule = find('projects');
    if (projectModule) {
        summaries.push({
            id: 'projects',
            title: 'Projetos',
            value: known.projects ? scopedProjects.length : 'Consultar',
            detail: known.projects ? projectScopeDetail : selected ? 'Projeto selecionado nos filtros' : 'Áreas de trabalho disponíveis',
            share: known.projects && scopedProjects.length ? internalProjects / scopedProjects.length : undefined,
            icon: projectModule.icon,
        });
    }
    const materialModule = find('materials');
    if (materialModule) {
        summaries.push({
            id: 'materials',
            title: 'Materiais',
            value: known.items ? items.length : 'Consultar',
            detail: 'Itens nos projetos selecionados',
            note: known.items && lowStock.length ? `${lowStock.length} com saldo baixo` : undefined,
            icon: materialModule.icon,
        });
    }
    const loanModule = find('loans');
    if (loanModule) {
        summaries.push({
            id: 'loans',
            title: 'Empréstimos',
            value: known.loans ? currentLoanCount : 'Consultar',
            detail: known.loans ? `${checkedOut.length} retirados · ${reserved.length} reservados` : 'Consulte retiradas e devoluções',
            note: known.loans && late.length ? `${late.length} em atraso` : undefined,
            share: known.loans && currentLoanCount ? checkedOut.length / currentLoanCount : undefined,
            icon: loanModule.icon,
        });
    }
    const eventModule = find('events');
    if (eventModule) {
        summaries.push({
            id: 'events',
            title: 'Dinâmicas',
            value: known.campaigns ? activeCampaignCount : 'Consultar',
            detail: known.campaigns ? `${activeCampaignCount} ativadas · ${drafts.length} em preparação` : 'Campanhas de roleta e dado',
            share: known.campaigns && campaignCount ? activeCampaignCount / campaignCount : undefined,
            icon: eventModule.icon,
        });
    }
    if (find('calendar'))
        summaries.push({ id: 'calendar', title: 'Agenda', value: 'Ver agenda', detail: 'Ações, reservas e datas compartilhadas', icon: CalendarDays });
    if (find('reports'))
        summaries.push({ id: 'reports', title: 'Relatórios', value: 'Consultar', detail: 'Resultados e exportações do seu acesso', icon: find('reports')!.icon });
    if (find('records'))
        summaries.push({ id: 'records', title: 'Registros', value: 'Consultar', detail: 'Observações, documentos e ocorrências', icon: find('records')!.icon });
    if (find('team'))
        summaries.push({ id: 'team', title: 'Equipe', value: 'Ver acessos', detail: 'Pessoas e permissões da sua equipe', icon: find('team')!.icon });
    const priorities = [...new Set([...pinned, ...frequent, ...recommendedModules(role, allowed)])];
    summaries.sort((a, b) => { const index = (id: ModuleId) => { const position = priorities.indexOf(id); return position < 0 ? 100 : position; }; return index(a.id) - index(b.id); });
    const countedIds: ModuleId[] = ['projects', 'materials', 'loans', 'events'];
    const visibleSummaries = [...summaries.filter(summary => countedIds.includes(summary.id)), ...summaries.filter(summary => !countedIds.includes(summary.id))].slice(0, 4);
    const saved = pinned.map(find).filter((module): module is PortalModule => Boolean(module));
    const suggestions = priorities.slice(0, 4).map(find).filter((module): module is PortalModule => Boolean(module));
    const frequentModules = frequent.filter(id => !pinned.includes(id)).slice(0, 4).map(find).filter((module): module is PortalModule => Boolean(module));
    const actionModules = saved.length ? saved : frequentModules.length ? frequentModules : suggestions;
    const shortcutTitle = saved.length ? 'Seus atalhos' : frequentModules.length ? 'Mais usados por você' : 'Para começar';
    const shortcutDescription = saved.length ? 'Módulos que você fixou neste navegador.' : frequentModules.length ? 'Com base nos módulos que você abre neste navegador.' : 'Sugestões para sua função. Você pode escolher outros módulos.';
    const attention: {
        id: ModuleId;
        title: string;
        detail: string;
        kind: 'late' | 'stock' | 'draft';
        icon: LucideIcon;
    }[] = [];
    if (find('loans') && known.loans && late.length)
        attention.push({ id: 'loans', title: `${late.length} ${late.length === 1 ? 'devolução em atraso' : 'devoluções em atraso'}`, detail: 'Confira os equipamentos que continuam retirados.', kind: 'late', icon: TriangleAlert });
    if (find('materials') && known.items && lowStock.length)
        attention.push({ id: 'materials', title: `${lowStock.length} ${lowStock.length === 1 ? 'material com saldo baixo' : 'materiais com saldo baixo'}`, detail: 'O saldo disponível atingiu o alerta cadastrado.', kind: 'stock', icon: PackageSearch });
    if (find('events') && known.campaigns && drafts.length)
        attention.push({ id: 'events', title: `${drafts.length} ${drafts.length === 1 ? 'dinâmica em preparação' : 'dinâmicas em preparação'}`, detail: 'Revise as regras e a disponibilidade antes de ativar.', kind: 'draft', icon: Clock3 });
    const partialAttention = (loanModule && !known.loans) || (materialModule && !known.items) || (eventModule && !known.campaigns);
    const firstName = displayName.trim().split(/\s+/)[0] || 'equipe';
    const visibleProjects = [ ...(selected ? [selected] : []), ...projects.filter(project => project.id !== selectedProjectId) ].slice(0, 5);
    return <div className={`pd-dashboard ${styles.dashboard}`}>
    <section className="pd-section" aria-labelledby="pd-summary-title">
    <div className="pd-heading">
    <div>
    <h2 id="pd-summary-title">{selected ? `Resumo · ${selected.name}` : unitName ? `Resumo · ${unitName}` : 'Resumo dos seus projetos'}</h2>
    <p>{roleLabel || 'Equipe PROEX'} · Somente registros disponíveis para sua conta.</p>
    </div>
    </div>
    <div className="pd-summaries">{visibleSummaries.map(({ id, title, value, detail, note, share, icon: Icon }) => <button className="pd-summary" type="button" onClick={() => onNavigate(id)} key={id}>
        <span className="pd-summary-label">
        <span className={styles.summaryIcon}><Icon size={18} aria-hidden="true"/></span>
        {title}
        <ChevronRight size={16} aria-hidden="true"/>
        </span>
        <strong className={typeof value === 'string' ? 'pd-summary-text' : ''}>{value}</strong>
        {share !== undefined && <span className={styles.distribution} aria-hidden="true">
            <span style={{ inlineSize: `${share * 100}%` }}/>
        </span>}
        <span className="pd-summary-detail">{detail}</span>
        {note && <span className="pd-summary-note"><TriangleAlert size={14} aria-hidden="true"/>{note}</span>}
        </button>)}</div>
    </section>
    <section className="pd-section" aria-labelledby="pd-shortcut-title">
    <div className="pd-heading">
    <div>
    <h2 id="pd-shortcut-title">{shortcutTitle}</h2>
    <p>{shortcutDescription}</p>
    </div>
    <button className="p-button p-button-subtle" onClick={() => setCustomizing(value => !value)} aria-expanded={customizing} aria-controls="pd-shortcut-options">
    <Settings2 size={16}/>{customizing ? 'Concluir' : 'Personalizar'}</button>
    </div>{customizing && <div className="pd-shortcut-options" id="pd-shortcut-options">
        <div>
        <strong>Deixe o início com a sua cara, {firstName}.</strong>
        <p>Fixe os módulos que você quer encontrar primeiro. Esta escolha fica salva para sua conta neste navegador.</p>
        </div>
        <div>{modules.filter(module => module.id !== 'overview').map(({ id, label, icon: Icon }) => <button key={id} className={pinned.includes(id) ? 'is-pinned' : ''} aria-pressed={pinned.includes(id)} onClick={() => onTogglePin(id)}>
            <Icon size={17}/>
            <span>{label}</span>
            <Pin size={14}/>
            </button>)}</div>
        </div>}<div className={`pd-shortcuts ${actionModules.length === 1 ? 'pd-single-shortcut' : ''}`}>{actionModules.map(({ id, label, description, icon: Icon }) => <div className="pd-shortcut" key={id}>
        <button className="pd-shortcut-link" onClick={() => onNavigate(id)}>
        <span className="pd-module-icon">
        <Icon size={22}/>
        </span>
        <span>
        <strong>{label}</strong>
        <small>{description}</small>
        </span>
        <ArrowRight size={17}/>
        </button>
        <button className={`pd-pin ${pinned.includes(id) ? 'is-pinned' : ''}`} aria-label={`${pinned.includes(id) ? 'Remover' : 'Fixar'} ${label} ${pinned.includes(id) ? 'dos' : 'nos'} atalhos`} aria-pressed={pinned.includes(id)} onClick={() => onTogglePin(id)}>
        <Pin size={15}/>
        </button>
        </div>)}</div>{saved.length > 0 && frequentModules.length > 0 && <div className="pd-frequent">
        <span>
        <Clock3 size={14}/>Também usados por você</span>{frequentModules.map(({ id, label }) => <button key={id} onClick={() => onNavigate(id)}>{label}<ChevronRight size={13}/>
            </button>)}</div>}</section>
    <div className="pd-lower">
    <section className="pd-panel">
    <div className="pd-heading">
    <div>
    <h2>Para acompanhar</h2>
    <p>O que merece atenção nos projetos selecionados.</p>
    </div>
    </div>{attention.length ? <div className="pd-attention">{attention.map(({ id, title, detail, kind, icon: Icon }) => <button type="button" key={id} onClick={() => onNavigate(id)}>
            <span className={styles.attentionIcon} data-kind={kind}><Icon size={17} aria-hidden="true"/></span>
            <span>
            <strong>{title}</strong>
            <small>{detail}</small>
            </span>
            <ChevronRight size={17}/>
            </button>)}</div> : <div className="pd-calm">
        {partialAttention ? <Info size={24} aria-hidden="true"/> : <CheckCircle2 size={24} aria-hidden="true"/>}
        <div>
        <strong>{partialAttention ? 'Resumo de alertas indisponível' : 'Nenhuma pendência indicada'}</strong>
        <p>{partialAttention ? 'Abra os módulos para conferir os registros deste recorte.' : 'Os alertas aparecem aqui conforme os registros disponíveis.'}</p>
        </div>
        </div>}{find('loans') && known.loans && upcoming.length > 0 && <div className="pd-upcoming">
        <h3>Próximas retiradas</h3>{upcoming.map(loan => <button key={loan.id} onClick={() => onNavigate('loans')}>
            <CalendarDays size={17}/>
            <span>
            <strong>{loan.action_name ?? loan.actionName ?? 'Reserva de equipamento'}</strong>
            <small>{date(loan.starts_at ?? loan.startsAt)}</small>
            </span>
            <ChevronRight size={15}/>
            </button>)}</div>}</section>
    <section className="pd-panel">
    <div className="pd-heading">
    <div>
    <h2>Seus projetos</h2>
    <p>Selecione um projeto para acompanhar seus registros.</p>
    </div>
    {find('projects') && <button type="button" className="pd-inline-link" onClick={() => onNavigate('projects')}>Ver todos <ArrowRight size={14} aria-hidden="true"/>
    </button>}
    </div>{projects.length ? <div className="pd-projects">{selectedProjectId && <button className="pd-all-projects" onClick={() => onSelectProject('')}>
            <FolderKanban size={17}/>Todos os meus projetos<ArrowRight size={14}/>
            </button>}{visibleProjects.map(project => <button key={project.id} className={selectedProjectId === project.id ? 'is-active' : ''} aria-pressed={selectedProjectId === project.id} onClick={() => onSelectProject(project.id)}>
            <span className="pd-project-initial" style={{ borderColor: /^#[\da-f]{6}$/i.test(project.color ?? '') ? project.color : undefined }}>{String(project.short_name || project.name || 'P').slice(0, 2).toUpperCase()}</span>
            <span>
            <strong>{project.name}</strong>
            <small>{project.status === 'archived' ? 'Arquivado · histórico preservado' : project.scope === 'external' ? 'Projeto externo' : 'Projeto interno'}</small>
            </span>
            {selectedProjectId === project.id ? <Check size={17} aria-hidden="true"/> : <ChevronRight size={16} aria-hidden="true"/>}
            </button>)}</div> : <div className="pd-calm">
        <FolderKanban size={28}/>
        <div>
        <strong>Seus projetos aparecerão aqui</strong>
        <p>Abra Projetos para cadastrar ou consultar os acessos concedidos à sua conta.</p>
        </div>
        </div>}</section>
    </div>
    </div>;
}
