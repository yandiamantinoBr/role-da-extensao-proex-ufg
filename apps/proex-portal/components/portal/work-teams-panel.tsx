'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, CheckCircle2, Pin, PinOff, Circle, CircleDot, CircleX, Flag, FolderKanban, Landmark, PauseCircle, Pencil, Plus, RefreshCw, Search, ShieldCheck, UserRoundCheck, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { stateLabels, TASK_STATES, type TaskStatus } from '@/lib/follow-up/contracts';
import { TEAM_TASK_PAGE_SIZE, type TeamsWorkspace, type WorkTeam, type TeamPerson, type TeamProject } from '@/lib/follow-up/teams-contract';
import { projectAccessHref } from '@/lib/team-access-labels';
import { followupChanged, FOLLOWUP_CHANGED } from './follow-up-api';
import { saveWorkTeam, TeamsApiError, workTeamsApi } from './work-teams-api';
import { prepareTeamExport, teamExportDocument } from './work-teams-export';
import { WorkTaskCard } from './work-task-card';
import { DraftNotice, useFormDraft } from './use-form-draft';
import styles from './work-teams-panel.module.css';
import ExportFormats, { ExportHandledError, type DocumentFormat } from './export-formats';
import TeamSheetsPanel from './team-sheets-panel';
import TeamTemplates from './management/team-templates';
import InstitutionalStructurePanel from './institutional-structure-panel';

type Props = {
 userId: string; defaultProjectId?: string;
 organizations: { id: string; name: string; canManage: boolean }[];
 projects: { id: string; name: string; organization_id: string }[];
 onChanged?: () => void | Promise<void>;
 onOpenDemand: (id: string, projectId: string | null) => void;
 canOpenAccess?: (projectId: string) => boolean;
 /** Equipes fixadas na conta (0038) e ação para fixar ou desafixar. */
 pinnedTeamIds?: string[];
 onTogglePin?: (teamId: string, pinned: boolean) => Promise<void>;
 /** Vindo do menu lateral (abrir equipe fixada) ou do empréstimo (criar equipe). O painel é remontado a cada pedido. */
 intent?: { kind: 'open' | 'new'; teamId?: string; organizationId?: string } | null;
 /** Avisa qual equipe está aberta, para o menu lateral marcar a certa. */
 onTeamShown?: (teamId: string) => void;
};
const stateIcons = { open: Circle, in_progress: CircleDot, blocked: PauseCircle, completed: CheckCircle2, cancelled: CircleX };
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.';
const aborted = (cause: unknown) => cause instanceof Error && cause.name === 'AbortError';
const initials = (name: string) => name.trim().split(/\s+/).slice(0,2).map(word => word[0]).join('').toLocaleUpperCase('pt-BR');
const quantity = (value: number, singular: string, plural: string) => `${value} ${value === 1 ? singular : plural}`;
const projectHref = (id: string) => `/?module=projects&project=${encodeURIComponent(id)}&detailProject=${encodeURIComponent(id)}`;
const projectStageLabels: Record<TeamProject['stage'], string> = { active: '', past: 'Histórico', catalog: 'Catálogo', archived: 'Arquivado' };
const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim();
type TeamFilter = '' | 'project' | 'multi' | 'unit' | 'unlinked';
function matchesScope(team: WorkTeam, scope: TeamFilter, projectId: string, canManage: boolean): boolean {
 if (scope === 'unit') return team.units.length > 0;
 if (scope === 'project' && projectId) return team.projects.some(project => project.id === projectId);
 if (canManage && scope === 'multi') return team.projects.filter(project => project.stage === 'active').length > 1;
 if (canManage && scope === 'unlinked') return team.projects.length === 0;
 return true;
}

