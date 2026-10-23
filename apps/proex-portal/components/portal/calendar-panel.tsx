'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Link2, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { CalendarCategory, CalendarEntry } from '@/lib/calendar';
import styles from './calendar-panel.module.css';

type Feed = { id: string; category: CalendarCategory; project_id: string | null; project_name: string | null; created_at: string; expires_at: string; revoked_at: string | null };
type CalendarData = { entries: CalendarEntry[]; feeds: Feed[]; availableCategories: CalendarCategory[] };
const labels: Record<CalendarCategory, string> = { loans: 'Empréstimos', materials: 'Materiais', projects: 'Projetos e eventos', consumption: 'Consumo' };
const colors: Record<CalendarCategory, string> = { loans: '#54216C', materials: '#CE5F18', projects: '#19669C', consumption: '#307A55' };
const weekday = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const timeZone = 'America/Sao_Paulo';
function civilDay(value: string | Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
function monthRange(value: string): { from: string; to: string } { const first = `${value.slice(0, 7)}-01`, end = new Date(`${first}T12:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0); return { from: first, to: end.toISOString().slice(0, 10) }; }
function inDay(event: CalendarEntry, day: string): boolean {
  const start = Date.parse(`${day}T00:00:00-03:00`), end = start + 86400000;
  return event.allDay ? event.startsAt <= day && event.endsAt > day : Date.parse(event.startsAt) < end && Date.parse(event.endsAt) > start;
}
function prettyDay(day: string): string { return new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`)); }
function when(event: CalendarEntry): string {
  if (event.allDay) return `${prettyDay(event.startsAt)} · Dia inteiro`;
  const format = new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `${format.format(new Date(event.startsAt))} → ${format.format(new Date(event.endsAt))}`;
}

