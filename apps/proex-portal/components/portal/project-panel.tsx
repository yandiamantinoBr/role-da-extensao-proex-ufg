'use client';
import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, Check, ExternalLink, FolderKanban, LoaderCircle, MapPin, Pencil, Plus, X } from 'lucide-react';
// The protected API projects module-specific metadata.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Props = {
    projects: Row[];
    selectedProjectId?: string;
    onSelect?: (id: string) => void;
    canCreate: boolean;
    canEdit: (id: string) => boolean;
    mutate: (action: string, payload: Record<string, unknown>) => Promise<Row>;
};
const value = (r: Row | null, a: string, b?: string) => r?.[a] ?? (b ? r?.[b] : undefined) ?? '';
const day = (v: unknown) => { if (!v)
    return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(String(v)))
    return String(v); const date = new Date(String(v)); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : ''; };
const prettyDay = (v: unknown) => day(v).split('-').reverse().join('/');
function ProjectForm({ project, mutate, done }: {
    project: Row | null;
    mutate: Props['mutate'];
    done: () => void;
}) {
    const [saving, setSaving] = useState(false), [error, setError] = useState('');
    const key = useRef<string | null>(null);
    async function save(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (saving)
            return;
        const form = new FormData(e.currentTarget);
        setSaving(true);
        setError('');
        key.current ??= crypto.randomUUID();
        try {
            const date = (name: string) => form.get(name) ? new Date(`${form.get(name)}T${name === 'endsAt' ? '23:59:59' : '00:00:00'}-03:00`).toISOString() : null;
            await mutate(project ? 'project.update' : 'project.create', { ...(project ? { id: project.id, expectedVersion: project.version } : {}), name: form.get('name'), shortName: form.get('shortName'), description: form.get('description'), status: form.get('status'), color: form.get('color'), officialUrl: form.get('officialUrl'), startsAt: date('startsAt'), endsAt: date('endsAt'), location: form.get('location'), operationKey: key.current });
            key.current = null;
            done();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Não foi possível salvar o projeto.');
        }
        finally {
            setSaving(false);
        }
    }
    return <form className="p-form" onSubmit={save} onChange={() => { if (!saving)
        key.current = null; }}>
    <fieldset disabled={saving}>
    <div className="p-form-grid">
    <label className="p-field">
    <span>Nome oficial do projeto *</span>
    <input name="name" maxLength={120} required defaultValue={project?.name ?? ''} placeholder="Ex.: Rolê da Extensão"/>
    </label>
    <label className="p-field">
    <span>Nome curto ou sigla</span>
    <input name="shortName" maxLength={40} defaultValue={value(project, 'short_name', 'shortName')}/>
    </label>
    <label className="p-field">
    <span>Situação</span>
    <select name="status" defaultValue={project?.status ?? 'active'}>
    <option value="active">Ativo</option>
    <option value="archived">Arquivado</option>
    </select>
    <small>Arquivar conserva os registros e o histórico.</small>
    </label>
    <label className="p-field">
    <span>Cor de identificação</span>
    <input className="p-color-input" name="color" type="color" defaultValue={project?.color || '#3b1753'}/>
    </label>
    <label className="p-field">
    <span>Página oficial</span>
    <input name="officialUrl" type="url" maxLength={500} defaultValue={value(project, 'official_url', 'officialUrl')} placeholder="https://"/>
    </label>
    <label className="p-field">
    <span>Local ou unidade</span>
    <input name="location" maxLength={200} defaultValue={project?.location ?? ''}/>
    </label>
    <label className="p-field">
    <span>Data de início</span>
    <input name="startsAt" type="date" defaultValue={day(value(project, 'starts_at', 'startsAt'))}/>
    </label>
    <label className="p-field">
    <span>Data de término</span>
    <input name="endsAt" type="date" defaultValue={day(value(project, 'ends_at', 'endsAt'))}/>
    </label>
    </div>
    <label className="p-field">
    <span>Descrição e finalidade</span>
    <textarea name="description" rows={4} maxLength={2000} defaultValue={project?.description ?? ''} placeholder="Explique o objetivo e o que a equipe organiza neste projeto."/>
    </label>
    <div className="p-form-footer">{error && <p className="p-inline-error" role="alert">{error}</p>}<button type="button" className="p-button p-button-subtle" onClick={done}>Cancelar</button>
    <button className="p-button p-button-primary" type="submit">{saving ? <LoaderCircle className="p-spin" size={17}/> : <Check size={17}/>}{saving ? 'Salvando…' : project ? 'Salvar alterações' : 'Criar projeto'}</button>
    </div>
    </fieldset>
    </form>;
}
export default function ProjectPanel({ projects, selectedProjectId = '', onSelect, canCreate, canEdit, mutate }: Props) {
    const [editing, setEditing] = useState<Row | null | undefined>();
    const [query, setQuery] = useState('');
    const visible = projects.filter(p => (!selectedProjectId || p.id === selectedProjectId) && `${p.name} ${p.short_name ?? ''} ${p.description ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
    return <section className="p-section">
    <div className="p-section-heading">
    <div>
    <h2>Projetos da equipe</h2>
    <p>Identidade, finalidade e período de cada área de trabalho.</p>
    </div>{canCreate && <button className="p-button p-button-primary" onClick={() => setEditing(null)}>
        <Plus size={17}/>Novo projeto</button>}</div>{editing !== undefined && <div className="p-editor-panel">
        <div className="p-row-between">
        <h3>{editing ? `Editar ${editing.name}` : 'Criar projeto'}</h3>
        <button type="button" className="p-icon-button" aria-label="Fechar formulário de projeto" onClick={() => setEditing(undefined)}>
        <X size={18}/>
        </button>
        </div>
        <ProjectForm key={editing?.id ?? 'new'} project={editing} mutate={mutate} done={() => setEditing(undefined)}/>
        </div>}<label className="p-field p-search-field">
    <span>Buscar projeto</span>
    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, sigla ou descrição"/>
    </label>{visible.length ? <div className="p-project-grid">{visible.map(p => <article className="p-card p-project-card" key={p.id}>
            <div className="p-row-between">
            <span className="p-icon-tile" style={{ borderTop: `3px solid ${/^#[\da-f]{6}$/i.test(p.color ?? '') ? p.color : '#3b1753'}` }}>
            <FolderKanban size={22}/>
            </span>
            <span className={`p-badge ${p.status === 'archived' ? 'p-status-closed' : 'p-status-active'}`}>{p.status === 'archived' ? 'Arquivado' : 'Ativo'}</span>
            </div>{value(p, 'short_name', 'shortName') && <span className="p-kicker">{value(p, 'short_name', 'shortName')}</span>}<h3>{p.name}</h3>
            <p>{p.description || 'Descrição ainda não informada.'}</p>{p.location && <p className="p-metadata">
                <MapPin size={14}/>{p.location}</p>}{value(p, 'starts_at', 'startsAt') && <p className="p-metadata">
                <CalendarDays size={14}/>{prettyDay(value(p, 'starts_at', 'startsAt'))}{value(p, 'ends_at', 'endsAt') && ` até ${prettyDay(value(p, 'ends_at', 'endsAt'))}`}</p>}{value(p, 'official_url', 'officialUrl') && <a className="p-text-link" href={value(p, 'official_url', 'officialUrl')} target="_blank" rel="noreferrer">Página oficial <ExternalLink size={14}/>
                </a>}<div className="p-project-actions">
            <button className="p-text-link" onClick={() => onSelect?.(p.id)}>Acessar projeto <ArrowRight size={15}/>
            </button>{canEdit(p.id) && <button className="p-button p-button-subtle" onClick={() => setEditing(p)}>
                <Pencil size={14}/>Editar</button>}</div>
            </article>)}</div> : <div className="p-empty">
        <FolderKanban size={29}/>
        <h3>{query ? 'Nenhum projeto encontrado' : 'Nenhum projeto neste contexto'}</h3>
        <p>{canCreate ? 'Cadastre o projeto para organizar os materiais, a equipe e as próximas ações.' : 'Os projetos aparecerão conforme os acessos concedidos à sua conta.'}</p>
        </div>}</section>;
}
