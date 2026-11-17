'use client';
import {useEffect,useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import {Archive,BookOpen,CheckCircle2,ChevronDown,ChevronLeft,ChevronRight,Clock3,ExternalLink,History,LoaderCircle,MailCheck,MailX,Pencil,Plus,RefreshCw,Search,Send,ShieldCheck,UserCheck,UserPlus,UserRoundPlus,X} from 'lucide-react';
import {toast} from 'sonner';
import {PROEX_TEAM,PROEX_TEAM_SOURCE} from '@/lib/catalog/proex-team';
import {DIRECTORY_STATES,directoryLabels,type DirectoryDetail,type DirectoryPerson,type DirectoryWorkspace} from '@/lib/directory/contracts';
import {DirectoryApiError,readDirectory,readDirectoryDetail,saveDirectory} from './directory-api';
import styles from './directory-panel.module.css';
import DirectoryInvite,{portalAction,type DirectoryInviteOptions} from './directory-invite';

type Props={userId:string;organizationId:string;
 /** Present when the person may invite in this organization; the server checks again. */
 invite?:DirectoryInviteOptions};
type Inviting={people:DirectoryPerson[];replaces?:{inviteId:string;role:string|null;projectId:string|null}|null};
const dayLabel=(value:string|null)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):'';
/** Can be invited now from the pre-registration: has an e-mail, data checked, no active invite and no access yet. */
const invitable=(person:DirectoryPerson)=>Boolean(person.contact)&&person.status==='pending'&&['none','expired','cancelled'].includes(person.invite?.state??'none');
type Editor={kind:'new'}|{kind:'official'}|{kind:'edit';person:DirectoryPerson};
type Job={controller:AbortController;epoch:number};
const message=(error:unknown)=>error instanceof Error?error.message:'Não foi possível concluir. Atualize e tente novamente.';
const dateLabel=(date:string)=>date.split('-').reverse().join('/');
const statusIcon={pending:Clock3,review:Search,archived:Archive};

