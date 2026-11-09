'use client';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Copy, EyeOff, KeyRound, LoaderCircle, RefreshCw, Search, Send, ShieldCheck, X } from 'lucide-react';
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

/** OUV-XXXX-… with hyphens, whatever the person types or pastes (spaces, lower case, no prefix). */
export function formatOmbudsInput(value: string) {
  let text = value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (text.startsWith('OUV')) text = text.slice(3);
  text = text.slice(0, 20);
  return text ? `OUV-${text.match(/.{1,4}/g)!.join('-')}` : '';
}
const masked = (code: string) => `terminado em ${code.slice(-4)}`;

export function OmbudsReporter() {
  const [mode, setMode] = useState<'new' | 'track'>('new'), [code, setCode] = useState(() => newOmbudsCode()), [submitted, setSubmitted] = useState('');
  return <div className={styles.single}>
    <div className={styles.segmented} role="group" aria-label="O que você quer fazer na ouvidoria">
      <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}><Send size={16} aria-hidden="true"/>Fazer um relato</button>
      <button type="button" aria-pressed={mode === 'track'} onClick={() => setMode('track')}><KeyRound size={16} aria-hidden="true"/>Já tenho um código</button>
    </div>
    <p className={styles.guarantee}><ShieldCheck size={18} aria-hidden="true"/><span><strong>Este relato não fica ligado à sua conta.</strong> O portal não grava seu nome, seu e-mail, seu projeto nem a hora do envio, e nem a administração consegue ver quem escreveu.</span></p>
    {mode === 'track' ? <Track initialCode={submitted}/>
      : submitted ? <Submitted code={submitted} onTrack={() => setMode('track')} onNew={() => { setSubmitted(''); setCode(newOmbudsCode()); }}/>
      : <NewReport code={code} onRegenerate={() => setCode(newOmbudsCode())} onSent={() => setSubmitted(code)}/>}
  </div>;
}

function Anonymity() {
  return <details className={styles.anonymity}>
    <summary><EyeOff size={16} aria-hidden="true"/>Detalhes e limites do anonimato</summary>
    <ul>
      <li>Fica guardado só o tema, o texto, as respostas e o dia (sem hora).</li>
      <li>O código fica só com você. O portal guarda apenas uma impressão dele, que não permite descobrir o código.</li>
      <li>Você entra com sua conta só para provar que é da equipe. Esse vínculo não é gravado com o relato.</li>
      <li>Limites: a hospedagem do site registra horários e endereços de rede dos acessos, e o próprio texto pode identificar você. Evite nomes e detalhes que só você saberia.</li>
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
      {onRegenerate && <button type="button" className={styles.textButton} onClick={onRegenerate}><RefreshCw size={15} aria-hidden="true"/>Gerar outro código</button>}
    </div>
  </div>;
}

