'use client';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Copy, EyeOff, KeyRound, LoaderCircle, RefreshCw, Search, Send, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { newOmbudsCode } from '@/lib/community/ombuds-code';
import { civilDay, communityGet, communityPost, errorText } from './community-api';
import styles from './community.module.css';

/*
 * The tracking code lives only in this component's memory: never in localStorage, drafts, the URL or the Rolê.
 * Leaving the tab forgets it, by design.
 */
type Category = 'conduct' | 'workload' | 'environment' | 'process' | 'platform' | 'other';
type Status = 'received' | 'reviewing' | 'answered' | 'closed';
type Message = { side: 'reporter' | 'ombuds'; body: string; sentOn: string; seq: number };
type Report = { id?: string; category: Category; status: Status; receivedOn: string; updatedOn: string; version: number; excerpt?: string; messages?: number };
const CATEGORIES: Record<Category, string> = { conduct: 'Conduta ou relacionamento', workload: 'Carga de trabalho', environment: 'Ambiente e condições', process: 'Processos e decisões', platform: 'O portal', other: 'Outro assunto' };
const STATUS: Record<Status, string> = { received: 'Aguardando a ouvidoria', reviewing: 'Em análise', answered: 'Respondido', closed: 'Encerrado' };
const API = '/api/community/ombuds';

export function OmbudsReporter() {
  const [code, setCode] = useState(() => newOmbudsCode()), [submitted, setSubmitted] = useState('');
  return <div className={styles.split}>
    {submitted ? <Submitted code={submitted} onNew={() => { setSubmitted(''); setCode(newOmbudsCode()); }}/> : <NewReport code={code} onRegenerate={() => setCode(newOmbudsCode())} onSent={() => setSubmitted(code)}/>}
    <Track initialCode={submitted}/>
  </div>;
}

function Anonymity() {
  return <details className={styles.anonymity}>
    <summary><EyeOff size={16} aria-hidden="true"/>Como o anonimato funciona</summary>
    <ul>
      <li>O portal <strong>não guarda</strong> seu nome, e-mail, projeto nem a hora do envio. Fica só o dia.</li>
      <li>Nem a administração consegue ver quem escreveu. O código fica só com você; o portal guarda apenas uma impressão dele.</li>
      <li>Você precisa estar logado só para provar que é da equipe. Esse vínculo é descartado.</li>
      <li>Limite honesto: a hospedagem registra horários e endereços de rede dos acessos, e o próprio texto pode identificar você. Evite detalhes que só você saberia.</li>
    </ul>
  </details>;
}

function CodeBox({ code, onRegenerate }: { code: string; onRegenerate?(): void }) {
  const [copied, setCopied] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 2500); } catch { toast.error('Não foi possível copiar. Selecione o código e copie manualmente.'); } }
  return <div className={styles.codeBox}>
    <span className={styles.codeLabel}><KeyRound size={16} aria-hidden="true"/>Seu código de acompanhamento</span>
    <output className={styles.code} aria-live="polite">{code}</output>
    <div className={styles.codeActions}>
      <button type="button" className="p-button p-button-subtle" onClick={() => void copy()}>{copied ? <Check size={16}/> : <Copy size={16}/>}{copied ? 'Copiado' : 'Copiar código'}</button>
      {onRegenerate && <button type="button" className={styles.inlineLink} onClick={onRegenerate}>Gerar outro código</button>}
    </div>
  </div>;
}

