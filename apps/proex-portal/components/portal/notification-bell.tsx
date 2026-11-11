'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, ChevronRight, Eye, EyeOff, Inbox as InboxIcon, RefreshCw, X } from 'lucide-react';
import Link from 'next/link';
import styles from './notification-bell.module.css';
import MaterialAttentionInbox, {MATERIAL_ATTENTION_CHANGED} from './material-attention-inbox';
import ConvocationInbox, {CONVOCATIONS_CHANGED} from './convocation-inbox';
import CommunityInbox, {type CommunityTarget} from './community-inbox';
import {COMMUNITY_CHANGED} from './community-api';
import { FOLLOWUP_CHANGED, followupApi, dueLabel } from './follow-up-api';
import { TaskSignals } from './work-signals';
import { groupNotifications, type NoticeForGroup } from '../../lib/follow-up/notification-groups';
import type { TaskPriority, TaskStatus } from '../../lib/follow-up/contracts';

type PendingTask = { id:string; title:string; status?:TaskStatus; priority?:TaskPriority; due_at:string|null; version?:number };
type Inbox = {
 notifications:NoticeForGroup[];
 groups?:ReturnType<typeof groupNotifications>;
 today?:string;
 viewerId?:string;
 unread:number;
 hasMore:boolean;
 clearThrough?:string|null;
 pending:PendingTask[];
 pendingHasMore:boolean;
 hiddenPending?:PendingTask[];
 hiddenPendingHasMore?:boolean;
 hiddenPendingAfter?:string|null;
 hiddenPendingCursor?:string|null;
 pendingVisibility?:'confirmed'|'outdated';
};
type Mutation =
 | { action:'notification.read'; read:true; all?:true; taskId?:string }
 | { action:'notification.dismiss'; through:string; taskId?:string }
 | { action:'pending.visibility'; taskId:string; version:number; hidden:boolean };

const updateFormatter=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
function unreadLabel(count:number) {
 return `${count} ${count===1?'não lida':'não lidas'}`;
}
function lastUpdate(value:string|null) {
 return value?updateFormatter.format(new Date(value)):'Data não informada';
}

