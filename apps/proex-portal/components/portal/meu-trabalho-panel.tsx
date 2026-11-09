'use client';

import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AlertTriangle, Building2, CalendarClock, CircleCheck, CircleDot, ClipboardList, FileDown, Gift, Handshake, Layers, RefreshCw, Users, UserRound} from 'lucide-react';
import {isMyWorkResponse, MY_WORK_STATUSES, type AssignmentFilter, type AssignmentVia, type MyWorkResponse, type MyWorkStatus, type OperationalArea, type WorkTarget} from '@/lib/my-work/contracts';
import {FOLLOWUP_CHANGED} from './follow-up-api';
import {workApi} from './my-work-api';
import {assertMyWorkContext,MY_WORK_PAGE_SIZE,MY_WORK_STATUS_LABELS,myWorkExportFingerprint,myWorkExportReport,myWorkMarkdownReport,myWorkQuery} from './my-work-export';
import ExportFormats,{type DocumentFormat} from './export-formats';
import {documentExport} from './document-export';
import {download} from './report-export';
import {TaskSignals} from './work-signals';
import styles from './meu-trabalho-panel.module.css';

export type MyWorkContext = {organizationId: string; projectId: string | null};
export type MeuTrabalhoPanelProps = {
  userId: string;
  organizationId?: string | null;
  projectId?: string | null;
  serverDay?: string;
  workStatus?: MyWorkStatus;
  onWorkStatusChange?: (status: MyWorkStatus) => void;
  onOpenTask?: (id: string, context: MyWorkContext) => void;
  onOpenTarget?: (target: WorkTarget, context: MyWorkContext) => void;
};
const PAGE_SIZE = MY_WORK_PAGE_SIZE;
const areaLabels: Record<OperationalArea, string> = {projects: 'Projetos', materials: 'Materiais', loans: 'Empréstimos', campaigns: 'Dinâmicas e eventos', general: 'Organização'};
const areaIcons = {projects: Building2, materials: Gift, loans: Handshake, campaigns: CalendarClock, general: Layers};
const viaLabels: Record<AssignmentVia, string> = {direct: 'Atribuição direta', team: 'Pela sua equipe', both: 'Direta e pela equipe'};
const statusLabels=MY_WORK_STATUS_LABELS;
type Selection = {owner: string; assignment: AssignmentFilter; status: MyWorkStatus; taskOffset: number; responsibilityOffset: number};
const initial = (owner: string, status: MyWorkStatus = 'pending'): Selection => ({owner, assignment: 'all', status, taskOffset: 0, responsibilityOffset: 0});
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
const visibleRange = (offset: number, length: number, total: number) => length ? `${offset + 1}–${offset + length}\u00a0de\u00a0${total}` : `0\u00a0de\u00a0${total}`;