function NewReport({ code, onRegenerate, onSent }: { code: string; onRegenerate(): void; onSent(): void }) {
  const id = useId(), [category, setCategory] = useState<Category | ''>(''), [body, setBody] = useState(''), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const missing = [!saved && 'confirmar que guardou o código', !category && 'escolher o tema', body.trim().length < 10 && 'escrever o relato (mínimo de 10 caracteres)'].filter(Boolean) as string[];
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || missing.length) return; setBusy(true); setError('');
    try { await communityPost(API, { action: 'submit', code, category, body }); setBody(''); toast.success('Relato recebido pela ouvidoria'); onSent(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <form className={styles.card} onSubmit={submit} aria-labelledby={`${id}-title`} autoComplete="off">
    <div className={styles.cardHead}><h2 id={`${id}-title`}>Novo relato anônimo</h2><p>Para falar de algo difícil sem se identificar. A ouvidoria responde pelo código.</p></div>
    <CodeBox code={code} onRegenerate={busy ? undefined : () => { onRegenerate(); setSaved(false); }}/>
    <label className={styles.checkLine}><input type="checkbox" checked={saved} disabled={busy} onChange={event => setSaved(event.target.checked)}/><span>Guardei o código. Sem ele não há como acompanhar a resposta.</span></label>
    <label className={styles.field}><span>Tema</span><select required value={category} disabled={busy} onChange={event => setCategory(event.target.value as Category)}><option value="">Escolha um tema</option>{Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className={styles.field} htmlFor={`${id}-body`}><span>Relato</span></label>
    <textarea id={`${id}-body`} className={styles.textarea} required minLength={10} maxLength={4000} value={body} disabled={busy} spellCheck autoComplete="off" onChange={event => setBody(event.target.value)} aria-describedby={`${id}-help`} placeholder="Conte o que aconteceu e o que ajudaria. Evite nomes e detalhes que identifiquem você."/>
    <p id={`${id}-help`} className={styles.help}>{body.length}/4.000 · O texto não fica salvo como rascunho neste aparelho.</p>
    <Anonymity/>
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    {missing.length > 0 && <p className={styles.help} id={`${id}-missing`}>Para enviar, falta {missing.join(', ')}.</p>}
    <button type="submit" className="p-button p-button-primary" aria-describedby={missing.length ? `${id}-missing` : undefined} disabled={busy || missing.length > 0}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Send size={16}/>}Enviar relato anônimo</button>
  </form>;
}

function Submitted({ code, onNew, onTrack }: { code: string; onNew(): void; onTrack(): void }) {
  return <section className={styles.card} aria-live="polite">
    <div className={styles.cardHead}><h2><ShieldCheck size={20} aria-hidden="true"/>Relato recebido</h2><p>A ouvidoria vai ler e responder. Use o código para ver a resposta.</p></div>
    <CodeBox code={code}/>
    <p className={styles.help}>Este código não aparece de novo depois que você sair desta tela. Guarde-o em um lugar só seu.</p>
    <div className={styles.manageRow}><button type="button" className="p-button p-button-primary" onClick={onTrack}><Search size={16}/>Acompanhar agora</button><button type="button" className="p-button p-button-subtle" onClick={onNew}>Escrever outro relato</button></div>
  </section>;
}

function Track({ initialCode }: { initialCode: string }) {
  const id = useId(), [code, setCode] = useState(initialCode), [result, setResult] = useState<{ report: Report; messages: Message[] } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reply, setReply] = useState('');
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
  function close() { setResult(null); setCode(''); setReply(''); setError(''); }
  return <section className={styles.card} aria-labelledby={`${id}-title`}>
    <div className={styles.cardHead}><h2 id={`${id}-title`}>Acompanhar relato</h2><p>Digite o código para ver o estado, as respostas e continuar a conversa.</p></div>
    {result ? <div className={styles.openCode}><span><KeyRound size={16} aria-hidden="true"/>Relato {masked(formatOmbudsInput(code))}</span><button type="button" className="p-button p-button-subtle" onClick={close}><X size={16}/>Fechar conversa</button></div>
      : <form className={styles.trackRow} onSubmit={track} autoComplete="off">
        <label className="visually-hidden" htmlFor={`${id}-code`}>Código de acompanhamento</label>
        <input id={`${id}-code`} className={styles.codeInput} value={code} maxLength={40} spellCheck={false} autoCapitalize="characters" placeholder="OUV-XXXX-XXXX-XXXX-XXXX-XXXX" disabled={busy} onChange={event => setCode(formatOmbudsInput(event.target.value))}/>
        <button type="submit" className="p-button p-button-primary" disabled={busy || code.replace(/[^0-9A-Z]/gi, '').length < 23}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Search size={16}/>}Consultar</button>
      </form>}
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    {result && <div className={styles.thread}>
      <div className={styles.entryMeta}><span className={styles.status} data-status={result.report.status}>{STATUS[result.report.status]}</span><small>{CATEGORIES[result.report.category]} · recebido em {civilDay(result.report.receivedOn)}</small></div>
      <Thread messages={result.messages} mine="reporter"/>
      {result.report.status === 'closed' ? <p className={styles.help}>A ouvidoria encerrou este relato. Para um assunto novo, escreva outro relato.</p>
        : <form className={styles.replyForm} onSubmit={send}><label className={styles.field} htmlFor={`${id}-reply`}><span>Acrescentar algo</span></label><textarea id={`${id}-reply`} className={styles.textarea} required minLength={2} maxLength={4000} value={reply} disabled={busy} onChange={event => setReply(event.target.value)} placeholder="Responda a uma pergunta da ouvidoria ou acrescente um detalhe."/><p className={styles.help}>{reply.length}/4.000{reply.trim().length < 2 ? ' · Escreva algo para enviar.' : ''}</p><button type="submit" className="p-button p-button-primary" disabled={busy || reply.trim().length < 2}><Send size={16}/>Enviar à ouvidoria</button></form>}
      <p className={styles.help}>Em computador compartilhado, feche a conversa ao terminar.</p>
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
    <div className={styles.cardHead}><div><h2 id={`${id}-title`}>Ouvidoria · relatos recebidos</h2><p>Relatos anônimos da equipe. O portal não sabe quem escreveu, e esta tela também não.</p></div><button type="button" className="p-icon-button" aria-label="Atualizar relatos" onClick={() => void load()}><RefreshCw size={18}/></button></div>
    {error ? <p role="alert" className="p-inline-error">{error}</p> : reports === null ? <p role="status" className={styles.help}>Consultando…</p> : !reports.length ? <p className={styles.empty}>Nenhum relato recebido.</p>
      : <ul className={styles.entries}>{reports.map(report => <li key={report.id} className={styles.entry}>
        <div className={styles.entryMeta}><span className={styles.status} data-status={report.status}>{STATUS[report.status]}</span><small>{CATEGORIES[report.category]} · recebido em {civilDay(report.receivedOn)} · {report.messages} {report.messages === 1 ? 'mensagem' : 'mensagens'}</small></div>
        <p className={styles.entryBody}>{report.excerpt}{(report.excerpt?.length ?? 0) >= 160 ? '…' : ''}</p>
        <button type="button" className="p-button p-button-subtle" onClick={() => setSelected(report.id!)}>Abrir relato</button>
      </li>)}</ul>}
  </section>;
}

