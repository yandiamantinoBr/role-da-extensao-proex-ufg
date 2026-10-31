'use client';
import Image from 'next/image';
import scopeStyles from './scope-filters.module.css';
import settingsStyles from './settings-groups.module.css';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import PhysicalAttendance from '@/components/portal/physical-attendance';
import CampaignForm from '@/components/portal/campaign-form';
import PendingPrizes from '@/components/portal/pending-prizes';
import ProjectPanel from '@/components/portal/project-panel';
import AssistedImportPanel from '@/components/portal/assisted-import-panel';
import TeamPanel from '@/components/portal/team-panel';
import OfficialTeamDirectory from '@/components/portal/official-team-directory';
import OrganizationsPanel, { type OrganizationSummary, type OrganizationPerson } from '@/components/portal/organizations-panel';
import AssetDetailsPanel from '@/components/portal/asset-details-panel';
import AssistantPanel from '@/components/portal/assistant-panel';
import type { OfficialTeamSelection } from '@/lib/catalog/proex-team';
import AdminPrivacyPanel from '@/components/portal/admin-privacy-panel';
import SyncSettingsPanel from '@/components/portal/sync-settings-panel';
import CompleteBackupPanel from '@/components/portal/complete-backup-panel';
import BackupAutomationPanel from '@/components/portal/backup-automation-panel';
import PublicParticipantsSettingsPanel from '@/components/portal/public-participants-settings-panel';
import ProfilePanel from '@/components/portal/profile-panel';
import CalendarPanel from '@/components/portal/calendar-panel';
import RecordsPanel from '@/components/portal/records-panel';
import ReportsCenter from '@/components/portal/reports-center';
import FollowUpPanel from '@/components/portal/follow-up-panel';
import NotificationBell from '@/components/portal/notification-bell';
import OrganizationEmailSettings from '@/components/portal/organization-email-settings';
import MaterialDetailDrawer from '@/components/portal/material-detail-drawer';
import { ThemeSwitch } from '@/components/theme/theme-switch';
import { BrandMark } from '@/components/theme/brand-mark';
import DashboardPanel from '@/components/portal/dashboard-panel';
import { DesktopSidebar, MobileNavigation } from '@/components/portal/portal-navigation';
import { PORTAL_MODULES, type ModuleId } from '@/components/portal/navigation-model';
import { useNavigationPreferences } from '@/components/portal/use-navigation-preferences';
import { useFormDraft, DraftNotice, setDraftScope, clearCurrentDrafts, watchDraftLogout } from '@/components/portal/use-form-draft';
import { THEMATIC_AREAS, groupUnits } from '@/lib/extension-catalog';
import { MAX_UPLOAD_FILE_BYTES, UPLOAD_LIMIT_LABEL, uploadErrorMessage } from '@/lib/upload-limits';
import { ArrowDownToLine, ArrowRight, Boxes, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileText, Gift, LoaderCircle, LogOut, Plus, RefreshCw, Search, ShieldCheck, Truck, Users, Wifi, WifiOff, X } from 'lucide-react';
// API projections vary by module; the server validates every mutation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Snapshot = Row;
type Tab = ModuleId;
type Payload = Record<string, unknown>;
const tabs = PORTAL_MODULES;
const statusNames: Row = { draft: 'Rascunho', active: 'Ativo', paused: 'Pausado', closed: 'Encerrado', reserved: 'Reservado', out: 'Retirado', returned: 'Devolvido', cancelled: 'Cancelado', pending: 'Pendente', accepted: 'Aceito', revoked: 'Revogado' };
const roleNames: Row = { owner: 'Responsável institucional', manager: 'Gestor de projeto', operator: 'Operador de evento', inventory: 'Responsável por estoque', loans: 'Responsável por empréstimos', viewer: 'Leitor de relatórios' };
const categoryNames: Row = { gift: 'Brinde', equipment: 'Equipamento', distribution: 'Distribuição institucional', consumption: 'Consumo interno' };
const get = (r: Row, ...keys: string[]) => keys.map(k => r?.[k]).find(v => v !== undefined && v !== null);
const list = (value: unknown): Row[] => Array.isArray(value) ? value : [];
const string = (value: unknown) => value === null || value === undefined ? '' : String(value);
const when = (value: unknown, time = true) => { const d = new Date(value as string | number); return Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR', { dateStyle: 'short', ...(time ? { timeStyle: 'short' as const } : {}), timeZone: 'America/Sao_Paulo' }) : 'Não informado'; };
const iso = (value: FormDataEntryValue | null) => {
    if (!value) return null;
    const date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw new Error('Informe uma data e um horário válidos.');
    return date.toISOString();
};
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
function MaterialCategoryFields({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
    const [kind, setKind] = useState('gift');
    const [result, setResult] = useState<{ projectId: string; categories: Row[]; error: string } | null>(null);
    useEffect(() => {
        if (!projectId) return;
        const controller = new AbortController();
        let active = true;
        void fetch(`/api/materials?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
            const body = await response.json().catch(() => null) as Row | null;
            if (!response.ok || !body) throw new Error(readableError(body?.error, 'Não foi possível carregar as categorias deste projeto.'));
            if (active) setResult({ projectId, categories: list(body.categories), error: '' });
        }).catch(error => {
            if (active) setResult({ projectId, categories: [], error: readableError(error instanceof Error ? error.message : '', 'Não foi possível carregar as categorias. Verifique sua conexão.') });
        });
        return () => { active = false; controller.abort(); };
    }, [projectId, refreshKey]);
    const current = result?.projectId === projectId ? result : null;
    const categories = current?.categories.filter(category => category.core_kind === kind && category.status === 'active') ?? [];
    return <>
        <Field label="Tipo de material">
            <select name="category" value={kind} onChange={event => setKind(event.target.value)}>
                <option value="gift">Brinde</option>
                <option value="equipment">Equipamento retornável</option>
                <option value="distribution">Distribuição institucional</option>
                <option value="consumption">Consumo interno</option>
            </select>
        </Field>
        <Field label="Categoria do projeto" help={current?.error || (!projectId ? 'Selecione um projeto para consultar suas categorias.' : !current ? 'Carregando categorias…' : categories.length ? 'Opcional. Escolha uma categoria cadastrada para este tipo de material.' : 'Nenhuma categoria específica cadastrada. Você poderá criar uma nos detalhes do material.')}>
            <select key={`${projectId}-${kind}`} name="categoryId" defaultValue="" disabled={!current || !categories.length}>
                <option value="">Sem categoria específica</option>
                {categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
        </Field>
    </>;
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
function OperationForm({ action, make, mutate, children, submit = 'Salvar', onDone, compact = false, onProjectFocus, draftKey }: {
    action: string;
    /** Identifica o rascunho; por padrão, a própria ação. `null` desliga (ex.: configurações). */
    draftKey?: string | null;
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
    const formRef = useRef<HTMLFormElement>(null);
    const draft = useFormDraft(formRef, draftKey === undefined ? (action === 'setting.update' ? null : `operation:${action}`) : draftKey);
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
            draft.clear();
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
    return <form ref={formRef} className={`p-form${compact ? ' p-form-compact' : ''}`} onSubmit={send} onFocus={e => { const field = e.currentTarget.querySelector('select[name="projectId"]') as unknown as HTMLSelectElement | null; if (field?.value)
        onProjectFocus?.(field.value); }} onChange={() => {
            if (!saving)
                key.current = null;
        }}>
    <DraftNotice draft={draft}/><fieldset disabled={saving}>{children}<div className="p-form-footer">{error && <p className="p-inline-error" role="alert">{error}</p>}<button className="p-button p-button-primary" type="submit">{saving ? <LoaderCircle className="p-spin" size={18}/> : <Check size={18}/>}{saving ? 'Salvando…' : submit}</button>
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
        return; setMessage(''); setError(''); if (chosen.size > MAX_UPLOAD_FILE_BYTES || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(chosen.type)) {
        setError(`Escolha uma foto JPEG, PNG, WebP ou um PDF de até ${UPLOAD_LIMIT_LABEL}.`);
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
            throw new Error(readableError(uploadErrorMessage(response.status, result?.error, 'Não foi possível confirmar o anexo. Use Tentar novamente com o mesmo arquivo.'), 'Não foi possível confirmar o anexo.'));
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
    <small>Até {UPLOAD_LIMIT_LABEL}. O arquivo fica restrito à equipe autorizada.</small>
    </label>{file && <div className="p-file-ready">
        <p>
        <FileText size={15}/>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>
        <div className="p-inline">
        <button className="p-button p-button-primary" disabled={saving} onClick={() => void upload()}>{saving ? <LoaderCircle size={16} className="p-spin"/> : <Check size={16}/>}{saving ? 'Enviando…' : error ? 'Tentar novamente' : 'Anexar documento'}</button>
        <button className="p-button p-button-subtle" disabled={saving} onClick={() => { setFile(null); key.current = null; setError(''); }}>Descartar seleção</button>
        </div>
        </div>}{error && <p className="p-inline-error" role="alert">{error}</p>}{message && <p className="p-form-help" role="status">{message}</p>}</div>;
}
function PrizeKits({ projects, offers, items, projectId, onProjectChange, projectName, mutate }: {
    projects: Row[]; offers: Row[]; items: Row[]; projectId: string; onProjectChange: (id: string) => void;
    projectName: (id: unknown) => string; mutate: (action: string, data: Payload) => Promise<Row>;
}) {
    const [rows, setRows] = useState(1);
    return <Section title="Brindes e kits das dinâmicas" description="Defina a composição das entregas da roleta e do dado nos projetos que utilizam essa opção.">
        {offers.length > 0 ? <div className="p-kit-grid">{offers.map(offer => <article className="p-card p-kit-card" key={offer.id}>
            <div className="p-row-between"><span className="p-icon-tile"><Gift size={20} /></span><span className="p-badge">{offer.kind === 'super' ? 'Super Brinde' : 'Brinde'}</span></div>
            <h3>{offer.name}</h3><p>{projectName(get(offer, 'projectId', 'project_id'))}{Number(offer.active) === 0 ? ' · Inativo' : ''}</p>
            <ul>{list(offer.components).map(component => <li key={component.item_id}><strong>{component.quantity} ×</strong> {component.name}<small>{component.unit || 'unidade'}</small></li>)}</ul>
        </article>)}</div> : <Empty title="Nenhum brinde ou kit configurado" text="Monte uma entrega com os materiais já cadastrados no estoque deste projeto." icon={Gift} />}
        {projects.length > 0 && <div className="p-kit-create"><h3>Montar um brinde ou kit</h3><p>Uma entrega com três buttons baixa três unidades do estoque quando o prêmio é retirado.</p>
            <OperationForm action="offer.create" mutate={mutate} submit="Salvar composição" make={form => ({ projectId: form.get('projectId'), name: form.get('name'), kind: form.get('kind'), components: Array.from({ length: rows }, (_, index) => ({ itemId: form.get(`componentItem${index}`), quantity: Number(form.get(`componentQty${index}`)) })).filter(component => component.itemId) })}>
                <div className="p-form-grid">
                    {projects.length === 1 ? <div className="p-form-destination"><span>Projeto da dinâmica</span><strong>{projects[0].name}</strong><input type="hidden" name="projectId" value={projectId} /></div> : <Field label="Projeto da dinâmica"><select name="projectId" value={projectId} required onChange={event => onProjectChange(event.target.value)}><option value="">Selecione o projeto</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>}
                    <Field label="Nome do brinde ou kit"><input name="name" required maxLength={120} placeholder="Ex.: Kit com três buttons" /></Field>
                    <Field label="Resultado na dinâmica"><select name="kind"><option value="brinde">Brinde</option><option value="super">Super Brinde</option></select></Field>
                </div>
                <div className="p-components">{Array.from({ length: rows }, (_, index) => <div className="p-component-row" key={index}>
                    <Field label={`Material ${index + 1}`}><select key={`${projectId}-${index}`} name={`componentItem${index}`} required={index === 0} disabled={!projectId}><option value="">{projectId ? 'Selecione o material' : 'Escolha o projeto primeiro'}</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                    <Field label="Quantidade"><input name={`componentQty${index}`} type="number" min="1" max="1000" step="1" defaultValue="1" required /></Field>
                </div>)}<button type="button" className="p-text-link" disabled={rows >= 8} onClick={() => setRows(previous => previous + 1)}><Plus size={16} />Adicionar outro material</button></div>
                {projectId && !items.length && <p className="p-form-help">Este projeto ainda não tem materiais ativos do tipo Brinde. Cadastre os itens na área Catálogo e estoque antes de montar a composição.</p>}
            </OperationForm>
        </div>}
    </Section>;
}
export default function PortalClient({ initial }: {
    initial: Snapshot;
}) {
    const [data, setData] = useState<Snapshot>(initial ?? {});
    const sessionIdentity = useRef(string(initial?.user?.userId));
    const [tab, setTab] = useState<Tab>('overview');
    const [selectedDemandId, setSelectedDemandId] = useState('');
    const [reportInitialDataset, setReportInitialDataset] = useState<'projects' | 'demands'>('projects');
    const [accountOpen, setAccountOpen] = useState(false);
    const [officialSuggestion, setOfficialSuggestion] = useState<OfficialTeamSelection | null>(null);
    const [closingCampaign, setClosingCampaign] = useState<string | null>(null);
    const [reportFrom, setReportFrom] = useState(''), [reportTo, setReportTo] = useState('');
    const [sessionExpired, setSessionExpired] = useState(false);
    const accountRef = useRef<HTMLDivElement>(null);
    const [filter, setFilter] = useState('');
    const [unitFilter, setUnitFilter] = useState('');
    const [areaFilter, setAreaFilter] = useState('');
    const [draftProject, setDraftProject] = useState('');
    const [offerProject, setOfferProject] = useState('');
    const [materialsView, setMaterialsView] = useState<'catalog' | 'prizes'>('catalog');
    const [query, setQuery] = useState('');
    const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [online, setOnline] = useState(true);
    const [message, setMessage] = useState('');
    const [messageKind, setMessageKind] = useState<'success' | 'warning'>('success');
    const [failure, setFailure] = useState('');
    const [now, setNow] = useState(() => new Date(initial?.updatedAt ?? 0).getTime());
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
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
                const nextIdentity = string(body.user?.userId);
                if (nextIdentity && sessionIdentity.current && nextIdentity !== sessionIdentity.current) {
                    // A sessão pode ter sido trocada em outra aba. Descarte o
                    // contexto de formulários, planos e relatórios da conta anterior.
                    window.location.reload();
                    return false;
                }
                if (nextIdentity) sessionIdentity.current = nextIdentity;
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
    const refreshModules = useCallback(async () => { if (!await refresh()) throw new Error('A alteração pode estar salva. Atualize a página para conferir os dados atuais.'); }, [refresh]);
    useEffect(() => { const change = () => { setOnline(navigator.onLine); }; const timer = window.setTimeout(() => { setUpdatedAt(new Date()); setNow(Date.now()); change(); }, 0); const clock = window.setInterval(() => setNow(Date.now()), 60000); window.addEventListener('online', change); window.addEventListener('offline', change); return () => { window.clearTimeout(timer); window.clearInterval(clock); window.removeEventListener('online', change); window.removeEventListener('offline', change); }; }, []);
    // Links diretos (?module=…&project=…) esperam as permissões carregarem antes de serem descartados.
    const pendingLink = useRef<{ tab: string; project: string } | null>(null);
    useEffect(() => { const url = new URL(window.location.href); const candidate = url.searchParams.get('demandId') || ''; const demandId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(candidate) ? candidate : ''; const requested = url.searchParams.get('module') || (demandId ? 'demands' : ''); pendingLink.current = { tab: requested && tabs.some(t => t.id === requested) ? requested : '', project: url.searchParams.get('project') || '' }; const timer = window.setTimeout(() => { if (tabs.some(t => t.id === requested))
        setTab(requested as Tab); setSelectedDemandId(demandId); setFilter(url.searchParams.get('project') || ''); setUnitFilter(url.searchParams.get('unit') || ''); setAreaFilter(url.searchParams.get('area') || ''); }, 0); return () => window.clearTimeout(timer); }, []);
    useEffect(() => { const url = new URL(window.location.href); if (tab === 'overview')
        url.searchParams.delete('module');
    else
        url.searchParams.set('module', tab); if (filter)
        url.searchParams.set('project', filter);
    else
        url.searchParams.delete('project'); if (unitFilter) url.searchParams.set('unit', unitFilter); else url.searchParams.delete('unit'); if (areaFilter) url.searchParams.set('area', areaFilter); else url.searchParams.delete('area'); if (tab === 'demands' && selectedDemandId) url.searchParams.set('demandId', selectedDemandId); else url.searchParams.delete('demandId'); window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`); }, [tab, filter, unitFilter, areaFilter, selectedDemandId]);
    useEffect(() => { const update = () => { if (navigator.onLine && !document.hidden)
        void refresh(); }; const timer = window.setInterval(update, 30000); window.addEventListener('online', update); document.addEventListener('visibilitychange', update); return () => { window.clearInterval(timer); window.removeEventListener('online', update); document.removeEventListener('visibilitychange', update); }; }, [refresh]);
    useEffect(() => { if (!accountOpen)
        return; const close = (e: PointerEvent) => { if (!accountRef.current?.contains(e.target as Node))
        setAccountOpen(false); }; const keyboard = (e: KeyboardEvent) => { if (e.key === 'Escape') {
        setAccountOpen(false);
        accountRef.current?.querySelector<HTMLButtonElement>('.p-account-trigger')?.focus();
    } }; document.addEventListener('pointerdown', close); document.addEventListener('keydown', keyboard); return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', keyboard); }; }, [accountOpen]);
    const projects = list(data.projects), campaigns = list(data.campaigns), items = list(data.items), offers = list(data.offers), loans = list(data.loans);
    const members = list(data.members), invites = list(data.invites), documents = list(data.documents);
    const organizations = useMemo<OrganizationSummary[]>(() => list(data.organizations).map(organization => ({
        id: string(organization.id), name: string(organization.name), slug: string(organization.slug),
        status: string(organization.status), version: Number(organization.version) || 1, canManage: organization.canManage === true,
    })), [data.organizations]);
    const organizationPeople = useMemo<OrganizationPerson[]>(() => list(data.users).map(person => ({
        userId: string(person.userId), displayName: string(person.displayName) || 'Integrante', email: string(person.email) || null,
        status: string(person.status), activationPending: Boolean(get(person, 'activationPending', 'activation_pending')),
        anonymizedAt: string(get(person, 'anonymizedAt', 'anonymized_at')) || null,
    })), [data.users]);
    const user = data.user ?? {};
    const role = string(data.role);
    const capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
    const globalCapabilities: string[] = Array.isArray(data.globalCapabilities) ? data.globalCapabilities : role === 'owner' ? capabilities : [];
    const projectCapabilities = data.capabilitiesByProject ?? null;
    const canGlobal = (...needed: string[]) => globalCapabilities.includes('*') || needed.some(c => globalCapabilities.includes(c));
    const canProject = (id: string, ...needed: string[]) => canGlobal(...needed) || Boolean(projectCapabilities ? needed.some(c => (projectCapabilities[id] ?? []).includes(c)) : role === 'owner' || needed.some(c => capabilities.includes(c)));
    const canAny = (...needed: string[]) => canGlobal(...needed) || projects.some(p => canProject(p.id, ...needed));
    const assistantProjects = projects.filter(project => canProject(project.id, 'inventory.read')).map(project => ({ id: string(project.id), name: string(project.name), organization_id: string(project.organization_id) }));
    const isPlatformOwner = canGlobal('organization.manage');
    const canManageOrganization = organizations.some(organization => organization.canManage);
    const canCreateProjects = canGlobal('projects.manage') || organizations.some(organization => organization.canManage && organization.status === 'active');
    const canFollowUp = canManageOrganization || projects.length > 0;
    const organizationalUnits = list(data.organizationalUnits);
    const unitOf = (project: Row) => string(get(project, 'unit_id', 'unitId'));
    const accessibleUnitIds = new Set(projects.map(unitOf).filter(Boolean));
    const visibleUnits = organizationalUnits.filter(unit => canGlobal('organization.manage') || accessibleUnitIds.has(string(unit.id)));
    const hasUnassignedProjects = projects.some(project => !unitOf(project));
    const areaOf = (project: Row) => string(get(project, 'thematic_area', 'thematicArea'));
    const inUnit = (project: Row, unit = unitFilter) => !unit || (unit === '__unassigned__' ? !unitOf(project) : unitOf(project) === unit);
    const inArea = (project: Row, area = areaFilter) => !area || (area === '__none__' ? !areaOf(project) : areaOf(project) === area);
    // Filtros relacionados: cada lista mostra a contagem considerando os outros filtros já escolhidos.
    const scopedProjects = projects.filter(project => inUnit(project) && inArea(project));
    const unitCounts = new Map<string, number>(), areaCounts = new Map<string, number>();
    for (const project of projects) {
        if (inArea(project)) unitCounts.set(unitOf(project) || '__unassigned__', (unitCounts.get(unitOf(project) || '__unassigned__') ?? 0) + 1);
        if (inUnit(project)) areaCounts.set(areaOf(project) || '__none__', (areaCounts.get(areaOf(project) || '__none__') ?? 0) + 1);
    }
    const unitGroups = groupUnits(visibleUnits.map(unit => ({ ...unit, name: string(unit.name), group_label: string(unit.group_label) }) as Row & { name: string; group_label: string }));
    const selectedProjects = filter ? scopedProjects.filter(project => project.id === filter) : scopedProjects;
    const selectedProjectIds = new Set(selectedProjects.map(project => string(project.id)));
    const can = (...needed: string[]) => canGlobal(...needed) || selectedProjects.some(project => canProject(project.id, ...needed));
    const byProject = (rows: Row[]) => filter || unitFilter || areaFilter ? rows.filter(row => selectedProjectIds.has(string(get(row, 'projectId', 'project_id')))) : rows;
    const visibleCampaigns = byProject(campaigns), visibleItems = byProject(items), visibleLoans = byProject(loans);
    const projectName = (id: unknown) => projects.find(p => p.id === id)?.name || 'PROEX';
    const prizeProjects = selectedProjects.filter(project => Number(project.prizes_enabled ?? project.prizesEnabled) === 1 || offers.some(offer => get(offer, 'projectId', 'project_id') === project.id));
    const prizeProjectIds = new Set(prizeProjects.map(project => string(project.id)));
    const offerProjects = prizeProjects.filter(project => canProject(project.id, 'inventory.manage'));
    const effectiveOfferProject = offerProjects.some(project => project.id === (filter || offerProject)) ? filter || offerProject : offerProjects.length === 1 ? string(offerProjects[0].id) : '';
    const offerItems = items.filter(item => get(item, 'projectId', 'project_id') === effectiveOfferProject && item.category === 'gift' && item.condition === 'active');
    const visibleOffers = byProject(offers).filter(offer => prizeProjectIds.has(string(get(offer, 'projectId', 'project_id'))));
    const showPrizeView = materialsView === 'prizes' && prizeProjects.length > 0;
    const formCapability = tab === 'loans' ? 'loans.manage' : tab === 'events' ? 'campaigns.manage' : 'inventory.manage';
    const formProjects = (tab === 'events' ? prizeProjects : selectedProjects).filter(p => canProject(p.id, formCapability));
    const selectedFormProject = draftProject || filter;
    const effectiveProject = formProjects.some(p => p.id === selectedFormProject) ? selectedFormProject : formProjects.length === 1 ? string(formProjects[0].id) : '';
    const formItems = items.filter(i => effectiveProject && get(i, 'projectId', 'project_id') === effectiveProject);
    const available = (item: Row) => item.available !== undefined && item.available !== null ? Number(item.available) : Number(item.stock ?? item.quantity ?? 0) - Number(item.reserved ?? 0);
    const searchItems = visibleItems.filter(i => !query || `${i.name} ${i.description ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
    const allowedTabs = tabs.filter(t => ['overview', 'projects', 'profile', 'calendar', 'records'].includes(t.id) || (t.id === 'events' && canAny('campaigns.manage', 'participation.operate', 'inventory.deliver')) || (t.id === 'materials' && canAny('inventory.read', 'inventory.manage', 'inventory.deliver')) || (t.id === 'loans' && canAny('loans.read', 'loans.manage', 'loans.checkout')) || (t.id === 'demands' && canFollowUp) || (t.id === 'team' && (canManageOrganization || canAny('access.invite', 'access.manage'))) || (t.id === 'reports' && (canFollowUp || canAny('reports.read'))) || (t.id === 'settings' && canGlobal('organization.manage')));
    const allowedModuleKey = allowedTabs.map(module => module.id).join('|');
    const accessibleProjectKey = scopedProjects.map(project => project.id).join('|');
    const accessibleUnitKey = [...visibleUnits.map(unit => string(unit.id)), ...(hasUnassignedProjects ? ['__unassigned__'] : [])].join('|');
    useEffect(() => { if (allowedModuleKey.split('|').includes(tab)) return; const timer = window.setTimeout(() => setTab('overview'), 0); return () => window.clearTimeout(timer); }, [allowedModuleKey, tab]);
    useEffect(() => { const link = pendingLink.current; if (!link) return; const timer = window.setTimeout(() => { if (link.tab && allowedModuleKey.split('|').includes(link.tab)) { setTab(link.tab as Tab); link.tab = ''; } if (link.project && accessibleProjectKey.split('|').includes(link.project)) { setFilter(link.project); setDraftProject(link.project); link.project = ''; } if (!link.tab && !link.project) pendingLink.current = null; }, 0); return () => window.clearTimeout(timer); }, [allowedModuleKey, accessibleProjectKey]);
    useEffect(() => { if (!filter || accessibleProjectKey.split('|').includes(filter)) return; const timer = window.setTimeout(() => { setFilter(''); setDraftProject(''); }, 0); return () => window.clearTimeout(timer); }, [accessibleProjectKey, filter]);
    useEffect(() => { if (!unitFilter || accessibleUnitKey.split('|').includes(unitFilter)) return; const timer = window.setTimeout(() => { setUnitFilter(''); setFilter(''); setDraftProject(''); }, 0); return () => window.clearTimeout(timer); }, [accessibleUnitKey, unitFilter]);
    const navigation = useNavigationPreferences(string(user.userId), allowedTabs.map(module => module.id));
    setDraftScope(string(user.userId));
    const draftUserId = string(user.userId);
    useEffect(() => watchDraftLogout(draftUserId), [draftUserId]);
    function navigate(id: ModuleId) {
        if (!allowedTabs.some(module => module.id === id)) return;
        pendingLink.current = null;
        if (id !== tab) navigation.recordVisit(id);
        setTab(id); setQuery(''); setAccountOpen(false); setSelectedMaterialId(null);
        window.requestAnimationFrame(() => { document.getElementById('main')?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'auto' }); });
    }
    function selectProject(id: string) { const project = projects.find(row => row.id === id); if (id && !project) return; if (project && unitFilter && unitOf(project) !== unitFilter) setUnitFilter(unitOf(project) || '__unassigned__'); if (project && areaFilter && !inArea(project)) setAreaFilter(''); setFilter(id); setDraftProject(id); setOfferProject(''); }
    function selectUnit(id: string) { setUnitFilter(id); setFilter(''); setDraftProject(''); setOfferProject(''); setQuery(''); }
    function selectArea(key: string) { setAreaFilter(key); setFilter(''); setDraftProject(''); setOfferProject(''); }
    function clearScope() { setAreaFilter(''); selectUnit(''); }
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
            clearCurrentDrafts();
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Reload clears private client data after the session cookie is removed.
            window.location.assign('/login');
        }
        catch (e) {
            setFailure(e instanceof Error ? e.message : 'Não foi possível sair.');
            setBusy(false);
        }
    }
    const projectField = effectiveProject && formProjects.length === 1 ? <div className="p-form-destination"><span>Projeto do registro</span><strong>{projectName(effectiveProject)}</strong><input type="hidden" name="projectId" value={effectiveProject} /></div> : <Field label="Projeto do registro">
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
    } else if (unitFilter) {
        const rows = byProject(list(metrics.byProject));
        value = rows.length && rows.every(row => get(row, normalized, ...keys) !== undefined) ? rows.reduce((total, row) => total + Number(get(row, normalized, ...keys) ?? 0), 0) : undefined;
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
    return <div className={`p-shell pn-shell ${navigation.collapsed ? 'pn-is-collapsed' : ''} ${navigation.ready ? 'pn-navigation-ready' : ''}`}>
    <a className="p-skip-link" href="#main">Pular para o conteúdo</a>
    <DesktopSidebar modules={allowedTabs} active={tab} onNavigate={navigate} pinned={navigation.pinned} role={role} collapsed={navigation.collapsed} onToggle={navigation.toggleCollapsed} />
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
    <button className="p-icon-button p-refresh-button" title="Atualizar dados" aria-label="Atualizar dados" disabled={refreshing} onClick={() => void refresh()}>
    <RefreshCw size={18} className={refreshing ? 'p-spin' : ''}/>
    </button>
    {canFollowUp && <NotificationBell key={string(user.userId)} userId={string(user.userId)} onSelectTask={id => { setSelectedDemandId(id); setFilter(''); setUnitFilter(''); setAreaFilter(''); navigate('demands'); }}/>}
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
        <button role="menuitem" onClick={() => { navigate('profile'); }}>Minha conta e senha <Users size={16}/>
        </button>
        <button role="menuitem" disabled={refreshing} onClick={() => { setAccountOpen(false); void refresh(); }}>Atualizar dados <RefreshCw size={16}/></button>
        <button role="menuitem" disabled={busy} onClick={() => void logout()}>Sair e trocar de conta <LogOut size={16}/>
        </button>
        </div>}</div>
    </div>
    </header>
      <MobileNavigation modules={allowedTabs} active={tab} onNavigate={navigate} pinned={navigation.pinned} role={role} onTogglePin={navigation.togglePin} />
      <main className="p-main" id="main" tabIndex={-1}>
    <div className="p-page-heading">
    <div>
    <span className="p-eyebrow">GESTÃO DA EXTENSÃO</span>
    <h1>{tab === 'overview' ? `Olá, ${string(user.displayName).trim().split(/\s+/)[0] || 'equipe'}.` : title}</h1>
    <p>{tab === 'overview' ? 'Seu início, seus projetos e o que precisa da sua atenção.' : tabs.find(module => module.id === tab)?.description}</p>
    </div>
    </div>
    {['overview', 'materials', 'loans', 'events', 'reports'].includes(tab) && <section className={`p-scope-filters ${scopeStyles.scope}`} aria-label="Filtrar registros por unidade, área temática e projeto">
        <div className={scopeStyles.layout}>
        <Field label="Projeto">
            <select value={filter} onChange={event => selectProject(event.target.value)}>
                <option value="">{scopedProjects.length === projects.length ? 'Todos os projetos' : `Todos os ${scopedProjects.length} projeto(s) deste recorte`}</option>
                {scopedProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
        </Field>
        {(filter || unitFilter || areaFilter) && <button type="button" className={`p-button p-button-subtle p-filter-clear ${scopeStyles.clear}`} onClick={clearScope}><X size={15} />Limpar filtros</button>}
        <details className={scopeStyles.refine}>
            <summary>Refinar contexto
                {(unitFilter || areaFilter) && <span className={scopeStyles.active}>{[unitFilter ? (unitFilter === '__unassigned__' ? 'Sem unidade vinculada' : string(visibleUnits.find(unit => unit.id === unitFilter)?.acronym || visibleUnits.find(unit => unit.id === unitFilter)?.name) || 'Unidade selecionada') : '', areaFilter ? (areaFilter === '__none__' ? 'Área não informada' : THEMATIC_AREAS.find(area => area.key === areaFilter)?.label || 'Área selecionada') : ''].filter(Boolean).join(' · ')}</span>}
            </summary>
            <div className={scopeStyles.fields}>
        <Field label="Unidade responsável">
            <select value={unitFilter} onChange={event => selectUnit(event.target.value)}>
                <option value="">Todas as unidades ({projects.filter(project => inArea(project)).length})</option>
                {unitGroups.map(group => <optgroup key={group.group} label={group.group}>{group.units.map(unit => <option key={unit.id} value={unit.id}>{unit.acronym ? `${unit.acronym} · ` : ''}{unit.name}{unit.status === 'archived' ? ' (arquivada)' : ''} ({unitCounts.get(string(unit.id)) ?? 0})</option>)}</optgroup>)}
                {hasUnassignedProjects && <option value="__unassigned__">Sem unidade vinculada ({unitCounts.get('__unassigned__') ?? 0})</option>}
            </select>
        </Field>
        <Field label="Área temática">
            <select value={areaFilter} onChange={event => selectArea(event.target.value)}>
                <option value="">Todas as áreas ({projects.filter(project => inUnit(project)).length})</option>
                {THEMATIC_AREAS.map(area => <option key={area.key} value={area.key} disabled={!areaCounts.get(area.key) && areaFilter !== area.key}>{area.label} ({areaCounts.get(area.key) ?? 0})</option>)}
                {areaCounts.get('__none__') ? <option value="__none__">Área não informada ({areaCounts.get('__none__')})</option> : null}
            </select>
        </Field>
            </div>
        </details>
        </div>
    </section>}
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

      {tab === 'demands' && <><FollowUpPanel key={string(user.userId)} defaultProjectId={filter} initialTaskId={selectedDemandId} onSelectTask={setSelectedDemandId} onChanged={refreshModules} onOpenReports={() => { setReportInitialDataset('demands'); navigate('reports'); }}/><OrganizationEmailSettings key={string(user.userId)} userId={string(user.userId)} organizations={organizations}/></>}
      {tab === 'overview' && <DashboardPanel modules={allowedTabs} pinned={navigation.pinned} frequent={navigation.frequent} onNavigate={navigate} onTogglePin={navigation.togglePin} displayName={string(user.displayName)} role={role} roleLabel={roleNames[role] || 'Equipe PROEX'} projects={scopedProjects} items={visibleItems} loans={visibleLoans} campaigns={visibleCampaigns} selectedProjectId={filter} unitName={unitFilter === '__unassigned__' ? 'Sem unidade vinculada' : string(visibleUnits.find(unit => unit.id === unitFilter)?.acronym || visibleUnits.find(unit => unit.id === unitFilter)?.name)} now={now} onSelectProject={selectProject} known={{ projects: Array.isArray(data.projects), items: Array.isArray(data.items), loans: Array.isArray(data.loans), campaigns: Array.isArray(data.campaigns) }} />}

      {tab === 'projects' && <>
        <AssistedImportPanel kind="project" organizations={organizations} projects={projects.map(project => ({ id: string(project.id), name: string(project.name), organization_id: string(get(project, 'organization_id', 'organizationId')), version: Number(project.version ?? 1) }))} projectTypes={list(data.projectTypes).map(type => ({ id: string(type.id), label: string(type.label) }))} organizationalUnits={organizationalUnits.map(unit => ({ id: string(unit.id), name: string(unit.name), acronym: string(unit.acronym) }))} canCreateProject={canCreateProjects} canWrite={id => canProject(id, 'campaigns.manage')} defaultProjectId={filter} onImported={refreshModules}/>
        <ProjectPanel organizations={organizations} isPlatformOwner={isPlatformOwner} projects={projects} projectTypes={list(data.projectTypes)} organizationalUnits={organizationalUnits} canCreate={canCreateProjects} canEdit={id => canProject(id, 'campaigns.manage')} mutate={mutate} onSelect={id => { selectProject(id); navigate('overview'); }}/>
      </>}

      {tab === 'events' && <>
        <Section title="Roleta e dado" description="Prepare as regras, os brindes e o atendimento das dinâmicas de cada ação.">{visibleCampaigns.length ? <div className="p-event-grid">{visibleCampaigns.map(c => <article className="p-card p-event-card" key={c.id}>
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
                    </details>}</article>)}</div> : <Empty title="Nenhuma dinâmica cadastrada" text="As campanhas de roleta e dado dos projetos selecionados aparecerão aqui." icon={CalendarDays}/>}</Section>{can('participation.operate') && <Section title="Operação presencial" description="A equipe acompanha o resultado e utiliza as mesmas regras de participação da campanha.">
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
            </Section>}{can('campaigns.manage') && formProjects.length > 0 && <Section title="Preparar dinâmica" description="A campanha começa como rascunho. Confira as regras e os brindes antes de ativar.">
            <CampaignForm key={`campaign-create-${unitFilter}-${filter}`} projects={formProjects} offers={offers} defaultProject={effectiveProject} mutate={mutate}/>
            </Section>}{can('campaigns.manage') && !prizeProjects.length && <div className="p-explainer"><Gift size={22} /><div><h3>Quais projetos usam roleta e dado?</h3><p>No cadastro do projeto, marque “Habilitar dinâmicas e brindes” para preparar campanhas e compor os kits desta área.</p><button type="button" className="p-text-link" onClick={() => navigate('projects')}>Abrir projetos <ArrowRight size={15} /></button></div></div>}</>}

      {tab === 'materials' && <div className="p-materials-panel">
        <AssistantPanel key={string(user.userId)} projects={assistantProjects} defaultProjectId={filter} onApplied={refreshModules}/>
        <AssistedImportPanel kind="asset" organizations={organizations} projects={projects.map(project => ({ id: string(project.id), name: string(project.name), organization_id: string(get(project, 'organization_id', 'organizationId')), version: Number(project.version ?? 1) }))} items={items.map(item => ({ id: string(item.id), name: string(item.name), project_id: string(get(item, 'projectId', 'project_id')), asset_code: string(item.asset_code) }))} canWrite={id => canProject(id, 'inventory.manage')} defaultProjectId={filter} onImported={refreshModules}/>
        {prizeProjects.length > 0 && <nav className="p-material-tabs" aria-label="Áreas de materiais"><button type="button" aria-pressed={!showPrizeView} className={!showPrizeView ? 'is-active' : ''} onClick={() => setMaterialsView('catalog')}><Boxes size={18} />Catálogo e estoque</button><button type="button" aria-pressed={showPrizeView} className={showPrizeView ? 'is-active' : ''} onClick={() => setMaterialsView('prizes')}><Gift size={18} />Brindes e kits</button></nav>}
        <div hidden={showPrizeView}>
        {canAny('inventory.manage') && <details className="p-card"><summary className="p-text-link">Cadastrar um patrimônio individual</summary>{filter && canProject(filter, 'inventory.manage') ? <AssetDetailsPanel key={filter} itemId={null} projectId={filter} onSaved={refreshModules}/> : <p className="p-form-help">Selecione um projeto no filtro acima para cadastrar seu patrimônio, com documentos e conferência antes de salvar.</p>}</details>}
        <MaterialDetailDrawer itemId={selectedMaterialId} onClose={() => setSelectedMaterialId(null)} onChanged={refreshModules} />
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
                <button type="button" className="p-text-link" aria-label={`Abrir detalhes de ${i.name}`} onClick={() => setSelectedMaterialId(string(i.id))}><strong>{i.name}</strong></button>
                <small>{categoryNames[i.category] || i.category} · {projectName(get(i, 'projectId', 'project_id'))}</small>{(i.asset_code || i.assetCode) && <small>Código: {i.asset_code || i.assetCode}</small>}{i.condition !== 'active' && <span className="p-badge p-status-paused">{i.condition === 'maintenance' ? 'Em manutenção' : 'Inativo'}</span>}
                </td>
                <td>{i.stock ?? i.quantity ?? 0}<small>{i.unit || 'unidade'}</small>
                </td>
                <td>{i.reserved ?? 0}</td>
                <td>
                <span className={available(i) <= Number(get(i, 'lowStock', 'low_stock') ?? 0) ? 'p-low' : 'p-available'}>{available(i)}</span>
                </td>
                <td><button className="p-button p-button-subtle" onClick={() => setSelectedMaterialId(string(i.id))} aria-label={`Abrir detalhes de ${i.name}`}>Detalhes <ArrowRight size={15} /></button></td>
                </tr>)}</tbody>
            </table>
            </div> : <Empty title={query ? 'Nenhum material encontrado' : 'Seu catálogo ainda está vazio'} text={query ? 'Tente outro nome ou selecione outro projeto.' : 'Cadastre os materiais e registre o recebimento após conferir a quantidade real.'}/>}</Section>{can('inventory.manage') && formProjects.length > 0 && <div className="p-two-columns">
            <Section title="Cadastrar material" description="O cadastro começa sem saldo. Registre o recebimento depois da contagem.">
            <OperationForm onProjectFocus={setDraftProject} action="item.create" mutate={mutate} submit="Cadastrar material" make={f => ({ projectId: f.get('projectId'), name: f.get('name'), category: f.get('category'), categoryId: f.get('categoryId') || null, unit: f.get('unit'), lowStock: Number(f.get('lowStock')), description: f.get('description'), assetCode: f.get('assetCode') })}>
            <div className="p-form-grid">{projectField}<Field label="Nome">
            <input name="name" required maxLength={120} placeholder="Ex.: Button azul 2,5 cm"/>
            </Field>
            <MaterialCategoryFields projectId={effectiveProject} refreshKey={updatedAt?.getTime() ?? 0} />
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
            </div>}</div>
        {prizeProjects.length > 0 && <div hidden={!showPrizeView}><PrizeKits projects={offerProjects} offers={visibleOffers} items={offerItems} projectId={effectiveOfferProject} onProjectChange={setOfferProject} projectName={projectName} mutate={mutate} /></div>}
      </div>}

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
                })}</div> : <Empty title="Nenhuma reserva nos filtros selecionados" text="Cadastre o equipamento, confira a disponibilidade e registre a ação que fará a retirada." icon={Truck}/>}</Section>{can('loans.manage') && formProjects.length > 0 && <Section title="Reservar equipamento" description="Conflitos de horário e bens indisponíveis são conferidos antes da confirmação.">
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

      {tab === 'team' && <><OrganizationsPanel organizations={organizations} currentActor={{ userId: string(user.userId), isPlatformOwner }} people={organizationPeople} onChanged={refreshModules}/><OfficialTeamDirectory onSelect={canAny('access.invite') ? setOfficialSuggestion : undefined}/><TeamPanel key={officialSuggestion?.selectionKey ?? 'manual'} officialSuggestion={officialSuggestion} onClearOfficialSuggestion={() => setOfficialSuggestion(null)} users={list(data.users)} members={members} invites={invites} projects={projects} selectedProjectId={filter} globalAdmin={isPlatformOwner} canManageManagers={(projectId, organizationId) => isPlatformOwner || organizations.some(organization => organization.canManage && organization.id === (projectId ? projects.find(project => project.id === projectId)?.organization_id : organizationId))} canProject={canProject} mutate={mutate} now={now}/>{canGlobal('organization.manage') && <AdminPrivacyPanel />}</>}
      {tab === 'profile' && <><AssistantPanel key={string(user.userId)} projects={assistantProjects} defaultProjectId={filter} onApplied={refreshModules}/><ProfilePanel onUpdated={() => { void refresh(); }}/></>}
      {tab === 'calendar' && <CalendarPanel projects={projects} organizationalUnits={organizationalUnits}/>}
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
        <p>Período de todos os relatórios desta página, em datas de Brasília. Contagens de participação, tentativa e entrega usam a data de cada registro.</p>
        </div>
        <ReportsCenter initialDataset={canAny('reports.read') ? reportInitialDataset : 'demands'} projectId={filter} unitId={unitFilter} area={areaFilter} from={reportFrom} to={reportTo} available={[
          ...(projects.length ? ['projects' as const] : []),
          ...(canAny('inventory.read', 'reports.read') ? ['materials', 'movements', 'outflows'] as const : []),
          ...(canAny('inventory.read', 'loans.read', 'reports.read') ? ['outflow_details' as const] : []),
          ...(canAny('loans.read', 'reports.read') ? ['loans' as const] : []),
          ...(canAny('reports.read', 'inventory.read', 'loans.read') ? ['records' as const] : []),
          ...(canAny('reports.read', 'campaigns.manage') ? ['campaigns' as const] : []),
          ...(canFollowUp ? ['demands', 'reviews'] as const : []),
        ]}
          scopeLabel={[filter ? projectName(filter) : '', unitFilter ? (unitFilter === '__unassigned__' ? 'Sem unidade vinculada' : string(visibleUnits.find(unit => unit.id === unitFilter)?.acronym || visibleUnits.find(unit => unit.id === unitFilter)?.name)) : '', areaFilter ? (areaFilter === '__none__' ? 'Sem área temática' : THEMATIC_AREAS.find(item => item.key === areaFilter)?.label ?? '') : ''].filter(Boolean).join(' · ')} />
        <h2 className="p-reports-legacy-title">Indicadores das dinâmicas</h2>
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
        <span>Visitas históricas</span>
        <strong>{metric('visits')}</strong>
        <small>{data.metrics?.visitsCollection === 'paused' ? 'Coleta suspensa para preservar a disponibilidade; não representa o público atual.' : reportFrom || reportTo ? 'Sem medição diária neste recorte' : 'Não são visitantes únicos'}</small>
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
        {unitFilter && !filter && <p className="p-form-help">Para baixar os registros completos desta unidade, escolha um projeto no filtro acima. O CSV do resumo diário já reúne os projetos filtrados.</p>}
        <div className="p-export-grid">{[{ kind: 'participations', title: 'Participação nas dinâmicas', text: 'Modalidades, resultados e contagens por campanha.', icon: Users }, { kind: 'stock', title: 'Materiais e movimentos', text: 'Saldo, reservas e quantidade disponível por item.', icon: Boxes }, { kind: 'loans', title: 'Empréstimos', text: 'Agenda, etapas e devoluções pendentes.', icon: Truck }].map(({ kind, title: exportTitle, text, icon: Icon }) => {
            const content = <>
            <span className="p-icon-tile">
            <Icon size={22}/>
            </span>
            <h3>{exportTitle}</h3>
            <p>{text}</p>
            <span className="p-text-link">{unitFilter && !filter ? 'Escolha um projeto' : 'Baixar CSV'} <ArrowDownToLine size={16}/>
            </span>
            </>;
            return unitFilter && !filter ? <article className="p-card p-export-card p-export-unavailable" key={kind}>{content}</article> : <a className="p-card p-export-card" href={`/api/export?kind=${kind}${filter ? `&projectId=${encodeURIComponent(filter)}` : ''}`} key={kind}>{content}</a>;
        })}</div>
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

      {tab === 'settings' && <div className={settingsStyles.groups}>
        {canGlobal('organization.manage') && <>
          <details className={settingsStyles.group}>
            <summary><strong>Planilha e anexos</strong><small>Conexão, sincronização, arquivos no Drive e exportação portátil.</small></summary>
            <div className={settingsStyles.body}><SyncSettingsPanel includeBackups={false}/></div>
          </details>
          <details className={settingsStyles.group}>
            <summary><strong>Backup e recuperação</strong><small>Cópias completas cifradas, conferência da recuperação e rotina externa.</small></summary>
            <div className={settingsStyles.body}><CompleteBackupPanel/><BackupAutomationPanel/></div>
          </details>
          <details className={settingsStyles.group}>
            <summary><strong>Acesso público</strong><small>Prontidão, aviso e abertura explícita do cadastro de participantes.</small></summary>
            <div className={settingsStyles.body}><PublicParticipantsSettingsPanel canManage={canGlobal('organization.manage')} onChanged={refreshModules}/></div>
          </details>
        </>}
        <details className={settingsStyles.group}>
          <summary><strong>Operação e canais</strong><small>Canais institucionais e aviso de privacidade da operação.</small></summary>
          <div className={settingsStyles.body}>
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
          </div>
        </details>
      </div>}

      <footer className="p-footer">
    <span>{online ? <Wifi size={14}/> : <WifiOff size={14}/>}{online ? 'Conectado' : 'Sem conexão'}{updatedAt && ` · atualizado às ${updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}</span>
    <span>PROEX · Universidade Federal de Goiás</span>
    </footer>
      </main>
    </div>
  </div>;
}
