'use client';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarDays, Check, Clock, Copy, LoaderCircle, MapPin, ShieldCheck, Trash2 } from 'lucide-react';
import { BrandMark } from '@/components/theme/brand-mark';
import { ThemeSwitch } from '@/components/theme/theme-switch';
import styles from './convocation.module.css';

type Shift = { id: string; label: string; startsAt: string; endsAt: string };
type Convocation = { id: string; title: string; edition: string; location: string; eventDate: string; responseDeadline: string | null; description: string; purposeNotice: string; retentionDays: number; organizationName: string; accepting: boolean; shifts: Shift[]; projects: { id: string; name: string }[] };
type Guest = { name: string; enrollment: string; projectId: string; response: 'yes' | 'no' | 'maybe'; shiftIds: string[]; version: number; updatedAt: string; linkExpiresOn?: string | null };
const ANSWERS: [Guest['response'], string][] = [['yes', 'Vou participar'], ['maybe', 'Talvez'], ['no', 'Não vou']];
const storageKey = (convocationId: string) => `proex:convocacao:${convocationId}`;
const dateLabel = (value: string) => new Date(`${value}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
const when = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
function newSecret() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function readStored(convocationId: string): string | null { try { const value = window.localStorage.getItem(storageKey(convocationId)); return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null; } catch { return null; } }
function store(convocationId: string, value: string | null) { try { if (value) window.localStorage.setItem(storageKey(convocationId), value); else window.localStorage.removeItem(storageKey(convocationId)); } catch { /* private mode: the personal link still works */ } }
async function call(body: Record<string, unknown>) {
  const response = await fetch('/api/convocations/public', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body), cache: 'no-store' });
  let data: Record<string, unknown> = {}; try { data = await response.json() as Record<string, unknown>; } catch { /* plataforma */ }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Não foi possível concluir. Tente de novo.');
  return data;
}
function Frame({ children }: { children: ReactNode }) {
  return <main className={styles.page}><section className={styles.card}><header className={styles.header}><BrandMark variant="auto" showUfg/><ThemeSwitch className={styles.theme}/></header><p className={styles.kicker}>CONFIRMAÇÃO DE PRESENÇA · PROEX UFG</p>{children}
    <footer className={styles.footer}><p>Este link dá acesso somente à sua própria resposta nesta convocação. Ele não abre o portal da equipe.</p></footer></section></main>;
}

export default function ConvocationGuest() {
  const [link, setLink] = useState<{ invite: string | null; edit: string | null } | null>(null);
  const [convocation, setConvocation] = useState<Convocation | null>(null), [guest, setGuest] = useState<Guest | null>(null), [editToken, setEditToken] = useState<string | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false), [copied, setCopied] = useState(false), [forgetting, setForgetting] = useState(false), [deleted, setDeleted] = useState(false);
  const [response, setResponse] = useState<Guest['response']>('yes');
  useEffect(() => {
    const read = () => { const hash = new URLSearchParams(window.location.hash.slice(1)); setLink({ invite: hash.get('c'), edit: hash.get('g') }); };
    const timer = window.setTimeout(read, 0); window.addEventListener('hashchange', read);
    return () => { window.clearTimeout(timer); window.removeEventListener('hashchange', read); };
  }, []);
  useEffect(() => {
    if (!link) return;
    let active = true;
    (async () => {
      try {
        if (link.edit) { const data = await call({ action: 'inspect', editToken: link.edit }); if (!active) return; setConvocation(data.convocation as Convocation); setGuest(data.guest as Guest); setEditToken(link.edit); setResponse((data.guest as Guest).response); store((data.convocation as Convocation).id, link.edit); return; }
        if (!link.invite) { setError('Abra o link de convite que você recebeu da coordenação.'); return; }
        const data = await call({ action: 'inspect', inviteToken: link.invite }); if (!active) return;
        const view = data.convocation as Convocation; setConvocation(view);
        const saved = readStored(view.id);
        if (saved) { try { const own = await call({ action: 'inspect', editToken: saved }); if (active) { setGuest(own.guest as Guest); setEditToken(saved); setResponse((own.guest as Guest).response); } } catch { store(view.id, null); } }
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : 'Não foi possível abrir o convite.'); }
    })();
    return () => { active = false; };
  }, [link]);
  const personalLink = useMemo(() => editToken && typeof window !== 'undefined' ? `${window.location.origin}/convocacao#g=${editToken}` : '', [editToken]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!convocation || busy) return;
    const form = new FormData(event.currentTarget), shiftIds = form.getAll('shiftIds').map(String);
    const fields = { name: form.get('name'), enrollment: form.get('enrollment'), projectId: form.get('projectId'), response, shiftIds: response === 'no' ? [] : shiftIds };
    setBusy(true); setError('');
    try {
      if (guest && editToken) { const data = await call({ action: 'update', editToken, ...fields, expectedVersion: guest.version }); setGuest(data.guest as Guest); setEditing(false); }
      else {
        const secret = editToken ?? newSecret(); setEditToken(secret);
        const data = await call({ action: 'respond', inviteToken: link?.invite, editToken: secret, consent: form.get('consent') === 'on', ...fields });
        setGuest(data.guest as Guest); store(convocation.id, secret);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível enviar.'); }
    finally { setBusy(false); }
  }
  async function forget() {
    if (!editToken || !convocation || busy) return;
    setBusy(true); setError('');
    try { await call({ action: 'forget', editToken, confirmed: true }); store(convocation.id, null); setGuest(null); setEditToken(null); setDeleted(true); setForgetting(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível apagar.'); }
    finally { setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(personalLink); setCopied(true); window.setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); } }

  if (!convocation) return <Frame>{error ? <div className={styles.alert} role="alert"><strong>Não foi possível abrir</strong><span>{error}</span></div> : <p className={styles.loading}><LoaderCircle className="p-spin" size={20}/>Abrindo o convite…</p>}</Frame>;
  const project = (projectId: string) => convocation.projects.find(row => row.id === projectId)?.name ?? 'Projeto';
  const shiftLabel = (ids: string[]) => convocation.shifts.filter(shift => ids.includes(shift.id)).map(shift => `${shift.label} (${shift.startsAt}–${shift.endsAt})`).join(', ');
  const showForm = convocation.accepting && (!guest || editing);
  return <Frame>
    <div className={styles.intro}>
      <h1>{convocation.title}</h1>
      {convocation.edition && <p className={styles.edition}>{convocation.edition}</p>}
      <ul className={styles.facts}>
        <li><CalendarDays size={17} aria-hidden="true"/><span>{dateLabel(convocation.eventDate)}</span></li>
        {convocation.location && <li><MapPin size={17} aria-hidden="true"/><span>{convocation.location}</span></li>}
        {convocation.responseDeadline && <li><Clock size={17} aria-hidden="true"/><span>Responda até {new Date(convocation.responseDeadline).toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' })}</span></li>}
      </ul>
      {convocation.description && <p className={styles.description}>{convocation.description}</p>}
    </div>
    {error && <div className={styles.alert} role="alert"><span>{error}</span></div>}
    {deleted && <div className={styles.success} role="status"><strong>Sua resposta foi apagada.</strong><span>Se quiser responder de novo, abra o link de convite.</span></div>}
    {guest && !editing && <section className={styles.success} aria-labelledby="guest-answer"><h2 id="guest-answer"><Check size={20} aria-hidden="true"/>{guest.response === 'yes' ? 'Presença confirmada' : guest.response === 'maybe' ? 'Resposta registrada: talvez' : 'Resposta registrada: não vai'}</h2>
      <p className={styles.privacyLine}><ShieldCheck size={16} aria-hidden="true"/>Seus dados servem só para esta ação{guest.linkExpiresOn ? ` e são apagados até ${guest.linkExpiresOn.split('-').reverse().join('/')}` : ''}. Só a coordenação e os gestores do seu projeto veem a resposta.</p>
      <dl className={styles.summary}><div><dt>Nome</dt><dd>{guest.name}</dd></div><div><dt>Matrícula</dt><dd>{guest.enrollment}</dd></div><div><dt>Projeto</dt><dd>{project(guest.projectId)}</dd></div>{guest.response !== 'no' && <div><dt>Turnos</dt><dd>{shiftLabel(guest.shiftIds) || '—'}</dd></div>}<div><dt>Atualizado</dt><dd>{when(guest.updatedAt)}</dd></div></dl>
      <div className={styles.keep}><strong>Guarde o seu link pessoal</strong><span>Sem ele você não consegue alterar nem apagar a resposta depois, inclusive de outro aparelho. Não compartilhe com ninguém.{guest.linkExpiresOn ? ` Ele vale até ${guest.linkExpiresOn.split('-').reverse().join('/')}, quando os dados são apagados.` : ''}</span><button type="button" className="p-button p-button-primary" onClick={() => void copy()}><Copy size={16} aria-hidden="true"/>{copied ? 'Link copiado' : 'Copiar meu link pessoal'}</button><label className={styles.linkLabel}><span>Seu link pessoal</span><input className={styles.linkText} readOnly name="personalLink" value={personalLink} onFocus={event => event.currentTarget.select()}/></label></div>
      {convocation.accepting ? <div className={styles.actions}><button type="button" className="p-button p-button-subtle" onClick={() => { setEditing(true); setResponse(guest.response); }}>Alterar resposta</button>
        {forgetting ? <span className={styles.confirm}>Apagar sua resposta? <button type="button" className="p-button p-button-danger" disabled={busy} onClick={() => void forget()}>Apagar</button><button type="button" className="p-button p-button-subtle" onClick={() => setForgetting(false)}>Cancelar</button></span>
          : <button type="button" className="p-button p-button-subtle" onClick={() => setForgetting(true)}><Trash2 size={16} aria-hidden="true"/>Apagar minha resposta</button>}</div>
        : <p className={styles.muted}>A coordenação encerrou as respostas. Para mudar algo, fale com ela.</p>}
    </section>}
    {!convocation.accepting && !guest && <div className={styles.alert} role="status"><strong>Respostas encerradas</strong><span>Este convite não aceita mais respostas. Fale com a coordenação da ação.</span></div>}
    {showForm && <form className={styles.form} onSubmit={submit}><fieldset disabled={busy}>
      <legend>{guest ? 'Alterar sua resposta' : 'Confirme a sua presença'}</legend>
      <label className="p-field"><span>Nome completo</span><input name="name" required minLength={3} maxLength={120} autoComplete="name" defaultValue={guest?.name}/></label>
      <label className="p-field"><span>Número de matrícula</span><input name="enrollment" required minLength={4} maxLength={20} inputMode="text" autoComplete="off" defaultValue={guest?.enrollment}/></label>
      <label className="p-field"><span>Projeto de extensão a que você está vinculado(a)</span><select name="projectId" required defaultValue={guest?.projectId ?? ''}><option value="" disabled>Escolha o projeto</option>{convocation.projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <div className={styles.group} role="radiogroup" aria-labelledby="answer-label"><span id="answer-label" className={styles.groupLabel}>Você vai participar?</span><div className={styles.segments}>{ANSWERS.map(([value, label]) => <label key={value} className={response === value ? styles.segmentOn : styles.segment}><input type="radio" name="response" value={value} checked={response === value} onChange={() => setResponse(value)}/>{response === value && <Check size={17} aria-hidden="true"/>}{label}</label>)}</div></div>
      {response !== 'no' && <div className={styles.group} role="group" aria-labelledby="shift-label"><span id="shift-label" className={styles.groupLabel}>Em quais turnos?</span><div className={styles.shifts}>{convocation.shifts.map(shift => <label key={shift.id} className={styles.shift}><input type="checkbox" name="shiftIds" value={shift.id} defaultChecked={guest ? guest.shiftIds.includes(shift.id) : convocation.shifts.length === 1}/><span><strong>{shift.label}</strong><small>{shift.startsAt} às {shift.endsAt}</small></span></label>)}</div></div>}
      {!guest && <div className={styles.policy}><p><ShieldCheck size={17} aria-hidden="true"/><strong>Como seus dados são usados</strong></p><p>{convocation.purposeNotice}</p><p>Pedimos só nome, matrícula, projeto e turnos. As respostas ficam guardadas por até {convocation.retentionDays} dias depois da ação e você pode apagar a sua quando quiser. Responsável: {convocation.organizationName}.</p>
        <label className={styles.consent}><input type="checkbox" name="consent" required/><span>Li e concordo com o uso dos meus dados para esta convocação.</span></label></div>}
      <div className={styles.actions}><button type="submit" className="p-button p-button-primary">{busy ? <LoaderCircle className="p-spin" size={17}/> : <Check size={17} aria-hidden="true"/>}{guest ? 'Salvar alteração' : 'Enviar resposta'}</button>{guest && <button type="button" className="p-button p-button-subtle" onClick={() => setEditing(false)}>Cancelar</button>}</div>
    </fieldset></form>}
  </Frame>;
}
