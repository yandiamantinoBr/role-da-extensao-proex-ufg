'use client';

import {useEffect, useRef, useState} from 'react';
import {AlertTriangle, Building2, CalendarClock, CircleCheck, CircleDot, ClipboardList, Gift, Handshake, Layers, RefreshCw, Users, UserRound} from 'lucide-react';
import {isMyWorkResponse, MY_WORK_STATUSES, type AssignmentFilter, type AssignmentVia, type MyWorkResponse, type MyWorkStatus, type OperationalArea, type WorkTarget} from '@/lib/my-work/contracts';
import {FOLLOWUP_CHANGED} from './follow-up-api';
import {workApi} from './my-work-api';
import {TaskSignals} from './work-signals';
import styles from './meu-trabalho-panel.module.css';

export type MyWorkContext = {organizationId: string; projectId: string | null};
export type MeuTrabalhoPanelProps = {
  userId: string;
  organizationId?: string | null;
  projectId?: string | null;
  serverDay?: string;
  onOpenTask?: (id: string, context: MyWorkContext) => void;
  onOpenTarget?: (target: WorkTarget, context: MyWorkContext) => void;
};
const PAGE_SIZE = 6;
const areaLabels: Record<OperationalArea, string> = {projects: 'Projetos', materials: 'Materiais', loans: 'Empréstimos', campaigns: 'Dinâmicas e eventos', general: 'Organização'};
const areaIcons = {projects: Building2, materials: Gift, loans: Handshake, campaigns: CalendarClock, general: Layers};
const viaLabels: Record<AssignmentVia, string> = {direct: 'Atribuição direta', team: 'Pela sua equipe', both: 'Direta e pela equipe'};
const statusLabels: Record<MyWorkStatus, string> = {pending: 'Pendentes', all: 'Todas', completed: 'Concluídas', attention: 'Precisam de atenção', overdue: 'Em atraso', due_today: 'Prazo hoje', in_progress: 'Em andamento', blocked: 'Bloqueadas', open: 'Abertas', cancelled: 'Canceladas'};
type Selection = {owner: string; assignment: AssignmentFilter; status: MyWorkStatus; taskOffset: number; responsibilityOffset: number};
const initial = (owner: string): Selection => ({owner, assignment: 'all', status: 'pending', taskOffset: 0, responsibilityOffset: 0});
type Loaded = {key: string; data?: MyWorkResponse; error?: string};

