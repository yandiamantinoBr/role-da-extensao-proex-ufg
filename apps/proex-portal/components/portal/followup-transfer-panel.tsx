'use client';

import {useEffect,useId,useRef,useState,type FormEvent,type SyntheticEvent} from 'react';
import {ArrowRightLeft,RefreshCw} from 'lucide-react';
import styles from './followup-transfer-panel.module.css';
import {toast} from 'sonner';
import {TRANSFER_REASON_MAX,blockerLabels,type TransferPreview,type TransferReceipt} from '@/lib/follow-up/transfer-contracts';

type Props={userId:string;taskId:string;onTransferred?:(receipt:TransferReceipt)=>void};
type Notice={tone:'error'|'success'|'info';text:string;refresh?:boolean};
const ENDPOINT='/api/follow-up/transfer';
const TOUCH={minHeight:44,minWidth:44};

class TransferApiError extends Error{
 status:number;code:string;
 constructor(message:string,status:number,code:string){super(message);this.name='TransferApiError';this.status=status;this.code=code;}
}
async function parse<T>(response:Response):Promise<T>{
 let body:unknown=null;try{body=await response.json();}catch{body=null;}
 if(!response.ok){const value=(body&&typeof body==='object'?body:{}) as {error?:unknown;code?:unknown};throw new TransferApiError(typeof value.error==='string'?value.error:'Não foi possível concluir.',response.status,typeof value.code==='string'?value.code:'request_failed');}
 return body as T;
}
const isAbort=(cause:unknown)=>cause instanceof Error&&cause.name==='AbortError';
const newKey=()=>crypto.randomUUID().replaceAll('-','');

/** Moves ONE simple demand to another project of the same organization. The server decides
 * eligibility and authority; this panel only previews (lazy GET) and confirms (POST). */
