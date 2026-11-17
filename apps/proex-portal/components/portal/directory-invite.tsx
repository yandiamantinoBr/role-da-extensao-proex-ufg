'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, CheckCircle2, Clock3, LoaderCircle, Mail, MessageCircle, MessageSquareText, UserPlus, X, XCircle } from 'lucide-react';
import type { DirectoryPerson } from '@/lib/directory/contracts';
import { invitationShareLink } from '@/lib/invitation-link';
import { emailShareHref, inviteMessage, whatsappShareHref } from '@/lib/invite-message';
import { projectAccessRoleLabels } from '@/lib/team-access-labels';
import TeamInviteShare from './team-invite-share';
import styles from './directory-invite.module.css';

export type DirectoryInviteOptions = {
  /** Projetos desta organização em que a pessoa logada pode convidar. */
  projects: { id: string; name: string }[];
  defaultProjectId?: string;
  canInviteManager: (projectId: string) => boolean;
  /** Atualiza Equipes depois de criar ou cancelar convites. */
  onChanged?: () => void;
};
type Props = DirectoryInviteOptions & {
  people: DirectoryPerson[];
  /** Reenviar: cria um convite novo e cancela este. */
  replaces?: { inviteId: string; role: string | null; projectId: string | null } | null;
  onClose: () => void;
  onDone: () => void;
};
type Result = { status: 'waiting' | 'creating' | 'ready' | 'error'; url?: string; expiresAt?: string; error?: string; note?: string };

const LAST_PROJECT = 'proex.directoryInvite.lastProject';
const ROLE_HELP: Record<string, string> = {
  viewer: 'Consulta relatórios, registros e demandas. É o acesso mais restrito e o sugerido para começar.',
  operator: 'Atende e entrega brindes nas dinâmicas do projeto.',
  inventory: 'Consulta e movimenta os materiais do projeto.',
  loans: 'Reserva e registra retiradas e devoluções do projeto.',
  manager: 'Coordena o projeto e pode convidar outras pessoas para ele.',
};

/** Same contract as the portal's own mutate: the server checks permission and scope again. */
export async function portalAction(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Você está sem conexão. Reconecte e tente de novo.');
  const response = await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action, ...payload }) })
    .catch(() => { throw new Error('A conexão caiu. Tente de novo: o mesmo pedido não cria dois convites.'); });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body || body.error) {
    const error = body?.error, text = typeof error === 'string' ? error : typeof (error as { message?: unknown } | undefined)?.message === 'string' ? String((error as { message: string }).message) : '';
    throw new Error(text && text.length < 300 && !/SQLITE|D1_|JSON|<html/i.test(text) ? text : 'Não foi possível criar o convite. Tente de novo.');
  }
  return body;
}

