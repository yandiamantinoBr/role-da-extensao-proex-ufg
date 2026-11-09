'use client';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, Heart, Lightbulb, LoaderCircle, RefreshCw, Send, ShieldQuestion, TriangleAlert, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PORTAL_MODULES, type ModuleId } from './navigation-model';
import { communityGet, communityPost, errorText, instantDay } from './community-api';
import type { CommunityPrefill } from './community-panel';
import styles from './community.module.css';

export type CommunityEvent = { id: string; name: string; projectId: string; projectName: string; startsAt: string };
type Kind = 'suggestion' | 'problem' | 'praise';
type Status = 'new' | 'reviewing' | 'resolved';
type Entry = { id: string; kind: Kind; module: string; body: string; status: Status; version: number; created_at: string; response: string | null; responded_at: string | null; project_name: string | null; campaign_name: string | null; author_name: string | null; canManage: boolean };
const KINDS: { id: Kind; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'suggestion', label: 'Sugestão', icon: Lightbulb, hint: 'Uma ideia para melhorar.' },
  { id: 'problem', label: 'Problema', icon: TriangleAlert, hint: 'Algo que não funcionou como esperado.' },
  { id: 'praise', label: 'Elogio', icon: Heart, hint: 'Um agradecimento ou reconhecimento.' },
];
export const STATUS_LABELS: Record<Status, string> = { new: 'Recebido', reviewing: 'Em análise', resolved: 'Resolvido' };
const kindLabel = (kind: Kind) => KINDS.find(item => item.id === kind)?.label ?? 'Retorno';
const target = (entry: Entry) => entry.campaign_name ? `${entry.campaign_name} (evento${entry.project_name ? ` de ${entry.project_name}` : ''})` : entry.project_name ? entry.project_name : 'Plataforma';

