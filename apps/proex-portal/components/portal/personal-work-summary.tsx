'use client';

import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AlertTriangle,ArrowRight,CalendarClock,CircleDot,ClipboardList,RefreshCw,UserRoundCheck,Users} from 'lucide-react';
import {isMyWorkSummary,type MyWorkSummary} from '@/lib/my-work/summary-contract';
import type {MyWorkStatus} from '@/lib/my-work/contracts';
import {workApi} from './my-work-api';
import {FOLLOWUP_CHANGED} from './follow-up-api';
import styles from './personal-work-summary.module.css';

type Props={userId:string;organizationId?:string|null;organizationName?:string;projectId?:string|null;projectName?:string;serverDay?:string};
type Loaded={key:string;data?:MyWorkSummary;error?:string};
export function personalWorkHref(status:MyWorkStatus,organizationId:string|null,projectId:string|null){
 const params=new URLSearchParams({module:'my-work'});if(organizationId)params.set('organizationId',organizationId);if(projectId)params.set('project',projectId);if(status!=='pending')params.set('workStatus',status);return '/?'+params;
}
/** Relative to the server clock, so an en-US/device timezone cannot change "today". */
export function nextWorkDayDelay(summary:Pick<MyWorkSummary,'asOf'|'today'>){const next=Date.parse(summary.today+'T00:00:00-03:00')+86400000;return Math.max(1000,Math.min(86401000,next-Date.parse(summary.asOf)+1000));}
const time=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value));

