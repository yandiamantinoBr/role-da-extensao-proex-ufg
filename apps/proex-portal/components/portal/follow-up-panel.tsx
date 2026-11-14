'use client';
import DateField from './date-field';
import { toast } from 'sonner';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, FolderKanban, ChartColumn, ClipboardCheck, FileText, Filter, Info, Pencil, Plus, RefreshCw, Search, Share2, Users, X } from 'lucide-react';
import { type Catalog, type Task, type Checklist, type MaterialChecklist, type Team, type TaskStatus, type TaskPriority, type DemandReportFilter, stateLabels, priorityLabels, TASK_STATES, TASK_PRIORITIES, manualShareUrl } from '@/lib/follow-up/contracts';
import { followupApi, followupChanged } from './follow-up-api';
import { DraftNotice, useFormDraft } from './use-form-draft';
import { TaskSignals } from './work-signals';
import { WorkTaskCard } from './work-task-card';
import filterStyles from './follow-up-filters.module.css';
import { TaskPageSummary } from './task-page-summary';
import { historyHref } from './history-timeline';
import { TaskTriage, TaskTriageMatrix } from './task-triage';
import styles from './follow-up-panel.module.css';
import FollowupTransferPanel from './followup-transfer-panel';
import { ActivityChecklistCreator, ActivityChecklistView } from './activity-checklist';
const activityAnswerLabels:Record<string,string>={yes:'Sim',no:'Não',not_applicable:'Não se aplica'};

