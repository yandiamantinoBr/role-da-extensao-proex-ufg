'use client';
import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Plus } from 'lucide-react';
import DateField from '../date-field';
import { brDate, managementGet, managementPost } from './api';
import styles from './management.module.css';

type Risk = { id: string; projectId: string | null; projectName: string | null; title: string; description: string; category: string; probability: number; impact: number; score: number; level: 'baixo' | 'moderado' | 'alto' | 'critico';
  ownerLabel: string; mitigation: string; status: string; reviewOn: string | null; reviewOverdue: boolean; isExample: boolean; version: number; canEdit: boolean };
type Workspace = { organization: { id: string; name: string }; today: string; canEditOrganization: boolean; canLoadExamples: boolean; projects: { id: string; name: string; canEdit: boolean }[]; risks: Risk[] };
type Draft = { id?: string; version?: number; projectId: string; title: string; description: string; category: string; probability: number; impact: number; ownerLabel: string; mitigation: string; status: string; reviewOn: string };

const LEVEL: Record<Risk['level'], string> = { baixo: 'Baixo', moderado: 'Moderado', alto: 'Alto', critico: 'Crítico' };
const STATUS: Record<string, string> = { open: 'Aberto', monitoring: 'Em monitoramento', mitigated: 'Mitigado', closed: 'Encerrado' };
const CATEGORY: Record<string, string> = { operacional: 'Operacional', tecnologia: 'Tecnologia', pessoas: 'Pessoas', financeiro: 'Financeiro', reputacao: 'Reputação', legal: 'Legal', outro: 'Outro' };
const SCALE = ['1 · muito baixa', '2 · baixa', '3 · média', '4 · alta', '5 · muito alta'];
const levelOf = (probability: number, impact: number) => { const score = probability * impact; return score >= 15 ? 'critico' : score >= 10 ? 'alto' : score >= 5 ? 'moderado' : 'baixo'; };
const emptyDraft = (projectId = ''): Draft => ({ projectId, title: '', description: '', category: 'operacional', probability: 3, impact: 3, ownerLabel: '', mitigation: '', status: 'open', reviewOn: '' });