function TeamForm({ team, people, organizationId, busy, onSave }: { team?: WorkTeam; people: TeamPerson[]; organizationId: string; busy: boolean; onSave: (input: Record<string, unknown>) => Promise<void> }) {
 const form = useRef<HTMLFormElement>(null), operation = useRef<string | null>(null);
 const draft = useFormDraft(form, `followup:team:${team ? `${team.id}:${team.version}` : 'new'}:${organizationId}`);
 const [error, setError] = useState('');
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); if (busy) return;
  const values = new FormData(event.currentTarget); operation.current ??= crypto.randomUUID(); setError('');
  try {
   await onSave({ action: team ? 'team.update' : 'team.create', organizationId, ...(team ? { id: team.id, expectedVersion: team.version } : {}), name: values.get('name'), status: values.get('status'), userIds: values.getAll('userId'), operationKey: operation.current });
   draft.clear(); operation.current = null;
  } catch (cause) { setError(message(cause)); }
 }
 return <form ref={form} onSubmit={event => void submit(event)} className={styles.form}>
  <DraftNotice draft={draft}/>
  <fieldset disabled={busy} className={styles.form}>
   <label>Nome da equipe<input name="name" required maxLength={100} autoFocus defaultValue={team?.name} placeholder="Ex.: Comunicação e Design"/></label>
   <label>Situação<select name="status" defaultValue={team?.status ?? 'active'}><option value="active">Ativa</option><option value="archived">Arquivada</option></select></label>
   <fieldset className={styles.roster}><legend>Integrantes da organização</legend><p>Uma pessoa pode fazer parte de várias equipes.</p>
    <div>{people.map(person => <label key={person.userId}><input type="checkbox" name="userId" value={person.userId} defaultChecked={team?.members.some(member => member.userId === person.userId)}/><span>{person.name}</span></label>)}</div>
    {!people.length && <p>Nenhuma pessoa elegível neste momento. Os convites ficam em Pessoas e acessos.</p>}
   </fieldset>
   <p className={styles.help}><ShieldCheck size={16} aria-hidden="true"/>O vínculo organiza atribuições. Os acessos a projetos continuam sendo concedidos separadamente.</p>
   {error && <p role="alert" className="p-notice p-notice-error">{error}</p>}
   <button className="p-button p-button-primary" type="submit">{busy ? 'Salvando…' : team ? 'Salvar equipe' : 'Criar equipe'}</button>
  </fieldset>
 </form>;
}