export default function CalendarPanel({ projects: sourceProjects, organizationalUnits = [] }: { projects: Record<string, unknown>[]; organizationalUnits?: Record<string,unknown>[] }) {
  const projects = useMemo(() => sourceProjects.filter(project => typeof project.id === 'string' && typeof project.name === 'string')
    .map(project => ({ id: project.id as string, name: project.name as string, unitId: typeof project.unit_id==='string'?project.unit_id:'' })), [sourceProjects]);
  const initial = useMemo(() => monthRange(civilDay(new Date())), []);
  const [from, setFrom] = useState(initial.from), [to, setTo] = useState(initial.to);
  const [category, setCategory] = useState('all'), [projectId, setProjectId] = useState(''), [unitId,setUnitId]=useState('');
  const [result,setResult]=useState<{key:string;data:CalendarData|null;error:string;receivedAt:number}|null>(null),[saving,setSaving]=useState(false);
  const [mountedAt]=useState(()=>Date.now());
  const [error, setError] = useState(''), [reload, setReload] = useState(0), [selectedDay, setSelectedDay] = useState('');
  const [feedCategory, setFeedCategory] = useState<CalendarCategory>('projects'), [createdFeed, setCreatedFeed] = useState<{ id: string; feedUrl: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const validRange=/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)&&Number.isFinite(Date.parse(from))&&Number.isFinite(Date.parse(to))&&to>=from&&(Date.parse(to)-Date.parse(from))/86400000<732;
  const query = useMemo(() => new URLSearchParams({ from, to, category, ...(projectId ? { projectId } : {}), ...(unitId?{unitId}:{}) }).toString(), [from, to, category, projectId,unitId]);
  const requestKey=`${query}&refresh=${reload}`,data=validRange&&result?.key===requestKey?result.data:null,loading=validRange&&result?.key!==requestKey,displayError=error||(result?.key===requestKey?result.error:'');
  useEffect(() => {
    if(!validRange)return;
    const controller = new AbortController();
    fetch(`/api/calendar?${query}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json() as CalendarData & { error?: string }; if (!response.ok) throw new Error(body.error || 'Não foi possível consultar a agenda.');
      if(!controller.signal.aborted){setResult({key:requestKey,data:body,error:'',receivedAt:Date.now()});setFeedCategory(current=>body.availableCategories.includes(current)?current:body.availableCategories[0]??'projects');}
    }).catch(error=>{if(error.name!=='AbortError')setResult({key:requestKey,data:null,error:error.message,receivedAt:Date.now()});});
    return () => controller.abort();
  }, [query,requestKey,validRange]);
  async function mutate(action: string, payload: Record<string, unknown>) {
    if (saving) return; setSaving(true); setError('');
    try {
      const response = await fetch('/api/calendar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action, ...payload }) });
      const result = await response.json() as { id: string; feedUrl: string; expiresAt: string; error?: string }; if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
      if (action === 'feed.create') { setCreatedFeed(result); setCopied(false); }
      if (action === 'feed.revoke' && createdFeed?.id === payload.id) setCreatedFeed(null);
      setReload(value => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }
  const displayMonth = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from.slice(0, 7) : initial.from.slice(0, 7);
  function shiftMonth(delta: number) { const date = new Date(`${displayMonth}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); const next = monthRange(date.toISOString().slice(0, 10)); setFrom(next.from); setTo(next.to); setSelectedDay(''); }
  const monthStart = new Date(`${displayMonth}-01T12:00:00Z`), monthEnd = new Date(monthStart); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1); monthEnd.setUTCDate(0);
  const cells = [...Array(monthStart.getUTCDay()).fill(null), ...Array.from({ length: monthEnd.getUTCDate() }, (_, i) => `${displayMonth}-${String(i + 1).padStart(2, '0')}`)];
  const entries = data?.entries ?? [], shown = selectedDay ? entries.filter(event => inDay(event, selectedDay)) : entries;
  const today = civilDay(new Date(mountedAt));
  const activeFeeds = data?.feeds.filter(feed => !feed.revoked_at && Date.parse(feed.expires_at) > (result?.receivedAt??mountedAt)) ?? [];
  const unitProjects=unitId?projects.filter(project=>project.unitId===unitId):projects;
  const unitName=organizationalUnits.find(unit=>unit.id===unitId)?.name;
  const scopeName=projects.find(project=>project.id===projectId)?.name||String(unitName||'Todos os projetos permitidos');
  const downloadLabel=validRange?`Baixar .ics de ${from.split('-').reverse().join('/')} a ${to.split('-').reverse().join('/')}`:'Informe um período válido para baixar';
  const googleUrl = createdFeed ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(createdFeed.feedUrl)}` : '';

  return <div className={styles.panel}>
    <section className="p-card" aria-label="Filtros da agenda">
      <div className="p-card-title"><span className="p-icon-tile"><CalendarDays size={21}/></span><div><h3>Agenda integrada</h3><p>Reservas, atividades e movimentações reais, no horário de Brasília.</p></div></div>
      <div className={styles.filters}>
        <label className="p-field"><span>Categoria</span><select value={category} onChange={event=>{setCategory(event.target.value);setSelectedDay('');}}><option value="all">Todas as categorias permitidas</option>{(data?.availableCategories??Object.keys(labels)).map(value=><option key={value} value={value}>{labels[value as CalendarCategory]}</option>)}</select></label>
        <label className="p-field"><span>Unidade responsável</span><select value={unitId} onChange={event=>{const next=event.target.value;setUnitId(next);if(next&&projects.find(project=>project.id===projectId)?.unitId!==next)setProjectId('');setSelectedDay('');}}><option value="">Todas as unidades</option>{organizationalUnits.map(unit=><option key={String(unit.id)} value={String(unit.id)}>{unit.acronym?`${unit.acronym} · `:''}{String(unit.name)}</option>)}</select></label>
        <label className="p-field"><span>Projeto</span><select value={projectId} onChange={event=>{setProjectId(event.target.value);setSelectedDay('');}}><option value="">{unitId?'Todos os projetos desta unidade':'Todos os projetos permitidos'}</option>{unitProjects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="p-field"><span>Data inicial</span><input type="date" value={from} onChange={event=>{setFrom(event.target.value);setSelectedDay('');}}/></label>
        <label className="p-field"><span>Data final (incluída)</span><input type="date" value={to} min={from} onChange={event=>{setTo(event.target.value);setSelectedDay('');}}/></label>
      </div>
      <div className={styles.rangeSummary}><strong>{validRange?`${prettyDay(from)} a ${prettyDay(to)}`:'Escolha as datas inicial e final'}</strong><span>{scopeName} · {category==='all'?'Todas as categorias permitidas':labels[category as CalendarCategory]}</span></div>
      <div className={styles.actions}><button type="button" className="p-button p-button-subtle" onClick={()=>setReload(value=>value+1)} disabled={loading||!validRange}><RefreshCw size={16}/>Atualizar consulta</button>{validRange?<a className="p-button p-button-subtle" href={`/api/calendar?${query}&format=ics`}><Download size={16}/>{downloadLabel}</a>:<button type="button" className="p-button p-button-subtle" disabled><Download size={16}/>{downloadLabel}</button>}</div>
      {!validRange&&<p className="p-inline-error" role="alert">Escolha um período válido de até dois anos, com a data final igual ou posterior à inicial.</p>}{displayError&&<p className="p-inline-error" role="alert">{displayError}</p>}
      <p className="p-form-help">O arquivo inclui as datas e os filtros acima. Materiais e consumo mostram movimentações registradas; saldo não cria compromisso futuro. Contatos, documentos e observações internas ficam no portal.</p>
    </section>
    <section className="p-card" aria-label="Visão mensal da agenda" aria-busy={loading}>
      <div className={styles.monthHeading}><button type="button" className="p-button p-button-subtle" aria-label="Consultar mês anterior" onClick={()=>shiftMonth(-1)}><ChevronLeft size={18}/></button><div><h3>{new Intl.DateTimeFormat('pt-BR',{timeZone,month:'long',year:'numeric'}).format(monthStart)}</h3><small>Mês inicial do período consultado</small></div><button type="button" className="p-button p-button-subtle" aria-label="Consultar próximo mês" onClick={()=>shiftMonth(1)}><ChevronRight size={18}/></button></div>
      <div className={styles.monthGrid}>{weekday.map(day=><span key={day} className={styles.weekday}>{day}</span>)}{cells.map((day,index)=>{if(!day)return <span key={`empty-${index}`}/>;const dayEntries=entries.filter(event=>inDay(event,day));return <button type="button" key={day} className={`${styles.day} ${selectedDay===day?styles.selected:''}`} onClick={()=>setSelectedDay(current=>current===day?'':day)} aria-pressed={selectedDay===day} aria-label={`${prettyDay(day)}, ${dayEntries.length} registros`}><strong className={day===today?styles.today:undefined}>{Number(day.slice(-2))}</strong><span className={styles.dots}>{[...new Set(dayEntries.map(event=>event.category))].map(kind=><span key={kind} style={{background:colors[kind]}}/>)}</span>{dayEntries.length>0&&<small>{dayEntries.length}</small>}</button>;})}</div>
      <div className={styles.legend}>{Object.entries(labels).map(([key,label])=><small key={key}><span style={{background:colors[key as CalendarCategory]}}/>{label}</small>)}</div>
    </section>
    <section className="p-card" aria-label="Lista de compromissos">
      <div className="p-card-title"><div><h3>{selectedDay?prettyDay(selectedDay):'Registros do período'}</h3><p>{loading?'Consultando registros…':`${shown.length} registro(s)`}</p></div>{selectedDay&&<button type="button" className="p-button p-button-subtle" onClick={()=>setSelectedDay('')}><X size={15}/>Ver todo o período</button>}</div>
      {loading?<p className="p-form-help"><LoaderCircle size={17} className="p-spin"/> Carregando agenda…</p>:!shown.length?<p className="p-form-help">{validRange?'Nenhum registro corresponde às datas e aos filtros escolhidos.':'Informe um período válido para consultar a agenda.'}</p>:<div className={styles.entries}>{shown.map(event=><article key={event.uid} className={styles.entry} style={{borderLeftColor:colors[event.category]}}><small>{labels[event.category]}</small><h4 className={event.status==='CANCELLED'?styles.cancelled:undefined}>{event.title}</h4><p>{when(event)}</p><p className={styles.entryContext}>{event.projectName}{event.location?` · ${event.location}`:''}{event.status==='CANCELLED'?' · Cancelado / arquivado':''}</p></article>)}</div>}
    </section>
    <section className="p-card">
      <div className="p-card-title"><span className="p-icon-tile"><Link2 size={20}/></span><div><h3>Acompanhar no Google Calendar</h3><p>Assine uma categoria e um projeto para consultar atualizações.</p></div></div>
      <p className="p-form-help">A assinatura é diferente do download do período. Ela mostra um ano passado e um ano futuro. O Google decide quando atualizar; editar no Google não muda o portal. Importar um arquivo .ics cria uma cópia.</p>
      <div className={styles.subscriptionFilters}><label className="p-field"><span>Categoria da assinatura</span><select value={feedCategory} onChange={event=>setFeedCategory(event.target.value as CalendarCategory)}>{(data?.availableCategories??[]).map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label><div className={styles.feedScope}><span>Projeto da assinatura</span><strong>{projectId?projects.find(project=>project.id===projectId)?.name:unitId?'Selecione um projeto no filtro acima':'Todos os projetos — exige permissão geral'}</strong></div></div>
      {unitId&&!projectId&&<p className="p-form-help">Para assinar uma agenda desta unidade, escolha um projeto. A assinatura não é criada por unidade.</p>}
      <button type="button" className="p-button p-button-primary" disabled={saving||!data?.availableCategories.length||Boolean(unitId&&!projectId)} onClick={()=>void mutate('feed.create',{category:feedCategory,projectId:projectId||null})}>{saving?<LoaderCircle size={16} className="p-spin"/>:<Link2 size={16}/>}Gerar link privado de assinatura</button>
      {createdFeed&&<div className={styles.createdFeed}><p><ShieldCheck size={17}/> Este link permite consultar a categoria escolhida. Guarde-o com cuidado; aparece somente agora e pode ser revogado.</p><label className="p-field"><span>URL privada de assinatura</span><input readOnly value={createdFeed.feedUrl} onFocus={event=>event.target.select()}/></label><div className={styles.actions}><button type="button" className="p-button p-button-subtle" onClick={()=>void navigator.clipboard.writeText(createdFeed.feedUrl).then(()=>setCopied(true)).catch(()=>setError('Selecione o link e copie pelo menu do aparelho.'))}><Copy size={15}/>{copied?'Copiado':'Copiar link'}</button><a className="p-button p-button-primary" href={googleUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>Assinar no Google Calendar</a></div><p className="p-form-help">No computador, use a conta Google do responsável e confirme. Se necessário: Outras agendas → + → Do URL. Cole o link acima. Depois, ative a agenda no aplicativo do celular. Validade até {prettyDay(createdFeed.expiresAt.slice(0,10))}.</p></div>}
      <div className={styles.activeFeeds}><h4>Minhas assinaturas ativas ({activeFeeds.length})</h4>{!activeFeeds.length?<p className="p-form-help">Nenhuma assinatura ativa. Crie uma por categoria e projeto que deseja acompanhar.</p>:activeFeeds.map(feed=><div key={feed.id} className={styles.feedRow}><span><strong>{labels[feed.category]}</strong><small>{feed.project_name||'Todos os projetos'} · Expira em {prettyDay(feed.expires_at.slice(0,10))}</small></span><button type="button" className="p-button p-button-subtle" disabled={saving} onClick={()=>void mutate('feed.revoke',{id:feed.id})}>Revogar link</button></div>)}</div>
      <p className="p-form-help">Revogar impede novas consultas. O Google pode manter cópias já recebidas; remova a assinatura também no Calendar. Se perder o link, revogue o antigo e gere outro.</p>
    </section>
  </div>;
}
