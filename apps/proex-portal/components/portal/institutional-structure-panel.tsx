'use client';

import {useEffect,useLayoutEffect,useRef,useState,type FormEvent,type KeyboardEvent,type ReactNode,type Ref} from 'react';
import {Archive,ArrowUpRight,BookOpen,Check,ChevronDown,GitBranch,Landmark,Link2,Network,Pencil,Plus,RefreshCw,ShieldCheck,Unlink,Users,X} from 'lucide-react';
import {toast} from 'sonner';
import {kindLabels,NODE_KINDS,OFFICIAL_SOURCE,OFFICIAL_TEMPLATE,relationLabels,type NodeKind,type Relation,type StructureNode,type StructureWorkspace,type TemplateNode} from '@/lib/institutional-structure/contracts';
import DateField from './date-field';
import ExportFormats,{type DocumentFormat} from './export-formats';
import {readStructure,saveStructure,StructureApiError,type StructureQuery} from './institutional-structure-api';
import {structureExportReport,structureFingerprint} from './institutional-structure-export';
import styles from './institutional-structure-panel.module.css';

type Props={userId:string;organizationId:string;projectId:string|null;onSelectTeam?:(id:string)=>void};
type Editor={kind:'node';node?:StructureNode}|{kind:'source'}|{kind:'links';node:StructureNode}|{kind:'status';node:StructureNode};
type Job={controller:AbortController;epoch:number};
const errorMessage=(cause:unknown)=>cause instanceof Error?cause.message:'Não foi possível concluir. Consulte novamente antes de tentar.';
const isAbort=(cause:unknown)=>cause instanceof Error&&cause.name==='AbortError';
const dateLabel=(value:string|null)=>value?value.split('-').reverse().join('/'):'Data não informada';
const display=(row:Record<string,unknown>,key:string)=>row[key]??'';
type OpenEditor=(editor:Editor,trigger?:HTMLElement|null)=>void;
/** The clicked control receives focus back when its editor is cancelled or saved. */
const opener=(event?:{currentTarget:EventTarget})=>event?event.currentTarget as HTMLElement:null;
const plural=(count:number,one:string,many:string)=>`${count} ${count===1?one:many}`;

/** A new account or scope gets a new lifetime, including closed disclosure and empty editors. */
export default function InstitutionalStructurePanel(props:Props){return <StructureBody key={JSON.stringify([props.userId,props.organizationId,props.projectId])} {...props}/>;}