export default function RisksPanel({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<Workspace | null>(null), [error, setError] = useState(''), [filter, setFilter] = useState('all'), [cell, setCell] = useState<[number, number] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [saving, setSaving] = useState(false), [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    managementGet<Workspace>({ view: 'risks', organizationId }, controller.signal).then(setData).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir os riscos.'); });
    return () => controller.abort();
  }, [organizationId]);
  const visible = useMemo(() => (data?.risks ?? []).filter(risk => (filter === 'all' || (filter === 'organization' ? risk.projectId === null : filter === 'overdue' ? risk.reviewOverdue : risk.projectId === filter))
    && (!cell || (risk.probability === cell[0] && risk.impact === cell[1] && (risk.status === 'open' || risk.status === 'monitoring')))), [data, filter, cell]);
  const matrix = useMemo(() => { const grid = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]); for (const risk of data?.risks ?? []) if (risk.status === 'open' || risk.status === 'monitoring') grid[5 - risk.impact][risk.probability - 1]++; return grid; }, [data]);
  const scopes = data ? [...(data.canEditOrganization ? [{ id: '', name: 'Organização (só a administração vê)' }] : []), ...data.projects.filter(project => project.canEdit)] : [];

  async function send(payload: Record<string, unknown>, success: string) {
    setSaving(true); setMessage(null);
    try { setData(await managementPost<Workspace>({ organizationId, ...payload })); setDraft(null); setMessage({ tone: 'ok', text: success }); }
    catch (cause) { setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Não foi possível salvar.' }); }
    finally { setSaving(false); }
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const payload = { projectId: draft.projectId || null, title: draft.title, description: draft.description, category: draft.category, probability: draft.probability, impact: draft.impact, ownerLabel: draft.ownerLabel, mitigation: draft.mitigation, status: draft.status, reviewOn: draft.reviewOn || null };
    void send(draft.id ? { action: 'risk.update', id: draft.id, expectedVersion: draft.version, ...payload } : { action: 'risk.create', ...payload }, draft.id ? 'Risco atualizado.' : 'Risco registrado.');
  }

  if (error) return <div className={styles.errorBox} role="alert"><p>{error}</p></div>;
  if (!data) return <p className={styles.loading}><LoaderCircle size={18} className="p-spin" aria-hidden="true"/>Abrindo os riscos…</p>;
  const overdue = data.risks.filter(risk => risk.reviewOverdue).length;
  return <div className={styles.root}>
    <div className={styles.toolbar} style={{ justifyContent: 'space-between' }}>
      <p className={styles.help}>Algo que pode dar errado, com chance (probabilidade), estrago (impacto), dono e o que fazer para evitar. Riscos da organização ficam só com a administração; os de projeto aparecem para quem participa dele.</p>
      <div className={styles.actions}>
        {scopes.length > 0 && !draft && <button type="button" className="p-button p-button-primary" onClick={() => setDraft(emptyDraft(scopes[0].id))}><Plus size={16} aria-hidden="true"/>Registrar risco</button>}
        {data.canLoadExamples && <button type="button" className="p-button p-button-subtle" disabled={saving} onClick={() => void send({ action: 'risk.examples.load' }, 'Exemplos carregados. Revise, ajuste ou apague cada um.')}>Carregar exemplos</button>}
      </div>
    </div>
    {overdue > 0 && <p className={styles.starter} role="status"><strong>{overdue} {overdue === 1 ? 'risco está' : 'riscos estão'} com a revisão vencida.</strong> Abra, confira a situação e marque a próxima revisão.</p>}
    {message && <p className={message.tone === 'ok' ? styles.ok : 'p-inline-error'} role={message.tone === 'ok' ? 'status' : 'alert'}>{message.text}</p>}
    {draft && <form className={styles.form} onSubmit={save} aria-label={draft.id ? 'Editar risco' : 'Registrar risco'}>
      <div className={styles.formGrid}>
        <label className="p-field"><span>Onde</span><select value={draft.projectId} disabled={!!draft.id} onChange={event => setDraft({ ...draft, projectId: event.target.value })}>{scopes.map(scope => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</select></label>
        <label className="p-field"><span>Categoria</span><select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}>{Object.entries(CATEGORY).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
        <label className="p-field"><span>Situação</span><select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>{Object.entries(STATUS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      </div>
      <label className="p-field"><span>O que pode dar errado</span><input value={draft.title} maxLength={160} required placeholder="Ex.: chuva forte no dia do evento ao ar livre" onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
      <label className="p-field"><span>Detalhes (opcional)</span><textarea rows={2} value={draft.description} maxLength={2000} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label>
      <div className={styles.formGrid}>
        <label className="p-field"><span>Probabilidade</span><select value={draft.probability} onChange={event => setDraft({ ...draft, probability: Number(event.target.value) })}>{SCALE.map((text, index) => <option key={text} value={index + 1}>{text}</option>)}</select></label>
        <label className="p-field"><span>Impacto</span><select value={draft.impact} onChange={event => setDraft({ ...draft, impact: Number(event.target.value) })}>{SCALE.map((text, index) => <option key={text} value={index + 1}>{text.replace('baixa', 'baixo').replace('alta', 'alto').replace('média', 'médio')}</option>)}</select></label>
        <div className="p-field"><span>Nível</span><span className={`${styles.badgeLevel} ${styles[`lvl-${levelOf(draft.probability, draft.impact)}`]}`} style={{ justifySelf: 'start', marginTop: 10 }}>{LEVEL[levelOf(draft.probability, draft.impact)]} ({draft.probability * draft.impact})</span></div>
      </div>
      <div className={styles.formGrid}>
        <label className="p-field"><span>Dono (pessoa ou função)</span><input value={draft.ownerLabel} maxLength={120} placeholder="Ex.: Coordenação de Eventos" onChange={event => setDraft({ ...draft, ownerLabel: event.target.value })}/></label>
        <label className="p-field"><span>Próxima revisão</span><DateField aria-label="Data da próxima revisão" value={draft.reviewOn} onValueChange={value => setDraft({ ...draft, reviewOn: value })}/></label>
      </div>
      <label className="p-field"><span>Como evitar ou reduzir</span><textarea rows={2} value={draft.mitigation} maxLength={2000} placeholder="Ex.: reservar tenda e ter plano B em local coberto" onChange={event => setDraft({ ...draft, mitigation: event.target.value })}/></label>
      <div className={styles.actions}><button type="submit" className="p-button p-button-primary" disabled={saving}>{saving && <LoaderCircle size={15} className="p-spin" aria-hidden="true"/>}{draft.id ? 'Salvar alterações' : 'Registrar risco'}</button><button type="button" className="p-button p-button-subtle" onClick={() => setDraft(null)}>Cancelar</button></div>
    </form>}
    <div className={styles.grid2}>
      <section className={styles.card} aria-labelledby="risk-map">
        <header><h3 id="risk-map">Mapa dos riscos abertos</h3>{cell && <button type="button" className="p-button p-button-subtle" onClick={() => setCell(null)}>Mostrar todos</button>}</header>
        <div className={styles.matrixWrap}>
          <span className={styles.axisY}>Impacto</span>
          <span className={styles.ticksY} aria-hidden="true">{[5, 4, 3, 2, 1].map(value => <span key={value}>{value}</span>)}</span>
          <div className={styles.matrix}>{matrix.map((row, rowIndex) => row.map((count, column) => {
            const probability = column + 1, impact = 5 - rowIndex, active = cell?.[0] === probability && cell?.[1] === impact;
            return <button key={`${rowIndex}-${column}`} type="button" className={`${styles.cell} ${styles[`lvl-${levelOf(probability, impact)}`]} ${count ? '' : styles.cellZero}`} data-active={active}
              aria-pressed={active} aria-label={`Impacto ${impact}, probabilidade ${probability}: ${count} ${count === 1 ? 'risco' : 'riscos'}`} disabled={!count && !active} onClick={() => setCell(active ? null : [probability, impact])}>{count || '·'}</button>;
          }))}</div>
          <span className={styles.ticksX} aria-hidden="true">{[1, 2, 3, 4, 5].map(value => <span key={value}>{value}</span>)}</span>
          <span className={styles.axisX}>Probabilidade</span>
        </div>
        <div className={styles.legend}>{(Object.keys(LEVEL) as Risk['level'][]).map(key => <span key={key}><i className={styles[`lvl-${key}`]}/>{LEVEL[key]}</span>)}</div>
      </section>
      <section className={styles.card} aria-labelledby="risk-filter">
        <header><h3 id="risk-filter">Filtrar</h3></header>
        <label className="p-field" style={{ maxWidth: 'none' }}><span>Mostrar</span><select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">Todos os riscos que você vê</option><option value="overdue">Com revisão vencida</option>
          {data.canEditOrganization && <option value="organization">Da organização</option>}
          {data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        <dl className={styles.levels} aria-label="Riscos abertos por nível">{(Object.keys(LEVEL) as Risk['level'][]).map(key => <div key={key} className={styles[`lvl-${key}`]}><dt>{LEVEL[key]}</dt><dd>{data.risks.filter(risk => risk.level === key && (risk.status === 'open' || risk.status === 'monitoring')).length}</dd></div>)}</dl>
        <p className={styles.help}>{visible.length} de {data.risks.length} {data.risks.length === 1 ? 'risco' : 'riscos'}{cell ? ` na célula probabilidade ${cell[0]} × impacto ${cell[1]}` : ''}.</p>
      </section>
    </div>
    {visible.length ? <ul className={styles.riskList}>{visible.map(risk => <li key={risk.id} className={styles.risk} data-level={risk.level}>
      <header><h4>{risk.title}</h4><div className={styles.badges}>
        <span className={`${styles.badgeLevel} ${styles[`lvl-${risk.level}`]}`}>{LEVEL[risk.level]} · {risk.probability}×{risk.impact}</span>
        {risk.reviewOverdue && <span className={styles.badgeOverdue}>Revisão vencida</span>}
        {risk.isExample && <span className={styles.badgeExample}>Exemplo</span>}
        <span className={styles.pill}>{STATUS[risk.status] ?? risk.status}</span>
      </div></header>
      {risk.description && <p>{risk.description}</p>}
      <dl className={styles.facts}>
        <div><dt>Onde</dt><dd>{risk.projectName ?? 'Organização'}</dd></div>
        <div><dt>Categoria</dt><dd>{CATEGORY[risk.category] ?? risk.category}</dd></div>
        <div><dt>Dono</dt><dd>{risk.ownerLabel || 'a definir'}</dd></div>
        <div><dt>Revisão</dt><dd>{risk.reviewOn ? brDate(risk.reviewOn) : 'sem data'}</dd></div>
      </dl>
      {risk.mitigation && <p><strong>Como evitar:</strong> {risk.mitigation}</p>}
      {risk.canEdit && <div className={styles.actions}>
        <button type="button" className="p-button p-button-subtle" onClick={() => { setDraft({ id: risk.id, version: risk.version, projectId: risk.projectId ?? '', title: risk.title, description: risk.description, category: risk.category, probability: risk.probability, impact: risk.impact, ownerLabel: risk.ownerLabel, mitigation: risk.mitigation, status: risk.status, reviewOn: risk.reviewOn ?? '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button>
        {risk.isExample && <button type="button" className="p-button p-button-subtle" disabled={saving} onClick={() => { if (window.confirm('Apagar este exemplo?')) void send({ action: 'risk.delete', id: risk.id, expectedVersion: risk.version }, 'Exemplo apagado.'); }}>Apagar exemplo</button>}
      </div>}
    </li>)}</ul> : <p className={styles.empty}>{data.risks.length ? 'Nenhum risco neste filtro.' : 'Nenhum risco registrado ainda.'}</p>}
  </div>;
}
