'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Building2, Check, LoaderCircle, Pencil, Plus, RefreshCw, ShieldCheck, UserMinus, UserPlus, X } from 'lucide-react';
import { DraftNotice, useFormDraft } from './use-form-draft';
import styles from './organizations-panel.module.css';

export type OrganizationSummary = { id: string; name: string; slug: string; status: string; version: number; canManage: boolean };
export type OrganizationPerson = { userId: string; displayName: string; email?: string | null; status?: string; activationPending?: boolean; anonymizedAt?: string | null };
type CurrentActor = { userId: string; isPlatformOwner: boolean };
type Member = { id: string; user_id: string; role: string; project_id: string | null; organization_id: string; revoked_at: string | null; status: string | null; activation_pending: number | null; anonymized: number; display_name: string | null };
type Detail = { organization: Omit<OrganizationSummary, 'canManage'>; members: Member[] };
type Props = { organizations: OrganizationSummary[]; currentActor: CurrentActor; people?: OrganizationPerson[]; onChanged: () => void | Promise<void> };
type Confirmation = { action: 'organization.admin.grant'; userId: string; label: string } | { action: 'organization.admin.revoke'; memberId: string; userId: string; label: string };
const EMPTY_PEOPLE: OrganizationPerson[] = [];

class OrganizationRequestError extends Error {
    constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
async function organizationRequest<T>(organizationId?: string, payload?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`/api/organizations${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`, {
        method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
        ...(payload ? { headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(payload) } : {}),
    });
    const result = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    if (!response.ok || !result) throw new OrganizationRequestError(result?.error || 'Não foi possível consultar as organizações. Tente novamente.', response.status, result?.code);
    return result as T;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir. Atualize e tente novamente.';
const isActive = (member: Member) => !member.revoked_at && (member.status ?? 'active') === 'active' && !member.activation_pending && !member.anonymized;

function OrganizationEditor({ organization, onSaved, onCancel, onReload }: {
    organization: Omit<OrganizationSummary, 'canManage'> | null;
    onSaved: (organization: Omit<OrganizationSummary, 'canManage'>) => void | Promise<void>;
    onCancel: () => void; onReload?: () => void;
}) {
    const [saving, setSaving] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
    const busy = useRef(false), formRef = useRef<HTMLFormElement>(null);
    const draft = useFormDraft(formRef, `organization:${organization?.id ?? 'new'}:${organization?.version ?? 0}`);
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy.current) return;
        const form = new FormData(event.currentTarget);
        busy.current = true; setSaving(true); setError(''); setConflict(false);
        try {
            const result = await organizationRequest<{ organization: Omit<OrganizationSummary, 'canManage'> }>(undefined, {
                action: organization ? 'organization.update' : 'organization.create',
                ...(organization ? { organizationId: organization.id, expectedVersion: organization.version } : { slug: String(form.get('slug') ?? '').trim() }),
                name: form.get('name'), status: form.get('status'),
            });
            draft.clear(); await onSaved(result.organization);
        } catch (error) {
            setError(errorText(error));
            setConflict(error instanceof OrganizationRequestError && error.status === 409);
        } finally { busy.current = false; setSaving(false); }
    }
    return <form ref={formRef} className={styles.editor} onSubmit={save}>
        <DraftNotice draft={draft}/>
        <fieldset disabled={saving}>
            <legend>{organization ? 'Editar organização' : 'Criar organização'}</legend>
            <div className={styles.formGrid}>
                <label className="p-field"><span>Nome da organização *</span><input name="name" required maxLength={160} defaultValue={organization?.name ?? ''} autoComplete="off" /></label>
                {!organization && <label className="p-field"><span>Identificação curta *</span><input name="slug" required minLength={2} maxLength={61} pattern="[a-z][a-z0-9-]{1,60}" autoComplete="off" placeholder="Ex.: unidade-parceira" /><small>Use letras minúsculas, números e hífens. A identificação permanece após a criação.</small></label>}
                <label className="p-field"><span>Situação</span><select name="status" defaultValue={organization?.status ?? 'active'}><option value="active">Ativa</option><option value="archived">Arquivada</option></select><small>Arquivar impede novos projetos e preserva os vínculos e o histórico.</small></label>
            </div>
            {error && <p className="p-inline-error" role="alert">{error}</p>}
            {conflict && onReload && <button type="button" className="p-button p-button-subtle" onClick={onReload}><RefreshCw size={16} />Recarregar versão atual</button>}
            <div className={styles.actions}><button type="button" className="p-button p-button-subtle" onClick={onCancel}>Cancelar</button><button type="submit" className="p-button p-button-primary">{saving ? <LoaderCircle className="p-spin" size={17} /> : <Check size={17} />}{saving ? 'Salvando…' : organization ? 'Salvar organização' : 'Criar organização'}</button></div>
        </fieldset>
    </form>;
}