const field='mt-1 min-h-11 w-full min-w-0 rounded-xl border bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] '+styles.field;
const button='justify-self-start max-w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--muted)] bg-[var(--canvas)] px-4 py-2 font-semibold text-[var(--ink)] disabled:opacity-50';
const primary='justify-self-start max-w-full p-button p-button-primary min-h-11 disabled:opacity-50';
const focusAnchor=styles.focusAnchor;
const emptyCatalog:Catalog={organizations:[],projects:[],people:[],teamPeople:[],teams:[],items:[],campaigns:[],loans:[],canEdit:false,canManageTeams:false};
const GENERAL_DEMANDS = '__organization__';
type Detail={task:Task;checklist:Checklist|null;workCandidates:{userId:string;name:string;canReceiveCoverage?:number}[];workGrants:{id:string;userId:string;canRecordActivity?:number}[];history:{version:number;createdAt:string;snapshot:{status:string;progressNote?:string;transfer?:{reason:string;fromProjectId?:string;toProjectId?:string};activityChecklistChange?:{kind:string;label?:string;after?:{answer:null|'yes'|'no'|'not_applicable';note:string};steps?:number}}}[]};
type ScheduleScope={id:string;title:string;status:string};
type Props={userId?:string;onTaskTransferred?:(receipt:{taskId:string;projectId:string})=>void;defaultProjectId?:string;defaultOrganizationId?:string;initialTaskId?:string;scheduleItemId?:string;canManageSchedule?:boolean;serverDay?:string;onChanged?:()=>void|Promise<void>;onSelectTask?:(id:string)=>void;onOpenReports?:(filters:DemandReportFilter & {projectId:string})=>void;basePath?:string};
type Save=(input:Record<string,unknown>)=>Promise<void>;
function selected(form:FormData,prefix:string){return[...form.entries()].filter(([key,value])=>key.startsWith(prefix)&&value==='on').map(([key])=>key.slice(prefix.length));}
function selectedReferences(form:FormData){
 return Object.fromEntries([...form.entries()].filter(([key])=>['campaignId','itemId','loanId'].includes(key)).map(([key,value])=>[key,value||null]));
}
function TaskReference({label,name,current,options}:{label:string;name:string;current?:string|null;options:{id:string;label:string}[]}) {
 const inaccessible=Boolean(current&&!options.some(option=>option.id===current));
 if(inaccessible)return <p className="text-sm text-[var(--muted)]">{label} vinculado. Para mudar este vínculo, peça à gestão.</p>;
 if(!options.length)return null;
 return <label>{label}<select name={name} defaultValue={current??''} className={field}><option value="">Sem vínculo</option>{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
}
function Assignments({catalog,users=[],teams=[]}:{catalog:Catalog;users?:string[];teams?:string[]}){return <div className="grid gap-3 @min-[640px]:grid-cols-2"><fieldset className="min-w-0 rounded-xl border border-[var(--line)] p-3"><legend className="px-1 font-semibold">Pessoas responsáveis</legend><div className="max-h-52 overflow-y-auto">{catalog.people.map(person=><label key={person.userId} className="flex min-h-11 items-center gap-2 break-words text-sm"><input type="checkbox" name={`person:${person.userId}`} defaultChecked={users.includes(person.userId)}/>{person.name}</label>)}{!catalog.people.length&&<p className="text-sm text-[var(--muted)]">Nenhum integrante elegível neste contexto.</p>}</div></fieldset><fieldset className="min-w-0 rounded-xl border border-[var(--line)] p-3"><legend className="px-1 font-semibold">Equipes responsáveis</legend><div className="max-h-52 overflow-y-auto">{catalog.teams.filter(team=>team.status==='active').map(team=><label key={team.id} className="flex min-h-11 items-center gap-2 break-words text-sm"><input type="checkbox" name={`team:${team.id}`} defaultChecked={teams.includes(team.id)}/>{team.name}</label>)}{!catalog.teams.some(team=>team.status==='active')&&<p className="text-sm text-[var(--muted)]">A administração pode cadastrar as equipes.</p>}</div></fieldset><p className="text-sm text-[var(--muted)] @min-[640px]:col-span-2">A atribuição e as equipes organizam o trabalho. Quem tem perfil de leitura só atualiza esta demanda após autorização explícita da gestão, sem receber acesso a estoque ou administração.</p></div>;}
function TaskEditor({catalog,task,organizationId,projectId,busy,save}:{catalog:Catalog;task?:Task;organizationId:string;projectId:string;busy:boolean;save:Save}){
 const form=useRef<HTMLFormElement>(null),operation=useRef<string|null>(null),draft=useFormDraft(form,`followup:task:${task?`${task.id}:${task.version}`:`new:${organizationId}:${projectId}`}`);
 const [saveError,setSaveError]=useState('');
 const saveButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(saveError&&!busy&&document.activeElement===document.body)saveButton.current?.focus();
 },[busy,saveError]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy)return;
  setSaveError('');
  const values=new FormData(event.currentTarget);
  operation.current??=crypto.randomUUID();
  try{
   await save({action:task?'task.update':'task.create',...(task?{id:task.id,expectedVersion:task.version}:{organizationId,projectId:projectId||null}),title:values.get('title'),body:values.get('body'),priority:values.get('priority'),importance:values.get('importance')||null,status:values.get('status'),dueAt:values.get('dueAt')||null,...selectedReferences(values),userIds:selected(values,'person:'),teamIds:selected(values,'team:'),operationKey:operation.current});
   draft.clear();
   operation.current=null;
  }catch(cause){
   setSaveError(cause instanceof Error?cause.message:'Não foi possível salvar a demanda.');
  }
 }
 return <form ref={form} onSubmit={event=>void submit(event)} className="mt-3 grid min-w-0 gap-4"><DraftNotice draft={draft}/><fieldset disabled={busy} className="grid min-w-0 gap-4"><label className="block min-w-0">Título<input name="title" required maxLength={160} defaultValue={task?.title} className={field} placeholder="Ex.: recontar bottons ou repor coletes"/></label><label className="block min-w-0">Orientações e contexto<textarea name="body" maxLength={4000} defaultValue={task?.body} rows={3} className={field}/></label><div className="grid min-w-0 gap-3 @min-[560px]:grid-cols-2"><label className="min-w-0">Prioridade (urgência)<select name="priority" defaultValue={task?.priority??'medium'} className={field}>{TASK_PRIORITIES.map(p=><option value={p} key={p}>{priorityLabels[p]}</option>)}</select></label><label className="min-w-0">Importância<select name="importance" defaultValue={task?.importance??''} className={field}><option value="">Sem classificação</option>{TASK_PRIORITIES.map(p=><option value={p} key={p}>{priorityLabels[p]}</option>)}</select></label><label className="min-w-0">Estado<select name="status" defaultValue={task?.status??'open'} className={field}>{TASK_STATES.map(s=><option value={s} key={s}>{stateLabels[s]}</option>)}</select></label><label className="min-w-0">Prazo<DateField aria-label="Prazo" name="dueAt" defaultValue={task?.due_at??''} className={field}/></label></div>
 {!!projectId&&Boolean(catalog.campaigns.length||catalog.items.length||catalog.loans.length||task?.campaign_id||task?.item_id||task?.loan_id)&&<details className="rounded-xl border border-[var(--line)] p-3">
  <summary className="flex min-h-11 cursor-pointer items-center font-medium">Vincular à demanda</summary>
  <div className="mt-2 grid gap-3 @min-[560px]:grid-cols-3">
   <TaskReference name="campaignId" label="Evento" current={task?.campaign_id} options={catalog.campaigns.map(c=>({id:c.id,label:c.name}))}/>
   <TaskReference name="itemId" label="Material" current={task?.item_id} options={catalog.items.map(i=>({id:i.id,label:i.name}))}/>
   <TaskReference name="loanId" label="Empréstimo" current={task?.loan_id} options={catalog.loans.map(l=>({id:l.id,label:l.action_name}))}/>
  </div>
 </details>}
 <Assignments catalog={catalog} users={task?.assignees.flatMap(a=>a.user_id?[a.user_id]:[])} teams={task?.assignees.flatMap(a=>a.team_id?[a.team_id]:[])}/><div><div role="alert">{saveError&&<p className="p-notice p-notice-error">{saveError}</p>}</div><button ref={saveButton} className={primary} type="submit">{busy?'Salvando…':task?'Salvar demanda':'Criar demanda'}</button></div></fieldset></form>;
}
function ChecklistCreator({catalog,organizationId,projectId,busy,save}:{catalog:Catalog;organizationId:string;projectId:string;busy:boolean;save:Save}){
 const form=useRef<HTMLFormElement>(null),operation=useRef<string|null>(null),draft=useFormDraft(form,`followup:checklist:new:${organizationId}:${projectId}`),[localError,setLocalError]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setLocalError('');const values=new FormData(event.currentTarget),rows=[];for(let index=0;index<20;index++){const item=String(values.get(`item-${index}`)??'');if(!item)continue;const raw=String(values.get(`expected-${index}`)??'');if(!raw.trim()){setLocalError('Informe a quantidade esperada de cada material selecionado.');return;}rows.push({itemId:item,size:String(values.get(`size-${index}`)??''),expected:Number(raw)});}if(!rows.length){setLocalError('Selecione ao menos um material para conferir.');return;}const campaignId=String(values.get('campaignId')??''),campaign=catalog.campaigns.find(c=>c.id===campaignId);operation.current??=crypto.randomUUID();await save({action:'checklist.create',organizationId,projectId,title:values.get('title'),campaignId:campaignId||null,closeCampaign:values.get('closeCampaign')==='on',...(campaign?{expectedCampaignVersion:campaign.version}:{}),rows,userIds:selected(values,'person:'),teamIds:selected(values,'team:'),operationKey:operation.current});draft.clear();operation.current=null;}
 const row=(index:number)=><div key={index} className="grid min-w-0 gap-2 rounded-xl border border-[var(--line)] p-3 @min-[560px]:grid-cols-[2fr_1fr_1fr]"><label>Material {index+1}<select name={`item-${index}`} className={field}><option value="">Não incluir</option>{catalog.items.map(item=><option value={item.id} key={item.id}>{item.name} ({item.unit})</option>)}</select></label><label>Tamanho ou variação<input name={`size-${index}`} maxLength={40} className={field} list="followup-size-options" placeholder="P, M, G ou único"/></label><label>Quantidade esperada<input type="number" name={`expected-${index}`} min={0} max={1000000} step={1} className={field}/></label></div>;
 return <form ref={form} className="grid gap-4" onSubmit={event=>void submit(event).catch(()=>{})}><DraftNotice draft={draft}/><fieldset disabled={busy} className="grid gap-4"><p className="text-sm text-[var(--muted)]">Cada tamanho conta como uma linha. Use somente materiais já cadastrados; a conferência não muda o estoque.</p><label className="block">Nome da conferência<input name="title" required maxLength={160} defaultValue="Conferência pós-evento" className={field}/></label>{catalog.campaigns.length>0&&<label className="block">Evento relacionado<select name="campaignId" className={field}><option value="">Conferência geral deste projeto</option>{catalog.campaigns.map(c=><option value={c.id} key={c.id}>{c.name} · {c.status==='closed'?'encerrado':'aberto'}</option>)}</select></label>}{catalog.canCloseCampaign&&<label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" name="closeCampaign" className="mt-1"/>Encerrar o evento escolhido e abrir esta revisão em uma única operação. Use apenas quando a atividade tiver terminado.</label>}<datalist id="followup-size-options"><option value="P"/><option value="M"/><option value="G"/><option value="Único"/></datalist>{row(0)}{[1,6,11,16].map(start=><details key={start} className="rounded-xl border border-[var(--line)] p-3"><summary className="min-h-11 cursor-pointer font-medium">Mais materiais e tamanhos ({start+1}–{Math.min(start+5,20)})</summary><div className="mt-3 space-y-3">{Array.from({length:Math.min(5,20-start)},(_,index)=>row(start+index))}</div></details>)}<Assignments catalog={catalog}/><div><div role="alert">{localError&&<p className="p-notice p-notice-error">{localError}</p>}</div><button type="submit" className={primary}>Criar conferência e demanda de revisão</button></div></fieldset></form>;
}
function CountRow({row,checklist,busy,canEdit,save}:{row:MaterialChecklist['rows'][number];checklist:MaterialChecklist;busy:boolean;canEdit:boolean;save:Save}){const form=useRef<HTMLFormElement>(null),operation=useRef<string|null>(null),draft=useFormDraft(form,canEdit?`followup:count:${row.id}`:null);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const values=new FormData(event.currentTarget);operation.current??=crypto.randomUUID();await save({action:'checklist.count',id:checklist.id,rowId:row.id,expectedVersion:checklist.version,counted:Number(values.get('counted')),damaged:Number(values.get('damaged')),note:values.get('note'),operationKey:operation.current});draft.clear();operation.current=null;}
 return <form ref={form} onSubmit={event=>void submit(event).catch(()=>{})} className="rounded-xl border border-[var(--line)] p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><strong className="break-words">{row.material}{row.size?` · ${row.size}`:''}</strong><span className="text-sm">Esperado: {row.expected}</span></div><DraftNotice draft={draft}/><fieldset disabled={busy||!canEdit||checklist.status==='completed'} className="grid gap-3"><div className="grid gap-3 @min-[560px]:grid-cols-2"><label>Contado<input name="counted" type="number" required min={0} max={1000000} step={1} defaultValue={row.counted??''} className={field}/></label><label>Desses, avariados<input name="damaged" type="number" required min={0} max={1000000} step={1} defaultValue={row.damaged} className={field}/></label></div><label className="mt-2 block">Observação<input name="note" maxLength={600} defaultValue={row.note} className={field}/></label>{canEdit&&checklist.status==='open'&&<button type="submit" className={button+' mt-3'}>Salvar contagem</button>}</fieldset>{row.counted!==null&&(row.counted!==row.expected||row.damaged>0)&&<p className="mt-2 text-sm text-[var(--brand-ink)]">Divergência registrada. O saldo do estoque continua preservado.</p>}</form>;}
