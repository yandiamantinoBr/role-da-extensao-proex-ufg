'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- These document links avoid a verified Vinext client-router exception. The browser QA checks navigation and page errors. */

import {useMemo,useState} from 'react';
import {ArrowRight,CalendarDays,Clock3,MapPin,RefreshCw,Search,SlidersHorizontal} from 'lucide-react';
import {BrandMark} from '../theme/brand-mark';
import {ThemeSwitch} from '../theme/theme-switch';
import DateField from '../portal/date-field';
import type {PublicEvent} from '../../lib/public-events';
import styles from './events-index.module.css';
const stateLabels={active:'Publicado',paused:'Pausado',closed:'Encerrado'};
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const day=(s:string)=>{const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(s)),part=(type:string)=>parts.find(p=>p.type===type)?.value;return `${part('year')}-${part('month')}-${part('day')}`;};
const date=(s:string)=>new Date(s).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'short',year:'numeric'});
const time=(s:string)=>new Date(s).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export default function EventsIndex({initialEvents,initialTruncated=false}:{initialEvents:PublicEvent[];initialTruncated?:boolean}){
 const [events,setEvents]=useState(initialEvents),[truncated,setTruncated]=useState(initialTruncated),[query,setQuery]=useState(''),[status,setStatus]=useState('all'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const matches=useMemo(()=>events.filter(e=>(status==='all'||e.status===status)&&normalize(`${e.name} ${e.location}`).includes(normalize(query.trim()))&&(!from||day(e.endsAt)>=from)&&(!to||day(e.startsAt)<=to)),[events,query,status,from,to]);
 async function refresh(){if(busy)return;setBusy(true);setError('');try{const r=await fetch('/api/events',{cache:'no-store'});if(!r.ok)throw Error('Não foi possível atualizar. Tente novamente.');const body=await r.json() as {events:PublicEvent[];truncated:boolean};setEvents(body.events);setTruncated(body.truncated);}catch(e){setError(e instanceof Error?e.message:'Não foi possível atualizar.');}finally{setBusy(false);}}
 function clear(){setQuery('');setStatus('all');setFrom('');setTo('');}
 return <main className={styles.page}>
  <header className={styles.header}><a href="/events" className={styles.brand} aria-label="PROEX UFG · Eventos"><BrandMark/></a><div className={styles.headerActions}><ThemeSwitch/><a className={styles.team} href="/">Área da equipe <ArrowRight size={17}/></a></div></header>
  <section className={styles.intro}><span className={styles.eyebrow}><CalendarDays size={17}/>Extensão em movimento</span><h1>Eventos e dinâmicas</h1><p>Encontre as ações publicadas pela PROEX e acompanhe as orientações para participar.</p></section>
  <section className={styles.content} aria-label="Consultar eventos">
   <div className={styles.filters}><label className={styles.search}><span>Buscar evento</span><div><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nome ou local" maxLength={160}/></div></label><label><span>Situação</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Todos os publicados</option><option value="active">Publicados</option><option value="paused">Pausados</option><option value="closed">Encerrados</option></select></label><label><span>A partir de</span><DateField value={from} onValueChange={setFrom} aria-label="Data inicial"/></label><label><span>Até</span><DateField value={to} onValueChange={setTo} aria-label="Data final"/></label></div>
   <div className={styles.results}><p role="status">{matches.length} {matches.length===1?'evento encontrado':'eventos encontrados'}{truncated?' · mostrando os 500 publicados mais recentes':''}</p><div><button type="button" onClick={clear}><SlidersHorizontal size={16}/>Limpar filtros</button><button type="button" onClick={()=>void refresh()} disabled={busy}><RefreshCw size={16} className={busy?'p-spin':''}/>{busy?'Atualizando…':'Atualizar'}</button></div></div>
   {from&&to&&from>to&&<p className={styles.error} role="alert">A data inicial deve vir antes da data final.</p>}{error&&<p className={styles.error} role="alert">{error}</p>}
   {matches.length?<ul className={styles.grid}>{matches.map(e=><li key={e.id}><article className={styles.card}><div className={styles.cardTop}><span className={styles.project}>PROEX UFG</span><span className={styles.status} data-status={e.status}>{stateLabels[e.status]}</span></div><h2>{e.name}</h2><p className={styles.when}><CalendarDays size={18}/><span>{date(e.startsAt)}{day(e.startsAt)!==day(e.endsAt)?` a ${date(e.endsAt)}`:''}</span></p><p className={styles.when}><Clock3 size={18}/><span>{time(e.startsAt)} a {time(e.endsAt)} · Brasília</span></p>{e.location&&<p className={styles.location}><MapPin size={18}/><span>{e.location}</span></p>}<a href={`/events/${encodeURIComponent(e.id)}`} className={styles.open}>Ver evento <ArrowRight size={18}/></a></article></li>)}</ul>:<div className={styles.empty}><CalendarDays size={36}/><h2>{events.length?'Nenhum evento neste recorte':'Nenhum evento publicado por enquanto'}</h2><p>{events.length?'Tente outro nome, local ou período.':'Novas ações aparecerão aqui depois de serem publicadas pela equipe.'}</p>{events.length>0&&<button type="button" onClick={clear}>Limpar filtros</button>}<a href="/">Acessar a área da equipe <ArrowRight size={16}/></a></div>}
  </section><footer className={styles.footer}>PROEX · Universidade Federal de Goiás · Horários de Brasília</footer>
 </main>;
}