export default function WorkTeamsPanel({ userId, defaultProjectId = '', organizations, projects, onChanged, onOpenDemand, canOpenAccess, pinnedTeamIds = [], onTogglePin, intent = null, onTeamShown }: Props) {
 const initialProject = projects.find(project => project.id === defaultProjectId) ?? projects[0];
 // Um pedido vindo de fora escolhe a organização: abrir uma equipe fixada ou criar uma nova.
 const intentOrg = organizations.find(organization => organization.id === intent?.organizationId)
  ?? (intent?.kind === 'new' ? organizations.find(organization => organization.canManage && organization.id === initialProject?.organization_id) ?? organizations.find(organization => organization.canManage) : undefined);
 const startOrg = intentOrg?.id ?? initialProject?.organization_id ?? organizations[0]?.id ?? '';
 const startProject = intentOrg ? (intentOrg.canManage ? '' : projects.find(project => project.organization_id === intentOrg.id)?.id ?? '')
  : defaultProjectId || !organizations.some(org => org.id === startOrg && org.canManage) ? initialProject?.id ?? '' : '';
 const [organizationId, setOrganizationId] = useState(startOrg);
 const [projectId, setProjectId] = useState(startProject);
 const [pinMessage, setPinMessage] = useState('');
 const [teamId, setTeamId] = useState(intent?.kind === 'open' && intentOrg ? intent.teamId ?? '' : ''), [status, setStatus] = useState<TaskStatus | ''>(''), [offset, setOffset] = useState(0);
 const [mine, setMine] = useState(false), [search, setSearch] = useState(''), [teamScope, setTeamScope] = useState<TeamFilter>(''), [attempt, setAttempt] = useState(0);
 const [stored, setStored] = useState<{ key: string; context: string; status: TaskStatus | ''; offset: number; data: TeamsWorkspace } | null>(null), [error, setError] = useState('');
 const [editor, setEditor] = useState<string | null>(intent?.kind === 'new' && intentOrg?.canManage ? 'new' : null), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false);
 const mounted = useRef(true), generation = useRef(0), pendingMutation = useRef(false), exportRequest = useRef<AbortController | null>(null);
 const detailHeading = useRef<HTMLHeadingElement>(null), focusNextTeam = useRef(false);
 const selectedOrganization = organizations.find(organization => organization.id === organizationId);
 const canQuery = Boolean(selectedOrganization && (projectId ? projects.some(project => project.id === projectId && project.organization_id === organizationId) : selectedOrganization.canManage));
 const context = JSON.stringify([userId, organizationId, projectId]);
 const key = JSON.stringify([context, teamId, status, offset, attempt]);
 const data = canQuery && stored?.context === context ? stored.data : null, loading = Boolean(data && stored?.key !== key);
 const selected = data?.teams.find(team => team.id === data.selectedTeamId), displayedStatus = stored?.status ?? '', displayedOffset = stored?.offset ?? 0;
 const ownProjects = projects.filter(project => project.organization_id === organizationId);
 const editorTeam = data?.teams.find(team => team.id === editor);
 const canEditTeams = Boolean(data?.scope.canManage && !data.scope.projectId);

 useEffect(() => { mounted.current = true; return () => { mounted.current = false; exportRequest.current?.abort(); }; }, []);
 useEffect(() => {
  const update = () => { if (!pendingMutation.current && !editor) setAttempt(value => value + 1); };
  window.addEventListener(FOLLOWUP_CHANGED, update); return () => window.removeEventListener(FOLLOWUP_CHANGED, update);
 }, [editor]);
 useEffect(() => {
  const sequence = ++generation.current, controller = new AbortController(); exportRequest.current?.abort();
  if (!canQuery) return () => controller.abort();
  const query = new URLSearchParams({ organizationId, ...(projectId ? { projectId } : {}), ...(teamId ? { teamId } : {}), ...(status ? { status } : {}), offset: String(offset) });
  void workTeamsApi(query, userId, controller.signal).then(result => { if (mounted.current && sequence === generation.current) { setStored({ key, context, status, offset, data: result }); setError(''); } }).catch(cause => {
   if (!mounted.current || sequence !== generation.current || aborted(cause)) return;
   setStored(null); setEditor(null); setError(message(cause));
  });
  return () => controller.abort();
 }, [key, context, canQuery, organizationId, projectId, teamId, status, offset, userId, selectedOrganization?.canManage]);
 function invalidate() { generation.current++; exportRequest.current?.abort(); setExporting(false); setError(''); }
 function clearTeamFilters() { setMine(false); setSearch(''); setTeamScope(''); }
 function changeContext(org: string, project: string) {
  invalidate();
  if (!project && teamScope === 'project') setTeamScope('');
  setOrganizationId(org); setProjectId(project); setTeamId(''); setStatus(''); setOffset(0); setEditor(null);
 }
 function followProject(project: string) {
  changeContext(organizationId, project);
  if (data?.scope.canManage && selected) setTeamId(selected.id);
 }
 /** Equipes pertencem à organização: a criação acontece na visão da organização inteira. */
 function startNewTeam() {
  if (canEditTeams) { setEditor('new'); return; }
  if (!selectedOrganization?.canManage) return;
  changeContext(organizationId, ''); setEditor('new');
 }
 async function togglePin(team: WorkTeam) {
  if (!onTogglePin) return;
  const pinned = pinnedTeamIds.includes(team.id);
  try { await onTogglePin(team.id, !pinned); setPinMessage(pinned ? `${team.name} saiu dos fixados.` : `${team.name} fixada: aparece no menu lateral, em Equipes.`); }
  catch (cause) { setPinMessage(message(cause)); }
 }
 function chooseTeam(id: string) {
  if (!loading && data?.selectedTeamId === id && !status && !offset && detailHeading.current) { detailHeading.current.focus({ preventScroll: true }); detailHeading.current.scrollIntoView({ block: 'start', behavior: 'auto' }); return; }
  focusNextTeam.current = true; invalidate(); setTeamId(id); setStatus(''); setOffset(0); setEditor(null);
 }
 async function save(input: Record<string, unknown>) {
  if (pendingMutation.current || !canEditTeams || loading) return;
  pendingMutation.current = true; setBusy(true); const savedGeneration = generation.current;
  try {
   const result = await saveWorkTeam(input);
   if (!mounted.current || generation.current !== savedGeneration) return;
   focusNextTeam.current = true; clearTeamFilters(); setEditor(null); setTeamId(result.teamId); setOffset(0); setAttempt(value => value + 1); followupChanged();
   toast.success(input.action === 'team.create' ? 'Equipe criada.' : 'Equipe atualizada.');
   try { await onChanged?.(); } catch { if (mounted.current) toast.info('Equipe salva. Atualize o portal para conferir os outros painéis.'); }
  } catch (cause) {
   if (mounted.current && generation.current === savedGeneration) { toast.error(message(cause)); if (cause instanceof TeamsApiError && [401,403].includes(cause.status)) { setStored(null); setEditor(null); setError(message(cause)); } }
   throw cause;
  } finally { pendingMutation.current = false; if (mounted.current) setBusy(false); }
 }
 async function exportTeam(format: DocumentFormat) {
  if (!selected || !shownTeamId || exporting || loading) throw new ExportHandledError();
  const controller = new AbortController(), sequence = generation.current;
  exportRequest.current?.abort(); exportRequest.current = controller; setExporting(true);
  const current = () => mounted.current && sequence === generation.current && !controller.signal.aborted;
  const guard = () => {
   if (!current()) throw new DOMException('Exportação cancelada.', 'AbortError');
  };
  const query = new URLSearchParams({ view: 'export', organizationId, teamId: selected.id, ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) });
  const fetchReport = () => workTeamsApi(query, userId, controller.signal);
  try {
   const artifact = await prepareTeamExport(fetchReport, async fresh => {
    const [{ documentExport }, { download }] = await Promise.all([import('./document-export'), import('./report-export')]).catch(() => {
     throw new TeamsApiError('Atualize a página e tente baixar as demandas novamente.', 503);
    });
    guard();
    const { title, columns, rows, display, info, metrics } = teamExportDocument(fresh, status);
    try {
     const blob = await documentExport(format, format === 'xlsx' ? 'Demandas da equipe' : title, columns, rows, display, info, { metrics });
     return { blob, download, day: fresh.today, count: rows.length };
    } catch (cause) {
     if (cause instanceof Error && /2\.000 linhas|muito extenso|páginas/.test(cause.message)) throw new TeamsApiError(cause.message, 413);
     throw new TeamsApiError('Não foi possível preparar o arquivo. Atualize a página e tente novamente.', 503);
    }
   }, guard);
   guard();
   artifact.download(`proex-equipe-${artifact.day}.${format}`, artifact.blob);
   toast.success(`${format.toUpperCase()} preparado com ${artifact.count} demandas.`);
  } catch (cause) {
   if (!current() || aborted(cause)) throw new ExportHandledError();
   const detail = cause instanceof TeamsApiError ? cause.message : 'Não foi possível consultar as demandas. Confira a conexão e tente novamente.';
   toast.error(detail);
   if (cause instanceof TeamsApiError && [401,403,404].includes(cause.status)) {
    setStored(null); setEditor(null); setError(detail);
    throw new ExportHandledError();
   }
   throw new Error(detail);
  } finally {
   if (exportRequest.current === controller) {
    exportRequest.current = null;
    if (mounted.current) setExporting(false);
   }
  }
 }

 // Fixadas primeiro, na ordem em que foram fixadas; as demais seguem a ordem do servidor.
 const pinRank = (id: string) => { const at = pinnedTeamIds.indexOf(id); return at === -1 ? Number.MAX_SAFE_INTEGER : at; };
 const term = normalize(search), canManage = Boolean(data?.scope.canManage);
 const visible = (data?.teams.filter(team => (!mine || team.isMine) && matchesScope(team, teamScope, projectId, canManage)
  && [team.name, ...team.projects.map(project => project.name), ...team.units.map(unit => `${unit.name} ${unit.acronym}`)].some(label => normalize(label).includes(term))) ?? [])
  .map((team, order) => ({ team, order })).sort((a, b) => pinRank(a.team.id) - pinRank(b.team.id) || a.order - b.order).map(entry => entry.team);
 const hasTeamFilters = Boolean(mine || term || teamScope);
 const shownTeamId = selected && visible.some(team => team.id === selected.id) ? selected.id : '';
 useLayoutEffect(() => () => exportRequest.current?.abort(), [context, canQuery, status, shownTeamId]);
 useEffect(() => { onTeamShown?.(shownTeamId); }, [shownTeamId, onTeamShown]);
 useEffect(() => {
  if (loading || !shownTeamId || !focusNextTeam.current) return;
  const frame = requestAnimationFrame(() => { focusNextTeam.current = false; detailHeading.current?.focus({ preventScroll: true }); detailHeading.current?.scrollIntoView({ block: 'start', behavior: 'auto' }); });
  return () => cancelAnimationFrame(frame);
 }, [loading, shownTeamId, data]);
 return <section className={styles.workspace} aria-label="Equipes de trabalho">
  <div className={styles.intro}><h2><Users size={22} aria-hidden="true"/>Trabalho em equipe</h2><div className={styles.actions}>
   <button className="p-button" disabled={busy || exporting} onClick={() => { setEditor(null); setAttempt(value => value + 1); }}><RefreshCw size={17} aria-hidden="true"/>Atualizar</button>
   {(canEditTeams || data?.scope.canManage) && <button className="p-button p-button-primary" disabled={busy || exporting || loading} onClick={startNewTeam}><Plus size={17} aria-hidden="true"/>Nova equipe</button>}
  </div></div>
  <div className={styles.filters}>
   <label>Organização<select name="teamsOrganization" value={organizationId} disabled={busy || exporting} onChange={event => { const org = organizations.find(row => row.id === event.target.value); clearTeamFilters(); changeContext(event.target.value, org?.canManage ? '' : projects.find(project => project.organization_id === event.target.value)?.id ?? ''); }}>{!selectedOrganization && <option value={organizationId} disabled>Escolha uma organização disponível</option>}{organizations.map(org => <option value={org.id} key={org.id}>{org.name}</option>)}</select></label>
   <label>Onde acompanhar<select name="teamsProject" value={projectId} disabled={busy || exporting} onChange={event => followProject(event.target.value)}>{selectedOrganization?.canManage && <option value="">Organização inteira</option>}{!canQuery && <option value={projectId} disabled>Escolha um projeto permitido</option>}{ownProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
   <label>Atuação da equipe<select name="teamsScope" value={teamScope} disabled={!data || busy || exporting} onChange={event => setTeamScope(event.target.value as TeamFilter)}><option value="">Todas as equipes visíveis</option>{projectId && <option value="project">Com atuação neste projeto</option>}{canManage && <><option value="multi">Em vários projetos ativos</option><option value="unlinked">Sem atuação registrada em projetos</option></>}<option value="unit">Vinculadas a uma unidade</option></select></label>
   <label className={styles.search}>Buscar equipe<div><Search size={17} aria-hidden="true"/><input name="teamSearch" type="search" value={search} maxLength={100} placeholder="Equipe, projeto ou unidade" onChange={event => setSearch(event.target.value)}/></div></label>
  </div>
  <div className={styles.accessHelp}>
   <p className={styles.help}><ShieldCheck size={16} aria-hidden="true"/><span>Equipes como TI, Comunicação ou Eventos organizam quem faz o trabalho. Para ajustar permissões, fale com a gestão do projeto ou da organização.</span></p>
   {projectId && canOpenAccess?.(projectId) && <a className="p-button p-button-subtle" href={projectAccessHref(projectId)}>Pessoas e acessos<ArrowUpRight size={15} aria-hidden="true"/></a>}
  </div>
  <p role="status" className={styles.help} hidden={!pinMessage}>{pinMessage}</p>
  {error && <div role="alert" className="p-notice p-notice-error"><p>{error}</p><button className="p-button" onClick={() => { setTeamId(''); setOffset(0); setAttempt(value => value + 1); }}>Consultar novamente</button></div>}
  {!data && !error && <p role="status">{canQuery ? 'Consultando equipes e demandas…' : 'Escolha um projeto permitido para consultar as equipes.'}</p>}
  {loading && <p role="status" className={styles.help}>Atualizando o recorte. O resultado anterior permanece visível até a confirmação.</p>}
  {data && <>
   <div className={styles.viewBar}><span role="status">{quantity(visible.length,'equipe encontrada','equipes encontradas')}{hasTeamFilters && ` de ${data.teams.length}`}</span><div className={styles.actions}><button className="p-button" aria-pressed={mine} disabled={busy} onClick={() => setMine(value => !value)}><UserRoundCheck size={17} aria-hidden="true"/>Só minhas equipes</button>{hasTeamFilters && <button className="p-button p-button-subtle" disabled={busy} onClick={clearTeamFilters}><X size={16} aria-hidden="true"/>Limpar filtros de equipes</button>}</div></div>
   {data.teamsTruncated && <p role="status" className="p-notice">Mostrando as primeiras 200 equipes. O resumo e a busca se referem a esta lista.</p>}
   <div className={styles.teamGrid}>{visible.map(team => <button key={team.id} className={styles.teamCard} data-selected={data.selectedTeamId === team.id} aria-pressed={data.selectedTeamId === team.id} disabled={busy || exporting} onClick={() => chooseTeam(team.id)}>
    <span className={styles.cardTop}><span className={styles.mark}><Users size={20} aria-hidden="true"/></span><span>{pinnedTeamIds.includes(team.id) && <span className={styles.mine}><Pin size={12} aria-hidden="true"/> Fixada</span>}{team.isMine && <span className={styles.mine}>Minha equipe</span>}{team.status === 'archived' && <span className={styles.mine}>Arquivada</span>}</span><ArrowUpRight size={17} aria-hidden="true"/></span>
    <strong>{team.name}</strong><span className={styles.cardMeta}>{quantity(team.members.length,'integrante visível','integrantes visíveis')} · {quantity(team.counts.total,'demanda','demandas')}</span>
    {(canManage || team.units.length > 0 || team.projects.length > 0) && <span className={styles.teamScope}>{team.units.length > 0 && <span><Landmark size={14} aria-hidden="true"/>{team.units[0].acronym || team.units[0].name}{team.units.length > 1 && ` +${team.units.length - 1}`}</span>}{canManage ? <span><FolderKanban size={14} aria-hidden="true"/>{team.projects.length ? quantity(team.projects.length,'projeto registrado','projetos registrados') : 'Sem atuação em projetos'}</span> : team.projects.length > 0 && <span><FolderKanban size={14} aria-hidden="true"/>Atua neste projeto</span>}</span>}
    <span className={styles.meter} role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(1,team.counts.total)} aria-valuenow={team.counts.completed} aria-label="Demandas concluídas" aria-valuetext={team.counts.total ? `${team.counts.completed} de ${team.counts.total} demandas concluídas` : 'Sem demandas neste recorte'}><span style={{ width: `${team.counts.total ? team.counts.completed / team.counts.total * 100 : 0}%` }}/></span>
    <span className={styles.cardBottom}><span><CheckCircle2 size={14} aria-hidden="true"/>{quantity(team.counts.completed,'concluída','concluídas')}</span>{Boolean(team.counts.high || team.counts.overdue) && <span className={styles.attention}><Flag size={14} aria-hidden="true"/>{team.counts.overdue ? quantity(team.counts.overdue,'vencida','vencidas') : quantity(team.counts.high,'alta','altas')}</span>}</span>
   </button>)}</div>
   {!visible.length && <div className={styles.empty}><Users size={28} aria-hidden="true"/><h3>{data.teams.length ? 'Nenhuma equipe neste filtro' : 'Nenhuma equipe disponível neste recorte'}</h3><p>{data.teams.length ? 'Experimente mudar a busca ou limpar os filtros de equipes.' : data.scope.canManage ? 'Crie uma equipe e escolha os integrantes. Ela poderá receber demandas e responsabilidades nos projetos da organização.' : 'Aqui aparecem suas equipes e as que têm trabalho registrado no projeto que você acompanha.'}</p>{!data.teams.length && data.scope.canManage && <button className="p-button p-button-primary" disabled={busy || exporting || loading} onClick={startNewTeam}><Plus size={17} aria-hidden="true"/>Criar equipe</button>}</div>}
   {selected && shownTeamId && <section className={styles.detail} aria-busy={loading} aria-label={`Equipe ${selected.name}`}>
    <div className={styles.detailHeading}><div><span className={styles.eyebrow}>Equipe de trabalho</span><h3 ref={detailHeading} tabIndex={-1}>{selected.name}</h3><p><FolderKanban size={15} aria-hidden="true"/>{data.scope.projectName}</p></div><div className={styles.actions}>
     {onTogglePin && selected.status === 'active' && (selected.isMine || data.scope.canManage || pinnedTeamIds.includes(selected.id)) && <button className="p-button" onClick={() => void togglePin(selected)}>{pinnedTeamIds.includes(selected.id) ? <><PinOff size={16} aria-hidden="true"/>Desafixar</> : <><Pin size={16} aria-hidden="true"/>Fixar no menu</>}</button>}
     {canEditTeams ? <button className="p-button" disabled={busy || exporting || loading} onClick={() => setEditor(selected.id)}><Pencil size={16} aria-hidden="true"/>Editar equipe</button> : data.scope.canManage && <button className="p-button" disabled={busy || exporting} onClick={() => { changeContext(organizationId, ''); setTeamId(selected.id); setEditor(selected.id); }}><Pencil size={16} aria-hidden="true"/>Editar equipe na organização</button>}
    </div></div>
    <section className={styles.assignment} aria-label="Atuação registrada">
     <div><h4>Projetos com atuação registrada</h4><p>{canManage ? 'Demandas atribuídas e responsabilidades vigentes na organização.' : 'Demandas atribuídas e responsabilidades no projeto selecionado.'}</p></div>
     {selected.projects.length > 0 ? <ul>{selected.projects.map(project => <li key={project.id}><a className="p-text-link" href={projectHref(project.id)}>{project.name}<ArrowUpRight size={15} aria-hidden="true"/></a><small>{[project.hasDemands && 'Demandas', project.hasResponsibilities && 'Responsabilidades', projectStageLabels[project.stage]].filter(Boolean).join(' · ')}</small></li>)}</ul> : <p>{canManage ? 'Nenhuma atuação em projeto registrada para esta equipe.' : 'Nenhuma atuação registrada no projeto selecionado.'}</p>}
     {selected.units.length > 0 && <p><strong>Vínculos no organograma</strong> {selected.units.map(unit => `${unit.name}${unit.acronym ? ` (${unit.acronym})` : ''}`).join(' · ')}</p>}
     {data.scope.canManage && projectId && !selected.projects.some(project => project.id === projectId && project.hasResponsibilities) && <p>Para indicar uma equipe em <strong>Quem cuida de cada área</strong>, abra a <a className="p-text-link" href={projectHref(projectId)}>ficha deste projeto<ArrowUpRight size={15} aria-hidden="true"/></a>.</p>}
    </section>
    <div className={styles.detailGrid}>
     <section className={styles.chart} aria-label="Andamento das demandas da equipe"><h4>Andamento das demandas</h4><p>Clique em um estado para filtrar a lista.</p>
      {TASK_STATES.map(state => { const Icon = stateIcons[state], value = selected.counts[state]; return <button key={state} data-state={state} className={styles.chartRow} aria-pressed={status === state} disabled={busy || exporting} title={`${stateLabels[state]}: ${value} demandas em ${selected.counts.total}. Filtrar lista.`} onClick={() => { setStatus(status === state ? '' : state); setOffset(0); }}><span><Icon size={16} aria-hidden="true"/>{stateLabels[state]}</span><span className={styles.bar}><span style={{ width: `${selected.counts.total ? value / selected.counts.total * 100 : 0}%` }}/></span><strong>{value}</strong></button>; })}
      <p className={styles.chartFoot}>{selected.counts.overdue} com prazo vencido · {quantity(selected.counts.high,'pendente','pendentes')} de alta prioridade</p>
     </section>
     <section className={styles.members}><h4>Integrantes neste recorte</h4><p>Somente pessoas ativas com acesso ao contexto escolhido.</p><div>{selected.members.map(person => <span className={styles.person} key={person.userId}><span className={styles.avatar} aria-hidden="true">{initials(person.name)}</span><span>{person.name}{person.userId === userId && <small>Você</small>}</span></span>)}</div>{!selected.members.length && <p>Nenhum integrante visível neste contexto.</p>}</section>
    </div>
    {selected.status === 'active' && <TeamSheetsPanel key={`${userId}:${selected.id}:${projectId}`} userId={userId} teamId={selected.id} projectId={projectId}/>}
    <div className={styles.taskHeading}><div><h4>Demandas da equipe</h4><p>{displayedStatus ? stateLabels[displayedStatus] + ' · ' : ''}{data.tasks.length} nesta página{data.hasMore ? ' · há mais resultados' : ''}</p></div><ExportFormats label="Exportar demandas da equipe" announce={false} disabled={exporting || busy || loading} onExport={exportTeam}/></div>
    {exporting && <p role="status">Preparando o arquivo com uma consulta atualizada…</p>}
    {status && <button className="p-button" onClick={() => { setStatus(''); setOffset(0); }}><X size={16} aria-hidden="true"/>Mostrar todos os estados</button>}
    <div className={styles.tasks}>{data.tasks.map(task => <WorkTaskCard key={task.id} task={task} today={data.today} disabled={busy || exporting || loading} onOpen={() => onOpenDemand(task.id, task.project_id)}/>)}</div>
    {!data.tasks.length && <p className={styles.emptyTasks}>Nenhuma demanda atribuída à equipe neste recorte.</p>}
    {(displayedOffset > 0 || data.hasMore) && <nav className={styles.pagination} aria-label="Páginas das demandas"><button className="p-button" disabled={!displayedOffset || busy || exporting} onClick={() => { if (!loading) setOffset(Math.max(0, offset - TEAM_TASK_PAGE_SIZE)); }}>Página anterior</button><span>Página {Math.floor(displayedOffset / TEAM_TASK_PAGE_SIZE) + 1}</span><button className="p-button" disabled={!data.hasMore || busy || exporting} onClick={() => { if (!loading) setOffset(data.nextOffset ?? offset); }}>Próxima página</button></nav>}
    <p className={styles.help}>Os totais incluem todas as demandas autorizadas deste recorte. Uma demanda atribuída a várias equipes pode aparecer em cada uma.</p>
   </section>}
   {editor && canEditTeams && (editor === 'new' || editorTeam) && <section className={styles.editor} aria-label={editor === 'new' ? 'Nova equipe' : 'Editar equipe'}><div className={styles.detailHeading}><h3>{editor === 'new' ? 'Nova equipe' : `Editar ${editorTeam!.name}`}</h3><button className="p-button" disabled={busy} onClick={() => setEditor(null)}><X size={17} aria-hidden="true"/>Fechar</button></div><TeamForm key={`${organizationId}:${editor}:${editorTeam?.version ?? 0}`} organizationId={organizationId} team={editorTeam} people={data.people} busy={busy} onSave={save}/></section>}
   <p className={styles.updated}>Consulta de {new Date(data.asOf).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })} (Brasília)</p>
  </>}
  {canQuery&&<TeamTemplates key={organizationId} organizationId={organizationId} selectedTeamId={shownTeamId || undefined} onApplied={created => { clearTeamFilters(); if (projectId) changeContext(organizationId, ''); setTeamId(created); focusNextTeam.current = true; setAttempt(value => value + 1); }}/>}
  {canQuery&&<InstitutionalStructurePanel userId={userId} organizationId={organizationId} projectId={projectId||null} onSelectTeam={id => { clearTeamFilters(); chooseTeam(id); }}/>}
 </section>;
}