function StructureBody({userId,organizationId,projectId,onSelectTeam}:Props){
 const [open,setOpen]=useState(false),[includeArchived,setIncludeArchived]=useState(false),[attempt,setAttempt]=useState(0);
 const [stored,setStored]=useState<{key:string;data:StructureWorkspace}|null>(null),[failure,setFailure]=useState<{key:string;message:string}|null>(null);
 const [editor,setEditor]=useState<Editor|null>(null),[preview,setPreview]=useState<TemplateNode[]|null>(null),[busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[feedback,setFeedback]=useState('');
 const mounted=useRef(false),epoch=useRef(0),readJob=useRef<AbortController|null>(null),mutation=useRef<Job|null>(null),exportJob=useRef<Job|null>(null),operation=useRef<{payload:string;key:string}|null>(null),editorHeading=useRef<HTMLHeadingElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 const query:StructureQuery={viewerId:userId,organizationId,projectId,includeArchived};
 const queryKey=JSON.stringify([userId,organizationId,projectId,includeArchived,attempt]);
 const data=open&&stored?.key===queryKey?stored.data:null,error=open&&failure?.key===queryKey?failure.message:'';
 const locked=busy||exporting,loading=open&&!data&&!error;

 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;readJob.current?.abort();mutation.current?.controller.abort();exportJob.current?.controller.abort();};},[]);
 useEffect(()=>{
  if(editor){editorHeading.current?.focus({preventScroll:true});editorHeading.current?.scrollIntoView({block:'start',behavior:'auto'});return;}
  const trigger=returnFocus.current;returnFocus.current=null;if(trigger?.isConnected)trigger.focus();
 },[editor]);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController(),sequence=epoch.current;readJob.current=controller;
  void readStructure({viewerId:userId,organizationId,projectId,includeArchived},controller.signal).then(result=>{
   if(mounted.current&&sequence===epoch.current&&!controller.signal.aborted){setStored({key:queryKey,data:result});setFailure(null);}
  }).catch(cause=>{
   if(!mounted.current||sequence!==epoch.current||controller.signal.aborted||isAbort(cause))return;
   setStored(null);setEditor(null);setPreview(null);setFailure({key:queryKey,message:errorMessage(cause)});
  });
  return()=>controller.abort();
 },[open,queryKey,userId,organizationId,projectId,includeArchived]);

 function cancelJobs(){returnFocus.current=null;epoch.current++;readJob.current?.abort();mutation.current?.controller.abort();exportJob.current?.controller.abort();mutation.current=null;exportJob.current=null;setBusy(false);setExporting(false);}
 function toggle(next:boolean){if(next===open)return;cancelJobs();setOpen(next);setStored(null);setFailure(null);setEditor(null);setPreview(null);setFeedback('');operation.current=null;}
 function refresh(nextArchived=includeArchived){cancelJobs();setStored(null);setFailure(null);setEditor(null);setPreview(null);setFeedback('');operation.current=null;setIncludeArchived(nextArchived);setAttempt(value=>value+1);}
 const showEditor:OpenEditor=(next,trigger)=>{returnFocus.current=trigger??null;setEditor(next);setPreview(null);setFeedback('');operation.current=null;};
 function cancelEditor(){if(mutation.current)return;setEditor(null);operation.current=null;setFeedback('Edição cancelada. Nada foi alterado.');}
 function clearUnauthorized(cause:unknown){if(cause instanceof StructureApiError&&[401,403].includes(cause.status)){setStored(null);setEditor(null);setPreview(null);setFailure({key:queryKey,message:errorMessage(cause)});}}
 async function save(input:Record<string,unknown>){
  if(!data?.scope.canManage||mutation.current||exportJob.current)return;
  const payload=JSON.stringify({...input,organizationId,expectedVersion:data.version});
  if(operation.current?.payload!==payload)operation.current={payload,key:crypto.randomUUID()};
  const job:Job={controller:new AbortController(),epoch:epoch.current};mutation.current=job;setBusy(true);setFeedback('');
  const current=()=>mounted.current&&epoch.current===job.epoch&&!job.controller.signal.aborted&&mutation.current===job;
  try{
   await saveStructure({...JSON.parse(payload),operationKey:operation.current.key},query,job.controller.signal);
   if(!current())return;
   const fresh=await readStructure(query,job.controller.signal);if(!current())return;
   setStored({key:queryKey,data:fresh});setFailure(null);setEditor(null);setPreview(null);operation.current=null;
   setFeedback('Estrutura salva e conferida no recorte atual.');toast.success('Estrutura institucional atualizada.');
  }catch(cause){if(current()&&!isAbort(cause)){clearUnauthorized(cause);setFeedback(errorMessage(cause));toast.error(errorMessage(cause));}}
  finally{if(mutation.current===job){mutation.current=null;if(mounted.current)setBusy(false);}}
 }
 async function exportFile(format:DocumentFormat){
  if(!data||mutation.current||exportJob.current)throw new Error('Aguarde a consulta atual antes de exportar.');
  const job:Job={controller:new AbortController(),epoch:epoch.current};exportJob.current=job;setExporting(true);setFeedback('');
  const guard=()=>{if(!mounted.current||epoch.current!==job.epoch||job.controller.signal.aborted||exportJob.current!==job)throw new DOMException('Exportação cancelada: o contexto mudou.','AbortError');};
  try{
   const fresh=await readStructure(query,job.controller.signal);guard();
   const report=structureExportReport(fresh,includeArchived),fingerprint=structureFingerprint(fresh);
   const {documentExport}=await import('./document-export'),{download}=await import('./report-export');guard();
   const artifact=await documentExport(format,report.title,report.columns,report.rows,display,report.info,report.presentation);guard();
   const verified=await readStructure(query,job.controller.signal);guard();
   if(fingerprint!==structureFingerprint(verified)){setStored({key:queryKey,data:verified});setEditor(null);setPreview(null);throw new Error('A estrutura ou seus acessos mudaram durante a preparação. Confira o resultado e exporte novamente.');}
   // No asynchronous work between the last authorization result and the file handoff.
   download(`proex-estrutura-institucional.${format}`,artifact);setStored({key:queryKey,data:verified});setFeedback(`${format.toUpperCase()} conferido e preparado para download.`);
  }catch(cause){if(mounted.current&&epoch.current===job.epoch&&!isAbort(cause)){clearUnauthorized(cause);setFeedback(errorMessage(cause));}throw cause;}
  finally{if(exportJob.current===job){exportJob.current=null;if(mounted.current)setExporting(false);}}
 }
 const linkedTeams=data?new Set(data.links.map(link=>link.teamId)).size:0;
 /* Existing units are edited in place, inside their own tree item; new units and the source stay above the tree.
    The section is one element built here and only placed by the tree, so inputs keep their identity. */
 const editingId=editor&&editor.kind!=='source'&&editor.node&&data?.nodes.some(node=>node.id===editor.node!.id)?editor.node.id:null;
 const editorSection=editor&&data?.scope.canManage?<EditorSection editor={editor} data={data} busy={locked} headingRef={editorHeading} onCancel={cancelEditor} onSave={input=>void save(input)}/>:null;
 return <details className={styles.panel} open={open} onToggle={event=>toggle(event.currentTarget.open)}>
  <summary className={styles.summary}><span className={styles.mark}><Network size={22} aria-hidden="true"/></span><span><strong>Estrutura institucional</strong><span>Unidades, governança e vínculos com as equipes</span></span><ChevronDown size={20} aria-hidden="true" className={styles.chevron}/></summary>
  {/* The body (and its live region) exists before the panel opens, so the first status is a change, not an insertion. */}
  <div className={styles.body}>
   {open&&<p className={styles.scope}><ShieldCheck size={16} aria-hidden="true"/><span>Vincular equipes não concede acesso a projetos ou dados. Exibimos somente vínculos autorizados.{data?.scope.canManage&&<strong> Alterações em unidades e na fonte valem para toda a organização.</strong>}</span></p>}
   {error&&<div role="alert" className="p-notice p-notice-error"><p>{error}</p><button type="button" className="p-button" onClick={()=>refresh()}>Consultar novamente</button></div>}
   {data&&<>
    <div className={styles.heading}><div><h3>{data.scope.organizationName}</h3><p>{data.scope.projectName} · versão {data.version}</p></div><div className={styles.actions}><button type="button" className="p-button" disabled={locked} onClick={()=>refresh()}><RefreshCw size={16} aria-hidden="true"/>Atualizar estrutura</button>{data.scope.canManage&&<button type="button" className="p-button p-button-primary" disabled={locked} onClick={event=>showEditor({kind:'node'},opener(event))}><Plus size={16} aria-hidden="true"/>Nova unidade</button>}</div></div>
    <ul className={styles.metrics} aria-label="Resumo da estrutura"><li><Landmark size={18} aria-hidden="true"/><strong>{data.nodes.length}</strong><span>Unidades visíveis</span></li><li><GitBranch size={18} aria-hidden="true"/><strong>{data.nodes.filter(node=>node.relation==='governance').length}</strong><span>Relações de governança</span></li><li><Users size={18} aria-hidden="true"/><strong>{linkedTeams}</strong><span>Equipes vinculadas</span></li></ul>
    {/* Collapsed by default: the summary keeps the source name and its meaning visible; details and the edit action expand on request. */}
    <details className={styles.reference}><summary className={styles.referenceSummary}><BookOpen size={18} aria-hidden="true"/><span><strong>Fonte: {data.source?.label||'ainda não registrada'}</strong><small>Fonte de referência; não certifica a estrutura vigente.</small></span><ChevronDown size={18} aria-hidden="true" className={styles.referenceChevron}/></summary>
     <div className={styles.referenceBody}><div><p>{data.source?`${data.source.revision?'Revisão '+data.source.revision+' · ':''}${dateLabel(data.source.issuedOn)} · ${data.source.adapted?'Adaptada localmente':'Referência oficial aplicada'}`:'Registre uma referência ou prepare o organograma público para revisão.'}</p>{data.source?.referenceUrl&&<a href={data.source.referenceUrl} target="_blank" rel="noopener noreferrer" className={styles.referenceLink}>Consultar documento oficial<ArrowUpRight size={15} aria-hidden="true"/></a>}</div>{data.scope.canManage&&<button className="p-button" type="button" disabled={locked} onClick={event=>showEditor({kind:'source'},opener(event))}><Pencil size={16} aria-hidden="true"/>Editar fonte</button>}</div>
    </details>
    <div className={styles.legend}><span><i aria-hidden="true"/>Subordinação</span><span><i className={styles.dashed} aria-hidden="true"/>Governança · relação consultiva ou colegiada</span>{data.scope.canManage&&<label className={styles.check}><input type="checkbox" checked={includeArchived} disabled={locked} onChange={event=>refresh(event.target.checked)}/>Mostrar arquivadas</label>}</div>
    {!data.nodes.length&&<div className={styles.empty}><Landmark size={28} aria-hidden="true"/><h4>Nenhuma unidade neste recorte</h4><p>{data.canApplyTemplate?'Cadastre uma unidade ou revise a referência pública antes de aplicá-la.':data.scope.canManage?'Cadastre uma unidade ou consulte as arquivadas para conferir o histórico.':'A estrutura institucional ainda não está disponível neste contexto.'}</p>{data.canApplyTemplate&&!preview&&<button type="button" className="p-button" disabled={locked} onClick={()=>{setEditor(null);setPreview(OFFICIAL_TEMPLATE.map(node=>({...node})));setFeedback('');}}>Preparar referência oficial</button>}</div>}
    {preview&&data.canApplyTemplate&&!data.nodes.length&&<TemplatePreview nodes={preview} busy={locked} onChange={setPreview} onCancel={()=>setPreview(null)} onApply={()=>void save({action:'template.apply',nodes:preview})}/>}
    {!editingId&&editorSection}
    {!!data.nodes.length&&<div className={styles.tree} aria-label="Organograma institucional"><NodeBranch parentId={null} depth={0} data={data} locked={locked} onEdit={showEditor} onSelectTeam={onSelectTeam} editingId={editingId} nodeEditor={editorSection}/></div>}
    <div className={styles.export}><div><h4>Levar a estrutura para um documento</h4><p>Unidades e vínculos visíveis neste recorte. Acesso e conteúdo são conferidos novamente antes de baixar.</p></div><ExportFormats onExport={exportFile} disabled={locked||!data.nodes.length} label="Baixar estrutura institucional"/></div>
    <p className={styles.updated}>Consultado em {new Date(data.asOf).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} (Brasília)</p>
   </>}
   {/* One polite region, mounted with the body and never replaced: it carries both the loading notice and later feedback. */}
   <p role="status" aria-live="polite" aria-atomic="true" className={loading?styles.loading:feedback?styles.feedback:styles.srOnly}>{loading?'Consultando a estrutura e os vínculos permitidos…':feedback}</p>
  </div>
 </details>;
}

