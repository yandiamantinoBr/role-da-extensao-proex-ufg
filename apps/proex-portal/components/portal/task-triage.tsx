'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { priorityLabels, TASK_PRIORITIES, type Task } from '@/lib/follow-up/contracts';
import { TRIAGE_CONTEXT_LIMIT, TRIAGE_CRITERIA, TRIAGE_CURRENCY, TRIAGE_INPUT_LIMIT, type TriageResponse } from '@/lib/follow-up/triage-contract';
import { PROVIDERS } from '@/lib/assistant/contracts';
import { shownRouteName, triageConsentText, triageNoticeText } from '@/lib/assistant/role-contracts';

const button='p-button p-button-subtle min-h-11 justify-self-start';
const triageUrl='/api/follow-up/triage';
const maxReserve=TRIAGE_CURRENCY.format(Math.ceil(TRIAGE_INPUT_LIMIT*PROVIDERS.typesafe.inputMicrosPerToken)/1_000_000);
type Ready = Extract<TriageResponse,{status:'ready'}>;
function isLevel(value:unknown):value is Task['priority'] {
 return typeof value==='string'&&Object.hasOwn(priorityLabels,value);
}

export function TaskTriageMatrix({tasks}:{tasks:Task[]}) {
 const pending=tasks.filter(task=>task.status!=='completed'&&task.status!=='cancelled');
 if(!pending.length)return null;
 const without=pending.filter(task=>task.importance==null).length;
 return <details className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 open:pb-3">
  <summary className="min-h-11 cursor-pointer py-2.5 font-semibold text-[var(--brand-ink)]">Matriz de urgência e importância</summary>
  <p className="mb-2 text-sm text-[var(--text-secondary)]">{pending.length} demandas pendentes nesta página. Sem importância definida: {without}.</p>
  <table className="w-full table-fixed border-collapse text-center text-xs">
   <caption className="sr-only">Contagem por urgência e importância na página atual</caption>
   <thead><tr><th scope="col" className="break-words p-1">Urgência</th>
    {TASK_PRIORITIES.map(level=><th scope="col" className="break-words p-1" key={level}>{priorityLabels[level]}</th>)}
   </tr></thead>
   <tbody>{TASK_PRIORITIES.map(urgency=><tr key={urgency}>
    <th scope="row" className="break-words p-1">{priorityLabels[urgency]}</th>
    {TASK_PRIORITIES.map(importance=>{
     const count=pending.filter(task=>task.priority===urgency&&task.importance===importance).length;
     return <td className={`border border-[var(--line)] p-2 tabular-nums ${count?'bg-[var(--surface-soft)] font-bold text-[var(--brand-ink)]':''}`} key={importance}>{count}</td>;
    })}
   </tr>)}</tbody>
  </table>
  <p className="mt-2 text-xs text-[var(--text-secondary)]">Linhas indicam urgência. Colunas indicam importância.</p>
 </details>;
}