function AdminConfirmation({ confirmation, organizationName, currentUserId, saving, error, onCancel, onConfirm }: {
    confirmation: Confirmation; organizationName: string; currentUserId: string; saving: boolean; error: string; onCancel: () => void; onConfirm: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null), titleId = useId(), descriptionId = useId();
    useEffect(() => { const element = dialog.current; if (element && !element.open) element.showModal(); }, []);
    const revoke = confirmation.action === 'organization.admin.revoke';
    function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
        if (event.key !== 'Tab') return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
        if (!buttons.length) { event.preventDefault(); event.currentTarget.focus(); return; }
        const destination = event.shiftKey && document.activeElement === buttons[0] ? buttons.at(-1) : !event.shiftKey && document.activeElement === buttons.at(-1) ? buttons[0] : null;
        if (destination) { event.preventDefault(); destination.focus(); }
    }
    return <dialog ref={dialog} className={styles.dialog} tabIndex={-1} aria-busy={saving} aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={containFocus} onCancel={event => { event.preventDefault(); if (!saving) onCancel(); }}>
        <h3 id={titleId}>{revoke ? 'Remover administração?' : 'Conceder administração?'}</h3>
        <p id={descriptionId}>{revoke ? <><strong>{confirmation.label}</strong> perderá a administração de <strong>{organizationName}</strong>. Outros acessos concedidos por projeto serão preservados.</> : <><strong>{confirmation.label}</strong> poderá criar projetos e gerir acessos somente em <strong>{organizationName}</strong>.</>}</p>
        {revoke && confirmation.userId === currentUserId && <p className={styles.notice}>Esta alteração remove sua própria administração desta organização.</p>}
        {error && <p className="p-inline-error" role="alert">{error}</p>}
        <div className={styles.actions}><button type="button" className="p-button p-button-subtle" autoFocus disabled={saving} onClick={onCancel}>Cancelar</button><button type="button" className="p-button p-button-primary" disabled={saving} onClick={onConfirm}>{saving ? <LoaderCircle className="p-spin" size={16} /> : <ShieldCheck size={16} />}{saving ? 'Confirmando…' : revoke ? 'Confirmar remoção' : 'Confirmar administração'}</button></div>
    </dialog>;
}

