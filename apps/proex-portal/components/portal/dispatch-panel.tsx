'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, CalendarClock, FileSignature, Inbox, Lock, Plus, RefreshCw, UserRoundCheck, X } from 'lucide-react';
import DateField from './date-field';
import styles from './dispatch-panel.module.css';
import { loadDispatchDetail, loadDispatchWorkspace, saveDispatch, type DispatchDetail, type DispatchKind, type DispatchStatus, type DispatchTask, type DispatchUrgency, type DispatchWorkspace } from './dispatch-api';

/*
 * Painel de Despachos (pedido de 17/11/2026): demandas privadas entre duas pessoas, dentro de Demandas.
 * O servidor só devolve o que a pessoa participa (lib/follow-up/private.ts); a tela não filtra acesso.
 */
export const KIND_LABELS: Record<DispatchKind, string> = { signature: 'Assinatura', question: 'Dúvida', decision: 'Decisão', document_review: 'Validação de documento', referral: 'Encaminhamento', agenda: 'Pauta' };
export const DOCUMENT_LABELS: Record<string, string> = { term: 'Termo', draft: 'Minuta', notice: 'Edital', dispatch: 'Despacho', acknowledgement: 'Ciência', agreement: 'Convênio', other: 'Outro' };
export const URGENCY_LABELS: Record<DispatchUrgency, string> = { immediate: 'Imediata', high: 'Alta', medium: 'Média', low: 'Baixa' };
export const STATUS_LABELS: Record<DispatchStatus, string> = { open: 'Pendente', in_progress: 'Em análise', blocked: 'Devolvido para ajustes', completed: 'Concluída' };
type Tab = 'open' | 'signature' | 'question' | 'decision' | 'document_review' | 'referral' | 'agenda' | 'history';
const TABS: { id: Tab; label: string }[] = [
  { id: 'open', label: 'Abertas' }, { id: 'signature', label: 'Assinaturas' }, { id: 'question', label: 'Dúvidas' }, { id: 'decision', label: 'Decisões' },
  { id: 'document_review', label: 'Documentos' }, { id: 'referral', label: 'Encaminhamentos' }, { id: 'agenda', label: 'Pauta' }, { id: 'history', label: 'Histórico' },
];
const dueText = (date: string | null) => date ? `Prazo ${date.slice(8, 10)}/${date.slice(5, 7)}` : 'Sem prazo';
export function visibleTasks(tasks: DispatchTask[], tab: Tab): DispatchTask[] {
  if (tab === 'history') return tasks.filter(task => task.status === 'completed');
  const open = tasks.filter(task => task.status !== 'completed');
  if (tab === 'open') return open;
  if (tab === 'agenda') return open.filter(task => task.onAgenda || task.kind === 'agenda');
  return open.filter(task => task.kind === tab);
}

type Organization = { id: string; name: string };
type FormState = { mode: 'new' } | { mode: 'edit'; detail: DispatchDetail };

