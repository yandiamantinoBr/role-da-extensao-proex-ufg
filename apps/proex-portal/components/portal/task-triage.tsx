'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { priorityLabels, TASK_PRIORITIES, type Task } from '@/lib/follow-up/contracts';
import { TRIAGE_CONTEXT_LIMIT, TRIAGE_CRITERIA, TRIAGE_CURRENCY, TRIAGE_INPUT_LIMIT, type TriageResponse } from '@/lib/follow-up/triage-contract';
import { PROVIDERS } from '@/lib/assistant/contracts';

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
 return <details className="rounded-xl border border-[var(--line)] p-3">
  <summary className="min-h-11 cursor-pointer font-semibold">Matriz de urgência e importância</summary>
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
 const [opened,setOpened]=useState(false),[enabled,setEnabled]=useState<boolean|null>(null);
 const [context,setContext]=useState(''),[consent,setConsent]=useState(false),[reviewed,setReviewed]=useState(false);
 const [proposal,setProposal]=useState<Ready|null>(null),[feedback,setFeedback]=useState(''),[preparing,setPreparing]=useState(false);
 const request=useRef<AbortController|null>(null),operation=useRef<string|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function check() {
  if(opened)return;
  setOpened(true);
  const controller=new AbortController();request.current=controller;
  try {
   const response=await fetch(`${triageUrl}?id=${encodeURIComponent(task.id)}`,{cache:'no-store',signal:controller.signal});
   const data=await response.json() as {enabled?:unknown}|null;
   if(!controller.signal.aborted)setEnabled(response.ok&&data?.enabled===true);
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
    body:JSON.stringify({id:task.id,expectedVersion:task.version,operationKey:operation.current,context,consent})});
   const data=await response.json() as {error?:unknown;status?:unknown;proposalId?:unknown;
    proposal?:{urgency?:unknown;importance?:unknown}}|null;
   if(controller.signal.aborted)return;
   if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:'Não foi possível consultar o JEV.');
   if(data?.status==='abstained'){
    setFeedback('O JEV identificou informação insuficiente. Revise a classificação manualmente.');
   }else if(data?.status==='ready'&&typeof data.proposalId==='string'&&
     isLevel(data.proposal?.urgency)&&isLevel(data.proposal?.importance)){
    setProposal({status:'ready',proposalId:data.proposalId,proposal:{urgency:data.proposal.urgency,importance:data.proposal.importance}});
   }else throw new Error('A sugestão chegou incompleta.');
  } catch(error) {
   if(!controller.signal.aborted)setFeedback(error instanceof Error?error.message:'Não foi possível consultar o JEV.');
  } finally {if(!controller.signal.aborted)setPreparing(false);}
 }
 return <details className="rounded-xl border border-[var(--line)] p-3" onToggle={event=>{if(event.currentTarget.open)void check();}}>
  <summary className="min-h-11 cursor-pointer font-semibold">Triagem com JEV</summary>
  {opened&&enabled===null&&<p role="status">Consultando disponibilidade…</p>}
  {enabled===false&&<p className="text-sm text-[var(--text-secondary)]">A triagem com IA está indisponível. Use a edição manual da demanda.</p>}
  {enabled===true&&<form className="grid gap-3" onSubmit={event=>void prepare(event)}>
   <p className="text-sm text-[var(--text-secondary)]">Escreva um resumo operacional sem nomes, contatos ou documentos. O JEV recebe esse resumo e o prazo desta demanda. Reserva estimada de até {maxReserve} por análise.</p>
   <label className="p-field"><span>Resumo a enviar</span><textarea required maxLength={TRIAGE_CONTEXT_LIMIT} rows={3} value={context} disabled={preparing||busy}
    onChange={event=>{operation.current=null;setContext(event.target.value);setProposal(null);setReviewed(false);setConsent(false);setFeedback('');}}/></label>
   <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={consent} disabled={preparing||busy}
    onChange={event=>setConsent(event.target.checked)}/> Autorizo enviar este resumo e prazo à TypeSafe.</label>
   <button type="submit" className={button} disabled={!context.trim()||!consent||preparing||busy||!!proposal}>Preparar sugestão</button>
   {preparing&&<p role="status">Preparando sugestão…</p>}
   {feedback&&<p role="status" className="text-sm text-[var(--text-secondary)]">{feedback}</p>}
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