/** Convite a partir do pré-cadastro: já preenchido, quem convida confere projeto e função e confirma. Uma ou várias pessoas. */
export default function DirectoryInvite({ people, projects, defaultProjectId, canInviteManager, replaces, onChanged, onClose, onDone }: Props) {
  const single = people.length === 1, person = people[0];
  // Suggested project: the previous invite's, the one filtered on the page, the last one used here, or the only one available.
  const remembered = (() => { try { return window.localStorage.getItem(LAST_PROJECT) ?? ''; } catch { return ''; } })();
  const initialProject = [replaces?.projectId, defaultProjectId, remembered, projects.length === 1 ? projects[0].id : ''].find(id => id && projects.some(p => p.id === id)) ?? '';
  const [projectId, setProjectId] = useState(initialProject), [role, setRole] = useState(replaces?.role && replaces.role in projectAccessRoleLabels ? replaces.role : 'viewer');
  const [email, setEmail] = useState(person?.contact ?? ''), [phase, setPhase] = useState<'form' | 'running' | 'done'>('form'), [error, setError] = useState('');
  const [results, setResults] = useState<Record<string, Result>>({}), [copied, setCopied] = useState('');
  const keys = useRef(new Map<string, string>()), title = useRef<HTMLHeadingElement>(null), alive = useRef(true);
  useEffect(() => { title.current?.focus({ preventScroll: true }); title.current?.scrollIntoView({ block: 'nearest' }); return () => { alive.current = false; }; }, []);
  const managerAllowed = projectId ? canInviteManager(projectId) : false;
  const activeRole = role === 'manager' && !managerAllowed ? 'viewer' : role;
  const roleLabel = projectAccessRoleLabels[activeRole] ?? '', projectName = projects.find(p => p.id === projectId)?.name ?? '';
  const heading = replaces ? `Reenviar convite para ${person.name}` : single ? `Convidar ${person.name}` : `Convidar ${people.length} pessoas`;
  const running = phase === 'running';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running) return;
    if (!projectId) { setError('Escolha onde a pessoa vai atuar.'); return; }
    if (single && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Confira o e-mail antes de convidar.'); return; }
    setError(''); setPhase('running');
    try { window.localStorage.setItem(LAST_PROJECT, projectId); } catch { /* per-viewer convenience only */ }
    const targets = people.filter(p => results[p.id]?.status !== 'ready');
    setResults(current => ({ ...current, ...Object.fromEntries(targets.map(p => [p.id, { status: 'waiting' } as Result])) }));
    let failures = 0;
    for (const target of targets) {
      if (!alive.current) return;
      setResults(current => ({ ...current, [target.id]: { status: 'creating' } }));
      const recipient = single ? email.trim() : target.contact;
      // The same key per person and choice: a retry after a lost reply returns the same invite instead of a second one.
      const fingerprint = JSON.stringify([target.id, recipient, projectId, activeRole]);
      if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID());
      try {
        const created = await portalAction('invite.create', { email: recipient, role: activeRole, projectId, operationKey: keys.current.get(fingerprint) });
        const url = invitationShareLink(String(created.inviteUrl), window.location.origin);
        let note = '';
        if (replaces && single) {
          try { await portalAction('invite.revoke', { id: replaces.inviteId, operationKey: crypto.randomUUID() }); }
          catch { note = 'O convite anterior continua valendo. Cancele-o em Convites emitidos.'; }
        }
        if (alive.current) setResults(current => ({ ...current, [target.id]: { status: 'ready', url, expiresAt: String(created.expiresAt ?? ''), note } }));
      } catch (cause) {
        failures++;
        if (alive.current) setResults(current => ({ ...current, [target.id]: { status: 'error', error: cause instanceof Error ? cause.message : 'Não foi possível criar o convite.' } }));
      }
    }
    if (!alive.current) return;
    // A single invite that failed goes back to the form, with the message; what was typed stays.
    setPhase(single && failures > 0 ? 'form' : 'done'); if (failures < targets.length) { onChanged?.(); onDone(); }
  }
  async function copyMessage(id: string, message: string) {
    try { await navigator.clipboard.writeText(message); setCopied(id); } catch { setCopied(''); }
  }
  const failed = people.filter(p => results[p.id]?.status === 'error').length, ready = people.filter(p => results[p.id]?.status === 'ready').length;
  const lone = single ? results[person.id] : undefined;

  return <section className={styles.panel} aria-labelledby="directory-invite-title" onKeyDown={event => { if (event.key === 'Escape' && !running) { event.preventDefault(); onClose(); } }}>
    <div className={styles.head}>
      <h3 id="directory-invite-title" ref={title} tabIndex={-1}><UserPlus size={19} aria-hidden="true" />{heading}</h3>
      <button type="button" className="p-button p-button-subtle" disabled={running} onClick={onClose}><X size={16} aria-hidden="true" />{phase === 'done' ? 'Fechar' : 'Cancelar'}</button>
    </div>
    {phase !== 'done' && <form className={styles.form} onSubmit={event => void submit(event)}>
      <fieldset disabled={running}>
        <p className={styles.lead}>{single ? 'Os dados vêm do pré-cadastro. Confira e confirme: o link é pessoal, vale por tempo limitado e pode ser cancelado.' : `Todas recebem o mesmo projeto e a mesma função. Cada pessoa ganha um link pessoal, com prazo e que pode ser cancelado.`}</p>
        {single ? <div className={styles.grid}>
          <label className="p-field"><span>Nome</span><input readOnly value={person.name} aria-describedby="directory-invite-name-help" /><small id="directory-invite-name-help">Do pré-cadastro. A pessoa confirma o próprio nome ao entrar.</small></label>
          <label className="p-field"><span>E-mail da pessoa *</span><input type="email" required maxLength={254} autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} /></label>
        </div> : <ul className={styles.names}>{people.map(p => <li key={p.id}><strong>{p.name}</strong><span>{p.contact}</span></li>)}</ul>}
        <div className={styles.grid}>
          <label className="p-field"><span>Onde vai atuar *</span><select value={projectId} required onChange={event => setProjectId(event.target.value)}><option value="" disabled>Escolha o projeto</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{!projects.length && <small>Você não pode convidar em nenhum projeto desta organização.</small>}</label>
          <label className="p-field"><span>Função *</span><select value={activeRole} onChange={event => setRole(event.target.value)}>{Object.entries(projectAccessRoleLabels).filter(([id]) => id !== 'manager' || managerAllowed).map(([id, label]) => <option key={id} value={id}>{label}{id === 'viewer' ? ' (sugerida)' : ''}</option>)}</select><small aria-live="polite">{ROLE_HELP[activeRole]}</small></label>
        </div>
        {(error || (single && results[person.id]?.status === 'error')) && <p className="p-inline-error" role="alert">{error || results[person.id]?.error}</p>}
        <div className={styles.actions}><button type="submit" className="p-button p-button-primary" disabled={!projects.length}>{running ? <LoaderCircle size={16} className="p-spin" aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}{running ? 'Criando convites…' : single ? (replaces ? 'Gerar novo convite' : 'Gerar convite') : `Gerar ${people.length} convites`}</button></div>
      </fieldset>
    </form>}
    {!single && Object.keys(results).length > 0 && <div className={styles.progress}>
      <p role="status" className={styles.lead}>{running ? `Criando convites: ${ready} de ${people.length} prontos.` : failed ? `${ready} de ${people.length} convites prontos. Os que falharam podem ser tentados de novo.` : `${ready} convites prontos. Envie a mensagem de cada pessoa.`}</p>
      <ul className={styles.rows}>{people.map(p => {
        const result = results[p.id], message = result?.url ? inviteMessage({ name: p.name, roleLabel: roleLabel, scopeLabel: projectName, url: result.url, expiresAt: result.expiresAt }) : '';
        return <li key={p.id} className={styles.row}>
          <div className={styles.rowName}><strong>{p.name}</strong><span className={styles[`state_${result?.status ?? 'waiting'}`]}>{result?.status === 'ready' ? <><CheckCircle2 size={14} aria-hidden="true" />Convite pronto</> : result?.status === 'error' ? <><XCircle size={14} aria-hidden="true" />{result.error}</> : result?.status === 'creating' ? <><LoaderCircle size={14} className="p-spin" aria-hidden="true" />Criando…</> : <><Clock3 size={14} aria-hidden="true" />Aguardando</>}</span></div>
          {result?.status === 'ready' && <div className={styles.rowActions}>
            <a className="p-button p-button-subtle" href={emailShareHref(p.contact, message)} target="_blank" rel="noopener noreferrer" aria-label={`Enviar por e-mail para ${p.name}`}><Mail size={15} aria-hidden="true" />E-mail</a>
            <a className="p-button p-button-subtle" href={whatsappShareHref(message)} target="_blank" rel="noopener noreferrer" aria-label={`Compartilhar no WhatsApp para ${p.name}`}><MessageCircle size={15} aria-hidden="true" />WhatsApp</a>
            <button type="button" className="p-button p-button-subtle" aria-label={`Copiar a mensagem para ${p.name}`} onClick={() => void copyMessage(p.id, message)}>{copied === p.id ? <Check size={15} aria-hidden="true" /> : <MessageSquareText size={15} aria-hidden="true" />}{copied === p.id ? 'Copiada' : 'Copiar mensagem'}</button>
          </div>}
        </li>;
      })}</ul>
      {phase === 'done' && failed > 0 && <button type="button" className="p-button p-button-primary" onClick={() => setPhase('form')}>Tentar de novo os que falharam</button>}
    </div>}
    {single && lone?.status === 'ready' && lone.url && <>
      <TeamInviteShare url={lone.url} expiresAt={lone.expiresAt ?? ''} name={person.name} email={email.trim()} roleLabel={roleLabel} scopeLabel={projectName} />
      {lone.note && <p className="p-inline-error" role="alert">{lone.note}</p>}
    </>}
  </section>;
}