/** Mount only in organization administration. The API independently enforces that boundary. */
export default function DirectoryPanel(props:Props){return <DirectoryBody key={JSON.stringify([props.userId,props.organizationId])} {...props}/>;}
function DirectoryBody({userId,organizationId,invite}:Props){
 const [inviting,setInviting]=useState<Inviting|null>(null),[picked,setPicked]=useState<string[]>([]),[cancelling,setCancelling]=useState('');
 const [open,setOpen]=useState(false),[attempt,setAttempt]=useState(0),[data,setData]=useState<DirectoryWorkspace|null>(null),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState('current'),[page,setPage]=useState(0),[editor,setEditor]=useState<Editor|null>(null),[detail,setDetail]=useState<DirectoryDetail|null>(null),[detailError,setDetailError]=useState(''),[busy,setBusy]=useState(false),[historyOpen,setHistoryOpen]=useState(false);
 const mounted=useRef(false),epoch=useRef(0),read=useRef<AbortController|null>(null),historyRead=useRef<AbortController|null>(null),write=useRef<Job|null>(null),operation=useRef<{payload:string;key:string}|null>(null),editorTitle=useRef<HTMLHeadingElement|null>(null),trigger=useRef<HTMLElement|null>(null);
 const ctx={userId,organizationId};
 /** Re-read after invites change, keeping the invite panel open with its links. */
 function reload(){const controller=new AbortController(),sequence=epoch.current;void readDirectory(ctx,controller.signal).then(result=>{if(mounted.current&&epoch.current===sequence)setData(result);}).catch(()=>undefined);}
 function openInvite(next:Inviting){clearEditor();setFeedback('');setInviting(next);}
 function closeInvite(){setInviting(null);setPicked([]);}
 async function cancelInvite(person:DirectoryPerson){
  const inviteId=person.invite?.inviteId;if(!inviteId||cancelling)return;setCancelling(person.id);setFeedback('');
  try{await portalAction('invite.revoke',{id:inviteId,operationKey:crypto.randomUUID()});if(!mounted.current)return;setFeedback(`Convite de ${person.name} cancelado. O link deixou de funcionar.`);toast.success('Convite cancelado.');invite?.onChanged?.();reload();}
  catch(cause){if(mounted.current){setFeedback(message(cause));toast.error(message(cause));}}
  finally{if(mounted.current)setCancelling('');}
 }
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;read.current?.abort();historyRead.current?.abort();write.current?.controller.abort();};},[]);
 useEffect(()=>{if(!open)return;const controller=new AbortController(),sequence=epoch.current;read.current=controller;void readDirectory({userId,organizationId},controller.signal).then(result=>{if(mounted.current&&!controller.signal.aborted&&epoch.current===sequence){setData(result);setError('');}}).catch(cause=>{if(mounted.current&&!controller.signal.aborted&&epoch.current===sequence){setData(null);setEditor(null);setDetail(null);setError(message(cause));}});return()=>controller.abort();},[open,attempt,userId,organizationId]);
 useEffect(()=>{if(editor){editorTitle.current?.focus({preventScroll:true});editorTitle.current?.scrollIntoView({block:'nearest'});}else if(trigger.current?.isConnected){trigger.current.focus();trigger.current=null;}},[editor]);
 function cancelJobs(){epoch.current++;read.current?.abort();historyRead.current?.abort();write.current?.controller.abort();write.current=null;setBusy(false);operation.current=null;}
 function clearEditor(){historyRead.current?.abort();setEditor(null);setDetail(null);setDetailError('');setHistoryOpen(false);operation.current=null;}
 function toggle(){cancelJobs();setInviting(null);setPicked([]);setOpen(value=>!value);setData(null);setError('');setFeedback('');clearEditor();}
 function refresh(){cancelJobs();setInviting(null);setPicked([]);setData(null);setError('');setFeedback('');clearEditor();setAttempt(value=>value+1);}
 function loadHistory(personId:string){historyRead.current?.abort();setDetail(null);setDetailError('');const controller=new AbortController(),sequence=epoch.current;historyRead.current=controller;void readDirectoryDetail(ctx,personId,controller.signal).then(value=>{if(mounted.current&&!controller.signal.aborted&&sequence===epoch.current)setDetail(value);}).catch(cause=>{if(!mounted.current||controller.signal.aborted||sequence!==epoch.current)return;if(cause instanceof DirectoryApiError&&[401,403].includes(cause.status)){setData(null);clearEditor();setError(message(cause));}else setDetailError(message(cause));});}
 function start(next:Editor,element:HTMLElement){clearEditor();trigger.current=element;setEditor(next);setFeedback('');if(next.kind==='edit')loadHistory(next.person.id);}
 async function save(input:Record<string,unknown>){
  if(!data||write.current)return;const payload=JSON.stringify(input);if(operation.current?.payload!==payload)operation.current={payload,key:crypto.randomUUID()};const job={controller:new AbortController(),epoch:epoch.current};write.current=job;setBusy(true);setFeedback('');
  const current=()=>mounted.current&&epoch.current===job.epoch&&!job.controller.signal.aborted&&write.current===job;
  try{await saveDirectory(ctx,{...input,operationKey:operation.current.key},job.controller.signal);if(!current())return;const verified=await readDirectory(ctx,job.controller.signal);if(!current())return;setData(verified);clearEditor();setFeedback('Pré-cadastro salvo. Nenhuma conta ou acesso foi criado.');toast.success('Pré-cadastro salvo.');}
  catch(cause){if(!current())return;if(cause instanceof DirectoryApiError&&[401,403].includes(cause.status)){setData(null);clearEditor();setError(message(cause));}setFeedback(message(cause));toast.error(message(cause));}
  finally{if(write.current===job){write.current=null;if(mounted.current)setBusy(false);}}
 }
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!editor||busy)return;const f=new FormData(event.currentTarget);if(editor.kind==='official'){void save({action:'official.prepare',referenceId:f.get('referenceId')});return;}void save({action:editor.kind==='edit'?'person.update':'person.create',...(editor.kind==='edit'?{personId:editor.person.id,expectedVersion:editor.person.version}:{}),name:f.get('name'),position:f.get('position'),sector:f.get('sector'),contact:f.get('contact'),status:f.get('status')});}
 const search=query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim(),matches=(data?.people??[]).filter(person=>(filter==='all'||filter==='current'&&person.status!=='archived'||person.status===filter)&&`${person.name} ${person.sector} ${person.position} ${person.contact}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').includes(search));
 const lastPage=Math.max(0,Math.ceil(matches.length/6)-1),currentPage=Math.min(page,lastPage),rows=matches.slice(currentPage*6,currentPage*6+6),prepared=new Set(data?.people.map(person=>person.referenceId));
 const selected=editor?.kind==='edit'?editor.person:null;
 function form(){return editor&&<form className={styles.editor} onSubmit={submit} onChange={()=>{if(!busy)operation.current=null;}} onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.preventDefault();clearEditor();}}}>
  <div className={styles.editorHeading}><h3 ref={editorTitle} tabIndex={-1}>{editor.kind==='new'?'Adicionar pré-cadastro':editor.kind==='official'?'Preparar pela referência oficial':'Editar pré-cadastro'}</h3><button type="button" disabled={busy} className="p-button p-button-subtle" onClick={clearEditor}><X size={16}/>Cancelar</button></div>
  <fieldset disabled={busy}>
  {editor.kind==='official'?<><label className="p-field"><span>Pessoa publicada pela PROEX</span><select name="referenceId" defaultValue="" required><option value="" disabled>Escolha uma referência</option>{PROEX_TEAM.map(person=><option key={person.id} value={person.id} disabled={prepared.has(person.id)}>{person.name}{prepared.has(person.id)?' · já preparado':''}{person.contactStatus==='needs-review'?' · contato a conferir':''}</option>)}</select></label><p className={styles.hint}>A fonte é uma cópia local conferida em{` ${dateLabel(PROEX_TEAM_SOURCE.verifiedAt)}`}. Dados com dúvida permanecem sinalizados. Nada é enviado à pessoa.</p><a href={PROEX_TEAM_SOURCE.url} target="_blank" rel="noreferrer" className="p-text-link">Conferir fonte oficial <ExternalLink size={14}/></a></>:<div className={styles.fields}>
   <label className="p-field"><span>Nome profissional *</span><input name="name" maxLength={160} required defaultValue={selected?.name??''}/></label>
   <label className="p-field"><span>Atuação</span><input name="position" maxLength={160} defaultValue={selected?.position??''}/></label>
   <label className="p-field"><span>Setor de referência</span><input name="sector" maxLength={160} defaultValue={selected?.sector??''}/></label>
   <label className="p-field"><span>E-mail de contato</span><input name="contact" inputMode="email" maxLength={254} autoComplete="off" defaultValue={selected?.contact??''}/><small>É uma referência de contato; não comprova a caixa postal.</small></label>
   <label className="p-field"><span>Situação</span><select name="status" defaultValue={selected?.status??'pending'}>{DIRECTORY_STATES.map(status=><option key={status} value={status}>{directoryLabels[status]}</option>)}</select></label>
  </div>}
  {selected?.contactStatus==='review'&&<p className={styles.warning}>O contato precisa de conferência. Corrija-o ou mantenha “Conferir dados”. Arquivar preserva o histórico.</p>}
  <div className={styles.save}><button type="submit" className="p-button p-button-primary">{busy?<LoaderCircle size={16} className="p-spin"/>:<CheckCircle2 size={16}/>} {busy?'Salvando…':editor.kind==='official'?'Preparar pré-cadastro':'Salvar pré-cadastro'}</button></div>
  </fieldset>
  {selected&&<div className={styles.history}><button type="button" className="p-text-link" onClick={()=>setHistoryOpen(value=>!value)} aria-expanded={historyOpen}><History size={16}/>Histórico de alterações <ChevronDown size={15}/></button>{historyOpen&&(detail?<><ol>{detail.history.map(row=><li key={row.version}><strong>Versão{` ${row.version}`} · {directoryLabels[row.person.status]}</strong><time dateTime={row.at}>{new Date(row.at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</time><span>{row.person.name}{row.person.position?` · ${row.person.position}`:''}</span>{row.person.contact&&<span>{row.person.contact}</span>}</li>)}</ol>{detail.historyHasMore&&<p className={styles.hint}>Mostrando as 50 alterações mais recentes. As anteriores permanecem preservadas.</p>}</>:detailError?<><p className="p-inline-error" role="alert">{detailError}</p><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={()=>loadHistory(selected.id)}><RefreshCw size={16}/>Tentar histórico novamente</button></>:<p role="status">Conferindo histórico…</p>)}</div>}
 </form>;}
 /** Invite situation of the person, in words: not invited, sent (with dates), expired, cancelled or already in. */
 function inviteLine(person:DirectoryPerson){
  const state=person.invite?.state??'none',sent=dayLabel(person.invite?.sentAt??null),until=dayLabel(person.invite?.expiresAt??null),where=person.invite?.projectName;
  if(state==='member')return <p className={`${styles.inviteState} ${styles.inviteMember}`}><UserCheck size={15} aria-hidden="true"/>Já tem acesso ao portal</p>;
  if(state==='pending')return <p className={`${styles.inviteState} ${styles.invitePending}`}><MailCheck size={15} aria-hidden="true"/>Convite enviado em {sent}{until?` · vale até ${until}`:''}{where?` · ${where}`:''}</p>;
  if(state==='expired')return <p className={styles.inviteState}><MailX size={15} aria-hidden="true"/>Convite expirado em {until}. Envie um novo.</p>;
  if(state==='cancelled')return <p className={styles.inviteState}><MailX size={15} aria-hidden="true"/>Convite cancelado</p>;
  if(!person.contact)return <p className={styles.inviteState}>Sem e-mail: edite o pré-cadastro para poder convidar.</p>;
  if(person.status==='review')return <p className={styles.inviteState}>Confira os dados antes de convidar.</p>;
  return person.status==='archived'?null:<p className={styles.inviteState}>Ainda não convidado</p>;
 }
 function inviteActions(person:DirectoryPerson){
  if(!invite||inviting||person.status==='archived')return null;const state=person.invite?.state??'none';
  if(state==='pending'&&person.invite?.inviteId)return <div className={styles.inviteActions}><button type="button" className="p-button p-button-subtle" disabled={busy||Boolean(cancelling)} aria-label={`Reenviar o convite de ${person.name}`} onClick={()=>openInvite({people:[person],replaces:{inviteId:person.invite!.inviteId!,role:person.invite!.role,projectId:person.invite!.projectId}})}><Send size={16} aria-hidden="true"/>Reenviar</button><button type="button" className={`p-text-link ${styles.cancelInvite}`} disabled={busy||Boolean(cancelling)} aria-label={`Cancelar o convite de ${person.name}`} onClick={()=>void cancelInvite(person)}>{cancelling===person.id?<LoaderCircle size={15} className="p-spin" aria-hidden="true"/>:<X size={15} aria-hidden="true"/>}Cancelar convite</button></div>;
  if(invitable(person))return <div className={styles.inviteActions}><button type="button" className="p-button p-button-primary" disabled={busy} aria-label={`Convidar ${person.name}`} onClick={()=>openInvite({people:[person]})}><UserPlus size={16} aria-hidden="true"/>{state==='none'?'Convidar':'Convidar de novo'}</button></div>;
  return null;
 }
 return <section className={`p-section ${styles.panel}`} aria-label="Pré-cadastros privados">
  <div className={styles.heading}><div><h2><UserRoundPlus size={22} aria-hidden="true"/>Pré-cadastros</h2><p>Prepare as pessoas da equipe antes de elas entrarem.</p></div><button type="button" onClick={toggle} className="p-button p-button-subtle" aria-expanded={open} aria-controls={`directory-private-${organizationId}`}>{open?<X size={17}/>:<ChevronDown size={17}/>} {open?'Fechar':'Preparar pessoas'}</button></div>
  <p className={styles.privacy}><ShieldCheck size={16} aria-hidden="true"/>Visível só à administração. Salvar um pré-cadastro não cria conta nem acesso: o convite só sai quando você clica em Convidar.</p>
  {open&&<div id={`directory-private-${organizationId}`}>
   <div className={styles.toolbar}><button type="button" className="p-button p-button-primary" disabled={!data||busy} onClick={event=>start({kind:'new'},event.currentTarget)}><Plus size={16}/>Adicionar pessoa</button><button type="button" className="p-button p-button-subtle" disabled={!data||busy} onClick={event=>start({kind:'official'},event.currentTarget)}><BookOpen size={16}/>Usar referência oficial</button><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={refresh}><RefreshCw size={16}/>Atualizar</button></div>
   {error&&<p className="p-inline-error" role="alert">{error}</p>}{feedback&&<p className={styles.feedback} role="status">{feedback}</p>}
   {!data&&!error&&<p className={styles.loading} role="status"><LoaderCircle className="p-spin" size={18}/>Consultando pré-cadastros…</p>}
   {data&&<><div className={styles.counts}>{(['pending','review','archived'] as const).map(status=>{const Icon=statusIcon[status];return <button key={status} type="button" aria-pressed={filter===status} onClick={()=>{setFilter(filter===status?'current':status);setPage(0);}}><Icon size={18}/><strong>{data.people.filter(person=>person.status===status).length}</strong><span>{directoryLabels[status]}</span></button>;})}</div>
    <div className={styles.filters}><label className="p-field"><span>Buscar pré-cadastro</span><div className="p-search"><Search size={16}/><input maxLength={160} value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}} placeholder="Nome, atuação ou setor"/></div></label><label className="p-field"><span>Situação</span><select value={filter} onChange={event=>{setFilter(event.target.value);setPage(0);}}><option value="current">Em preparação</option><option value="all">Todas</option>{DIRECTORY_STATES.map(status=><option value={status} key={status}>{directoryLabels[status]}</option>)}</select></label></div>
    {editor?.kind!=='edit'&&form()}
    <div className={styles.listBar}><p className={styles.hint} role="status">{matches.length} {matches.length===1?'pessoa encontrada':'pessoas encontradas'}</p>{invite&&rows.some(invitable)&&!inviting&&<div className={styles.pickBar}>{picked.length>0?<><span role="status">{picked.length} {picked.length===1?'selecionada':'selecionadas'}</span><button type="button" className="p-button p-button-primary" onClick={()=>openInvite({people:(data?.people??[]).filter(person=>picked.includes(person.id)&&invitable(person))})}><Send size={16} aria-hidden="true"/>Convidar selecionadas</button><button type="button" className="p-text-link" onClick={()=>setPicked([])}>Limpar seleção</button></>:<button type="button" className="p-button p-button-subtle" onClick={()=>setPicked(rows.filter(invitable).map(person=>person.id))}><CheckCircle2 size={16} aria-hidden="true"/>Selecionar todos para convidar</button>}</div>}</div>
    {invite&&inviting&&inviting.people.length>1&&<DirectoryInvite {...invite} people={inviting.people} onClose={closeInvite} onDone={reload}/>}
    {rows.length?<ul className={styles.cards}>{rows.map(person=>{const Icon=statusIcon[person.status];return <li key={person.id} className={`${styles.card} ${picked.includes(person.id)?styles.cardPicked:''}`}><div className={styles.cardTop}><div className={styles.cardTitle}>{invite&&invitable(person)&&!inviting&&<input type="checkbox" className={styles.pick} checked={picked.includes(person.id)} aria-label={`Selecionar ${person.name} para convidar`} onChange={event=>setPicked(current=>event.target.checked?[...current,person.id]:current.filter(id=>id!==person.id))}/>}<div><h3>{person.name}</h3><p>{person.position||'Atuação a informar'}{person.sector?` · ${person.sector}`:''}</p></div><span className={`${styles.badge} ${person.status==='review'?styles.review:''}`}><Icon size={14}/>{directoryLabels[person.status]}</span></div></div>{person.contact&&<p className={styles.contact}>{person.contact}</p>}{inviteLine(person)}<p className={styles.source}>{person.sourceKind==='official'?'Referência oficial':'Informado pela administração'}{person.adapted?' · dados adaptados':''} · v{person.version}</p><div className={styles.cardFooter}>{inviteActions(person)}{!inviting&&<button type="button" className="p-button p-button-subtle" disabled={busy} aria-label={`Editar pré-cadastro de ${person.name}`} aria-expanded={selected?.id===person.id} onClick={event=>start({kind:'edit',person},event.currentTarget)}><Pencil size={16}/>Editar</button>}</div>{selected?.id===person.id&&form()}{invite&&inviting?.people.length===1&&inviting.people[0].id===person.id&&<DirectoryInvite {...invite} people={inviting.people} replaces={inviting.replaces} onClose={closeInvite} onDone={reload}/>}</li>;})}</ul>:<p className="p-empty">Nenhum pré-cadastro neste recorte.</p>}
    {matches.length>6&&<nav className={styles.pagination} aria-label="Páginas de pré-cadastros"><button type="button" className="p-button p-button-subtle" disabled={busy||currentPage===0} onClick={()=>{clearEditor();setPage(currentPage-1);}}><ChevronLeft size={16}/>Anterior</button><span>{currentPage+1} de {lastPage+1}</span><button type="button" className="p-button p-button-subtle" disabled={busy||currentPage===lastPage} onClick={()=>{clearEditor();setPage(currentPage+1);}}>Próxima<ChevronRight size={16}/></button></nav>}
   </>}
  </div>}
 </section>;
}
