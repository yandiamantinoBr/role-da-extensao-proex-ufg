'use client';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, CheckCircle2, ClipboardCheck, ListPlus, TriangleAlert } from 'lucide-react';
import type { ActivityChecklist, ActivityStep, Catalog } from '@/lib/follow-up/contracts';
import { DraftNotice, useFormDraft } from './use-form-draft';
import styles from './activity-checklist.module.css';
type Save = (input: Record<string, unknown>) => Promise<void>;
const answers = {yes:'Sim',no:'Não',not_applicable:'Não se aplica'} as const;
const models = {
 'Mesa de apresentação': ['A pessoa apresentadora compareceu?', 'A pessoa avaliadora compareceu?', 'A apresentação foi realizada?', 'O encerramento da mesa foi registrado?'],
 'Articulação': ['O local, os horários e os contatos da ação foram confirmados?', 'As equipes receberam o roteiro e os horários?', 'Foram conferidas as necessidades de acessibilidade?'],
 'Foto e vídeo': ['A cobertura e as permissões de imagem foram combinadas?', 'As fotos selecionadas foram anexadas ao registro da atividade?', 'Os vídeos foram organizados na pasta restrita e o link foi guardado no projeto?'],
 'Registro da ação': ['Data, local e número de participantes foram conferidos?', 'As atividades realizadas e ocorrências relevantes foram anotadas?', 'O registro foi salvo na ficha do projeto e quaisquer pendências foram atribuídas?'],
 'Apoio no dia': ['O espaço e os equipamentos foram conferidos?', 'O acolhimento e as trocas de turno foram combinados?', 'A desmontagem e as devoluções foram conferidas?'],
 'Água e lanches': ['Os totais de participantes e necessidades alimentares foram conferidos?', 'As quantidades e o horário de entrega foram confirmados?', 'As sobras e os itens que faltaram foram registrados?'],
} as const;
export function ActivityChecklistCreator({catalog,organizationId,projectId,scheduleItemId,busy,save,assignments}:{catalog:Catalog;organizationId:string;projectId:string;scheduleItemId?:string;busy:boolean;save:Save;assignments?:ReactNode}) {
 const form=useRef<HTMLFormElement>(null),operation=useRef<string|null>(null),draft=useFormDraft(form,`followup:activity:new:${organizationId}:${projectId}${scheduleItemId?':'+scheduleItemId:''}`);
 const stepsField=useRef<HTMLTextAreaElement>(null);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const [model,setModel]=useState<keyof typeof models>('Mesa de apresentação');
 function addModel() {
  const field=stepsField.current;
  if(!field)return;
  const existing=field.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const additions=models[model].filter(step=>!existing.includes(step));
  if(additions.length){
   field.value=[...existing,...additions].join('\n');
   field.dispatchEvent(new Event('input',{bubbles:true}));
   operation.current=null;
  }
  setMessage(additions.length?'Verificações adicionadas. Ajuste as linhas conforme a atividade.':'As verificações deste modelo já estão no rascunho.');
 }
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(busy)return;setError('');const values=new FormData(event.currentTarget),rows=String(values.get('steps')??'').split(/\r?\n/).map(label=>label.trim()).filter(Boolean).map(label=>({label}));
  if(!rows.length||rows.length>100||rows.some(row=>row.label.length>160)){setError('Inclua de 1 a 100 verificações, com até 160 caracteres por linha.');return;}
  const selected=(prefix:string)=>[...values.entries()].filter(([name,value])=>name.startsWith(prefix)&&value==='on').map(([name])=>name.slice(prefix.length));
  operation.current??=crypto.randomUUID();
  try{await save({action:'checklist.activity.create',projectId,organizationId,title:values.get('title'),body:values.get('body'),campaignId:values.get('campaignId')||null,...(scheduleItemId?{scheduleItemId}:{}),rows,userIds:selected('person:'),teamIds:selected('team:'),operationKey:operation.current});draft.clear();operation.current=null;}
  catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível salvar. Seu checklist foi preservado.');}
 }
 return <form ref={form} className={styles.creator} onSubmit={event=>void submit(event)}><DraftNotice draft={draft}/><fieldset disabled={busy}>
  <label>{scheduleItemId?'Título do checklist':'Título da atividade'}<input name="title" required maxLength={160} placeholder={scheduleItemId?'Ex.: Apoio no dia':'Ex.: Mesa de apresentação'}/></label>
  <label>Orientações<textarea name="body" maxLength={4000} rows={2}/></label>
  {catalog.campaigns.length>0&&<label>Evento relacionado<select name="campaignId" defaultValue=""><option value="">Sem evento vinculado</option>{catalog.campaigns.map(campaign=><option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>}
  <div className={styles.model}>
   <label>Modelo de checklist<select value={model} onChange={event=>setModel(event.target.value as keyof typeof models)}>{Object.keys(models).map(name=><option key={name}>{name}</option>)}</select></label>
   <button type="button" className="p-button p-button-subtle" onClick={addModel}><ListPlus size={16} aria-hidden="true"/>Adicionar verificações</button>
  </div>
  {message&&<p className={styles.help} role="status">{message}</p>}
  <label>Verificações · uma por linha<textarea ref={stepsField} name="steps" required rows={6} maxLength={16100} onChange={()=>{operation.current=null;setMessage('');}} placeholder="Ex.: O local e os horários foram confirmados?"/></label><p className={styles.help}>Até 100 verificações. Cada linha será respondida com Sim, Não ou Não se aplica.</p>
  {assignments}
  {error&&<p className="p-inline-error" role="alert">{error}</p>}
  <button type="submit" className="p-button p-button-primary"><ClipboardCheck size={16} aria-hidden="true"/>{busy?'Salvando…':'Criar checklist de atividade'}</button>
 </fieldset></form>;
}
function ActivityStepRow({row,checklistId,busy,canWork,save}:{row:ActivityStep;checklistId:string;busy:boolean;canWork:boolean;save:Save}) {
 const form=useRef<HTMLFormElement>(null),operation=useRef<string|null>(null),draft=useFormDraft(form,canWork?`followup:activity-step:${row.id}:${row.version}`:null);
 const [answer,setAnswer]=useState<ActivityStep['answer']>(row.answer),[note,setNote]=useState(row.note),[error,setError]=useState('');
 const changed=answer!==row.answer||note!==row.note;
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy||!canWork)return;setError('');operation.current??=crypto.randomUUID();try{await save({action:'checklist.activity.answer',id:checklistId,rowId:row.id,expectedVersion:row.version,answer,note,operationKey:operation.current});draft.clear();operation.current=null;}catch(cause){setError(cause instanceof Error?cause.message:'Resposta não confirmada. Seu texto foi preservado.');}}
 return <form ref={form} className={styles.step} onSubmit={event=>void submit(event)}><div className={styles.stepHeading}><h5>{row.position+1}. {row.label}</h5>{row.answer!==null&&<span className={styles.saved} data-answer={row.answer}>{row.answer==='no'?<TriangleAlert size={14}/>:<Check size={14}/>} {row.answer==='no'?'Atenção registrada':'Conferido'}</span>}</div><DraftNotice draft={draft}/><fieldset disabled={busy||!canWork}><legend className="sr-only">Resposta para {row.label}</legend><div className={styles.answers}>{Object.entries(answers).map(([value,label])=><label key={value} data-selected={answer===value} data-answer={value}><input type="radio" name="answer" value={value} checked={answer===value} onChange={()=>{setAnswer(value as NonNullable<ActivityStep['answer']>);operation.current=null;}}/>{label}</label>)}</div><details className={styles.noteDisclosure} open={Boolean(note)||answer==='no'}><summary>Observação{note?' · registrada':''}</summary><label className={styles.note}><span className="sr-only">Observação para {row.label}</span><textarea name="note" maxLength={600} rows={2} value={note} onChange={event=>{setNote(event.target.value);operation.current=null;}}/></label></details>{canWork&&<div className={styles.stepActions}>{changed&&<span>Alteração por salvar</span>}<button type="submit" className="p-button p-button-subtle" disabled={busy||!changed}><Check size={15} aria-hidden="true"/>Salvar resposta</button></div>}</fieldset>{error&&<p className="p-inline-error" role="alert">{error}</p>}</form>;
}
export function ActivityChecklistView({checklist,canEdit,canWork,busy,save,taskClosed=false}:{checklist:ActivityChecklist;canEdit:boolean;canWork:boolean;busy:boolean;save:Save;taskClosed?:boolean}) {
 const [error,setError]=useState('');const confirmed=checklist.rows.filter(row=>row.answer!==null).length,negative=checklist.rows.filter(row=>row.answer==='no').length,editable=!taskClosed&&checklist.status==='open'&&(canEdit||canWork);
 const needsReview=!canEdit&&negative>0;
 async function complete(){if(busy)return;setError('');try{await save({action:'checklist.activity.complete',id:checklist.id,expectedVersion:checklist.version,operationKey:crypto.randomUUID()});}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível concluir o checklist.');}}
 return <section className={styles.checklist} aria-label="Checklist de atividade"><header><h4><ClipboardCheck size={19} aria-hidden="true"/>{checklist.title}</h4><span>{checklist.status==='completed'?<><CheckCircle2 size={16}/>Concluído</>:`${confirmed} de ${checklist.rows.length} conferidos`}</span></header><progress max={checklist.rows.length} value={confirmed} aria-label={`${confirmed} de ${checklist.rows.length} conferidos`}/><p className={styles.help}>Verificações e observações desta atividade. As respostas não movimentam estoque.</p><div className={styles.summary}><span>{confirmed} conferidos</span><span>{checklist.rows.length-confirmed} {checklist.rows.length-confirmed===1?'pendente':'pendentes'}</span>{negative>0&&<span className={styles.negative}><TriangleAlert size={14}/>{negative} com resposta Não</span>}</div>
  <div className={styles.steps}>{checklist.rows.map(row=><ActivityStepRow key={`${row.id}:${row.version}`} row={row} checklistId={checklist.id} canWork={editable} busy={busy} save={save}/>)}</div>
  {editable&&<div className={styles.complete}>{confirmed<checklist.rows.length&&<p className={styles.help}>Responda todas as verificações para concluir.</p>}{needsReview&&<p className={styles.help}>A gestão precisa revisar as respostas Não antes de concluir. Suas respostas continuam salvas.</p>}<button type="button" className="p-button p-button-primary" disabled={busy||confirmed!==checklist.rows.length||needsReview} onClick={()=>void complete()}><CheckCircle2 size={16}/>{busy?'Salvando…':'Concluir checklist'}</button></div>}{error&&<p className="p-inline-error" role="alert">{error}</p>}
 </section>;
}