function WorkerForm({task,busy,save}:{task:Task;busy:boolean;save:Save}){const form=useRef<HTMLFormElement>(null),operation=useRef<string|null>(null),draft=useFormDraft(form,`followup:work:${task.id}:${task.version}`);return <form ref={form} className="grid gap-3 rounded-xl border border-blue-300 p-3" onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget);operation.current??=crypto.randomUUID();void save({action:'task.work',id:task.id,status:values.get('status'),note:values.get('note'),expectedVersion:task.version,operationKey:operation.current}).then(()=>{draft.clear();operation.current=null;}).catch(()=>{});}}><h3 className="font-semibold">Acompanhar minha atribuição</h3><p className="text-sm">Autorização limitada a esta demanda. Ela não concede acesso a estoque ou administração.</p><DraftNotice draft={draft}/><fieldset disabled={busy||['completed','cancelled'].includes(task.status)} className="grid gap-3"><label className="block">Andamento<select name="status" defaultValue={task.status==='blocked'?'blocked':'in_progress'} className={field}>{(['in_progress','blocked','completed'] as const).map(s=><option key={s} value={s}>{stateLabels[s]}</option>)}</select></label><label className="mt-2 block">Atualização para a equipe<textarea name="note" rows={2} maxLength={1000} className={field}/></label><button className={primary+' mt-3'} type="submit">Salvar andamento</button></fieldset></form>;}
function WorkDelegation({detail,busy,save}:{detail:Detail;busy:boolean;save:Save}) {
 const operation=useRef<string|null>(null),[selectedUser,setSelectedUser]=useState('');
 const schedule=detail.checklist?.kind==='activity'?detail.checklist.scheduleItem:null;
 const candidate=detail.workCandidates.find(person=>person.userId===selectedUser);
 const canAddCoverage=Boolean(candidate?.canReceiveCoverage&&schedule&&schedule.status!=='cancelled'
   &&detail.checklist?.status==='open'&&!['completed','cancelled'].includes(detail.task.status));
 const available=detail.workCandidates.filter(person=>!detail.workGrants.some(grant=>grant.userId===person.userId));
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const values=new FormData(event.currentTarget);
  operation.current??=crypto.randomUUID();
  try {
   await save({action:'task.worker.grant',id:detail.task.id,userId:values.get('userId'),confirmed:values.get('confirmed')==='on',
    ...(canAddCoverage&&values.get('coverage')==='on'?{allowCoverage:true}:{}),operationKey:operation.current});
   operation.current=null;setSelectedUser('');
  } catch {/* A tela da demanda mostra o erro sem descartar a seleção. */}
 }
 return <details className="rounded-xl border border-[var(--line)] p-3">
  <summary className="min-h-11 cursor-pointer font-semibold">Autorizar atualizações nesta demanda</summary>
  <p className="mt-2 text-sm">A pessoa precisa continuar atribuída e ter acesso ao projeto. Ela pode atualizar o andamento e responder às verificações desta demanda.</p>
  {available.length>0&&<form className="mt-3 space-y-3" onSubmit={event=>void submit(event)} onChange={()=>{operation.current=null;}}>
   <fieldset disabled={busy} className="grid gap-3">
    <label>Responsável atribuído<select name="userId" required value={selectedUser} className={field} onChange={event=>setSelectedUser(event.target.value)}>
     <option value="">Escolha a pessoa</option>{available.map(person=><option key={person.userId} value={person.userId}>{person.name}</option>)}
    </select></label>
    {canAddCoverage&&<label key={selectedUser} className="flex min-h-11 items-center gap-2 text-sm">
     <input type="checkbox" name="coverage"/>
     Permitir que a pessoa crie registros e anexe fotos ou PDFs aos próprios registros desta atividade.
    </label>}
    <label className="my-2 flex min-h-11 items-center gap-2"><input type="checkbox" required name="confirmed"/>Autorizo somente as ações marcadas nesta demanda.</label>
    <button className={button} type="submit">Conceder autorização limitada</button>
   </fieldset>
  </form>}
  {detail.workGrants.length>0&&<ul className="mt-3 space-y-2">{detail.workGrants.map(grant=><li key={grant.id} className="flex flex-wrap items-center gap-3">
    <span>{detail.workCandidates.find(person=>person.userId===grant.userId)?.name??'Autorização de integrante anteriormente atribuído'}{grant.canRecordActivity?' · Pode registrar a cobertura':''}</span>
    {!!grant.canRecordActivity&&<button className={button} disabled={busy} type="button" onClick={()=>void save({action:'task.worker.coverage',id:detail.task.id,grantId:grant.id,allowCoverage:false,confirmed:true,operationKey:crypto.randomUUID()}).catch(()=>{})}>Retirar cobertura</button>}
    {!grant.canRecordActivity&&schedule&&schedule.status!=='cancelled'&&detail.checklist?.status==='open'
      &&!['completed','cancelled'].includes(detail.task.status)&&detail.workCandidates.some(person=>person.userId===grant.userId&&person.canReceiveCoverage)
      &&<button className={button} disabled={busy} type="button" onClick={()=>void save({action:'task.worker.coverage',id:detail.task.id,grantId:grant.id,allowCoverage:true,confirmed:true,operationKey:crypto.randomUUID()}).catch(()=>{})}>Autorizar fotos e registros</button>}
    <button className={button} disabled={busy} type="button" onClick={()=>void save({action:'task.worker.revoke',id:detail.task.id,grantId:grant.id,confirmed:true,operationKey:crypto.randomUUID()}).catch(()=>{})}>Revogar</button>
  </li>)}</ul>}
 </details>;
}
function TeamEditor({catalog,organizationId,team,busy,save}:{catalog:Catalog;organizationId:string;team?:Team;busy:boolean;save:Save}){const form=useRef<HTMLFormElement>(null),operation=useRef<string|null>(null),draft=useFormDraft(form,`followup:team:${team?`${team.id}:${team.version}`:'new'}:${organizationId}`);return <form ref={form} className="grid gap-3 rounded-xl border border-[var(--line)] p-3" onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget);operation.current??=crypto.randomUUID();void save({action:team?'team.update':'team.create',...(team?{id:team.id,expectedVersion:team.version}:{}),name:values.get('name'),status:values.get('status'),userIds:selected(values,'member:'),operationKey:operation.current}).then(()=>{draft.clear();operation.current=null;}).catch(()=>{});}}><DraftNotice draft={draft}/><fieldset disabled={busy} className="grid gap-3"><label>Nome da equipe<input name="name" required maxLength={100} defaultValue={team?.name} className={field}/></label><label className="mt-2 block">Situação<select name="status" defaultValue={team?.status??'active'} className={field}><option value="active">Ativa</option><option value="archived">Arquivada</option></select></label><div className="my-3 max-h-64 overflow-auto rounded-xl border border-[var(--line)] p-2">{catalog.teamPeople.map(person=><label className="flex min-h-11 items-center gap-2" key={person.userId}><input type="checkbox" name={`member:${person.userId}`} defaultChecked={team?.members.some(m=>m.userId===person.userId)}/>{person.name}</label>)}</div><button type="submit" className={button}>{team?'Salvar equipe':'Criar equipe'}</button></fieldset></form>;}