type EditorProps={editor:Editor;data:StructureWorkspace;busy:boolean;headingRef:Ref<HTMLHeadingElement>;onCancel:()=>void;onSave:(input:Record<string,unknown>)=>void};
const editorTitles={source:'Referência do cadastro',links:'Vínculos com equipes',status:'Confirmar situação'} as const;
/** Top-level so its forms keep identity wherever the tree places it. Escape behaves like Cancelar and is ignored while anything is saving or exporting. */
function EditorSection(props:EditorProps){
 const {editor,data,busy,headingRef,onCancel,onSave}=props,node=editor.kind==='source'?undefined:editor.node,title=editor.kind==='node'?node?'Editar unidade':'Nova unidade formal':editorTitles[editor.kind];
 function keyDown(event:KeyboardEvent<HTMLElement>){if(event.key!=='Escape'||event.defaultPrevented||busy)return;event.preventDefault();event.stopPropagation();onCancel();}
 return <section className={styles.editor} aria-labelledby="institutional-structure-editor-title" onKeyDown={keyDown}>
  <h4 id="institutional-structure-editor-title" ref={headingRef} tabIndex={-1} className={styles.editorTitle}>{title}{node&&<><span className={styles.srOnly}> · </span><span className={styles.editorName} title={node.name}>{node.name}</span></>}</h4>
  {editor.kind==='node'&&<NodeForm key={editor.node?.id??'new'} node={editor.node} nodes={data.nodes} busy={busy} onCancel={onCancel} onSave={input=>onSave({action:'node.save',...input})}/>}
  {editor.kind==='source'&&<SourceForm data={data} busy={busy} onCancel={onCancel} onSave={input=>onSave({action:'source.save',...input})}/>}
  {editor.kind==='links'&&<LinkEditor data={data} node={editor.node} busy={busy} onCancel={onCancel} onSave={input=>onSave({action:'link.save',...input})}/>}
  {editor.kind==='status'&&<StatusEditor data={data} node={editor.node} busy={busy} onCancel={onCancel} onSave={()=>onSave({action:'node.status',id:editor.node.id,status:editor.node.status==='active'?'archived':'active'})}/>}
 </section>;
}