function NewReport({ code, onRegenerate, onSent }: { code: string; onRegenerate(): void; onSent(): void }) {
  const id = useId(), [category, setCategory] = useState<Category | ''>(''), [body, setBody] = useState(''), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await communityPost(API, { action: 'submit', code, category, body }); setBody(''); toast.success('Relato recebido pela ouvidoria'); onSent(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <form className={styles.card} onSubmit={submit} aria-labelledby={`${id}-title`} autoComplete="off">
    <div className={styles.cardHead}><h2 id={`${id}-title`}>Novo relato anônimo</h2><p>Para falar de algo difícil sem se identificar. A ouvidoria responde pelo código.</p></div>
    <Anonymity/>
    <CodeBox code={code} onRegenerate={busy ? undefined : () => { onRegenerate(); setSaved(false); }}/>
    <label className={styles.checkLine}><input type="checkbox" required checked={saved} disabled={busy} onChange={event => setSaved(event.target.checked)}/><span>Guardei o código. Sem ele não há como acompanhar a resposta.</span></label>
    <label className={styles.field}><span>Tema</span><select required value={category} disabled={busy} onChange={event => setCategory(event.target.value as Category)}><option value="">Escolha um tema</option>{Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className={styles.field} htmlFor={`${id}-body`}><span>Relato</span></label>
    <textarea id={`${id}-body`} className={styles.textarea} required minLength={10} maxLength={4000} value={body} disabled={busy} spellCheck autoComplete="off" onChange={event => setBody(event.target.value)} aria-describedby={`${id}-help`} placeholder="Conte o que aconteceu e o que ajudaria. Evite nomes e detalhes que identifiquem você."/>
    <p id={`${id}-help`} className={styles.help}>{body.length}/4.000 · O texto não fica salvo como rascunho neste aparelho.</p>
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    <button type="submit" className="p-button p-button-primary" disabled={busy || !saved || !category}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Send size={16}/>}Enviar relato anônimo</button>
  </form>;
}

function Submitted({ code, onNew }: { code: string; onNew(): void }) {
  return <section className={styles.card} aria-live="polite">
    <div className={styles.cardHead}><h2><ShieldCheck size={20} aria-hidden="true"/>Relato recebido</h2><p>A ouvidoria vai ler e responder. Consulte com o código ao lado quando quiser.</p></div>
    <CodeBox code={code}/>
    <p className={styles.help}>Este código não aparece de novo depois que você sair desta tela.</p>
    <button type="button" className="p-button p-button-subtle" onClick={onNew}>Escrever outro relato</button>
  </section>;
}

function Track({ initialCode }: { initialCode: string }) {
  const id = useId(), [code, setCode] = useState(initialCode), [result, setResult] = useState<{ report: Report; messages: Message[] } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reply, setReply] = useState('');
  const [seenCode, setSeenCode] = useState(initialCode);
  if (seenCode !== initialCode) { setSeenCode(initialCode); setCode(initialCode); setResult(null); }
  async function track(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError('');
    try { setResult(await communityPost(API, { action: 'track', code })); }
    catch (cause) { setResult(null); setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await communityPost(API, { action: 'reply', code, body: reply }); setReply(''); setResult(await communityPost(API, { action: 'track', code })); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <section className={styles.card} aria-labelledby={`${id}-title`}>
    <div className={styles.cardHead}><h2 id={`${id}-title`}>Acompanhar relato</h2><p>Digite o código para ver o estado, as respostas e continuar a conversa.</p></div>
    <form className={styles.trackRow} onSubmit={track} autoComplete="off">
      <label className="visually-hidden" htmlFor={`${id}-code`}>Código de acompanhamento</label>
      <input id={`${id}-code`} className={styles.codeInput} value={code} maxLength={40} spellCheck={false} autoCapitalize="characters" placeholder="OUV-XXXX-XXXX-XXXX-XXXX-XXXX" disabled={busy} onChange={event => setCode(event.target.value)}/>
      <button type="submit" className="p-button p-button-subtle" disabled={busy || code.replace(/[\s-]/g, '').length < 20}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Search size={16}/>}Consultar</button>
    </form>
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    {result && <div className={styles.thread}>
      <div className={styles.entryMeta}><span className={styles.status} data-status={result.report.status}>{STATUS[result.report.status]}</span><small>{CATEGORIES[result.report.category]} · recebido em {civilDay(result.report.receivedOn)}</small></div>
      <Thread messages={result.messages} mine="reporter"/>
      {result.report.status === 'closed' ? <p className={styles.help}>A ouvidoria encerrou este relato. Para um assunto novo, escreva outro relato.</p>
        : <form className={styles.replyForm} onSubmit={send}><label className={styles.field} htmlFor={`${id}-reply`}><span>Acrescentar algo</span></label><textarea id={`${id}-reply`} className={styles.textarea} required minLength={2} maxLength={4000} value={reply} disabled={busy} onChange={event => setReply(event.target.value)}/><button type="submit" className="p-button p-button-primary" disabled={busy || reply.trim().length < 2}><Send size={16}/>Enviar à ouvidoria</button></form>}
    </div>}
  </section>;
}

function Thread({ messages, mine }: { messages: Message[]; mine: Message['side'] }) {
  return <ol className={styles.messages}>{messages.map(message => <li key={message.seq} data-side={message.side} data-mine={message.side === mine || undefined}>
    <strong>{message.side === 'ombuds' ? 'Ouvidoria' : mine === 'reporter' ? 'Você' : 'Pessoa anônima'}</strong><small>{civilDay(message.sentOn)}</small><p>{message.body}</p>
  </li>)}</ol>;
}

export function OmbudsInbox() {
  const id = useId(), [reports, setReports] = useState<Report[] | null>(null), [error, setError] = useState(''), [selected, setSelected] = useState<string | null>(null), generation = useRef(0);
  const load = useCallback(() => {
    const epoch = ++generation.current, current = generation;
    return communityGet<{ reports: Report[] }>(API)
      .then(result => { if (epoch === current.current) { setError(''); setReports(result.reports); } })
      .catch(cause => { if (epoch === current.current) { setError(errorText(cause)); setReports([]); } });
  }, []);
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    const epoch = ++generation.current, current = generation;
    communityGet<{ reports: Report[] }>(API)
      .then(result => { if (epoch === current.current) { setError(''); setReports(result.reports); } })
      .catch(cause => { if (epoch === current.current) { setError(errorText(cause)); setReports([]); } });
    return () => { current.current++; };
  }, [opened]);
  if (selected) return <OmbudsDetail id={selected} onBack={() => { setSelected(null); setOpened(value => value + 1); }}/>;
  return <section className={styles.card} aria-labelledby={`${id}-title`} aria-busy={reports === null}>
    <div className={styles.cardHead}><div><h2 id={`${id}-title`}>Relatos recebidos</h2><p>Relatos anônimos da equipe. O portal não sabe quem escreveu, e esta tela também não.</p></div><button type="button" className="p-icon-button" aria-label="Atualizar relatos" onClick={() => void load()}><RefreshCw size={18}/></button></div>
    {error ? <p role="alert" className="p-inline-error">{error}</p> : reports === null ? <p role="status" className={styles.help}>Consultando…</p> : !reports.length ? <p className={styles.empty}>Nenhum relato recebido.</p>
      : <ul className={styles.entries}>{reports.map(report => <li key={report.id} className={styles.entry}>
        <div className={styles.entryMeta}><span className={styles.status} data-status={report.status}>{STATUS[report.status]}</span><small>{CATEGORIES[report.category]} · recebido em {civilDay(report.receivedOn)} · {report.messages} {report.messages === 1 ? 'mensagem' : 'mensagens'}</small></div>
        <p className={styles.entryBody}>{report.excerpt}{(report.excerpt?.length ?? 0) >= 160 ? '…' : ''}</p>
        <button type="button" className="p-button p-button-subtle" onClick={() => setSelected(report.id!)}>Abrir relato</button>
      </li>)}</ul>}
  </section>;
}

