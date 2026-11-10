'use client';
import { useId, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, Clock3, Copy, KeyRound, LoaderCircle, Mail, Search, ShieldCheck, UserPlus, Users } from 'lucide-react';
import TeamPersonDetail from './team-person-detail';
import DateTimeField from './date-time-field';
import styles from './team-person.module.css';
import { useFormDraft, DraftNotice } from './use-form-draft';
import { officialTeamPrefill, type OfficialTeamSelection } from '../../lib/catalog/proex-team';
// Server-projected directory and scoped memberships.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Props = {
    officialSuggestion?: OfficialTeamSelection | null;
    onClearOfficialSuggestion?: () => void;
    now: number;
    onOpenOwnProfile?: () => void;
    users: Row[];
    members: Row[];
    invites: Row[];
    projects: Row[];
    /** Actions (campaigns) visible to the inviter, for the volunteer scope. */
    campaigns?: Row[];
    /** Volunteer grants of the projects this person manages (active and ended in the last 30 days). */
    volunteers?: Row[];
    selectedProjectId?: string;
    globalAdmin: boolean;
    canManageManagers?: (projectId: string | null, organizationId?: string | null) => boolean;
    canProject: (id: string, capability: string) => boolean;
    mutate: (action: string, payload: Record<string, unknown>) => Promise<Row>;
};
const roles: Record<string, string> = { owner: 'Responsável institucional', manager: 'Gestor de projeto', operator: 'Operador de evento', inventory: 'Responsável por materiais', loans: 'Responsável por empréstimos', viewer: 'Leitor de relatórios' };
const projectIdOf = (row: Row) => row.project_id ?? row.projectId ?? null;
// Brasília (UTC-3, sem horário de verão): o campo de data e hora trabalha em hora local.
const BRASILIA_MS = 3 * 60 * 60 * 1000;
const toLocal = (iso: unknown) => { const time = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(time) ? new Date(time - BRASILIA_MS).toISOString().slice(0, 16) : ''; };
const fromLocal = (local: string) => /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local) ? new Date(`${local}:00-03:00`).toISOString() : '';
const WHEN = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' });
const moment = (iso: unknown) => { const time = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(time) ? WHEN.format(new Date(time)).replace(',', ' às') : ''; };
async function accountAction(payload: Row): Promise<Row> { const response = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(payload) }); const data = await response.json().catch(() => null) as Row | null; if (!response.ok || !data)
    throw new Error(data?.error || 'Não foi possível concluir. Atualize e tente novamente.'); return data; }