function OrganizationWorkspace({ organization, currentActor, people, onChanged, onSaved }: {
    organization: OrganizationSummary; currentActor: CurrentActor; people: OrganizationPerson[]; onChanged: () => Promise<void>; onSaved: (organization: Omit<OrganizationSummary, 'canManage'>) => Promise<void>;
}) {
    const [detail, setDetail] = useState<Detail | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
    const [revision, setRevision] = useState(0), [editing, setEditing] = useState(false), [selectedPerson, setSelectedPerson] = useState('');
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null), [saving, setSaving] = useState(false), [confirmationError, setConfirmationError] = useState(''), [message, setMessage] = useState('');
    const busy = useRef(false);
    useEffect(() => {
        const controller = new AbortController(); let active = true;
        organizationRequest<Detail>(organization.id, undefined, controller.signal).then(result => { if (active) { setDetail(result); setError(''); } }).catch(error => { if (active) { setDetail(null); setError(errorText(error)); } }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; controller.abort(); };
    }, [organization.id, organization.version, revision]);
    function reload() { setLoading(true); setError(''); setConfirmation(null); setRevision(value => value + 1); }
    const activeMembers = (detail?.members ?? []).filter(member => member.organization_id === organization.id && isActive(member));
    const administrators = activeMembers.filter(member => member.role === 'owner' && member.project_id === null);
    const adminUsers = new Set(administrators.map(member => member.user_id));
    const candidates = currentActor.isPlatformOwner
        ? people.filter(person => (person.status ?? 'active') === 'active' && !person.activationPending && !person.anonymizedAt && !adminUsers.has(person.userId))
        : [...new Map(activeMembers.filter(member => !adminUsers.has(member.user_id)).map(member => [member.user_id, { userId: member.user_id, displayName: member.display_name || 'Integrante sem nome' }])).values()];
    function ask(confirmation: Confirmation) { setConfirmationError(''); setConfirmation(confirmation); }
    async function confirm() {
        if (!confirmation || busy.current) return;
        busy.current = true; setSaving(true); setConfirmationError(''); setMessage('');
        try {
            await organizationRequest(undefined, { action: confirmation.action, organizationId: organization.id, ...(confirmation.action === 'organization.admin.grant' ? { userId: confirmation.userId } : { memberId: confirmation.memberId }), confirmed: true });
            setConfirmation(null); setSelectedPerson(''); setMessage(confirmation.action === 'organization.admin.grant' ? 'Administração concedida.' : 'Administração removida.');
            if (confirmation.action === 'organization.admin.revoke' && confirmation.userId === currentActor.userId) setDetail(null);
            else reload();
            await onChanged();
        } catch (error) { setConfirmationError(errorText(error)); }
        finally { busy.current = false; setSaving(false); }
    }
    return <section className={`p-card ${styles.workspace}`} aria-label={`Gestão de ${organization.name}`} aria-busy={loading}>
        <div className={styles.sectionHeading}><div><h3>{organization.name}</h3><p className="p-form-help">A administração e os acessos abaixo valem somente para esta organização.</p></div><div className={styles.actions}><button type="button" className="p-button p-button-subtle" disabled={loading || saving} onClick={reload}><RefreshCw size={16} />Atualizar</button><button type="button" className="p-button p-button-subtle" disabled={!detail || loading || saving} onClick={() => setEditing(value => !value)}><Pencil size={16} />Editar organização</button></div></div>
        {message && <p className={styles.notice} role="status">{message}</p>}
        {error && <p className="p-inline-error" role="alert">{error}</p>}
        {loading && <p className={styles.loading} role="status"><LoaderCircle className="p-spin" size={18} />Carregando administração…</p>}
        {detail && !loading && <>
            {editing && <OrganizationEditor key={`${detail.organization.id}:${detail.organization.version}`} organization={detail.organization} onSaved={async row => { setEditing(false); await onSaved(row); reload(); }} onCancel={() => setEditing(false)} onReload={reload} />}
            <div className={styles.adminHeading}><h4>Administradores</h4><span>{administrators.length} ativo(s)</span></div>
            {!administrators.length && <p className="p-form-help">Ainda não há administrador local. A administração da plataforma pode nomear uma pessoa abaixo.</p>}
            <ul className={styles.members}>{administrators.map(member => <li key={member.id}><span><strong>{member.display_name || 'Integrante sem nome'}{member.user_id === currentActor.userId ? ' (você)' : ''}</strong><small>Administração desta organização</small></span><button type="button" className="p-button p-button-subtle" disabled={saving || administrators.length < 2} aria-label={`Remover administração de ${member.display_name || 'integrante'}`} onClick={() => ask({ action: 'organization.admin.revoke', memberId: member.id, userId: member.user_id, label: member.display_name || 'Integrante sem nome' })}><UserMinus size={16} />Remover</button></li>)}</ul>
            {administrators.length === 1 && <p className="p-form-help">Mantenha outro administrador ativo antes de remover o último vínculo. O servidor também protege essa regra.</p>}
            <form className={styles.grant} onSubmit={event => { event.preventDefault(); const person = candidates.find(person => person.userId === selectedPerson); if (person) ask({ action: 'organization.admin.grant', userId: person.userId, label: person.displayName }); }}>
                <label className="p-field"><span>Nomear administrador</span><select name="administratorUserId" required value={selectedPerson} disabled={saving || organization.status !== 'active' || !candidates.length} onChange={event => setSelectedPerson(event.target.value)}><option value="">Selecione uma pessoa</option>{candidates.map(person => <option key={person.userId} value={person.userId}>{person.displayName}{'email' in person && person.email ? ` · ${person.email}` : ''}</option>)}</select><small>{organization.status !== 'active' ? 'Reative a organização para conceder nova administração.' : currentActor.isPlatformOwner ? 'Somente contas ativas. A confirmação nomeia administração local, sem acesso à plataforma.' : 'Somente pessoas ativas já vinculadas a esta organização.'}</small></label><button type="submit" className="p-button p-button-primary" disabled={saving || !selectedPerson || organization.status !== 'active'}><UserPlus size={16} />Revisar concessão</button>
            </form>
        </>}
        {confirmation && <AdminConfirmation confirmation={confirmation} organizationName={organization.name} currentUserId={currentActor.userId} saving={saving} error={confirmationError} onCancel={() => setConfirmation(null)} onConfirm={() => void confirm()} />}
    </section>;
}