function AssignmentLabel({via}: {via: AssignmentVia}) {
  const Icon = via === 'direct' ? UserRound : Users;
  return <span className={styles.via}><Icon size={14} aria-hidden="true"/>{viaLabels[via]}</span>;
}
function TargetLink({target, context, onOpen}: {target: WorkTarget; context: MyWorkContext; onOpen?: MeuTrabalhoPanelProps['onOpenTarget']}) {
  if (!target.canOpen || !target.href) return <p className={styles.restricted}>Registro de acesso restrito. A designação não amplia suas permissões.</p>;
  return <p>{onOpen ? <button type="button" className="p-text-link" onClick={() => onOpen(target, context)}>{target.name || 'Abrir registro'}</button> : <a className="p-text-link" href={target.href}>{target.name || 'Abrir registro'}</a>}</p>;
}
function Pager({label, offset, total, hasMore, nextOffset, change}: {label: string; offset: number; total: number; hasMore: boolean; nextOffset: number | null; change: (offset: number) => void}) {
  if (!offset && !hasMore) return null;
  return <nav className={styles.pager} aria-label={`Páginas de ${label}`}><span>{total === 0 ? 'Nenhum registro' : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} de ${total}`}</span><div><button type="button" className="p-button" disabled={offset === 0} onClick={() => change(Math.max(0, offset - PAGE_SIZE))}>Anteriores</button><button type="button" className="p-button" disabled={!hasMore || nextOffset === null} onClick={() => nextOffset !== null && change(nextOffset)}>Próximas</button></div></nav>;
}
function consultationTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', {dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo'}).format(date) : 'horário não informado';
}
const visibleRange = (offset: number, length: number, total: number) => length ? `${offset + 1}–${offset + length} de ${total}` : `0 de ${total}`;

export default function MeuTrabalhoPanel({userId, organizationId = null, projectId = null, serverDay = '', onOpenTask, onOpenTarget}: MeuTrabalhoPanelProps) {
  const owner = JSON.stringify([userId, organizationId, projectId]);
  const [selection, setSelection] = useState<Selection>(() => initial(owner));
  const selected = selection.owner === owner ? selection : initial(owner);
  const {assignment, status, taskOffset, responsibilityOffset} = selected;
  const [revision, setRevision] = useState(0), [loaded, setLoaded] = useState<Loaded | null>(null);
  const active = useRef<AbortController | null>(null), generation = useRef(0);
  const key = JSON.stringify([owner, assignment, status, taskOffset, responsibilityOffset, revision, serverDay]);
  const current = loaded?.key === key ? loaded : null, data = current?.data, loading = !current;
  function invalidate() { generation.current++; active.current?.abort(); }
  function choose(patch: Partial<Omit<Selection, 'owner'>>) { invalidate(); setSelection({...selected, taskOffset: 0, responsibilityOffset: 0, ...patch}); }
  function refresh() { invalidate(); setRevision(value => value + 1); }
  useEffect(() => {
    const changed = () => { generation.current++; active.current?.abort(); setRevision(value => value + 1); };
    window.addEventListener(FOLLOWUP_CHANGED, changed);
    return () => window.removeEventListener(FOLLOWUP_CHANGED, changed);
  }, []);
  useEffect(() => {
    const controller = new AbortController(), epoch = ++generation.current;
    active.current = controller;
    const query = new URLSearchParams({assignment, status, taskOffset: String(taskOffset), responsibilityOffset: String(responsibilityOffset), limit: String(PAGE_SIZE)});
    if (organizationId) query.set('organizationId', organizationId);
    if (projectId) query.set('projectId', projectId);
    void workApi(`/api/my-work?${query}`, isMyWorkResponse, controller.signal).then(result => {
      if (controller.signal.aborted || epoch !== generation.current) return;
      const rowsMatchScope = [...result.tasks.items, ...result.responsibilities.items].every(row => (!organizationId || row.organization_id === organizationId) && (!projectId || row.project_id === projectId));
      if (result.viewerId !== userId || result.scope.organizationId !== organizationId || result.scope.projectId !== projectId || result.scope.assignment !== assignment || result.scope.status !== status || !rowsMatchScope) throw new Error('A sessão ou o contexto da resposta mudou. Atualize a página.');
      setLoaded({key, data: result});
    }).catch(error => {
      if (!controller.signal.aborted && epoch === generation.current) setLoaded({key, error: error instanceof Error ? error.message : 'Não foi possível consultar seu trabalho.'});
    });
    return () => controller.abort();
  }, [key, userId, organizationId, projectId, assignment, status, taskOffset, responsibilityOffset]);
  const counts = data?.totals.tasks;
  const metrics = [
    {name: 'Atenção', count: counts?.attention, status: 'attention' as const, icon: AlertTriangle, tone: 'warning', help: 'Em atraso ou bloqueadas'},
    {name: 'Prazo hoje', count: counts?.dueToday, status: 'due_today' as const, icon: CalendarClock, tone: 'warning', help: 'Pendentes com prazo hoje'},
    {name: 'Em andamento', count: counts?.inProgress, status: 'in_progress' as const, icon: CircleDot, tone: 'info', help: 'Trabalho iniciado'},
    {name: 'Concluídas', count: counts?.completed, status: 'completed' as const, icon: CircleCheck, tone: 'success', help: 'Demandas finalizadas'},
  ];
  const maxArea = Math.max(1, ...data?.areas.map(area => area.taskCounts.total) ?? []);
  return <section className={styles.panel} aria-label="Meu trabalho" aria-busy={loading}>
    <header className={styles.heading}><div><h2>Meu trabalho</h2><p>Demandas e responsabilidades atribuídas a você ou às suas equipes neste contexto.</p></div><button type="button" className="p-button" onClick={refresh} aria-label="Atualizar meu trabalho"><RefreshCw size={16} aria-hidden="true"/>Atualizar</button></header>
    <div className={styles.assignment} role="group" aria-label="Origem da atribuição">{([['all', 'Todas'], ['direct', 'Diretas'], ['team', 'Por equipe']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={assignment === value} onClick={() => choose({assignment: value})}>{label}</button>)}</div>
    <div className={styles.metrics} aria-label="Totais de demandas atribuídas">{metrics.map(metric => { const Icon = metric.icon; return <button type="button" key={metric.name} className={styles.metric} data-tone={metric.tone} aria-pressed={status === metric.status} onClick={() => choose({status: metric.status})}><span><Icon size={18} aria-hidden="true"/>{metric.name}</span><strong>{metric.count ?? '—'}</strong><small>{metric.help}</small></button>; })}</div>
    <p className={styles.help}>Os totais abrangem todas as páginas do contexto e da origem escolhida. O filtro de estado abaixo altera a lista de demandas.</p>
    {current?.error && <p role="alert" className={`${styles.notice} ${styles.error}`}>{current.error}</p>}
    <p className={loading ? styles.notice : styles.help} role="status" aria-live="polite" aria-atomic="true">{loading ? 'Consultando atribuições…' : data ? `Demandas (${statusLabels[status]}): ${visibleRange(taskOffset, data.tasks.items.length, data.tasks.total)}. Responsabilidades: ${visibleRange(responsibilityOffset, data.responsibilities.items.length, data.responsibilities.total)}.` : 'Consulta não concluída.'}</p>
    {data && <>
      <section className={styles.listSection} aria-label="Minhas demandas"><div className={styles.listHeading}><h3><ClipboardList size={18} aria-hidden="true"/> Demandas · {data.tasks.total}</h3><label>Estado da lista<select value={status} onChange={event => choose({status: event.target.value as MyWorkStatus})}>{MY_WORK_STATUSES.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label></div>
        {!data.tasks.items.length ? <div className={styles.empty}><strong>Nenhuma demanda neste recorte.</strong><p>Ser criador de um registro ou ter acesso ao projeto não significa ser responsável por ele.</p></div> : <ul className={styles.list}>{data.tasks.items.map(task => { const context = {organizationId: task.organization_id, projectId: task.project_id}; return <li key={task.id} className={styles.card}><div className={styles.rowTop}><TaskSignals status={task.status} priority={task.priority} dueAt={task.due_at} today={data.today}/><AssignmentLabel via={task.assignmentVia}/></div><h4>{onOpenTask ? <button type="button" onClick={() => onOpenTask(task.id, context)}>{task.title}</button> : <a href={task.href}>{task.title}</a>}</h4><p className={styles.context}>{task.organization_name}{task.project_name && ` · ${task.project_name}`} · {areaLabels[task.area]}</p><p className={styles.assignees}>Responsáveis: {task.assignees.map(person => person.name).join(', ') || 'Não informado'}</p>{task.area !== 'general' && <TargetLink target={task.target} context={context} onOpen={onOpenTarget}/>}</li>; })}</ul>}
        <Pager label="demandas" offset={taskOffset} total={data.tasks.total} hasMore={data.tasks.hasMore} nextOffset={data.tasks.nextOffset} change={offset => choose({taskOffset: offset, responsibilityOffset})}/>
      </section>
      <section className={styles.listSection} aria-label="Minhas responsabilidades"><div className={styles.listHeading}><h3>Responsabilidades · {data.totals.responsibilities.total}</h3></div><p className={styles.help}>Designações contínuas em projetos, materiais, empréstimos e dinâmicas. Não são demandas nem permissões de acesso.</p>
        {!data.responsibilities.items.length ? <div className={styles.empty}>Nenhuma responsabilidade designada neste contexto.</div> : <ul className={styles.list}>{data.responsibilities.items.map(row => { const Icon = areaIcons[row.area]; return <li key={row.id} className={styles.card}><div className={styles.rowTop}><strong><Icon size={16} aria-hidden="true"/> {areaLabels[row.area]}</strong>{row.assignmentVia && <AssignmentLabel via={row.assignmentVia}/>}</div><TargetLink target={row.target} context={{organizationId: row.organization_id, projectId: row.project_id}} onOpen={onOpenTarget}/><p className={styles.context}>{row.organization_name} · {row.project_name}</p><p>Responsáveis: {row.assignees.map(person => person.name).join(', ') || 'Não informado'}</p></li>; })}</ul>}
        <Pager label="responsabilidades" offset={responsibilityOffset} total={data.responsibilities.total} hasMore={data.responsibilities.hasMore} nextOffset={data.responsibilities.nextOffset} change={offset => choose({responsibilityOffset: offset, taskOffset})}/>
      </section>
      <section className={styles.areas} aria-label="Distribuição por módulo"><h3>Por módulo de trabalho</h3>{data.areas.map(area => { const Icon = areaIcons[area.area]; return <div key={area.area} className={styles.area}><div className={styles.areaLabel}><strong><Icon size={16} aria-hidden="true"/>{areaLabels[area.area]}</strong><span>{area.taskCounts.total} demanda{area.taskCounts.total !== 1 && 's'} · {area.responsibilityCount} designaç{area.responsibilityCount === 1 ? 'ão' : 'ões'}</span></div><div className={styles.bar} aria-hidden="true"><span style={{width: `${100 * area.taskCounts.total / maxArea}%`}}/></div></div>; })}<p className={styles.help}>As barras comparam demandas; as designações são apresentadas separadamente, sem somar unidades diferentes.</p></section>
      <p className={styles.asOf}>Consulta em {consultationTime(data.asOf)} · horário de Brasília.</p>
    </>}
  </section>;
}