/** Branches up to the second level start open; deeper ones stay closed behind a summary that names and counts them. */
const OPEN_DEPTH=2;
type BranchProps={parentId:string|null;depth:number;data:StructureWorkspace;locked:boolean;onEdit:OpenEditor;onSelectTeam?:Props['onSelectTeam'];editingId:string|null;nodeEditor:ReactNode};
function NodeBranch({parentId,depth,data,locked,onEdit,onSelectTeam,editingId,nodeEditor}:BranchProps){
 const nodes=data.nodes.filter(node=>node.parentId===parentId).sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name,'pt-BR'));
 return <ul className={styles.branch}>{nodes.map(node=>{
  const teams=data.links.filter(link=>link.nodeId===node.id).map(link=>data.teams.find(team=>team.id===link.teamId)!);
  const children=data.nodes.filter(child=>child.parentId===node.id),governance=children.filter(child=>child.relation==='governance').length,subordinate=children.length-governance;
  const badge=node.status==='archived'?'Arquivada':node.relation==='governance'?relationLabels.governance:'';
  const childLabel=[subordinate&&plural(subordinate,'unidade subordinada','unidades subordinadas'),governance&&plural(governance,'unidade em governança','unidades em governança')].filter(Boolean).join(' · ');
  /* Below 600px only the icon shows: title gives pointer users the same full name that aria-label gives assistive tech. */
  const action=(label:string,Icon:typeof Pencil,next:Editor,name:string,quiet=false)=><button type="button" className={quiet?`p-button ${styles.quietAction}`:'p-button'} disabled={locked} aria-label={name} title={name} onClick={event=>onEdit(next,opener(event))}><Icon size={15} aria-hidden="true"/><span className={styles.actionLabel}>{label}</span></button>;
  return <li key={node.id} className={styles.node} data-relation={node.relation}><article className={styles.nodeCard} data-archived={node.status==='archived'}><div className={styles.nodeTitle}><span className={styles.nodeIcon}>{node.kind==='council'?<Users size={18} aria-hidden="true"/>:<Landmark size={18} aria-hidden="true"/>}</span><div><span className={styles.eyebrow}>{kindLabels[node.kind]}{node.acronym?' · '+node.acronym:''}</span><h4>{node.name}</h4></div>{badge&&<span className={styles.badge}>{badge}</span>}</div>
   {data.scope.canManage&&<div className={styles.nodeActions}>{node.status==='active'&&<>{action('Editar',Pencil,{kind:'node',node},`Editar ${node.name}`)}{action('Equipes',Link2,{kind:'links',node},`Vincular equipes: ${node.name}`)}</>}{node.status==='active'?action('Arquivar',Archive,{kind:'status',node},`Arquivar ${node.name}`,true):action('Reativar',RefreshCw,{kind:'status',node},`Reativar ${node.name}`)}</div>}
   {!!teams.length&&<ul className={styles.linkedTeams} aria-label={`Equipes vinculadas a ${node.name}`}>{teams.map(team=><li key={team.id}>{onSelectTeam?<button type="button" disabled={locked} className={styles.teamLink} onClick={()=>onSelectTeam(team.id)}><Users size={15} aria-hidden="true"/><span>{team.name}{team.status==='archived'?' · arquivada':''}</span><ArrowUpRight size={15} aria-hidden="true"/></button>:<span><Users size={15} aria-hidden="true"/>{team.name}{team.status==='archived'?' · arquivada':''}</span>}</li>)}</ul>}
  </article>{editingId===node.id&&nodeEditor}{!!children.length&&<details className={styles.children} open={depth<OPEN_DEPTH}><summary className={styles.childrenSummary}><ChevronDown size={16} aria-hidden="true"/><span>{childLabel}</span><span className={styles.srOnly}> de {node.name}</span></summary><NodeBranch parentId={node.id} depth={depth+1} data={data} locked={locked} onEdit={onEdit} onSelectTeam={onSelectTeam} editingId={editingId} nodeEditor={nodeEditor}/></details>}</li>;
 })}</ul>;
}
function CancelEdit({busy,onCancel}:{busy:boolean;onCancel:()=>void}){return <button type="button" className="p-button" disabled={busy} onClick={onCancel}><X size={16} aria-hidden="true"/>Cancelar</button>;}

