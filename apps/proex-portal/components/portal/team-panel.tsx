'use client';
import { useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, Copy, KeyRound, LoaderCircle, Mail, Search, ShieldCheck, UserPlus, Users } from 'lucide-react';
import TeamPersonDetail from './team-person-detail';
import styles from './team-person.module.css';
import { useFormDraft, DraftNotice } from './use-form-draft';
// Server-projected directory and scoped memberships.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Props = {
    now: number;
    onOpenOwnProfile?: () => void;
    users: Row[];
    members: Row[];
    invites: Row[];
    projects: Row[];
    selectedProjectId?: string;
    globalAdmin: boolean;
    canProject: (id: string, capability: string) => boolean;
    mutate: (action: string, payload: Record<string, unknown>) => Promise<Row>;
};
const roles: Record<string, string> = { owner: 'Responsável institucional', manager: 'Gestor de projeto', operator: 'Operador de evento', inventory: 'Responsável por materiais', loans: 'Responsável por empréstimos', viewer: 'Leitor de relatórios' };
const projectIdOf = (row: Row) => row.project_id ?? row.projectId ?? null;
async function accountAction(payload: Row): Promise<Row> { const response = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(payload) }); const data = await response.json().catch(() => null) as Row | null; if (!response.ok || !data)
    throw new Error(data?.error || 'Não foi possível concluir. Atualize e tente novamente.'); return data; }