export default function DispatchPanel({ userId, organizations }: { userId: string; organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [withWhom, setWithWhom] = useState(''), [tab, setTab] = useState<Tab>('open');
  const [form, setForm] = useState<FormState | null>(null), [reload, setReload] = useState(0), [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const group = withWhom === 'group';
  // O resultado guarda a consulta que o produziu: "carregando" é derivado, sem setState dentro do efeito.
  const requestKey = JSON.stringify([organizationId, withWhom, reload]);
  const [result, setResult] = useState<{ key: string; data: DispatchWorkspace | null; error: string } | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    loadDispatchWorkspace({ organizationId, withUserId: group ? undefined : withWhom || undefined, group }, controller.signal)
      .then(value => setResult({ key: requestKey, data: value, error: '' }))
      .catch(cause => { if (!controller.signal.aborted) setResult(previous => ({ key: requestKey, data: previous?.data ?? null, error: cause instanceof Error ? cause.message : 'Não foi possível carregar.' })); });
    return () => controller.abort();
  }, [organizationId, withWhom, group, requestKey]);
  const loading = result?.key !== requestKey, data = result?.data ?? null, error = actionError || (result?.key === requestKey ? result.error : '');
  const counterpart = data?.people.find(person => person.userId === withWhom) ?? null;
  const shown = useMemo(() => data ? visibleTasks(data.tasks, tab) : [], [data, tab]);
  async function openTask(task: DispatchTask) {
    setNotice(''); setActionError('');
    try { setForm({ mode: 'edit', detail: await loadDispatchDetail(task.id) }); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Esta demanda não está mais disponível.'); setReload(value => value + 1); }
  }
  if (!organizations.length) return <section className={`p-card ${styles.panel}`}><p className="p-form-help">Você ainda não tem acesso a uma organização para despachar.</p></section>;
  return <section className={styles.panel} aria-labelledby="dispatch-title">
    <div className={`p-card ${styles.header}`}>
      <div className={styles.titleRow}>
        <div><h3 id="dispatch-title"><Lock size={18} aria-hidden="true"/>Demandas privadas</h3><p>Só as pessoas incluídas veem, nem a administração geral.</p></div>
        {form?.mode !== 'new' && <button type="button" className="p-button p-button-primary" onClick={() => { setNotice(''); setForm({ mode: 'new' }); }}><Plus size={16} aria-hidden="true"/>Nova demanda</button>}
      </div>
      <div className={styles.filters}>
        {organizations.length > 1 && <label className="p-field"><span>Organização</span><select name="dispatchOrganization" value={organizationId} onChange={event => { setOrganizationId(event.target.value); setWithWhom(''); }}>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        <label className="p-field"><span>Despachos com</span><select name="dispatchWith" value={withWhom} onChange={event => setWithWhom(event.target.value)}>
          <option value="">Todas as minhas demandas privadas</option>
          {data?.inLeadership && <option value="group">Todas da Gestão superior</option>}
          {(data?.people ?? []).map(person => <option key={person.userId} value={person.userId}>{person.name}</option>)}
        </select></label>
        <button type="button" className={`p-button p-button-subtle ${styles.refresh}`} onClick={() => setReload(value => value + 1)} aria-label="Atualizar despachos" disabled={loading}><RefreshCw size={16} aria-hidden="true"/><span>Atualizar</span></button>
        {counterpart?.inLeadership && <small className={styles.hint}>{counterpart.name} está na Gestão superior.</small>}
      </div>
    </div>
    {error && <p className="p-inline-error" role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {data && <div className={styles.metrics} aria-label="Resumo dos despachos">
      <Metric icon={<Inbox size={18} aria-hidden="true"/>} label="Abertas" value={data.counts.open}/>
      <Metric icon={<UserRoundCheck size={18} aria-hidden="true"/>} label={counterpart ? `Precisam de ${counterpart.name}` : 'Estão com você'} value={data.counts.needsCounterpart} tone="attention"/>
      <Metric icon={<CalendarClock size={18} aria-hidden="true"/>} label="Vencem em até 3 dias" value={data.counts.dueSoon} tone="soon"/>
      <Metric icon={<AlertCircle size={18} aria-hidden="true"/>} label="Atrasadas" value={data.counts.overdue} tone="late"/>
    </div>}
    {form && data && <DispatchForm key={form.mode === 'edit' ? form.detail.task.id : `new:${withWhom}`} userId={userId} organizationId={organizationId} workspace={data} counterpartId={group ? '' : withWhom}
      state={form} onCancel={() => setForm(null)} onSaved={text => { setForm(null); setNotice(text); setReload(value => value + 1); }}/>}
    <div className={`p-card ${styles.listCard}`}>
      <div className={styles.tabs} role="tablist" aria-label="Tipos de despacho">
        {TABS.map(item => { const count = data ? visibleTasks(data.tasks, item.id).length : 0; return <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? styles.tabActive : ''} onClick={() => setTab(item.id)}>{item.label}{count > 0 && <b>{count}</b>}</button>; })}
      </div>
      {loading && !data ? <p className="p-form-help" role="status">Carregando despachos…</p>
        : !shown.length ? <div className={styles.empty}><strong>{tab === 'history' ? 'Nada concluído por aqui ainda.' : 'Nenhuma demanda nesta lista.'}</strong><p>{counterpart ? `Use "Nova demanda" para despachar com ${counterpart.name}.` : 'Escolha com quem despachar ou crie uma demanda privada.'}</p></div>
        : <ul className={styles.list}>{shown.map(task => <li key={task.id}>
          <button type="button" className={styles.row} onClick={() => void openTask(task)} aria-label={`Abrir ${task.title}`}>
            <span className={styles.rowIcon} aria-hidden="true"><FileSignature size={17}/></span>
            <span className={styles.rowMain}><strong>{task.title}</strong><small>{[KIND_LABELS[task.kind], task.documentKind ? DOCUMENT_LABELS[task.documentKind] : '', dueText(task.dueAt), task.holderName ? `com ${task.holderName}` : ''].filter(Boolean).join(' · ')}</small></span>
            <span className={styles.rowSide}><span className={styles.urgency} data-urgency={task.urgency}>{URGENCY_LABELS[task.urgency]}</span><small>{STATUS_LABELS[task.status]}</small></span>
          </button></li>)}</ul>}
    </div>
    <p className={styles.help}>Quem administra o banco de dados tecnicamente pode ler. A privacidade vale dentro do Portal: estas demandas não aparecem em Meu trabalho, Agenda, relatórios, planilhas nem para quem não foi incluído.</p>
  </section>;
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: 'attention' | 'soon' | 'late' }) {
  return <div className={styles.metric} data-tone={tone} data-zero={value === 0 || undefined}><span>{icon}{label}</span><strong>{value}</strong></div>;
}

function DispatchForm({ userId, organizationId, workspace, counterpartId, state, onCancel, onSaved }: {
  userId: string; organizationId: string; workspace: DispatchWorkspace; counterpartId: string; state: FormState; onCancel: () => void; onSaved: (message: string) => void;
}) {
  const editing = state.mode === 'edit' ? state.detail.task : null, details = editing?.dispatch ?? null;
  const author = !editing || editing.isAuthor;
  const [title, setTitle] = useState(editing?.title ?? ''), [body, setBody] = useState(editing?.body ?? '');
  const [kind, setKind] = useState<DispatchKind>(details?.kind ?? 'signature'), [documentKind, setDocumentKind] = useState(details?.documentKind ?? '');
  const [dueAt, setDueAt] = useState(editing?.due_at ?? ''), [urgency, setUrgency] = useState<DispatchUrgency>(details?.urgency ?? 'medium');
  const [status, setStatus] = useState<DispatchStatus>(editing?.status ?? 'open'), [documentRef, setDocumentRef] = useState(details?.documentRef ?? '');
  const [onAgenda, setOnAgenda] = useState(details?.onAgenda ?? false);
  const [visibility, setVisibility] = useState<'participants' | 'leadership'>((editing?.privacy as 'participants' | 'leadership' | null) ?? 'participants');
  const initialPeople = editing ? editing.participants.map(person => person.userId).filter(id => id !== userId) : counterpartId ? [counterpartId] : [];
  const [people, setPeople] = useState<string[]>(initialPeople), [search, setSearch] = useState('');
  const [holder, setHolder] = useState(details?.holderUserId ?? counterpartId ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operation = useRef<string | null>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const names = new Map([...workspace.people.map(person => [person.userId, person.name] as const), ...(editing?.participants ?? []).map(person => [person.userId, person.name] as const)]);
  const holderOptions = [userId, ...people];
  const filtered = workspace.people.filter(person => !search.trim() || person.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'))).slice(0, 60);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!title.trim()) { setError('Escreva o assunto da demanda.'); return; }
    if (visibility === 'participants' && !people.length) { setError('Escolha pelo menos uma pessoa para esta demanda privada.'); return; }
    operation.current ??= crypto.randomUUID(); setBusy(true);
    const fields = { title: title.trim(), body, kind, documentKind: documentKind || null, dueAt: dueAt || null, urgency, status, documentRef, onAgenda, holderUserId: holderOptions.includes(holder) ? holder : (people[0] ?? userId) };
    try {
      if (editing) await saveDispatch({ action: 'dispatch.update', id: editing.id, expectedVersion: editing.version, ...fields, ...(author ? { visibility, participantIds: people } : {}), operationKey: operation.current });
      else await saveDispatch({ action: 'dispatch.create', organizationId, visibility, participantIds: people, ...fields, operationKey: operation.current });
      onSaved(editing ? 'Despacho atualizado. Só as pessoas incluídas veem.' : 'Demanda privada criada. Só as pessoas incluídas veem.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); operation.current = null; }
    finally { setBusy(false); }
  }
  return <form className={`p-card ${styles.form}`} onSubmit={event => void submit(event)} aria-labelledby="dispatch-form-title">
    <div className={styles.formHead}><h3 id="dispatch-form-title" ref={heading} tabIndex={-1}>{editing ? 'Despacho' : 'Nova demanda privada'}</h3>
      <button type="button" className="p-button p-button-subtle" onClick={onCancel} aria-label="Fechar"><X size={16} aria-hidden="true"/></button></div>
    <div className={styles.grid}>
      <label className={`p-field ${styles.wide}`}><span>Assunto</span><input name="dispatchTitle" required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="Ex.: assinatura do termo de cooperação"/></label>
      <label className="p-field"><span>Tipo</span><select name="dispatchKind" value={kind} onChange={event => setKind(event.target.value as DispatchKind)}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="p-field"><span>Documento (opcional)</span><select name="dispatchDocument" value={documentKind} onChange={event => setDocumentKind(event.target.value)}><option value="">Nenhum</option>{Object.entries(DOCUMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="p-field"><span>Prazo</span><DateField aria-label="Prazo" name="dispatchDue" value={dueAt} onValueChange={setDueAt}/></label>
      <label className="p-field"><span>Prioridade</span><select name="dispatchUrgency" value={urgency} onChange={event => setUrgency(event.target.value as DispatchUrgency)}>{Object.entries(URGENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="p-field"><span>Situação</span><select name="dispatchStatus" value={status} onChange={event => setStatus(event.target.value as DispatchStatus)}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="p-field"><span>Com quem está agora</span><select name="dispatchHolder" value={holderOptions.includes(holder) ? holder : ''} onChange={event => setHolder(event.target.value)}>
        <option value="" disabled>Escolha uma pessoa incluída</option>
        {holderOptions.map(id => <option key={id} value={id}>{id === userId ? 'Você' : names.get(id) ?? 'Pessoa incluída'}</option>)}</select></label>
      <label className={`p-field ${styles.wide}`}><span>Documento no SEI ou Drive (opcional)</span><input name="dispatchRef" maxLength={500} value={documentRef} onChange={event => setDocumentRef(event.target.value)} placeholder="Nº do processo ou link"/></label>
      <label className={`p-field ${styles.wide}`}><span>Detalhes (opcional)</span><textarea name="dispatchBody" maxLength={4000} rows={3} value={body} onChange={event => setBody(event.target.value)}/></label>
      <label className={`${styles.check} ${styles.wide}`}><input type="checkbox" name="dispatchAgenda" checked={onAgenda} onChange={event => setOnAgenda(event.target.checked)}/>Levar para a pauta da próxima conversa</label>
    </div>
    <fieldset className={styles.who} disabled={!author}>
      <legend>Quem vê</legend>
      {!author && <p className="p-form-help">Só quem criou a demanda muda as pessoas e a visibilidade.</p>}
      <label className={styles.radio}><input type="radio" name="dispatchVisibility" value="participants" checked={visibility === 'participants'} onChange={() => setVisibility('participants')}/><span><strong>Só as pessoas escolhidas</strong><small>Você e quem você incluir. Ninguém mais, nem a administração geral.</small></span></label>
      <label className={styles.radio}><input type="radio" name="dispatchVisibility" value="leadership" checked={visibility === 'leadership'} onChange={() => setVisibility('leadership')}/><span><strong>Gestão superior</strong><small>A Pró-Reitoria e as coordenações do grupo, mais as pessoas incluídas.</small></span></label>
      <div className={styles.people}>
        <label className="p-field"><span>Pessoas incluídas</span><input type="search" name="dispatchPeopleSearch" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pelo nome"/></label>
        {people.length > 0 && <ul className={styles.chips} aria-label="Pessoas incluídas">{people.map(id => <li key={id}>{names.get(id) ?? 'Pessoa incluída'}<button type="button" onClick={() => setPeople(current => current.filter(person => person !== id))} aria-label={`Tirar ${names.get(id) ?? 'pessoa'}`}><X size={14} aria-hidden="true"/></button></li>)}</ul>}
        <div className={styles.peopleList}>{filtered.filter(person => !people.includes(person.userId)).map(person => <button type="button" key={person.userId} onClick={() => setPeople(current => [...current, person.userId])}><Plus size={14} aria-hidden="true"/>{person.name}{person.inLeadership && <small>Gestão superior</small>}</button>)}</div>
      </div>
    </fieldset>
    {error && <p className="p-inline-error" role="alert">{error}</p>}
    <div className={styles.actions}><button type="button" className="p-button" onClick={onCancel} disabled={busy}>Cancelar</button><button type="submit" className="p-button p-button-primary" disabled={busy}>{busy ? 'Salvando…' : editing ? 'Salvar despacho' : 'Criar demanda privada'}</button></div>
  </form>;
}
