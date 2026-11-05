'use client';
import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
export type DocumentFormat = 'pdf'|'xlsx'|'docx';
export default function ExportFormats({onExport,disabled,label='Baixar recorte'}:{onExport:(format:DocumentFormat)=>void|Promise<void>;disabled?:boolean;label?:string}){
  const [busy,setBusy]=useState<DocumentFormat|null>(null),[error,setError]=useState('');
  async function run(format:DocumentFormat){if(busy)return;setBusy(format);setError('');try{await onExport(format);toast.success(`${format.toUpperCase()} preparado para download`);}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível preparar o arquivo. Tente novamente.');toast.error('O arquivo não foi preparado. Confira o aviso junto às exportações.');}finally{setBusy(null);}}
  return <div><div role="group" aria-label={label} style={{display:'flex',flexWrap:'wrap',gap:8}}>{(['pdf','xlsx','docx'] as const).map(format=><button key={format} type="button" className="p-button p-button-subtle" disabled={disabled||!!busy} onClick={()=>void run(format)} aria-label={`${label} em ${format.toUpperCase()}`}>{busy===format?<LoaderCircle size={16} className="p-spin"/>:<Download size={16}/>} {format.toUpperCase()}</button>)}</div>{error&&<p className="p-inline-error" role="alert" style={{marginTop:8,maxWidth:480}}>{error}</p>}</div>;
}