export function TaskTriage({task,busy,save}:{task:Task;busy:boolean;save:(input:Record<string,unknown>)=>Promise<void>}) {
 const [opened,setOpened]=useState(false),[enabled,setEnabled]=useState<boolean|null>(null),[reserve,setReserve]=useState<number|null>(null);
 // Nome do modelo escolhido que recebe o resumo; null = padrão de hoje (JEV, da TypeSafe).
 const [destination,setDestination]=useState<string|null>(null),[approval,setApproval]=useState<string|undefined>();
 const failed=destination?'Não foi possível concluir a triagem.':'Não foi possível consultar o JEV.';
 const [context,setContext]=useState(''),[consent,setConsent]=useState(false),[reviewed,setReviewed]=useState(false);
 const [proposal,setProposal]=useState<Ready|null>(null),[feedback,setFeedback]=useState(''),[preparing,setPreparing]=useState(false);
 const request=useRef<AbortController|null>(null),operation=useRef<string|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function check(again=false) {
  if(opened&&!again)return;
  setOpened(true);
  setEnabled(null);
  const controller=new AbortController();request.current=controller;
  try {
   const response=await fetch(`${triageUrl}?id=${encodeURIComponent(task.id)}`,{cache:'no-store',signal:controller.signal});
   const data=await response.json() as {enabled?:unknown;reserveUsdMicros?:unknown;destinationName?:unknown;approval?:unknown}|null;
   if(controller.signal.aborted)return;
   setEnabled(response.ok&&data?.enabled===true);
   // Com modelo de decisão escolhido, o servidor informa a reserva que vai fazer; sem ele, vale o número de sempre.
   const micros=response.ok?data?.reserveUsdMicros:null;
   setReserve(typeof micros==='number'&&Number.isSafeInteger(micros)&&micros>0?micros:null);
   // Com modelo escolhido, o servidor diz quem recebe o resumo. A autorização vale só para o destino mostrado: se ele muda, a pessoa marca de novo.
   const name=response.ok?shownRouteName(data?.destinationName):'';
   const reviewedApproval=typeof data?.approval==='string'?data.approval:undefined;
   if(name!==(destination??'')||reviewedApproval!==approval)setConsent(false);
   setApproval(reviewedApproval);
   setDestination(name||null);
  } catch {if(!controller.signal.aborted)setEnabled(false);}
 }
 async function prepare(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if(!enabled||preparing||busy||!consent||!context.trim())return;
  const controller=new AbortController();request.current=controller;
  operation.current??=crypto.randomUUID();
  setPreparing(true);setFeedback('');setProposal(null);setReviewed(false);
  try {
   const response=await fetch(triageUrl,{method:'POST',cache:'no-store',signal:controller.signal,
    headers:{'Content-Type':'application/json','X-Proex-Action':'1'},
    body:JSON.stringify({id:task.id,expectedVersion:task.version,operationKey:operation.current,context,consent,destinationName:destination??'',approval})});
   const data=await response.json() as {error?:unknown;code?:unknown;status?:unknown;proposalId?:unknown;
    proposal?:{urgency?:unknown;importance?:unknown}}|null;
   if(controller.signal.aborted)return;
   if(!response.ok){
    // O modelo que recebe o resumo mudou depois do aviso: mostra o destino de agora e pede a autorização de novo.
    if(data?.code==='triage_destination'){operation.current=null;setConsent(false);void check(true);}
    throw new Error(typeof data?.error==='string'?data.error:failed);
   }
   if(data?.status==='abstained'){
    setFeedback(`${destination?'A triagem':'O JEV'} identificou informação insuficiente. Revise a classificação manualmente.`);
   }else if(data?.status==='ready'&&typeof data.proposalId==='string'&&
     isLevel(data.proposal?.urgency)&&isLevel(data.proposal?.importance)){
    setProposal({status:'ready',proposalId:data.proposalId,proposal:{urgency:data.proposal.urgency,importance:data.proposal.importance}});
   }else throw new Error('A sugestão chegou incompleta.');
  } catch(error) {
   if(!controller.signal.aborted)setFeedback(error instanceof Error?error.message:failed);
  } finally {if(!controller.signal.aborted)setPreparing(false);}
 }
 return <details className="rounded-xl border border-[var(--line)] p-3" onToggle={event=>{if(event.currentTarget.open)void check();}}>
  <summary className="min-h-11 cursor-pointer font-semibold">{destination?'Triagem com IA':'Triagem com JEV'}</summary>
  {opened&&enabled===null&&<p role="status">Consultando disponibilidade…</p>}
  {enabled===false&&<p className="text-sm text-[var(--text-secondary)]">A triagem com IA está indisponível. Use a edição manual da demanda.</p>}
  {feedback&&<p role="status" className="text-sm text-[var(--text-secondary)]">{feedback}</p>}
  {enabled===true&&<form className="grid gap-3" onSubmit={event=>void prepare(event)}>
   <p className="text-sm text-[var(--text-secondary)]">Escreva um resumo operacional sem nomes, contatos ou documentos. {triageNoticeText(destination)} Reserva estimada de até {reserve===null?maxReserve:TRIAGE_CURRENCY.format(reserve/1_000_000)} por análise.</p>
   <label className="p-field"><span>Resumo a enviar</span><textarea required maxLength={TRIAGE_CONTEXT_LIMIT} rows={3} value={context} disabled={preparing||busy}
    onChange={event=>{operation.current=null;setContext(event.target.value);setProposal(null);setReviewed(false);setConsent(false);setFeedback('');}}/></label>
   <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={consent} disabled={preparing||busy}
    onChange={event=>setConsent(event.target.checked)}/> {triageConsentText(destination)}</label>
   <button type="submit" className={button} disabled={!context.trim()||!consent||preparing||busy||!!proposal}>Preparar sugestão</button>
   {preparing&&<p role="status">Preparando sugestão…</p>}
   {proposal&&<div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-3">
    <h4 className="font-bold">Sugestão para revisão</h4>
    <dl className="grid gap-3 @min-[560px]:grid-cols-2">
     <div><dt className="font-semibold">Urgência {priorityLabels[proposal.proposal.urgency].toLocaleLowerCase('pt-BR')}</dt>
      <dd className="text-sm">{TRIAGE_CRITERIA.urgency[proposal.proposal.urgency]}</dd></div>
     <div><dt className="font-semibold">Importância {priorityLabels[proposal.proposal.importance].toLocaleLowerCase('pt-BR')}</dt>
      <dd className="text-sm">{TRIAGE_CRITERIA.importance[proposal.proposal.importance]}</dd></div>
    </dl>
    <p className="text-sm text-[var(--text-secondary)]">Confira esses critérios com o contexto. A sugestão vale por até 10 minutos.</p>
    <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={reviewed} disabled={busy}
     onChange={event=>setReviewed(event.target.checked)}/> Revisei e aprovo os dois níveis para esta demanda.</label>
    <div className="flex flex-wrap gap-3">
     <button type="button" className="p-button p-button-primary min-h-11" disabled={!reviewed||busy}
      onClick={()=>void save({action:'task.triage.apply',id:task.id,expectedVersion:task.version,proposalId:proposal.proposalId,confirmed:true}).catch(()=>{})}>Confirmar classificação</button>
     <button type="button" className={button} disabled={busy} onClick={()=>{operation.current=null;setProposal(null);setReviewed(false);setConsent(false);}}>Descartar sugestão</button>
    </div>
   </div>}
  </form>}
 </details>;
}
