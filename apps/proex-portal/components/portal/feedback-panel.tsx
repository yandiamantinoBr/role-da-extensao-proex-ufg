'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, MessageSquarePlus, RefreshCw, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { PORTAL_MODULES, type ModuleId } from './navigation-model';
import styles from './feedback-panel.module.css';

type Entry = { id:string; kind:'problem'|'suggestion'; module:string; body:string; status:'new'|'reviewing'|'resolved'; release:string; version:number; created_at:string; canManage:boolean };
type Project = {id:string;name:string};
const labels = {new:'Recebido',reviewing:'Em análise',resolved:'Resolvido'};
export default function FeedbackPanel({release,module,projects,projectId}:{release:string;module:ModuleId;projects:Project[];projectId:string}) {
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId(),key=useRef('');
  const reader=useRef<AbortController|null>(null),generation=useRef(0);
  const [open,setOpen]=useState(false),[body,setBody]=useState(''),[kind,setKind]=useState('suggestion'),[selected,setSelected]=useState(''),[area,setArea]=useState<ModuleId>(module);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[entries,setEntries]=useState<Entry[]>([]),[manage,setManage]=useState(false),[loading,setLoading]=useState(false),[readError,setReadError]=useState('');
  async function load(management:boolean) {
    reader.current?.abort();const controller=new AbortController(),epoch=++generation.current;reader.current=controller;
    setLoading(true);setReadError('');setEntries([]);
    try { const response=await fetch(`/api/feedback${management?'?manage=1':''}`,{cache:'no-store',signal:controller.signal});const result=await response.json() as {error?:string;entries:Entry[]};if(controller.signal.aborted||epoch!==generation.current)return;if(!response.ok)throw new Error(result.error||'Não foi possível consultar seu feedback.');setEntries(result.entries); }
    catch(cause){if(!controller.signal.aborted&&epoch===generation.current){setReadError(cause instanceof Error?cause.message:'Falha de conexão. Tente novamente.');setEntries([]);}}
    finally{if(!controller.signal.aborted&&epoch===generation.current)setLoading(false);}
  }
  useEffect(()=>()=>{reader.current?.abort();},[]);
  useEffect(()=>{if(open){dialog.current?.showModal();const prior=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=prior;};}dialog.current?.close();},[open]);
  function cancelRead(){reader.current?.abort();generation.current++;setLoading(false);}
  function close(){if(busy)return;cancelRead();setOpen(false);trigger.current?.focus();}
  function show(){setSelected(projects.some(p=>p.id===projectId)?projectId:'');setArea(module);setMessage('');setError('');setOpen(true);void load(manage);}
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');key.current ||= crypto.randomUUID();
    try {const response=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json','X-Proex-Action':'1'},body:JSON.stringify({action:'create',body,kind,module:area,projectId:selected||null,operationKey:key.current})});const result=await response.json() as {error?:string;entries:Entry[]};if(!response.ok)throw new Error(result.error||'Não foi possível enviar.');setBody('');key.current='';setMessage('Feedback recebido. Você pode acompanhar o estado abaixo.');toast.success('Feedback recebido');void load(manage);}
    catch(cause){setError(cause instanceof Error?cause.message:'Falha de conexão. Seu texto foi preservado.');toast.error('Feedback não confirmado. Confira o formulário.');}
    finally{setBusy(false);}
  }
  async function update(entry:Entry,status:string){setBusy(true);setError('');try{const response=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json','X-Proex-Action':'1'},body:JSON.stringify({action:'status',id:entry.id,status,expectedVersion:entry.version})});const result=await response.json() as {error?:string;entries:Entry[]};if(!response.ok)throw new Error(result.error||'Não foi possível atualizar.');toast.success('Estado do feedback atualizado');void load(manage);}catch(cause){setError(cause instanceof Error?cause.message:'Falha de conexão.');}finally{setBusy(false);}}
  return <><button ref={trigger} type="button" className="p-button p-button-subtle" onClick={show}><MessageSquarePlus size={16}/>Sugestão ou problema</button><dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={event=>{event.preventDefault();close();}} onClose={()=>{if(dialog.current?.open)return;cancelRead();setOpen(false);trigger.current?.focus();}}>
    <div className={`${styles.head} ${styles.modalHead}`}><div><h2 id={`${id}-title`}>Ajude a melhorar o Portal</h2><small>Versão {release}</small></div><button type="button" className="p-icon-button" aria-label="Fechar feedback" onClick={close} disabled={busy}><X size={20}/></button></div>
    <form onSubmit={submit} className={styles.form}>
      <div className={styles.fields}><label>Tipo<select value={kind} disabled={busy} onChange={e=>{setKind(e.target.value);key.current='';}}><option value="suggestion">Sugestão de melhoria</option><option value="problem">Problema ao usar</option></select></label><label>Área<select value={area} disabled={busy} onChange={e=>{setArea(e.target.value as ModuleId);key.current='';}}>{PORTAL_MODULES.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label></div>
      <label>Projeto relacionado<select value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);key.current='';}}><option value="">Uso geral da plataforma</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label htmlFor={`${id}-body`}>O que aconteceu ou pode melhorar?</label><textarea autoFocus id={`${id}-body`} minLength={10} maxLength={2000} required value={body} disabled={busy} onChange={e=>{setBody(e.target.value);key.current='';}} placeholder="Conte o que tentou fazer, o resultado e o que esperava." aria-describedby={`${id}-help`}/>
      <p id={`${id}-help`} className="p-form-help">{body.length}/2.000 caracteres. Não envie senhas, chaves ou informações pessoais desnecessárias. Você e a gestão autorizada poderão consultar o registro.</p>
      {error&&<p role="alert" className="p-inline-error">{error}</p>}{message&&<p role="status" className="p-form-help"><Check size={16}/>{message}</p>}
      <button type="submit" className="p-button p-button-primary" disabled={busy}>{busy?<LoaderCircle className="p-spin" size={16}/>:<Send size={16}/>}Enviar feedback</button>
    </form>
    <section className={styles.history} aria-labelledby={`${id}-history`} aria-busy={loading}><div className={styles.head}><h3 id={`${id}-history`}>Acompanhar feedback</h3><button type="button" className="p-icon-button" aria-label="Atualizar feedback" onClick={()=>void load(manage)} disabled={loading||busy}><RefreshCw size={18}/></button></div><label className={styles.toggle}><input type="checkbox" checked={manage} disabled={busy||loading} onChange={e=>{setManage(e.target.checked);void load(e.target.checked);}}/>Ver registros que posso gerenciar</label>
    {readError?<p role="alert" className="p-inline-error">{readError}</p>:loading?<p role="status">Consultando…</p>:!entries.length?<p className="p-form-help">Nenhum registro nesta lista.</p>:<><p className="p-form-help">Até 50 registros mais recentes.</p><ul>{entries.map(entry=><li key={entry.id}><span className={styles.status} data-status={entry.status}>{labels[entry.status]}</span><small>{PORTAL_MODULES.find(m=>m.id===entry.module)?.label} · {new Date(entry.created_at).toLocaleDateString('pt-BR')}</small><p>{entry.body}</p><small>Versão {entry.release}</small>{entry.canManage&&<label>Estado<select value={entry.status} disabled={busy} onChange={e=>void update(entry,e.target.value)}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}</li>)}</ul></>}
    </section>
  </dialog></>;
}
