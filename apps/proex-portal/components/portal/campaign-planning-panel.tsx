'use client';

import {useEffect,useLayoutEffect,useRef,useState,type FormEvent,type KeyboardEvent} from 'react';
import {ArrowUpRight,Ban,CalendarClock,CheckCheck,ChevronDown,CircleCheck,CircleDashed,Clock,Link2,Lock,Pencil,Plus,RefreshCw,RotateCcw,Unlink,X} from 'lucide-react';
import {toast} from 'sonner';
import {PLANNING_LIMITS,SESSION_STATUSES,isCivilDate,isLocalTime,sessionTimeProblem,type HostLinkInput,type PlanningActionResult,type PlanningHost,type PlanningSession,type PlanningWorkspace,type SessionSaveInput,type SessionStatus,type SessionStatusInput} from '@/lib/campaign-planning/contracts';
import {parseClock} from '@/lib/date-time-field';
import DateField from './date-field';
import styles from './campaign-planning-panel.module.css';
import ExportFormats,{type DocumentFormat} from './export-formats';
import {planningExportReport,planningFingerprint} from './campaign-planning-export';

type ProjectOption={id:string;name:string;organizationId:string};
type Props={userId:string;campaignId:string;projectId:string;projects:ProjectOption[]};
type Scope={userId:string;campaignId:string;projectId:string};
type Body=Omit<HostLinkInput,'operationKey'>|Omit<SessionSaveInput,'operationKey'>|Omit<SessionStatusInput,'operationKey'>;
type Draft={id:string|null;baseVersion:number|null;baseHeader:number;sessionDate:string;ordinal:string;label:string;startsAt:string;endsAt:string;status:SessionStatus;note:string};
type Notice={tone:'error'|'success';text:string;refresh?:boolean};
type Job={controller:AbortController;epoch:number};

const ENDPOINT='/api/campaign-planning';
const STATUS:Record<SessionStatus,{label:string;Icon:typeof CircleCheck}>={
 tentative:{label:'Provisória',Icon:CircleDashed},
 confirmed:{label:'Confirmada',Icon:CircleCheck},
 done:{label:'Realizada',Icon:CheckCheck},
 cancelled:{label:'Cancelada',Icon:Ban},
};
const TRANSITIONS:Record<SessionStatus,{to:SessionStatus;label:string}[]>={
 tentative:[{to:'confirmed',label:'Confirmar'},{to:'cancelled',label:'Cancelar sessão'}],
 confirmed:[{to:'done',label:'Marcar realizada'},{to:'cancelled',label:'Cancelar sessão'}],
 done:[{to:'confirmed',label:'Desfazer realizada'}],
 cancelled:[{to:'tentative',label:'Reabrir como provisória'}],
};
const CAMPAIGN_STATUS={draft:'Rascunho',active:'Ativa',paused:'Pausada',closed:'Encerrada'} as const;

class PlanningApiError extends Error{
 status:number;code:string;
 constructor(message:string,status:number,code:string){super(message);this.name='PlanningApiError';this.status=status;this.code=code;}
}
const abortError=()=>{const error=new Error('Consulta cancelada.');error.name='AbortError';return error;};
const isAbort=(cause:unknown)=>cause instanceof Error&&cause.name==='AbortError';
const messageOf=(cause:unknown)=>cause instanceof Error&&cause.message?cause.message:'Não foi possível concluir. Atualize e tente novamente.';
const statusOf=(cause:unknown)=>cause instanceof PlanningApiError?cause.status:0;
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const isCount=(value:unknown,min:number)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min;
const isInstant=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));

function isSession(value:unknown):value is PlanningSession{
 return isObject(value)&&typeof value.id==='string'&&isCivilDate(value.sessionDate)&&isCount(value.ordinal,PLANNING_LIMITS.ordinalMin)&&(value.ordinal as number)<=PLANNING_LIMITS.ordinalMax
  &&typeof value.label==='string'&&(value.startsAt===null||isLocalTime(value.startsAt))&&(value.endsAt===null||isLocalTime(value.endsAt))
  &&(SESSION_STATUSES as readonly unknown[]).includes(value.status)&&typeof value.note==='string'&&isCount(value.version,1);
}
function isHost(value:unknown):value is PlanningHost{
 return isObject(value)&&typeof value.projectId==='string'&&typeof value.projectName==='string'&&(value.projectStatus==='active'||value.projectStatus==='archived')&&isInstant(value.linkedAt)&&typeof value.canManage==='boolean';
}
/** Shape plus identity: a response for another viewer, campaign or primary project is never shown. */
function isWorkspace(value:unknown,scope:Scope):value is PlanningWorkspace{
 if(!isObject(value)||!isObject(value.campaign))return false;
 const campaign=value.campaign;
 return value.viewerId===scope.userId&&value.campaignId===scope.campaignId&&value.primaryProjectId===scope.projectId
  &&typeof campaign.name==='string'&&typeof campaign.primaryProjectName==='string'&&typeof campaign.status==='string'&&campaign.status in CAMPAIGN_STATUS
  &&typeof value.canManage==='boolean'&&isCount(value.version,0)&&isInstant(value.asOf)
  &&Array.isArray(value.sessions)&&value.sessions.length<=PLANNING_LIMITS.sessions&&value.sessions.every(isSession)
  &&Array.isArray(value.hosts)&&value.hosts.length<=PLANNING_LIMITS.hosts&&value.hosts.every(isHost);
}
function isActionResult(value:unknown,scope:Scope):value is PlanningActionResult{
 return isObject(value)&&value.viewerId===scope.userId&&value.campaignId===scope.campaignId&&typeof value.entityId==='string'&&isCount(value.version,0)&&typeof value.duplicate==='boolean';
}

