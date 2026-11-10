'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, LoaderCircle, Sparkles } from 'lucide-react';
import { ACCESS_LABEL, type TeamTemplate } from '@/lib/management/team-templates';
import { managementGet, managementPost } from './api';
import styles from './management.module.css';

type State = { templates: TeamTemplate[]; applications: { teamId: string; templateId: string }[]; canApply: boolean };
type Draft = { templateId: string; name: string; operationKey: string };

/**
 * Equipes-modelo na página Equipes: quem gerencia a organização cria uma equipe a partir de um
 * modelo (nome editável, papéis como vagas a preencher); a equipe selecionada mostra os papéis,
 * responsabilidades e acessos sugeridos do seu modelo.
 */
export default function TeamTemplates({ organizationId, selectedTeamId, onApplied, catalogOnly = false }: { organizationId: string; selectedTeamId?: string; onApplied?: (teamId: string) => void; catalogOnly?: boolean }) {
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    managementGet<State>({ view: 'team-templates', organizationId }, controller.signal).then(setState).catch(() => { /* área opcional: sem acesso, não aparece */ });
    return () => controller.abort();
  }, [organizationId]);
  if (!state) return null;
  const applied = selectedTeamId ? state.applications.find(row => row.teamId === selectedTeamId) : undefined;
  const template = applied ? state.templates.find(entry => entry.id === applied.templateId) : undefined;

  async function create(entry: TeamTemplate, current: Draft) {
    setBusy(true); setMessage(null);
    try {
      // A mesma chave de operação vale para o formulário aberto: clicar duas vezes não cria duas equipes.
      const result = await managementPost<State & { teamId: string }>({ action: 'template.apply', organizationId, templateId: entry.id, name: current.name, operationKey: current.operationKey });
      setState(result); setDraft(null);
      setMessage({ tone: 'ok', text: `Equipe “${current.name.trim() || entry.name}” criada com ${entry.roles.length} papéis a preencher. Adicione as pessoas em Editar equipe.` });
      onApplied?.(result.teamId);
    } catch (cause) { setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Não foi possível criar a equipe.' }); }
    finally { setBusy(false); }
  }
  const catalog = <div className={styles.templates}>{state.templates.map(entry => {
    const open = draft?.templateId === entry.id;
    return <article key={entry.id} className={styles.template} aria-labelledby={`template-${entry.id}`}>
      <h4 id={`template-${entry.id}`}>{entry.name}</h4><p>{entry.purpose}</p>
      <ul className={styles.templateRoles}>{entry.roles.map(role => <li key={role.name} className={styles.roleLine}><span>{role.name}</span><small>Acesso sugerido: {ACCESS_LABEL[role.access]}</small></li>)}</ul>
      {state.canApply && (open && draft ? <form className={styles.applyForm} onSubmit={event => { event.preventDefault(); void create(entry, draft); }}>
        <label className="p-field"><span>Nome da equipe</span><input value={draft.name} maxLength={100} required autoFocus onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
        <p className={styles.help}>A equipe nasce sem pessoas. Os {entry.roles.length} papéis acima ficam como vagas a preencher, e as rotinas aparecem na equipe.</p>
        <div className={styles.actions}><button type="submit" className="p-button p-button-primary" disabled={busy || !draft.name.trim()}>{busy ? <LoaderCircle size={15} className="p-spin" aria-hidden="true"/> : <Sparkles size={15} aria-hidden="true"/>}Criar equipe</button>
          <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button></div>
      </form> : <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => { setMessage(null); setDraft({ templateId: entry.id, name: entry.name, operationKey: crypto.randomUUID() }); }}><Sparkles size={15} aria-hidden="true"/>Usar este modelo</button>)}
    </article>;
  })}</div>;

  return <div className={styles.root} style={{ gap: 12 }}>
    {message && <p className={message.tone === 'ok' ? styles.ok : 'p-inline-error'} role={message.tone === 'ok' ? 'status' : 'alert'}>{message.text}</p>}
    {catalogOnly ? catalog : <>
      {template && <section className={styles.card} aria-labelledby="team-template-roles">
        <header><h3 id="team-template-roles">Modelo desta equipe: {template.name}</h3></header>
        <p className={styles.help}>{template.purpose} Papéis e acessos são sugestões: quem gerencia decide em Pessoas e acessos.</p>
        <ul className={styles.roles}>{template.roles.map(role => <li key={role.name}><strong>{role.name}</strong><small>Acesso sugerido: {ACCESS_LABEL[role.access]}</small><ul>{role.responsibilities.map(item => <li key={item}>{item}</li>)}</ul></li>)}</ul>
        <p className={styles.help}><strong>Rotinas:</strong> {template.routines.join(' · ')}.</p>
      </section>}
      {state.canApply && <details className={`${styles.card} ${styles.templatesBox}`}>
        <summary className={styles.summary}><span className={styles.summaryIcon} aria-hidden="true"><Sparkles size={18}/></span><span className={styles.summaryText}><strong>Começar de um modelo de equipe</strong><small>Comunicação, Administrativo, TI, Gestão, Eventos e Bolsistas</small></span><span className={styles.summaryMore}>Ver {state.templates.length} modelos<ChevronDown size={18} className={styles.summaryChevron} aria-hidden="true"/></span></summary>
        <p className={styles.help}>Escolha um modelo, ajuste o nome e crie a equipe. Papéis, responsabilidades e acessos sugeridos aparecem nela; pessoas e acessos você define depois.</p>
        {catalog}
      </details>}
    </>}
  </div>;
}