export default function FollowUpPanel({userId='',onTaskTransferred,defaultProjectId='',defaultOrganizationId='',initialTaskId='',scheduleItemId='',canManageSchedule=false,serverDay='',onChanged,onSelectTask,onOpenReports,basePath='/?module=demands'}:Props){
 const [projectId,setProjectId]=useState(defaultProjectId),[organizationId,setOrganizationId]=useState(defaultOrganizationId),[catalogStored,setCatalogStored]=useState<{key:string;data:Catalog|null}|null>(null),[tasksStored,setTasksStored]=useState<{key:string;tasks:Task[];hasMore:boolean;today:string;scheduleItem?:ScheduleScope}|null>(null),[loadedDetail,setDetail]=useState<Detail|null>(null),[selectedTask,setSelectedTask]=useState(initialTaskId),[appliedInitialTaskId,setAppliedInitialTaskId]=useState(initialTaskId),[form,setForm]=useState<'task'|'checklist'|'activity'|null>(null),[status,setStatus]=useState<TaskStatus|'all'>('all'),[priority,setPriority]=useState<TaskPriority|'all'>('all'),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),[teamCatalog,setTeamCatalog]=useState<Catalog|null>(null),[teamOrg,setTeamOrg]=useState('');
 const [generalOnly, setGeneralOnly] = useState(false);
 const searchInput = useRef<HTMLInputElement>(null);
 const refineSummary = useRef<HTMLElement>(null);
 const [taskReceipt,setTaskReceipt]=useState<{id:string;message:string}|null>(null);
 const [listError,setListError]=useState<{key:string;message:string}|null>(null);
 const [listAttempt,setListAttempt]=useState(0);
 const [editingTaskId,setEditingTaskId]=useState('');
 const editTrigger=useRef<HTMLButtonElement>(null),editHeading=useRef<HTMLHeadingElement>(null),pendingEditFocus=useRef<string|null>(null);
 const generation=useRef(0),listGeneration=useRef(0),detailGeneration=useRef(0),interactionEpoch=useRef(0),selectionEcho=useRef(initialTaskId),mutationPending=useRef(false),detailElement=useRef<HTMLHeadingElement>(null),teamRequest=useRef<AbortController|null>(null);
 const initialSelectionTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const detailRejectedFor=useRef<string|null>(null);
 const listHeading=useRef<HTMLHeadingElement>(null);
 const formHeading=useRef<HTMLHeadingElement>(null);
 const formTrigger=useRef<HTMLButtonElement|null>(null);
 const detailTrigger=useRef<{id:string;button:HTMLButtonElement}|null>(null);
 const catalogKey=JSON.stringify([projectId,organizationId]),listKey=JSON.stringify([projectId,organizationId,generalOnly,status,priority,search.trim(),offset,serverDay,scheduleItemId]);
 const catalogState=catalogStored?.key===catalogKey?catalogStored:null;
 const catalog=catalogState?.data??emptyCatalog,tasks=tasksStored?.key===listKey?tasksStored.tasks:[],hasMore=tasksStored?.key===listKey&&tasksStored.hasMore;
 // Catalog responses always carry the authorized navigation options for the account.
 // Keep only those options during scope changes. Editing still uses the matching catalog.
 const scopeCatalog=catalogStored?.data??emptyCatalog;
 const detail=appliedInitialTaskId===initialTaskId&&loadedDetail?.task.id===selectedTask
  &&(!scheduleItemId||(loadedDetail.task.project_id===projectId&&loadedDetail.checklist?.kind==='activity'&&loadedDetail.checklist.scheduleItem?.id===scheduleItemId))?loadedDetail:null;
 function selectTask(value:string){
  if(value&&value===selectedTask){
   const selectionQueued=selectionEcho.current!==value;
   const urlChanged=value!==initialTaskId;
   if(selectionQueued){
    // A URL timer may have queued another selection while this card is still on screen.
    selectionEcho.current=value;
    setSelectedTask(value);
   }
   if((selectionQueued||urlChanged)&&detailRejectedFor.current===value){
    // The rejection can be known before React applies the asynchronous state update.
    setDetail(null);
   }else if(selectionQueued&&loadedDetail?.task.id===value){
    setDetail(current=>current?.task.id===value?current:loadedDetail);
   }
   if(urlChanged){
    clearTimeout(initialSelectionTimer.current);
    setAppliedInitialTaskId(onSelectTask?value:initialTaskId);
    onSelectTask?.(value);
   }
   return;
  }
  detailGeneration.current++;
  interactionEpoch.current++;
  selectionEcho.current=value;
  detailTrigger.current=null;
  setSelectedTask(value);
  setTaskReceipt(null);
  setEditingTaskId('');
  pendingEditFocus.current=null;
  setDetail(null);
  setForm(null);
  onSelectTask?.(value);
 }
 useEffect(()=>()=>teamRequest.current?.abort(),[]);
 useEffect(()=>{if(detail?.task.id)detailElement.current?.focus();},[detail?.task.id]);
 useEffect(()=>{if(form)formHeading.current?.focus();},[form]);
 useEffect(()=>{
  const timer=setTimeout(()=>{
   initialSelectionTimer.current=undefined;
   setAppliedInitialTaskId(initialTaskId);
   if(selectionEcho.current===initialTaskId)return;
   selectionEcho.current=initialTaskId;
   detailTrigger.current=null;
   interactionEpoch.current++;
   // The detail effect cancels the old request when this selection is committed.
   setSelectedTask(initialTaskId);
   setDetail(null);
   setForm(null);
  },0);
  initialSelectionTimer.current=timer;
  return()=>{
   clearTimeout(timer);
   initialSelectionTimer.current=undefined;
  };
 },[initialTaskId]);
 useEffect(()=>{const controller=new AbortController(),current=++generation.current,query=new URLSearchParams({view:'catalog'});if(projectId)query.set('projectId',projectId);else if(organizationId)query.set('organizationId',organizationId);const start=setTimeout(()=>{setLoading(true);setError('');},0);void followupApi<Catalog>(query,undefined,controller.signal).then(value=>{if(controller.signal.aborted||current!==generation.current)return;setCatalogStored({key:catalogKey,data:value});const project=value.projects.find(p=>p.id===projectId);if(project&&project.organization_id!==organizationId)setOrganizationId(project.organization_id);setLoading(false);}).catch(cause=>{if(controller.signal.aborted||current!==generation.current)return;setCatalogStored({key:catalogKey,data:null});setLoading(false);setError(cause instanceof Error?cause.message:'Não foi possível consultar o contexto.');});return()=>{controller.abort();clearTimeout(start);};},[projectId,organizationId,revision,catalogKey]);
 useEffect(()=>{
  const controller=new AbortController(),current=++listGeneration.current;
  const query=new URLSearchParams({view:'tasks',status,priority,offset:String(offset)});
  if(projectId)query.set('projectId',projectId);
  if(organizationId)query.set('organizationId',organizationId);
  if(scheduleItemId)query.set('scheduleItemId',scheduleItemId);
  if(generalOnly)query.set('projectScope','organization');
  if(search.trim())query.set('search',search.trim());
  const timer=setTimeout(()=>void followupApi<{tasks:Task[];hasMore:boolean;today?:string;scheduleItem?:ScheduleScope}>(query,undefined,controller.signal)
   .then(value=>{
    if(controller.signal.aborted||current!==listGeneration.current)return;
    if(scheduleItemId&&value.scheduleItem?.id!==scheduleItemId)throw new Error('Não foi possível confirmar a atividade. Atualize a lista.');
    setTasksStored({key:listKey,tasks:value.tasks,hasMore:value.hasMore,today:value.today??'',scheduleItem:value.scheduleItem});
    setListError(null);
   })
   .catch(cause=>{
    if(controller.signal.aborted||current!==listGeneration.current)return;
    setTasksStored(null);
    setListError({key:listKey,message:cause instanceof Error?cause.message:'Não foi possível consultar as demandas.'});
   }),200);
  return()=>{clearTimeout(timer);controller.abort();};
 },[projectId,organizationId,generalOnly,status,priority,search,offset,revision,listKey,listAttempt,scheduleItemId]);
 useEffect(()=>{
  const current=++detailGeneration.current;
  if(!selectedTask)return;
  const controller=new AbortController();
  const query=new URLSearchParams({view:'detail',id:selectedTask});
  if(scheduleItemId){query.set('scheduleItemId',scheduleItemId);query.set('projectId',projectId);}
  void followupApi<Detail>(query,undefined,controller.signal).then(value=>{
   if(controller.signal.aborted||current!==detailGeneration.current)return;
   if(value.task.id===selectedTask&&detailRejectedFor.current===selectedTask)detailRejectedFor.current=null;
   setDetail(value);
   setForm(null);
  }).catch(cause=>{
   if(controller.signal.aborted||current!==detailGeneration.current)return;
   detailRejectedFor.current=selectedTask;
   setDetail(null);
   setError(cause instanceof Error?cause.message:'Não foi possível abrir a demanda.');
  });
  return()=>controller.abort();
 },[selectedTask,revision,scheduleItemId,projectId]);
 async function mutate(input:Record<string,unknown>){
  if(mutationPending.current)throw new Error('Aguarde a gravação atual.');
  mutationPending.current=true;
  const epoch=interactionEpoch.current,isTaskEditor=input.action==='task.create'||input.action==='task.update';
  setBusy(true);setError('');
  if(isTaskEditor)setTaskReceipt(null);
  try{
   const result=await followupApi<Detail>('',input);
   if(result.task&&epoch===interactionEpoch.current){
    detailGeneration.current++;selectionEcho.current=result.task.id;setSelectedTask(result.task.id);setDetail(result);setForm(null);onSelectTask?.(result.task.id);
    if(isTaskEditor)setTaskReceipt({id:result.task.id,message:'Demanda salva.'});
   }
   setRevision(value=>value+1);followupChanged();toast.success(isTaskEditor?'Demanda salva.':'Atualização registrada.');
   if(isTaskEditor){
    try{await onChanged?.();}catch{
     if(result.task&&epoch===interactionEpoch.current)setTaskReceipt({id:result.task.id,message:'Demanda salva. Atualize o portal para conferir as outras telas.'});
    }
   }else await onChanged?.();
  }catch(cause){
   if(!isTaskEditor||epoch!==interactionEpoch.current)setError(cause instanceof Error?cause.message:'Não foi possível salvar.');
   throw cause;
  }finally{mutationPending.current=false;setBusy(false);}
 }
 function changeScope(nextProject:string,nextOrganization:string,nextGeneral=false){
  if(nextProject!==projectId||nextOrganization!==organizationId)generation.current++;
  if(nextProject!==projectId||nextOrganization!==organizationId||nextGeneral!==generalOnly)listGeneration.current++;
  setProjectId(nextProject);
  setOrganizationId(nextOrganization);
  setGeneralOnly(nextGeneral);
  selectTask('');
  teamRequest.current?.abort();
  setOffset(0);
  setTeamCatalog(null);
 }
 function chooseProject(value:string){
  const chosen=scopeCatalog.projects.find(project=>project.id===value);
  changeScope(chosen?.id??'',chosen?.organization_id??organizationId,value===GENERAL_DEMANDS);
 }
 function filterStatus(value:TaskStatus|'all'){setStatus(value);setOffset(0);}
 function filterPriority(value:TaskPriority|'all'){setPriority(value);setOffset(0);}
 function clearFilters(){
  searchInput.current?.focus({preventScroll:true});
  setSearch('');
  setStatus('all');
  setPriority('all');
  setOffset(0);
 }
 async function openTeams(){teamRequest.current?.abort();const controller=new AbortController();teamRequest.current=controller;setError('');try{const value=await followupApi<Catalog>(new URLSearchParams({view:'catalog',organizationId}),undefined,controller.signal);if(controller.signal.aborted)return;setTeamCatalog(value);setTeamOrg(organizationId);}catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Não foi possível consultar as equipes.');}}
 async function saveTeam(input:Record<string,unknown>){await mutate({...input,organizationId:teamOrg});teamRequest.current?.abort();const controller=new AbortController();teamRequest.current=controller;const value=await followupApi<Catalog>(new URLSearchParams({view:'catalog',organizationId:teamOrg}),undefined,controller.signal);if(!controller.signal.aborted)setTeamCatalog(value);}
 const listReady=tasksStored?.key===listKey,visualToday=listReady?tasksStored.today:'';
 const listFailure=listError?.key===listKey?listError.message:'';
 const activeSchedule=listReady?tasksStored.scheduleItem:undefined;
 const canCreateChecklist=catalog.canEdit&&!!projectId&&(!scheduleItemId||(canManageSchedule&&!!activeSchedule&&activeSchedule.status!=='cancelled'));
 const demandProjectUrl=`/?module=demands&project=${encodeURIComponent(projectId)}`;
 const activityRecordsUrl=`/?module=records&view=documents&project=${encodeURIComponent(projectId)}&scheduleItemId=${encodeURIComponent(scheduleItemId)}`;
 const activeFilters=Number(!!search.trim())+Number(status!=='all')+Number(priority!=='all');
 const canChooseGeneral=scopeCatalog.organizations.some(org=>org.id===organizationId&&org.canManage);
 const canCreateDemand=catalog.canEdit&&Boolean(projectId||generalOnly);
 const materialChecklist=detail?.checklist?.kind==='activity'?null:detail?.checklist;
 const currentTask=detail?.task,contextOrg=organizationId||catalog.projects.find(p=>p.id===projectId)?.organization_id||'';
 const editingContextMatches=!!currentTask&&(currentTask.project_id??'')===projectId&&currentTask.organization_id===organizationId;
 const scopedCatalog=editingContextMatches?catalogState?.data:null;
 const editingCatalogUnavailable=editingContextMatches&&catalogState?.data===null;
 const editOpen=Boolean(currentTask?.canEdit&&editingTaskId===currentTask.id);
 useEffect(()=>{
  if(!editOpen||pendingEditFocus.current!==currentTask?.id)return;
  const target=editHeading.current;
  if(!target)return;
  pendingEditFocus.current=null;
  target.focus({preventScroll:true});
  target.scrollIntoView({block:'nearest'});
 },[editOpen,currentTask?.id]);
 function openTask(id:string,button?:HTMLButtonElement){
  selectTask(id);
  detailTrigger.current=button?{id,button}:null;
 }
 function openForm(kind:'task'|'checklist'|'activity',trigger?:HTMLButtonElement){
  selectTask('');
  formTrigger.current=trigger??null;
  setForm(kind);
 }
 function closeForm(){
  const trigger=formTrigger.current;
  formTrigger.current=null;
  setForm(null);
  if(trigger?.isConnected)trigger.focus();
 }
 function retryTasks(){
  listHeading.current?.focus();
  setListError(null);
  setListAttempt(value=>value+1);
 }
 function closeTask(){
  const trigger=detailTrigger.current;
  detailTrigger.current=null;
  selectTask('');
  const epoch=interactionEpoch.current;
  window.requestAnimationFrame(()=>{
   if(epoch!==interactionEpoch.current)return;
   const target=trigger?.id===currentTask?.id&&trigger?.button.isConnected?trigger.button:listHeading.current;
   target?.focus();
  });
 }
 function loadEditingCatalog(){
  if(!currentTask)return;
  if(editingContextMatches){setCatalogStored(null);setRevision(value=>value+1);return;}
  generation.current++;listGeneration.current++;
  setOrganizationId(currentTask.organization_id);
  setProjectId(currentTask.project_id??'');
  setGeneralOnly(!currentTask.project_id);
 }
 function openTaskEditor(){
  if(!currentTask?.canEdit||busy)return;
  pendingEditFocus.current=currentTask.id;
  setEditingTaskId(currentTask.id);
  if(!editingContextMatches||editingCatalogUnavailable)loadEditingCatalog();
  if(editOpen){pendingEditFocus.current=null;editHeading.current?.focus();}
 }
 function closeTaskEditor(restoreFocus=true){
  if(busy)return;
  pendingEditFocus.current=null;setEditingTaskId('');
  if(restoreFocus)editTrigger.current?.focus({preventScroll:true});
 }
 return <section data-activity={Boolean(scheduleItemId)} className={`@container grid min-w-0 gap-6 ${filterStyles.section}`} aria-labelledby="followup-title"><header className={`flex flex-wrap items-start justify-between gap-4 ${filterStyles.header}`}><div className="grid gap-1"><h2 className="sr-only" id="followup-title">Demandas e conferências</h2><p className="hidden text-sm text-[var(--muted)] @min-[560px]:block">{scheduleItemId?'Distribua e acompanhe as frentes deste compromisso.':'Conferências registram diferenças e avarias sem alterar o estoque.'}</p></div><div className="flex flex-wrap gap-2">{onOpenReports&&<button className={`${button} ${filterStyles.reports}`} type="button" onClick={()=>onOpenReports({projectId,organizationId,generalOnly,status,priority,search:search.trim()})}><ChartColumn size={16} aria-hidden="true"/>Relatório do recorte</button>}<button className={`${button} ${filterStyles.refresh}`} type="button" disabled={busy} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={16} aria-hidden="true"/><span className={filterStyles.btnText}>Atualizar</span></button></div></header>
 {scheduleItemId&&<section className={styles.activityScope} aria-label="Frentes da atividade">
   <div className="min-w-0"><span>Atividade do cronograma</span><h2>{activeSchedule?.title||'Frentes da atividade'}</h2>
    {activeSchedule?.status==='cancelled'&&<p className="p-form-help">Atividade cancelada. Os checklists anteriores continuam aqui.</p>}
   </div>
   <div className={styles.activityScopeActions}>
    {activeSchedule&&<a className="p-button p-button-subtle" href={activityRecordsUrl}><FileText size={16} aria-hidden="true"/>Registros e fotos</a>}
    <a className="p-text-link" href={demandProjectUrl}>Ver demandas do projeto</a>
   </div>
 </section>}
 <div className={filterStyles.filterRow}>
  <div role="alert">{error&&<p className="p-notice p-notice-error">{error}</p>}</div>
  <fieldset aria-label="Filtrar demandas" disabled={busy} className={`rounded-2xl border border-[var(--line)] bg-[var(--surface)] ${filterStyles.fieldset}`}>
   <div className={filterStyles.fields}>
    {!scheduleItemId&&<label className={filterStyles.project}>Projeto
     <select name="demandProject" value={generalOnly?GENERAL_DEMANDS:projectId} className={field} onChange={event=>chooseProject(event.target.value)}>
      <option value="">{organizationId?'Todos os contextos da organização':'Todos os projetos autorizados'}</option>
      {canChooseGeneral&&<option value={GENERAL_DEMANDS}>Somente demandas gerais</option>}
      {scopeCatalog.projects.filter(project=>!organizationId||project.organization_id===organizationId).map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
     </select>
    </label>}
    <label className={filterStyles.search}>Buscar
     <span className={filterStyles.searchInput}><Search size={16} aria-hidden="true"/><input ref={searchInput} name="demandSearch" type="search" value={search} className={field} maxLength={120} onChange={event=>{setSearch(event.target.value);setOffset(0);}} placeholder="Título ou contexto"/></span>
    </label>
   </div>
   <details className={filterStyles.refine}>
    <summary ref={refineSummary} className={filterStyles.summary}><Filter size={16} aria-hidden="true"/>Buscar e filtrar{activeFilters>0&&<span className="sr-only"> · {activeFilters} {activeFilters===1?'filtro ativo':'filtros ativos'}</span>}</summary>
    <div className={filterStyles.advanced}>
     {!scheduleItemId&&<label>Organização
      <select name="demandOrganization" value={organizationId} className={field} onChange={event=>changeScope('',event.target.value)}>
       <option value="">Todas as organizações autorizadas</option>{scopeCatalog.organizations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}
      </select>
     </label>}
     <label>Estado<select name="demandStatus" value={status} className={field} onChange={event=>filterStatus(event.target.value as TaskStatus|'all')}><option value="all">Todos</option>{TASK_STATES.map(value=><option key={value} value={value}>{stateLabels[value]}</option>)}</select></label>
     <label>Prioridade<select name="demandPriority" value={priority} className={field} onChange={event=>filterPriority(event.target.value as TaskPriority|'all')}><option value="all">Todas</option>{TASK_PRIORITIES.map(value=><option key={value} value={value}>{priorityLabels[value]}</option>)}</select></label>
    </div>
   </details>
   {activeFilters>0&&<div className={filterStyles.applied} aria-label="Filtros aplicados" role="group">
    {status!=='all'&&<button disabled={busy} className={filterStyles.chip} type="button" aria-label={`Remover estado ${stateLabels[status]}`} onClick={()=>{refineSummary.current?.focus({preventScroll:true});filterStatus('all');}}>{stateLabels[status]}<X size={14} aria-hidden="true"/></button>}
    {priority!=='all'&&<button disabled={busy} className={filterStyles.chip} type="button" aria-label={`Remover prioridade ${priorityLabels[priority]}`} onClick={()=>{refineSummary.current?.focus({preventScroll:true});filterPriority('all');}}>Prioridade {priorityLabels[priority].toLocaleLowerCase('pt-BR')}<X size={14} aria-hidden="true"/></button>}
    <button type="button" className="p-text-link" disabled={busy} onClick={clearFilters}>Limpar busca e filtros</button>
   </div>}
  </fieldset>
 </div>
 {loading&&<p role="status" className="text-sm">Carregando contexto…</p>}{!scheduleItemId&&!projectId&&!generalOnly&&catalog.projects.some(project=>project.canEdit)&&<p className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--ink)]"><Info size={16} aria-hidden="true" className="shrink-0 text-[var(--brand-ink)]"/>Para criar uma demanda, selecione um projeto ou Somente demandas gerais.</p>}<div role="group" aria-label="Ações de demandas" className="flex flex-wrap gap-3 empty:hidden">{!scheduleItemId&&canCreateDemand&&contextOrg&&<button className={primary} type="button" disabled={busy} onClick={event=>openForm('task',event?.currentTarget)}><Plus size={16} aria-hidden="true"/>Nova demanda</button>}{!scheduleItemId&&catalog.canEdit&&projectId&&catalog.items.length>0&&<button className={button} type="button" disabled={busy} onClick={event=>openForm('checklist',event.currentTarget)}><ClipboardCheck size={16} aria-hidden="true"/>Conferência pós-evento</button>}{canCreateChecklist&&<button className={button} type="button" disabled={busy} onClick={event=>openForm('activity',event.currentTarget)}><ClipboardCheck size={16} aria-hidden="true"/>Checklist de atividade</button>}{!scheduleItemId&&catalog.canManageTeams&&contextOrg&&<button className={button} type="button" disabled={busy} onClick={()=>void openTeams()}><Users size={16} aria-hidden="true"/>Equipes da organização</button>}</div>
 {form&&(!scheduleItemId||canCreateChecklist)&&<div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"><div className="mb-4 flex justify-between gap-3"><h3 ref={formHeading} tabIndex={-1} className={'font-bold '+focusAnchor}>{form==='task'?'Nova demanda':form==='activity'?'Novo checklist de atividade':'Nova conferência'}</h3><button className={button} type="button" disabled={busy} onClick={closeForm}><X size={16} aria-hidden="true"/>Fechar</button></div>{form==='task'?<TaskEditor key={`new:${contextOrg}:${projectId}`} catalog={catalog} organizationId={contextOrg} projectId={projectId} busy={busy} save={mutate}/>:form==='activity'?<ActivityChecklistCreator key={`activity:${projectId}:${scheduleItemId}`} catalog={catalog} organizationId={contextOrg} projectId={projectId} scheduleItemId={scheduleItemId} busy={busy} save={mutate} assignments={<Assignments catalog={catalog}/>}/>:<ChecklistCreator key={`checklist:${projectId}`} catalog={catalog} organizationId={contextOrg} projectId={projectId} busy={busy} save={mutate}/>}</div>}
 {teamCatalog&&<div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"><div className="flex justify-between gap-2"><h3 className="font-bold">Equipes da organização</h3><button className={button} disabled={busy} onClick={()=>{teamRequest.current?.abort();setTeamCatalog(null);}} type="button">Fechar</button></div><p className="text-sm">Uma pessoa pode participar de várias equipes. As permissões da plataforma continuam independentes.</p><details className="rounded-xl border border-[var(--line)] p-3"><summary className="min-h-11 cursor-pointer font-semibold">Criar equipe</summary><TeamEditor catalog={teamCatalog} organizationId={teamOrg} busy={busy} save={saveTeam}/></details>{teamCatalog.teams.map(team=><details key={`${team.id}:${team.version}`} className="rounded-xl border border-[var(--line)] p-3"><summary className="min-h-11 cursor-pointer font-semibold">{team.name} · {team.members.length} integrantes · {team.status==='active'?'ativa':'arquivada'}</summary><TeamEditor catalog={teamCatalog} organizationId={teamOrg} team={team} busy={busy} save={saveTeam}/></details>)}</div>}
 <div className={`grid min-w-0 gap-4 ${currentTask&&detail?"@min-[850px]:grid-cols-[minmax(260px,1fr)_minmax(0,1.6fr)]":""}`}><div className="grid min-w-0 content-start gap-3"><div><h3 ref={listHeading} tabIndex={-1} className={'font-bold '+focusAnchor}>{scheduleItemId?'Frentes':'Demandas'}</h3><div role="alert">{listFailure&&<p className="p-notice p-notice-error mt-3">{listFailure}</p>}</div></div>{listFailure&&<button className={button} disabled={busy} type="button" onClick={retryTasks}><RefreshCw size={16} aria-hidden="true"/>Tentar carregar demandas novamente</button>}{listReady&&<TaskPageSummary tasks={tasks} today={visualToday} page={Math.floor(offset/50)+1} hasMore={hasMore} selectedId={selectedTask} disabled={busy} onOpen={openTask}/>} {listReady&&tasks.length>0&&<TaskTriageMatrix tasks={tasks}/>}<p role="status" className={filterStyles.results}>{listReady?`${tasks.length} ${tasks.length===1?'resultado':'resultados'} nesta página${hasMore?' · Há mais na próxima página':''}.`:listFailure?'':'Carregando demandas…'}</p>{!listReady&&!listFailure&&<p className="text-sm text-[var(--text-secondary)]">Carregando demandas…</p>}{listReady&&!tasks.length&&!loading&&<p className="rounded-xl border border-[var(--line)] p-4 text-sm">{scheduleItemId?'Nenhuma frente neste recorte.':'Nenhuma demanda neste recorte.'}</p>}{tasks.length>0&&<div className={`grid min-w-0 gap-3 ${currentTask?"":"@min-[850px]:grid-cols-2"}`}>{tasks.map(task=><WorkTaskCard key={task.id} task={task} today={visualToday} selected={selectedTask===task.id} disabled={busy} onOpen={trigger=>openTask(task.id,trigger)}/>)}</div>}<div className="flex flex-wrap justify-between gap-2 [&:has(>button:disabled+button:disabled)]:hidden"><button className={button} disabled={busy||offset===0} onClick={()=>setOffset(value=>Math.max(0,value-50))} type="button">Página anterior</button><button className={button} disabled={busy||!hasMore} onClick={()=>setOffset(value=>value+50)} type="button">Próxima página</button></div></div>
 {currentTask&&detail&&<article className="grid min-w-0 content-start gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 @min-[850px]:p-5">
  <header className="flex flex-wrap items-start justify-between gap-3">
   <div className="min-w-0 flex-1">
    <h3 ref={detailElement} tabIndex={-1} className={'text-xl font-bold [overflow-wrap:anywhere] '+focusAnchor}>{currentTask.title}</h3>
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--text-secondary)]"><span>{currentTask.organization_name}</span>{currentTask.project_name&&(currentTask.project_id&&catalog.projects.some(project=>project.id===currentTask.project_id)?<a className="p-text-link inline-flex min-h-11 max-w-full items-center gap-2 [overflow-wrap:anywhere]" href={`/?module=projects&project=${encodeURIComponent(currentTask.project_id)}&detailProject=${encodeURIComponent(currentTask.project_id)}`}><FolderKanban size={16} className="shrink-0" aria-hidden="true"/>{currentTask.project_name}<ArrowUpRight size={15} className="shrink-0" aria-hidden="true"/><span className="sr-only"> · Abrir projeto de origem</span></a>:<span>{currentTask.project_name}</span>)}</div>
   </div>
   <div className={styles.detailActions}>{currentTask.canEdit&&<button ref={editTrigger} className={button} disabled={busy} type="button" aria-expanded={editOpen} aria-controls={`followup-task-editor-${currentTask.id}`} onClick={openTaskEditor}><Pencil size={16} aria-hidden="true"/>Editar demanda</button>}<button className={button} disabled={busy} type="button" onClick={closeTask}><X size={16} aria-hidden="true"/>Fechar</button></div>
  </header>
  <div className="grid min-w-0 gap-2">
   <TaskSignals status={currentTask.status} priority={currentTask.priority} dueAt={currentTask.due_at} today={visualToday}/>
   <p className="text-sm text-[var(--text-secondary)]">Importância: {currentTask.importance?priorityLabels[currentTask.importance]:'Sem classificação'}</p>
  </div>
  {taskReceipt?.id===currentTask.id&&<p role="status" className="rounded-lg border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-semibold text-[var(--brand-ink)]">{taskReceipt.message}</p>}
  {currentTask.canEdit&&<details key={currentTask.id} id={`followup-task-editor-${currentTask.id}`} open={editOpen} className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-3" onToggle={event=>{if(event.currentTarget.open){if(!editOpen)openTaskEditor();}else if(editOpen)closeTaskEditor(false);}} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&editOpen&&!busy){event.preventDefault();event.stopPropagation();closeTaskEditor();}}}>
   <summary aria-disabled={busy||undefined} onClick={event=>{if(busy)event.preventDefault();}} className="min-h-11 cursor-pointer rounded-lg py-2 font-semibold text-[var(--brand-ink)]"><Pencil size={16} aria-hidden="true" className="mr-2 inline align-text-bottom"/>Cadastro e responsáveis</summary>
   <div className={styles.editHeading}><h4 ref={editHeading} tabIndex={-1} className={focusAnchor}>Editar demanda</h4><button type="button" className={button} disabled={busy} onClick={()=>closeTaskEditor()}><X size={15} aria-hidden="true"/>Fechar edição</button></div>
   {scopedCatalog?.canEdit?<TaskEditor key={`${currentTask.id}:${currentTask.version}`} catalog={scopedCatalog} task={currentTask} organizationId={currentTask.organization_id} projectId={currentTask.project_id??''} busy={busy} save={mutate}/>
    :scopedCatalog?<p role="status" className="text-sm">A edição está indisponível neste contexto.</p>
    :editingCatalogUnavailable?<div className="grid gap-2">
      <p role="alert" className="text-sm text-[var(--danger)]">Não foi possível atualizar as opções de edição. Recarregue o contexto para tentar novamente.</p>
      <button className={button} type="button" disabled={busy} onClick={loadEditingCatalog}><RefreshCw size={16} aria-hidden="true"/>Tentar carregar opções</button>
     </div>
    :editingContextMatches?<p role="status" className="text-sm">Carregando opções de edição…</p>
    :<button className={button} type="button" disabled={busy} onClick={loadEditingCatalog}>Carregar opções deste projeto para editar</button>}
  </details>}
  {currentTask.body&&<p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{currentTask.body}</p>}
  <div className="grid min-w-0 gap-2">
   <a className={button} target="_blank" rel="noopener noreferrer" href={typeof window==='undefined'?'#':manualShareUrl(currentTask.title,currentTask.id,new URL(basePath,window.location.origin).href)}><Share2 size={16} aria-hidden="true"/>Compartilhar link pelo WhatsApp</a>
   <p className="text-xs text-[var(--muted)]">O compartilhamento é manual e leva só o título e o link. A pessoa ainda precisa de acesso à demanda.</p>
  </div>
 {currentTask.canEdit&&!['completed','cancelled'].includes(currentTask.status)&&<TaskTriage key={`${currentTask.id}:${currentTask.version}`} task={currentTask} busy={busy} save={mutate}/>}
 {currentTask.canWork&&!currentTask.canEdit&&<WorkerForm key={`${currentTask.id}:${currentTask.version}`} task={currentTask} busy={busy} save={mutate}/>}{currentTask.canDelegateWork&&<WorkDelegation detail={detail} busy={busy} save={mutate}/>}{userId&&currentTask.canDelegateWork&&<FollowupTransferPanel key={`${userId}:${currentTask.id}`} userId={userId} taskId={currentTask.id} onTransferred={receipt=>{setDetail(null);setProjectId(receipt.projectId);setOffset(0);setRevision(value=>value+1);onTaskTransferred?.(receipt);void onChanged?.();}}/>}
 {detail.checklist?.kind==='activity'&&detail.checklist.scheduleItem&&currentTask.project_id&&!scheduleItemId&&<a className="p-text-link inline-flex min-h-11 items-center gap-2" href={`/?module=demands&project=${encodeURIComponent(currentTask.project_id)}&scheduleItemId=${encodeURIComponent(detail.checklist.scheduleItem.id)}&demandId=${encodeURIComponent(currentTask.id)}`}><ClipboardCheck size={16} aria-hidden="true"/>{detail.checklist.scheduleItem.title}<ArrowUpRight size={14} aria-hidden="true"/></a>}
 {detail.checklist?.kind==='activity'&&<ActivityChecklistView checklist={detail.checklist} canEdit={currentTask.canEdit} canWork={currentTask.canWork} taskClosed={['completed','cancelled'].includes(currentTask.status)} busy={busy} save={mutate}/>}
 {materialChecklist&&<section className="grid gap-3 border-t pt-4" aria-label="Conferência de materiais"><h4 className="font-bold">{materialChecklist.title}</h4><p className="text-sm text-[var(--muted)]">Registre todos os tamanhos. Avarias e diferenças criam informação para revisão; não são movimentações de estoque.</p>{materialChecklist.rows.map(row=><CountRow key={JSON.stringify([row.id,row.counted,row.damaged,row.note])} row={row} checklist={materialChecklist!} busy={busy} canEdit={currentTask.canEdit||currentTask.canWork} save={mutate}/>)}{materialChecklist.status==='open'&&(currentTask.canEdit||currentTask.canWork)&&<form className="grid gap-3 rounded-xl border border-[var(--line)] p-3" onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget);void mutate({action:'checklist.complete',id:materialChecklist!.id,expectedVersion:materialChecklist!.version,createFollowups:values.get('followups')==='on',operationKey:crypto.randomUUID()}).catch(()=>{});}}><fieldset disabled={busy} className="grid gap-3">{currentTask.canEdit?<label className="my-2 flex min-h-11 items-start gap-2"><input name="followups" type="checkbox" defaultChecked className="mt-1"/>Criar demandas de revisão para os itens com diferença ou avaria.</label>:<p className="text-sm">Se houver divergência, a gestão precisa revisar a conclusão. Suas contagens permanecerão salvas.</p>}<button className={primary} type="submit" disabled={busy||materialChecklist.rows.some(r=>r.counted===null)}>Concluir conferência</button></fieldset></form>}{!!materialChecklist.followups.length&&<div className="space-y-2"><h5 className="font-semibold">Pendências geradas para revisão</h5>{materialChecklist.followups.map(followup=><button type="button" className={button+' w-full'} key={followup.row_id} onClick={()=>{selectTask(followup.task_id);}}>Abrir demanda de revisão</button>)}</div>}</section>}
 <details className="rounded-xl border border-[var(--line)] p-3"><summary className="min-h-11 cursor-pointer font-semibold">Histórico da demanda</summary><p className="p-form-help"><a className="p-text-link" href={historyHref({ kind: 'task', id: detail.task.id }, detail.task.project_id)} aria-label="Ver histórico desta demanda em Registros">Ver histórico<ArrowUpRight size={14} aria-hidden="true"/></a> em Registros, por data.</p><ol className="space-y-2">{detail.history.map(entry=><li className="rounded-lg border border-[var(--line)] p-2 text-sm" key={entry.version}>Versão {entry.version} · {new Date(entry.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · {stateLabels[entry.snapshot.status as keyof typeof stateLabels]??entry.snapshot.status}{entry.snapshot.activityChecklistChange&&<p className="whitespace-pre-wrap break-words">{entry.snapshot.activityChecklistChange.kind==='answer'?`${entry.snapshot.activityChecklistChange.label} · ${activityAnswerLabels[entry.snapshot.activityChecklistChange.after?.answer??'']??'Pendente'}${entry.snapshot.activityChecklistChange.after?.note?` · ${entry.snapshot.activityChecklistChange.after.note}`:''}`:entry.snapshot.activityChecklistChange.kind==='created'?`Checklist criado com ${entry.snapshot.activityChecklistChange.steps} verificações.`:'Checklist de atividade concluído.'}</p>}{entry.snapshot.transfer&&<p className="whitespace-pre-wrap break-words"><strong>Transferência entre projetos:</strong> {catalog.projects.find(p=>p.id===entry.snapshot.transfer?.fromProjectId)?.name??'Projeto de origem (nome sujeito ao seu acesso atual)'} → {catalog.projects.find(p=>p.id===entry.snapshot.transfer?.toProjectId)?.name??'Projeto de destino (nome sujeito ao seu acesso atual)'}. Atribuições e registros preservados; a visibilidade segue o acesso atual ao destino. Motivo: {entry.snapshot.transfer.reason}</p>}{entry.snapshot.progressNote&&<p className="whitespace-pre-wrap break-words">{entry.snapshot.progressNote}</p>}</li>)}</ol></details></article>}
 </div></section>;
}