export function FeedbackForm({ projects, events, prefill, onOmbuds }: { projects: { id: string; name: string }[]; events: CommunityEvent[]; prefill: CommunityPrefill | null; onOmbuds(): void }) {
  const id = useId(), key = useRef('');
  const initialProject = prefill && projects.some(project => project.id === prefill.projectId) ? prefill.projectId : '';
  const [kind, setKind] = useState<Kind>('suggestion'), [about, setAbout] = useState<'platform' | 'project' | 'event'>(initialProject ? 'project' : 'platform');
  const [projectId, setProjectId] = useState(initialProject || projects[0]?.id || ''), [campaignId, setCampaignId] = useState(''), [area, setArea] = useState<ModuleId>(prefill?.area && prefill.area !== 'community' ? prefill.area : 'overview');
  const [body, setBody] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState(''), [revision, setRevision] = useState(0);
  const touch = () => { key.current = ''; setSent(''); };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); key.current ||= crypto.randomUUID();
    try {
      await communityPost('/api/feedback', { action: 'create', kind, body, module: area, projectId: about === 'project' ? projectId || null : null, campaignId: about === 'event' ? campaignId || null : null, operationKey: key.current });
      setBody(''); key.current = ''; setSent(kind === 'praise' ? 'Elogio enviado. Obrigado por reconhecer o trabalho da equipe.' : 'Retorno enviado. A resposta da gestão aparece em “Seus envios”.');
      toast.success('Retorno enviado'); setRevision(value => value + 1);
    } catch (cause) { setError(errorText(cause)); toast.error('Retorno não confirmado. Confira o formulário.'); }
    finally { setBusy(false); }
  }
  const recipient = about === 'platform' ? 'a administração do portal' : about === 'project' ? 'a gestão deste projeto' : 'a gestão do projeto deste evento';
  return <div className={styles.split}>
    <form className={styles.card} onSubmit={submit} aria-labelledby={`${id}-title`}>
      <div className={styles.cardHead}><h2 id={`${id}-title`}>Fale com a gestão</h2><p>Sugestão, problema ou elogio. Quem recebe responde por aqui.</p></div>
      <fieldset className={styles.kinds} disabled={busy}><legend>Tipo</legend>
        {KINDS.map(item => { const Icon = item.icon; return <label key={item.id} data-kind={item.id} className={kind === item.id ? styles.kindActive : undefined}><input type="radio" name={`${id}-kind`} value={item.id} checked={kind === item.id} onChange={() => { setKind(item.id); touch(); }}/><Icon size={18} aria-hidden="true"/><span><strong>{item.label}</strong><small>{item.hint}</small></span></label>; })}
      </fieldset>
      <div className={styles.fields}>
        <label className={styles.field}><span>Sobre</span><select name="community-field-1" value={about} disabled={busy} onChange={event => { setAbout(event.target.value as typeof about); touch(); }}><option value="platform">A plataforma</option>{projects.length > 0 && <option value="project">Um projeto</option>}{events.length > 0 && <option value="event">Um evento</option>}</select></label>
        {about === 'project' && <label className={styles.field}><span>Projeto</span><select name="community-field-2" value={projectId} required disabled={busy} onChange={event => { setProjectId(event.target.value); touch(); }}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
        {about === 'event' && <label className={styles.field}><span>Evento</span><select name="community-field-3" value={campaignId} required disabled={busy} onChange={event => { setCampaignId(event.target.value); touch(); }}><option value="">Escolha o evento</option>{[...new Set(events.map(item => item.projectName))].map(group => <optgroup key={group} label={group}>{events.filter(item => item.projectName === group).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label>}
        {about === 'platform' && <label className={styles.field}><span>Parte do portal</span><select name="community-field-4" value={area} disabled={busy} onChange={event => { setArea(event.target.value as ModuleId); touch(); }}>{PORTAL_MODULES.filter(module => module.id !== 'community').map(module => <option key={module.id} value={module.id}>{module.label}</option>)}</select></label>}
      </div>
      <label className={styles.field} htmlFor={`${id}-body`}><span>{kind === 'praise' ? 'O que você quer reconhecer?' : kind === 'problem' ? 'O que aconteceu?' : 'Qual é a sua ideia?'}</span></label>
      <textarea name="community-field-5" id={`${id}-body`} className={styles.textarea} required minLength={10} maxLength={2000} value={body} disabled={busy} onChange={event => { setBody(event.target.value); touch(); }} aria-describedby={`${id}-help`} placeholder={kind === 'problem' ? 'Conte o que tentou fazer, o resultado e o que esperava.' : kind === 'praise' ? 'Quem ajudou, em quê e por que fez diferença.' : 'Descreva a ideia e o que ela melhoraria.'}/>
      <p id={`${id}-help`} className={styles.help}>{body.length}/2.000 · Vai para {recipient}, com o seu nome. Não escreva senhas nem dados pessoais desnecessários.</p>
      <p className={styles.callout}><ShieldQuestion size={16} aria-hidden="true"/><span>Prefere não se identificar? <button type="button" className={styles.inlineLink} onClick={onOmbuds}>Use a ouvidoria anônima</button>.</span></p>
      {error && <p role="alert" className="p-inline-error">{error}</p>}
      {sent && <p role="status" className={styles.success}><Check size={16} aria-hidden="true"/>{sent}</p>}
      {body.trim().length < 10 && <p className={styles.help}>Escreva pelo menos 10 caracteres para enviar.</p>}
      <button type="submit" className="p-button p-button-primary" disabled={busy || body.trim().length < 10 || (about === 'event' && !campaignId)}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Send size={16}/>}Enviar {kindLabel(kind).toLowerCase()}</button>
    </form>
    <FeedbackHistory revision={revision}/>
  </div>;
}

function useFeedbackList(manage: boolean, revision: number) {
  const [entries, setEntries] = useState<Entry[] | null>(null), [error, setError] = useState(''), generation = useRef(0);
  const load = useCallback(() => {
    const epoch = ++generation.current;
    return communityGet<{ entries: Entry[] }>(`/api/feedback${manage ? '?manage=1' : ''}`)
      .then(result => { if (epoch === generation.current) { setError(''); setEntries(result.entries); } })
      .catch(cause => { if (epoch === generation.current) { setError(errorText(cause, 'Não foi possível consultar os retornos.')); setEntries([]); } });
  }, [manage]);
  useEffect(() => {
    const epoch = ++generation.current, current = generation;
    communityGet<{ entries: Entry[] }>(`/api/feedback${manage ? '?manage=1' : ''}`)
      .then(result => { if (epoch === current.current) { setError(''); setEntries(result.entries); } })
      .catch(cause => { if (epoch === current.current) { setError(errorText(cause, 'Não foi possível consultar os retornos.')); setEntries([]); } });
    return () => { current.current++; };
  }, [manage, revision]);
  return { entries, error, load };
}

function FeedbackHistory({ revision }: { revision: number }) {
  const id = useId(), { entries, error, load } = useFeedbackList(false, revision);
  return <section className={styles.card} aria-labelledby={`${id}-title`} aria-busy={entries === null}>
    <div className={styles.cardHead}><div><h2 id={`${id}-title`}>Seus envios</h2><p>As respostas da gestão aparecem aqui.</p></div><button type="button" className="p-icon-button" aria-label="Atualizar seus envios" onClick={() => void load()}><RefreshCw size={18}/></button></div>
    {error ? <p role="alert" className="p-inline-error">{error}</p> : entries === null ? <p role="status" className={styles.help}>Consultando…</p> : !entries.length ? <p className={styles.empty}>Você ainda não enviou retornos.</p>
      : <ul className={styles.entries}>{entries.map(entry => <li key={entry.id} className={styles.entry}>
        <div className={styles.entryMeta}><span className={styles.kind} data-kind={entry.kind}>{kindLabel(entry.kind)}</span><span className={styles.status} data-status={entry.status}>{STATUS_LABELS[entry.status]}</span><small>{target(entry)} · {instantDay(entry.created_at)}</small></div>
        <p className={styles.entryBody}>{entry.body}</p>
        {entry.response && <div className={styles.reply}><strong>Resposta da gestão · {instantDay(entry.responded_at)}</strong><p>{entry.response}</p></div>}
      </li>)}</ul>}
  </section>;
}

export function FeedbackManagement() {
  const id = useId(), [filter, setFilter] = useState<Status | 'all'>('all'), { entries, error, load } = useFeedbackList(true, 0);
  const visible = (entries ?? []).filter(entry => filter === 'all' || entry.status === filter);
  const counts = (entries ?? []).reduce((total, entry) => ({ ...total, [entry.status]: (total[entry.status] ?? 0) + 1 }), {} as Record<Status, number>);
  return <section className={styles.card} aria-labelledby={`${id}-title`} aria-busy={entries === null}>
    <div className={styles.cardHead}><div><h2 id={`${id}-title`}>Caixa da gestão</h2><p>Retornos dos projetos e eventos que você gerencia{entries?.some(entry => !entry.project_name) ? ' e da plataforma' : ''}. A resposta aparece na lista de quem enviou.</p></div><button type="button" className="p-icon-button" aria-label="Atualizar caixa da gestão" onClick={() => void load()}><RefreshCw size={18}/></button></div>
    <div className={styles.filters} role="group" aria-label="Filtrar por estado">{(['all', 'new', 'reviewing', 'resolved'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'Todos' : STATUS_LABELS[value]}{value !== 'all' && counts[value] ? <span>{counts[value]}</span> : null}</button>)}</div>
    {error ? <p role="alert" className="p-inline-error">{error}</p> : entries === null ? <p role="status" className={styles.help}>Consultando…</p> : !visible.length ? <p className={styles.empty}>{filter === 'all' ? 'Nenhum retorno recebido ainda.' : 'Nada neste estado.'}</p>
      : <ul className={styles.entries}>{visible.map(entry => <ManagedEntry key={`${entry.id}:${entry.version}`} entry={entry} onChange={load}/>)}</ul>}
    <p className={styles.help}>Até 50 retornos mais recentes, novos primeiro.</p>
  </section>;
}

function ManagedEntry({ entry, onChange }: { entry: Entry; onChange(): Promise<void> }) {
  const id = useId(), [response, setResponse] = useState(''), [status, setStatus] = useState<Status>(entry.status === 'new' ? 'resolved' : entry.status), [busy, setBusy] = useState(false), [error, setError] = useState(''), [open, setOpen] = useState(false), [nextStatus, setNextStatus] = useState<Status>(entry.status);
  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true); setError('');
    try { await communityPost('/api/feedback', { id: entry.id, expectedVersion: entry.version, ...body }); toast.success(done); await onChange(); return true; }
    catch (cause) { setError(errorText(cause)); return false; } finally { setBusy(false); }
  }
  return <li className={styles.entry}>
    <div className={styles.entryMeta}><span className={styles.kind} data-kind={entry.kind}>{kindLabel(entry.kind)}</span><span className={styles.status} data-status={entry.status}>{STATUS_LABELS[entry.status]}</span><small>{entry.author_name ?? 'Pessoa da equipe'} · {target(entry)} · {instantDay(entry.created_at)}</small></div>
    <p className={styles.entryBody}>{entry.body}</p>
    {entry.response && <div className={styles.reply}><strong>Resposta da gestão · {instantDay(entry.responded_at)}</strong><p>{entry.response}</p></div>}
    {entry.canManage && <div className={styles.manageRow}>
      <label className={styles.inlineField}><span>Estado</span><select name="community-field-6" value={nextStatus} disabled={busy} onChange={event => setNextStatus(event.target.value as Status)}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {nextStatus !== entry.status && <button type="button" className="p-button p-button-primary" disabled={busy} onClick={() => void send({ action: 'status', status: nextStatus }, 'Estado salvo')}><Check size={16}/>Salvar estado</button>}
      <button type="button" className="p-button p-button-subtle" aria-expanded={open} aria-controls={`${id}-reply`} onClick={() => setOpen(value => !value)}>{entry.response ? 'Responder de novo' : 'Responder'}</button>
    </div>}
    {open && <form id={`${id}-reply`} className={styles.replyForm} onSubmit={event => { event.preventDefault(); void send({ action: 'respond', response, status }, 'Resposta enviada').then(ok => { if (ok) setOpen(false); }); }}>
      <label className={styles.field} htmlFor={`${id}-text`}><span>Resposta para {entry.author_name ?? 'a pessoa'}</span></label>
      <textarea name="community-field-7" id={`${id}-text`} className={styles.textarea} required minLength={2} maxLength={2000} value={response} disabled={busy} onChange={event => setResponse(event.target.value)} placeholder="Agradeça, diga o que será feito ou explique por que não será possível."/>
      <p className={styles.help}>{response.length}/2.000{response.trim().length < 2 ? ' · Escreva a resposta para enviar.' : ''}</p>
      <div className={styles.manageRow}><label className={styles.inlineField}><span>Depois de responder</span><select name="community-field-8" value={status} disabled={busy} onChange={event => setStatus(event.target.value as Status)}><option value="reviewing">Em análise</option><option value="resolved">Resolvido</option></select></label>
        <button type="submit" className="p-button p-button-primary" disabled={busy || response.trim().length < 2}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Send size={16}/>}Enviar resposta</button></div>
    </form>}
    {error && <p role="alert" className="p-inline-error">{error}</p>}
  </li>;
}
