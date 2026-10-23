'use client';
import { useState } from 'react';
import { ArrowDownLeft, ArrowRight, CalendarDays, CheckCircle2, ChevronRight, Clock3, FolderKanban, Pin, Settings2, Sparkles, type LucideIcon } from 'lucide-react';
import { recommendedModules, type ModuleId, type PortalModule } from './navigation-model';
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
    const lowStock = items.filter(item => item.category !== 'equipment' && item.condition === 'active' && available(item) <= Number(item.low_stock ?? item.lowStock ?? 0));
    const reserved = loans.filter(loan => loan.status === 'reserved');
    const checkedOut = loans.filter(loan => loan.status === 'out');
    const late = checkedOut.filter(loan => new Date(loan.ends_at ?? loan.endsAt).getTime() < now);
    const drafts = campaigns.filter(campaign => campaign.status === 'draft');
    const upcoming = [...reserved].filter(loan => new Date(loan.starts_at ?? loan.startsAt).getTime() >= now).sort((a, b) => new Date(a.starts_at ?? a.startsAt).getTime() - new Date(b.starts_at ?? b.startsAt).getTime()).slice(0, 3);
    const summaries: Summary[] = [];
    if (find('projects'))
        summaries.push({ id: 'projects', title: 'Projetos', value: known.projects ? scopedProjects.length : 'Consultar', detail: selected ? 'Projeto selecionado nos filtros' : 'Áreas de trabalho disponíveis', icon: find('projects')!.icon });
    if (find('materials'))
        summaries.push({ id: 'materials', title: 'Materiais', value: known.items ? items.length : 'Consultar', detail: 'Itens nos projetos selecionados', note: lowStock.length ? `${lowStock.length} com saldo baixo` : undefined, icon: find('materials')!.icon });
    if (find('loans'))
        summaries.push({ id: 'loans', title: 'Empréstimos', value: known.loans ? reserved.length + checkedOut.length : 'Consultar', detail: known.loans ? `${checkedOut.length} retirados · ${reserved.length} reservados` : 'Consulte retiradas e devoluções', note: late.length ? `${late.length} em atraso` : undefined, icon: find('loans')!.icon });
    if (find('events'))
        summaries.push({ id: 'events', title: 'Dinâmicas', value: known.campaigns ? campaigns.filter(campaign => campaign.status === 'active').length : 'Consultar', detail: 'Campanhas de roleta e dado ativas', note: drafts.length ? `${drafts.length} em preparação` : undefined, icon: find('events')!.icon });
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
    const visibleSummaries = summaries.slice(0, 4);
    const saved = pinned.map(find).filter((module): module is PortalModule => Boolean(module));
    const suggestions = priorities.slice(0, 4).map(find).filter((module): module is PortalModule => Boolean(module));
    const frequentModules = frequent.filter(id => !pinned.includes(id)).slice(0, 4).map(find).filter((module): module is PortalModule => Boolean(module));
    const actionModules = saved.length ? saved : frequentModules.length ? frequentModules : suggestions;
    const shortcutTitle = saved.length ? 'Seus atalhos' : frequentModules.length ? 'Mais usados por você' : 'Para começar';
    const shortcutDescription = saved.length ? 'Os módulos que você escolheu deixar por perto.' : frequentModules.length ? 'Com base nos módulos que você abre neste navegador.' : 'Sugestões para sua função. Você pode escolher outros módulos.';
    const roleDescription = role === 'operator' ? 'Abra o atendimento da roleta ou do dado e registre cada etapa.' : role === 'inventory' ? 'Confira os materiais e mantenha os registros da equipe atualizados.' : role === 'loans' ? 'Organize reservas, confira retiradas e acompanhe as devoluções.' : role === 'viewer' ? 'Encontre os projetos e consulte os registros disponíveis para sua conta.' : 'Escolha por onde continuar e acompanhe o trabalho nos seus projetos.';
    const attention: {
        id: ModuleId;
        title: string;
        detail: string;
        kind: string;
    }[] = [];
    if (find('loans') && late.length)
        attention.push({ id: 'loans', title: `${late.length} ${late.length === 1 ? 'devolução em atraso' : 'devoluções em atraso'}`, detail: 'Confira os equipamentos que continuam retirados.', kind: 'late' });
    if (find('materials') && lowStock.length)
        attention.push({ id: 'materials', title: `${lowStock.length} ${lowStock.length === 1 ? 'material com saldo baixo' : 'materiais com saldo baixo'}`, detail: 'O saldo disponível atingiu o alerta cadastrado.', kind: 'stock' });
    if (find('events') && drafts.length)
        attention.push({ id: 'events', title: `${drafts.length} ${drafts.length === 1 ? 'dinâmica em preparação' : 'dinâmicas em preparação'}`, detail: 'Revise as regras e a disponibilidade antes de ativar.', kind: 'draft' });
    const firstName = displayName.trim().split(/\s+/)[0] || 'equipe';
    return <div className="pd-dashboard">
    <section className="pd-welcome">
    <div>
    <span className="pd-context">
    <span />{selected?.name || unitName || 'Seus projetos'}</span>
    <h2>Seu próximo passo<br />começa aqui.</h2>
    <p>{roleDescription}</p>
    <span className="pd-role">
    <ShieldLabel />{roleLabel || 'Equipe PROEX'}</span>
    </div>
    <div className="pd-welcome-aside" aria-hidden="true">
    <FolderKanban size={48}/>
    <span className="pd-orbit-a"/>
    <span className="pd-orbit-b"/>
    <i>✦</i>
    </div>
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
    <section className="pd-section" aria-labelledby="pd-summary-title">
    <div className="pd-heading">
    <div>
    <h2 id="pd-summary-title">{selected ? `Resumo · ${selected.name}` : unitName ? `Resumo · ${unitName}` : 'Resumo dos seus projetos'}</h2>
    <p>Um resumo dos registros que sua conta pode consultar.</p>
    </div>
    </div>
    <div className="pd-summaries">{visibleSummaries.map(({ id, title, value, detail, note, icon: Icon }) => <button className="pd-summary" onClick={() => onNavigate(id)} key={id}>
        <span className="pd-summary-label">
        <Icon size={19}/>{title}<ArrowDownLeft size={15}/>
        </span>
        <strong className={typeof value === 'string' ? 'pd-summary-text' : ''}>{value}</strong>
        <span className="pd-summary-detail">{detail}</span>{note && <span className="pd-summary-note">{note}</span>}<span className="pd-summary-open">Abrir {title.toLocaleLowerCase('pt-BR')} <ArrowRight size={13}/>
        </span>
        </button>)}</div>
    </section>
    <div className="pd-lower">
    <section className="pd-panel">
    <div className="pd-heading">
    <div>
    <h2>Para acompanhar</h2>
    <p>O que merece atenção nos projetos selecionados.</p>
    </div>
    </div>{attention.length ? <div className="pd-attention">{attention.map(item => <button key={item.id} onClick={() => onNavigate(item.id)}>
            <span className={`pd-attention-dot pd-${item.kind}`}/>
            <span>
            <strong>{item.title}</strong>
            <small>{item.detail}</small>
            </span>
            <ChevronRight size={17}/>
            </button>)}</div> : <div className="pd-calm">
        <CheckCircle2 size={28}/>
        <div>
        <strong>Nenhuma pendência indicada</strong>
        <p>Ocorrências e alertas aparecerão aqui conforme os registros disponíveis.</p>
        </div>
        </div>}{find('loans') && upcoming.length > 0 && <div className="pd-upcoming">
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
    <button className="pd-inline-link" onClick={() => onNavigate('projects')}>Ver todos <ArrowRight size={14}/>
    </button>
    </div>{projects.length ? <div className="pd-projects">{selectedProjectId && <button className="pd-all-projects" onClick={() => onSelectProject('')}>
            <FolderKanban size={17}/>Todos os meus projetos<ArrowRight size={14}/>
            </button>}{projects.slice(0, 5).map(project => <button key={project.id} className={selectedProjectId === project.id ? 'is-active' : ''} aria-pressed={selectedProjectId === project.id} onClick={() => onSelectProject(project.id)}>
            <span className="pd-project-initial" style={{ borderColor: /^#[\da-f]{6}$/i.test(project.color ?? '') ? project.color : undefined }}>{String(project.short_name || project.name || 'P').slice(0, 2).toUpperCase()}</span>
            <span>
            <strong>{project.name}</strong>
            <small>{project.status === 'archived' ? 'Arquivado · histórico preservado' : project.short_name || 'Área de trabalho compartilhada'}</small>
            </span>
            <ChevronRight size={16}/>
            </button>)}</div> : <div className="pd-calm">
        <FolderKanban size={28}/>
        <div>
        <strong>Seus projetos aparecerão aqui</strong>
        <p>Abra Projetos para cadastrar ou consultar os acessos concedidos à sua conta.</p>
        </div>
        </div>}</section>
    </div>
    <p className="pd-privacy-note">
    <Sparkles size={13}/>Atalhos e módulos frequentes ficam neste navegador. Os registros dos projetos continuam sincronizados no portal.</p>
    </div>;
}
function ShieldLabel() { return <span className="pd-role-dot" aria-hidden="true"/>; }
