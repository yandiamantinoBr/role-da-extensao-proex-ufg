'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import PhysicalAttendance from '@/components/portal/physical-attendance';
import CampaignForm from '@/components/portal/campaign-form';
import PendingPrizes from '@/components/portal/pending-prizes';
import { ArrowDownToLine, ArrowRight, Boxes, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Copy, ExternalLink, FileText, FolderKanban, Gift, LayoutDashboard, LoaderCircle, LogOut, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Truck, Users, Wifi, WifiOff, X } from 'lucide-react';
// API projections vary by module; the server validates every mutation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Snapshot = Row;
type Tab = 'overview' | 'projects' | 'events' | 'materials' | 'loans' | 'team' | 'reports' | 'settings';
type Payload = Record<string, unknown>;
const tabs: {
    id: Tab;
    label: string;
    icon: typeof Boxes;
}[] = [
    { id: 'overview', label: 'Visão geral', icon: LayoutDashboard }, { id: 'projects', label: 'Projetos', icon: FolderKanban },
    { id: 'events', label: 'Eventos', icon: CalendarDays }, { id: 'materials', label: 'Materiais', icon: Boxes },
    { id: 'loans', label: 'Empréstimos', icon: Truck }, { id: 'team', label: 'Equipe', icon: Users },
    { id: 'reports', label: 'Relatórios', icon: ClipboardList }, { id: 'settings', label: 'Configurações', icon: Settings2 },
];
const statusNames: Row = { draft: 'Rascunho', active: 'Ativo', paused: 'Pausado', closed: 'Encerrado', reserved: 'Reservado', out: 'Retirado', returned: 'Devolvido', cancelled: 'Cancelado', pending: 'Pendente', accepted: 'Aceito', revoked: 'Revogado' };
const roleNames: Row = { owner: 'Responsável institucional', manager: 'Gestor de projeto', operator: 'Operador de evento', inventory: 'Responsável por estoque', loans: 'Responsável por empréstimos', viewer: 'Leitor de relatórios' };
const categoryNames: Row = { gift: 'Brinde', equipment: 'Equipamento', distribution: 'Distribuição institucional', consumption: 'Consumo interno' };
const get = (r: Row, ...keys: string[]) => keys.map(k => r?.[k]).find(v => v !== undefined && v !== null);
const list = (value: unknown): Row[] => Array.isArray(value) ? value : [];
const string = (value: unknown) => value === null || value === undefined ? '' : String(value);
const when = (value: unknown, time = true) => { const d = new Date(value as string | number); return Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR', { dateStyle: 'short', ...(time ? { timeStyle: 'short' as const } : {}), timeZone: 'America/Sao_Paulo' }) : 'Não informado'; };
const iso = (value: FormDataEntryValue | null) => value ? new Date(String(value)).toISOString() : null;
const operationId = () => crypto.randomUUID();
function Field({ label, children, help }: {
    label: string;
    children: ReactNode;
    help?: string;
}) {
    return <label className="p-field">
    <span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}
function Empty({ title, text, icon: Icon = Boxes }: {
    title: string;
    text: string;
    icon?: typeof Boxes;
}) {
    return <div className="p-empty">
    <span>
    <Icon size={28}/>
    </span>
    <h3>{title}</h3>
    <p>{text}</p>
    </div>;
}
function Badge({ status }: {
    status: unknown;
}) { const key = string(status); return <span className={`p-badge p-status-${key}`}>{statusNames[key] ?? key}</span>; }
function Section({ title, description, children, aside }: {
    title: string;
    description?: string;
    children: ReactNode;
    aside?: ReactNode;
}) {
    return <section className="p-section">
    <div className="p-section-heading">
    <div>
    <h2>{title}</h2>{description && <p>{description}</p>}</div>{aside}</div>{children}</section>;
}
function OperationForm({ action, make, mutate, children, submit = 'Salvar', onDone, compact = false }: {
    action: string;
    make: (f: FormData) => Payload;
    mutate: (action: string, data: Payload) => Promise<Row>;
    children: ReactNode;
    submit?: string;
    onDone?: (result: Row) => void;
    compact?: boolean;
}) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const key = useRef<string | null>(null);
    async function send(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (saving)
            return;
        const form = e.currentTarget;
        setSaving(true);
        setError('');
        key.current ??= operationId();
        try {
            const result = await mutate(action, { ...make(new FormData(form)), operationKey: key.current });
            key.current = null;
            if (action !== 'setting.update')
                form.reset();
            onDone?.(result);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Não foi possível salvar. Tente novamente.');
        }
        finally {
            setSaving(false);
        }
    }
    return <form className={`p-form${compact ? ' p-form-compact' : ''}`} onSubmit={send} onChange={() => { if (!saving)
        key.current = null; }}>
    <fieldset disabled={saving}>{children}<div className="p-form-footer">{error && <p className="p-inline-error" role="alert">{error}</p>}<button className="p-button p-button-primary" type="submit">{saving ? <LoaderCircle className="p-spin" size={18}/> : <Check size={18}/>}{saving ? 'Salvando…' : submit}</button>
    </div>
    </fieldset>
    </form>;
}
export default function PortalClient({ initial }: {
    initial: Snapshot;
}) {
    const [data, setData] = useState<Snapshot>(initial ?? {});
    const [tab, setTab] = useState<Tab>('overview');
    const [filter, setFilter] = useState('');
    const [draftProject, setDraftProject] = useState('');
    const [query, setQuery] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [online, setOnline] = useState(true);
    const [message, setMessage] = useState('');
    const [failure, setFailure] = useState('');
    const [inviteLink, setInviteLink] = useState('');
    const [now, setNow] = useState(() => new Date(initial?.updatedAt ?? 0).getTime());
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
    const [offerRows, setOfferRows] = useState(1);
    const [copied, setCopied] = useState(false);
    const latestRequest = useRef(0);
    const refresh = useCallback(async () => {
        const request = ++latestRequest.current;
        setRefreshing(true);
        try {
            const response = await fetch('/api/portal', { cache: 'no-store' });
            const body = await response.json() as Row;
            if (!response.ok)
                throw new Error(body.error || 'Não foi possível atualizar os dados.');
            if (request === latestRequest.current) {
                setData(body);
                setUpdatedAt(new Date());
                setNow(Date.now());
                setFailure('');
            }
            return true;
        }
        catch (e) {
            if (request === latestRequest.current)
                setFailure(e instanceof Error ? e.message : 'Falha de conexão. Os dados exibidos podem estar desatualizados.');
            return false;
        }
        finally {
            if (request === latestRequest.current)
                setRefreshing(false);
        }
    }, []);
    useEffect(() => { const change = () => { setOnline(navigator.onLine); }; const timer = window.setTimeout(() => { setUpdatedAt(new Date()); setNow(Date.now()); change(); }, 0); const clock = window.setInterval(() => setNow(Date.now()), 60000); window.addEventListener('online', change); window.addEventListener('offline', change); return () => { window.clearTimeout(timer); window.clearInterval(clock); window.removeEventListener('online', change); window.removeEventListener('offline', change); }; }, []);
    const projects = list(data.projects), campaigns = list(data.campaigns), items = list(data.items), offers = list(data.offers), loans = list(data.loans);
    const members = list(data.members), invites = list(data.invites), audit = list(data.audit), documents = list(data.documents);
    const user = data.user ?? {};
    const role = string(data.role);
    const capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
    const can = (...needed: string[]) => role === 'owner' || capabilities.includes('*') || needed.some(c => capabilities.includes(c));
    const byProject = (rows: Row[]) => filter ? rows.filter(r => get(r, 'projectId', 'project_id') === filter) : rows;
    const visibleCampaigns = byProject(campaigns), visibleItems = byProject(items), visibleLoans = byProject(loans);
    const projectName = (id: unknown) => projects.find(p => p.id === id)?.name || 'PROEX';
    const effectiveProject = draftProject || filter || string(projects[0]?.id);
    const formItems = items.filter(i => !effectiveProject || get(i, 'projectId', 'project_id') === effectiveProject);
    const available = (item: Row) => Number(item.stock ?? item.quantity ?? 0) - Number(item.reserved ?? 0);
    const lowItems = visibleItems.filter(i => available(i) <= Number(get(i, 'lowStock', 'low_stock') ?? 0));
    const lateLoans = visibleLoans.filter(l => l.status === 'out' && new Date(get(l, 'endsAt', 'ends_at')).getTime() < now);
    const searchItems = visibleItems.filter(i => !query || `${i.name} ${i.description ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
    const allowedTabs = tabs.filter(t => t.id === 'overview' || t.id === 'projects' || (t.id === 'events' && can('campaigns.manage', 'participation.operate', 'inventory.deliver')) || (t.id === 'materials' && can('inventory.read', 'inventory.manage', 'inventory.deliver')) || (t.id === 'loans' && can('loans.read', 'loans.manage', 'loans.checkout')) || (t.id === 'team' && can('access.invite', 'access.manage')) || (t.id === 'reports' && can('reports.read')) || (t.id === 'settings' && can('organization.manage')));
    async function mutate(action: string, payload: Payload): Promise<Row> {
        if (!navigator.onLine)
            throw new Error('Você está sem conexão. Reconecte antes de confirmar uma operação.');
        const r = await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action, ...payload }) });
        const body = await r.json() as Row;
        if (!r.ok || body.error)
            throw new Error(body.error || 'Não foi possível concluir esta operação.');
        const updated = await refresh();
        setMessage(updated ? 'Registro salvo. Os dados foram atualizados.' : 'Registro salvo. A atualização da tela está pendente; use Atualizar dados.');
        return body;
    }
    async function quick(action: string, payload: Payload) { if (busy)
        return; setBusy(true); setFailure(''); try {
        await mutate(action, { ...payload, operationKey: operationId() });
    }
    catch (e) {
        setFailure(e instanceof Error ? e.message : 'Não foi possível concluir.');
    }
    finally {
        setBusy(false);
    } }
    async function copyInvite() { try {
        await navigator.clipboard.writeText(inviteLink);
        setCopied(true);
    }
    catch {
        setMessage('Selecione e copie o link do convite abaixo.');
    } }
    const projectField = <Field label="Projeto">
    <select name="projectId" value={effectiveProject} onChange={e => setDraftProject(e.target.value)} required>
    <option value="">Selecione um projeto</option>{projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>
    </Field>;
    const metric = (...keys: string[]) => { const metrics = data.metrics ?? {}; if (metrics.available === false)
        return '—'; let value = get(metrics, ...keys); if (filter) {
        const normalized = keys.includes('deliveries') ? 'deliveries' : keys[0];
        const scoped = list(metrics.campaigns).filter(c => get(c, 'projectId', 'project_id') === filter);
        value = ['participations', 'attempts', 'deliveries', 'visits', 'tickets'].includes(normalized) ? scoped.reduce((total, row) => total + Number(row[normalized] ?? 0), 0) : get(metrics.byProject?.[filter] ?? {}, ...keys);
    } return value === undefined || value === null ? '—' : Number(value).toLocaleString('pt-BR'); };
    const title = tabs.find(t => t.id === tab)?.label ?? 'Visão geral';
    if (!user.userId)
        return <main className="p-login">
        <div className="p-login-card">
        <div className="p-brand">
        <img src="/brand/proex.png" alt="PROEX"/>
        <img src="/brand/ufg-white.png" alt="UFG"/>
        </div>
        <span className="p-eyebrow">GESTÃO DA EXTENSÃO</span>
        <h1>Um lugar para organizar o que acontece.</h1>
        <p>Entre para acessar seus projetos, eventos, materiais e empréstimos.</p>
        <a className="p-button p-button-primary" href={initial?.signInPath || '/signin-with-chatgpt?return_to=%2F'} target="_top">Entrar com ChatGPT <ArrowRight size={18}/>
        </a>
        <small>O acesso aos módulos depende das permissões da sua equipe.</small>
        <a className="p-text-link" href="https://role-da-extensao-ufg.yandiamantinobr.chatgpt.site/" target="_blank" rel="noreferrer">Abrir a roleta livre <ExternalLink size={14}/>
        </a>
        </div>
        </main>;
    if (!role || !capabilities.length)
        return <main className="p-login">
        <div className="p-login-card">
        <div className="p-brand">
        <img src="/brand/proex.png" alt="PROEX"/>
        <img src="/brand/ufg-white.png" alt="UFG"/>
        </div>
        <span className="p-eyebrow">ACESSO DA EQUIPE</span>
        <h1>Sua conta está conectada.</h1>
        <p>Ainda não há uma permissão ativa para {user.email || 'esta conta'}. Abra o link do convite enviado pela equipe ou solicite acesso ao responsável institucional.</p>
        <button className="p-button p-button-primary" onClick={() => void refresh()} disabled={refreshing}>{refreshing && <LoaderCircle size={17} className="p-spin"/>}Verificar meu acesso</button>
        <a className="p-text-link" href="/signout-with-chatgpt?return_to=%2F" target="_top">Sair e trocar de conta <LogOut size={15}/>
        </a>
        </div>
        </main>;
    return <div className="p-shell">
    <aside className="p-sidebar">
    <a className="p-brand" href="#main" aria-label="Início da gestão PROEX">
    <img src="/brand/proex.png" alt="PROEX"/>
    <img src="/brand/ufg-white.png" alt="Universidade Federal de Goiás"/>
    </a>
    <div className="p-sidebar-name">
    <span>Gestão da extensão</span>
    <small>Projetos, pessoas e materiais</small>
    </div>
    <nav aria-label="Navegação principal">{allowedTabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'is-active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setQuery(''); }}>
        <Icon size={19}/>
        <span>{label}</span>{tab === id && <ChevronRight size={15}/>}</button>)}</nav>
    <div className="p-sidebar-bottom">
    <a href="https://role-da-extensao-ufg.yandiamantinobr.chatgpt.site/" target="_blank" rel="noreferrer">
    <Sparkles size={17}/>Roleta livre<ExternalLink size={14}/>
    </a>
    <div>
    <ShieldCheck size={16}/>
    <span>Acesso por função e projeto</span>
    </div>
    </div>
    </aside>
    <div className="p-workspace">
    <header className="p-topbar">
    <div className="p-mobile-brand">
    <img src="/brand/proex.png" alt="PROEX"/>
    <span>Gestão</span>
    </div>
    <div className="p-breadcrumb">PROEX <ChevronRight size={14}/>
    <strong>{title}</strong>
    </div>
    <div className="p-topbar-actions">
    <button className="p-icon-button" title="Atualizar dados" aria-label="Atualizar dados" disabled={refreshing} onClick={() => void refresh()}>
    <RefreshCw size={18} className={refreshing ? 'p-spin' : ''}/>
    </button>
    <div className="p-avatar" aria-hidden="true">{string(user.displayName || user.email || 'P').slice(0, 1).toUpperCase()}</div>
    <div className="p-user">
    <strong>{user.displayName || 'Minha conta'}</strong>
    <small>{roleNames[role] || 'Acesso da equipe'}</small>
    </div>
    <a className="p-icon-button" href="/signout-with-chatgpt?return_to=%2F" target="_top" aria-label="Sair" title="Sair">
    <LogOut size={17}/>
    </a>
    </div>
    </header>
      <nav className="p-mobile-nav" aria-label="Módulos">{allowedTabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'is-active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
        <Icon size={17}/>{label}</button>)}</nav>
      <main className="p-main" id="main">
    <div className="p-page-heading">
    <div>
    <span className="p-eyebrow">GESTÃO DA EXTENSÃO</span>
    <h1>{tab === 'overview' ? 'Tudo pronto para o próximo rolê.' : title}</h1>
    <p>{tab === 'overview' ? 'Acompanhe os projetos e organize as próximas ações da equipe.' : 'Registros compartilhados, com histórico e acesso por projeto.'}</p>
    </div>
    <Field label="Seu contexto">
    <select value={filter} onChange={e => { setFilter(e.target.value); setDraftProject(e.target.value); }} aria-label="Filtrar pelo projeto">
    <option value="">Todos os meus projetos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </Field>
    </div>
      {!online && <div className="p-notice p-notice-warning" role="status">
        <WifiOff size={18}/>
        <div>
        <strong>Sem conexão</strong>
        <span>Consulte o que já está na tela. Reconecte antes de registrar uma operação.</span>
        </div>
        </div>}
      {failure && <div className="p-notice p-notice-error" role="alert">
        <FileText size={18}/>
        <div>
        <strong>Não foi possível concluir</strong>
        <span>{failure}</span>
        </div>
        <button aria-label="Fechar mensagem" onClick={() => setFailure('')}>
        <X size={16}/>
        </button>
        </div>}
      {message && <div className="p-notice p-notice-success" role="status">
        <CheckCircle2 size={18}/>
        <span>{message}</span>
        <button aria-label="Fechar mensagem" onClick={() => setMessage('')}>
        <X size={16}/>
        </button>
        </div>}

      {tab === 'overview' && <>
        <div className="p-stats">
        <div className="p-stat">
        <span>
        <FolderKanban size={19}/>Projetos no seu acesso</span>
        <strong>{filter ? 1 : projects.length}</strong>
        <small>Áreas de trabalho compartilhadas</small>
        </div>
        <div className="p-stat">
        <span>
        <CalendarDays size={19}/>Eventos ativos</span>
        <strong>{visibleCampaigns.filter(c => c.status === 'active').length}</strong>
        <small>Campanhas abertas à participação</small>
        </div>
        <div className="p-stat">
        <span>
        <Users size={19}/>Participações registradas</span>
        <strong>{metric('participations', 'participationCount', 'participants')}</strong>
        <small>Contas ou tíquetes, conforme a campanha</small>
        </div>
        <div className="p-stat">
        <span>
        <Gift size={19}/>Premiações entregues</span>
        <strong>{metric('deliveries', 'delivered', 'redemptions')}</strong>
        <small>Entrega confirmada pela equipe</small>
        </div>
        </div>
        <div className="p-overview-grid">
        <section className="p-hero">
        <span className="p-pill">
        <Sparkles size={14}/>ROLÊ DA EXTENSÃO</span>
        <h2>Uma boa ação começa<br />com tudo organizado.</h2>
        <p>Prepare o evento, confira os materiais e acompanhe as entregas. A equipe vê os mesmos registros em cada aparelho.</p>
        <div className="p-hero-actions">{can('campaigns.manage', 'participation.operate') && <button className="p-button p-button-orange" onClick={() => setTab('events')}>Abrir eventos <ArrowRight size={17}/>
            </button>}{can('inventory.read', 'inventory.deliver', 'inventory.manage') && <button className="p-button p-button-glass" onClick={() => setTab('materials')}>Conferir materiais</button>}</div>
        <div className="p-hero-orbit" aria-hidden="true">
        <Gift />
        <span>✦</span>
        </div>
        </section>
        <section className="p-card p-attention">
        <div className="p-card-title">
        <span className="p-icon-tile">
        <ClipboardList size={20}/>
        </span>
        <div>
        <h2>Para acompanhar</h2>
        <p>O que merece atenção da equipe</p>
        </div>
        </div>{lowItems.length > 0 && <button onClick={() => setTab('materials')}>
            <span className="p-dot p-dot-orange"/>
            <div>
            <strong>{lowItems.length} {lowItems.length === 1 ? 'item com estoque baixo' : 'itens com estoque baixo'}</strong>
            <small>Confira o saldo disponível</small>
            </div>
            <ChevronRight size={17}/>
            </button>}{lateLoans.length > 0 && <button onClick={() => setTab('loans')}>
            <span className="p-dot p-dot-red"/>
            <div>
            <strong>{lateLoans.length} {lateLoans.length === 1 ? 'devolução em atraso' : 'devoluções em atraso'}</strong>
            <small>Verifique a disponibilidade dos bens</small>
            </div>
            <ChevronRight size={17}/>
            </button>}{visibleCampaigns.filter(c => c.status === 'draft').length > 0 && <button onClick={() => setTab('events')}>
            <span className="p-dot p-dot-purple"/>
            <div>
            <strong>Eventos em preparação</strong>
            <small>Revise regras e ofertas antes de ativar</small>
            </div>
            <ChevronRight size={17}/>
            </button>}{!lowItems.length && !lateLoans.length && !visibleCampaigns.some(c => c.status === 'draft') && <div className="p-calm">
            <CheckCircle2 size={30}/>
            <strong>Nenhuma pendência indicada</strong>
            <p>Novas ocorrências aparecerão aqui conforme a operação.</p>
            </div>}</section>
        </div>
        <Section title="Atividade recente" description="Os registros deixam um histórico de quem fez cada operação.">{byProject(audit).length ? <div className="p-card p-activity">{byProject(audit).slice(0, 7).map((a, i) => <div key={a.id ?? i}>
                <span className="p-activity-dot"/>
                <div>
                <strong>{a.label || a.action || 'Registro atualizado'}</strong>
                <small>{projectName(get(a, 'projectId', 'project_id'))} · {when(get(a, 'createdAt', 'created_at', 'at'))}</small>
                </div>
                </div>)}</div> : <Empty title="O histórico começa com a primeira ação" text="Cadastros, entregas e empréstimos aparecerão aqui quando forem registrados." icon={ClipboardList}/>}</Section>
        </>}

      {tab === 'projects' && <>
        <Section title="Projetos da equipe" description="Cada projeto reúne seus eventos, materiais e pessoas.">{projects.length ? <div className="p-project-grid">{projects.filter(p => !filter || p.id === filter).map(p => <article className="p-card p-project-card" key={p.id}>
                <span className="p-icon-tile">
                <FolderKanban size={23}/>
                </span>
                <h3>{p.name}</h3>
                <p>{p.description || 'Organize as ações, materiais e registros deste projeto.'}</p>
                <div>
                <span>{campaigns.filter(c => get(c, 'projectId', 'project_id') === p.id).length} eventos</span>
                <span>{items.filter(c => get(c, 'projectId', 'project_id') === p.id).length} materiais</span>
                </div>
                <button className="p-text-link" onClick={() => { setFilter(p.id); setDraftProject(p.id); setTab('overview'); }}>Acessar projeto <ArrowRight size={16}/>
                </button>
                </article>)}</div> : <Empty title="Nenhum projeto no seu acesso" text="Crie o primeiro projeto ou solicite um convite ao responsável pela equipe." icon={FolderKanban}/>}</Section>{can('organization.manage', 'projects.manage') && <Section title="Criar projeto" description="Use o nome oficial e uma descrição curta para orientar a equipe.">
            <OperationForm action="project.create" make={f => ({ name: f.get('name'), description: f.get('description') })} mutate={mutate} submit="Criar projeto">
            <div className="p-form-grid">
            <Field label="Nome do projeto">
            <input name="name" placeholder="Ex.: Rolê da Extensão" required maxLength={120}/>
            </Field>
            <Field label="Descrição">
            <input name="description" placeholder="O que este projeto realiza" maxLength={500}/>
            </Field>
            </div>
            </OperationForm>
            </Section>}</>}

      {tab === 'events' && <>
        <Section title="Eventos e campanhas" description="O regulamento, as ofertas e o limite de participação são definidos por evento.">{visibleCampaigns.length ? <div className="p-event-grid">{visibleCampaigns.map(c => <article className="p-card p-event-card" key={c.id}>
                <div className="p-row-between">
                <span className="p-kicker">{projectName(get(c, 'projectId', 'project_id'))}</span>
                <Badge status={c.status}/>
                </div>
                <h3>{c.name}</h3>
                <p>{c.location || 'Local não informado'}</p>
                <div className="p-event-date">
                <CalendarDays size={17}/>
                <span>{when(get(c, 'startsAt', 'starts_at'))}<br />
                <small>até {when(get(c, 'endsAt', 'ends_at'))}</small>
                </span>
                </div>
                <div className="p-rule-summary">{get(c, 'retryLimit', 'retry_limit') === undefined ? 'Política de repetição pendente' : `Uma participação · até ${get(c, 'retryLimit', 'retry_limit')} repetição(ões) quando sair Tente novamente`}</div>
                <div className="p-card-actions">
                <a className="p-button p-button-subtle" href={`/events/${c.id}`} target="_blank" rel="noreferrer">Página do evento <ExternalLink size={15}/>
                </a>{can('campaigns.manage') && <select aria-label={`Situação do evento ${c.name}`} value={c.status} disabled={busy || c.status === 'closed'} onChange={e => void quick('campaign.status', { id: c.id, status: e.target.value })}>
                    <option value="draft" disabled>Rascunho</option>
                    <option value="active">Ativo</option>
                    <option value="paused">Pausado</option>
                    <option value="closed">Encerrado</option>
                    </select>}</div>{c.status === 'draft' && can('campaigns.manage') && <details className="p-event-edit">
                    <summary>Editar rascunho <ChevronDown size={15}/>
                    </summary>
                    <CampaignForm projects={projects} offers={offers} initial={c} mutate={mutate}/>
                    </details>}</article>)}</div> : <Empty title="Nenhum evento cadastrado" text="Prepare um evento para definir regras, acompanhar participações e conectar as ofertas de brindes." icon={CalendarDays}/>}</Section>{can('participation.operate') && <Section title="Operação presencial" description="A equipe acompanha o resultado e utiliza as mesmas regras de participação da campanha.">
            <PhysicalAttendance campaigns={visibleCampaigns} tickets={byProject(list(data.physicalTickets))} mutate={mutate}/>
            </Section>}{can('participation.operate', 'inventory.deliver') && (byProject(list(data.pendingPrizes)).length > 0 || data.pendingPrizesTruncated) && <Section title="Prêmios aguardando entrega" description="Reservas que continuam disponíveis após atualizar a página. Confirme a entrega somente depois de conferir o código.">{data.pendingPrizesTruncated && <div className="p-notice p-notice-warning">
                <Gift size={17}/>
                <span>A fila mostra até {data.pendingPrizesLimit || 200} reservas recentes. Há {data.pendingPrizesTotal} no seu acesso completo. Use o código da pessoa em Retirada de brinde para localizar uma entrega que não esteja nesta lista.</span>
                </div>}<PendingPrizes prizes={byProject(list(data.pendingPrizes))} mutate={mutate}/>
            </Section>}{can('participation.operate', 'inventory.deliver') && <Section title="Retirada de brinde" description="Confira o código da pessoa e registre a entrega uma única vez.">
            <OperationForm action="prize.redeem" make={f => ({ code: f.get('code') })} mutate={mutate} submit="Confirmar entrega" compact>
            <Field label="Código de retirada">
            <input name="code" autoComplete="off" required placeholder="Cole ou digite o código apresentado"/>
            </Field>
            </OperationForm>
            </Section>}{can('campaigns.manage') && projects.length > 0 && <Section title="Preparar evento" description="O evento será criado como rascunho. Regras e estoque precisam estar completos para ativar.">
            <CampaignForm key={effectiveProject} projects={projects} offers={offers} defaultProject={effectiveProject} mutate={mutate}/>
            </Section>}</>}

      {tab === 'materials' && <>
        <Section title="Materiais e estoque" description="Saldo físico, reservas e unidades disponíveis ficam separados." aside={<div className="p-search">
            <Search size={17}/>
            <input aria-label="Buscar materiais" placeholder="Buscar material" value={query} onChange={e => setQuery(e.target.value)}/>
            </div>}>{searchItems.length ? <div className="p-card p-table-wrap">
            <table>
            <thead>
            <tr>
            <th>Material</th>
            <th>Físico</th>
            <th>Reservado</th>
            <th>Disponível</th>
            </tr>
            </thead>
            <tbody>{searchItems.map(i => <tr key={i.id}>
                <td>
                <strong>{i.name}</strong>
                <small>{categoryNames[i.category] || i.category} · {projectName(get(i, 'projectId', 'project_id'))}</small>
                </td>
                <td>{i.stock ?? i.quantity ?? 0}<small>{i.unit || 'unidade'}</small>
                </td>
                <td>{i.reserved ?? 0}</td>
                <td>
                <span className={available(i) <= Number(get(i, 'lowStock', 'low_stock') ?? 0) ? 'p-low' : 'p-available'}>{available(i)}</span>
                </td>
                </tr>)}</tbody>
            </table>
            </div> : <Empty title={query ? 'Nenhum material encontrado' : 'Seu catálogo ainda está vazio'} text={query ? 'Tente outro nome ou selecione outro projeto.' : 'Cadastre os materiais e registre o recebimento após conferir a quantidade real.'}/>}</Section>{can('inventory.manage') && projects.length > 0 && <div className="p-two-columns">
            <Section title="Cadastrar material" description="O cadastro começa sem saldo. Registre o recebimento depois da contagem.">
            <OperationForm action="item.create" mutate={mutate} submit="Cadastrar material" make={f => ({ projectId: f.get('projectId'), name: f.get('name'), category: f.get('category'), unit: f.get('unit'), lowStock: Number(f.get('lowStock')), description: f.get('description') })}>
            <div className="p-form-grid">{projectField}<Field label="Nome">
            <input name="name" required maxLength={120} placeholder="Ex.: Button azul 2,5 cm"/>
            </Field>
            <Field label="Tipo">
            <select name="category">
            <option value="gift">Brinde</option>
            <option value="equipment">Equipamento retornável</option>
            <option value="distribution">Distribuição institucional</option>
            <option value="consumption">Consumo interno</option>
            </select>
            </Field>
            <Field label="Unidade de controle">
            <input name="unit" defaultValue="unidade" required maxLength={40} placeholder="Unidade, kit, pacote…"/>
            </Field>
            <Field label="Avisar quando disponível até">
            <input name="lowStock" type="number" min="0" step="1" defaultValue="0" required/>
            </Field>
            <Field label="Descrição">
            <input name="description" maxLength={500} placeholder="Composição, identificação ou condição"/>
            </Field>
            </div>
            <p className="p-form-help">Para equipamentos, cadastre cada bem individualmente para controlar sua reserva e devolução.</p>
            </OperationForm>
            </Section>
            <Section title="Movimentar estoque" description="Toda alteração registra finalidade, quantidade e responsável.">
            <OperationForm action="stock.move" mutate={mutate} submit="Registrar movimento" make={f => { const qty = Number(f.get('quantity')); const kind = String(f.get('kind')); return { itemId: f.get('itemId'), delta: kind === 'receive' ? qty : kind === 'adjust' ? qty : -Math.abs(qty), kind, note: f.get('note') }; }}>
            <Field label="Material">
            <select name="itemId" required>
            <option value="">Selecione o material</option>{visibleItems.map(i => <option value={i.id} key={i.id}>{i.name} · {projectName(get(i, 'projectId', 'project_id'))}</option>)}</select>
            </Field>
            <div className="p-form-grid">
            <Field label="Operação">
            <select name="kind">
            <option value="receive">Recebimento</option>
            <option value="distribute">Distribuição</option>
            <option value="consume">Consumo interno</option>
            <option value="adjust">Ajuste de contagem</option>
            </select>
            </Field>
            <Field label="Quantidade" help="No ajuste, use valor positivo para acrescentar ou negativo para retirar.">
            <input name="quantity" type="number" step="1" required defaultValue="1"/>
            </Field>
            </div>
            <Field label="Finalidade ou justificativa">
            <textarea name="note" rows={3} required maxLength={1000} placeholder="Ex.: Recebimento conferido pela equipe"/>
            </Field>
            </OperationForm>
            </Section>
            </div>}{can('inventory.manage') && projects.length > 0 && <Section title="Ofertas de brindes" description="Uma oferta define o que será entregue. Um kit de três buttons consome três unidades.">{offers.length > 0 && <div className="p-offer-list">{byProject(offers).map(o => <div key={o.id}>
                    <Gift size={18}/>
                    <strong>{o.name}</strong>
                    <span>{o.kind === 'super' ? 'Super Brinde' : 'Brinde'}</span>
                    </div>)}</div>}<OperationForm action="offer.create" mutate={mutate} submit="Criar oferta" make={f => ({ projectId: f.get('projectId'), name: f.get('name'), kind: f.get('kind'), components: Array.from({ length: offerRows }, (_, n) => ({ itemId: f.get(`componentItem${n}`), quantity: Number(f.get(`componentQty${n}`)) })).filter(x => x.itemId) })}>
            <div className="p-form-grid">{projectField}<Field label="Nome da oferta">
            <input name="name" required maxLength={120} placeholder="Ex.: Kit com três buttons"/>
            </Field>
            <Field label="Categoria do resultado">
            <select name="kind">
            <option value="brinde">Brinde</option>
            <option value="super">Super Brinde</option>
            </select>
            </Field>
            </div>
            <div className="p-components">{Array.from({ length: offerRows }, (_, n) => <div className="p-component-row" key={n}>
                <Field label={`Material ${n + 1}`}>
                <select name={`componentItem${n}`} required={n === 0}>
                <option value="">Selecione</option>{formItems.filter(i => i.category === 'gift').map(i => <option value={i.id} key={i.id}>{i.name}</option>)}</select>
                </Field>
                <Field label="Quantidade">
                <input name={`componentQty${n}`} type="number" min="1" max="1000" step="1" defaultValue="1" required/>
                </Field>
                </div>)}<button type="button" className="p-text-link" disabled={offerRows >= 8} onClick={() => setOfferRows(n => n + 1)}>
            <Plus size={16}/>Adicionar outro material</button>
            </div>
            </OperationForm>
            </Section>}</>}

      {tab === 'loans' && <>
        <Section title="Agenda de empréstimos" description="A reserva é confirmada por intervalo. Um bem em atraso continua indisponível.">{visibleLoans.length ? <div className="p-loan-list">{visibleLoans.map(l => {
                    const item = items.find(i => i.id === get(l, 'itemId', 'item_id'));
                    const late = l.status === 'out' && new Date(get(l, 'endsAt', 'ends_at')).getTime() < now;
                    return <article className="p-card p-loan-card" key={l.id}>
                    <div className="p-row-between">
                    <span className="p-kicker">{projectName(get(l, 'projectId', 'project_id'))}</span>
                    <div className="p-inline">{late && <span className="p-badge p-status-late">Em atraso</span>}<Badge status={l.status}/>
                    </div>
                    </div>
                    <h3>{item?.name || l.itemName || 'Equipamento'}</h3>
                    <p>{get(l, 'actionName', 'action_name') || 'Ação de extensão'}</p>
                    <div className="p-loan-period">
                    <CalendarDays size={18}/>
                    <div>
                    <strong>{when(get(l, 'startsAt', 'starts_at'))}</strong>
                    <span>até {when(get(l, 'endsAt', 'ends_at'))}</span>
                    </div>
                    </div>
                    <details>
                    <summary>Detalhes, termos e ocorrências <ChevronDown size={16}/>
                    </summary>
                    <div className="p-loan-details">
                    <p>
                    <strong>Responsável pela retirada:</strong> {get(l, 'borrowerName', 'borrower_name') || 'Não informado'}</p>{get(l, 'borrowerContact', 'borrower_contact') && <p>
                        <strong>Contato:</strong> {get(l, 'borrowerContact', 'borrower_contact')}</p>}{l.note && <p>
                        <strong>Observações:</strong> {l.note}</p>}{documents.filter(d => get(d, 'loanId', 'loan_id') === l.id).map(d => <a className="p-file-link" key={d.id} href={`/api/files/${d.id}`} target="_blank" rel="noreferrer">
                        <FileText size={16}/>{d.name || 'Termo anexado'}<ExternalLink size={13}/>
                        </a>)}{can('loans.manage', 'loans.checkout') && <div className="p-upload">
                        <label>Foto ou PDF do termo<input type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy} onChange={async (e) => { const file = e.target.files?.[0]; if (!file)
                            return; setBusy(true); setFailure(''); try {
                            const fd = new FormData();
                            fd.set('loanId', l.id);
                            fd.set('file', file);
                            const r = await fetch('/api/files', { method: 'POST', headers: { 'X-Proex-Action': '1', 'X-Operation-Key': operationId() }, body: fd });
                            const b = await r.json() as Row;
                            if (!r.ok)
                                throw new Error(b.error || 'Não foi possível anexar.');
                            await refresh();
                            setMessage('Documento anexado com acesso restrito.');
                            e.target.value = '';
                        }
                        catch (error) {
                            setFailure(error instanceof Error ? error.message : 'Falha no anexo.');
                        }
                        finally {
                            setBusy(false);
                        } }}/>
                        </label>
                        <small>Até 10 MB. O arquivo fica restrito à equipe autorizada.</small>
                        </div>}{can('loans.manage', 'loans.checkout') && l.status !== 'returned' && l.status !== 'cancelled' && <OperationForm action="loan.status" mutate={mutate} submit="Registrar atualização" make={f => ({ id: l.id, status: f.get('status'), note: f.get('note') })}>
                        <Field label="Etapa">
                        <select name="status">{l.status === 'reserved' && <option value="out">Registrar retirada</option>}{l.status === 'out' && <option value="returned">Registrar devolução</option>}{l.status === 'reserved' && <option value="cancelled">Cancelar reserva</option>}</select>
                        </Field>
                        <Field label="Condição e observações">
                        <textarea name="note" rows={2} maxLength={1000} placeholder="Condição observada, acessórios, avarias ou outros detalhes"/>
                        </Field>
                        </OperationForm>}</div>
                    </details>
                    </article>;
                })}</div> : <Empty title="Nenhuma reserva neste contexto" text="Cadastre o equipamento, confira a disponibilidade e registre a ação que fará a retirada." icon={Truck}/>}</Section>{can('loans.manage') && projects.length > 0 && <Section title="Reservar equipamento" description="Conflitos de horário e bens indisponíveis são conferidos antes da confirmação.">
            <OperationForm action="loan.create" mutate={mutate} submit="Confirmar reserva" make={f => ({ projectId: f.get('projectId'), itemId: f.get('itemId'), actionName: f.get('actionName'), borrowerName: f.get('borrowerName'), borrowerContact: f.get('borrowerContact'), startsAt: iso(f.get('startsAt')), endsAt: iso(f.get('endsAt')), note: f.get('note') })}>
            <div className="p-form-grid">{projectField}<Field label="Equipamento">
            <select name="itemId" required>
            <option value="">Selecione um bem</option>{formItems.filter(i => i.category === 'equipment').map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
            </Field>
            <Field label="Ação ou projeto atendido">
            <input name="actionName" required maxLength={160} placeholder="Nome da ação de extensão"/>
            </Field>
            <Field label="Responsável pela retirada">
            <input name="borrowerName" required maxLength={120}/>
            </Field>
            <Field label="Contato necessário ao empréstimo">
            <input name="borrowerContact" maxLength={150} placeholder="E-mail ou telefone"/>
            </Field>
            <Field label="Retirada prevista">
            <input name="startsAt" type="datetime-local" required/>
            </Field>
            <Field label="Devolução prevista">
            <input name="endsAt" type="datetime-local" required/>
            </Field>
            </div>
            <Field label="Observações">
            <textarea name="note" rows={3} maxLength={1000} placeholder="Finalidade, acessórios e informações necessárias"/>
            </Field>
            </OperationForm>
            </Section>}</>}

      {tab === 'team' && <>
        <Section title="Pessoas e permissões" description="Cada pessoa utiliza sua própria conta e recebe acesso somente ao escopo concedido.">{members.length ? <div className="p-card p-member-list">{members.map(m => <div className="p-member" key={m.id}>
                <span className="p-member-avatar">
                <Users size={18}/>
                </span>
                <div>
                <strong>{m.displayName || m.name || m.email || 'Integrante'}</strong>
                <small>{roleNames[m.role] || m.role} · {get(m, 'projectId', 'project_id') ? projectName(get(m, 'projectId', 'project_id')) : 'Organização'}</small>
                </div>{get(m, 'revokedAt', 'revoked_at') ? <Badge status="revoked"/> : m.role === 'owner' ? <span className="p-badge">Responsável</span> : can('access.manage') && <button className="p-button p-button-danger" disabled={busy} onClick={() => void quick('member.revoke', { id: m.id })}>Revogar</button>}</div>)}</div> : <Empty title="Nenhum vínculo exibido" text="A equipe aparecerá aqui conforme os convites forem aceitos." icon={Users}/>}</Section>{can('access.invite') && <Section title="Convidar para a equipe" description="Gere um link vinculado ao e-mail. O destinatário precisa entrar com essa conta para aceitar.">
            <OperationForm key={`invite-${filter}`} action="invite.create" mutate={mutate} submit="Gerar convite" onDone={r => { setInviteLink(string(r.inviteUrl)); setCopied(false); }} make={f => ({ email: f.get('email'), role: f.get('role'), projectId: f.get('projectId') || null })}>
            <div className="p-form-grid">
            <Field label="E-mail do destinatário">
            <input name="email" type="email" required autoComplete="off" placeholder="nome@exemplo.com"/>
            </Field>
            <Field label="Função">
            <select name="role">
            <option value="operator">Operador de evento</option>{can('organization.manage') && <option value="manager">Gestor de projeto</option>}<option value="inventory">Responsável por estoque</option>
            <option value="loans">Responsável por empréstimos</option>
            <option value="viewer">Leitor de relatórios</option>
            </select>
            </Field>
            <Field label="Escopo do acesso">
            <select name="projectId" defaultValue={filter || (can('organization.manage') ? '' : projects[0]?.id)} required={!can('organization.manage')}>{can('organization.manage') && <option value="">Organização · todos os projetos permitidos</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </Field>
            </div>
            </OperationForm>{inviteLink && <div className="p-invite-result">
                <CheckCircle2 size={22}/>
                <div>
                <strong>Convite criado</strong>
                <p>Copie o link e compartilhe com o destinatário. Nenhum e-mail foi enviado automaticamente.</p>
                <div className="p-copy-row">
                <input aria-label="Link do convite" value={inviteLink} readOnly onFocus={e => e.target.select()}/>
                <button className="p-button p-button-subtle" onClick={() => void copyInvite()}>
                <Copy size={16}/>{copied ? 'Copiado' : 'Copiar'}</button>
                </div>
                </div>
                </div>}</Section>}{invites.length > 0 && <Section title="Convites emitidos">
            <div className="p-card p-member-list">{invites.map(i => <div className="p-member" key={i.id}>
                <div>
                <strong>{i.email || get(i, 'recipientEmail', 'recipient_email')}</strong>
                <small>{roleNames[i.role] || i.role} · válido até {when(get(i, 'expiresAt', 'expires_at'))}</small>
                </div>
                <Badge status={get(i, 'revokedAt', 'revoked_at') ? 'revoked' : get(i, 'acceptedAt', 'accepted_at') ? 'accepted' : 'pending'}/>{!get(i, 'revokedAt', 'revoked_at') && !get(i, 'acceptedAt', 'accepted_at') && can('access.manage') && <button className="p-button p-button-danger" disabled={busy} onClick={() => void quick('invite.revoke', { id: i.id })}>Revogar</button>}</div>)}</div>
            </Section>}</>}

      {tab === 'reports' && <>
        <div className="p-stats">
        <div className="p-stat">
        <span>Participações</span>
        <strong>{metric('participations', 'participationCount')}</strong>
        <small>Contas e atendimentos assistidos</small>
        </div>
        <div className="p-stat">
        <span>Tentativas</span>
        <strong>{metric('attempts', 'attemptCount')}</strong>
        <small>Inclui repetições autorizadas</small>
        </div>
        <div className="p-stat">
        <span>Premiações entregues</span>
        <strong>{metric('deliveries', 'delivered', 'redemptions')}</strong>
        <small>Direitos resgatados</small>
        </div>
        <div className="p-stat">
        <span>Unidades entregues</span>
        <strong>{metric('units', 'unitsDelivered', 'units_delivered', 'deliveredUnits')}</strong>
        <small>{filter ? 'Sem medição neste recorte' : 'Quantidade física de itens'}</small>
        </div>
        </div>
        <div className="p-measures">
        <div className="p-card">
        <span>Carregamentos de páginas</span>
        <strong>{metric('visits')}</strong>
        <small>Não são visitantes únicos</small>
        </div>
        <div className="p-card">
        <span>Atendimentos assistidos</span>
        <strong>{metric('tickets')}</strong>
        <small>Participações por tíquete</small>
        </div>
        <div className="p-card">
        <span>Novos seguidores no Instagram</span>
        <strong>Não medido</strong>
        <small>Não há confirmação automática de seguimento</small>
        </div>
        </div>{list(data.metrics?.campaigns).length > 0 && <Section title="Resultados por evento" description="Contagens reais de cada campanha, respeitando seu acesso e o projeto selecionado.">
            <div className="p-card p-table-wrap">
            <table>
            <thead>
            <tr>
            <th>Evento</th>
            <th>Participações</th>
            <th>Tentativas</th>
            <th>Entregas</th>
            </tr>
            </thead>
            <tbody>{byProject(list(data.metrics.campaigns)).map(c => <tr key={c.id}>
                <td>
                <strong>{c.name}</strong>
                <small>{projectName(get(c, 'projectId', 'project_id'))}</small>
                </td>
                <td>{c.participations}</td>
                <td>{c.attempts}</td>
                <td>{c.deliveries}</td>
                </tr>)}</tbody>
            </table>
            </div>
            </Section>}<Section title="Exportar registros" description="As exportações respeitam o seu acesso. O relatório gerencial usa dados agregados.">
        <div className="p-export-grid">{[{ kind: 'participations', title: 'Participação nos eventos', text: 'Modalidades, resultados e contagens por campanha.', icon: Users }, { kind: 'stock', title: 'Materiais e movimentos', text: 'Saldo, reservas e quantidade disponível por item.', icon: Boxes }, { kind: 'loans', title: 'Empréstimos', text: 'Agenda, etapas e devoluções pendentes.', icon: Truck }].map(({ kind, title: exportTitle, text, icon: Icon }) => <a className="p-card p-export-card" href={`/api/export?kind=${kind}${filter ? `&projectId=${encodeURIComponent(filter)}` : ''}`} key={kind}>
            <span className="p-icon-tile">
            <Icon size={22}/>
            </span>
            <h3>{exportTitle}</h3>
            <p>{text}</p>
            <span className="p-text-link">Baixar CSV <ArrowDownToLine size={16}/>
            </span>
            </a>)}</div>
        </Section>
        <div className="p-explainer">
        <ShieldCheck size={21}/>
        <div>
        <h3>Contagens com significado</h3>
        <p>Uma premiação com três buttons representa uma participação e três unidades entregues. Cliques no Instagram, declarações e confirmações de seguimento são sinais diferentes; nenhum deles será somado automaticamente como “novos seguidores”.</p>
        <p>Arquivos CSV podem ser importados no Google Sheets. Uma conexão automática com a planilha precisa ser configurada separadamente.</p>
        </div>
        </div>
        </>}

      {tab === 'settings' && <>
        <Section title="Canais e informações da operação" description="Use os canais institucionais confirmados e o aviso aprovado para o serviço.">
        <OperationForm action="setting.update" mutate={mutate} submit="Salvar configurações" make={f => ({ instagramUrl: f.get('instagramUrl'), privacyNotice: f.get('privacyNotice') })}>
        <Field label="Perfil oficial no Instagram" help="O link divulga o canal. Ele não verifica automaticamente se a pessoa segue o perfil.">
        <input name="instagramUrl" type="url" placeholder="https://www.instagram.com/perfil-confirmado/" defaultValue={data.settings?.instagramUrl || data.settings?.instagram_url || ''} maxLength={500}/>
        </Field>
        <Field label="Aviso de privacidade e contato institucional" help="Descreva finalidade, dados mínimos, responsável, guarda e canal para direitos. Não use um aceite genérico como substituto dessa definição.">
        <textarea name="privacyNotice" rows={8} maxLength={6000} defaultValue={data.settings?.privacyNotice || data.settings?.privacy_notice || ''} placeholder="Texto validado institucionalmente para esta operação"/>
        </Field>
        </OperationForm>
        </Section>
        <div className="p-explainer">
        <ShieldCheck size={21}/>
        <div>
        <h3>Integrações com estado explícito</h3>
        <p>O acesso atual utiliza o login do ChatGPT. Login direto por Google ou e-mail e confirmação de seguimento pelo Instagram não são apresentados como configurados.</p>
        <p>A roleta livre segue independente. As campanhas oficiais usam os registros e as regras deste portal.</p>
        </div>
        </div>
        </>}

      <footer className="p-footer">
    <span>{online ? <Wifi size={14}/> : <WifiOff size={14}/>}{online ? 'Conectado' : 'Sem conexão'}{updatedAt && ` · atualizado às ${updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}</span>
    <span>PROEX · Universidade Federal de Goiás</span>
    </footer>
      </main>
    </div>
  </div>;
}