export default function MeuTrabalhoPanel({userId, organizationId = null, projectId = null, serverDay = '', workStatus, onWorkStatusChange, onOpenTask, onOpenTarget}: MeuTrabalhoPanelProps) {
  const owner = JSON.stringify([userId, organizationId, projectId]);
  // Back may revisit a query whose previous result is still in memory. Give each
  // incoming route a new read epoch before rendering, without resetting assignment.
  const [routeRead, setRouteRead] = useState({status: workStatus, epoch: 0});
  const incomingRead = routeRead.status === workStatus ? routeRead : {status: workStatus, epoch: routeRead.epoch + 1};
  if (incomingRead !== routeRead) setRouteRead(incomingRead);
  const [selection, setSelection] = useState<Selection>(() => initial(owner, workStatus));
  const selected = selection.owner !== owner ? initial(owner, workStatus) : workStatus && workStatus !== selection.status ? {...selection, status: workStatus, taskOffset: 0, responsibilityOffset: 0} : selection;
  const {assignment, status, taskOffset, responsibilityOffset} = selected;
  const [revision, setRevision] = useState(0), [loaded, setLoaded] = useState<Loaded | null>(null);
  const [exporting,setExporting]=useState<{key:string;format:DocumentFormat|'md'}|null>(null),[vaultFeedback,setVaultFeedback]=useState<{key:string;error:boolean;message:string}|null>(null);
  const active = useRef<AbortController | null>(null), generation = useRef(0), exportRequest=useRef<AbortController|null>(null),exportEpoch=useRef(0),mounted=useRef(true);
  const key = JSON.stringify([owner, assignment, status, taskOffset, responsibilityOffset, revision, serverDay, incomingRead.epoch]);
  const latestKey=useRef(key);
  const cancelExport=useCallback(()=>{exportEpoch.current++;exportRequest.current?.abort();exportRequest.current=null;},[]);
  const query={userId,organizationId,projectId,assignment,status,taskOffset,responsibilityOffset};
  const queryPath=myWorkQuery(query);
  const current = loaded?.key === key ? loaded : null, data = current?.data, loading = !current;
  const invalidate=useCallback(()=>{generation.current++;active.current?.abort();cancelExport();},[cancelExport]);
  function choose(patch: Partial<Omit<Selection, 'owner'>>) { invalidate(); setSelection({...selected, taskOffset: 0, responsibilityOffset: 0, ...patch}); if (patch.status && patch.status !== status) onWorkStatusChange?.(patch.status); }
  function refresh() { invalidate(); setRevision(value => value + 1); }
  useLayoutEffect(()=>{latestKey.current=key;cancelExport();return invalidate;},[key,cancelExport,invalidate]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancelExport();};},[cancelExport]);
  useEffect(() => {
    const changed = () => { generation.current++; active.current?.abort();cancelExport(); setRevision(value => value + 1); };
    window.addEventListener(FOLLOWUP_CHANGED, changed);
    return () => window.removeEventListener(FOLLOWUP_CHANGED, changed);
  }, [cancelExport]);
  useEffect(() => {
    const controller = new AbortController(), epoch = ++generation.current;
    active.current = controller;
    void workApi(queryPath, isMyWorkResponse, controller.signal).then(result => {
      if (controller.signal.aborted || epoch !== generation.current || latestKey.current !== key) return;
      assertMyWorkContext(result,{userId,organizationId,projectId,assignment,status,taskOffset,responsibilityOffset});
      setLoaded({key, data: result});
    }).catch(error => {
      if (!controller.signal.aborted && epoch === generation.current && latestKey.current === key) setLoaded({key, error: error instanceof Error ? error.message : 'Não foi possível consultar seu trabalho.'});
    });
    return () => controller.abort();
  }, [key, queryPath, userId, organizationId, projectId, assignment, status, taskOffset, responsibilityOffset]);
  async function exportCurrent(format:DocumentFormat|'md'){
    if(!data||exportRequest.current)throw new Error('Aguarde a consulta antes de baixar seu resumo.');
    const controller=new AbortController(),epoch=++exportEpoch.current,requestKey=key;exportRequest.current=controller;setExporting({key:requestKey,format});
    const isCurrent=()=>mounted.current&&!controller.signal.aborted&&epoch===exportEpoch.current&&requestKey===latestKey.current;
    const guard=()=>{if(!isCurrent())throw new Error('O contexto mudou. Confira a página atual antes de baixar.');};
    const freshRead=async()=>{guard();try{const result=await workApi(queryPath,isMyWorkResponse,controller.signal);guard();assertMyWorkContext(result,query);return result;}catch(error){if(isCurrent())setLoaded({key:requestKey,error:error instanceof Error?error.message:'Não foi possível conferir seu acesso ao resumo.'});throw error;}};
    try{
      const fresh=await freshRead(),report=myWorkExportReport(fresh,query),fingerprint=myWorkExportFingerprint(fresh,query);
      guard();const blob=format==='md'?new Blob([myWorkMarkdownReport(report)],{type:'text/markdown;charset=utf-8'}):await documentExport(format,report.title,report.columns,report.rows,(row,column)=>row[column],report.info,report.presentation);
      guard();const verified=await freshRead();guard();
      if(myWorkExportFingerprint(verified,query)!==fingerprint){setLoaded({key:requestKey,data:verified});throw new Error('Suas atribuições ou permissões mudaram durante a preparação. Confira a lista atualizada e baixe novamente.');}
      setLoaded({key:requestKey,data:verified});guard();download(`meu-trabalho-proex-${fresh.today}.${format}`,blob);
    }finally{if(exportRequest.current===controller){exportRequest.current=null;if(mounted.current&&latestKey.current===requestKey&&epoch===exportEpoch.current)setExporting(null);}}
  }
  async function exportVault(){const requestKey=key,epoch=exportEpoch.current+1;setVaultFeedback(null);try{await exportCurrent('md');if(mounted.current&&latestKey.current===requestKey&&epoch===exportEpoch.current)setVaultFeedback({key:requestKey,error:false,message:'Arquivo Markdown preparado para sua Vault.'});}catch(error){if(mounted.current&&latestKey.current===requestKey&&epoch===exportEpoch.current)setVaultFeedback({key:requestKey,error:true,message:error instanceof Error?error.message:'Não foi possível preparar o arquivo da Vault.'});}}
  const exportBusy=exporting?.key===key;
  const counts = data?.totals.tasks;
  const metrics = [
    {name: 'Atenção', count: counts?.attention, status: 'attention' as const, icon: AlertTriangle, tone: 'warning', help: 'Em atraso ou bloqueadas'},
    {name: 'Prazo hoje', count: counts?.dueToday, status: 'due_today' as const, icon: CalendarClock, tone: 'warning', help: 'Pendentes com prazo hoje'},
    {name: 'Em andamento', count: counts?.inProgress, status: 'in_progress' as const, icon: CircleDot, tone: 'info', help: 'Trabalho iniciado'},
    {name: 'Concluídas', count: counts?.completed, status: 'completed' as const, icon: CircleCheck, tone: 'success', help: 'Demandas finalizadas'},
  ];
  const maxArea = Math.max(1, ...data?.areas.map(area => area.taskCounts.total) ?? []);
  return <section className={styles.panel} aria-label="Meu trabalho" aria-busy={loading}>
    <header className={styles.heading}><div><h2>Suas atribuições</h2><p>Atribuições diretas e das suas equipes.</p></div><button type="button" className="p-button" onClick={refresh} aria-label="Atualizar meu trabalho"><RefreshCw size={16} aria-hidden="true"/>Atualizar</button></header>
    <div className={styles.assignment} role="group" aria-label="Origem da atribuição">{([['all', 'Todas'], ['direct', 'Diretas'], ['team', 'Por equipe']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={assignment === value} onClick={() => choose({assignment: value})}>{label}</button>)}</div>
    <div className={styles.metrics} aria-label="Totais de demandas atribuídas">{metrics.map(metric => { const Icon = metric.icon; return <button type="button" key={metric.name} className={styles.metric} data-tone={metric.tone} aria-pressed={status === metric.status} onClick={() => choose({status: metric.status})}><span><Icon size={18} aria-hidden="true"/>{metric.name}</span><strong>{metric.count ?? '—'}</strong><small>{metric.help}</small></button>; })}</div>
    <p className={styles.help}>Os totais abrangem todas as páginas do contexto e da origem escolhida. O filtro de estado abaixo altera a lista de demandas.</p>
    {current?.error && <p role="alert" className={`${styles.notice} ${styles.error}`}>{current.error}</p>}
    <p className={loading ? styles.notice : styles.help} role="status" aria-live="polite" aria-atomic="true">{loading ? 'Consultando atribuições…' : data ? `Demandas (${statusLabels[status]}): ${visibleRange(taskOffset, data.tasks.items.length, data.tasks.total)}. Responsabilidades: ${visibleRange(responsibilityOffset, data.responsibilities.items.length, data.responsibilities.total)}.` : 'Consulta não concluída.'}</p>
    {data&&<section className={styles.exports} aria-labelledby="my-work-export-title"><div><h3 id="my-work-export-title"><FileDown size={19} aria-hidden="true"/>Resumo destas páginas</h3><p>Até 6 demandas e 6 acompanhamentos, conforme os filtros e as páginas atuais. O arquivo informa os totais e a consulta; confira o recorte antes de compartilhar.</p></div><ExportFormats label="Baixar resumo de Meu trabalho" disabled={exportBusy||!data.tasks.items.length&&!data.responsibilities.items.length} onExport={exportCurrent}/><details className={styles.vaultExport}><summary>Outras opções</summary><button type="button" className="p-button p-button-subtle" disabled={exportBusy||!data.tasks.items.length&&!data.responsibilities.items.length} onClick={()=>void exportVault()}>{exportBusy&&exporting?.format==='md'?'Preparando para a Vault…':'Para a sua Vault (.md)'}</button>{vaultFeedback?.key===key&&<p role={vaultFeedback.error?'alert':'status'}>{vaultFeedback.message}</p>}</details></section>}
    {data && <>
      <section className={styles.listSection} aria-label="Minhas demandas"><div className={styles.listHeading}><h3><ClipboardList size={18} aria-hidden="true"/> Demandas · {data.tasks.total}</h3><label>Estado da lista<select name="myWorkStatus" value={status} onChange={event => choose({status: event.target.value as MyWorkStatus})}>{MY_WORK_STATUSES.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label></div>
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