function OmbudsDetail({ id: reportId, onBack }: { id: string; onBack(): void }) {
  const id = useId(), [data, setData] = useState<{ report: Report; messages: Message[] } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reply, setReply] = useState('');
  const load = useCallback(() => communityPost<{ report: Report; messages: Message[] }>(API, { action: 'detail', id: reportId }).then(setData).catch(cause => setError(errorText(cause))), [reportId]);
  useEffect(() => { let live = true; communityPost<{ report: Report; messages: Message[] }>(API, { action: 'detail', id: reportId }).then(result => { if (live) setData(result); }).catch(cause => { if (live) setError(errorText(cause)); }); return () => { live = false; }; }, [reportId]);
  async function act(body: Record<string, unknown>, done: string) {
    if (!data) return; setBusy(true); setError('');
    try { await communityPost(API, { id: reportId, expectedVersion: data.report.version, ...body }); toast.success(done); setReply(''); await load(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <section className={styles.card} aria-labelledby={`${id}-title`} aria-busy={!data}>
    <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16}/>Voltar aos relatos</button>
    <div className={styles.cardHead}><h2 id={`${id}-title`}>{data ? CATEGORIES[data.report.category] : 'Relato'}</h2>{data && <p>Recebido em {civilDay(data.report.receivedOn)} · {STATUS[data.report.status]}</p>}</div>
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    {data && <>
      <Thread messages={data.messages} mine="ombuds"/>
      {data.report.status !== 'closed' && <form className={styles.replyForm} onSubmit={event => { event.preventDefault(); void act({ action: 'respond', body: reply, status: 'answered' }, 'Resposta enviada'); }}>
        <label className={styles.field} htmlFor={`${id}-reply`}><span>Resposta da ouvidoria</span></label>
        <textarea id={`${id}-reply`} className={styles.textarea} required minLength={2} maxLength={4000} value={reply} disabled={busy} onChange={event => setReply(event.target.value)} placeholder="A pessoa lê esta resposta quando consultar o código."/>
        <div className={styles.manageRow}><button type="submit" className="p-button p-button-primary" disabled={busy || reply.trim().length < 2}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Send size={16}/>}Responder</button>
          {data.report.status !== 'reviewing' && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => void act({ action: 'status', status: 'reviewing' }, 'Marcado como em análise')}>Marcar em análise</button>}
          <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => void act({ action: 'status', status: 'closed' }, 'Relato encerrado')}>Encerrar relato</button></div>
      </form>}
      {data.report.status === 'closed' && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => void act({ action: 'status', status: 'reviewing' }, 'Relato reaberto')}>Reabrir relato</button>}
    </>}
  </section>;
}
