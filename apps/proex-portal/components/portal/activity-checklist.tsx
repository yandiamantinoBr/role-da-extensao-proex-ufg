'use client';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, CheckCircle2, ClipboardCheck, ListPlus, TriangleAlert } from 'lucide-react';
import type { ActivityChecklist, ActivityStep, Catalog } from '@/lib/follow-up/contracts';
import { DraftNotice, useFormDraft } from './use-form-draft';
import styles from './activity-checklist.module.css';
type Save = (input: Record<string, unknown>) => Promise<void>;
const answers = {yes:'Sim',no:'Não',not_applicable:'Não se aplica'} as const;
const model = ['A pessoa apresentadora compareceu?', 'A pessoa avaliadora compareceu?', 'A apresentação foi realizada?', 'O encerramento da mesa foi registrado?'];
export function ActivityChecklistCreator({catalog,organizationId,projectId,busy,save,assignments}:{catalog:Catalog;organizationId:string;projectId:string;busy:boolean;save:Save;assignments?:ReactNode}) {
 const form=useRef<HTMLFormElement>(null),operation=useRef<string|null>(null),draft=useFormDraft(form,`followup:activity:new:${organizationId}:${projectId}`);
 const [rowsText,setRowsText]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(busy)return;setError('');const values=new FormData(event.currentTarget),rows=String(values.get('steps')??'').split(/\r?\n/).map(label=>label.trim()).filter(Boolean).map(label=>({label}));
  if(!rows.length||rows.length>100||rows.some(row=>row.label.length>160)){setError('Inclua de 1 a 100 verificações, com até 160 caracteres por linha.');return;}
  const selected=(prefix:string)=>[...values.entries()].filter(([name,value])=>name.startsWith(prefix)&&value==='on').map(([name])=>name.slice(prefix.length));
  operation.current??=crypto.randomUUID();
  try{await save({action:'checklist.activity.create',projectId,organizationId,title:values.get('title'),body:values.get('body'),campaignId:values.get('campaignId')||null,rows,userIds:selected('person:'),teamIds:selected('team:'),operationKey:operation.current});draft.clear();operation.current=null;}
  catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível salvar. Seu checklist foi preservado.');}
 }
 return <form ref={form} className={styles.creator} onSubmit={event=>void submit(event)}><DraftNotice draft={draft}/><fieldset disabled={busy}>
  <label>Título da atividade<input name="title" required maxLength={160} placeholder="Ex.: Conferência da mesa de apresentação"/></label>
  <label>Orientações<textarea name="body" maxLength={4000} rows={2}/></label>
  <label>Evento relacionado<select name="campaignId" defaultValue=""><option value="">Sem evento vinculado</option>{catalog.campaigns.map(campaign=><option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
  <div className={styles.model}><span><ClipboardCheck size={18} aria-hidden="true"/>Comece do zero ou use um modelo editável.</span><button type="button" className="p-button p-button-subtle" onClick={()=>{setRowsText(current=>[current.trim(),...model].filter(Boolean).join('\n'));setMessage('Modelo adicionado ao rascunho. Revise as verificações antes de criar.');operation.current=null;}}><ListPlus size={16} aria-hidden="true"/>Adicionar modelo: Mesa de apresentação</button></div>
  <label>Verificações · uma por linha<textarea name="steps" required rows={6} maxLength={16100} value={rowsText} onChange={event=>{setRowsText(event.target.value);operation.current=null;}} placeholder="A pessoa apresentadora compareceu?&#10;A apresentação foi realizada?"/></label><p className={styles.help}>Até 100 verificações. Cada linha será respondida com Sim, Não ou Não se aplica. O modelo não inclui nomes e pode ser alterado antes de criar.</p>
  {assignments}
  {message&&<p className={styles.help} role="status">{message}</p>}{error&&<p className="p-inline-error" role="alert">{error}</p>}
  <button type="submit" className="p-button p-button-primary"><ClipboardCheck size={16} aria-hidden="true"/>{busy?'Salvando…':'Criar checklist de atividade'}</button>
 </fieldset></form>;
}
function ActivityStepRow({row,checklistId,busy,canWork,save}:{row:ActivityStep;checklistId:string;busy:boolean;canWork:boolean;save:Save}) {
 const form=useRef<HTMLFormElement>(null),operation=useRef<string|null>(null),draft=useFormDraft(form,canWork?`followup:activity-step:${row.id}:${row.version}`:null);
 const [answer,setAnswer]=useState<ActivityStep['answer']>(row.answer),[note,setNote]=useState(row.note),[error,setError]=useState('');
 const changed=answer!==row.answer||note!==row.note;
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy||!canWork)return;setError('');operation.current??=crypto.randomUUID();try{await save({action:'checklist.activity.answer',id:checklistId,rowId:row.id,expectedVersion:row.version,answer,note,operationKey:operation.current});draft.clear();operation.current=null;}catch(cause){setError(cause instanceof Error?cause.message:'Resposta não confirmada. Seu texto foi preservado.');}}
 return <form ref={form} className={styles.step} onSubmit={event=>void submit(event)}><div className={styles.stepHeading}><h5>{row.position+1}. {row.label}</h5>{row.answer!==null&&<span className={styles.saved} data-answer={row.answer}>{row.answer==='no'?<TriangleAlert size={14}/>:<Check size={14}/>}Conferido</span>}</div><DraftNotice draft={draft}/><fieldset disabled={busy||!canWork}><legend className="sr-only">Resposta para {row.label}</legend><div className={styles.answers}>{Object.entries(answers).map(([value,label])=><label key={value} data-selected={answer===value} data-answer={value}><input type="radio" name="answer" value={value} checked={answer===value} onChange={()=>{setAnswer(value as NonNullable<ActivityStep['answer']>);operation.current=null;}}/>{label}</label>)}</div><details className={styles.noteDisclosure} open={Boolean(note)||answer==='no'}><summary>Observação{note?' · registrada':''}</summary><label className={styles.note}><span className="sr-only">Observação para {row.label}</span><textarea name="note" maxLength={600} rows={2} value={note} onChange={event=>{setNote(event.target.value);operation.current=null;}}/></label></details>{canWork&&<div className={styles.stepActions}>{changed&&<span>Alteração por salvar</span>}<button type="submit" className="p-button p-button-subtle" disabled={busy||!changed}><Check size={15} aria-hidden="true"/>Salvar resposta</button></div>}</fieldset>{error&&<p className="p-inline-error" role="alert">{error}</p>}</form>;
}
export function ActivityChecklistView({checklist,canEdit,canWork,busy,save,taskClosed=false}:{checklist:ActivityChecklist;canEdit:boolean;canWork:boolean;busy:boolean;save:Save;taskClosed?:boolean}) {
 const [error,setError]=useState('');const confirmed=checklist.rows.filter(row=>row.answer!==null).length,negative=checklist.rows.filter(row=>row.answer==='no').length,editable=!taskClosed&&checklist.status==='open'&&(canEdit||canWork);
 const needsReview=!canEdit&&negative>0;
 async function complete(){if(busy)return;setError('');try{await save({action:'checklist.activity.complete',id:checklist.id,expectedVersion:checklist.version,operationKey:crypto.randomUUID()});}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível concluir o checklist.');}}
 return <section className={styles.checklist} aria-label="Checklist de atividade"><header><h4><ClipboardCheck size={19} aria-hidden="true"/>{checklist.title}</h4><span>{checklist.status==='completed'?<><CheckCircle2 size={16}/>Concluído</>:`${confirmed} de ${checklist.rows.length} conferidos`}</span></header><progress max={checklist.rows.length} value={confirmed} aria-label={`${confirmed} de ${checklist.rows.length} conferidos`}/><p className={styles.help}>Verificações e observações desta atividade. As respostas não movimentam estoque.</p><div className={styles.summary}><span>{confirmed} conferidos</span><span>{checklist.rows.length-confirmed} pendentes</span>{negative>0&&<span className={styles.negative}><TriangleAlert size={14}/>{negative} com resposta Não</span>}</div>
  <div className={styles.steps}>{checklist.rows.map(row=><ActivityStepRow key={`${row.id}:${row.version}`} row={row} checklistId={checklist.id} canWork={editable} busy={busy} save={save}/>)}</div>
  {editable&&<div className={styles.complete}>{confirmed<checklist.rows.length&&<p className={styles.help}>Responda todas as verificações para concluir.</p>}{needsReview&&<p className={styles.help}>A gestão precisa revisar as respostas Não antes de concluir. Suas respostas continuam salvas.</p>}<button type="button" className="p-button p-button-primary" disabled={busy||confirmed!==checklist.rows.length||needsReview} onClick={()=>void complete()}><CheckCircle2 size={16}/>{busy?'Salvando…':'Concluir checklist'}</button></div>}{error&&<p className="p-inline-error" role="alert">{error}</p>}
 </section>;
}
