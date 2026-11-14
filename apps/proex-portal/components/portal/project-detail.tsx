'use client';
import DateTimeField from './date-time-field';
import DateField from './date-field';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import styles from './project-panel.module.css';
import ProjectOperationalChart from './project-operational-chart';
import StockConsumptionPanel from './stock-consumption-panel';
import ProjectQuickEntry, { type QuickProjectEntry } from './project-quick-entry';
import ProjectSheetsPanel from './project-sheets-panel';
import { areaLabel, lineLabel } from '@/lib/extension-catalog';
import { ArrowLeft, BarChart3, CalendarDays, Check, ClipboardList, Clock3, ArrowRight, ExternalLink, FileText, FolderKanban, History, Link2, LoaderCircle, Package, Pencil, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { Row } from '@/lib/database';
import { isCivilDate } from '@/lib/civil-date';
import { COMMUNICATION_CHANNELS, COMMUNICATION_NOTE_LIMIT, communicationLabel } from '@/lib/project-communication';
import { useFormDraft, DraftNotice } from './use-form-draft';
import ProjectReportBuilder from './project-report/builder';
import { SheetShortcuts } from './sheet-shortcuts';
export type ProjectShortcutModule = 'demands' | 'calendar';
export type ProjectMaterialAction = (itemId:string, mode?:'view'|'edit'|'move') => void;
type Props={refreshKey?:number;onMaterialOpen?:ProjectMaterialAction;projectId:string;shortcutModules?:readonly ProjectShortcutModule[];sheetOwnerId?:string;projects:Row[];mutate:(action:string,payload:Row)=>Promise<Row>;onBack:()=>void;onEdit:(project:Row)=>void;onSelect?:(id:string)=>void;renderWorkContext?:(projectId:string)=>ReactNode;/** "Quem cuida de cada área" (estoque, empréstimos e dinâmicas do projeto inteiro). */renderAreaOwners?:(projectId:string)=>ReactNode};
type Editor={kind:'link'|'call'|'schedule';row:Row|null};
const lifecycle={active:'Em andamento',past:'Encerrado',catalog:'Catálogo'};
const categories={gift:'Brinde',equipment:'Equipamento',distribution:'Distribuição',consumption:'Consumo'};
const loanLabels={reserved:'Reservado',out:'Retirado',returned:'Devolvido',cancelled:'Cancelado'};
const recordKinds={observation:'Observação',maintenance:'Manutenção',distribution:'Distribuição',consumption:'Consumo',project:'Projeto',material:'Material',loan:'Empréstimo'};
const labels={active:'Ativo',archived:'Arquivado',past:'Passado',catalog:'Catálogo',draft:'Rascunho',open:'Aberto',closed:'Encerrado',planned:'Planejado',completed:'Realizado',cancelled:'Cancelado'};
function label(value:string){return labels[value as keyof typeof labels]||value;}
function dateOf(value:unknown){if(value===null||value===undefined||value==='')return null;const date=new Date(typeof value==='number'?value:String(value));return Number.isFinite(date.getTime())?date:null;}
function availableOf(item:Row){return typeof item.available==='number'&&Number.isFinite(item.available)?item.available:null;}
function loanIsLate(loan:Row,now:number){const end=dateOf(loan.ends_at);return loan.status==='out'&&end!==null&&end.getTime()<now;}
function pretty(value: unknown) {
 const date = dateOf(value);
 return date ? new Intl.DateTimeFormat('pt-BR', { timeZone: isCivilDate(value) ? 'UTC' : 'America/Sao_Paulo', day: '2-digit', month: 'short', year: 'numeric' }).format(date) : 'Não informado';
}
function scheduleWhen(start:unknown,end:unknown){
 if(isCivilDate(start)&&isCivilDate(end))return start===end?pretty(start):`${pretty(start)} → ${pretty(end)}`;
 const first=dateOf(start),last=dateOf(end);if(!first||!last)return `${pretty(start)} → ${pretty(end)}`;
 const day=(value:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
 const clock=(value:Date)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value);
 return day(first)===day(last)?`${pretty(start)} · ${clock(first)}–${clock(last)}`:`${pretty(start)} · ${clock(first)} → ${pretty(end)} · ${clock(last)}`;
}
function localDate(value:unknown){const date=dateOf(value);if(!date)return '';const shifted=new Date(date.getTime()-date.getTimezoneOffset()*60000);return shifted.toISOString().slice(0,16);}
const scheduleDayShape = /^\d{4}-\d{2}-\d{2}$/;
const scheduleTimeShape = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function editableScheduleDay(value: unknown): string {
 return isCivilDate(value) && value >= '2000-01-01' && value <= '2200-12-31' ? value : '';
}
function scheduleEditorDates(row: Row | null) {
 const fields = [
  { name: 'startsAt', dayName: 'startsOn', label: 'Início', dayLabel: 'Dia de início', raw: row?.starts_at },
  { name: 'endsAt', dayName: 'endsOn', label: 'Fim', dayLabel: 'Último dia (incluído)', raw: row?.ends_at },
 ].map(field => {
  const raw = typeof field.raw === 'string' ? field.raw : '';
  return { ...field, raw, timeDay: scheduleTimeShape.exec(raw)?.[1] };
 });
 const hasDay = fields.some(field => scheduleDayShape.test(field.raw));
 const hasTime = fields.some(field => field.timeDay !== undefined);
 return {
  allDay: hasDay && !hasTime,
  fields: fields.map(field => ({
   ...field,
   dayValue: hasTime ? '' : editableScheduleDay(field.raw),
   timeValue: !hasDay && editableScheduleDay(field.timeDay) ? localDate(field.raw) : '',
  })),
 };
}
function safeUrl(value:unknown){if(typeof value!=='string')return '';try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function projectLinkSnapshot(version: Row): Row | null {
 if (version.entity_type !== 'project_link' || typeof version.snapshot_json !== 'string') return null;
 try {
  const snapshot = JSON.parse(version.snapshot_json);
  return snapshot && typeof snapshot.label === 'string' ? snapshot : null;
 } catch { return null; }
}
function MetadataForm({editor,projectId,projects,mutate,done}:{editor:Editor;projectId:string;projects:Row[];mutate:Props['mutate'];done:()=>void}){
 const {kind,row}=editor,[saving,setSaving]=useState(false),[error,setError]=useState(''),key=useRef<string|null>(null),formRef=useRef<HTMLFormElement>(null);
 const schedule = scheduleEditorDates(row);
 const [allDay, setAllDay] = useState(schedule.allDay);
 const [communicationChannel, setCommunicationChannel] = useState<string>(row?.communication_channel ?? '');
 const draft=useFormDraft(formRef,`project-${kind}:${projectId}:${row?.id??'new'}:${row?.version??0}`);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(saving)return;const form=new FormData(event.currentTarget);setSaving(true);setError('');key.current??=crypto.randomUUID();
 try{const payload:Row={projectId,...(row?{id:row.id,expectedVersion:row.version}:{}),operationKey:key.current};const fields=kind==='link'?['label','url','kind','communicationChannel','communicationNote']:kind==='call'?['title','referenceCode','description','status','officialUrl']:['title','status','note','url'];for(const name of fields)payload[name]=form.get(name)||'';
 if (kind === 'call') {
  for (const name of ['opensAt', 'closesAt']) payload[name] = form.get(name) ? new Date(String(form.get(name))).toISOString() : null;
  payload.linkedProjectIds = form.getAll('linkedProjectIds');
 }
 if (kind === 'schedule') {
  for (const { name, dayName, raw, timeValue } of schedule.fields) {
   if (allDay) {
    payload[name] = form.get(dayName);
   } else {
    const entered = String(form.get(name) ?? '');
    payload[name] = timeValue && entered === timeValue ? raw : new Date(entered).toISOString();
   }
  }
 }
 await mutate(`${kind==='call'?'call':`project.${kind}`}.${row?'update':'create'}`,payload);key.current=null;draft.clear();done();}catch(error){setError(error instanceof Error?error.message:'Não foi possível salvar.');}finally{setSaving(false);}}
 const input=(name:string,title:string,extra:Row={})=><label className="p-field"><span>{title}</span><input name={name} defaultValue={row?.[name.replace(/[A-Z]/g,letter=>`_${letter.toLowerCase()}`)]??''} {...extra}/></label>;
 return <form ref={formRef} className="p-form" onSubmit={submit} onChange={()=>{if(!saving)key.current=null;}}><DraftNotice draft={draft}/><fieldset disabled={saving}><div className="p-form-grid">
 {kind==='link'?<>{input('label','Nome do link',{required:true,maxLength:150})}{input('url','Endereço HTTPS',{required:true,type:'url',maxLength:500})}<label className="p-field"><span>Categoria</span><select name="kind" defaultValue={row?.kind??'official'}><option value="official">Página oficial</option><option value="notice">Edital / chamada</option><option value="report">Relatório</option><option value="gallery">Galeria</option><option value="other">Outro recurso</option></select></label>
 <label className="p-field"><span>Comunicação</span><select name="communicationChannel" value={communicationChannel} onChange={event => setCommunicationChannel(event.target.value)}>
  <option value="">Sem classificação de comunicação</option>
  {Object.entries(COMMUNICATION_CHANNELS).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
 </select></label>
 </>:<>{input('title',kind==='call'?'Título do edital':'Título do marco / atividade',{required:true,maxLength:200})}{kind==='call'&&input('referenceCode','Número ou referência',{maxLength:80})}<label className="p-field"><span>Situação</span><select name="status" defaultValue={row?.status??(kind==='call'?'draft':'planned')}>{(kind==='call'?['draft','open','closed','archived']:['planned','completed','cancelled']).map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>{input(kind==='call'?'officialUrl':'url','Fonte oficial / endereço HTTPS',{type:'url',maxLength:500})}
 {kind === 'call' && [['opensAt', 'Abertura'], ['closesAt', 'Encerramento']].map(([name, title]) => <label key={name} className="p-field"><span>{title}</span><DateTimeField aria-label={title} name={name}  defaultValue={localDate(row?.[name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)])}/></label>)}
 {kind === 'schedule' && <>
  <label className="p-field"><span>Formato do período</span><select name="schedulePrecision" value={allDay ? 'day' : 'time'} onChange={event => setAllDay(event.target.value === 'day')}>
   <option value="time">Com horário</option><option value="day">Dia inteiro (sem horário)</option>
  </select></label>
  {/* Keep both pairs mounted so the draft can restore the mode and its dates together. */}
  {schedule.fields.map(({ name, label, timeValue }) => <label key={name} className="p-field" hidden={allDay} style={allDay ? { display: 'none' } : undefined}><span>{label} *</span><DateTimeField aria-label={label} name={name}  required={!allDay} disabled={allDay} defaultValue={timeValue}/></label>)}
  {schedule.fields.map(({ dayName, dayLabel, dayValue }) => <label key={dayName} className="p-field" hidden={!allDay} style={!allDay ? { display: 'none' } : undefined}><span>{dayLabel} *</span><DateField aria-label={dayLabel} name={dayName} min="2000-01-01" max="2200-12-31" required={allDay} disabled={!allDay} defaultValue={dayValue}/></label>)}
 </>}
 </>}
 </div>
 {kind === 'link' && <label className="p-field" hidden={communicationChannel !== 'canva'} style={communicationChannel !== 'canva' ? {display:'none'} : undefined}>
  <span>Páginas e dimensões da arte</span>
  <textarea name="communicationNote" rows={3} maxLength={COMMUNICATION_NOTE_LIMIT} disabled={communicationChannel !== 'canva'} defaultValue={row?.communication_note ?? ''}/>
  <small>Exemplo 1080 × 1350 px nas páginas 1 e 2. Use um link de compartilhamento com acesso destinado à equipe.</small>
 </label>}
 {kind!=='link'&&<label className="p-field"><span>{kind==='call'?'Finalidade e orientações':'Observação institucional'}</span><textarea name={kind==='call'?'description':'note'} maxLength={kind==='call'?4000:2000} rows={3} defaultValue={row?.[kind==='call'?'description':'note']??''}/><small>Use informações institucionais. Não inclua contatos, documentos ou dados pessoais.</small></label>}
 {kind==='call'&&<label className="p-field"><span>Outros projetos relacionados (opcional)</span><select name="linkedProjectIds" multiple defaultValue={row?.linkedProjectIds??[]} size={Math.min(5,Math.max(2,projects.length))}>{projects.filter(project=>project.id!==projectId).map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select><small>É necessário poder administrar todos os projetos vinculados. Essa relação não transfere permissões.</small></label>}
 {kind!=='link'&&<p className="p-form-help">Horários do aparelho. Uma atividade editorial não cria campanha, movimentação ou empréstimo.</p>}
 {error&&<p role="alert" className="p-inline-error">{error}</p>}<div className="p-form-footer"><button type="button" className="p-button p-button-subtle" onClick={done}>Cancelar</button><button className="p-button p-button-primary" type="submit">{saving?<LoaderCircle className="p-spin" size={16}/>:<Check size={16}/>}Salvar</button></div></fieldset></form>;
}
export default function ProjectDetail({projectId,projects,mutate,onBack,onEdit,onSelect,renderWorkContext,renderAreaOwners,shortcutModules=[],sheetOwnerId,onMaterialOpen,refreshKey=0}:Props){
 const [result,setResult]=useState<{key:string;data:Row|null;error:string;receivedAt:number}|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0),[editor,setEditor]=useState<Editor|null>(null),[restoring,setRestoring]=useState(false),[confirmVersion,setConfirmVersion]=useState<Row|null>(null),[allCalls,setAllCalls]=useState(false);
 const [expandedMaterials,setExpandedMaterials]=useState(false);
 const [consumptionOpen,setConsumptionOpen]=useState(false);
 const [quickEntry,setQuickEntry]=useState<{kind:QuickProjectEntry;project:Row;items:Row[]}|null>(null);
 const editorRef=useRef<HTMLElement|null>(null);
 useEffect(()=>{
  if(!editor)return;
  const target=editorRef.current;
  target?.focus({preventScroll:true});
  target?.scrollIntoView({block:'start'});
 },[editor]);
 // Atualizações em segundo plano do MESMO projeto (a cada recarga do portal) mantêm a ficha na tela;
 // outro projeto ou um erro nunca reaproveitam os dados anteriores: desmontar o
 // conteúdo tirava o foco de quem digitava (relatório, formulários) e jogava a página para o topo.
 const requestKey=JSON.stringify([projectId,reload,sheetOwnerId,refreshKey]),fresh=result?.key===requestKey,stale=!fresh&&result?.data?.project?.id===projectId?result.data:null,data=fresh?result.data:stale,loading=!fresh&&!stale,displayError=error||(fresh?result.error:'');
 useEffect(()=>{const controller=new AbortController();fetch(`/api/projects/${encodeURIComponent(projectId)}`,{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json() as Row;if(!response.ok)throw new Error(body.error||'Não foi possível abrir o projeto.');if(body?.project?.id!==projectId)throw new Error('A resposta não corresponde ao projeto solicitado.');if(!controller.signal.aborted)setResult({key:requestKey,data:body,error:'',receivedAt:Date.now()});}).catch(error=>{if(!controller.signal.aborted)setResult({key:requestKey,data:null,error:error.message,receivedAt:Date.now()});});return()=>controller.abort();},[projectId,requestKey]);
 function saved(){setError('');setEditor(null);setReload(value=>value+1);}
 async function restore(version:Row){if(!data||restoring)return;const entities=[data.project,...data.links,...data.calls,...data.schedule],current=entities.find(row=>row.id===version.entity_id);if(!current)return;setRestoring(true);setError('');try{await mutate('entity.restore',{entityType:version.entity_type,entityId:version.entity_id,restoreVersion:version.version,expectedVersion:current.version,operationKey:crypto.randomUUID()});setConfirmVersion(null);setReload(value=>value+1);}catch(error){setError(error instanceof Error?error.message:'Não foi possível restaurar.');}finally{setRestoring(false);}}
 const project=data?.project,canEdit=Boolean(data?.permissions?.canEdit),relationships=data?.relationships??{};
 const [onlyCommunication, setOnlyCommunication] = useState(false);
 const projectLinks = (data?.links ?? []) as Row[];
 const communicationLinks = projectLinks.filter(link => communicationLabel(link.communication_channel));
 const referenceLinks = projectLinks.filter(link => !communicationLabel(link.communication_channel));
 const materialsUrl=sheetOwnerId?safeUrl(data?.spreadsheetLinks?.materialsUrl):'',projectSheetLinks=(data?.links??[]).filter((link:Row)=>{try{return new URL(String(link.url)).hostname==='docs.google.com'&&new URL(String(link.url)).pathname.startsWith('/spreadsheets/');}catch{return false;}});
 const shortcuts = projects.some(candidate => candidate.id === projectId) ? shortcutModules : [];
 const rel=(key:string)=>relationships[key] as Row[]|null|undefined;
 const items=rel('items'),campaigns=rel('campaigns'),loans=rel('loans'),records=rel('records'),now=result?.receivedAt??0;
 const recordsUrl=`/?module=records&view=documents&project=${encodeURIComponent(projectId)}`;
 const activeCampaigns=campaigns?.filter(campaign=>campaign.status==='active').length??0;
 const activeLoans=loans?.filter(loan=>loan.status==='out'||loan.status==='reserved').length??0,lateLoans=loans?.filter(loan=>loanIsLate(loan,now)).length??0;
 const lowStock=items?.filter(item=>{const available=availableOf(item);return available!==null&&available<=Number(item.low_stock||0);}).length??0;
 const kpis=[items&&{label:'Materiais',value:items.length,detail:lowStock?`${lowStock} com estoque baixo`:items.length?'No cadastro do projeto':'Nenhum item cadastrado',tone:lowStock?'warn':'',icon:Package},campaigns&&{label:'Dinâmicas',value:campaigns.length,detail:`${activeCampaigns} ${activeCampaigns===1?'ativa':'ativas'}`,icon:CalendarDays},loans&&{label:'Empréstimos recentes',value:loans.length,detail:lateLoans?`${lateLoans} em atraso`:`${activeLoans} em andamento`,tone:lateLoans?'warn':'',icon:Clock3},records&&{label:'Registros',value:records.length,detail:records[0]?`último em ${pretty(records[0].occurred_at)}`:'nenhum ainda',icon:FileText}].filter(Boolean) as {label:string;value:number;detail:string;tone?:string;icon:typeof Package}[];
 const empty=(text:string)=><p className={styles.relationEmpty}>{text}</p>;
 const linkRow = (link: Row) => {
  const channel = communicationLabel(link.communication_channel);
  return <div key={link.id} className={styles.linkRow}>
   <div className={styles.linkContent}>
    {channel && <small>{channel}</small>}
    <a href={safeUrl(link.url) || undefined} className="p-text-link" target="_blank" rel="noopener noreferrer"><Link2 size={15}/>{link.label}<ExternalLink size={13}/></a>
    {link.communication_channel === 'canva' && link.communication_note && <p>{link.communication_note}</p>}
   </div>
   {canEdit && <button type="button" className="p-icon-button" aria-label={`Editar link ${link.label}`} onClick={() => setEditor({kind:'link',row:link})}><Pencil size={14}/></button>}
  </div>;
 };
 const linkVersions = ((data?.versions ?? []) as Row[]).map(version => ({version, snapshot: projectLinkSnapshot(version)}));
 const communicationIds = new Set([...communicationLinks.map(link => link.id),
  ...linkVersions.filter(entry => communicationLabel(entry.snapshot?.communication_channel)).map(entry => entry.version.entity_id)]);
 const visibleVersions = (onlyCommunication
  ? linkVersions.filter(entry => entry.snapshot && communicationIds.has(entry.version.entity_id))
  : linkVersions).slice(0,30);
 return <section className="p-section"><div className={styles.detailToolbar}><button type="button" className="p-button p-button-subtle" onClick={onBack}><ArrowLeft size={16}/>Todos os projetos</button><div className="p-inline" style={{flexWrap:'wrap'}}>{data?.permissions?.reports&&<a className="p-button p-button-subtle" href={`/?module=reports&project=${encodeURIComponent(projectId)}`}><BarChart3 size={16}/>Relatórios do projeto</a>}<button type="button" className="p-button p-button-subtle" disabled={loading} onClick={()=>{setError('');setEditor(null);setReload(value=>value+1);}}><RefreshCw size={16}/>Atualizar</button></div></div>
 {displayError&&<p className="p-inline-error" role="alert">{displayError}</p>}{loading?<div className="p-card"><LoaderCircle size={22} className="p-spin"/> Carregando o projeto…</div>:project&&<div className={styles.detailStack}>
 <header className={`p-card ${styles.detailHero}`} style={{['--project-color' as string]:project.color||'#54216C'}}><div className={styles.heroTop}><div className={styles.heroIdentity}><span className="p-kicker">{project.type_label||'Projeto / área de trabalho'}</span><h2>{project.name}{project.short_name&&!String(project.name).toLocaleLowerCase('pt-BR').startsWith(String(project.short_name).toLocaleLowerCase('pt-BR'))&&<small>{project.short_name}</small>}</h2><div className={styles.chips}><span className={`${styles.chip} ${project.status==='archived'?styles.chipMuted:styles.chipGood}`}>{label(project.status)}</span><span className={styles.chip}>{lifecycle[project.lifecycle as keyof typeof lifecycle]||project.lifecycle}</span><span className={styles.chip}>{project.scope==='external'?'Externo à PROEX':'Interno PROEX'}</span>{areaLabel(project.thematic_area)&&<span className={`${styles.chip} ${styles.chipArea}`}>{areaLabel(project.thematic_area)}</span>}{lineLabel(project.extension_line)&&<span className={styles.chip} title="Linha de extensão (FORPROEX)">Linha {lineLabel(project.extension_line)}</span>}</div></div>{canEdit&&<button type="button" className="p-button p-button-subtle" onClick={()=>onEdit(project)}><Pencil size={15}/>Editar projeto</button>}</div>
 <div className={styles.heroBody}><div><div className={styles.unitLabel}><FolderKanban size={15}/><span>{project.unit_name?`${project.unit_acronym?`${project.unit_acronym} · `:''}${project.unit_name}`:'Unidade responsável ainda não definida'}</span></div><p className={styles.heroDescription}>{project.description||'Finalidade ainda não informada.'}</p></div>
 <dl className={styles.facts}><div><dt>Período</dt><dd>{project.starts_at?`${pretty(project.starts_at)}${project.ends_at?` até ${pretty(project.ends_at)}`:''}`:'Não informado'}</dd></div><div><dt>Local</dt><dd>{project.location||'Não informado'}</dd></div><div><dt>Dinâmicas e brindes</dt><dd>{project.prizes_enabled?'Habilitados':'Não habilitados'}</dd></div>{safeUrl(project.official_url)&&<div><dt>Fonte oficial</dt><dd><a className="p-text-link" href={safeUrl(project.official_url)} target="_blank" rel="noopener noreferrer">Abrir página <ExternalLink size={13}/></a></dd></div>}</dl></div>
 {kpis.length>0&&<div className={styles.heroKpis}>{kpis.map(({label:title,value,detail,tone,icon:Icon})=><div key={title} className={tone?styles.kpiWarn:''}><span><Icon size={15}/>{title}</span><strong>{value}</strong><small>{detail}</small></div>)}</div>}
 <p className="p-form-help" style={{marginTop:14}}><ShieldCheck size={14}/> A relação entre programa e projeto organiza o catálogo; os acessos continuam sendo concedidos por projeto.</p></header>
 <nav className={styles.projectQuickActions} aria-label="Atalhos do projeto">
  {shortcuts.includes('demands') && <a className="p-button p-button-subtle" href={`/?module=demands&project=${encodeURIComponent(project.id)}`}><ClipboardList size={16} aria-hidden="true"/>Demandas</a>}
  {data.permissions?.accessManage && <a className="p-button p-button-subtle" href={`/?module=team&project=${encodeURIComponent(project.id)}`}><ShieldCheck size={16} aria-hidden="true"/>Equipe e convites</a>}
  {shortcuts.includes('calendar') && (data.permissions?.inventory || data.permissions?.loans || data.permissions?.reports || canEdit) && <a className="p-button p-button-subtle" href={`/?module=calendar&project=${encodeURIComponent(project.id)}`}><CalendarDays size={16} aria-hidden="true"/>Agenda</a>}
  {records && <a className="p-button p-button-subtle" href={recordsUrl}><FileText size={16} aria-hidden="true"/>Registros e fotos</a>}
  <a className="p-button p-button-subtle" href="#project-sheets-live"><FileText size={16} aria-hidden="true"/>Planilhas</a>
 </nav>
 {(items||campaigns||loans||records)&&<section className="p-card" id="project-operations"><div className={styles.cardHead}><div><h3>Materiais e atividades</h3><p>Abra uma ficha ou registre uma operação neste projeto.</p></div>{canEdit&&<button type="button" className="p-button p-button-subtle" onClick={()=>onEdit(project)}><Pencil size={16}/>Editar projeto</button>}</div><div className={styles.relationGrid} data-has-materials={Boolean(items)}>
 {items&&<section className={styles.relation} aria-label="Materiais do projeto"><div className={styles.relationHead}><h4><Package size={17}/>Materiais <span>{items.length}</span></h4>{data.permissions.inventoryManage&&<button className="p-button p-button-subtle" type="button" onClick={()=>setQuickEntry({kind:'material',project,items:[]})}><Plus size={16}/>Adicionar material</button>}</div>
 {!items.length?empty('Nenhum material cadastrado.'):<ul className={styles.materialRelations}>{items.slice(0,expandedMaterials?24:4).map(item=>{const available=availableOf(item),low=available!==null&&available<=Number(item.low_stock||0);return <li key={item.id}>
 <div className={styles.materialTitle}>{onMaterialOpen?<button className={styles.relationOpen} type="button" onClick={()=>onMaterialOpen(item.id)}>{item.name}<ArrowRight size={16}/></button>:<strong>{item.name}</strong>}<small>{categories[item.category as keyof typeof categories]||item.category}{item.condition&&item.condition!=='active'?` · ${item.condition==='maintenance'?'Em manutenção':'Inativo'}`:''}</small></div>
 <dl className={styles.materialNumbers}><div><dt>Físico</dt><dd>{item.stock} <small>{item.unit}</small></dd></div><div><dt>Disponível</dt><dd className={low?styles.stockLow:styles.stockOk}>{available===null?'Não informado':<>{available} <small>{item.unit}</small></>}</dd></div></dl>
 {data.permissions.inventoryManage&&onMaterialOpen&&<div className={styles.materialActions}><button type="button" className="p-button p-button-subtle" aria-label={`Movimentar ${item.name}`} onClick={()=>onMaterialOpen(item.id,'move')}><Package size={15}/>Movimentar</button><button type="button" className="p-button p-button-subtle" aria-label={`Editar ${item.name}`} onClick={()=>onMaterialOpen(item.id,'edit')}><Pencil size={15}/>Editar</button></div>}
 </li>;})}</ul>}
 {items.length>4&&<button className={styles.relationAll} type="button" onClick={()=>setExpandedMaterials(value=>!value)}>{expandedMaterials?'Mostrar menos':items.length>24?'Ver os primeiros 24 materiais':`Ver os ${items.length} materiais`}<Package size={16}/></button>}
 <a className={styles.relationAll} href={`/?module=materials&project=${encodeURIComponent(project.id)}`}>Ver catálogo e consumo<ArrowRight size={16}/></a></section>}
 <div className={styles.otherOperations}>
 {campaigns&&<section className={styles.relation}><h4><CalendarDays size={16}/>Dinâmicas <span>{campaigns.length}</span></h4>{!campaigns.length?empty('Nenhuma dinâmica cadastrada.'):<ul className={styles.relationList}>{campaigns.slice(0,8).map(campaign=><li key={campaign.id}><span><a className={styles.relationOpen} href={`/?module=events&project=${encodeURIComponent(project.id)}&campaignId=${encodeURIComponent(campaign.id)}`}>{campaign.name}<ArrowRight size={15}/></a><small>{pretty(campaign.starts_at)}{campaign.location?` · ${campaign.location}`:''}</small></span><span className="p-badge">{label(campaign.status)}</span></li>)}</ul>}<a className={styles.relationAll} href={`/?module=events&project=${encodeURIComponent(project.id)}`}>Ver dinâmicas<ArrowRight size={16}/></a></section>}
 {loans&&<section className={styles.relation}><div className={styles.relationHead}><h4><Clock3 size={16}/>Empréstimos recentes <span>{loans.length}</span></h4>{data.permissions.loansManage&&<button type="button" className="p-button p-button-subtle" onClick={()=>setQuickEntry({kind:'loan',project,items:rel('loanEquipment')??items??[]})}><Plus size={16}/>Reservar</button>}</div>{!loans.length?empty('Nenhum empréstimo registrado.'):<ul className={styles.relationList}>{loans.slice(0,8).map(loan=>{const late=loanIsLate(loan,now);return <li key={loan.id}><span><a className={styles.relationOpen} href={`/?module=loans&project=${encodeURIComponent(project.id)}&loanId=${encodeURIComponent(loan.id)}`}>{loan.item_name}<ArrowRight size={15}/></a><small>{loan.action_name} · {pretty(loan.starts_at)} → {pretty(loan.ends_at)}</small></span><span className={`p-badge ${late?'p-status-late':''}`}>{late?'Em atraso':loanLabels[loan.status as keyof typeof loanLabels]||loan.status}</span></li>;})}</ul>}<a className={styles.relationAll} href={`/?module=loans&project=${encodeURIComponent(project.id)}`}>Ver empréstimos<ArrowRight size={16}/></a></section>}
 {records&&<section className={styles.relation}><h4><FileText size={16}/>Registros <span>{records.length}</span></h4>{!records.length?empty('Nenhum registro ainda.'):<ul className={styles.relationList}>{records.slice(0,8).map(record=><li key={record.id}><span><strong>{record.title}</strong><small>{pretty(record.occurred_at)}</small></span><span className="p-badge">{recordKinds[record.kind as keyof typeof recordKinds]||record.kind}</span></li>)}</ul>}<a className={styles.relationAll} href={recordsUrl}>Abrir registros e fotos<ArrowRight size={16}/></a></section>}
 </div></div></section>}

 {items&&<section className="p-card"><button type="button" className="p-button p-button-subtle" aria-expanded={consumptionOpen} onClick={()=>setConsumptionOpen(value=>!value)}><BarChart3 size={18}/>Consumo e unidades</button>{consumptionOpen&&<StockConsumptionPanel projectId={project.id} onOpenMaterial={onMaterialOpen}/>}</section>}
 <ProjectOperationalChart key={project.id} projectId={project.id} schedule={data.schedule} items={items} loans={loans} now={now}/>
 {renderWorkContext?.(project.id)}
 {renderAreaOwners?.(project.id)}
 <ProjectReportBuilder key={project.id} projectId={project.id} projectName={project.name} officialUrl={project.official_url} refreshKey={`${refreshKey}|${reload}|${(data.links as Row[]).map(link=>`${link.id}:${link.version}`).join(',')}`} onAddReference={canEdit?()=>setEditor({kind:'link',row:null}):undefined}/>
 {data.relatedProjects.length>0&&<div className="p-card"><h3>Programas e projetos relacionados</h3><div className="p-inline" style={{flexWrap:'wrap',marginTop:12}}>{data.relatedProjects.map((related:Row)=><button key={related.id} type="button" className="p-button p-button-subtle" onClick={()=>onSelect?.(related.id)}><FolderKanban size={15}/>{related.name}</button>)}</div></div>}
 <ProjectSheetsPanel key={project.id} projectId={project.id} projectName={project.name}/>
 {(materialsUrl||projectSheetLinks.length>0)&&<section className="p-card" id="project-spreadsheets"><h3>Outras planilhas e referências</h3><p className="p-form-help">Links já cadastrados pela equipe. A conexão de sincronização fica na seção acima.</p><div className={styles.detailLinks}>{materialsUrl&&<a className={styles.quickLink} href={materialsUrl} target="_blank" rel="noopener noreferrer"><Package size={20}/><span><strong>Materiais deste projeto na planilha mestre</strong><small>Visualização filtrada · acesso do responsável global</small></span><ExternalLink size={15}/></a>}{projectSheetLinks.map((link:Row)=><a key={link.id} className={styles.quickLink} href={safeUrl(link.url)} target="_blank" rel="noopener noreferrer"><FileText size={20}/><span><strong>{link.label}</strong><small>Planilha específica vinculada ao projeto</small></span><ExternalLink size={15}/></a>)}</div><p className={styles.externalNote}>O acesso no Google depende do compartilhamento feito no Drive. Filtros e links não substituem as permissões da planilha.</p></section>}
 {sheetOwnerId && <SheetShortcuts canSync={true} userId={sheetOwnerId} context="project" projectScoped/>}
 <div className={styles.detailGrid}>
 <div className={styles.detailColumn}>
 <section className={`p-card ${styles.detailCard}`}>
  <div className={styles.cardHead}><div><h3><Link2 size={17}/>Links e documentos</h3><p>Páginas, relatórios, editais e arquivos de referência.</p></div>
   {canEdit && <button type="button" className="p-button p-button-subtle" onClick={() => setEditor({kind:'link',row:null})}><Plus size={15}/>Link</button>}
  </div>
  {referenceLinks.length ? referenceLinks.map(linkRow) : !communicationLinks.length && empty('Nenhum link cadastrado.')}
  {(canEdit || communicationLinks.length > 0) && <div className={styles.communication}>
   <h4>Comunicação</h4>
   <p className="p-form-help">Referências cadastradas pela equipe para arte, site e Instagram.</p>
   {communicationLinks.length ? communicationLinks.map(linkRow) : empty('No cadastro de link, selecione um canal de comunicação.')}
  </div>}
 </section>
 <section id="project-timeline" className={`p-card ${styles.detailCard}`}><div className={styles.cardHead}><div><h3><CalendarDays size={17}/>Cronograma</h3><p>Datas importantes e próximas atividades do projeto.</p></div>{canEdit&&<button type="button" className="p-button p-button-subtle" onClick={()=>setEditor({kind:'schedule',row:null})}><Plus size={15}/>Atividade</button>}</div>{!data.schedule.length?empty('Nenhuma data cadastrada ainda. O cronograma mostra só as datas que a equipe registrar.'):<ol className={styles.timeline}>{data.schedule.map((item:Row)=><li key={item.id} data-status={item.status}><small>{scheduleWhen(item.starts_at,item.ends_at)} · {label(item.status)}</small><h4>{item.title}</h4>{item.note&&<p>{item.note}</p>}<div className="p-inline" style={{marginTop:6,flexWrap:'wrap'}}>{safeUrl(item.url)&&<a className="p-text-link" href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer">Ver fonte <ExternalLink size={14}/></a>}{canEdit&&<button type="button" className="p-button p-button-subtle" onClick={()=>setEditor({kind:'schedule',row:item})}><Pencil size={14}/>Editar</button>}</div></li>)}</ol>}</section>
 </div>
 <div className={styles.detailColumn}>
 <section className={`p-card ${styles.detailCard}`}><div className={styles.cardHead}><div><h3><FileText size={17}/>Editais e chamadas</h3><p>Referências e prazos, separados dos eventos.</p></div>{canEdit&&<button type="button" className="p-button p-button-subtle" onClick={()=>setEditor({kind:'call',row:null})}><Plus size={15}/>Edital</button>}</div>{!data.calls.length?empty('Nenhum edital vinculado.'):(allCalls?data.calls:data.calls.slice(0,3)).map((call:Row)=><article key={call.id} className={styles.callRow}><div className={styles.rowTitle}><h4>{call.title}</h4><span className="p-badge">{label(call.status)}</span></div>{call.reference_code&&<small>{call.reference_code}</small>}{call.description&&<p>{call.description}</p>}{(call.opens_at||call.closes_at)&&<small>{call.opens_at?`Abertura: ${pretty(call.opens_at)}`:''}{call.closes_at?` · Encerramento: ${pretty(call.closes_at)}`:''}</small>}<div className="p-inline" style={{flexWrap:'wrap',marginTop:8}}>{safeUrl(call.official_url)&&<a className="p-text-link" href={safeUrl(call.official_url)} target="_blank" rel="noopener noreferrer">Consultar edital <ExternalLink size={14}/></a>}{call.canEdit&&<button className="p-button p-button-subtle" type="button" onClick={()=>setEditor({kind:'call',row:call})}><Pencil size={14}/>Editar</button>}</div></article>)}{data.calls.length>3&&<button type="button" className={styles.showMore} onClick={()=>setAllCalls(value=>!value)}>{allCalls?'Mostrar menos':`Ver todos os ${data.calls.length} editais`}</button>}</section>
 </div>
 </div>
 {editor&&<section ref={editorRef} className={`p-editor-panel ${styles.editor}`} tabIndex={-1} aria-labelledby="project-detail-editor-title"><div className="p-row-between"><h3 id="project-detail-editor-title">{editor.row?'Editar':'Adicionar'} {editor.kind==='link'?'link':editor.kind==='call'?'edital':'atividade'}</h3><button type="button" className="p-icon-button" aria-label="Fechar edição" onClick={()=>setEditor(null)}><X size={18}/></button></div><MetadataForm key={`${editor.kind}-${editor.row?.id??'new'}`} editor={editor} projectId={projectId} projects={projects} mutate={mutate} done={saved}/></section>}
 {canEdit&&<section className="p-card"><div className="p-card-title"><History size={20}/><div><h3>Histórico de versões</h3><p>Restaurar cria uma nova revisão; versões anteriores permanecem.</p></div></div>{communicationIds.size > 0 && <label className="p-field"><span>Histórico exibido</span><select value={onlyCommunication ? 'communication' : 'all'} onChange={event => setOnlyCommunication(event.target.value === 'communication')}><option value="all">Todos os metadados</option><option value="communication">Comunicação</option></select></label>}
 {!visibleVersions.length ? <p className="p-form-help">Nenhuma versão registrada neste recorte.</p> : visibleVersions.map(({version, snapshot}) => <div key={version.id} className="p-row-between" style={{padding:'10px 0',gap:12,borderBottom:'1px solid var(--line)'}}>
  <div className={styles.linkContent}>
   <strong>{snapshot?.label ?? version.entity_type} · versão {version.version}</strong>
   <small>{pretty(version.created_at)}</small>
   {snapshot && communicationIds.has(version.entity_id) && <details>
    <summary>Ver detalhes desta versão</summary>
    <p>{communicationLabel(snapshot.communication_channel) ?? 'Sem classificação de comunicação'}</p>
    {snapshot.communication_channel === 'canva' && snapshot.communication_note && <p>{snapshot.communication_note}</p>}
    {safeUrl(snapshot.url) && <a className="p-text-link" href={safeUrl(snapshot.url)} target="_blank" rel="noopener noreferrer">Abrir link desta versão <ExternalLink size={13}/></a>}
   </details>}
  </div>
  <button type="button" className="p-button p-button-subtle" onClick={() => setConfirmVersion(version)}>Restaurar</button>
 </div>)}{confirmVersion&&<div className="p-inline-confirm"><p>Restaurar a versão {confirmVersion.version} dos metadados selecionados? Estoque, participações e anexos não são alterados.</p><div className="p-inline"><button type="button" className="p-button p-button-primary" disabled={restoring} onClick={()=>void restore(confirmVersion)}>{restoring&&<LoaderCircle size={15} className="p-spin"/>}Confirmar restauração</button><button type="button" className="p-button p-button-subtle" disabled={restoring} onClick={()=>setConfirmVersion(null)}>Cancelar</button></div></div>}</section>}
 </div>}
 {quickEntry&&<ProjectQuickEntry key={`${quickEntry.project.id}:${quickEntry.kind}`} kind={quickEntry.kind} project={quickEntry.project} items={quickEntry.items} mutate={mutate} onClose={()=>setQuickEntry(null)} onSaved={itemId=>{setQuickEntry(null);setReload(value=>value+1);if(itemId)onMaterialOpen?.(itemId);}}/>}
 </section>;
}
