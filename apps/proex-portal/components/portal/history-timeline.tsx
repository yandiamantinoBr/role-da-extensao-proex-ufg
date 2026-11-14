'use client';

import { Fragment, useMemo, useState } from 'react';
import { ArrowUpRight, Boxes, CalendarDays, ClipboardCheck, FileText, KeyRound, ListChecks, SlidersHorizontal, Sparkles, Truck, type LucideIcon } from 'lucide-react';
import styles from './activity-panel.module.css';

/**
 * Histórico: a linha do tempo única do portal (R1 da revisão de 09/11). Registros mostra tudo o que a
 * pessoa pode ver; as fichas abrem este mesmo componente já filtrado pelo assunto ("Ver histórico").
 */
export type ActivityType = 'materials' | 'loans' | 'demands' | 'agenda' | 'records' | 'convocations' | 'access' | 'ai';
export type ActivityEvent = { id: string; type: ActivityType; action: string; title: string; detail: string; at: string; day: string; projectId: string | null; projectName: string; actorId: string | null; actorName: string; viaRole: boolean; href: string | null; quantity: number | null ; status?: 'corrected' | 'undone' | 'correction'; statusReason?: string; statusBy?: string };
export type HistorySubjectKind = 'item' | 'loan' | 'task' | 'campaign';
export type HistorySubject = { kind: HistorySubjectKind; id: string };
type Entry = { kind: 'event'; event: ActivityEvent } | { kind: 'group'; key: string; events: ActivityEvent[] };
const STATUS_LABELS = { corrected: 'Corrigida', undone: 'Desfeita', correction: 'Correção' } as const;

export const HISTORY_TYPES: { id: ActivityType; label: string; Icon: LucideIcon }[] = [
  { id: 'materials', label: 'Estoque', Icon: Boxes }, { id: 'loans', label: 'Empréstimos', Icon: Truck },
  { id: 'demands', label: 'Demandas', Icon: ListChecks }, { id: 'agenda', label: 'Agenda', Icon: CalendarDays },
  { id: 'records', label: 'Registros', Icon: FileText }, { id: 'convocations', label: 'Convocações', Icon: ClipboardCheck }, { id: 'access', label: 'Acessos', Icon: KeyRound }, { id: 'ai', label: 'Configuração de IA', Icon: SlidersHorizontal },
];
/** Como cada assunto é chamado na tela e quais tipos de acontecimento ele tem. */
export const HISTORY_SUBJECTS: Record<HistorySubjectKind, { label: string; article: string; types: ActivityType[] }> = {
  item: { label: 'Material', article: 'deste material', types: ['materials', 'loans', 'demands', 'records'] },
  loan: { label: 'Empréstimo', article: 'deste empréstimo', types: ['loans', 'demands', 'records'] },
  task: { label: 'Demanda', article: 'desta demanda', types: ['demands'] },
  campaign: { label: 'Dinâmica', article: 'desta dinâmica', types: ['demands', 'access'] },
};
const SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
/** Endereço: `history=item:<id>`. Só escolhe o filtro; quem decide o que aparece é o servidor. */
export function parseHistorySubject(value: string | null | undefined): HistorySubject | null {
  const [kind, ...rest] = (value ?? '').split(':'), id = rest.join(':');
  return Object.hasOwn(HISTORY_SUBJECTS, kind) && SUBJECT_ID.test(id) ? { kind: kind as HistorySubjectKind, id } : null;
}
export function historySubjectParam(subject: HistorySubject | null | undefined): string { return subject ? `${subject.kind}:${subject.id}` : ''; }
/** Atalho "Ver histórico" das fichas: abre Registros, aba Histórico, já filtrado pelo assunto. */
export function historyHref(subject: HistorySubject, projectId?: string | null): string {
  return `/?module=records${projectId ? `&project=${encodeURIComponent(projectId)}` : ''}&history=${encodeURIComponent(historySubjectParam(subject))}`;
}

const DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' });
const PER_DAY = 8;
const civilDate = (day: string) => new Date(`${day}T12:00:00Z`);
const capital = (text: string) => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);

