'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import ProjectDetail from './project-detail';
import { ArrowRight, CalendarDays, Check, ExternalLink, FolderKanban, LoaderCircle, MapPin, Pencil, Plus, X } from 'lucide-react';
// The protected API projects module-specific metadata.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Props = {
    projects: Row[];
    projectTypes?: Row[];
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
function ProjectTypeForm({types,mutate,onSaved,close}:{types:Row[];mutate:Props['mutate'];onSaved:(row:Row)=>void;close:()=>void}){
 const [current,setCurrent]=useState<Row|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState(''),key=useRef<string|null>(null);
 async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(saving)return;const form=new FormData(event.currentTarget),label=String(form.get('label')||'');let slug=label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45);if(!/^[a-z][a-z0-9-]{1,44}$/.test(slug))slug=`tipo-${slug||'institucional'}`;key.current??=crypto.randomUUID();setSaving(true);setError('');try{const result=await mutate(`project.type.${current?'update':'create'}`,{...(current?{id:current.id,expectedVersion:current.version}:{}),key:current?.key||slug,label,description:form.get('description'),status:form.get('status'),operationKey:key.current});if(result.projectType)onSaved(result.projectType);key.current=null;setCurrent(null);close();}catch(error){setError(error instanceof Error?error.message:'Não foi possível salvar o tipo.');}finally{setSaving(false);}}
 return <section className="p-card" style={{marginBottom:20}}><div className="p-row-between"><h3>Tipos de iniciativa</h3><button className="p-icon-button" type="button" aria-label="Fechar tipos" onClick={close}><X size={16}/></button></div><p className="p-form-help">Classifique programas, projetos, eventos e outras áreas. Arquivar um tipo conserva os projetos existentes.</p><div className="p-inline" style={{flexWrap:'wrap',margin:'12px 0'}}>{types.map(type=><button key={type.id} className="p-button p-button-subtle" type="button" disabled={saving} onClick={()=>{setCurrent(type);key.current=null;setError('');}}>{type.label}{type.status==='archived'?' · Arquivado':''}<Pencil size={12}/></button>)}</div><form key={current?.id||'new'} onSubmit={save} onChange={()=>{if(!saving)key.current=null;}}><fieldset disabled={saving}><h4>{current?'Editar tipo':'Adicionar tipo'}</h4><div className="p-form-grid"><label className="p-field"><span>Nome do tipo</span><input name="label" required maxLength={100} defaultValue={current?.label||''} placeholder="Ex.: Programa"/></label><label className="p-field"><span>Situação</span><select name="status" defaultValue={current?.status||'active'}><option value="active">Ativo</option><option value="archived">Arquivado</option></select></label></div><label className="p-field"><span>Descrição</span><textarea name="description" maxLength={1000} rows={2} defaultValue={current?.description||''}/></label>{error&&<p className="p-inline-error" role="alert">{error}</p>}<div className="p-inline"><button className="p-button p-button-primary" type="submit">{saving?<LoaderCircle className="p-spin" size={16}/>:<Check size={16}/>}Salvar tipo</button>{current&&<button className="p-button p-button-subtle" type="button" onClick={()=>{setCurrent(null);key.current=null;}}>Adicionar outro</button>}</div></fieldset></form></section>;
}
function ProjectForm({ project, projects, types, mutate, done }: {
    project: Row | null;
    projects: Row[];
    types: Row[];
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
            await mutate(project ? 'project.update' : 'project.create', { ...(project ? { id: project.id, expectedVersion: Number(project.version) } : {}), name: form.get('name'), shortName: form.get('shortName'), description: form.get('description'), status: form.get('status'), lifecycle: form.get('lifecycle'), typeId: form.get('typeId')||null, parentId: form.get('parentId')||null, color: form.get('color'), officialUrl: form.get('officialUrl'), startsAt: date('startsAt'), endsAt: date('endsAt'), location: form.get('location'), operationKey: key.current });
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
    <label className="p-field"><span>Tipo de iniciativa</span><select name="typeId" defaultValue={project?.type_id??''}><option value="">Tipo ainda não definido</option>{types.filter(type=>type.status==='active'||type.id===project?.type_id).map(type=><option key={type.id} value={type.id}>{type.label}</option>)}</select><small>Programa, projeto e evento são classificações distintas.</small></label>
    <label className="p-field"><span>Etapa no catálogo</span><select name="lifecycle" defaultValue={project?.lifecycle??'active'}><option value="active">Em atividade</option><option value="past">Passado / histórico</option><option value="catalog">Catálogo / referência</option></select><small>Uma referência histórica não comprova encerramento da iniciativa.</small></label>
    <label className="p-field"><span>Programa ou projeto superior</span><select name="parentId" defaultValue={project?.parent_id??''}><option value="">Sem vínculo superior</option>{project?.parent_id&&!projects.some(row=>row.id===project.parent_id)&&<option value={project.parent_id}>Vínculo superior atual (acesso restrito)</option>}{projects.filter(row=>row.id!==project?.id).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select><small>A relação organiza o catálogo e não concede acesso a outros projetos.</small></label>
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
export default function ProjectPanel({ projects, projectTypes = [], selectedProjectId = '', onSelect, canCreate, canEdit, mutate }: Props) {
    const [editing, setEditing] = useState<Row | null | undefined>();
    const [query, setQuery] = useState('');
    const [detail,setDetail]=useState(''),[detailRevision,setDetailRevision]=useState(0),[types,setTypes]=useState<Row[]>(projectTypes),[opening,setOpening]=useState(false),[error,setError]=useState(''),[phase,setPhase]=useState('all'),[typeEditor,setTypeEditor]=useState(false);
    const editorRef=useRef<HTMLDivElement|null>(null);useEffect(()=>{if(editing!==undefined)editorRef.current?.scrollIntoView({behavior:'smooth',block:'start'});},[editing]);
    useEffect(()=>{setTypes(projectTypes);},[projectTypes]);
    async function edit(project:Row){setOpening(true);setError('');try{const response=await fetch(`/api/projects/${encodeURIComponent(project.id)}`,{cache:'no-store'}),body=await response.json() as Row;if(!response.ok)throw new Error(body.error||'Não foi possível abrir a edição.');if(!body.permissions?.canEdit)throw new Error('Seu acesso não permite editar este projeto.');setTypes(body.types||[]);setEditing(body.project);}catch(error){setError(error instanceof Error?error.message:'Não foi possível abrir a edição.');}finally{setOpening(false);}}
    function done(){setEditing(undefined);setDetailRevision(value=>value+1);}
    const visible = projects.filter(p => (!selectedProjectId || p.id === selectedProjectId) && (phase==='all'||p.lifecycle===phase) && `${p.name} ${p.short_name ?? ''} ${p.description ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
    return <section className="p-section">
    <div className="p-section-heading">
    <div>
    <h2>Projetos da equipe</h2>
    <p>Identidade, finalidade e período de cada área de trabalho.</p>
    </div>{canCreate && <div className="p-inline" style={{flexWrap:'wrap'}}><button type="button" className="p-button p-button-subtle" onClick={()=>setTypeEditor(value=>!value)}>Tipos de iniciativa</button><button className="p-button p-button-primary" onClick={() => setEditing(null)}>
        <Plus size={17}/>Novo projeto</button></div>}</div>{typeEditor&&canCreate&&<ProjectTypeForm types={types} mutate={mutate} close={()=>setTypeEditor(false)} onSaved={row=>setTypes(current=>[...current.filter(type=>type.id!==row.id),row])}/>} {editing !== undefined && <div ref={editorRef} className="p-editor-panel" style={{scrollMarginTop:20}}>
        <div className="p-row-between">
        <h3>{editing ? `Editar ${editing.name}` : 'Criar projeto'}</h3>
        <button type="button" className="p-icon-button" aria-label="Fechar formulário de projeto" onClick={() => setEditing(undefined)}>
        <X size={18}/>
        </button>
        </div>
    <ProjectForm key={`${editing?.id??'new'}-${editing?.version??0}`} project={editing} projects={projects} types={types} mutate={mutate} done={done}/>
        </div>}{error&&<p className="p-inline-error" role="alert">{error}</p>}{detail?<ProjectDetail key={`${detail}-${detailRevision}`} projectId={detail} projects={projects} mutate={mutate} onBack={()=>setDetail('')} onEdit={project=>void edit(project)} onSelect={id=>setDetail(id)}/>:<><div className="p-form-grid"><label className="p-field p-search-field">
    <span>Buscar projeto</span>
    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, sigla ou descrição"/>
    </label><label className="p-field"><span>Etapa no catálogo</span><select value={phase} onChange={event=>setPhase(event.target.value)}><option value="all">Todas</option><option value="active">Em atividade</option><option value="past">Passados / históricos</option><option value="catalog">Catálogo / referência</option></select></label></div>{visible.length ? <div className="p-project-grid">{visible.map(p => <article className="p-card p-project-card" key={p.id}>
            <div className="p-row-between">
            <span className="p-icon-tile" style={{ borderTop: `3px solid ${/^#[\da-f]{6}$/i.test(p.color ?? '') ? p.color : '#3b1753'}` }}>
            <FolderKanban size={22}/>
            </span>
            <span className={`p-badge ${p.status === 'archived' ? 'p-status-closed' : 'p-status-active'}`}>{p.status === 'archived' ? 'Arquivado' : 'Ativo'}</span>
            </div><span className="p-kicker">{types.find(type=>type.id===p.type_id)?.label||'Projeto / área'}{p.lifecycle==='past'?' · Histórico':p.lifecycle==='catalog'?' · Catálogo':''}</span>{value(p, 'short_name', 'shortName') && <span className="p-kicker">{value(p, 'short_name', 'shortName')}</span>}<h3>{p.name}</h3>
            <p>{p.description || 'Descrição ainda não informada.'}</p>{p.location && <p className="p-metadata">
                <MapPin size={14}/>{p.location}</p>}{value(p, 'starts_at', 'startsAt') && <p className="p-metadata">
                <CalendarDays size={14}/>{prettyDay(value(p, 'starts_at', 'startsAt'))}{value(p, 'ends_at', 'endsAt') && ` até ${prettyDay(value(p, 'ends_at', 'endsAt'))}`}</p>}{value(p, 'official_url', 'officialUrl') && <a className="p-text-link" href={value(p, 'official_url', 'officialUrl')} target="_blank" rel="noreferrer">Página oficial <ExternalLink size={14}/>
                </a>}<div className="p-project-actions">
            <button className="p-text-link" onClick={() => setDetail(p.id)}>Acessar projeto <ArrowRight size={15}/>
            </button>{canEdit(p.id) && <button className="p-button p-button-subtle" disabled={opening} onClick={() => void edit(p)}>
                <Pencil size={14}/>Editar</button>}</div>
            </article>)}</div> : <div className="p-empty">
        <FolderKanban size={29}/>
        <h3>{query ? 'Nenhum projeto encontrado' : 'Nenhum projeto neste contexto'}</h3>
        <p>{canCreate ? 'Cadastre o projeto para organizar os materiais, a equipe e as próximas ações.' : 'Os projetos aparecerão conforme os acessos concedidos à sua conta.'}</p>
        </div>}</>}{detail&&onSelect&&<button type="button" className="p-button p-button-subtle" style={{marginTop:16}} onClick={()=>onSelect(detail)}>Usar este projeto nos outros módulos <ArrowRight size={14}/></button>}</section>;
}