function NodeForm({node,nodes,busy,onSave,onCancel}:{node?:StructureNode;nodes:StructureNode[];busy:boolean;onSave:(input:Record<string,unknown>)=>void;onCancel:()=>void}){
 const [parentId,setParentId]=useState(node?.parentId??''),[relation,setRelation]=useState<Relation>(node?.relation??'root');
 const descendants=new Set<string>(node?[node.id]:[]);let previous=-1;while(previous!==descendants.size){previous=descendants.size;for(const entry of nodes)if(entry.parentId&&descendants.has(entry.parentId))descendants.add(entry.id);}
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const values=new FormData(event.currentTarget);onSave({...(node?{id:node.id}:{}),parentId:parentId||null,name:values.get('name'),acronym:values.get('acronym'),kind:values.get('kind'),relation:parentId?relation:'root',position:Number(values.get('position'))});}
 return <form onSubmit={submit}><fieldset disabled={busy} className={styles.form}><label className={styles.wide}>Nome da unidade<input name="name" required maxLength={160} defaultValue={node?.name} placeholder="Nome completo da unidade"/></label><label>Sigla (opcional)<input name="acronym" maxLength={24} defaultValue={node?.acronym}/></label><label>Tipo<select aria-label="Tipo" name="kind" defaultValue={node?.kind??'unit'}>{NODE_KINDS.map(kind=><option value={kind} key={kind}>{kindLabels[kind]}</option>)}</select></label><label className={styles.wide}>Unidade superior<select aria-label="Unidade superior" value={parentId} onChange={event=>{setParentId(event.target.value);setRelation(event.target.value?(relation==='root'?'subordination':relation):'root');}}><option value="">Sem unidade superior (raiz)</option>{nodes.filter(entry=>entry.status==='active'&&!descendants.has(entry.id)).map(entry=><option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label><label>Relação<select aria-label="Relação institucional" value={parentId?relation:'root'} disabled={!parentId} onChange={event=>setRelation(event.target.value as Relation)}>{!parentId?<option value="root">Raiz</option>:<><option value="subordination">Subordinação</option><option value="governance">Governança</option></>}</select></label><label>Ordem entre unidades do mesmo nível<input name="position" type="number" min={0} max={999} required defaultValue={node?.position??0}/></label><p className={styles.wide}>Governança indica uma relação colegiada ou consultiva, diferente de subordinação administrativa.</p><div className={styles.formActions}><button className="p-button p-button-primary" type="submit"><Check size={16} aria-hidden="true"/>{busy?'Salvando…':'Salvar unidade'}</button><CancelEdit busy={busy} onCancel={onCancel}/></div></fieldset></form>;
}
function SourceForm({data,busy,onSave,onCancel}:{data:StructureWorkspace;busy:boolean;onSave:(input:Record<string,unknown>)=>void;onCancel:()=>void}){
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const values=new FormData(event.currentTarget);onSave({label:values.get('label'),revision:values.get('revision'),issuedOn:values.get('issuedOn')||null});}
 return <form onSubmit={submit}><fieldset disabled={busy} className={styles.form}><label className={styles.wide}>Nome da referência<input name="label" maxLength={120} required defaultValue={data.source?.label??''}/></label><label>Revisão (opcional)<input name="revision" maxLength={40} defaultValue={data.source?.revision??''}/></label><label>Data da referência (opcional)<DateField name="issuedOn" aria-label="Data da referência" defaultValue={data.source?.issuedOn??''}/></label><p className={styles.wide}>Ao editar, a referência passa a ser identificada como adaptada localmente. Isso não altera as permissões das equipes.</p><div className={styles.formActions}><button type="submit" className="p-button p-button-primary"><Check size={16} aria-hidden="true"/>{busy?'Salvando…':'Salvar fonte'}</button><CancelEdit busy={busy} onCancel={onCancel}/></div></fieldset></form>;
}
function LinkEditor({data,node,busy,onSave,onCancel}:{data:StructureWorkspace;node:StructureNode;busy:boolean;onSave:(input:Record<string,unknown>)=>void;onCancel:()=>void}){
 const links=data.links.filter(link=>link.nodeId===node.id),available=data.teams.filter(team=>team.status==='active'&&!links.some(link=>link.teamId===team.id));
 return <div className={styles.form}><p><strong>{node.name}</strong> · somente equipes visíveis neste recorte. Um vínculo não inclui pessoas ou permissões.</p>{!!links.length&&<ul className={styles.linkEditor}>{links.map(link=><li key={link.teamId}><span>{data.teams.find(team=>team.id===link.teamId)!.name}</span><button type="button" className="p-button" disabled={busy} onClick={()=>onSave({nodeId:node.id,teamId:link.teamId,linked:false})}><Unlink size={15} aria-hidden="true"/>Desvincular</button></li>)}</ul>}{available.length?<form onSubmit={event=>{event.preventDefault();const value=new FormData(event.currentTarget).get('teamId');onSave({nodeId:node.id,teamId:value,linked:true});}}><fieldset disabled={busy} className={styles.form}><label>Equipe<select aria-label="Equipe" name="teamId" required>{available.map(team=><option value={team.id} key={team.id}>{team.name}</option>)}</select></label><div className={styles.formActions}><button type="submit" className="p-button p-button-primary"><Link2 size={16} aria-hidden="true"/>Vincular equipe</button><CancelEdit busy={busy} onCancel={onCancel}/></div></fieldset></form>:<><p>Nenhuma outra equipe ativa está disponível neste recorte.</p><div className={styles.formActions}><CancelEdit busy={busy} onCancel={onCancel}/></div></>}</div>;
}
function StatusEditor({data,node,busy,onSave,onCancel}:{data:StructureWorkspace;node:StructureNode;busy:boolean;onSave:()=>void;onCancel:()=>void}){
 const blocked=node.status==='active'?(data.nodes.some(child=>child.parentId===node.id&&child.status==='active')?'Mova ou arquive as unidades subordinadas ativas primeiro.':data.links.some(link=>link.nodeId===node.id)?'Desvincule todas as equipes desta unidade primeiro, inclusive as arquivadas.':''):(node.parentId&&data.nodes.find(parent=>parent.id===node.parentId)?.status!=='active'?'Reative a unidade superior primeiro.':'');
 return <div className={styles.form}><p>{node.status==='active'?'Arquivar':'Reativar'} <strong>{node.name}</strong>?</p><p>{blocked||'O histórico será preservado. A ação não altera os acessos das pessoas ou das equipes.'}</p><div className={styles.formActions}><button type="button" className="p-button p-button-primary" disabled={busy||!!blocked} onClick={onSave}>{node.status==='active'?'Confirmar arquivamento':'Confirmar reativação'}</button><CancelEdit busy={busy} onCancel={onCancel}/></div></div>;
}
function TemplatePreview({nodes,busy,onChange,onCancel,onApply}:{nodes:TemplateNode[];busy:boolean;onChange:(nodes:TemplateNode[])=>void;onCancel:()=>void;onApply:()=>void}){
 function update(index:number,patch:Partial<TemplateNode>){onChange(nodes.map((node,i)=>i===index?{...node,...patch}:node));}
 return <section className={styles.editor} aria-label="Prévia editável da referência oficial"><div className={styles.heading}><div><h4>Revise antes de aplicar</h4><p>{OFFICIAL_SOURCE.label} · revisão {OFFICIAL_SOURCE.revision} · {dateLabel(OFFICIAL_SOURCE.issuedOn)}</p></div><button type="button" className="p-button" disabled={busy} onClick={onCancel}><X size={16} aria-hidden="true"/>Descartar prévia</button></div><p className="p-notice">Esta prévia usa somente o documento público. Não cadastra pessoas, não vincula equipes e não concede permissões. Você pode adaptar os nomes e relações antes de confirmar.</p><a className={styles.referenceLink} href={OFFICIAL_SOURCE.referenceUrl} target="_blank" rel="noopener noreferrer">Conferir documento oficial<ArrowUpRight size={15} aria-hidden="true"/></a><form onSubmit={event=>{event.preventDefault();onApply();}}><fieldset disabled={busy} className={styles.templateList}>{nodes.map((node,index)=><details key={node.key} className={styles.templateItem}><summary><span>{index+1}. {node.name}</span><ChevronDown size={16} aria-hidden="true"/></summary><div className={styles.form}><label className={styles.wide}>Nome da unidade<input required maxLength={160} value={node.name} onChange={event=>update(index,{name:event.target.value})}/></label><label>Sigla<input maxLength={24} value={node.acronym} onChange={event=>update(index,{acronym:event.target.value})}/></label><label>Tipo<select aria-label="Tipo" value={node.kind} onChange={event=>update(index,{kind:event.target.value as NodeKind})}>{NODE_KINDS.map(kind=><option value={kind} key={kind}>{kindLabels[kind]}</option>)}</select></label><label className={styles.wide}>Unidade superior<select aria-label="Unidade superior" value={node.parentKey??''} onChange={event=>update(index,{parentKey:event.target.value||null,relation:event.target.value?(node.relation==='root'?'subordination':node.relation):'root'})}><option value="">Sem unidade superior (raiz)</option>{nodes.slice(0,index).map(parent=><option value={parent.key} key={parent.key}>{parent.name}</option>)}</select></label><label>Relação<select aria-label="Relação" disabled={!node.parentKey} value={node.relation} onChange={event=>update(index,{relation:event.target.value as Relation})}>{node.parentKey?<><option value="subordination">Subordinação</option><option value="governance">Governança</option></>:<option value="root">Raiz</option>}</select></label><label>Ordem no nível<input type="number" min={0} max={999} required value={node.position} onChange={event=>update(index,{position:Number(event.target.value)})}/></label></div></details>)}<button type="submit" className="p-button p-button-primary"><Check size={17} aria-hidden="true"/>{busy?'Aplicando…':'Aplicar estrutura revisada'}</button></fieldset></form></section>;
}