export default function PersonalWorkSummary({userId,organizationId=null,organizationName='',projectId=null,projectName='',serverDay=''}:Props){
 const owner=JSON.stringify([userId,organizationId,projectId]),[revision,setRevision]=useState(0),[loaded,setLoaded]=useState<Loaded|null>(null);
 const key=JSON.stringify([owner,revision,serverDay]),latest=useRef(key),active=useRef<AbortController|null>(null),epoch=useRef(0),lastStarted=useRef(0);
 const cancelRead=useCallback(()=>{epoch.current++;active.current?.abort();},[]);
 const refresh=useCallback(()=>{cancelRead();setRevision(value=>value+1);},[cancelRead,setRevision]);
 useLayoutEffect(()=>{latest.current=key;return cancelRead;},[key,cancelRead]);
 useEffect(()=>{
  const controller=new AbortController(),generation=++epoch.current;active.current=controller;lastStarted.current=Date.now();
  const params=new URLSearchParams();if(organizationId)params.set('organizationId',organizationId);if(projectId)params.set('projectId',projectId);
  const current=()=>!controller.signal.aborted&&generation===epoch.current&&latest.current===key;
  void workApi('/api/my-work/summary'+(params.size?'?'+params:''),isMyWorkSummary,controller.signal).then(data=>{
   if(!current())return;
   if(data.viewerId!==userId||data.scope.organizationId!==organizationId||data.scope.projectId!==projectId)throw new Error('Sua sessão ou o contexto da consulta mudou. Atualize para conferir.');
   setLoaded({key,data});
  }).catch(error=>{if(current())setLoaded({key,error:error instanceof Error?error.message:'Não foi possível consultar suas atribuições.'});});
  return()=>controller.abort();
 },[key,userId,organizationId,projectId]);
 useEffect(()=>{
  const changed=()=>refresh(),focused=()=>{if(document.visibilityState!=='hidden'&&Date.now()-lastStarted.current>=15000)refresh();};
  window.addEventListener(FOLLOWUP_CHANGED,changed);window.addEventListener('focus',focused);document.addEventListener('visibilitychange',focused);
  return()=>{window.removeEventListener(FOLLOWUP_CHANGED,changed);window.removeEventListener('focus',focused);document.removeEventListener('visibilitychange',focused);};
 },[refresh]);
 const current=loaded?.key===key?loaded:null,data=current?.data,loading=!current;
 useEffect(()=>{if(!data)return;const timer=window.setTimeout(refresh,nextWorkDayDelay(data));return()=>window.clearTimeout(timer);},[data,refresh]);
 const metrics=[
  {label:'Atenção',status:'attention' as const,count:data?.tasks.attention,help:'Em atraso ou bloqueadas',Icon:AlertTriangle,tone:'danger'},
  {label:'Prazo hoje',status:'due_today' as const,count:data?.tasks.dueToday,help:'Pendentes com prazo para hoje',Icon:CalendarClock,tone:'warning'},
  {label:'Pendentes',status:'pending' as const,count:data?.tasks.pending,help:'Ainda não finalizadas',Icon:ClipboardList,tone:'brand'},
  {label:'Em andamento',status:'in_progress' as const,count:data?.tasks.inProgress,help:'Trabalho iniciado',Icon:CircleDot,tone:'info'},
 ];
 const scope=projectId?`Projeto: ${projectName||'projeto selecionado'}`:organizationId?`Organização: ${organizationName||'organização selecionada'}`:'Todos os projetos e organizações autorizados';
 return <section className={styles.panel} aria-labelledby="personal-work-title" aria-busy={loading}>
  <header className={styles.heading}><div><h2 id="personal-work-title"><UserRoundCheck size={21} aria-hidden="true"/>Meu trabalho</h2><p>Atribuições diretas e das suas equipes.</p><p className={styles.scope}>{scope}</p></div><button type="button" className="p-button p-button-subtle" onClick={refresh} aria-label="Atualizar resumo pessoal"><RefreshCw size={16} aria-hidden="true"/><span>Atualizar</span></button></header>
  {/* Ready cards are links whose name replaces their content, so the visible help is linked as the description.
      While loading or after a failure there is nothing to open: the cards are plain, unfocusable and arrowless. */}
  <div className={styles.metrics} role="group" aria-label="Resumo de suas demandas">{metrics.map(({label,status,count,help,Icon,tone})=>data?<a key={status} className={styles.metric} data-tone={tone} href={personalWorkHref(status,organizationId,projectId)} aria-label={`Abrir ${label.toLocaleLowerCase('pt-BR')} de Meu trabalho: ${count}`} aria-describedby={`personal-work-${status}-help`}><span><Icon size={18} aria-hidden="true"/>{label}</span><strong>{count}</strong><small id={`personal-work-${status}-help`}>{help}</small><ArrowRight className={styles.arrow} size={16} aria-hidden="true"/></a>
   :<div key={status} className={styles.metric} data-tone={tone} aria-disabled="true"><span><Icon size={18} aria-hidden="true"/>{label}</span><strong aria-hidden="true">—</strong><span className={styles.srOnly}>{loading?'Total em consulta':'Total indisponível'}</span><small>{help}</small></div>)}</div>
  {data&&data.tasks.total>0&&(()=>{
   // Grupos que não se sobrepõem: concluídas, em andamento e as demais pendentes. Canceladas ficam fora.
   const done=data.tasks.completed,doing=Math.min(data.tasks.inProgress,data.tasks.pending),waiting=Math.max(0,data.tasks.pending-doing),sum=done+doing+waiting;
   if(!sum)return null;
   const parts=[{key:'done',label:'Concluídas',value:done},{key:'doing',label:'Em andamento',value:doing},{key:'waiting',label:'A iniciar ou paradas',value:waiting}];
   return <div className={styles.progress}><div className={styles.progressBar} role="img" aria-label={`Andamento das suas demandas: ${parts.map(part=>`${part.value} ${part.label.toLocaleLowerCase('pt-BR')}`).join(', ')}.`}>{parts.map(part=>part.value>0&&<span key={part.key} data-part={part.key} style={{flexGrow:part.value}} title={`${part.label}: ${part.value}`}/>)}</div><ul className={styles.legend} aria-hidden="true">{parts.map(part=><li key={part.key} data-part={part.key}>{part.label}<strong>{part.value}</strong></li>)}</ul></div>;
  })()}
  {current?.error&&<p className={styles.error} role="alert">{current.error}</p>}
  <div className={styles.footer}><p role="status" aria-live="polite" aria-atomic="true">{loading?'Consultando suas atribuições…':data?<><Users size={16} aria-hidden="true"/>{data.responsibilities.active} responsabilidade{data.responsibilities.active===1?' ativa':'s ativas'}</>:'Os totais estão indisponíveis nesta consulta.'}</p></div>
  <p className={styles.help}>Cada demanda pode aparecer em mais de um grupo. Este resumo considera organização e projeto; outros filtros da página não mudam os totais.</p>
  {data&&<p className={styles.asOf}>Consulta em {time(data.asOf)} · Brasília.</p>}
 </section>;
}
