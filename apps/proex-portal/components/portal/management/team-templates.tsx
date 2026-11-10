'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, LoaderCircle, Sparkles } from 'lucide-react';
import { ACCESS_LABEL, type TeamTemplate } from '@/lib/management/team-templates';
import { managementGet, managementPost } from './api';
import styles from './management.module.css';

type State = { templates: TeamTemplate[]; applications: { teamId: string; templateId: string }[]; canApply: boolean };

/**
 * Equipes-modelo na página Equipes: quem gerencia a organização cria uma equipe vazia a partir de um
 * modelo; a equipe selecionada mostra os papéis, responsabilidades e acessos sugeridos do seu modelo.
 */
export default function TeamTemplates({ organizationId, selectedTeamId, onApplied, catalogOnly = false }: { organizationId: string; selectedTeamId?: string; onApplied?: (teamId: string) => void; catalogOnly?: boolean }) {
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState(''), [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    managementGet<State>({ view: 'team-templates', organizationId }, controller.signal).then(setState).catch(() => { /* área opcional: sem acesso, não aparece */ });
    return () => controller.abort();
  }, [organizationId]);
  if (!state) return null;
  const applied = selectedTeamId ? state.applications.find(row => row.teamId === selectedTeamId) : undefined;
  const template = applied ? state.templates.find(entry => entry.id === applied.templateId) : undefined;

  async function apply(entry: TeamTemplate) {
    setBusy(entry.id); setMessage(null);
    try {
      const result = await managementPost<State & { teamId: string }>({ action: 'template.apply', organizationId, templateId: entry.id, operationKey: crypto.randomUUID() });
      setState(result); setMessage({ tone: 'ok', text: `Equipe “${entry.name}” criada, ainda sem pessoas. Adicione os integrantes em Editar equipe.` });
      onApplied?.(result.teamId);
    } catch (cause) { setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Não foi possível criar a equipe.' }); }
    finally { setBusy(''); }
  }
  const catalog = <div className={styles.templates}>{state.templates.map(entry => <article key={entry.id} className={styles.template}>
    <h4>{entry.name}</h4><p>{entry.purpose}</p>
    <ul>{entry.roles.map(role => <li key={role.name}>{role.name} <span className={styles.muted}>· {ACCESS_LABEL[role.access]}</span></li>)}</ul>
    {state.canApply && <button type="button" className="p-button p-button-subtle" disabled={!!busy} onClick={() => void apply(entry)}>{busy === entry.id ? <LoaderCircle size={15} className="p-spin" aria-hidden="true"/> : <Sparkles size={15} aria-hidden="true"/>}Aplicar modelo</button>}
  </article>)}</div>;

  return <div className={styles.root} style={{ gap: 12 }}>
    {message && <p className={message.tone === 'ok' ? styles.ok : 'p-inline-error'} role={message.tone === 'ok' ? 'status' : 'alert'}>{message.text}</p>}
    {catalogOnly ? catalog : <>
      {template && <section className={styles.card} aria-labelledby="team-template-roles">
        <header><h3 id="team-template-roles">Modelo desta equipe: {template.name}</h3></header>
        <p className={styles.help}>{template.purpose} Papéis e acessos são sugestões: quem gerencia decide em Pessoas e acessos.</p>
        <ul className={styles.roles}>{template.roles.map(role => <li key={role.name}><strong>{role.name}</strong><small>Acesso sugerido: {ACCESS_LABEL[role.access]}</small><ul>{role.responsibilities.map(item => <li key={item}>{item}</li>)}</ul></li>)}</ul>
        <p className={styles.help}><strong>Rotinas:</strong> {template.routines.join(' · ')}.</p>
      </section>}
      {state.canApply && <details className={styles.card}>
        <summary className={styles.summary}><span className={styles.summaryIcon} aria-hidden="true"><Sparkles size={18}/></span><span><strong>Começar de um modelo de equipe</strong><small>Comunicação, Administrativo, TI, Gestão, Eventos e Bolsistas</small></span><ChevronDown size={18} className={styles.summaryChevron} aria-hidden="true"/></summary>
        <p className={styles.help}>Cria uma equipe vazia com o nome do modelo e mostra papéis, responsabilidades e acessos sugeridos. Pessoas e acessos você define depois.</p>
        {catalog}
      </details>}
    </>}
  </div>;
}