function CopyLink({ url, label }: {
    url: string;
    label: string;
}) {
    const [copied, setCopied] = useState(false), fieldId = useId();
    return <div className="p-invite-result">
    <ShieldCheck size={20}/>
    <div>
    <strong>{label}</strong>
    <p>Compartilhe este link somente com a pessoa indicada. Nenhum e-mail foi enviado automaticamente.</p>
    <div className="p-copy-row">
    <input id={fieldId} aria-label={label} readOnly value={url} onFocus={e => e.target.select()}/>
    <button type="button" className="p-button p-button-subtle" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => setCopied(false))}>
    <Copy size={16}/>{copied ? 'Copiado' : 'Copiar link'}</button>
    </div>
    </div>
    </div>;
}
function Membership({ member, editable, globalAdmin, projectName, mutate }: {
    member: Row;
    editable: boolean;
    globalAdmin: boolean;
    projectName: string;
    mutate: Props['mutate'];
}) {
    const [role, setRole] = useState(String(member.role)), roleId = useId();
    const [saving, setSaving] = useState(false), [error, setError] = useState(''), [revoke, setRevoke] = useState(false);
    const key = useRef<string | null>(null);
    async function send(action: 'member.change' | 'member.revoke') { if (saving)
        return; setSaving(true); setError(''); key.current ??= crypto.randomUUID(); try {
        await mutate(action, { memberId: member.id, id: member.id, role, operationKey: key.current });
        key.current = null;
        setRevoke(false);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível atualizar o acesso.');
    }
    finally {
        setSaving(false);
    } }
    const revoked = Boolean(member.revoked_at ?? member.revokedAt);
    return <div className="p-membership">
    <div className="p-row-between">
    <div>
    <strong>{projectName}</strong>
    <small>{roles[member.role] || member.role}</small>
    </div>{revoked && <span className="p-badge p-status-revoked">Revogado</span>}</div>{editable && !revoked && <>
        <div className="p-access-controls">
        <label className="p-field">
        <span>Função neste escopo</span>
        <select id={roleId} value={role} disabled={saving} onChange={e => { setRole(e.target.value); key.current = null; }}>{Object.entries(roles).filter(([key]) => key !== 'owner' && (globalAdmin || key !== 'manager')).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
        </label>
        <button type="button" className="p-button p-button-primary" disabled={saving || role === member.role} onClick={() => void send('member.change')}>{saving ? <LoaderCircle size={16} className="p-spin"/> : <Check size={16}/>}Salvar função</button>
        </div>{revoke ? <div className="p-inline-confirm">
            <p>Revogar o acesso a {projectName}? Os registros anteriores serão preservados.</p>
            <div className="p-inline">
            <button className="p-button p-button-danger" disabled={saving} onClick={() => void send('member.revoke')}>Confirmar revogação</button>
            <button className="p-button p-button-subtle" disabled={saving} onClick={() => setRevoke(false)}>Voltar</button>
            </div>
            </div> : <button className="p-text-link p-text-danger" disabled={saving} onClick={() => { setRevoke(true); key.current = null; }}>Revogar este acesso</button>}</>}{error && <p className="p-inline-error" role="alert">{error}</p>}</div>;
}
function DirectoryUser({ user, props, onOpen }: {
    user: Row;
    props: Props;
    onOpen(id:string):void;
}) {
    const [resetUrl, setResetUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmBlock, setConfirmBlock] = useState(false);
    const key = useRef<string | null>(null);
    const id = user.userId ?? user.user_id;
    const isBlocked = user.status === 'blocked';
    const isAnonymized=Boolean(user.anonymizedAt),[brokenAvatar,setBrokenAvatar]=useState('');
    const displayName=user.displayName||user.display_name||user.email||'Integrante';
    const hasOwner = (user.members ?? []).some((m: Row) => m.role === 'owner' && !(m.revoked_at ?? m.revokedAt));
    const projectName = (id: string | null) => id ? props.projects.find(p => p.id === id)?.name || 'Projeto' : 'Toda a organização';
    async function reset() { if (busy)
        return; setBusy(true); setError(''); try {
        const result = await accountAction({ action: 'adminReset', userId: id });
        if (!result.resetUrl)
            throw new Error('O link não foi retornado. Atualize e tente novamente.');
        setResetUrl(result.resetUrl);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível gerar o link.');
    }
    finally {
        setBusy(false);
    } }
    async function status() { if (busy)
        return; setBusy(true); setError(''); key.current ??= crypto.randomUUID(); try {
        await props.mutate('user.status', { userId: id, status: isBlocked ? 'active' : 'blocked', operationKey: key.current });
        key.current = null;
        setConfirmBlock(false);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível alterar a conta.');
    }
    finally {
        setBusy(false);
    } }
    const memberships = (user.members ?? []).filter((m: Row) => !props.selectedProjectId || !projectIdOf(m) || projectIdOf(m) === props.selectedProjectId);
    return <article className="p-card p-directory-user">
    <div className="p-directory-heading">
    <button type="button" className={styles.personTrigger} disabled={!id} onClick={()=>onOpen(String(id))} aria-label={`Ver perfil de ${displayName}`}>
    <span className={styles.cardAvatar}><Users size={21} aria-hidden="true"/>{user.avatarUrl&&brokenAvatar!==user.avatarUrl&&<img src={user.avatarUrl} alt="" width={48} height={48} loading="lazy" onError={()=>setBrokenAvatar(user.avatarUrl)}/>}</span>
    <span className={styles.personText}><strong className={styles.personName}>{displayName}</strong>{user.email&&<span className={styles.personEmail}><Mail size={13}/>{user.email}</span>}</span>
    <ArrowUpRight size={19} className={styles.openIcon} aria-hidden="true"/>
    </button>{user.status&&<span className={`p-badge ${isBlocked?'p-status-cancelled':'p-status-active'}`}>{isAnonymized?'Anonimizada':user.activationPending?'Ativação pendente':isBlocked?'Bloqueado':'Ativo'}</span>}</div>{memberships.map((m: Row) => <Membership key={`${m.id}-${m.role}`} member={m} globalAdmin={props.globalAdmin || Boolean(props.canManageManagers?.(projectIdOf(m), m.organization_id))} projectName={projectName(projectIdOf(m))} editable={m.role !== 'owner' && (props.globalAdmin || Boolean(props.canManageManagers?.(projectIdOf(m), m.organization_id)) || Boolean(projectIdOf(m) && props.canProject(projectIdOf(m), 'access.manage') && m.role !== 'manager'))} mutate={props.mutate}/>)}{!memberships.length && <p className="p-form-help">Sem vínculo neste contexto.</p>}{props.globalAdmin && id && !isAnonymized && <div className="p-user-admin">
        <button className="p-text-link" disabled={busy||user.activationPending} onClick={() => void reset()}>
        <KeyRound size={15}/>{busy ? 'Aguarde…' : user.hasPassword ? 'Gerar recuperação de senha' : 'Gerar link para definir senha'}</button>{!hasOwner && (confirmBlock ? <div className="p-inline-confirm">
            <p>{isBlocked ? 'Reativar esta conta?' : 'Bloquear esta conta impede novos acessos. O histórico será preservado.'}</p>
            <div className="p-inline">
            <button className="p-button p-button-danger" disabled={busy} onClick={() => void status()}>{isBlocked ? 'Confirmar reativação' : 'Confirmar bloqueio'}</button>
            <button className="p-button p-button-subtle" disabled={busy} onClick={() => setConfirmBlock(false)}>Voltar</button>
            </div>
            </div> : <button className="p-text-link p-text-danger" disabled={busy} onClick={() => { setConfirmBlock(true); key.current = null; }}>{isBlocked ? 'Reativar conta' : 'Bloquear conta'}</button>)}</div>}{resetUrl && <CopyLink url={resetUrl} label="Link de recuperação desta conta"/>}{error && <p className="p-inline-error" role="alert">{error}</p>}</article>;
}
function VolunteerList({ volunteers, projects, canRevoke, mutate }: { volunteers: Row[]; projects: Row[]; canRevoke: (projectId: string) => boolean; mutate: Props['mutate'] }) {
    const [confirm, setConfirm] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
    if (!volunteers.length) return null;
    async function revoke(id: string) { if (saving) return; setSaving(true); setError('');
        try { await mutate('volunteer.revoke', { id, operationKey: crypto.randomUUID() }); setConfirm(''); }
        catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível encerrar o acesso.'); }
        finally { setSaving(false); } }
    return <section className="p-section">
    <div className="p-section-heading"><div><h2>Voluntários por ação</h2><p>Cada voluntário vê só o atendimento de uma ação. No fim do prazo, o acesso termina sozinho.</p></div></div>
    {error && <p className="p-inline-error" role="alert">{error}</p>}
    <div className="p-card p-member-list">{volunteers.map(volunteer => {
        const ended = Boolean(volunteer.revoked_at), project = projects.find(p => p.id === projectIdOf(volunteer))?.name;
        return <div className="p-member" key={volunteer.id}>
        <div>
        <strong>{volunteer.display_name || volunteer.email || 'Voluntário(a)'}</strong>
        <small>{volunteer.campaign_name}{project ? ` · ${project}` : ''}</small>
        <small><Clock3 size={13} aria-hidden="true"/> {ended ? volunteer.revoke_reason === 'expired' ? `Venceu em ${moment(volunteer.ends_at)}` : `Encerrado em ${moment(volunteer.revoked_at)}` : `Acesso até ${moment(volunteer.ends_at)}`}</small>
        </div>
        <span className="p-badge">{ended ? volunteer.revoke_reason === 'expired' ? 'Venceu' : 'Encerrado' : 'Ativo'}</span>
        {!ended && canRevoke(String(projectIdOf(volunteer))) && (confirm === volunteer.id ? <div className="p-inline">
        <button className="p-button p-button-danger" disabled={saving} onClick={() => void revoke(String(volunteer.id))}>Confirmar</button>
        <button className="p-button p-button-subtle" disabled={saving} onClick={() => setConfirm('')}>Voltar</button>
        </div> : <button className="p-button p-button-subtle" disabled={saving} onClick={() => setConfirm(String(volunteer.id))}>Encerrar agora</button>)}
        </div>;
    })}</div>
    </section>;
}
export default function TeamPanel(props: Props) {
    const [selectedUserId,setSelectedUserId]=useState<string|null>(null);
    const [query, setQuery] = useState(''), [inviteUrl, setInviteUrl] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
    const [issuedSelection, setIssuedSelection] = useState('');
    const key = useRef<{ selection: string; operationKey: string } | null>(null), inviteRef = useRef<HTMLFormElement>(null);
    const official = props.officialSuggestion ? officialTeamPrefill(props.officialSuggestion.id) : null;
    const suggestionKey = official ? `${props.officialSuggestion!.selectionKey}:${official.id}` : 'manual';
    // A catalog choice starts a new, explicit scope decision. Never restore an
    // older person's project/role draft into the official prefill flow.
    const draft = useFormDraft(inviteRef, official ? null : `team:invite:${props.selectedProjectId || 'unscoped'}`);
    const allowed = props.projects.filter(p => props.globalAdmin || props.canProject(p.id, 'access.invite'));
    const defaultInviteProject = official ? '' : allowed.some(project => project.id === props.selectedProjectId) ? props.selectedProjectId : allowed.length === 1 ? String(allowed[0].id) : '';
    const [inviteProject, setInviteProject] = useState(defaultInviteProject), [globalConfirmed, setGlobalConfirmed] = useState(false);
    const [inviteRole, setInviteRole] = useState(''), [volunteerCampaign, setVolunteerCampaign] = useState('');
    const volunteerCampaigns = (props.campaigns ?? []).filter(campaign => projectIdOf(campaign) === inviteProject && campaign.status !== 'closed');
    const chosenCampaign = volunteerCampaigns.find(campaign => campaign.id === volunteerCampaign);
    const directory: Row[] = props.users.length ? props.users : props.members.map(m => ({ userId:m.user_id??m.userId,email: m.email, members: [m] }));
    const filtered = directory.filter(u => `${u.displayName ?? ''} ${u.email ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')) && (!props.selectedProjectId || (u.members ?? []).some((m: Row) => !projectIdOf(m) || projectIdOf(m) === props.selectedProjectId)));
    async function invite(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (saving)
        return; const element = e.currentTarget, form = new FormData(element), selectedScope = form.get('projectId');
        if (!form.get('role') || !selectedScope || (official && selectedScope === '__global__')) { setError('Escolha explicitamente a função e o projeto antes de gerar o convite.'); return; }
        const asVolunteer = form.get('role') === 'volunteer', endsAt = asVolunteer ? fromLocal(String(form.get('volunteerEndsAt') ?? '')) : '';
        if (asVolunteer && (selectedScope === '__global__' || !form.get('campaignId') || !endsAt)) { setError('Para o voluntário, escolha o projeto, a ação e até quando vai o acesso.'); return; }
        setSaving(true); setError(''); if (!key.current || key.current.selection !== suggestionKey) key.current = { selection: suggestionKey, operationKey: crypto.randomUUID() }; try {
        const globalAccess = selectedScope === '__global__';
        if (globalAccess && (!props.globalAdmin || !globalConfirmed)) throw new Error('Confirme o alcance do convite ou escolha um projeto.');
        const result = await props.mutate('invite.create', { email: form.get('email'), role: asVolunteer ? 'operator' : form.get('role'), projectId: globalAccess ? null : selectedScope, globalAccess: globalAccess && globalConfirmed, ...(asVolunteer ? { campaignId: form.get('campaignId'), endsAt } : {}), operationKey: key.current.operationKey });
        setIssuedSelection(suggestionKey);
        setInviteUrl(result.inviteUrl || '');
        key.current = null;
        draft.clear();
        element.reset();
        setInviteProject(defaultInviteProject); setGlobalConfirmed(false); setInviteRole(''); setVolunteerCampaign('');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível criar o convite.');
    }
    finally {
        setSaving(false);
    } }
    const visibleInvites = props.invites.filter(i => !props.selectedProjectId || !projectIdOf(i) || projectIdOf(i) === props.selectedProjectId);
    return <>
    <section className="p-section">
    <div className="p-section-heading">
    <div>
    <h2>Pessoas e acessos</h2>
    <p>Clique em uma pessoa para ver seu perfil e os dados institucionais preenchidos. As permissões são definidas por projeto.</p>
    </div>
    {(props.globalAdmin || allowed.length > 0) && <a href="#team-invite-form" className="p-button p-button-primary"><UserPlus size={17} aria-hidden="true"/>Convidar pessoa</a>}
    </div>
    <label className="p-field p-search-field">
    <span>Buscar pessoa</span>
    <div className="p-search">
    <Search size={17}/>
    <input name="memberSearch" value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome ou e-mail"/>
    </div>
    </label>{filtered.length ? <div className="p-directory">{filtered.map((u, index) => <DirectoryUser key={u.userId ?? `${u.email}-${index}`} user={u} props={props} onOpen={setSelectedUserId}/>)}</div> : <div className="p-empty">
        <Users size={28}/>
        <h3>Nenhuma pessoa neste contexto</h3>
        <p>Busque outro nome ou gere um convite para integrar a equipe.</p>
        </div>}</section>{(props.globalAdmin || allowed.length > 0) && <section className="p-section">
        <div className="p-section-heading">
        <div>
        <h2>Convidar uma pessoa</h2>
        <p>Use o e-mail institucional ou pessoal. O convite vale para a função e o projeto escolhidos. Para monitores, escolha Operador de evento; a gestão do projeto permanece com o gestor.</p>
        </div>
        </div>
        {official && <p className="p-form-help" role="status">Sugestão da fonte oficial: {official.name}. Confira o e-mail e escolha projeto e função. O nome é apenas referência; a pessoa define seu próprio perfil na ativação. {props.onClearOfficialSuggestion && <button type="button" className="p-text-link" disabled={saving} onClick={props.onClearOfficialSuggestion}>Limpar sugestão</button>}</p>}
        <form id="team-invite-form" ref={inviteRef} className="p-form" onSubmit={invite} onChange={() => { if (!saving)
            { key.current = null; setInviteUrl(''); } }}>{!official && <DraftNotice draft={draft}/>}
        <fieldset disabled={saving}>
        <div className="p-form-grid">
        {official && <label className="p-field"><span>Nome na fonte oficial</span><input id="team-invite-official-name" readOnly value={official.name} aria-label="Nome na fonte oficial"/></label>}
        <label className="p-field">
        <span>E-mail da pessoa *</span>
        <input key={`email-${suggestionKey}`} name="email" type="email" required maxLength={254} autoComplete="off" placeholder="nome@exemplo.com" defaultValue={official?.email ?? ''}/>
        </label>
        <label className="p-field">
        <span>Função</span>
        <select key={`role-${suggestionKey}`} name="role" defaultValue="" required onChange={event => { setInviteRole(event.target.value); setVolunteerCampaign(''); }}><option value="" disabled>Selecione a função</option>{Object.entries(roles).filter(([id]) => id !== 'owner' && (props.globalAdmin || Boolean(props.canManageManagers?.(inviteProject || null)) || id !== 'manager')).map(([id, name]) => <option key={id} value={id}>{name}</option>)}{!official && <option value="volunteer">Voluntário de uma ação (com prazo)</option>}</select>
        </label>
        <label className="p-field">
        <span>Escopo do acesso</span>
        <select key={`project-${suggestionKey}`} name="projectId" value={inviteProject} onChange={event => { setInviteProject(event.target.value); setGlobalConfirmed(false); }} required><option value="" disabled>Selecione um projeto</option>{allowed.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{props.globalAdmin && !official && <option value="__global__">Portal inteiro · todos os projetos</option>}</select>
        <small>O acesso a um projeto não concede permissão nos demais.</small>
        </label>
        </div>
        {inviteRole === 'volunteer' && <div className="p-form-grid">
        <label className="p-field">
        <span>Ação do voluntário *</span>
        <select name="campaignId" value={volunteerCampaign} onChange={event => setVolunteerCampaign(event.target.value)} required disabled={!inviteProject || inviteProject === '__global__' || !volunteerCampaigns.length}><option value="" disabled>{!inviteProject || inviteProject === '__global__' ? 'Escolha antes o projeto' : volunteerCampaigns.length ? 'Selecione a ação' : 'Nenhuma ação aberta neste projeto'}</option>{volunteerCampaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}{campaign.status === 'draft' ? ' (em preparação)' : campaign.status === 'paused' ? ' (pausada)' : ''}</option>)}</select>
        <small>{inviteProject && inviteProject !== '__global__' && !volunteerCampaigns.length ? 'Crie a dinâmica em Dinâmicas antes de convidar o voluntário.' : 'A pessoa vê só o atendimento e os brindes desta ação.'}</small>
        </label>
        <label className="p-field">
        <span>Acesso até *</span>
        <DateTimeField key={`ends-${volunteerCampaign}`} name="volunteerEndsAt" defaultValue={toLocal(chosenCampaign?.ends_at ?? chosenCampaign?.endsAt)} required disabled={!chosenCampaign}/>
        <small>Começa com o fim da ação. No prazo, o acesso termina sozinho e isso entra em Registros.</small>
        </label>
        </div>}
        {props.globalAdmin && inviteProject === '__global__' && <label className="p-field"><span><input id="team-invite-global-confirm" type="checkbox" checked={globalConfirmed} onChange={event => setGlobalConfirmed(event.target.checked)} required/> Confirmo que esta pessoa pode atuar em todos os projetos do portal, inclusive futuros.</span><small>Use este alcance somente para a equipe institucional autorizada. Esta confirmação não fica no rascunho.</small></label>}
        <div className="p-form-footer">{error && <p className="p-inline-error" role="alert">{error}</p>}<button className="p-button p-button-primary" type="submit">{saving ? <LoaderCircle size={17} className="p-spin"/> : <UserPlus size={17}/>}{saving ? 'Criando…' : 'Gerar convite'}</button>
        </div>
        </fieldset>
        </form>{inviteUrl && issuedSelection === suggestionKey && <CopyLink url={inviteUrl} label="Convite criado para a equipe"/>}</section>}<VolunteerList volunteers={(props.volunteers ?? []).filter(volunteer => !props.selectedProjectId || projectIdOf(volunteer) === props.selectedProjectId)} projects={props.projects} canRevoke={projectId => props.globalAdmin || props.canProject(projectId, 'access.manage')} mutate={props.mutate}/>{visibleInvites.length > 0 && <section className="p-section">
        <div className="p-section-heading">
        <div>
        <h2>Convites emitidos</h2>
        <p>Links expirados ou revogados não concedem acesso.</p>
        </div>
        </div>
        <div className="p-card p-member-list">{visibleInvites.map(invite => {
                const revoked = Boolean(invite.revoked_at ?? invite.revokedAt), accepted = Boolean(invite.accepted_at ?? invite.acceptedAt), expires = new Date(invite.expires_at ?? invite.expiresAt), expired = Number.isFinite(expires.getTime()) && expires.getTime() < props.now;
                return <div className="p-member" key={invite.id}>
                <div>
                <strong>{invite.email}</strong>
                <small>{invite.volunteer_campaign_id ? `Voluntário · ${invite.volunteer_campaign_name || 'ação'}` : roles[invite.role]} · {projectIdOf(invite) ? props.projects.find(p => p.id === projectIdOf(invite))?.name : 'Organização'}</small>
                <small>{invite.volunteer_campaign_id ? `Link válido até ${expires.toLocaleDateString('pt-BR')} · acesso até ${moment(invite.volunteer_ends_at)}` : `Válido até ${expires.toLocaleDateString('pt-BR')}`}</small>
                </div>
                <span className="p-badge">{revoked ? 'Revogado' : accepted ? 'Aceito' : expired ? 'Expirado' : 'Pendente'}</span>{!revoked && !accepted && (props.globalAdmin || props.canProject(projectIdOf(invite), 'access.manage')) && <button className="p-button p-button-danger" onClick={() => void props.mutate('invite.revoke', { id: invite.id, operationKey: crypto.randomUUID() }).catch(e => setError(e instanceof Error ? e.message : 'Não foi possível revogar o convite.'))}>Revogar</button>}</div>;
            })}</div>
        </section>}{selectedUserId&&<TeamPersonDetail key={`${selectedUserId}:${props.selectedProjectId||''}`} userId={selectedUserId} projectId={props.selectedProjectId} projects={props.projects.map(p=>({id:p.id,name:p.name}))} onClose={()=>setSelectedUserId(null)} onOpenOwnProfile={props.onOpenOwnProfile}/>}</>;
}