/** Acontecimentos seguidos do mesmo tipo, no mesmo minuto, viram um grupo que abre. */
export function groupEntries(events: ActivityEvent[]): Entry[] {
  const entries: Entry[] = [];
  for (let index = 0; index < events.length;) {
    const first = events[index], minute = first.at.slice(0, 16);
    let end = index + 1;
    // Configuração de IA nunca agrupa: cada mudança de limite precisa ficar visível no histórico.
    while (first.type !== 'ai' && !first.status && end < events.length && !events[end].status && events[end].type === first.type && events[end].action === first.action && events[end].at.slice(0, 16) === minute) end++;
    if (end - index >= 3) entries.push({ kind: 'group', key: `${first.id}-group`, events: events.slice(index, end) });
    else for (let item = index; item < end; item++) entries.push({ kind: 'event', event: events[item] });
    index = end;
  }
  return entries;
}
const GROUP_LABELS: Record<string, [string, string]> = { 'Demanda criada': ['demanda criada', 'demandas criadas'], 'Demanda concluída': ['demanda concluída', 'demandas concluídas'], Entrada: ['entrada de estoque', 'entradas de estoque'], Distribuição: ['distribuição', 'distribuições'], Consumo: ['consumo', 'consumos'] };
const groupLabel = (action: string, count: number) => { const label = GROUP_LABELS[action]; return label ? `${count} ${count === 1 ? label[0] : label[1]}` : `${count} × ${action.toLocaleLowerCase('pt-BR')}`; };

type TimelineProps = { events: ActivityEvent[]; hideProject?: boolean; hidePerson?: boolean; heading?: string; emptyTitle?: string; emptyText?: string; emptyHint?: string };
/** A linha do tempo por dia, com agrupamento de repetidos e "Ver mais". Não busca dados: recebe os acontecimentos prontos. */
export default function HistoryTimeline({ events, hideProject = false, hidePerson = false, heading = 'Linha do tempo', emptyTitle = 'Nada registrado neste período', emptyText = 'Aqui aparece, por data, o que aconteceu nos seus projetos: demandas, materiais, empréstimos, agenda e registros. Nada foi registrado neste período.', emptyHint = 'Escolha outro período, projeto ou tipo.' }: TimelineProps) {
  const [opened, setOpened] = useState<{ events: ActivityEvent[]; days: string[] }>({ events, days: [] });
  // Lista nova (outro filtro ou período) recolhe os dias abertos.
  const expanded = opened.events === events ? opened.days : [];
  const setExpanded = (update: (list: string[]) => string[]) => setOpened({ events, days: update(expanded) });
  const byDay = useMemo(() => { const map = new Map<string, ActivityEvent[]>(); for (const event of events) map.set(event.day, [...(map.get(event.day) ?? []), event]); return map; }, [events]);
  const months = useMemo(() => { const seen = new Map<string, number>(); for (const event of events) seen.set(event.day.slice(0, 7), (seen.get(event.day.slice(0, 7)) ?? 0) + 1); return [...seen]; }, [events]);
  const lastDayOf = (month: string) => [...byDay.keys()].filter(day => day.startsWith(month)).sort().at(-1);
  const projectId = hideProject, person = hidePerson;
  return <section className={styles.timeline} aria-label={heading}>
      <div className={styles.timelineHeading}><h2>{heading}</h2>{months.length > 1 && <nav className={styles.months} aria-label="Ir para o mês">{months.map(([month, count]) => <a key={month} href={`#activity-day-${lastDayOf(month)}`}>{capital(MONTH.format(civilDate(`${month}-15`)))} <span>{count}</span></a>)}</nav>}</div>
      {events.length === 0 ? <div className="p-empty"><span><FileText size={22} aria-hidden="true"/></span><h3>{emptyTitle}</h3><p>{emptyText}</p>{emptyHint && <p>{emptyHint}</p>}</div>
      : [...byDay.keys()].sort().reverse().map(day => { const entries = groupEntries(byDay.get(day)!), open = expanded.includes(day), visible = open ? entries : entries.slice(0, PER_DAY); return <div key={day} className={styles.day} id={`activity-day-${day}`}>
        <h3 className={styles.dayHeading}>{capital(DAY.format(civilDate(day)))}<span>{byDay.get(day)!.length}</span></h3>
        <ol className={styles.events}>{visible.map(entry => entry.kind === 'event' ? <EventRow key={entry.event.id} event={entry.event} hideProject={projectId} hidePerson={person}/> : <li key={entry.key} className={styles.group}><details><summary><TypeIcon type={entry.events[0].type}/><span><strong>{groupLabel(entry.events[0].action, entry.events.length)}</strong><small>{entry.events.slice(0, 2).map((event, index, shown) => <Fragment key={event.id}>{index > 0 && ' '}<span className={styles.titleUnit}>{event.title}{index < shown.length - 1 ? ',' : ''}</span></Fragment>)}{entry.events.length > 2 && <> <span className={styles.titleUnit}>e mais {entry.events.length - 2}</span></>}</small><small className={styles.groupMeta}><span>{TIME.format(new Date(entry.events[0].at))}</span>{!projectId && entry.events[0].projectName && <span>{entry.events[0].projectName}</span>}</small></span></summary><ol>{entry.events.map(event => <EventRow key={event.id} event={event} hideProject hidePerson={person} compact/>)}</ol></details></li>)}</ol>
        {entries.length > PER_DAY && !open && <button type="button" className={styles.more} onClick={() => setExpanded(list => [...list, day])}>Ver mais {entries.length - PER_DAY} {entries.length - PER_DAY === 1 ? 'item' : 'itens'}</button>}
      </div>; })}
  </section>;
}

