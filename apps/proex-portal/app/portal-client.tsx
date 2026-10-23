'use client';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import PhysicalAttendance from '@/components/portal/physical-attendance';
import CampaignForm from '@/components/portal/campaign-form';
import PendingPrizes from '@/components/portal/pending-prizes';
import ProjectPanel from '@/components/portal/project-panel';
import TeamPanel from '@/components/portal/team-panel';
import ProfilePanel from '@/components/portal/profile-panel';
import CalendarPanel from '@/components/portal/calendar-panel';
import RecordsPanel from '@/components/portal/records-panel';
import { ThemeSwitch } from '@/components/theme/theme-switch';
import { BrandMark } from '@/components/theme/brand-mark';
import { ArrowDownToLine, ArrowRight, Boxes, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, ExternalLink, FileText, FolderKanban, Gift, LayoutDashboard, LoaderCircle, LogOut, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Truck, Users, Wifi, WifiOff, X } from 'lucide-react';
// API projections vary by module; the server validates every mutation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Snapshot = Row;
type Tab = 'overview' | 'projects' | 'events' | 'materials' | 'loans' | 'team' | 'reports' | 'settings' | 'calendar' | 'records' | 'profile';
type Payload = Record<string, unknown>;
const tabs: {
    id: Tab;
    label: string;
    icon: typeof Boxes;
}[] = [
    { id: 'overview', label: 'Visão geral', icon: LayoutDashboard }, { id: 'projects', label: 'Projetos', icon: FolderKanban },
    { id: 'events', label: 'Eventos', icon: CalendarDays }, { id: 'materials', label: 'Materiais', icon: Boxes },
    { id: 'loans', label: 'Empréstimos', icon: Truck }, { id: 'team', label: 'Equipe', icon: Users },
    { id: 'calendar', label: 'Agenda', icon: CalendarDays }, { id: 'records', label: 'Registros', icon: FileText },
    { id: 'profile', label: 'Conta', icon: Users },
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
const readableError = (value: unknown, fallback = 'Não foi possível concluir. Atualize os dados e tente novamente.') => typeof value === 'string' && value.length < 450 && !/SQLITE|D1_|SQL syntax|Unexpected token|JSON|Failed to fetch|NetworkError|Load failed|<html/i.test(value) ? value : fallback;
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
function OperationForm({ action, make, mutate, children, submit = 'Salvar', onDone, compact = false, onProjectFocus }: {
    action: string;
    make: (f: FormData) => Payload;
    mutate: (action: string, data: Payload) => Promise<Row>;
    children: ReactNode;
    submit?: string;
    onDone?: (result: Row) => void;
    compact?: boolean;
    onProjectFocus?: (id: string) => void;
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
    return <form className={`p-form${compact ? ' p-form-compact' : ''}`} onSubmit={send} onFocus={e => { const field = e.currentTarget.querySelector('select[name="projectId"]') as unknown as HTMLSelectElement | null; if (field?.value)
        onProjectFocus?.(field.value); }} onChange={() => {
            if (!saving)
                key.current = null;
        }}>
    <fieldset disabled={saving}>{children}<div className="p-form-footer">{error && <p className="p-inline-error" role="alert">{error}</p>}<button className="p-button p-button-primary" type="submit">{saving ? <LoaderCircle className="p-spin" size={18}/> : <Check size={18}/>}{saving ? 'Salvando…' : submit}</button>
    </div>
    </fieldset>
    </form>;
}
function LoanAttachment({ loanId, onSaved }: {
    loanId: string;
    onSaved: () => Promise<boolean>;
}) {
    const [file, setFile] = useState<File | null>(null), [saving, setSaving] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    const key = useRef<string | null>(null);
    function choose(event: React.ChangeEvent<HTMLInputElement>) { const chosen = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!chosen)
        return; setMessage(''); setError(''); if (chosen.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(chosen.type)) {
        setError('Escolha uma foto JPEG, PNG, WebP ou um PDF de até 10 MB.');
        return;
    } setFile(chosen); key.current = crypto.randomUUID(); }
    async function upload() { if (!file || saving)
        return; setSaving(true); setError(''); key.current ??= crypto.randomUUID(); try {
        const form = new FormData();
        form.set('loanId', loanId);
        form.set('file', file);
        const response = await fetch('/api/files', { method: 'POST', headers: { 'X-Proex-Action': '1', 'X-Operation-Key': key.current }, body: form });
        const result = await response.json().catch(() => null) as Row | null;
        if (!response.ok || !result)
            throw new Error(readableError(result?.error, 'Não foi possível confirmar o anexo. Use Tentar novamente com o mesmo arquivo.'));
        const updated = await onSaved();
        setMessage(updated ? 'Documento anexado com acesso restrito.' : 'Documento salvo. Atualize os dados para consultar o anexo.');
        setFile(null);
        key.current = null;
    }
    catch (error) {
        setError(readableError(error instanceof Error ? error.message : '', 'A conexão foi interrompida. Use Tentar novamente para enviar o mesmo arquivo sem duplicar o registro.'));
    }
    finally {
        setSaving(false);
    } }
    return <div className="p-upload">
    <label className="p-field">
    <span>Foto ou PDF do termo</span>
    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={saving} onChange={choose}/>
    <small>Até 10 MB. O arquivo fica restrito à equipe autorizada.</small>
    </label>{file && <div className="p-file-ready">
        <p>
        <FileText size={15}/>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>
        <div className="p-inline">
        <button className="p-button p-button-primary" disabled={saving} onClick={() => void upload()}>{saving ? <LoaderCircle size={16} className="p-spin"/> : <Check size={16}/>}{saving ? 'Enviando…' : error ? 'Tentar novamente' : 'Anexar documento'}</button>
        <button className="p-button p-button-subtle" disabled={saving} onClick={() => { setFile(null); key.current = null; setError(''); }}>Descartar seleção</button>
        </div>
        </div>}{error && <p className="p-inline-error" role="alert">{error}</p>}{message && <p className="p-form-help" role="status">{message}</p>}</div>;
}
function ItemEditor({ item, mutate, close }: {
    item: Row;
    mutate: (action: string, payload: Payload) => Promise<Row>;
    close: () => void;
}) {
    return <section className="p-section p-editor-panel">
    <div className="p-section-heading">
    <div>
    <h2>Editar material</h2>
    <p>Saldo e reservas são alterados por movimentos. A condição controla a disponibilidade.</p>
    </div>
    <button className="p-icon-button" onClick={close} aria-label="Fechar edição do material">
    <X size={18}/>
    </button>
    </div>
    <OperationForm action="item.update" mutate={mutate} onDone={close} submit="Salvar material" make={f => ({ id: item.id, expectedVersion: item.version, name: f.get('name'), unit: f.get('unit'), lowStock: Number(f.get('lowStock')), description: f.get('description'), condition: f.get('condition'), assetCode: f.get('assetCode') })}>
    <div className="p-form-grid">
    <Field label="Nome do material">
    <input name="name" required maxLength={200} defaultValue={item.name}/>
    </Field>
    <Field label="Unidade">
    <input name="unit" required maxLength={40} defaultValue={item.unit}/>
    </Field>
    <Field label="Condição">
    <select name="condition" defaultValue={item.condition || 'active'}>
    <option value="active">Disponível para operação</option>
    <option value="maintenance">Em manutenção</option>
    <option value="inactive">Inativo</option>
    </select>
    <small>Não é possível desativar unidades prometidas ou um equipamento ainda retirado.</small>
    </Field>
    <Field label="Alerta quando disponível até">
    <input name="lowStock" type="number" min="0" max={item.category === 'equipment' ? 1 : undefined} required defaultValue={item.low_stock ?? item.lowStock ?? 0}/>
    </Field>
    <Field label="Identificação patrimonial ou código">
    <input name="assetCode" maxLength={100} defaultValue={item.asset_code ?? item.assetCode ?? ''}/>
    </Field>
    </div>
    <Field label="Descrição">
    <textarea name="description" rows={3} maxLength={2000} defaultValue={item.description ?? ''}/>
    </Field>
    <p className="p-form-help">Projeto e categoria são preservados. Para outra finalidade, cadastre outro material.</p>
    </OperationForm>
    </section>;
}
export default function PortalClient({ initial }: {
    initial: Snapshot;
}) {
    const [data, setData] = useState<Snapshot>(initial ?? {});
    const [tab, setTab] = useState<Tab>('overview');
    const [accountOpen, setAccountOpen] = useState(false);
    const [closingCampaign, setClosingCampaign] = useState<string | null>(null);
    const [reportFrom, setReportFrom] = useState(''), [reportTo, setReportTo] = useState('');
    const [sessionExpired, setSessionExpired] = useState(false);
    const accountRef = useRef<HTMLDivElement>(null);
    const [filter, setFilter] = useState('');
    const [draftProject, setDraftProject] = useState('');
    const [query, setQuery] = useState('');
    const [editingItem, setEditingItem] = useState<Row | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [online, setOnline] = useState(true);
    const [message, setMessage] = useState('');
    const [messageKind, setMessageKind] = useState<'success' | 'warning'>('success');
    const [failure, setFailure] = useState('');
    const [now, setNow] = useState(() => new Date(initial?.updatedAt ?? 0).getTime());
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
    const [offerRows, setOfferRows] = useState(1);
    const latestRequest = useRef(0);
    const refresh = useCallback(async () => {
        const request = ++latestRequest.current;
        setRefreshing(true);
        try {
            const response = await fetch('/api/portal', { cache: 'no-store' });
            const body = await response.json().catch(() => null) as Row | null;
            if (response.status === 401)
                setSessionExpired(true);
            if (!response.ok || !body)
                throw new Error(body?.error || 'Não foi possível atualizar. Verifique sua conexão e tente novamente.');
            if (request === latestRequest.current) {
                setData(body);
                setSessionExpired(false);
                setUpdatedAt(new Date());
                setNow(Date.now());
                setFailure('');
            }
            return true;
        }
        catch (e) {
            if (request === latestRequest.current)
                setFailure(readableError(e instanceof Error ? e.message : '', 'Falha de conexão. Os dados exibidos podem estar desatualizados.'));
            return false;
        }
        finally {
            if (request === latestRequest.current)
                setRefreshing(false);
        }
    }, []);
    useEffect(() => { const change = () => { setOnline(navigator.onLine); }; const timer = window.setTimeout(() => { setUpdatedAt(new Date()); setNow(Date.now()); change(); }, 0); const clock = window.setInterval(() => setNow(Date.now()), 60000); window.addEventListener('online', change); window.addEventListener('offline', change); return () => { window.clearTimeout(timer); window.clearInterval(clock); window.removeEventListener('online', change); window.removeEventListener('offline', change); }; }, []);
    useEffect(() => { const url = new URL(window.location.href); const requested = url.searchParams.get('module'); const timer = window.setTimeout(() => { if (tabs.some(t => t.id === requested))
        setTab(requested as Tab); setFilter(url.searchParams.get('project') || ''); }, 0); return () => window.clearTimeout(timer); }, []);
    useEffect(() => { const url = new URL(window.location.href); if (tab === 'overview')
        url.searchParams.delete('module');
    else
        url.searchParams.set('module', tab); if (filter)
        url.searchParams.set('project', filter);
    else
        url.searchParams.delete('project'); window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`); }, [tab, filter]);
    useEffect(() => { const update = () => { if (navigator.onLine && !document.hidden)
        void refresh(); }; const timer = window.setInterval(update, 30000); window.addEventListener('online', update); document.addEventListener('visibilitychange', update); return () => { window.clearInterval(timer); window.removeEventListener('online', update); document.removeEventListener('visibilitychange', update); }; }, [refresh]);
    useEffect(() => { if (!accountOpen)
        return; const close = (e: PointerEvent) => { if (!accountRef.current?.contains(e.target as Node))
        setAccountOpen(false); }; const keyboard = (e: KeyboardEvent) => { if (e.key === 'Escape') {
        setAccountOpen(false);
        accountRef.current?.querySelector<HTMLButtonElement>('.p-account-trigger')?.focus();
    } }; document.addEventListener('pointerdown', close); document.addEventListener('keydown', keyboard); return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', keyboard); }; }, [accountOpen]);
    const projects = list(data.projects), campaigns = list(data.campaigns), items = list(data.items), offers = list(data.offers), loans = list(data.loans);
    const members = list(data.members), invites = list(data.invites), audit = list(data.audit), documents = list(data.documents);
    const user = data.user ?? {};
    const role = string(data.role);
    const capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
    const globalCapabilities: string[] = Array.isArray(data.globalCapabilities) ? data.globalCapabilities : role === 'owner' ? capabilities : [];
    const projectCapabilities = data.capabilitiesByProject ?? null;
    const canGlobal = (...needed: string[]) => globalCapabilities.includes('*') || needed.some(c => globalCapabilities.includes(c));
    const canProject = (id: string, ...needed: string[]) => canGlobal(...needed) || Boolean(projectCapabilities ? needed.some(c => (projectCapabilities[id] ?? []).includes(c)) : role === 'owner' || needed.some(c => capabilities.includes(c)));
    const canAny = (...needed: string[]) => canGlobal(...needed) || projects.some(p => canProject(p.id, ...needed));
    const can = (...needed: string[]) => filter ? canProject(filter, ...needed) : canAny(...needed);
    const byProject = (rows: Row[]) => filter ? rows.filter(r => get(r, 'projectId', 'project_id') === filter) : rows;
    const visibleCampaigns = byProject(campaigns), visibleItems = byProject(items), visibleLoans = byProject(loans);
    const projectName = (id: unknown) => projects.find(p => p.id === id)?.name || 'PROEX';
    const formCapability = tab === 'loans' ? 'loans.manage' : tab === 'events' ? 'campaigns.manage' : 'inventory.manage';
    const formProjects = projects.filter(p => canProject(p.id, formCapability));
    const selectedFormProject = draftProject || filter;
    const effectiveProject = formProjects.some(p => p.id === selectedFormProject) ? selectedFormProject : string(formProjects[0]?.id);
    const formItems = items.filter(i => !effectiveProject || get(i, 'projectId', 'project_id') === effectiveProject);
    const available = (item: Row) => item.available !== undefined && item.available !== null ? Number(item.available) : Number(item.stock ?? item.quantity ?? 0) - Number(item.reserved ?? 0);
    const lowItems = visibleItems.filter(i => i.category !== 'equipment' && i.condition === 'active' && available(i) <= Number(get(i, 'lowStock', 'low_stock') ?? 0));
    const lateLoans = visibleLoans.filter(l => l.status === 'out' && new Date(get(l, 'endsAt', 'ends_at')).getTime() < now);
    const searchItems = visibleItems.filter(i => !query || `${i.name} ${i.description ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
    const allowedTabs = tabs.filter(t => ['overview', 'projects', 'profile', 'calendar', 'records'].includes(t.id) || (t.id === 'events' && canAny('campaigns.manage', 'participation.operate', 'inventory.deliver')) || (t.id === 'materials' && canAny('inventory.read', 'inventory.manage', 'inventory.deliver')) || (t.id === 'loans' && canAny('loans.read', 'loans.manage', 'loans.checkout')) || (t.id === 'team' && canAny('access.invite', 'access.manage')) || (t.id === 'reports' && canAny('reports.read')) || (t.id === 'settings' && canGlobal('organization.manage')));
    async function mutate(action: string, payload: Payload): Promise<Row> {
        if (!navigator.onLine)
            throw new Error('Você está sem conexão. Reconecte antes de confirmar uma operação.');
        const r = await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action, ...payload }) }).catch(() => { throw new Error('A conexão foi interrompida. Reconecte e tente novamente; seu formulário foi preservado.'); });
        const body = await r.json().catch(() => null) as Row | null;
        if (r.status === 401)
            setSessionExpired(true);
        if (!r.ok || !body || body.error)
            throw new Error(r.status === 401 ? 'Sua sessão terminou. Entre novamente para continuar.' : readableError(body?.error, 'Não foi possível concluir. Verifique sua conexão e tente novamente.'));
        const updated = await refresh();
        setMessageKind(body.alreadyDelivered ? 'warning' : 'success');
        setMessage(body.alreadyDelivered ? `Este prêmio${body.offerName ? ` (${body.offerName})` : ''} já foi entregue. Não entregue novamente.` : action === 'prize.redeem' ? 'Entrega registrada. Entregue os materiais indicados à pessoa.' : updated ? 'Registro salvo. Os dados foram atualizados.' : 'Registro salvo. A atualização da tela está pendente; use Atualizar dados.');
        return body;
    }
    async function quick(action: string, payload: Payload) {
        if (busy)
            return;
        setBusy(true);
        setFailure('');
        try {
            await mutate(action, { ...payload, operationKey: operationId() });
        }
        catch (e) {
            setFailure(e instanceof Error ? e.message : 'Não foi possível concluir.');
        }
        finally {
            setBusy(false);
        }
    }
    async function logout() {
        setBusy(true);
        try {
            const response = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: 'logout' }) });
            if (!response.ok)
                throw new Error('Não foi possível sair. Tente novamente.');
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Reload clears private client data after the session cookie is removed.
            window.location.assign('/login');
        }
        catch (e) {
            setFailure(e instanceof Error ? e.message : 'Não foi possível sair.');
            setBusy(false);
        }
    }
    const projectField = <Field label="Projeto">
    <select name="projectId" value={effectiveProject} onChange={e => setDraftProject(e.target.value)} required>
    <option value="">Selecione um projeto</option>{formProjects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>
    </Field>;
    const dailyRows = byProject(list(data.metrics?.daily)).filter(row => (!reportFrom || row.day >= reportFrom) && (!reportTo || row.day <= reportTo));
    const campaignTotals = new Map<string, Row>();
    for (const row of dailyRows) {
        const key = String(row.campaign_id);
        const previous = campaignTotals.get(key) ?? { id: row.campaign_id, name: row.campaign_name, project_id: row.project_id, participations: 0, attempts: 0, deliveries: 0 };
        for (const kind of ['participations', 'attempts', 'deliveries'])
            previous[kind] += Number(row[kind] ?? 0);
        campaignTotals.set(key, previous);
    }
    const reportCampaignRows = reportFrom || reportTo ? Array.from(campaignTotals.values()) : byProject(list(data.metrics?.campaigns));
    const metric = (...keys: string[]) => { const metrics = data.metrics ?? {}; if (metrics.available === false)
        return '—'; const normalized = keys.includes('deliveries') ? 'deliveries' : keys.includes('unitsDelivered') ? 'unitsDelivered' : keys[0]; let value = get(metrics, ...keys); if (tab === 'reports' && (reportFrom || reportTo))
        value = ['participations', 'attempts', 'deliveries', 'tickets'].includes(normalized) ? dailyRows.reduce((total, row) => total + Number(row[normalized] ?? 0), 0) : undefined;
    else if (filter) {
        const row = list(metrics.byProject).find(p => get(p, 'projectId', 'project_id') === filter);
        value = row ? get(row, normalized, ...keys) : ['participations', 'attempts', 'deliveries', 'visits', 'tickets'].includes(normalized) ? list(metrics.campaigns).filter(c => get(c, 'projectId', 'project_id') === filter).reduce((total, row) => total + Number(row[normalized] ?? 0), 0) : undefined;
    } return value === undefined || value === null ? '—' : Number(value).toLocaleString('pt-BR'); };
    function downloadDaily() { const columns = ['day', 'campaign_name', 'modality', 'participations', 'attempts', 'deliveries', 'tickets']; const escape = (value: unknown) => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`; const csv = '\uFEFF' + [['Data', 'Evento', 'Modalidade', 'Participações', 'Tentativas', 'Entregas', 'Atendimentos assistidos'].map(escape).join(';'), ...dailyRows.map(row => columns.map(key => escape(key === 'modality' ? row[key] === 'physical' ? 'Presencial' : row[key] === 'dice' ? 'Dado' : row[key] === 'wheel' ? 'Roleta' : row[key] : row[key])).join(';'))].join('\r\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); const link = document.createElement('a'); link.href = url; link.download = 'proex-resumo-diario.csv'; link.click(); URL.revokeObjectURL(url); }
    const title = tabs.find(t => t.id === tab)?.label ?? 'Visão geral';
    if (!user.userId)
        return <main className="p-login">
        <div className="p-login-card">
        <div className="p-brand">
        <BrandMark variant="light"/>
        </div>
        <span className="p-eyebrow">GESTÃO DA EXTENSÃO</span>
        <h1>Um lugar para organizar o que acontece.</h1>
        <p>Entre para acessar seus projetos, eventos, materiais e empréstimos.</p>
        <a className="p-button p-button-primary" href={'/login'} target="_top">Entrar no portal <ArrowRight size={18}/>
        </a>
        <small>O acesso aos módulos depende das permissões da sua equipe.</small>
        <a className="p-text-link" href="https://role-da-extensao-ufg.yandiamantinobr.chatgpt.site/" target="_blank" rel="noreferrer">Abrir a roleta livre <ExternalLink size={14}/>
        </a>
        </div>
        </main>;
    if (!role || !capabilities.length)
        return <main className="p-no-access">
        <header>
        <BrandMark variant="auto"/>
        <ThemeSwitch />
        </header>
        <section className="p-card p-no-access-notice">
        <ShieldCheck size={25}/>
        <div>
        <h1>Sua conta está conectada.</h1>
        <p>Ainda não há uma permissão ativa para {user.email || 'esta conta'}. Abra o link do convite recebido ou solicite acesso ao responsável institucional.</p>
        <div className="p-inline">
        <button className="p-button p-button-primary" onClick={() => void refresh()} disabled={refreshing}>{refreshing && <LoaderCircle size={17} className="p-spin"/>}Verificar meu acesso</button>
        <button className="p-button p-button-subtle" disabled={busy} onClick={() => void logout()}>Sair e trocar de conta</button>
        </div>
        </div>
        </section>
        <ProfilePanel onUpdated={() => { void refresh(); }}/>
        </main>;
    return <div className="p-shell">
    <aside className="p-sidebar">
    <a className="p-brand" href="#main" aria-label="Início da gestão PROEX">
    <BrandMark variant="light"/>
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
    <BrandMark variant="light" showUfg={false}/>
    <span>Gestão</span>
    </div>
    <div className="p-breadcrumb">PROEX <ChevronRight size={14}/>
    <strong>{title}</strong>
    </div>
    <div className="p-topbar-actions">
    <button className="p-icon-button" title="Atualizar dados" aria-label="Atualizar dados" disabled={refreshing} onClick={() => void refresh()}>
    <RefreshCw size={18} className={refreshing ? 'p-spin' : ''}/>
    </button>
    <ThemeSwitch />
    <div className="p-account" ref={accountRef}>
    <button className="p-account-trigger" aria-label="Abrir menu da minha conta" aria-expanded={accountOpen} aria-controls="account-menu" onClick={() => setAccountOpen(v => !v)} onKeyDown={e => { if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAccountOpen(true);
        window.setTimeout(() => accountRef.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus(), 0);
    } }}>
    <span className="p-avatar" aria-hidden="true">{user.avatarUrl ? <Image src={user.avatarUrl} alt="" width={38} height={38} unoptimized/> : string(user.displayName || user.email || 'P').slice(0, 1).toUpperCase()}</span>
    <span className="p-user">
    <strong>{user.displayName || 'Minha conta'}</strong>
    <small>{roleNames[role] || 'Acesso da equipe'}</small>
    </span>
    <ChevronDown size={14}/>
    </button>{accountOpen && <div className="p-account-menu" id="account-menu" role="menu" aria-label="Minha conta" onKeyDown={e => { if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End')
            return; e.preventDefault(); const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]')); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }}>
        <div>
        <strong>{user.displayName || 'Minha conta'}</strong>
        <small>{user.email}</small>
        </div>
        <button role="menuitem" onClick={() => { setTab('profile'); setAccountOpen(false); }}>Minha conta e senha <Users size={16}/>
        </button>
        <button role="menuitem" disabled={busy} onClick={() => void logout()}>Sair e trocar de conta <LogOut size={16}/>
        </button>
        </div>}</div>
    </div>
    </header>
      <nav className="p-mobile-nav" aria-label="Módulos principais">{allowedTabs.filter(t => ['overview', 'events', 'materials', 'profile'].includes(t.id)).map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'is-active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
        <Icon size={17}/>
        <span>{label}</span>
        </button>)}<label className={`p-more-modules ${!['overview', 'events', 'materials', 'profile'].includes(tab) ? 'is-active' : ''}`}>
    <ChevronDown size={17}/>
    <span>Mais</span>
    <select aria-label="Todos os módulos" value={tab} onChange={e => setTab(e.target.value as Tab)}>{allowedTabs.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select>
    </label>
    </nav>
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
      {sessionExpired && <div className="p-notice p-notice-warning" role="status">
        <ShieldCheck size={18}/>
        <span>Sua sessão terminou. Preserve suas anotações e entre novamente.</span>
        <a className="p-button p-button-subtle" href="/login">Entrar</a>
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
      {message && <div className={`p-notice p-notice-${messageKind}`} role={messageKind === 'warning' ? 'alert' : 'status'}>
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

      {tab === 'projects' && <ProjectPanel projects={projects} selectedProjectId={filter} canCreate={canGlobal('projects.manage')} canEdit={id => canProject(id, 'campaigns.manage')} mutate={mutate} onSelect={id => { setFilter(id); setDraftProject(id); setTab('overview'); }}/>}

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
                </a>{canProject(get(c, 'projectId', 'project_id'), 'campaigns.manage') && <select aria-label={`Situação do evento ${c.name}`} value={c.status} disabled={busy || c.status === 'closed'} onChange={e => e.target.value === 'closed' ? setClosingCampaign(c.id) : void quick('campaign.status', { id: c.id, status: e.target.value })}>
                    <option value="draft" disabled>Rascunho</option>
                    <option value="active">Ativo</option>
                    <option value="paused">Pausado</option>
                    <option value="closed">Encerrado</option>
                    </select>}</div>{closingCampaign === c.id && <div className="p-inline-confirm">
                    <p>Encerrar este evento interrompe novas participações e preserva seu histórico. Depois, será necessário criar outro evento para uma nova ação.</p>
                    <div className="p-inline">
                    <button className="p-button p-button-danger" disabled={busy} onClick={() => void quick('campaign.status', { id: c.id, status: 'closed' }).then(() => setClosingCampaign(null))}>Confirmar encerramento</button>
                    <button className="p-button p-button-subtle" disabled={busy} onClick={() => setClosingCampaign(null)}>Voltar</button>
                    </div>
                    </div>}{c.status === 'draft' && canProject(get(c, 'projectId', 'project_id'), 'campaigns.manage') && <details className="p-event-edit">
                    <summary>Editar rascunho <ChevronDown size={15}/>
                    </summary>
                    <CampaignForm projects={projects.filter(p => canProject(p.id, 'campaigns.manage'))} offers={offers} initial={c} mutate={mutate}/>
                    </details>}</article>)}</div> : <Empty title="Nenhum evento cadastrado" text="Prepare um evento para definir regras, acompanhar participações e conectar as ofertas de brindes." icon={CalendarDays}/>}</Section>{can('participation.operate') && <Section title="Operação presencial" description="A equipe acompanha o resultado e utiliza as mesmas regras de participação da campanha.">
            <PhysicalAttendance campaigns={visibleCampaigns.filter(c => canProject(get(c, 'projectId', 'project_id'), 'participation.operate'))} tickets={byProject(list(data.physicalTickets))} mutate={mutate}/>
            </Section>}{can('participation.operate', 'inventory.deliver') && (byProject(list(data.pendingPrizes)).length > 0 || data.pendingPrizesTruncated) && <Section title="Prêmios aguardando entrega" description="Reservas que continuam disponíveis após atualizar a página. Confirme a entrega somente depois de conferir o código.">{data.pendingPrizesTruncated && <div className="p-notice p-notice-warning">
                <Gift size={17}/>
                <span>A fila mostra até {data.pendingPrizesLimit || 200} reservas recentes. Há {data.pendingPrizesTotal} no seu acesso completo. Use o código da pessoa em Retirada de brinde para localizar uma entrega que não esteja nesta lista.</span>
                </div>}<PendingPrizes prizes={byProject(list(data.pendingPrizes))} mutate={mutate}/>
            </Section>}{can('participation.operate', 'inventory.deliver') && <Section title="Retirada de brinde" description="Confirme o registro no servidor antes de entregar os materiais. Códigos já entregues serão sinalizados.">
            <OperationForm action="prize.redeem" make={f => ({ code: f.get('code') })} mutate={mutate} submit="Confirmar entrega" compact>
            <Field label="Código de retirada">
            <input name="code" autoComplete="off" required placeholder="Cole ou digite o código apresentado"/>
            </Field>
            </OperationForm>
            </Section>}{can('campaigns.manage') && projects.length > 0 && <Section title="Preparar evento" description="O evento será criado como rascunho. Regras e estoque precisam estar completos para ativar.">
            <CampaignForm key={`campaign-create-${filter}`} projects={formProjects} offers={offers} defaultProject={effectiveProject} mutate={mutate}/>
            </Section>}</>}

      {tab === 'materials' && <>
        {editingItem && <ItemEditor key={editingItem.id} item={editingItem} mutate={mutate} close={() => setEditingItem(null)}/>}
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
            <th>Ações</th>
            </tr>
            </thead>
            <tbody>{searchItems.map(i => <tr key={i.id}>
                <td>
                <strong>{i.name}</strong>
                <small>{categoryNames[i.category] || i.category} · {projectName(get(i, 'projectId', 'project_id'))}</small>{(i.asset_code || i.assetCode) && <small>Código: {i.asset_code || i.assetCode}</small>}{i.condition !== 'active' && <span className="p-badge p-status-paused">{i.condition === 'maintenance' ? 'Em manutenção' : 'Inativo'}</span>}
                </td>
                <td>{i.stock ?? i.quantity ?? 0}<small>{i.unit || 'unidade'}</small>
                </td>
                <td>{i.reserved ?? 0}</td>
                <td>
                <span className={available(i) <= Number(get(i, 'lowStock', 'low_stock') ?? 0) ? 'p-low' : 'p-available'}>{available(i)}</span>
                </td>
                <td>{canProject(get(i, 'projectId', 'project_id'), 'inventory.manage') && <button className="p-button p-button-subtle" onClick={() => setEditingItem(i)}>Editar</button>}</td>
                </tr>)}</tbody>
            </table>
            </div> : <Empty title={query ? 'Nenhum material encontrado' : 'Seu catálogo ainda está vazio'} text={query ? 'Tente outro nome ou selecione outro projeto.' : 'Cadastre os materiais e registre o recebimento após conferir a quantidade real.'}/>}</Section>{can('inventory.manage') && projects.length > 0 && <div className="p-two-columns">
            <Section title="Cadastrar material" description="O cadastro começa sem saldo. Registre o recebimento depois da contagem.">
            <OperationForm onProjectFocus={setDraftProject} action="item.create" mutate={mutate} submit="Cadastrar material" make={f => ({ projectId: f.get('projectId'), name: f.get('name'), category: f.get('category'), unit: f.get('unit'), lowStock: Number(f.get('lowStock')), description: f.get('description'), assetCode: f.get('assetCode') })}>
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
            <Field label="Identificação patrimonial ou código">
            <input name="assetCode" maxLength={100} placeholder="Opcional; identifica cada equipamento"/>
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
            <option value="">Selecione o material</option>{visibleItems.filter(i => canProject(get(i, 'projectId', 'project_id'), 'inventory.manage')).map(i => <option value={i.id} key={i.id}>{i.name} · {projectName(get(i, 'projectId', 'project_id'))}</option>)}</select>
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
                    </div>)}</div>}<OperationForm onProjectFocus={setDraftProject} action="offer.create" mutate={mutate} submit="Criar oferta" make={f => ({ projectId: f.get('projectId'), name: f.get('name'), kind: f.get('kind'), components: Array.from({ length: offerRows }, (_, n) => ({ itemId: f.get(`componentItem${n}`), quantity: Number(f.get(`componentQty${n}`)) })).filter(x => x.itemId) })}>
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
                        </a>)}{canProject(get(l, 'projectId', 'project_id'), 'loans.manage', 'loans.checkout') && <LoanAttachment loanId={l.id} onSaved={refresh}/>}{canProject(get(l, 'projectId', 'project_id'), 'loans.manage', 'loans.checkout') && l.status !== 'returned' && l.status !== 'cancelled' && <OperationForm action="loan.status" mutate={mutate} submit="Registrar atualização" make={f => ({ id: l.id, status: f.get('status'), note: f.get('note') })}>
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
            <OperationForm onProjectFocus={setDraftProject} action="loan.create" mutate={mutate} submit="Confirmar reserva" make={f => ({ projectId: f.get('projectId'), itemId: f.get('itemId'), actionName: f.get('actionName'), borrowerName: f.get('borrowerName'), borrowerContact: f.get('borrowerContact'), startsAt: iso(f.get('startsAt')), endsAt: iso(f.get('endsAt')), note: f.get('note') })}>
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

      {tab === 'team' && <TeamPanel users={list(data.users)} members={members} invites={invites} projects={projects} selectedProjectId={filter} globalAdmin={canGlobal('organization.manage')} canProject={canProject} mutate={mutate} now={now}/>}
      {tab === 'profile' && <ProfilePanel onUpdated={() => { void refresh(); }}/>}
      {tab === 'calendar' && <CalendarPanel projects={projects}/>}
      {tab === 'records' && <RecordsPanel projects={projects} items={items} loans={loans} canWrite={(capability: string, projectId?: string | null) => projectId ? canProject(projectId, capability) : canGlobal(capability)}/>}

      {tab === 'reports' && <>
        <div className="p-card p-report-filters">
        <label className="p-field">
        <span>De</span>
        <input type="date" value={reportFrom} onChange={e => { setReportFrom(e.target.value); if (reportTo && e.target.value > reportTo)
            setReportTo(e.target.value); }}/>
        </label>
        <label className="p-field">
        <span>Até</span>
        <input type="date" value={reportTo} min={reportFrom || undefined} onChange={e => { setReportTo(e.target.value); if (e.target.value && reportFrom && e.target.value < reportFrom)
            setReportFrom(e.target.value); }}/>
        </label>
        <button className="p-button p-button-subtle" onClick={() => { setReportFrom(''); setReportTo(''); }}>Todo o período</button>
        <p>Datas operacionais de Brasília. Contagens de participação, tentativa e entrega usam a data de cada registro.</p>
        </div>
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
        <small>{reportFrom || reportTo ? 'Sem medição diária de unidades' : 'Quantidade física de itens'}</small>
        </div>
        </div>
        <div className="p-measures">
        <div className="p-card">
        <span>Carregamentos de páginas</span>
        <strong>{metric('visits')}</strong>
        <small>{reportFrom || reportTo ? 'Sem medição diária neste recorte' : 'Não são visitantes únicos'}</small>
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
        </div>{reportCampaignRows.length > 0 && <Section title="Resultados por evento" description="Contagens reais no projeto e no período selecionados.">
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
            <tbody>{reportCampaignRows.map(c => <tr key={c.id}>
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
            </Section>}<Section title="Resumo diário" description="Participações e entregas podem acontecer em dias diferentes." aside={<button className="p-button p-button-subtle" onClick={downloadDaily} disabled={!dailyRows.length}>
            <ArrowDownToLine size={16}/>Baixar este resumo</button>}>{dailyRows.length ? <div className="p-card p-table-wrap">
            <table>
            <thead>
            <tr>
            <th>Data e evento</th>
            <th>Modalidade</th>
            <th>Participações</th>
            <th>Tentativas</th>
            <th>Entregas</th>
            </tr>
            </thead>
            <tbody>{dailyRows.map((r, i) => <tr key={`${r.campaign_id}-${r.day}-${r.modality}-${i}`}>
                <td>
                <strong>{String(r.day).split('-').reverse().join('/')}</strong>
                <small>{r.campaign_name}</small>
                </td>
                <td>{r.modality === 'physical' ? 'Presencial' : r.modality === 'dice' ? 'Dado' : r.modality === 'wheel' ? 'Roleta' : r.modality}</td>
                <td>{r.participations}</td>
                <td>{r.attempts}</td>
                <td>{r.deliveries}</td>
                </tr>)}</tbody>
            </table>
            </div> : <Empty title="Sem registros neste período" text="Altere as datas ou o projeto para consultar outro recorte." icon={CalendarDays}/>}</Section>
        <Section title="Exportar registros completos" description="Arquivos completos do projeto selecionado. O resumo acima respeita também o filtro de datas.">
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
        <p>Gerencie seu nome, suas preferências e sua senha na aba Conta. O Instagram é um canal institucional; seguir o perfil não é verificado automaticamente.</p>
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