export default function FollowupTransferPanel({userId,taskId,onTransferred}:Props){
 const ids=useId();
 const [open,setOpen]=useState(false);
 const [preview,setPreview]=useState<TransferPreview|null>(null);
 const [loading,setLoading]=useState(false);
 const [saving,setSaving]=useState(false);
 const [target,setTarget]=useState('');
 const [reason,setReason]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [notice,setNotice]=useState<Notice|null>(null);
 const epoch=useRef(0);
 const job=useRef<AbortController|null>(null);
 // Same payload => same operation key, so a lost reply is retried idempotently.
 const operation=useRef<{signature:string;key:string}|null>(null);

 // Mount with key={`${userId}:${taskId}`}: a viewer/task change remounts with a clean draft.
 // On unmount or identity change, in-flight requests are aborted and their epoch discarded.
 useEffect(()=>()=>{epoch.current++;job.current?.abort();},[userId,taskId]);

 async function load(keepDraft=true){
  const mine=++epoch.current;job.current?.abort();const controller=new AbortController();job.current=controller;
  setLoading(true);setPreview(null);setConfirmed(false);
  try{
   const data=await parse<TransferPreview>(await fetch(`${ENDPOINT}?taskId=${encodeURIComponent(taskId)}`,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal}));
   if(mine!==epoch.current)return;
   if(!data||data.viewerId!==userId||data.taskId!==taskId||!Array.isArray(data.candidates)||!Number.isSafeInteger(data.version)||data.version<1||!data.source||typeof data.source.name!=='string'||data.candidates.some(c=>!c||typeof c.projectId!=='string'||typeof c.name!=='string'||!Number.isSafeInteger(c.assigneesWithoutAccess)||c.assigneesWithoutAccess<0)){setPreview(null);setTarget('');setConfirmed(false);setNotice({tone:'error',text:'A sessão ou a resposta mudou. Os dados foram ocultados; atualize a página.'});return;}
   setPreview(data);
   if(!keepDraft||!data.candidates.some(c=>c.projectId===target))setTarget(data.candidates.length===1?data.candidates[0].projectId:'');
  }catch(cause){
   if(isAbort(cause)||mine!==epoch.current)return;
   const status=cause instanceof TransferApiError?cause.status:0;
   setPreview(null);
   setNotice({tone:'error',text:status===403?'Somente a gestão (proprietário ou gerente) dos dois projetos pode mover esta demanda.':cause instanceof Error?cause.message:'Não foi possível carregar.'});
  }finally{if(mine===epoch.current){setLoading(false);job.current=null;}}
 }

 function toggle(event:SyntheticEvent<HTMLDetailsElement>){
  const next=event.currentTarget.open;if(!next&&saving){event.currentTarget.open=true;return;}setOpen(next);
  if(next&&!loading)void load();else if(!next){epoch.current++;job.current?.abort();job.current=null;setLoading(false);setPreview(null);setConfirmed(false);}
 }

 async function submit(event:FormEvent){
  event.preventDefault();
  if(!preview||saving)return;
  const text=reason.normalize('NFC').trim();
  if(!target){setNotice({tone:'error',text:'Escolha o projeto de destino.'});return;}
  if(!text){setNotice({tone:'error',text:'Informe o motivo da mudança.'});return;}
  if(!confirmed){setNotice({tone:'error',text:'Confirme a mudança de visibilidade antes de mover.'});return;}
  const body={taskId,targetProjectId:target,expectedVersion:preview.version,reason:text,confirmed:true as const};
  const signature=JSON.stringify(body);
  if(operation.current?.signature!==signature)operation.current={signature,key:newKey()};
  const mine=++epoch.current;job.current?.abort();const controller=new AbortController();job.current=controller;
  setSaving(true);setNotice(null);
  try{
   const receipt=await parse<TransferReceipt>(await fetch(ENDPOINT,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json','X-Proex-Action':'1'},body:JSON.stringify({...body,operationKey:operation.current.key})}));
   if(mine!==epoch.current)return;
   if(!receipt||receipt.viewerId!==userId||receipt.taskId!==taskId||receipt.projectId!==target||receipt.version!==preview.version+1||typeof receipt.duplicate!=='boolean')throw new TransferApiError('A confirmação não corresponde à demanda e ao destino escolhidos. Atualize para conferir.',403,'receipt_mismatch');
   const name=preview.candidates.find(c=>c.projectId===receipt.projectId)?.name??'o projeto escolhido';
   operation.current=null;setReason('');setConfirmed(false);setPreview(null);setOpen(false);
   setNotice({tone:'success',text:`Demanda movida para ${name}.${receipt.duplicate?' (operação já registrada)':''}`});
   toast.success(`Demanda movida para ${name}. Histórico preservado.`,{position:'bottom-right',duration:2500});
   onTransferred?.(receipt);
  }catch(cause){
   if(isAbort(cause)||mine!==epoch.current)return;
   if(cause instanceof TransferApiError){
    // Draft (destination, reason, checkbox) is kept on every error.
    if(cause.status===401||cause.status===403){setPreview(null);setTarget('');setConfirmed(false);setNotice({tone:'error',text:'Seu acesso de gestão mudou. Não foi possível confirmar a operação nesta sessão. Atualize para conferir o registro.'});return;}
    if(cause.status===409){if(cause.code==='operation_changed')operation.current=null;setNotice({tone:'error',text:cause.message,refresh:true});return;}
    setNotice({tone:'error',text:cause.message});return;
   }
   // Network/lost reply: keep the same operation key so "Tentar novamente" is idempotent.
   setNotice({tone:'error',text:'A resposta não chegou. Tente novamente: a mesma operação será reaproveitada sem duplicar.'});
  }finally{if(mine===epoch.current){setSaving(false);job.current=null;}}
 }

 const candidate=preview?.candidates.find(c=>c.projectId===target);
 return (
  <details open={open} onToggle={toggle} className={styles.panel}>
   <summary style={{...TOUCH,display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontWeight:600}}>
    <ArrowRightLeft aria-hidden size={18}/>Mover para outro projeto
   </summary>
   <div style={{display:'grid',gap:12,paddingBottom:12}}>
    {loading&&<p role="status">Carregando opções…</p>}
    {notice&&<div role={notice.tone==='error'?'alert':'status'} className={styles.notice} data-tone={notice.tone}>
     <span>{notice.text}</span>
     {notice.refresh&&<button type="button" className="p-button p-button-subtle" disabled={saving} style={TOUCH} onClick={()=>{setNotice(null);void load(true);}}><RefreshCw aria-hidden size={16}/> Atualizar dados</button>}
    </div>}
    {preview&&!preview.eligible&&preview.reason&&<p>{blockerLabels[preview.reason]}</p>}
    {preview&&preview.eligible&&<form onSubmit={submit} style={{display:'grid',gap:12}}>
     <p>Origem atual: <strong>{preview.source.name}</strong>. A demanda mantém título, descrição, situação, prazos, histórico e responsáveis.</p>
     <label htmlFor={`${ids}-target`}>Projeto de destino</label>
     <select id={`${ids}-target`} value={target} onChange={e=>setTarget(e.target.value)} required style={{...TOUCH,width:'100%'}} disabled={saving}>
      <option value="">Escolha…</option>
      {preview.candidates.map(c=><option key={c.projectId} value={c.projectId}>{c.name}</option>)}
     </select>
     {candidate&&candidate.assigneesWithoutAccess>0&&<p role="note">{candidate.assigneesWithoutAccess===1?'1 responsável individual não tem acesso ao destino e deixará de ver esta demanda.':`${candidate.assigneesWithoutAccess} responsáveis individuais não têm acesso ao destino e deixarão de ver esta demanda.`}</p>}
     {candidate&&candidate.assigneesWithoutAccess===0&&<p role="note">Nenhum responsável individual perderá acesso a esta demanda no projeto de destino.</p>}
     <p>Atenção: integrantes de equipe e o autor só continuam vendo esta demanda se tiverem acesso a {candidate?.name??'o projeto de destino'}. A verificação acima considera apenas atribuições individuais.</p>
     <label htmlFor={`${ids}-reason`}>Motivo (obrigatório)</label>
     <p id={`${ids}-reason-help`}>O motivo fica no histórico do destino. Use informações operacionais e evite dados pessoais.</p>
     <textarea id={`${ids}-reason`} aria-describedby={`${ids}-reason-help`} value={reason} onChange={e=>setReason(e.target.value)} maxLength={TRANSFER_REASON_MAX} required rows={3} style={{width:'100%',minHeight:88}} disabled={saving}/>
     <label style={{...TOUCH,display:'flex',alignItems:'flex-start',gap:8}}>
      <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} style={{minWidth:24,minHeight:24}} disabled={saving}/>
      <span>Entendo que o histórico atual desta demanda ficará visível às pessoas autorizadas no projeto de destino e que acessos antigos podem deixar de valer.</span>
     </label>
     <button type="submit" aria-label="Mover demanda" className="p-button p-button-primary" style={{...TOUCH,display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8}} disabled={saving||!target||!reason.trim()||!confirmed}>
      <ArrowRightLeft aria-hidden size={16}/>{saving?'Movendo…':candidate?`Mover para ${candidate.name}`:'Mover demanda'}
     </button>
    </form>}
   </div>
  </details>
 );
}