export default function OrganizationsPanel({ organizations, currentActor, people = EMPTY_PEOPLE, onChanged }: Props) {
    const [local, setLocal] = useState<{ source: OrganizationSummary[]; rows: OrganizationSummary[] } | null>(null);
    const rows = local?.source === organizations ? local.rows : organizations;
    const [selectedId, setSelectedId] = useState(''), [creating, setCreating] = useState(false), [query, setQuery] = useState(''), [notice, setNotice] = useState('');
    const selected = rows.find(row => row.id === selectedId) ?? (rows.length === 1 ? rows[0] : undefined);
    const refresh = useCallback(async () => {
        try { const result = await organizationRequest<{ organizations: OrganizationSummary[] }>(); setLocal({ source: organizations, rows: result.organizations }); await onChanged(); }
        catch { setNotice('Alteração salva. Atualize a página para conferir seus acessos atuais.'); }
    }, [organizations, onChanged]);
    async function saved(organization: Omit<OrganizationSummary, 'canManage'>) {
        setLocal({ source: organizations, rows: [...rows.filter(row => row.id !== organization.id), { ...organization, canManage: true }].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) });
        setCreating(false); setSelectedId(organization.id); setNotice('Organização salva.'); await refresh();
    }
    const visible = rows.filter(row => row.name.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')));
    return <section className={`p-section ${styles.panel}`}>
        <div className={styles.sectionHeading}><div><h2>Organizações</h2><p className="p-form-help">Projetos e acessos separados por organização. As unidades UFG continuam no catálogo institucional.</p></div>{currentActor.isPlatformOwner && <button type="button" className="p-button p-button-primary" onClick={() => { setCreating(true); setNotice(''); }}><Plus size={17} />Nova organização</button>}</div>
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {creating && currentActor.isPlatformOwner && <section className="p-card"><div className={styles.sectionHeading}><h3>Nova organização</h3><button type="button" className="p-icon-button" aria-label="Fechar criação de organização" onClick={() => setCreating(false)}><X size={18} /></button></div><OrganizationEditor organization={null} onSaved={saved} onCancel={() => setCreating(false)} /></section>}
        {rows.length > 4 && <label className="p-field"><span>Buscar organização</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome da organização" /></label>}
        <div className={styles.grid}>{visible.map(organization => <article key={organization.id} className={`p-card ${styles.card}`}><Building2 size={23} aria-hidden="true" /><h3>{organization.name}</h3><span className="p-badge">{organization.status === 'active' ? 'Ativa' : 'Arquivada'}</span><p>{organization.canManage ? 'Você administra os projetos e acessos desta organização.' : 'Você participa conforme os projetos concedidos à sua conta.'}</p>{organization.canManage && <button type="button" className="p-button p-button-subtle" aria-pressed={selected?.id === organization.id} onClick={() => { setSelectedId(organization.id); setCreating(false); }}><ShieldCheck size={16} />Gerenciar organização</button>}</article>)}</div>
        {!visible.length && <p className="p-empty">{query ? 'Nenhuma organização encontrada.' : 'As organizações aparecerão conforme os acessos concedidos à sua conta.'}</p>}
        {selected?.canManage && <OrganizationWorkspace key={selected.id} organization={selected} currentActor={currentActor} people={people} onChanged={refresh} onSaved={saved} />}
    </section>;
}