function OmbudsDetail({ id: reportId, onBack }: { id: string; onBack(): void }) {
  const id = useId(), [data, setData] = useState<{ report: Report; messages: Message[] } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reply, setReply] = useState(''), [confirmClose, setConfirmClose] = useState(false);
  const load = useCallback(() => communityPost<{ report: Report; messages: Message[] }>(API, { action: 'detail', id: reportId }).then(setData).catch(cause => setError(errorText(cause))), [reportId]);
  useEffect(() => { let live = true; communityPost<{ report: Report; messages: Message[] }>(API, { action: 'detail', id: reportId }).then(result => { if (live) setData(result); }).catch(cause => { if (live) setError(errorText(cause)); }); return () => { live = false; }; }, [reportId]);
  async function act(body: Record<string, unknown>, done: string) {
    if (!data) return; setBusy(true); setError('');
    try { await communityPost(API, { id: reportId, expectedVersion: data.report.version, ...body }); toast.success(done); setReply(''); await load(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <section className={styles.card} aria-labelledby={`${id}-title`} aria-busy={!data}>
    <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16}/>Voltar aos relatos</button>
    <div className={styles.cardHead}><h2 id={`${id}-title`}>{data ? CATEGORIES[data.report.category] : 'Relato'}</h2></div>
    {data && <div className={styles.entryMeta}><span className={styles.status} data-status={data.report.status}>{STATUS[data.report.status]}</span><small>Recebido em {civilDay(data.report.receivedOn)}</small></div>}
    {data && <p className={styles.callout}><EyeOff size={16} aria-hidden="true"/><span>Não é possível saber quem escreveu. Responda sem tentar identificar a pessoa.</span></p>}
    {error && <p role="alert" className="p-inline-error">{error}</p>}
    {data && <>
      <Thread messages={data.messages} mine="ombuds"/>
      {data.report.status !== 'closed' && <form className={styles.replyForm} onSubmit={event => { event.preventDefault(); void act({ action: 'respond', body: reply, status: 'answered' }, 'Resposta enviada'); }}>
        <label className={styles.field} htmlFor={`${id}-reply`}><span>Resposta da ouvidoria</span></label>
        <textarea id={`${id}-reply`} className={styles.textarea} required minLength={2} maxLength={4000} value={reply} disabled={busy} onChange={event => setReply(event.target.value)} placeholder="A pessoa lê esta resposta quando consultar o código."/>
        <p className={styles.help}>{reply.length}/4.000{reply.trim().length < 2 ? ' · Escreva a resposta para enviar.' : ''}</p>
        <div className={styles.manageRow}><button type="submit" className="p-button p-button-primary" disabled={busy || reply.trim().length < 2}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <Send size={16}/>}Responder</button>
          {data.report.status !== 'reviewing' && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => void act({ action: 'status', status: 'reviewing' }, 'Marcado como em análise')}>Marcar em análise</button>}
          {confirmClose ? <span className={styles.confirmInline}>Encerrar impede novas mensagens de quem relatou. <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void act({ action: 'status', status: 'closed' }, 'Relato encerrado').then(() => setConfirmClose(false))}>Encerrar</button><button type="button" className={styles.textButton} onClick={() => setConfirmClose(false)}>Cancelar</button></span>
            : <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => setConfirmClose(true)}>Encerrar relato</button>}</div>
      </form>}
      {data.report.status === 'closed' && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => void act({ action: 'status', status: 'reviewing' }, 'Relato reaberto')}>Reabrir relato</button>}
    </>}
  </section>;
}