/** Same-origin cookie session only: no token, no local storage. */
async function call(url:string,signal:AbortSignal,body?:Record<string,unknown>):Promise<unknown>{
 let response:Response;
 try{
  response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal,...(body?{headers:{'Content-Type':'application/json','X-Proex-Action':'1'},body:JSON.stringify(body)}:{})});
 }catch(cause){
  if(signal.aborted||isAbort(cause))throw abortError();
  throw new PlanningApiError(body?'Sem confirmação do servidor. Seu rascunho foi preservado; tente de novo para reaproveitar a mesma operação, sem duplicar.':'Sem resposta do servidor. Confira a conexão e atualize.',0,'network');
 }
 let data:unknown=null;
 try{data=await response.json();}catch{
  if(signal.aborted)throw abortError();
  if(response.ok)throw new PlanningApiError('A resposta chegou incompleta. Atualize e tente novamente; a mesma operação será reaproveitada.',0,'incomplete');
 }
 if(signal.aborted)throw abortError();
 if(!response.ok){
  const message=isObject(data)&&typeof data.error==='string'?data.error:'Não foi possível concluir. Atualize e tente novamente.';
  throw new PlanningApiError(message,response.status,isObject(data)&&typeof data.code==='string'?data.code:'request_failed');
 }
 return data;
}
async function readWorkspace(scope:Scope,signal:AbortSignal):Promise<PlanningWorkspace>{
 const data=await call(`${ENDPOINT}?${new URLSearchParams({campaignId:scope.campaignId,projectId:scope.projectId})}`,signal);
 if(!isWorkspace(data,scope))throw new PlanningApiError('A resposta não corresponde a esta ação. Os dados foram ocultados; atualize para consultar de novo.',0,'mismatch');
 return data;
}

const civilDate=(iso:string)=>{const [y,m,d]=iso.split('-').map(Number);return new Date(Date.UTC(y,m-1,d));};
const dayFormat=new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'});
const shortFormat=new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'});
const instantFormat=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'});
const asOfFormat=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const dayLabel=(iso:string)=>{const text=dayFormat.format(civilDate(iso));return text.charAt(0).toLocaleUpperCase('pt-BR')+text.slice(1);};
const shortDay=(iso:string)=>shortFormat.format(civilDate(iso));
const timeValue=(value:string)=>value.slice(0,5);
/** Shows exactly what is recorded: a missing start or end is never filled in. */
const hoursText=(start:string|null,end:string|null)=>{
 const s=start?timeValue(start):'',e=end?timeValue(end):'';
 return s&&e?`${s} às ${e}`:s?`Início ${s} · fim a confirmar`:e?`Fim ${e} · início a confirmar`:'Horário a confirmar';
};
const sessionName=(session:Pick<PlanningSession,'label'|'ordinal'>)=>session.label.trim()||`Sessão ${session.ordinal}`;
const plural=(count:number,one:string,many:string)=>`${count} ${count===1?one:many}`;
const projectHref=(id:string)=>`/?module=projects&project=${encodeURIComponent(id)}&detailProject=${encodeURIComponent(id)}`;
/** Own toasts: short, bottom-right, always replaceable through the stored id. */
const TOAST_OPTIONS={duration:4000,position:'bottom-right'} as const;

function groupByDate(sessions:PlanningSession[]){
 const groups:{date:string;sessions:PlanningSession[]}[]=[];
 for(const session of sessions){
  const last=groups[groups.length-1];
  if(last?.date===session.sessionDate)last.sessions.push(session);else groups.push({date:session.sessionDate,sessions:[session]});
 }
 return groups;
}
function newDraft(data:PlanningWorkspace):Draft{
 const last=data.sessions[data.sessions.length-1],date=last?.sessionDate??'';
 const used=new Set(data.sessions.filter(session=>session.sessionDate===date).map(session=>session.ordinal));
 let ordinal=1;while(used.has(ordinal)&&ordinal<PLANNING_LIMITS.ordinalMax)ordinal++;
 return{id:null,baseVersion:null,baseHeader:data.version,sessionDate:date,ordinal:String(ordinal),label:'',startsAt:'',endsAt:'',status:'tentative',note:''};
}
function editDraft(data:PlanningWorkspace,session:PlanningSession):Draft{
 return{id:session.id,baseVersion:session.version,baseHeader:data.version,sessionDate:session.sessionDate,ordinal:String(session.ordinal),label:session.label,startsAt:session.startsAt??'',endsAt:session.endsAt??'',status:session.status,note:session.note};
}
/** Field-by-field view of the draft against the current row; display only, nothing is written. */
function compareRows(draft:Draft,row:PlanningSession){
 const date=(value:string)=>isCivilDate(value)?shortDay(value):'Data não informada';
 const text=(value:string,empty:string)=>value.trim()||empty;
 return[
  {key:'date',label:'Data',mine:date(draft.sessionDate),current:date(row.sessionDate)},
  {key:'ordinal',label:'Ordem no dia',mine:text(draft.ordinal,'Não informada'),current:String(row.ordinal)},
  {key:'label',label:'Nome',mine:text(draft.label,'Sem nome'),current:text(row.label,'Sem nome')},
  {key:'hours',label:'Horário',mine:hoursText(draft.startsAt||null,draft.endsAt||null),current:hoursText(row.startsAt,row.endsAt)},
  {key:'status',label:'Situação',mine:STATUS[draft.status].label,current:STATUS[row.status].label},
  {key:'note',label:'Observação',mine:text(draft.note,'Sem observação'),current:text(row.note,'Sem observação')},
 ].map(entry=>({...entry,changed:entry.mine!==entry.current}));
}

