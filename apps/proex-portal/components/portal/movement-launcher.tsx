'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, LoaderCircle, Package, Plus, RefreshCw, Search, Trash2, TriangleAlert, X } from 'lucide-react';
import DestinationField, { destinationFields, loadDestinations } from './destination-field';
import StockContextFields, { stockContextFields } from './stock-context-fields';
import styles from './movement-launcher.module.css';

/** Same limit as the server (lib/materials.ts MAX_OUTFLOW_LINES). */
const MAX_LINES = 30;
/** How many materials the single-material list shows before asking to refine the search. */
const LIST_LIMIT = 60;
export type LauncherMaterial = { id: string; name: string; projectId: string; projectName: string; unit: string; category: string; available: number; active: boolean };
export type LauncherMode = 'one' | 'many';
type Line = { key: number; itemId: string; quantity: string };
type Outcome = { movements: { id: string; itemId: string; itemName: string; unit: string; delta: number }[]; destination?: { name: string } };
type Props = {
  materials: LauncherMaterial[];
  defaultProjectId?: string;
  initialMode?: LauncherMode;
  /** Opens the material sheet: 'move' to record there, 'history' to see (and correct or undo) what was recorded. */
  onOpenMaterial: (id: string, mode: 'move' | 'history') => void;
  /** Rejects with an Error; `uncertain: true` on it means the reply was lost and the write may have happened. */
  mutate: (action: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onClose: () => void;
};
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
/** "28 unidades", "1 unidade"; units already in the plural stay as they are (same rule as the material sheet). */
const unitLabel = (count: number, unit: string) => { const name = unit || 'unidade'; return Math.abs(count) === 1 || /s$/i.test(name) ? name : `${name}s`; };
const amount = (value: number, unit: string) => `${value.toLocaleString('pt-BR')} ${unitLabel(value, unit)}`;
const blankLines = (next: { current: number }): Line[] => [{ key: next.current++, itemId: '', quantity: '1' }, { key: next.current++, itemId: '', quantity: '1' }];

/**
 * "Registrar movimento": one way in. A single material is recorded in its own sheet (history, correct, undo and
 * attachments live there); several materials leaving together are recorded here in one operation.
 */
export default function MovementLauncher({ materials, defaultProjectId = '', initialMode = 'one', onOpenMaterial, mutate, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLElement | null>(null), alive = useRef(false), nextKey = useRef(2);
  // The key and the exact payload of a delivery whose reply was lost: resent untouched, so the server recognizes it.
  const key = useRef<string | null>(null), pending = useRef<Record<string, unknown> | null>(null);
  const message = useRef<HTMLParagraphElement & HTMLDivElement>(null), done = useRef<HTMLParagraphElement>(null);
  const [mode, setMode] = useState<LauncherMode>(initialMode), [query, setQuery] = useState('');
  const outgoing = useMemo(() => materials.filter(material => material.category !== 'equipment' && material.active), [materials]);
  // A joint delivery needs at least two materials of the same project.
  const projects = useMemo(() => [...new Map(outgoing.map(material => [material.projectId, material.projectName])).entries()].map(([id, name]) => ({ id, name }))
    .filter(project => outgoing.filter(material => material.projectId === project.id).length >= 2).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [outgoing]);
  const [projectId, setProjectId] = useState(() => projects.some(project => project.id === defaultProjectId) ? defaultProjectId : projects.length === 1 ? projects[0].id : '');
  const [kind, setKind] = useState('distribute'), [lines, setLines] = useState<Line[]>([{ key: 0, itemId: '', quantity: '1' }, { key: 1, itemId: '', quantity: '1' }]);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false), [outcome, setOutcome] = useState<Outcome | null>(null);
  useEffect(() => {
    alive.current = true;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current;
    node?.showModal();
    return () => { alive.current = false; if (node?.open) node.close(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); };
  }, []);
  // Keyboard and screen readers follow what just happened: the first field of the mode, the error, or the result.
  useEffect(() => { if (!outcome) dialog.current?.querySelector<HTMLElement>('[data-launcher-focus]')?.focus({ preventScroll: true }); }, [mode, outcome]);
  useEffect(() => { if (error) message.current?.focus(); }, [error, uncertain]);
  useEffect(() => { if (outcome) done.current?.focus(); }, [outcome]);
  const close = () => { if (!saving) onClose(); };
  const matches = useMemo(() => { const text = fold(query.trim()); return materials.filter(material => !text || fold(`${material.name} ${material.projectName}`).includes(text)); }, [materials, query]);
  const found = matches.slice(0, LIST_LIMIT);
  const available = outgoing.filter(material => material.projectId === projectId);
  const byId = new Map(available.map(material => [material.id, material]));
  const filled = lines.filter(line => line.itemId && byId.has(line.itemId));
  const units = filled.reduce((total, line) => total + (Number.isSafeInteger(Number(line.quantity)) && Number(line.quantity) > 0 ? Number(line.quantity) : 0), 0);
  const above = filled.filter(line => Number(line.quantity) > (byId.get(line.itemId)?.available ?? 0)).length;
  const edited = () => { key.current = null; pending.current = null; };
  const change = (lineKey: number, patch: Partial<Line>) => { edited(); setLines(current => current.map(line => line.key === lineKey ? { ...line, ...patch } : line)); };
  function chooseProject(id: string) { edited(); setProjectId(id); setLines(blankLines(nextKey)); setError(''); }
  /** Checks the form against what the screen knows and builds the request. Not used for a resend. */
  function draft(form: HTMLFormElement): Record<string, unknown> | null {
    const chosen = lines.filter(line => line.itemId);
    if (chosen.length < 2) { setError('Escolha pelo menos dois materiais. Para um só, use “Um material”.'); return null; }
    for (const line of chosen) {
      const material = byId.get(line.itemId), quantity = Number(line.quantity);
      if (!material) { setError('Um dos materiais não está mais disponível. Escolha de novo.'); return null; }
      if (!Number.isSafeInteger(quantity) || quantity < 1) { setError(`Informe uma quantidade inteira maior que zero para “${material.name}”.`); return null; }
      if (quantity > material.available) { setError(`“${material.name}” só tem ${amount(material.available, material.unit)} no estoque disponível.`); return null; }
    }
    const fields = new FormData(form);
    key.current ??= crypto.randomUUID();
    return { kind, lines: chosen.map(line => ({ itemId: line.itemId, quantity: Number(line.quantity) })), reason: fields.get('reason'), ...stockContextFields(fields), ...destinationFields(fields), operationKey: key.current };
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    // After a lost reply the balance on screen may already count the delivery: resend the same request as it was.
    const payload = pending.current ?? draft(event.currentTarget);
    if (!payload) return;
    pending.current = payload; setSaving(true); setError('');
    try {
      const result = await mutate('stock.move.many', payload);
      edited(); loadDestinations(projectId, true).catch(() => undefined);
      if (alive.current) { setUncertain(false); setOutcome(result as unknown as Outcome); }
    } catch (failure) {
      // A lost reply may hide a delivery that was recorded: keep the request and offer to check. A refusal recorded nothing.
      const lost = Boolean((failure as { uncertain?: boolean } | null)?.uncertain);
      if (!lost) pending.current = null;
      if (alive.current) { setUncertain(lost); setError(lost ? 'Não registre de novo antes de conferir. Toque em “Conferir se foi registrada”: se a saída já foi gravada, ela não se repete; se não foi, é registrada agora. Se fechar, veja o histórico do material antes de tentar outra vez.' : failure instanceof Error ? failure.message : 'Não foi possível registrar. Nada foi gravado; tente novamente.'); }
    } finally { if (alive.current) setSaving(false); }
  }
  function again() { edited(); setOutcome(null); setError(''); setUncertain(false); setLines(blankLines(nextKey)); }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="movement-launcher-title" onCancel={event => { event.preventDefault(); close(); }} onClose={onClose}>
    <header className={styles.header}><div><h2 id="movement-launcher-title"><Package size={21} aria-hidden="true"/>Registrar movimento</h2><p>{outcome ? 'Saída registrada no histórico de cada material.' : 'Escolha se é um material ou vários saindo juntos.'}</p></div><button type="button" className="p-icon-button" aria-label="Fechar" disabled={saving} onClick={close}><X size={20}/></button></header>
    {outcome ? <section className={styles.outcome}>
      <p ref={done} tabIndex={-1} role="status" className={styles.done}><Check size={18} aria-hidden="true"/><span><strong>{outcome.movements.length} materiais</strong> saíram do estoque{outcome.destination ? <> para <strong>{outcome.destination.name}</strong></> : null}.</span></p>
      <ul className={styles.results}>{outcome.movements.map(movement => <li key={movement.id}><span><strong>{movement.itemName}</strong><small>{amount(Math.abs(movement.delta), movement.unit)}</small></span><button type="button" className="p-button p-button-subtle" aria-label={`Abrir a ficha de ${movement.itemName}`} onClick={() => onOpenMaterial(movement.itemId, 'history')}>Abrir ficha<ArrowRight size={15} aria-hidden="true"/></button></li>)}</ul>
      <p className={styles.hint}>Para corrigir ou desfazer uma linha, ou anexar um comprovante, abra a ficha do material.</p>
      <div className={styles.actions}><footer className={styles.footer}><button type="button" className="p-button p-button-subtle" onClick={again}>Registrar outra saída</button><button type="button" className="p-button p-button-primary" onClick={close}>Concluir</button></footer></div>
    </section> : <>
      <div className={styles.modes} role="group" aria-label="Quantos materiais">
        <button type="button" aria-pressed={mode === 'one'} disabled={saving || uncertain} onClick={() => { setMode('one'); setError(''); }}>Um material</button>
        <button type="button" aria-pressed={mode === 'many'} disabled={saving || uncertain} onClick={() => { setMode('many'); setError(''); }}>Vários de uma vez</button>
      </div>
      {mode === 'one' ? <section className={styles.one}>
        <label className={styles.search}><span className="visually-hidden">Buscar material</span><Search size={17} aria-hidden="true"/><input data-launcher-focus name="launcherSearch" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar material" autoComplete="off"/></label>
        <p className={styles.hint}>Toque no material para abrir a ficha em Movimentar. Histórico, corrigir, desfazer e anexos ficam lá.</p>
        {found.length ? <ul className={styles.list}>{found.map(material => <li key={material.id}><button type="button" onClick={() => onOpenMaterial(material.id, 'move')}><span><strong>{material.name}</strong><small>{material.projectName}</small></span><span className={styles.stock}>{material.active ? `${amount(material.available, material.unit)} ${material.available === 1 ? 'disponível' : 'disponíveis'}` : 'Indisponível'}<ArrowRight size={15} aria-hidden="true"/></span></button></li>)}</ul>
          : <p className={styles.empty}>{materials.length ? 'Nenhum material com esse nome.' : 'Você ainda não tem materiais para movimentar. Cadastre um material primeiro.'}</p>}
        {matches.length > found.length && <p className={styles.hint} role="status">Mostrando {found.length} de {matches.length} materiais. Digite parte do nome para achar os demais.</p>}
      </section> : <form onSubmit={save} className={styles.many} onChange={() => { if (!saving && !uncertain) edited(); }}>
        <fieldset disabled={saving || uncertain}>
        <p className={styles.hint}>Para entregas e uso em que vários materiais saem juntos, com o mesmo destino e motivo. Ou tudo é registrado, ou nada. Recebimento e correção de contagem ficam na ficha de cada material.</p>
        {projects.length === 0 ? <p className={styles.empty}>Para dar saída de vários de uma vez, é preciso ter pelo menos dois materiais de consumo ou brinde disponíveis no mesmo projeto.</p> : <>
        <div className={styles.grid}>
          {projects.length > 1 && <label className="p-field"><span>Projeto *</span><select data-launcher-focus name="launcherProject" required value={projectId} onChange={event => chooseProject(event.target.value)}><option value="" disabled>Selecione o projeto</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
          <label className="p-field"><span>O que aconteceu? *</span><select {...(projects.length > 1 ? {} : { 'data-launcher-focus': true })} name="launcherKind" value={kind} onChange={event => setKind(event.target.value)}><option value="distribute">Entrega ou distribuição</option><option value="consume">Uso pela equipe</option></select></label>
        </div>
        {projectId && <>
        <div className={styles.lines} role="group" aria-label="Materiais desta saída">
          {lines.map((line, index) => { const material = byId.get(line.itemId), over = material && Number(line.quantity) > material.available;
            return <div className={styles.line} key={line.key}>
              <label className="p-field"><span>Material {index + 1}</span><select name={`launcherItem${line.key}`} value={line.itemId} onChange={event => change(line.key, { itemId: event.target.value })}><option value="">Selecione o material</option>{available.filter(option => option.id === line.itemId || !lines.some(other => other.itemId === option.id)).map(option => <option key={option.id} value={option.id} disabled={option.available < 1}>{option.name} · {amount(option.available, option.unit)}</option>)}</select></label>
              <label className={`p-field ${styles.quantity}`}><span>Quantidade</span><input name={`launcherQuantity${line.key}`} type="number" inputMode="numeric" min="1" step="1" value={line.quantity} aria-invalid={over || undefined} onChange={event => change(line.key, { quantity: event.target.value })}/></label>
              <button type="button" className={`p-icon-button ${styles.remove}`} aria-label={`Remover ${material?.name ?? `material ${index + 1}`}`} disabled={lines.length <= 2} onClick={() => { edited(); setLines(current => current.filter(other => other.key !== line.key)); }}><Trash2 size={17}/></button>
              {material && (over ? <small className={styles.over} role="alert">Só há {amount(material.available, material.unit)}.</small> : <small className={styles.avail}>Disponível: {amount(material.available, material.unit)}</small>)}
            </div>; })}
          <div className={styles.linesFoot}><button type="button" className="p-button p-button-subtle" disabled={lines.length >= MAX_LINES || lines.length >= available.length} onClick={() => setLines(current => [...current, { key: nextKey.current++, itemId: '', quantity: '1' }])}><Plus size={16}/>Adicionar material</button><span className={above ? styles.totalOver : styles.total} aria-live="polite">{above ? `${above} ${above === 1 ? 'linha acima' : 'linhas acima'} do saldo` : filled.length ? `${filled.length} ${filled.length === 1 ? 'material' : 'materiais'} · ${units.toLocaleString('pt-BR')} no total` : 'Nenhum material escolhido'}</span></div>
        </div>
        <DestinationField key={projectId} projectId={projectId} kind={kind}/>
        <StockContextFields key={projectId} projectId={projectId} kind={kind}/>
        <label className="p-field"><span>Motivo da movimentação *</span><textarea name="reason" rows={3} required maxLength={2000} placeholder="Ex.: Entrega dos materiais do estande"/></label>
        </>}
        </>}
        </fieldset>
        <div className={styles.actions}>
        {error && (uncertain ? <div ref={message} tabIndex={-1} role="alert" className={styles.unsure}><TriangleAlert size={19} aria-hidden="true"/><p><strong>Não sabemos se a saída foi gravada.</strong>{error}</p></div> : <p ref={message} tabIndex={-1} role="alert" className={`p-inline-error ${styles.message}`}>{error}</p>)}
        {projects.length > 0 && <footer className={styles.footer}><button type="button" className="p-button p-button-subtle" disabled={saving} onClick={close}>{uncertain ? 'Fechar sem conferir' : 'Cancelar'}</button><button className="p-button p-button-primary" type="submit" disabled={saving || (!uncertain && (!projectId || filled.length < 2))}>{saving ? <LoaderCircle size={17} className="p-spin"/> : uncertain ? <RefreshCw size={17}/> : <Check size={17}/>}{uncertain ? 'Conferir se foi registrada' : filled.length >= 2 ? `Registrar saída de ${filled.length} materiais` : 'Registrar saída'}</button></footer>}
        </div>
      </form>}
    </>}
  </dialog>;
}
