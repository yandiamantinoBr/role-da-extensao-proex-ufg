'use client';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Bell, CalendarDays, Check, ClipboardCheck, Copy, Link2, LoaderCircle, Mail, MapPin, MessageCircle, Plus, Search, Trash2, Users, X } from 'lucide-react';
import ExportFormats from './export-formats';
import DateTimeField from './date-time-field';
import DateField from './date-field';
import styles from './convocations.module.css';

type Counts = { yes: number; maybe: number; no: number };
type Summary = { id: string; title: string; edition: string; location: string; eventDate: string; responseDeadline: string | null; status: string; projectName: string; purged: boolean; retentionExpired?: boolean; scope: 'full' | 'projects'; counts: Counts; silentProjects: number };
type Prefs = Record<'digest' | 'reminder' | 'response', Record<'bell' | 'email' | 'whatsapp', boolean>>;
type Channels = Record<'bell' | 'email' | 'whatsapp', { enabled: boolean; label: string; requires?: string }>;
type Detail = {
  convocation: { id: string; title: string; edition: string; location: string; eventDate: string; responseDeadline: string | null; description: string; purposeNotice: string; retentionDays: number; retentionEndsOn: string | null; retentionExpired: boolean; status: string; version: number; projectId: string; purgedAt: string | null };
  scope: 'full' | 'projects'; permissions: { canManage: boolean };
  shifts: { id: string; label: string; startsAt: string; endsAt: string }[];
  projects: { id: string; name: string; yes: number; maybe: number; no: number; answered: boolean }[];
  guests: { id: string; name: string; enrollment: string; projectId: string; projectName: string; response: 'yes' | 'no' | 'maybe'; updatedAt: string; shiftIds: string[] }[];
  invites: { id: string; label: string; expiresAt: string; maxUses: number; useCount: number; revokedAt: string | null; createdAt: string }[];
  responsibles: { userId: string; name: string }[]; candidates: { userId: string; name: string }[]; projectChoices: { id: string; name: string }[];
  events: { sequence: number; kind: string; projectId: string | null; createdAt: string; actorName: string }[];
};
type ProjectOption = { id: string; name: string; canManage: boolean };
const ANSWER: Record<string, string> = { yes: 'Vai', maybe: 'Talvez', no: 'Não vai' };
const EVENT: Record<string, string> = { created: 'Convocação criada', updated: 'Convocação editada', closed: 'Respostas encerradas', reopened: 'Respostas reabertas', invite_created: 'Link de convite gerado', invite_revoked: 'Link de convite encerrado', response_created: 'Nova resposta', response_updated: 'Resposta alterada', response_deleted: 'Resposta apagada pela pessoa', purged: 'Dados dos convidados apagados' };
const NOTICES: [keyof Prefs, string, string][] = [['digest', 'Resumo do dia', 'Quem ainda não respondeu, uma vez por dia.'], ['reminder', 'Lembrete do prazo', 'Quando faltar menos de um dia para o prazo.'], ['response', 'Cada resposta recebida', 'Avisa a cada confirmação nova.']];
const dateLabel = (value: string) => new Date(`${value}T12:00:00-03:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' });
const when = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
/** "até qua., 11/11, às 17:00" */
const deadlineLabel = (value: string) => { const d = new Date(value), part = (options: Intl.DateTimeFormatOptions) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...options }); return `até ${part({ weekday: 'short' })} ${part({ day: '2-digit', month: '2-digit' })}, às ${part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`; };
const localInput = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso), pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
async function api(body?: Record<string, unknown>, query = '') {
  const response = await fetch(`/api/convocations${query}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  let data: Record<string, unknown> = {}; try { data = await response.json() as Record<string, unknown>; } catch { /* plataforma */ }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Não foi possível concluir. Tente de novo.');
  return data;
}
function Tally({ counts, silent }: { counts: Counts; silent?: number }) {
  return <span className={styles.tally}><span className={styles.yes}>{counts.yes} vão</span><span className={styles.maybe}>{counts.maybe} talvez</span><span className={styles.no}>{counts.no} não</span>{silent !== undefined && silent > 0 && <span className={styles.silent}>{silent} {silent === 1 ? 'projeto sem resposta' : 'projetos sem resposta'}</span>}</span>;
}

export default function ConvocationsPanel({ projects, initialId = '' }: { projects: ProjectOption[]; initialId?: string }) {
  const [list, setList] = useState<{ convocations: Summary[]; canCreate: boolean; preferences: Prefs; channels: Channels } | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialId || null), [creating, setCreating] = useState(false), [error, setError] = useState('');
  const reload = useCallback(async () => { const data = await api(); setList(data as unknown as typeof list & object); }, []);
  useEffect(() => {
    const start = window.setTimeout(() => {
      void reload().catch(failure => setError(failure instanceof Error ? failure.message : 'Não foi possível carregar.'));
    }, 0);
    return () => window.clearTimeout(start);
  }, [reload]);
  const manageable = projects.filter(project => project.canManage);
  if (openId) return <ConvocationDetail key={openId} id={openId} preferences={list?.preferences} channels={list?.channels} onBack={() => { setOpenId(null); void reload().catch(() => undefined); }} onPreferences={preferences => setList(current => current ? { ...current, preferences } : current)}/>;
  return <div className={styles.panel}>
    <div className={styles.toolbar}><p className={styles.lead}>Convide bolsistas e equipes dos projetos para uma ação e acompanhe quem confirmou. As pessoas respondem por um link, sem conta no portal, e veem só a própria resposta.</p>
      {manageable.length > 0 && !creating && <button type="button" className="p-button p-button-primary" onClick={() => setCreating(true)}><Plus size={17} aria-hidden="true"/>Nova convocação</button>}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {creating && <CreateForm projects={manageable} allProjects={projects} onCancel={() => setCreating(false)} onCreated={id => { setCreating(false); setOpenId(id); }}/>}
    {!list ? <p className={styles.loading}><LoaderCircle className="p-spin" size={18}/>Carregando convocações…</p>
      : list.convocations.length ? <ul className={styles.cards}>{list.convocations.map(item => <li key={item.id}><button type="button" className={styles.card} onClick={() => setOpenId(item.id)}>
        <span className={styles.cardHead}><strong>{item.title}</strong><span className={item.status === 'open' ? styles.chipOpen : styles.chipClosed}>{item.purged ? 'Dados apagados' : item.status === 'open' ? 'Recebendo respostas' : 'Encerrada'}</span></span>
        {item.edition && <span className={styles.cardEdition}>{item.edition}</span>}
        <span className={styles.cardMeta}><span><CalendarDays size={14} aria-hidden="true"/>{dateLabel(item.eventDate)}</span>{item.location && <span><MapPin size={14} aria-hidden="true"/>{item.location}</span>}<span><Users size={14} aria-hidden="true"/>{item.scope === 'projects' ? 'Seus projetos' : item.projectName}</span></span>
        <Tally counts={item.counts} silent={item.silentProjects}/>
        {item.retentionExpired && <span className={styles.silent}>Prazo de guarda vencido: apague os dados</span>}
      </button></li>)}</ul>
      : <div className={styles.empty}><ClipboardCheck size={30} aria-hidden="true"/><strong>Nenhuma convocação ainda</strong><span>{manageable.length ? 'Crie a primeira para gerar o link de confirmação de presença.' : 'Quando você for convidado(a) a acompanhar uma convocação, ela aparece aqui.'}</span></div>}
  </div>;
}