function CopyLink({ url, label }: {
    url: string;
    label: string;
}) {
    const [copied, setCopied] = useState(false);
    return <div className="p-invite-result">
    <ShieldCheck size={20}/>
    <div>
    <strong>{label}</strong>
    <p>Compartilhe este link somente com a pessoa indicada. Nenhum e-mail foi enviado automaticamente.</p>
    <div className="p-copy-row">
    <input aria-label={label} readOnly value={url} onFocus={e => e.target.select()}/>
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
    const [role, setRole] = useState(String(member.role));
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
        <select value={role} disabled={saving} onChange={e => { setRole(e.target.value); key.current = null; }}>{Object.entries(roles).filter(([key]) => key !== 'owner' && (globalAdmin || key !== 'manager')).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
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
    </button>{user.status&&<span className={`p-badge ${isBlocked?'p-status-cancelled':'p-status-active'}`}>{isAnonymized?'Anonimizada':user.activationPending?'Ativação pendente':isBlocked?'Bloqueado':'Ativo'}</span>}</div>{memberships.map((m: Row) => <Membership key={`${m.id}-${m.role}`} member={m} globalAdmin={props.globalAdmin} projectName={projectName(projectIdOf(m))} editable={m.role !== 'owner' && (props.globalAdmin || Boolean(projectIdOf(m) && props.canProject(projectIdOf(m), 'access.manage') && m.role !== 'manager'))} mutate={props.mutate}/>)}{!memberships.length && <p className="p-form-help">Sem vínculo neste contexto.</p>}{props.globalAdmin && id && !isAnonymized && <div className="p-user-admin">
        <button className="p-text-link" disabled={busy||user.activationPending} onClick={() => void reset()}>
        <KeyRound size={15}/>{busy ? 'Aguarde…' : user.hasPassword ? 'Gerar recuperação de senha' : 'Gerar link para definir senha'}</button>{!hasOwner && (confirmBlock ? <div className="p-inline-confirm">
            <p>{isBlocked ? 'Reativar esta conta?' : 'Bloquear esta conta impede novos acessos. O histórico será preservado.'}</p>
            <div className="p-inline">
            <button className="p-button p-button-danger" disabled={busy} onClick={() => void status()}>{isBlocked ? 'Confirmar reativação' : 'Confirmar bloqueio'}</button>
            <button className="p-button p-button-subtle" disabled={busy} onClick={() => setConfirmBlock(false)}>Voltar</button>
            </div>
            </div> : <button className="p-text-link p-text-danger" disabled={busy} onClick={() => { setConfirmBlock(true); key.current = null; }}>{isBlocked ? 'Reativar conta' : 'Bloquear conta'}</button>)}</div>}{resetUrl && <CopyLink url={resetUrl} label="Link de recuperação desta conta"/>}{error && <p className="p-inline-error" role="alert">{error}</p>}</article>;
}
export default function TeamPanel(props: Props) {
    const [selectedUserId,setSelectedUserId]=useState<string|null>(null);
    const [query, setQuery] = useState(''), [inviteUrl, setInviteUrl] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
    const key = useRef<string | null>(null), inviteRef = useRef<HTMLFormElement>(null);
    const draft = useFormDraft(inviteRef, 'team:invite');
    const allowed = props.projects.filter(p => props.globalAdmin || props.canProject(p.id, 'access.invite'));
    const defaultInviteProject = allowed.some(project => project.id === props.selectedProjectId) ? props.selectedProjectId : allowed.length === 1 ? String(allowed[0].id) : '';
    const [inviteProject, setInviteProject] = useState(defaultInviteProject), [globalConfirmed, setGlobalConfirmed] = useState(false);
    const directory: Row[] = props.users.length ? props.users : props.members.map(m => ({ userId:m.user_id??m.userId,email: m.email, members: [m] }));
    const filtered = directory.filter(u => `${u.displayName ?? ''} ${u.email ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')) && (!props.selectedProjectId || (u.members ?? []).some((m: Row) => !projectIdOf(m) || projectIdOf(m) === props.selectedProjectId)));
    async function invite(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (saving)
        return; const element = e.currentTarget, form = new FormData(element); setSaving(true); setError(''); key.current ??= crypto.randomUUID(); try {
        const globalAccess = form.get('projectId') === '__global__';
        if (globalAccess && (!props.globalAdmin || !globalConfirmed)) throw new Error('Confirme o alcance do convite ou escolha um projeto.');
        const result = await props.mutate('invite.create', { email: form.get('email'), role: form.get('role'), projectId: globalAccess ? null : form.get('projectId'), globalAccess: globalAccess && globalConfirmed, operationKey: key.current });
        setInviteUrl(result.inviteUrl || '');
        key.current = null;
        draft.clear();
        element.reset();
        setInviteProject(defaultInviteProject); setGlobalConfirmed(false);
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
    </div>
    <label className="p-field p-search-field">
    <span>Buscar pessoa</span>
    <div className="p-search">
    <Search size={17}/>
    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome ou e-mail"/>
    </div>
    </label>{filtered.length ? <div className="p-directory">{filtered.map((u, index) => <DirectoryUser key={u.userId ?? `${u.email}-${index}`} user={u} props={props} onOpen={setSelectedUserId}/>)}</div> : <div className="p-empty">
        <Users size={28}/>
        <h3>Nenhuma pessoa neste contexto</h3>
        <p>Busque outro nome ou gere um convite para integrar a equipe.</p>
        </div>}</section>{(props.globalAdmin || allowed.length > 0) && <section className="p-section">
        <div className="p-section-heading">
        <div>
        <h2>Convidar uma pessoa</h2>
        <p>O link fica vinculado ao e-mail, à função e ao projeto escolhido. E-mail institucional ou vínculo de bolsista não concede permissões adicionais.</p>
        </div>
        </div>
        <form ref={inviteRef} className="p-form" onSubmit={invite} onChange={() => { if (!saving)
            key.current = null; }}><DraftNotice draft={draft}/>
        <fieldset disabled={saving}>
        <div className="p-form-grid">
        <label className="p-field">
        <span>E-mail da pessoa *</span>
        <input name="email" type="email" required maxLength={254} autoComplete="off" placeholder="nome@exemplo.com"/>
        </label>
        <label className="p-field">
        <span>Função</span>
        <select name="role" defaultValue="operator">{Object.entries(roles).filter(([id]) => id !== 'owner' && (props.globalAdmin || id !== 'manager')).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        </label>
        <label className="p-field">
        <span>Escopo do acesso</span>
        <select name="projectId" value={inviteProject} onChange={event => { setInviteProject(event.target.value); setGlobalConfirmed(false); }} required><option value="" disabled>Selecione um projeto</option>{allowed.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{props.globalAdmin && <option value="__global__">Portal inteiro · todos os projetos</option>}</select>
        <small>O acesso a um projeto não concede permissão nos demais.</small>
        </label>
        </div>
        {props.globalAdmin && inviteProject === '__global__' && <label className="p-field"><span><input type="checkbox" checked={globalConfirmed} onChange={event => setGlobalConfirmed(event.target.checked)} required/> Confirmo que esta pessoa pode atuar em todos os projetos do portal, inclusive futuros.</span><small>Use este alcance somente para a equipe institucional autorizada. Esta confirmação não fica no rascunho.</small></label>}
        <div className="p-form-footer">{error && <p className="p-inline-error" role="alert">{error}</p>}<button className="p-button p-button-primary" type="submit">{saving ? <LoaderCircle size={17} className="p-spin"/> : <UserPlus size={17}/>}{saving ? 'Criando…' : 'Gerar convite'}</button>
        </div>
        </fieldset>
        </form>{inviteUrl && <CopyLink url={inviteUrl} label="Convite criado para a equipe"/>}</section>}{visibleInvites.length > 0 && <section className="p-section">
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
                <small>{roles[invite.role]} · {projectIdOf(invite) ? props.projects.find(p => p.id === projectIdOf(invite))?.name : 'Organização'}</small>
                <small>Válido até {expires.toLocaleDateString('pt-BR')}</small>
                </div>
                <span className="p-badge">{revoked ? 'Revogado' : accepted ? 'Aceito' : expired ? 'Expirado' : 'Pendente'}</span>{!revoked && !accepted && (props.globalAdmin || props.canProject(projectIdOf(invite), 'access.manage')) && <button className="p-button p-button-danger" onClick={() => void props.mutate('invite.revoke', { id: invite.id, operationKey: crypto.randomUUID() }).catch(e => setError(e instanceof Error ? e.message : 'Não foi possível revogar o convite.'))}>Revogar</button>}</div>;
            })}</div>
        </section>}{selectedUserId&&<TeamPersonDetail key={`${selectedUserId}:${props.selectedProjectId||''}`} userId={selectedUserId} projectId={props.selectedProjectId} projects={props.projects.map(p=>({id:p.id,name:p.name}))} onClose={()=>setSelectedUserId(null)} onOpenOwnProfile={props.onOpenOwnProfile}/>}</>;
}