export default function NotificationBell({userId,onSelectTask,onSelectMaterial,onSelectConvocation,community=false,onSelectCommunity,basePath='/?module=demands'}:{userId:string;onSelectTask?:(id:string)=>void;onSelectMaterial?:(itemId:string,projectId:string)=>void;onSelectConvocation?:(id:string)=>void;community?:boolean;onSelectCommunity?:(target:CommunityTarget)=>void;basePath?:string}) {
 const [stored,setStored]=useState<{owner:string;data:Inbox;hiddenPage:number}|null>(null);
 const [open,setOpen]=useState(false);
 const [materialUnread,setMaterialUnread]=useState({owner:'',count:0});
 const [pane,setPane]=useState<'notices'|'pending'|'stock'|'convocations'|'community'>('notices');
 const [communityUnread,setCommunityUnread]=useState({owner:'',count:0});
 const [convocationUnread,setConvocationUnread]=useState({owner:'',count:0});
 const [message,setMessage]=useState<{owner:string;error:boolean;text:string}|null>(null);
 const [writing,setWriting]=useState<{owner:string;controller:AbortController}|null>(null);
 const [pagingOwner,setPagingOwner]=useState<string|null>(null);
 const [confirmation,setConfirmation]=useState<{owner:string;through:string}|null>(null);
 const trigger=useRef<HTMLButtonElement|null>(null);
 const heading=useRef<HTMLHeadingElement|null>(null);
 const hiddenSummary=useRef<HTMLElement|null>(null);
 const focusHiddenPage=useRef(false);
 const hiddenPages=useRef({owner:userId,cursors:[''],requested:0});
 const active=useRef<AbortController|null>(null);
 const mutationRequest=useRef<AbortController|null>(null);
 const readEpoch=useRef(0);
 const currentUser=useRef(userId);
 const refresh=useRef<()=>void>(()=>{});
 const currentInbox=stored?.owner===userId?stored:null;
 const inbox=currentInbox?.data??null;
 const unread=(inbox?.unread??0)+(materialUnread.owner===userId?materialUnread.count:0)+(convocationUnread.owner===userId?convocationUnread.count:0)+(community&&communityUnread.owner===userId?communityUnread.count:0);
 const feedback=message?.owner===userId?message:null;
 const busy=writing?.owner===userId&&!writing.controller.signal.aborted;
 const groups=inbox?(inbox.groups??groupNotifications(inbox.notifications)):[];
 const hidden=inbox?.hiddenPending??[];
 const paging=pagingOwner===userId;
 const hiddenPage=currentInbox?.hiddenPage??0;
 const confirming=confirmation?.owner===userId?confirmation:null;

 useEffect(()=>{
  currentUser.current=userId;
  hiddenPages.current={owner:userId,cursors:[''],requested:0};
  focusHiddenPage.current=false;
  let alive=true,last=0,pending=false,queued=false;
  const update=async(force=false)=>{
   if(document.visibilityState==='hidden')return;
   if(pending){queued=queued||force;return;}
   if(!force&&Date.now()-last<60000)return;
   pending=true;
   const epoch=readEpoch.current,controller=new AbortController();
   active.current=controller;
   try{
    const page=hiddenPages.current;
    const requested=page.owner===userId?page.requested:0;
    const cursor=page.cursors[requested]??'';
    const query=new URLSearchParams({view:'inbox'});
    if(cursor)query.set('hiddenAfter',cursor);
    const data=await followupApi<Inbox>(query,undefined,controller.signal);
    if((data.hiddenPendingAfter??'')!==cursor)throw new Error('A página de pendências mudou. Atualize para tentar novamente.');
    if(data.viewerId&&data.viewerId!==userId)throw new Error('A conta mudou. Atualize o portal para consultar seus avisos.');
    if(alive&&epoch===readEpoch.current&&!mutationRequest.current){
     setStored({owner:userId,data,hiddenPage:requested});
     setPagingOwner(null);
     setMessage(old=>old?.error?null:old);
     last=Date.now();
    }
   }catch(cause){
    if(alive&&epoch===readEpoch.current&&!controller.signal.aborted){
     setStored(null);
     setPagingOwner(null);
     focusHiddenPage.current=false;
     setMessage({owner:userId,error:true,text:cause instanceof Error?cause.message:'Não foi possível consultar notificações.'});
    }
   }finally{
    pending=false;
    if(alive&&queued){queued=false;void update(true);}
   }
  };
  refresh.current=()=>void update(true);
  const visible=()=>void update(),changed=()=>void update(true);
  const timer=window.setInterval(visible,60000),start=window.setTimeout(changed,0);
  window.addEventListener('focus',visible);
  document.addEventListener('visibilitychange',visible);
  window.addEventListener(FOLLOWUP_CHANGED,changed);
  return()=>{
   alive=false;
   active.current?.abort();
   mutationRequest.current?.abort();
   mutationRequest.current=null;
   clearInterval(timer);
   clearTimeout(start);
   window.removeEventListener('focus',visible);
   document.removeEventListener('visibilitychange',visible);
   window.removeEventListener(FOLLOWUP_CHANGED,changed);
  };
 },[userId]);

 useEffect(()=>{
  if(inbox&&!paging&&focusHiddenPage.current){
   focusHiddenPage.current=false;
   hiddenSummary.current?.focus();
  }
 },[inbox,paging]);

 function stepHidden(direction:'next'|'previous') {
  if(busy||paging||!inbox)return;
  const page=hiddenPages.current;
  const next=direction==='next'?hiddenPage+1:hiddenPage-1;
  const cursor=direction==='next'?inbox.hiddenPendingCursor:page.cursors[next];
  if(page.owner!==userId||next<0||cursor==null)return;
  page.cursors[next]=cursor;
  page.requested=next;
  focusHiddenPage.current=true;
  setPagingOwner(userId);
  readEpoch.current++;
  active.current?.abort();
  refresh.current();
 }

 function close(restoreFocus=false) {
  focusHiddenPage.current=false;
  setOpen(false);
  setConfirmation(null);
  if(restoreFocus)trigger.current?.focus();
 }

 useEffect(()=>{
  if(!open)return;
  const escape=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){focusHiddenPage.current=false;setOpen(false);setConfirmation(null);trigger.current?.focus();}
  };
  document.addEventListener('keydown',escape);
  return()=>document.removeEventListener('keydown',escape);
 },[open]);

 async function mutate(body:Mutation,success='') {
  if(busy||paging||mutationRequest.current)return;
  const owner=userId,controller=new AbortController();
  mutationRequest.current=controller;
  readEpoch.current++;
  active.current?.abort();
  setWriting({owner,controller});
  try{
   const data=await followupApi<Inbox>('',body,controller.signal);
   if(data.viewerId&&data.viewerId!==owner)throw new Error('A conta mudou. Atualize o portal para consultar seus avisos.');
   if(currentUser.current===owner&&!controller.signal.aborted){
    readEpoch.current++;
    hiddenPages.current={owner,cursors:[''],requested:0};
    setPagingOwner(null);
    setStored({owner,data,hiddenPage:0});
    const outdated=body.action==='pending.visibility'&&data.pendingVisibility==='outdated';
    setMessage(outdated?{owner,error:true,text:'Esta pendência mudou ou saiu da sua lista. Confira a lista atualizada.'}
      :success?{owner,error:false,text:success}:null);
    if(success)heading.current?.focus();
   }
  }catch(cause){
   if(currentUser.current===owner&&!controller.signal.aborted){
    readEpoch.current++;
    hiddenPages.current={owner,cursors:[''],requested:0};
    setPagingOwner(null);
    setStored(null);
    setMessage({owner,error:true,text:cause instanceof Error?cause.message:'Não foi possível atualizar a caixa.'});
   }
  }finally{
   if(mutationRequest.current===controller){
    mutationRequest.current=null;
    setWriting(null);
   }
  }
 }

 function link(id:string) {
  if(typeof window==='undefined')return basePath;
  const query=new URL(basePath,window.location.origin);
  query.searchParams.set('demandId',id);
  return query.pathname+query.search;
 }

 function selectTask(event:React.MouseEvent<HTMLAnchorElement>,id:string,markRead=false) {
  if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  if(onSelectTask){event.preventDefault();onSelectTask(id);}
  if(markRead)void mutate({action:'notification.read',taskId:id,read:true});
  close();
 }

 function pendingCard(task:PendingTask,isHidden=false) {
  return <li className={styles.pendingCard} key={task.id}>
   <a href={link(task.id)} className={styles.cardLink} data-notice-task onClick={event=>selectTask(event,task.id)}>
    <span>{task.title}</span><ChevronRight size={16} aria-hidden="true"/>
   </a>
   {task.version!==undefined&&<button className={styles.cardAction} type="button" disabled={busy||paging}
    title={isHidden?'Voltar a acompanhar':'Ocultar desta lista'}
    aria-label={isHidden?`Mostrar pendência: ${task.title}`:`Ocultar pendência: ${task.title}`}
    onClick={()=>void mutate({action:'pending.visibility',taskId:task.id,version:task.version!,hidden:!isHidden},
     isHidden?'Pendência de volta à sua lista.':'Pendência ocultada da sua lista.')}>
    {isHidden?<Eye size={17} aria-hidden="true"/>:<EyeOff size={17} aria-hidden="true"/>}
   </button>}
   <div className={styles.pendingSignals}>
    {task.status&&task.priority?<TaskSignals status={task.status} priority={task.priority} dueAt={task.due_at} today={inbox?.today??''}/>
     :<span>{dueLabel(task.due_at)}</span>}
   </div>
  </li>;
 }

 return <div className={styles.root}>
  <button ref={trigger} type="button" className={`p-icon-button ${styles.trigger}`}
   aria-label={`Notificações${inbox||materialUnread.owner===userId?`: ${unreadLabel(unread)}`:''}`}
   aria-expanded={open} aria-controls="followup-notification-center"
   onClick={()=>{if(open)close();else{setOpen(true);refresh.current();window.dispatchEvent(new Event(MATERIAL_ATTENTION_CHANGED));}}}>
   <Bell size={20} aria-hidden="true"/>
   {!!unread&&<span aria-hidden="true" className={styles.counter}>{unread>99?'99+':unread}</span>}
  </button>
  <section hidden={!open} style={!open?{display:'none'}:undefined} id="followup-notification-center" aria-label="Central de notificações" className={styles.panel}>
   <header className={styles.header}>
    <div className={styles.headerRow}>
     <div>
      <h2 ref={heading} tabIndex={-1}>Notificações</h2>
      <p role="status" aria-live="polite" className={styles.caption}>
       {inbox?unreadLabel(unread):feedback?.error?'Caixa indisponível':'Consultando…'}
      </p>
     </div>
     <div className={styles.headerActions}>
      <button type="button" className={styles.iconButton} title="Atualizar" aria-label="Atualizar" disabled={busy} onClick={()=>{refresh.current();window.dispatchEvent(new Event(MATERIAL_ATTENTION_CHANGED));if(community)window.dispatchEvent(new Event(COMMUNITY_CHANGED));}}>
       <RefreshCw size={17} aria-hidden="true"/>
      </button>
      <button type="button" className={styles.iconButton} title="Fechar" aria-label="Fechar notificações" onClick={()=>close(true)}>
       <X size={19} aria-hidden="true"/>
      </button>
     </div>
    </div>
    <div className={styles.panes} role="group" aria-label="Conteúdo da central">
     <button type="button" aria-pressed={pane==='notices'} onClick={()=>{setPane('notices');setConfirmation(null);}}>Avisos</button>
     <button type="button" aria-label="Pendentes" aria-pressed={pane==='pending'} onClick={()=>{setPane('pending');setConfirmation(null);}}>
      Pendentes{inbox&&<span aria-hidden="true">{inbox.pending.length}{inbox.pendingHasMore?'+':''}</span>}
     </button>
     <button type="button" aria-pressed={pane==='stock'} onClick={()=>{setPane('stock');setConfirmation(null);window.dispatchEvent(new Event(MATERIAL_ATTENTION_CHANGED));}}>Estoque{materialUnread.owner===userId&&materialUnread.count>0&&<span>{materialUnread.count}</span>}</button>
     <button type="button" aria-pressed={pane==='convocations'} onClick={()=>{setPane('convocations');setConfirmation(null);window.dispatchEvent(new Event(CONVOCATIONS_CHANGED));}}>Convocações{convocationUnread.owner===userId&&convocationUnread.count>0&&<span>{convocationUnread.count}</span>}</button>
     {community&&<button type="button" aria-pressed={pane==='community'} onClick={()=>{setPane('community');setConfirmation(null);window.dispatchEvent(new Event(COMMUNITY_CHANGED));}}>Comunidade{communityUnread.owner===userId&&communityUnread.count>0&&<span>{communityUnread.count}</span>}</button>}
    </div>
   </header>
   <div className={styles.content} hidden={!open||pane!=='stock'} style={!open||pane!=='stock'?{display:'none'}:undefined}><MaterialAttentionInbox userId={userId} onUnreadChange={count=>setMaterialUnread({owner:userId,count})} onOpenMaterial={onSelectMaterial?(itemId,projectId)=>{close(true);onSelectMaterial(itemId,projectId);}:undefined}/></div>
   <div className={styles.content} hidden={!open||pane!=='convocations'} style={!open||pane!=='convocations'?{display:'none'}:undefined}><ConvocationInbox userId={userId} onUnreadChange={count=>setConvocationUnread({owner:userId,count})} onOpen={onSelectConvocation?id=>{close(true);onSelectConvocation(id);}:undefined}/></div>
   {community&&<div className={styles.content} hidden={!open||pane!=='community'} style={!open||pane!=='community'?{display:'none'}:undefined}><CommunityInbox userId={userId} onUnreadChange={count=>setCommunityUnread({owner:userId,count})} onOpen={onSelectCommunity?target=>{close(true);onSelectCommunity(target);}:undefined}/></div>}
   {open&&pane!=='stock'&&pane!=='convocations'&&pane!=='community'&&<div className={styles.content} key={pane}>
    {feedback&&<p role={feedback.error?'alert':'status'} className={feedback.error?styles.error:styles.feedback}>{feedback.text}</p>}
    {pane==='notices'?<>
     <div className={styles.toolbar}>
      <button type="button" className="p-button p-button-subtle" disabled={busy||paging||!inbox?.unread}
       onClick={()=>void mutate({action:'notification.read',all:true,read:true})}><CheckCheck size={16} aria-hidden="true"/>Marcar todas como lidas</button>
      {inbox?.clearThrough&&<button type="button" className="p-button p-button-subtle" disabled={busy||paging||!!confirming}
       onClick={()=>setConfirmation({owner:userId,through:inbox.clearThrough!})}><InboxIcon size={16} aria-hidden="true"/>Limpar todos os avisos</button>}
     </div>
     {confirming&&<div className={styles.confirmation}>
      <p>Retirar da sua caixa todos os avisos que já estavam nela? As demandas e o histórico continuam disponíveis.</p>
      <div className={styles.toolbar}>
       <button type="button" className="p-button p-button-primary" disabled={busy} onClick={()=>{
        setConfirmation(null);
        void mutate({action:'notification.dismiss',through:confirming.through},'Avisos anteriores removidos da sua caixa.');
       }}>Confirmar limpeza</button>
       <button type="button" className="p-button p-button-subtle" onClick={()=>setConfirmation(null)}>Voltar</button>
      </div>
     </div>}
     {inbox&&!groups.length&&<div className={styles.empty}><InboxIcon size={19} aria-hidden="true"/><p>Nenhuma notificação disponível.</p></div>}
     {!!groups.length&&<ul className={styles.list}>
      {groups.map(group=><li key={group.task_id} className={styles.noticeCard} data-unread={group.unread>0}>
       <a href={link(group.task_id)} className={styles.cardLink} data-notice-task onClick={event=>selectTask(event,group.task_id,true)}>
        <span>{group.title}</span><ChevronRight size={16} aria-hidden="true"/>
       </a>
       {inbox?.clearThrough&&<button type="button" className={styles.cardAction} disabled={busy||paging}
        title="Retirar estes avisos da caixa" aria-label={`Retirar avisos de: ${group.title}`}
        onClick={()=>void mutate({action:'notification.dismiss',through:inbox.clearThrough!,taskId:group.task_id},'Avisos desta demanda retirados da sua caixa.')}>
        <X size={17} aria-hidden="true"/>
       </button>}
       <div className={styles.noticeDetails}>
        <p>{group.updates} {group.updates===1?'atualização':'atualizações'} · {group.unread} {group.unread===1?'não lida':'não lidas'} nesta janela</p>
        <p>Última atualização: <time dateTime={group.last_created_at??undefined}>{lastUpdate(group.last_created_at)}</time></p>
        <p>{inbox?.today&&group.due_at&&group.due_at<inbox.today&&!['completed','cancelled'].includes(group.status)?'Prazo vencido · ':''}{dueLabel(group.due_at)}</p>
       </div>
      </li>)}
     </ul>}
     {inbox?.hasMore&&<p className={styles.caption}>A lista agrupa até 100 avisos recentes. O total de não lidas inclui todos os avisos da sua caixa.</p>}
     <p className={styles.caption}>Avisos internos. Configure o recebimento por e-mail em Demandas.</p>
    </>:<>
     <div className={styles.pendingIntro}>
      <h3>Pendentes que você acompanha</h3>
      <p className={styles.caption}>Inclui demandas que você criou ou recebeu. Use o ícone de olho para ocultar uma pendência só para você.</p>
     </div>
     {inbox&&!inbox.pending.length&&<p className={styles.empty}>Nenhuma pendência nesta lista.</p>}
     {!!inbox?.pending.length&&<ul className={styles.list}>{inbox.pending.slice(0,20).map(task=>pendingCard(task))}</ul>}
     {(inbox?.pending.length??0)>20&&<p className={styles.caption}>Abra Demandas para acompanhar as demais pendências.</p>}
     {(hidden.length>0||hiddenPage>0)&&<details className={styles.hiddenList}>
      <summary ref={hiddenSummary}>Pendências ocultadas{hiddenPage===0? ` (${hidden.length}${inbox?.hiddenPendingHasMore?'+':''})`:''}</summary>
      <p className={styles.caption}>Elas voltam a aparecer quando a demanda é atualizada.</p>
      <div aria-busy={paging}>
       {hidden.length?<ul className={styles.list}>{hidden.map(task=>pendingCard(task,true))}</ul>
        :<p className={styles.empty}>Nenhuma pendência ocultada nesta página.</p>}
      </div>
      {(hiddenPage>0||inbox?.hiddenPendingCursor)&&<nav className={`${styles.toolbar} ${styles.hiddenPager}`} aria-label="Páginas de pendências ocultadas">
       <p role="status" className={styles.caption}>{paging?'Carregando pendências ocultadas…':`Página ${hiddenPage+1}`}</p>
       <button type="button" className="p-button p-button-subtle" disabled={busy||paging||hiddenPage===0} onClick={()=>stepHidden('previous')}>Anterior</button>
       <button type="button" className="p-button p-button-subtle" disabled={busy||paging||!inbox?.hiddenPendingCursor} onClick={()=>stepHidden('next')}>Próxima</button>
      </nav>}
     </details>}
     <p className={styles.caption}><Link className={styles.workLink} href="/?module=my-work" prefetch={false}>Meu trabalho</Link> mostra somente atribuições explícitas.</p>
    </>}
   </div>}
  </section>
 </div>;
}