function TypeIcon({ type }: { type: ActivityType }) { const meta = HISTORY_TYPES.find(item => item.id === type)!; return <span className={styles.icon} data-type={type} aria-hidden="true"><meta.Icon size={16}/></span>; }
function EventRow({ event, hideProject, hidePerson, compact = false }: { event: ActivityEvent; hideProject: boolean; hidePerson: boolean; compact?: boolean }) {
  const content = <>
    {!compact && <TypeIcon type={event.type}/>}
    <span className={styles.body}>
      <span className={styles.line}><strong className={styles.titleUnit}>{event.action}</strong>{event.title && <> · <span className={styles.titleUnit}>{event.title}</span></>}{event.detail && event.type !== 'ai' && <span className={styles.detail} data-struck={event.status === 'corrected' || event.status === 'undone' ? 'true' : undefined}>{event.detail}</span>}{event.status && <span className={styles.revision} data-status={event.status}>{STATUS_LABELS[event.status]}</span>}</span>
      {event.status && (event.statusReason || event.statusBy) && <span className={styles.revisionNote}>{event.status === 'correction' ? 'Corrige um lançamento anterior' : event.status === 'undone' ? 'Desfeita' : 'Substituída por uma correção'}{event.statusReason ? `: ${event.statusReason}` : ''}{event.statusBy ? ` · por ${event.statusBy}` : ''}</span>}
      {event.type === 'ai' && event.detail && <ul className={styles.changes}>{event.detail.split('\n').map(line => { const [label, values] = line.includes(': ') ? [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2)] : ['', line]; const [before, after] = values.split(' → '); return <li key={line}>{label && <span>{label}: </span>}{after !== undefined ? <><s aria-label={`antes ${before}`}>{before}</s> → <strong>{after}</strong></> : values}</li>; })}</ul>}
      <span className={styles.meta}>{event.type !== 'agenda' && !compact && <time dateTime={event.at}>{TIME.format(new Date(event.at))}</time>}{!hideProject && event.projectName && <span>{event.projectName}</span>}{!hidePerson && event.actorName && <span>{event.actorName}</span>}{event.viaRole && <span className={styles.role}><Sparkles size={13} aria-hidden="true"/>Feito pelo Rolê{event.actorName ? ` a pedido de ${event.actorName}` : ''}</span>}</span>
    </span>
    {event.href && <ArrowUpRight className={styles.go} size={16} aria-hidden="true"/>}
  </>;
  return <li className={compact ? styles.compactRow : undefined}>{event.href ? <a className={styles.row} href={event.href}>{content}</a> : <div className={styles.row}>{content}</div>}</li>;
}