/** A new viewer, campaign or primary project gets a new lifetime: closed disclosure, no data, no draft. */
export default function CampaignPlanningPanel(props:Props){return <PlanningBody key={JSON.stringify([props.userId,props.campaignId,props.projectId])} {...props}/>;}

function PlanningBody({userId,campaignId,projectId,projects}:Props){
 const scope:Scope={userId,campaignId,projectId};
 const [open,setOpen]=useState(false),[data,setData]=useState<PlanningWorkspace|null>(null),[failure,setFailure]=useState('');
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[notice,setNotice]=useState<Notice|null>(null);
 const [editor,setEditor]=useState<Draft|null>(null),[formError,setFormError]=useState('');
 const [hostChoice,setHostChoice]=useState(''),[confirmUnlink,setConfirmUnlink]=useState<string|null>(null);
 const mounted=useRef(false),epoch=useRef(0),readJob=useRef<AbortController|null>(null),mutation=useRef<Job|null>(null),exportJob=useRef<Job|null>(null);
 const operation=useRef<{payload:string;key:string}|null>(null),returnFocus=useRef<HTMLElement|null>(null),editorHeading=useRef<HTMLHeadingElement>(null);
 const toastRef=useRef<string|number|null>(null),toastCount=useRef(0);
 const [openDays,setOpenDays]=useState<Record<string,boolean>>({});
 const editing=editor!==null;

 /** Removes only this panel's own last toast (success or error), never other modules' toasts. */
 function dismissToast(){if(toastRef.current!==null){toast.dismiss(toastRef.current);toastRef.current=null;}}
 function showToast(kind:'success'|'error',text:string){
  dismissToast();
  const id=`campaign-planning-${campaignId}-${++toastCount.current}`;
  toastRef.current=id;toast[kind](text,{...TOAST_OPTIONS,id});
 }

 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;readJob.current?.abort();mutation.current?.controller.abort();exportJob.current?.controller.abort();if(toastRef.current!==null){toast.dismiss(toastRef.current);toastRef.current=null;}};},[]);
 useEffect(()=>{
  if(editing){editorHeading.current?.focus({preventScroll:true});editorHeading.current?.scrollIntoView({block:'nearest'});return;}
  const trigger=returnFocus.current;returnFocus.current=null;if(trigger?.isConnected)trigger.focus();
 },[editing]);

 function clearAll(message:string){setData(null);setEditor(null);setConfirmUnlink(null);setHostChoice('');setFormError('');operation.current=null;setFailure(message);}
 function cancelJobs(){epoch.current++;readJob.current?.abort();readJob.current=null;mutation.current?.controller.abort();mutation.current=null;exportJob.current?.controller.abort();exportJob.current=null;setExporting(false);setBusy(false);setLoading(false);}

 /** keepDraft: a conflict refresh keeps the editor so the person can review it against the new version. */
 async function load(keepDraft:boolean){
  cancelJobs();
  const sequence=epoch.current,controller=new AbortController();readJob.current=controller;
  setLoading(true);setFailure('');setData(null);setConfirmUnlink(null);dismissToast();
  if(!keepDraft){setEditor(null);setNotice(null);setFormError('');operation.current=null;}
  try{
   const fresh=await readWorkspace(scope,controller.signal);
   if(!mounted.current||sequence!==epoch.current||controller.signal.aborted)return;
   setData(fresh);
   if(keepDraft)setNotice(current=>current?.refresh?{tone:'success',text:'Planejamento atualizado. Revise o rascunho antes de salvar.'}:current);
  }catch(cause){
   if(!mounted.current||sequence!==epoch.current||isAbort(cause))return;
   if([401,403].includes(statusOf(cause))){setNotice(null);clearAll(messageOf(cause));}
   else{setData(null);setFailure(messageOf(cause));}
  }finally{if(readJob.current===controller){readJob.current=null;if(mounted.current)setLoading(false);}}
 }
 function toggle(next:boolean){
  if(next===open)return;
  cancelJobs();dismissToast();setOpen(next);setData(null);setFailure('');setEditor(null);setNotice(null);setFormError('');setConfirmUnlink(null);setOpenDays({});operation.current=null;returnFocus.current=null;
  if(next)void load(false);
 }

 /** Sends one strict action; the operation key survives a lost response and changes with the payload. */
 async function mutate(input:Body,success:string,after?:()=>void){
  if(!data?.canManage||mutation.current||readJob.current||exportJob.current)return;
  const payload=JSON.stringify(input);
  if(operation.current?.payload!==payload)operation.current={payload,key:crypto.randomUUID()};
  const job:Job={controller:new AbortController(),epoch:epoch.current};mutation.current=job;setBusy(true);setNotice(null);dismissToast();
  const current=()=>mounted.current&&epoch.current===job.epoch&&!job.controller.signal.aborted&&mutation.current===job;
  let committed=false;
  try{
   const result=await call(ENDPOINT,job.controller.signal,{...input,operationKey:operation.current.key});
   if(!current())return;
   if(!isActionResult(result,scope))throw new PlanningApiError('A confirmação não corresponde a esta ação. Os dados foram ocultados; atualize para conferir.',403,'mismatch');
   committed=true;operation.current=null;
   const fresh=await readWorkspace(scope,job.controller.signal);
   if(!current())return;
   setData(fresh);setFailure('');after?.();
   const text=result.duplicate?`${success} A operação já estava registrada e não foi repetida.`:success;
   setNotice({tone:'success',text});showToast('success',text);
  }catch(cause){
   if(!current()||isAbort(cause))return;
   const status=statusOf(cause),message=messageOf(cause);
   dismissToast();
   if(committed||[401,403].includes(status)){
    setNotice(null);clearAll(committed&&![401,403].includes(status)?`A alteração foi registrada, mas a conferência falhou: ${message}`:message);
    showToast('error',committed?'Alteração registrada; atualize para conferir.':'Alteração não confirmada. Confira o aviso no planejamento.');
   }else if(status===409||status===404){
    // The inline conflict notice already guides the next step; no generic toast on top of it.
    setNotice({tone:'error',text:message,refresh:true});
   }else{
    setNotice({tone:'error',text:message});
    showToast('error','Alteração não confirmada. Confira o aviso no planejamento.');
   }
  }finally{if(mutation.current===job){mutation.current=null;if(mounted.current)setBusy(false);}}
 }

 async function exportFile(format:DocumentFormat){
  if(!data||mutation.current||readJob.current||exportJob.current||editing)throw new Error('Conclua a edição antes de exportar.');
  const job:Job={controller:new AbortController(),epoch:epoch.current};exportJob.current=job;setExporting(true);
  const guard=()=>{if(!mounted.current||epoch.current!==job.epoch||job.controller.signal.aborted||exportJob.current!==job)throw abortError();};
  try{
   const fresh=await readWorkspace(scope,job.controller.signal);guard();
   const fingerprint=planningFingerprint(fresh),report=planningExportReport(fresh);
   const {documentExport}=await import('./document-export'),{download}=await import('./report-export');guard();
   const artifact=await documentExport(format,report.title,report.columns,report.rows,(row,key)=>row[key]??'',report.info,report.presentation);guard();
   const verified=await readWorkspace(scope,job.controller.signal);guard();
   if(fingerprint!==planningFingerprint(verified)){setData(verified);throw new Error('O planejamento ou seus acessos mudaram. Confira e exporte novamente.');}
   // No asynchronous work between the final access/content fence and download.
   download(`proex-programacao-dinamica.${format}`,artifact);setData(verified);
  }catch(cause){if(mounted.current&&job.epoch===epoch.current&&!isAbort(cause)){dismissToast();if([401,403].includes(statusOf(cause)))clearAll(messageOf(cause));else setNotice({tone:'error',text:messageOf(cause),refresh:true});}throw cause;}
  finally{if(exportJob.current===job){exportJob.current=null;if(mounted.current)setExporting(false);}}
 }
 function openEditor(draft:Draft,trigger:HTMLElement|null){returnFocus.current=trigger;dismissToast();setEditor(draft);setFormError('');setNotice(null);setConfirmUnlink(null);}
 function cancelEditor(){if(mutation.current)return;dismissToast();setEditor(null);setFormError('');operation.current=null;setNotice({tone:'success',text:'Edição cancelada. Nada foi alterado.'});}
 function update<K extends keyof Draft>(field:K,value:Draft[K]){setEditor(current=>current&&{...current,[field]:value});setFormError('');}
 function normalizeTime(field:'startsAt'|'endsAt',value:string){const normalized=parseClock(value);if(normalized)update(field,normalized);}
 function editorKey(event:KeyboardEvent<HTMLFormElement>){
  // The date picker renders in a portal: its Escape closes only the calendar.
  if(event.key!=='Escape'||!event.currentTarget.contains(event.target as Node))return;
  event.preventDefault();event.stopPropagation();cancelEditor();
 }

 if(!open)return <details data-campaign-planning className={styles.panel} open={false} onToggle={event=>toggle(event.currentTarget.open)}><Summary/></details>;

 const sessions=data?.sessions??[],hosts=data?.hosts??[];
 const counts=SESSION_STATUSES.map(status=>({status,count:sessions.filter(session=>session.status===status).length})).filter(entry=>entry.count>0);
 const primaryOrg=data?projects.find(project=>project.id===data.primaryProjectId)?.organizationId:undefined;
 // The prop list only narrows the choice; the server checks authority on both projects.
 const candidates=data&&primaryOrg?projects.filter(project=>project.organizationId===primaryOrg&&project.id!==data.primaryProjectId&&!hosts.some(host=>host.projectId===project.id)).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')):[];
 const locked=busy||loading||exporting;

 function submitSession(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!data||!editor||locked)return;
  const ordinal=Number(editor.ordinal),startsAt=editor.startsAt?parseClock(editor.startsAt):null,endsAt=editor.endsAt?parseClock(editor.endsAt):null;
  if(!isCivilDate(editor.sessionDate))return setFormError('Informe a data da sessão em dd/mm/aaaa.');
  if(!Number.isInteger(ordinal)||ordinal<PLANNING_LIMITS.ordinalMin||ordinal>PLANNING_LIMITS.ordinalMax)return setFormError('A ordem da sessão no dia vai de 1 a 10.');
  if(editor.label.length>PLANNING_LIMITS.label)return setFormError('Use até 100 caracteres no nome.');
  if(editor.note.length>PLANNING_LIMITS.note)return setFormError('Use até 500 caracteres na observação.');
  const problem=sessionTimeProblem(editor.status,startsAt,endsAt);
  if(problem)return setFormError(problem);
  const base={action:'session.save' as const,campaignId,projectId,expectedVersion:editor.baseHeader,sessionDate:editor.sessionDate,ordinal,label:editor.label.trim(),startsAt,endsAt,status:editor.status,note:editor.note.trim()};
  const input:Omit<SessionSaveInput,'operationKey'>=editor.id&&editor.baseVersion!==null?{...base,id:editor.id,expectedSessionVersion:editor.baseVersion}:base;
  void mutate(input,editor.id?'Sessão atualizada e conferida.':'Sessão adicionada e conferida.',()=>{setEditor(null);setFormError('');});
 }
 function changeStatus(session:PlanningSession,to:SessionStatus){
  if(!data||locked)return;
  const problem=sessionTimeProblem(to,session.startsAt,session.endsAt);
  if(problem){dismissToast();setNotice({tone:'error',text:`${sessionName(session)}: ${problem} Use Editar para informar os horários.`});return;}
  const text=to==='cancelled'?`${sessionName(session)} cancelada. Use “Reabrir como provisória” para desfazer.`:`${sessionName(session)}: ${STATUS[to].label.toLocaleLowerCase('pt-BR')}.`;
  void mutate({action:'session.status',campaignId,projectId,expectedVersion:data.version,id:session.id,expectedSessionVersion:session.version,status:to},text);
 }
 function linkHost(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!data||locked||!candidates.some(project=>project.id===hostChoice))return;
  void mutate({action:'host.link',campaignId,projectId,expectedVersion:data.version,hostProjectId:hostChoice,linked:true},'Evento anfitrião vinculado e conferido.',()=>setHostChoice(''));
 }
 function unlinkHost(host:PlanningHost){
  if(!data||locked)return;
  void mutate({action:'host.link',campaignId,projectId,expectedVersion:data.version,hostProjectId:host.projectId,linked:false},`${host.projectName} desvinculado. É possível vincular de novo.`,()=>setConfirmUnlink(null));
 }

 const editedRow=editor?.id?sessions.find(session=>session.id===editor.id):undefined;
 const stale=!!(data&&editor&&(editor.baseHeader!==data.version||editor.id&&(!editedRow||editedRow.version!==editor.baseVersion)));
 const draftProblem=editor?sessionTimeProblem(editor.status,editor.startsAt?parseClock(editor.startsAt):null,editor.endsAt?parseClock(editor.endsAt):null):null;
 const comparison=editor&&editedRow&&stale?compareRows(editor,editedRow):[];
 const rowUnchanged=!!(editor&&editedRow&&editedRow.version===editor.baseVersion);
 const blockedText=!stale?'':editor?.id&&!editedRow?'Esta sessão saiu do planejamento. Cancele a edição para continuar.':'Revise as diferenças acima para liberar o salvamento.';
 const showDraftProblem=!!(editor&&draftProblem&&!formError&&(editor.startsAt||editor.endsAt||editor.status==='confirmed'||editor.status==='done'));
 const timeHelpIds=[`plan-time-help-${campaignId}`,showDraftProblem?`plan-time-warning-${campaignId}`:''].filter(Boolean).join(' ');

 /** Replaces the draft with the current row; nothing is sent until the person saves. */
 function adoptCurrentVersion(){if(!data||!editedRow||locked)return;setEditor(editDraft(data,editedRow));setFormError('');}
 /** Existing explicit confirmation: only the bases move to the current version, the fields stay as typed. */
 function keepMyDraft(){if(!data)return;setEditor(current=>current&&{...current,baseHeader:data.version,baseVersion:editedRow?editedRow.version:current.baseVersion});}
 function toggleDay(date:string,next:boolean){setOpenDays(current=>current[date]===next?current:{...current,[date]:next});}

 return <details data-campaign-planning className={styles.panel} open onToggle={event=>{if(event.target===event.currentTarget)toggle(event.currentTarget.open);}}>
  <Summary/>
  <div className={styles.body} aria-busy={locked}>
   <div className={styles.liveRegion} role="status" aria-live="polite">{loading?'Carregando o planejamento…':notice?.tone==='success'?notice.text:''}</div>

   {failure&&<div className={styles.failure} role="alert">
    <p>{failure}</p>
    <button type="button" onClick={()=>void load(editing)} disabled={locked}><RefreshCw size={16} aria-hidden="true"/>Consultar de novo</button>
   </div>}
   {loading&&!data&&<p className={styles.muted}>Carregando o planejamento…</p>}

   {data&&<>
    <header className={styles.heading}>
     <div>
      <p className={styles.owner}><strong>Responsável:</strong> {data.campaign.primaryProjectName}</p>
      <p className={styles.muted}>{data.campaign.name} · campanha {CAMPAIGN_STATUS[data.campaign.status].toLocaleLowerCase('pt-BR')} · consultado em <time dateTime={data.asOf}>{asOfFormat.format(new Date(data.asOf)).replace(', ',' às ')}</time> (horário de Brasília)</p>
     </div>
     <button type="button" className={styles.secondary} onClick={()=>void load(editing)} disabled={locked}><RefreshCw size={16} aria-hidden="true"/>Atualizar</button>
    </header>

    {!data.canManage&&<p className={styles.readOnly}><Lock size={16} aria-hidden="true"/><span>Somente consulta. Sessões e anfitriões são alterados por quem gerencia campanhas no projeto responsável.</span></p>}

    {notice?.tone==='error'&&<div className={styles.alert} role="alert">
     <p>{notice.text}</p>
     {notice.refresh&&<button type="button" onClick={()=>void load(true)} disabled={locked}><RefreshCw size={16} aria-hidden="true"/>Atualizar e revisar{editing?' o rascunho':''}</button>}
    </div>}
    {notice?.tone==='success'&&<p className={styles.success} aria-hidden="true">{notice.text}</p>}

    <section className={styles.section} aria-labelledby={`plan-sessions-${campaignId}`}>
     <div className={styles.sectionHead}>
      <h4 id={`plan-sessions-${campaignId}`}>Sessões propostas</h4>
      {data.canManage&&!editing&&<button type="button" className={`${styles.primary} p-button-primary`} disabled={locked||sessions.length>=PLANNING_LIMITS.sessions} onClick={event=>openEditor(newDraft(data),event.currentTarget)}><Plus size={16} aria-hidden="true"/>Adicionar sessão</button>}
     </div>
     <p className={styles.explain}>Proposta de organização. Sessões provisórias ainda dependem de confirmação. <span>Uma sessão provisória pode trazer horário sugerido; ele só passa a valer quando a gestão confirma a sessão.</span></p>
     {counts.length>0&&<p className={styles.totals}>{plural(sessions.length,'sessão','sessões')}: {counts.map(entry=>`${entry.count} ${STATUS[entry.status].label.toLocaleLowerCase('pt-BR')}${entry.count>1?'s':''}`).join(' · ')}</p>}

     {editor&&<form className={styles.editor} onSubmit={submitSession} onKeyDown={editorKey} noValidate aria-labelledby={`plan-editor-${campaignId}`}>
      <h5 id={`plan-editor-${campaignId}`} ref={editorHeading} tabIndex={-1}>{editor.id?'Editar sessão':'Nova sessão'}</h5>
      {stale&&<div className={styles.stale} role="note" aria-labelledby={`plan-stale-${campaignId}`}>
       {editor.id&&!editedRow
        ?<p id={`plan-stale-${campaignId}`}>Esta sessão não aparece mais no planejamento. Cancele a edição e confira a lista atual.</p>
        :<>
         <p id={`plan-stale-${campaignId}`}>
          <strong>O planejamento mudou desde que você abriu esta edição.</strong>{' '}
          {editedRow
           ?rowUnchanged?'Esta sessão não foi alterada; outra parte do planejamento mudou. Seu rascunho foi mantido.':'Seu rascunho foi mantido. Compare cada campo e escolha como continuar.'
           :'Outra parte do planejamento mudou. Seu rascunho foi mantido; confira a lista abaixo antes de salvar.'}
         </p>
         {comparison.length>0&&<ul className={styles.compare} aria-label="Comparação entre seu rascunho e a versão atual">
          {comparison.map(entry=><li key={entry.key} className={styles.compareRow} data-changed={entry.changed||undefined}>
           <p className={styles.compareField}>{entry.label}<span className={styles.compareFlag}>{entry.changed?'Diferente':'Igual'}</span></p>
           <dl className={styles.compareValues}>
            <div><dt>Seu rascunho</dt><dd>{entry.mine}</dd></div>
            <div><dt>Versão atual</dt><dd>{entry.current}</dd></div>
           </dl>
          </li>)}
         </ul>}
         <div className={styles.staleActions}>
          {editedRow&&<button type="button" onClick={adoptCurrentVersion} disabled={locked}><RotateCcw size={16} aria-hidden="true"/>Usar versão atual</button>}
          <button type="button" onClick={keepMyDraft} disabled={locked}><CircleCheck size={16} aria-hidden="true"/>Manter meu rascunho</button>
         </div>
        </>}
      </div>}
      <div className={styles.fields}>
       <div className={styles.field}><label htmlFor={`plan-date-${campaignId}`}>Data</label>
        <DateField id={`plan-date-${campaignId}`} aria-label="Data da sessão" value={editor.sessionDate} onValueChange={value=>update('sessionDate',value)} min="2000-01-01" max="2100-12-31" required disabled={busy}/>
       </div>
       <label className={`${styles.field} ${styles.ordinalField}`}><span>Ordem no dia</span>
        <input type="number" inputMode="numeric" min={PLANNING_LIMITS.ordinalMin} max={PLANNING_LIMITS.ordinalMax} step={1} required value={editor.ordinal} onChange={event=>update('ordinal',event.target.value)} disabled={busy}/>
       </label>
       <label className={`${styles.field} ${styles.wide}`}><span>Nome (opcional)</span>
        <input type="text" maxLength={PLANNING_LIMITS.label} value={editor.label} onChange={event=>update('label',event.target.value)} placeholder="Ex.: Rodada da manhã" disabled={busy}/>
       </label>
       <div className={styles.timePair}>
        <label className={styles.field}><span>Início</span>
         <input type="text" lang="pt-BR" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="hh:mm" value={editor.startsAt} onChange={event=>update('startsAt',event.target.value)} onBlur={event=>normalizeTime('startsAt',event.currentTarget.value)} aria-invalid={editor.startsAt&&!parseClock(editor.startsAt)?true:undefined} aria-describedby={timeHelpIds} disabled={busy}/>
        </label>
        <label className={styles.field}><span>Fim</span>
         <input type="text" lang="pt-BR" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="hh:mm" value={editor.endsAt} onChange={event=>update('endsAt',event.target.value)} onBlur={event=>normalizeTime('endsAt',event.currentTarget.value)} aria-invalid={editor.endsAt&&!parseClock(editor.endsAt)?true:undefined} aria-describedby={timeHelpIds} disabled={busy}/>
        </label>
        <p id={`plan-time-help-${campaignId}`} className={`${styles.hint} ${styles.timeHelp}`}>Use o formato de 24 horas, como 13:30. Deixe início e fim em branco enquanto o horário não estiver definido; a sessão aparece como “Horário a confirmar”. Em sessão provisória, o horário é uma sugestão até a gestão confirmar. Para confirmar ou marcar como realizada, informe os dois.</p>
        {showDraftProblem&&<p id={`plan-time-warning-${campaignId}`} className={`${styles.hintWarning} ${styles.timeHelp}`}>{draftProblem}</p>}
       </div>
       <label className={`${styles.field} ${styles.wide}`}><span>Situação</span>
        <select value={editor.status} onChange={event=>update('status',event.target.value as SessionStatus)} disabled={busy}>
         {SESSION_STATUSES.map(status=><option key={status} value={status}>{STATUS[status].label}</option>)}
        </select>
       </label>
       <label className={`${styles.field} ${styles.full}`}><span>Observação (opcional)</span>
        <textarea aria-label="Observação (opcional)" rows={3} maxLength={PLANNING_LIMITS.note} value={editor.note} onChange={event=>update('note',event.target.value)} aria-describedby={`plan-note-count-${campaignId}`} disabled={busy}/>
        <small id={`plan-note-count-${campaignId}`}>{editor.note.length}/{PLANNING_LIMITS.note} caracteres</small>
       </label>
      </div>
      {formError&&<p className={styles.formError} role="alert">{formError}</p>}
      <div className={styles.formActions}>
       <button type="submit" className={`${styles.primary} p-button-primary`} disabled={locked||stale} aria-describedby={stale?`plan-blocked-${campaignId}`:undefined}><CircleCheck size={16} aria-hidden="true"/>{busy?'Salvando…':editor.id?'Salvar alterações':'Adicionar sessão'}</button>
       <button type="button" className={styles.secondary} onClick={cancelEditor} disabled={busy}><X size={16} aria-hidden="true"/>Cancelar</button>
       {stale&&<p id={`plan-blocked-${campaignId}`} className={styles.blocked}>{blockedText}</p>}
      </div>
     </form>}

     {sessions.length===0
      ?<p className={styles.empty}>Nenhuma sessão planejada ainda.{data.canManage?' Use “Adicionar sessão” para começar.':''}</p>
      :<ol className={styles.days}>
       {groupByDate(sessions).map((group,index)=>{
        const tentative=group.sessions.filter(session=>session.status==='tentative').length;
        // Closed days keep every session in the DOM; only the disclosure state changes.
        return <li key={group.date} className={styles.day}>
        <details className={styles.dayGroup} open={openDays[group.date]??index===0} onToggle={event=>{if(event.target===event.currentTarget)toggleDay(group.date,event.currentTarget.open);}}>
        <summary className={styles.daySummary}>
         <ChevronDown size={16} className={styles.dayChevron} aria-hidden="true"/>
         <span className={styles.dayTitle}><time dateTime={group.date}>{dayLabel(group.date)}</time></span>
         <span className={styles.dayCount}>{plural(group.sessions.length,'sessão','sessões')} · {plural(tentative,'provisória','provisórias')}</span>
        </summary>
        <ul className={styles.sessions}>
         {group.sessions.map(session=>{
          const {label,Icon}=STATUS[session.status],name=sessionName(session),where=`${name}, ${shortDay(session.sessionDate)}`;
          return <li key={session.id} className={styles.session} data-status={session.status}>
           <div className={styles.sessionTop}>
            <div className={styles.sessionTitle}>
             <span className={styles.ordinal}>Sessão {session.ordinal}</span>
             <strong>{name}</strong>
            </div>
            <span className={styles.status} data-status={session.status}><Icon size={16} aria-hidden="true"/>{label}</span>
           </div>
           <p className={styles.time} data-pending={!(session.startsAt&&session.endsAt)||undefined}><Clock size={16} aria-hidden="true"/>
            {session.startsAt&&session.endsAt
             ?<span>{session.status==='tentative'?'Sugerido: ':''}<time dateTime={timeValue(session.startsAt)}>{timeValue(session.startsAt)}</time> às <time dateTime={timeValue(session.endsAt)}>{timeValue(session.endsAt)}</time></span>
             :<span>{session.status==='tentative'&&(session.startsAt||session.endsAt)?'Sugerido: ':''}{hoursText(session.startsAt,session.endsAt)}</span>}
           </p>
           {session.note&&<p className={styles.note}>{session.note}</p>}
           {data.canManage&&<div className={styles.sessionActions}>
            <button type="button" className={styles.secondary} disabled={locked||editing} onClick={event=>openEditor(editDraft(data,session),event.currentTarget)} aria-label={`Editar ${where}`}><Pencil size={16} aria-hidden="true"/>Editar</button>
            {TRANSITIONS[session.status].map(transition=><button key={transition.to} type="button" className={transition.to==='cancelled'?styles.quiet:styles.secondary} disabled={locked||editing} onClick={event=>transition.to==='confirmed'&&(!session.startsAt||!session.endsAt)?openEditor(editDraft(data,session),event.currentTarget):changeStatus(session,transition.to)} aria-label={`${transition.to==='confirmed'&&(!session.startsAt||!session.endsAt)?'Informar horário':transition.label}: ${where}`}>
             {transition.to==='cancelled'?<Ban size={16} aria-hidden="true"/>:transition.to==='tentative'||session.status==='done'?<RotateCcw size={16} aria-hidden="true"/>:<CircleCheck size={16} aria-hidden="true"/>}{transition.to==='confirmed'&&(!session.startsAt||!session.endsAt)?'Informar horário':transition.label}
            </button>)}
           </div>}
          </li>;
         })}
        </ul>
        </details>
       </li>;})}
      </ol>}
    </section>

    <section className={styles.section} aria-label="Exportar programação">
     <h4>Levar a programação</h4>
     <p className={styles.explain}>Documento do recorte atual, com horários provisórios identificados e acesso conferido antes do download.</p>
     <ExportFormats onExport={exportFile} disabled={locked||editing||!sessions.length} label="Baixar programação"/>
    </section>

    <section className={styles.section} aria-labelledby={`plan-hosts-${campaignId}`}>
     <div className={styles.sectionHead}><h4 id={`plan-hosts-${campaignId}`}>Evento anfitrião</h4></div>
     <p className={styles.explain}>Projetos da mesma organização que recebem as sessões. O projeto responsável continua sendo {data.campaign.primaryProjectName}.</p>
     {hosts.length===0
      ?<p className={styles.empty}>Nenhum evento anfitrião para mostrar.</p>
      :<ul className={styles.hosts}>
       {hosts.map(host=><li key={host.projectId} className={styles.host}>
        <div className={styles.hostInfo}>
         <a href={projectHref(host.projectId)} className={styles.hostLink}>{host.projectName}<ArrowUpRight size={16} aria-hidden="true"/></a>
         <span className={styles.muted}>Vinculado em {instantFormat.format(new Date(host.linkedAt))}{host.projectStatus==='archived'?' · projeto arquivado':''}</span>
        </div>
        {host.canManage&&data.canManage&&(confirmUnlink===host.projectId
         ?<div className={styles.confirm} role="group" aria-label={`Confirmar desvínculo de ${host.projectName}`}>
          <p>Desvincular {host.projectName}? Sessões e projetos não são apagados; é possível vincular de novo.</p>
          <div className={styles.formActions}>
           <button type="button" className={styles.quiet} disabled={locked} onClick={()=>unlinkHost(host)}><Unlink size={16} aria-hidden="true"/>{busy?'Desvinculando…':'Desvincular'}</button>
           <button type="button" className={styles.secondary} disabled={busy} onClick={()=>setConfirmUnlink(null)}>Manter vínculo</button>
          </div>
         </div>
         :<button type="button" className={styles.quiet} disabled={locked||editing} onClick={()=>{setConfirmUnlink(host.projectId);setNotice(null);}} aria-label={`Desvincular ${host.projectName}`}><Unlink size={16} aria-hidden="true"/>Desvincular</button>)}
       </li>)}
      </ul>}
     {data.canManage&&candidates.length>0&&hosts.length<PLANNING_LIMITS.hosts&&<form className={styles.linkForm} onSubmit={linkHost}>
      <label className={styles.field}><span>Vincular projeto anfitrião</span>
       <select value={hostChoice} onChange={event=>setHostChoice(event.target.value)} disabled={locked||editing}>
        <option value="">Escolha um projeto</option>
        {candidates.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
       </select>
      </label>
      <button type="submit" className={styles.secondary} disabled={locked||editing||!hostChoice}><Link2 size={16} aria-hidden="true"/>Solicitar vínculo</button>
      <p className={styles.hint}>O vínculo só é aceito se você também gerencia campanhas no projeto escolhido.</p>
     </form>}
    </section>
   </>}
  </div>
 </details>;
}

function Summary(){
 return <summary className={styles.summary}>
  <span className={styles.mark}><CalendarClock size={20} aria-hidden="true"/></span>
  <span className={styles.summaryText}><strong>Programação e evento anfitrião</strong><span>Sessões propostas por data e projetos que recebem a ação</span></span>
  <ChevronDown size={18} className={styles.chevron} aria-hidden="true"/>
 </summary>;
}
