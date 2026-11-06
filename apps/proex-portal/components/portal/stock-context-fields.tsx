'use client';
import DateTimeField from './date-time-field';
import { useEffect, useState } from 'react';
import type { Row } from '@/lib/database';

export function stockContextFields(form: FormData): Row {
  const counterpartyType = String(form.get('counterpartyType') ?? '');
  return { counterpartyType: counterpartyType || null, counterpartyId: counterpartyType ? form.get('counterpartyId') : null,
    processReference: form.get('processReference') ?? '', beneficiaryReference: form.get('beneficiaryReference') ?? '',
    ...(form.get('occurredAt') ? {occurredAt:new Date(String(form.get('occurredAt'))).toISOString()} : {}) };
}
export default function StockContextFields({ projectId, kind }: {projectId:string;kind:string}) {
  const [type,setType]=useState(''),[result,setResult]=useState<{projectId:string;units:Row[];projects:Row[];error:string}|null>(null),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!projectId)return;
    const controller=new AbortController();
    void fetch(`/api/materials/context?projectId=${encodeURIComponent(projectId)}`,{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json() as Row;if(!response.ok)throw new Error(body.error||'Não foi possível carregar unidades e projetos.');if(!controller.signal.aborted)setResult({projectId,units:body.units,projects:body.projects,error:''});}).catch(error=>{if(!controller.signal.aborted)setResult({projectId,units:[],projects:[],error:error instanceof Error?error.message:'Falha ao carregar unidades e projetos.'});});
    return()=>controller.abort();
  },[projectId,retry]);
  const current=result?.projectId===projectId?result:null,options=type==='unit'?current?.units:current?.projects;
  const label=kind==='receive'?'Origem do recebimento':kind==='adjust'?'Unidade ou projeto relacionado':'Destino / quem recebeu';
  return <div className="p-form-grid">
    <label className="p-field"><span>{label}</span><select name="counterpartyType" value={type} onChange={event=>setType(event.target.value)}><option value="">Não informado</option><option value="unit">Unidade / órgão</option><option value="project">Outro projeto</option></select></label>
    {type&&<label className="p-field"><span>{type==='unit'?'Unidade / órgão':'Projeto'} *</span><select key={`${type}:${projectId}`} name="counterpartyId" required defaultValue="" disabled={!current||Boolean(current.error)}><option value="">{!current?'Carregando…':'Selecione'}</option>{options?.map(option=><option key={option.id} value={option.id}>{option.acronym?`${option.acronym} · `:''}{option.name}</option>)}</select>{current?.error&&<small role="alert">{current.error} <button type="button" className="p-text-link" onClick={()=>setRetry(value=>value+1)}>Tentar novamente</button></small>}{type==='project'&&<small>Registra o destino; não transfere o estoque para outro cadastro.</small>}</label>}
    <label className="p-field"><span>Processo SEI ou referência</span><input name="processReference" maxLength={120} placeholder="Ex.: número do processo"/></label>
    <label className="p-field"><span>Setor, equipe ou pessoa atendida</span><input name="beneficiaryReference" maxLength={160} placeholder="Identificação necessária à operação"/></label>
    <label className="p-field"><span>Quando aconteceu</span><DateTimeField aria-label="Quando aconteceu" name="occurredAt" /><small>Opcional. Sem preencher, fica o horário do registro. Horários deste aparelho.</small></label>
  </div>;
}
