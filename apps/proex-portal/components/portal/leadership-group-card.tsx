'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, ShieldCheck, X } from 'lucide-react';
import styles from './dispatch-panel.module.css';
import { loadDispatchWorkspace, saveDispatch, type DispatchPerson } from './dispatch-api';

type Member = { userId: string; name: string };
/** "Gestão superior" (17/11/2026): a administração da organização escolhe quem vê as demandas privadas do grupo. */
export default function LeadershipGroupCard({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const [members, setMembers] = useState<Member[]>([]), [people, setPeople] = useState<DispatchPerson[]>([]);
  const [choice, setChoice] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const operation = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/follow-up?${new URLSearchParams({ view: 'leadership', organizationId })}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => { const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error?.message ?? data?.error ?? 'Não foi possível carregar o grupo.'); return data; }),
      loadDispatchWorkspace({ organizationId }, controller.signal),
    ]).then(([roster, workspace]) => { setMembers(Array.isArray(roster?.members) ? roster.members : []); setPeople(workspace.people); setError(''); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o grupo.'); });
    return () => controller.abort();
  }, [organizationId, reload]);
  async function change(action: 'leadership.add' | 'leadership.remove', userId: string) {
    setBusy(true); setError(''); operation.current = crypto.randomUUID();
    try { await saveDispatch({ action, organizationId, userId, operationKey: operation.current }); setChoice(''); setReload(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }
  const candidates = people.filter(person => !members.some(member => member.userId === person.userId));
  return <section className={`p-card ${styles.header}`} aria-labelledby={`leadership-${organizationId}`}>
    <div className={styles.titleRow}><div><h3 id={`leadership-${organizationId}`}><ShieldCheck size={18} aria-hidden="true"/>Gestão superior · {organizationName}</h3>
      <p>Quem está aqui vê as demandas privadas marcadas como &quot;Gestão superior&quot;. Tirar alguém corta o acesso na hora.</p></div></div>
    {members.length ? <ul className={styles.chips} aria-label="Integrantes da Gestão superior">{members.map(member => <li key={member.userId}>{member.name}
      <button type="button" disabled={busy} onClick={() => void change('leadership.remove', member.userId)} aria-label={`Tirar ${member.name} da Gestão superior`}><X size={14} aria-hidden="true"/></button></li>)}</ul>
      : <p className="p-form-help">Ninguém no grupo ainda.</p>}
    <div className={styles.filters}>
      <label className="p-field"><span>Incluir pessoa</span><select name={`leadershipAdd-${organizationId}`} value={choice} onChange={event => setChoice(event.target.value)}><option value="">Escolha uma pessoa da organização</option>{candidates.map(person => <option key={person.userId} value={person.userId}>{person.name}</option>)}</select></label>
      <button type="button" className="p-button p-button-primary" disabled={busy || !choice} onClick={() => void change('leadership.add', choice)}><Plus size={16} aria-hidden="true"/>Incluir</button>
    </div>
    {error && <p className="p-inline-error" role="alert">{error}</p>}
  </section>;
}