function ShiftRows({ initial }: { initial: { id?: string; label: string; startsAt: string; endsAt: string }[] }) {
  const [rows, setRows] = useState(initial.length ? initial.map((row, index) => ({ ...row, key: row.id ?? `n${index}` })) : [{ key: 'n0', label: 'Manhã', startsAt: '08:00', endsAt: '12:00' }]);
  return <div className={styles.shiftRows}>{rows.map((row, index) => <div key={row.key} className={styles.shiftRow}>
    {row.id && <input type="hidden" name={`shiftId${index}`} value={row.id}/>}
    <label className="p-field"><span>Turno</span><input name={`shiftLabel${index}`} required maxLength={80} defaultValue={row.label}/></label>
    <label className="p-field"><span>Início (24 h)</span><input name={`shiftStart${index}`} type="text" inputMode="numeric" placeholder="hh:mm" maxLength={5} pattern="([01][0-9]|2[0-3]):[0-5][0-9]" required defaultValue={row.startsAt}/></label>
    <label className="p-field"><span>Fim (24 h)</span><input name={`shiftEnd${index}`} type="text" inputMode="numeric" placeholder="hh:mm" maxLength={5} pattern="([01][0-9]|2[0-3]):[0-5][0-9]" required defaultValue={row.endsAt}/></label>
    <button type="button" className="p-icon-button" aria-label={`Remover turno ${index + 1}`} disabled={rows.length === 1} onClick={() => setRows(current => current.filter(entry => entry.key !== row.key))}><X size={16}/></button>
  </div>)}<input type="hidden" name="shiftCount" value={rows.length}/>
    {rows.length < 12 && <button type="button" className="p-button p-button-subtle" onClick={() => setRows(current => [...current, { key: `n${Date.now()}`, label: '', startsAt: '13:00', endsAt: '17:00' }])}><Plus size={15} aria-hidden="true"/>Adicionar turno</button>}</div>;
}
function shiftsFrom(form: FormData) { return Array.from({ length: Number(form.get('shiftCount') ?? 0) }, (_, index) => ({ ...(form.get(`shiftId${index}`) ? { id: form.get(`shiftId${index}`) } : {}), label: form.get(`shiftLabel${index}`), startsAt: form.get(`shiftStart${index}`), endsAt: form.get(`shiftEnd${index}`) })); }
function ProjectPicker({ options, selected, name = 'projectIds' }: { options: { id: string; name: string }[]; selected: string[]; name?: string }) {
  const [query, setQuery] = useState(''), [chosen, setChosen] = useState(new Set(selected));
  const shown = options.filter(option => !query || option.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  return <fieldset className={styles.picker}><legend>Projetos convidados <small>{chosen.size} {chosen.size === 1 ? 'escolhido' : 'escolhidos'}</small></legend>
    <label className={styles.pickerSearch}><Search size={15} aria-hidden="true"/><input type="search" aria-label="Buscar projeto" placeholder="Buscar projeto" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div className={styles.pickerList}>{shown.map(option => <label key={option.id}><input type="checkbox" name={name} value={option.id} checked={chosen.has(option.id)} onChange={event => setChosen(current => { const next = new Set(current); if (event.target.checked) next.add(option.id); else next.delete(option.id); return next; })}/><span>{option.name}</span></label>)}</div></fieldset>;
}
function CreateForm({ projects, allProjects, onCancel, onCreated }: { projects: ProjectOption[]; allProjects: ProjectOption[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [key] = useState(() => crypto.randomUUID());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget), deadline = String(form.get('responseDeadline') ?? '');
    setBusy(true); setError('');
    try {
      const data = await api({ action: 'convocation.create', operationKey: key, projectId: form.get('projectId'), title: form.get('title'), edition: form.get('edition'), location: form.get('location'), eventDate: form.get('eventDate'), responseDeadline: deadline ? new Date(deadline).toISOString() : null, description: form.get('description'), purposeNotice: form.get('purposeNotice'), retentionDays: Number(form.get('retentionDays')), shifts: shiftsFrom(form), projectIds: form.getAll('projectIds') });
      onCreated(String((data.convocation as { id: string }).id));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível criar.'); }
    finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit}><fieldset disabled={busy}>
    <h3>Nova convocação</h3>
    <div className={styles.grid2}>
      <label className="p-field"><span>Projeto que organiza</span><select name="projectId" required defaultValue={projects[0]?.id}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className="p-field"><span>Nome da ação</span><input name="title" required minLength={3} maxLength={160} placeholder="Ex.: UFG nos Parques"/></label>
      <label className="p-field"><span>Edição ou local de referência</span><input name="edition" maxLength={120} placeholder="Ex.: Parque Vaca Brava"/></label>
      <label className="p-field"><span>Endereço ou ponto de encontro</span><input name="location" maxLength={200}/></label>
      <label className="p-field"><span>Data da ação</span><DateField aria-label="Data da ação" name="eventDate" required/></label>
      <label className="p-field"><span>Prazo para responder (opcional, usado no lembrete)</span><DateTimeField aria-label="Prazo para responder" name="responseDeadline"/></label>
    </div>
    <ShiftRows initial={[]}/>
    <ProjectPicker options={allProjects} selected={projects[0] ? [projects[0].id] : []}/>
    <label className="p-field"><span>Recado para quem vai responder</span><textarea name="description" rows={3} maxLength={2000} placeholder="Ex.: Use a camiseta do projeto e chegue 15 minutos antes."/></label>
    <details className={styles.privacy}><summary>Aviso de uso dos dados (LGPD)</summary>
      <label className="p-field"><span>Finalidade mostrada à pessoa</span><textarea name="purposeNotice" rows={3} required minLength={10} maxLength={1000} defaultValue="Seus dados são usados só para organizar a presença nesta ação de extensão (escala, contato da coordenação e comprovação de participação). Apenas a coordenação da convocação e os gestores do seu projeto veem a sua resposta."/></label>
      <label className="p-field"><span>Guardar as respostas por</span><select name="retentionDays" defaultValue="180"><option value="30">30 dias</option><option value="90">90 dias</option><option value="180">180 dias</option><option value="365">1 ano</option></select><small>Depois do prazo, apague os dados em Configurar.</small></label>
    </details>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.actions}><button type="submit" className="p-button p-button-primary">{busy ? <LoaderCircle className="p-spin" size={16}/> : <Check size={16} aria-hidden="true"/>}Criar convocação</button><button type="button" className="p-button p-button-subtle" onClick={onCancel}>Cancelar</button></div>
  </fieldset></form>;
}

type Tab = 'projects' | 'people' | 'shifts' | 'invites' | 'settings' | 'notices';
function ConvocationDetail({ id, preferences, channels, onBack, onPreferences }: { id: string; preferences?: Prefs; channels?: Channels; onBack: () => void; onPreferences: (prefs: Prefs) => void }) {
  const [data, setData] = useState<Detail | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [tab, setTab] = useState<Tab>('projects'), [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'yes' | 'maybe' | 'no'>('all'), [query, setQuery] = useState(''), [newLink, setNewLink] = useState<string | null>(null), [copied, setCopied] = useState(false), [confirmPurge, setConfirmPurge] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const reload = useCallback(async () => { setData(await api(undefined, `?id=${encodeURIComponent(id)}`) as unknown as Detail); setLoadedAt(Date.now()); }, [id]);
  useEffect(() => { const start = window.setTimeout(() => { void reload().then(() => api({ action: 'convocation.seen', convocationId: id, operationKey: crypto.randomUUID() })).then(() => window.dispatchEvent(new Event('proex:convocations-changed'))).catch(failure => setError(failure instanceof Error ? failure.message : 'Não foi possível abrir.')); }, 0); return () => window.clearTimeout(start); }, [id, reload]);
  async function act(body: Record<string, unknown>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try { const result = await api({ operationKey: crypto.randomUUID(), ...body }); await reload(); setNotice(message); return result; }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.'); return null; }
    finally { setBusy(false); }
  }
  const counts = useMemo(() => ({ yes: data?.guests.filter(g => g.response === 'yes').length ?? 0, maybe: data?.guests.filter(g => g.response === 'maybe').length ?? 0, no: data?.guests.filter(g => g.response === 'no').length ?? 0 }), [data]);
  if (!data) return <div className={styles.panel}><button type="button" className="p-button p-button-subtle" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/>Convocações</button>{error ? <p className={styles.error} role="alert">{error}</p> : <p className={styles.loading}><LoaderCircle className="p-spin" size={18}/>Abrindo…</p>}</div>;
  const c = data.convocation, manage = data.permissions.canManage, silent = data.projects.filter(project => !project.answered);
  const shiftName = (ids: string[]) => data.shifts.filter(shift => ids.includes(shift.id)).map(shift => shift.label).join(', ');
  const repeated = new Set(data.guests.map(guest => guest.enrollment).filter((value, index, all) => all.indexOf(value) !== index));
  const people = data.guests.filter(guest => (filter === 'all' || guest.response === filter) && (!query || `${guest.name} ${guest.enrollment} ${guest.projectName}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))));
  const tabs: [Tab, string][] = [['projects', 'Por projeto'], ['people', 'Por pessoa'], ['shifts', 'Por turno'], ...(manage ? [['invites', 'Links de convite'], ['settings', 'Configurar']] as [Tab, string][] : []), ['notices', 'Meus avisos']];
  async function exportPeople(format: 'xlsx' | 'docx' | 'pdf') {
    const { documentExport } = await import('./document-export'), { download } = await import('./report-export');
    const rows = data!.guests.map(guest => ({ nome: guest.name, matricula: guest.enrollment, projeto: guest.projectName, resposta: ANSWER[guest.response], turnos: shiftName(guest.shiftIds), atualizado: when(guest.updatedAt) }));
    download(`convocacao-${c.eventDate}.${format}`, await documentExport(format, `${c.title}${c.edition ? ` · ${c.edition}` : ''}`, [{ key: 'nome', label: 'Nome' }, { key: 'matricula', label: 'Matrícula' }, { key: 'projeto', label: 'Projeto' }, { key: 'resposta', label: 'Resposta' }, { key: 'turnos', label: 'Turnos' }, { key: 'atualizado', label: 'Atualizado' }], rows, (row, key) => row[key] ?? '',
      [['Data', dateLabel(c.eventDate)], ['Local', c.location || '—'], ['Vão', String(counts.yes)], ['Talvez', String(counts.maybe)], ['Não vão', String(counts.no)], ['Projetos sem resposta', silent.map(project => project.name).join(', ') || 'nenhum'], ['Recorte', data!.scope === 'projects' ? 'somente os seus projetos' : 'toda a convocação']]));
  }
  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const result = await act({ action: 'convocation.invite.create', convocationId: c.id, label: form.get('label'), maxUses: Number(form.get('maxUses')), expiresAt: new Date(Date.now() + Number(form.get('days')) * 86_400_000).toISOString() }, 'Link criado. Copie e envie agora: ele só aparece uma vez.');
    if (result?.path) { setNewLink(`${window.location.origin}${String(result.path)}`); setCopied(false); (event.target as HTMLFormElement).reset(); }
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget), deadline = String(form.get('responseDeadline') ?? '');
    await act({ action: 'convocation.update', id: c.id, expectedVersion: c.version, title: form.get('title'), edition: form.get('edition'), location: form.get('location'), eventDate: form.get('eventDate'), responseDeadline: deadline ? new Date(deadline).toISOString() : null, description: form.get('description'), purposeNotice: form.get('purposeNotice'), shifts: shiftsFrom(form), projectIds: form.getAll('projectIds'), responsibleIds: form.getAll('responsibleIds') }, 'Convocação atualizada.');
  }
  async function togglePref(kind: keyof Prefs, channel: 'bell' | 'email', enabled: boolean) {
    try { const result = await api({ action: 'convocation.preference', kind, channel, enabled, operationKey: crypto.randomUUID() }); onPreferences(result.preferences as Prefs); window.dispatchEvent(new Event('proex:convocations-changed')); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); }
  }
  return <div className={styles.panel}>
    <button type="button" className="p-button p-button-subtle" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/>Convocações</button>
    <header className={styles.detailHead}>
      <div><span className={c.status === 'open' ? styles.chipOpen : styles.chipClosed}>{c.purgedAt ? 'Dados apagados' : c.status === 'open' ? 'Recebendo respostas' : 'Encerrada'}</span><h2>{c.title}</h2>{c.edition && <p className={styles.cardEdition}>{c.edition}</p>}
        <p className={styles.cardMeta}><span><CalendarDays size={14} aria-hidden="true"/>{dateLabel(c.eventDate)}</span>{c.location && <span><MapPin size={14} aria-hidden="true"/>{c.location}</span>}{c.responseDeadline && <span>Respostas {deadlineLabel(c.responseDeadline)}</span>}</p></div>
      {data.scope === 'projects' && <p className={styles.scopeNote}>Você vê só as respostas dos projetos que acompanha.</p>}
    </header>
    <dl className={styles.kpis}><div><dt>Vão</dt><dd className={styles.yes}>{counts.yes}</dd></div><div><dt>Talvez</dt><dd className={styles.maybe}>{counts.maybe}</dd></div><div><dt>Não vão</dt><dd className={styles.no}>{counts.no}</dd></div><div title="Projetos convidados que ainda não responderam"><dt>Sem resposta</dt><dd className={silent.length ? styles.silentNumber : ''}>{silent.length}</dd></div></dl>
    {c.retentionExpired && !c.purgedAt && <p className={styles.error} role="status">O prazo de guarda terminou em {c.retentionEndsOn?.split('-').reverse().join('/')}. Os links pessoais já não funcionam. {manage ? 'Apague os dados dos convidados em Configurar.' : 'Peça à coordenação para apagar os dados.'}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    <label className={styles.sectionSelect}><span>Ver</span><select name="convocationSection" value={tab} onChange={event => setTab(event.target.value as Tab)}>{tabs.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <nav className={styles.tabs} aria-label="Partes da convocação">{tabs.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={event => { setTab(key); event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center' }); }}>{label}</button>)}</nav>
    {tab === 'projects' && <section aria-label="Respostas por projeto"><ul className={styles.rows}>{data.projects.map(project => <li key={project.id}><span className={styles.rowMain}><strong>{project.name}</strong>{project.answered ? <Tally counts={project}/> : <span className={styles.silent}>Não respondeu</span>}</span></li>)}</ul></section>}
    {tab === 'people' && <section aria-label="Respostas por pessoa">
      <div className={styles.peopleBar}><div className={styles.filters} role="group" aria-label="Filtrar por resposta">{(['all', 'yes', 'maybe', 'no'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? `Todas (${data.guests.length})` : `${ANSWER[value]} (${counts[value]})`}</button>)}</div>
        <label className={styles.pickerSearch}><Search size={15} aria-hidden="true"/><input type="search" name="convocationPeopleSearch" aria-label="Buscar pessoa" placeholder="Buscar nome, matrícula ou projeto" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
      {people.length ? <div className="p-table-wrap"><table className={styles.table}><thead><tr><th scope="col">Pessoa</th><th scope="col">Projeto</th><th scope="col">Resposta</th><th scope="col">Turnos</th><th scope="col">Atualizado</th></tr></thead><tbody>{people.map(guest => <tr key={guest.id}><td data-label="Pessoa"><span><strong>{guest.name}</strong><small>Matrícula {guest.enrollment}{repeated.has(guest.enrollment) ? ' · respondeu mais de uma vez' : ''}</small></span></td><td data-label="Projeto">{guest.projectName}</td><td data-label="Resposta"><span><span className={styles[`answer_${guest.response}`]}>{ANSWER[guest.response]}</span></span></td><td data-label="Turnos">{shiftName(guest.shiftIds) || '—'}</td><td data-label="Atualizado">{when(guest.updatedAt)}</td></tr>)}</tbody></table></div>
        : <p className={styles.emptyLine}>{data.guests.length ? 'Ninguém neste filtro.' : 'Ainda não chegaram respostas.'}</p>}
      {people.length > 0 && <ul className={styles.personCards}>{people.map(guest => <li key={guest.id}><span className={styles.personTop}><strong>{guest.name}</strong><span className={styles[`answer_${guest.response}`]}>{ANSWER[guest.response]}</span></span><small>Matrícula {guest.enrollment} · {guest.projectName}</small>{repeated.has(guest.enrollment) && <small className={styles.repeat}>Esta matrícula respondeu mais de uma vez</small>}<small>{guest.response === 'no' ? 'Sem turno' : shiftName(guest.shiftIds) || 'Sem turno'} · atualizado {when(guest.updatedAt)}</small></li>)}</ul>}
      {data.guests.length > 0 && <div className={styles.export}><ExportFormats label="Baixar lista de presença" showLabel onExport={exportPeople}/></div>}
    </section>}
    {tab === 'shifts' && <section aria-label="Respostas por turno"><ul className={styles.rows}>{data.shifts.map(shift => { const going = data.guests.filter(guest => guest.shiftIds.includes(shift.id)); return <li key={shift.id}><span className={styles.rowMain}><strong>{shift.label}</strong><small>{shift.startsAt} às {shift.endsAt}</small></span><span className={styles.tally}><span className={styles.yes}>{going.filter(g => g.response === 'yes').length} vão</span><span className={styles.maybe}>{going.filter(g => g.response === 'maybe').length} talvez</span></span></li>; })}</ul></section>}
    {tab === 'invites' && manage && <section aria-label="Links de convite">
      {newLink && <div className={styles.newLink} role="status"><strong><Link2 size={16} aria-hidden="true"/>Novo link de convite</strong><span>Envie pelo canal do projeto (e-mail, grupo, mural). Ele só aparece agora.</span><div className={styles.linkRow}><input readOnly name="newInviteLink" aria-label="Link de convite" value={newLink} onFocus={event => event.currentTarget.select()}/><button type="button" className="p-button p-button-primary" onClick={() => void navigator.clipboard.writeText(newLink).then(() => setCopied(true)).catch(() => setCopied(false))}><Copy size={16} aria-hidden="true"/>{copied ? 'Copiado' : 'Copiar link'}</button></div></div>}
      {c.status === 'open' && !c.purgedAt ? <form className={styles.inlineForm} onSubmit={createInvite}><fieldset disabled={busy}><label className="p-field"><span>Nome do link</span><input name="label" maxLength={80} placeholder="Ex.: Bolsistas da Engenharia"/></label><label className="p-field"><span>Vale por</span><select name="days" defaultValue="14"><option value="2">2 dias</option><option value="7">7 dias</option><option value="14">14 dias</option><option value="30">30 dias</option><option value="60">60 dias</option></select></label><label className="p-field"><span>Limite de respostas</span><input name="maxUses" type="number" min={1} max={2000} defaultValue={100} required/></label><button type="submit" className="p-button p-button-primary"><Link2 size={16} aria-hidden="true"/>Gerar link</button></fieldset></form>
        : <p className={styles.emptyLine}>Reabra a convocação para gerar novos links.</p>}
      {data.invites.length > 0 && <p className={styles.hintLine}>Por segurança, o endereço de um link só aparece quando ele é criado. Para mandar de novo, gere um novo link.</p>}
      <ul className={styles.rows}>{data.invites.map(invite => { const live = !invite.revokedAt && Date.parse(invite.expiresAt) > loadedAt && invite.useCount < invite.maxUses; return <li key={invite.id}><span className={styles.rowMain}><strong>{invite.label || 'Link de convite'}</strong><small>{invite.useCount} de {invite.maxUses} respostas · {invite.revokedAt ? `encerrado em ${when(invite.revokedAt)}` : `vale até ${when(invite.expiresAt)}`}</small></span>{live ? <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => void act({ action: 'convocation.invite.revoke', inviteId: invite.id }, 'Link encerrado. Quem já respondeu continua com a própria resposta.')}>Encerrar link</button> : <span className={styles.chipClosed}>Inativo</span>}</li>; })}</ul>
    </section>}
    {tab === 'settings' && manage && <section aria-label="Configurar convocação">
      {!c.purgedAt && <form key={c.version} className={styles.form} onSubmit={saveSettings}><fieldset disabled={busy}>
        <div className={styles.grid2}>
          <label className="p-field"><span>Nome da ação</span><input name="title" required minLength={3} maxLength={160} defaultValue={c.title}/></label>
          <label className="p-field"><span>Edição ou local de referência</span><input name="edition" maxLength={120} defaultValue={c.edition}/></label>
          <label className="p-field"><span>Endereço ou ponto de encontro</span><input name="location" maxLength={200} defaultValue={c.location}/></label>
          <label className="p-field"><span>Data da ação</span><DateField aria-label="Data da ação" name="eventDate" required defaultValue={c.eventDate}/></label>
          <label className="p-field"><span>Prazo para responder</span><DateTimeField aria-label="Prazo para responder" name="responseDeadline" defaultValue={localInput(c.responseDeadline)}/></label>
        </div>
        <ShiftRows initial={data.shifts}/>
        <ProjectPicker options={data.projectChoices} selected={data.projects.map(project => project.id)}/>
        <fieldset className={styles.picker}><legend>Responsáveis pela convocação</legend><div className={styles.pickerList}>{data.candidates.map(person => <label key={person.userId}><input type="checkbox" name="responsibleIds" value={person.userId} defaultChecked={data.responsibles.some(entry => entry.userId === person.userId)}/><span>{person.name}</span></label>)}</div><small>Recebem os avisos de toda a convocação. Gestores dos projetos convidados recebem os do próprio projeto.</small></fieldset>
        <label className="p-field"><span>Recado para quem vai responder</span><textarea name="description" rows={3} maxLength={2000} defaultValue={c.description}/></label>
        <label className="p-field"><span>Aviso de uso dos dados</span><textarea name="purposeNotice" rows={3} required minLength={10} maxLength={1000} defaultValue={c.purposeNotice}/></label>
        <div className={styles.actions}><button type="submit" className="p-button p-button-primary"><Check size={16} aria-hidden="true"/>Salvar</button></div>
      </fieldset></form>}
      <div className={styles.danger}>
        {!c.purgedAt && <p><strong>{c.status === 'open' ? 'Encerrar respostas' : 'Reabrir respostas'}</strong><span>{c.status === 'open' ? 'Ninguém mais responde nem altera. Os links param de funcionar.' : 'Os links ainda válidos voltam a aceitar respostas.'}</span><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => void act({ action: 'convocation.update', id: c.id, expectedVersion: c.version, status: c.status === 'open' ? 'closed' : 'open' }, c.status === 'open' ? 'Respostas encerradas.' : 'Respostas reabertas.')}>{c.status === 'open' ? 'Encerrar' : 'Reabrir'}</button></p>}
        {!c.purgedAt && <p><strong>Apagar os dados dos convidados</strong><span>Remove nome, matrícula e respostas de todos. Fica só o histórico com números. Faça isso ao fim do prazo de guarda, em {c.retentionEndsOn?.split('-').reverse().join('/')} ({c.retentionDays} dias após a ação); nessa data os links pessoais deixam de funcionar.</span>{confirmPurge ? <span className={styles.actions}><button type="button" className="p-button p-button-danger" disabled={busy} onClick={() => void act({ action: 'convocation.purge', id: c.id, expectedVersion: c.version, confirmed: true }, 'Dados dos convidados apagados.').then(() => setConfirmPurge(false))}><Trash2 size={16} aria-hidden="true"/>Apagar definitivamente</button><button type="button" className="p-button p-button-subtle" onClick={() => setConfirmPurge(false)}>Cancelar</button></span> : <button type="button" className="p-button p-button-subtle" onClick={() => setConfirmPurge(true)}><Trash2 size={16} aria-hidden="true"/>Apagar dados</button>}</p>}
        {c.purgedAt && <p><strong>Dados apagados</strong><span>Em {when(c.purgedAt)}. A convocação fica só com o histórico.</span></p>}
      </div>
    </section>}
    {tab === 'notices' && <section aria-label="Meus avisos" className={styles.notices}>
      <p className={styles.lead}>Escolha como quer saber das convocações que acompanha. O e-mail usa o consentimento de avisos da organização (Configurações).</p>
      <div className="p-table-wrap"><table className={styles.prefTable}><thead><tr><th scope="col">Aviso</th><th scope="col"><Bell size={14} aria-hidden="true"/> Sino</th><th scope="col"><Mail size={14} aria-hidden="true"/> E-mail</th><th scope="col"><MessageCircle size={14} aria-hidden="true"/> WhatsApp (em breve)</th></tr></thead><tbody>{NOTICES.map(([kind, label, hint]) => <tr key={kind}><th scope="row"><strong>{label}</strong><small>{hint}</small></th>
        {(['bell', 'email'] as const).map(channel => <td key={channel} data-label={channel === 'bell' ? 'Sino' : 'E-mail'}><label className={styles.switch}><input type="checkbox" name={`pref-${kind}-${channel}`} checked={preferences?.[kind][channel] ?? false} onChange={event => void togglePref(kind, channel, event.target.checked)}/><span>{preferences?.[kind][channel] ? 'Ligado' : 'Desligado'}</span></label></td>)}
        <td data-label="WhatsApp"><span className={styles.soon} aria-disabled="true">Em breve</span></td></tr>)}</tbody></table></div>
      {channels && <p className={styles.channelNote}>WhatsApp: {channels.whatsapp.requires}.</p>}
    </section>}
    {data.events.length > 0 && <details className={styles.history}><summary>Histórico da convocação</summary><ol>{data.events.map(entry => <li key={entry.sequence}><strong>{EVENT[entry.kind] ?? entry.kind}</strong><small>{entry.actorName} · {when(entry.createdAt)}</small></li>)}</ol></details>}
  </div>;
}
