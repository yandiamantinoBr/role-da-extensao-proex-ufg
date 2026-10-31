'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {RefreshCw, UserRoundCheck} from 'lucide-react';
import {isResponsibilityCatalog, isResponsibilityList, isResponsibilityResult, type Responsibility, type ResponsibilityCatalog, type ResponsibilityRevoke, type ResponsibilitySave, type WorkArea} from '@/lib/my-work/contracts';
import {followupChanged} from './follow-up-api';
import {WorkApiError, workApi} from './my-work-api';
import styles from './responsibility-manager.module.css';

/** Mount for one explicit immutable target; designation never grants access to it. */
export type ResponsibilityManagerProps = {
  userId: string;
  projectId: string;
  area: WorkArea;
  itemId?: string | null;
  loanId?: string | null;
  campaignId?: string | null;
  onChanged?: () => void;
};
type Draft = {owner: string; userIds: string[]; teamIds: string[]};
type Load = {key: string; catalog?: ResponsibilityCatalog; record?: Responsibility; error?: string};
type Feedback = {owner: string; message: string; error?: boolean; denied?: boolean};
const names: Record<WorkArea, string> = {projects: 'projeto', materials: 'material', loans: 'empréstimo', campaigns: 'dinâmica ou evento'};
const ids = (record: Responsibility | undefined, type: 'user_id' | 'team_id') => record?.status === 'active' ? record.assignees.flatMap(person => person[type] ? [person[type]!] : []) : [];
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function sameTarget(row: Responsibility, projectId: string, area: WorkArea, itemId: string | null, loanId: string | null, campaignId: string | null) {
  return row.project_id === projectId && row.area === area && row.item_id === itemId && row.loan_id === loanId && row.campaign_id === campaignId;
}

export default function ResponsibilityManager({userId, projectId, area, itemId = null, loanId = null, campaignId = null, onChanged}: ResponsibilityManagerProps) {
  const owner = JSON.stringify([userId, projectId, area, itemId, loanId, campaignId]);
  const [revision, setRevision] = useState(0), [stored, setStored] = useState<Load | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [feedback, setFeedback] = useState<Feedback | null>(null);
  const [receipt, setReceipt] = useState<{owner: string; id: string} | null>(null);
  const [busyOwner, setBusyOwner] = useState<string | null>(null), [confirmOwner, setConfirmOwner] = useState<string | null>(null);
  const read = useRef<AbortController | null>(null), mutation = useRef<AbortController | null>(null), generation = useRef(0);
  const operation = useRef<{fingerprint: string; key: string} | null>(null), pending = useRef(false);
  const notified = useRef<string | null>(null);
  const key = JSON.stringify([owner, revision]), loaded = stored?.key === key ? stored : null;
  const notice = feedback?.owner === owner ? feedback : null, busy = busyOwner === owner;
  const catalog = notice?.denied ? undefined : loaded?.catalog, record = notice?.denied ? undefined : loaded?.record;
  const canManage = !!catalog?.canManage && (!record || record.canEdit);
  const selected = draft?.owner === owner ? draft : {owner, userIds: ids(record, 'user_id'), teamIds: ids(record, 'team_id')};
  function refresh() {generation.current++; read.current?.abort(); mutation.current?.abort(); pending.current = false; operation.current = null; setBusyOwner(null); setConfirmOwner(null); setDraft(null); setFeedback(null); setRevision(value => value + 1);}
  function toggle(type: 'userIds' | 'teamIds', id: string) {setConfirmOwner(null); setDraft({...selected, [type]: selected[type].includes(id) ? selected[type].filter(value => value !== id) : [...selected[type], id]});}
  // Deliver parent callbacks only from a render that still owns this receipt, including
  // a prop change committed before the old request's passive-effect cleanup runs.
  useEffect(() => {
    if (!receipt || notified.current === receipt.id) return;
    notified.current = receipt.id;
    if (receipt.owner === owner) {followupChanged(); onChanged?.();}
  }, [receipt, owner, onChanged]);
  useEffect(() => {
    const controller = new AbortController(), epoch = ++generation.current;
    read.current = controller;
    const filters = new URLSearchParams({projectId, area, target: 'area'});
    if (itemId) filters.set('itemId', itemId);
    if (loanId) filters.set('loanId', loanId);
    if (campaignId) filters.set('campaignId', campaignId);
    // Entity filters select the exact target; target=area is only for an entity-free designation.
    if (itemId || loanId || campaignId) filters.delete('target');
    const catalogQuery = new URLSearchParams(filters); catalogQuery.set('view', 'catalog');
    const listQuery = new URLSearchParams(filters); listQuery.set('view', 'list'); listQuery.set('status', 'all'); listQuery.set('limit', '2');
    void Promise.all([
      workApi(`/api/responsibilities?${catalogQuery}`, isResponsibilityCatalog, controller.signal),
      workApi(`/api/responsibilities?${listQuery}`, isResponsibilityList, controller.signal),
    ]).then(([nextCatalog, list]) => {
      if (controller.signal.aborted || epoch !== generation.current) return;
      if (nextCatalog.viewerId !== userId || list.viewerId !== userId || nextCatalog.projectId !== projectId || list.projectId !== projectId || list.total > 1 || list.total !== list.items.length || list.hasMore || list.items.some(row => !sameTarget(row, projectId, area, itemId, loanId, campaignId))) throw new Error('A sessão ou o alvo da resposta mudou. Atualize este contexto.');
      setStored({key, catalog: nextCatalog, record: list.items[0]});
    }).catch(error => {
      if (!controller.signal.aborted && epoch === generation.current) setStored({key, error: error instanceof Error ? error.message : 'Não foi possível consultar as designações.'});
    });
    return () => {controller.abort(); mutation.current?.abort(); pending.current = false;};
  }, [key, userId, projectId, area, itemId, loanId, campaignId]);

  async function submit(revoke = false) {
    if (!canManage || pending.current) return;
    if (!revoke && !selected.userIds.length && !selected.teamIds.length) {setFeedback({owner, error: true, message: 'Selecione pelo menos uma pessoa ou equipe. Para encerrar uma designação existente, use Revogar.'}); return;}
    const expectedVersion = record?.version ?? 0;
    const payload = revoke && record ? {action: 'responsibility.revoke' as const, id: record.id, expectedVersion}
      : {action: 'responsibility.save' as const, projectId, area, itemId, loanId, campaignId, expectedVersion, userIds: [...selected.userIds].sort(), teamIds: [...selected.teamIds].sort()};
    const fingerprint = JSON.stringify([owner, payload]);
    if (operation.current?.fingerprint !== fingerprint) operation.current = {fingerprint, key: crypto.randomUUID()};
    const body: ResponsibilitySave | ResponsibilityRevoke = {...payload, operationKey: operation.current.key};
    const controller = new AbortController(), epoch = generation.current;
    mutation.current = controller; pending.current = true; setBusyOwner(owner); setFeedback(null);
    try {
      const result = await workApi('/api/responsibilities', isResponsibilityResult, controller.signal, body);
      if (controller.signal.aborted || epoch !== generation.current) return;
      const row = result.responsibility;
      if (result.viewerId !== userId || !sameTarget(row, projectId, area, itemId, loanId, campaignId) || row.version <= expectedVersion || row.status !== (revoke ? 'revoked' : 'active') || !revoke && (!same(ids(row, 'user_id'), selected.userIds) || !same(ids(row, 'team_id'), selected.teamIds))) throw new Error('A confirmação não corresponde à designação solicitada. Atualize para conferir o resultado.');
      operation.current = null; setDraft(null); setConfirmOwner(null); setStored({key, catalog, record: row});
      setFeedback({owner, message: revoke ? 'Designação revogada.' : 'Responsáveis salvos. A designação não concede novas permissões.'});
      setReceipt({owner, id: body.operationKey});
    } catch (error) {
      if (!controller.signal.aborted && epoch === generation.current) {
        const denied = error instanceof WorkApiError && (error.status === 401 || error.status === 403);
        setFeedback({owner, error: true, denied, message: denied ? 'Seu acesso mudou. A gestão deste registro foi encerrada.' : error instanceof Error ? `${error.message} Sua seleção foi preservada; repita a mesma ação para conferir ou atualize.` : 'Não foi possível confirmar. Sua seleção foi preservada; tente novamente.'});
      }
    } finally {if (!controller.signal.aborted && epoch === generation.current) {pending.current = false; setBusyOwner(null);}}
  }
  function save(event: FormEvent<HTMLFormElement>) {event.preventDefault(); void submit();}
  const confirming = confirmOwner === owner && record?.status === 'active';
  return <section className={styles.panel} aria-label="Responsáveis pelo registro" aria-busy={!loaded || busy}>
    <header className={styles.heading}><div><h3><UserRoundCheck size={18} aria-hidden="true"/> Responsáveis pelo {names[area]}</h3><p>Selecione pessoas ou equipes explicitamente. Criar o registro ou ter um cargo não atribui responsabilidade.</p></div><button type="button" className="p-button" disabled={busy} onClick={refresh}><RefreshCw size={16} aria-hidden="true"/>Recarregar designação</button></header>
    {!loaded && <p role="status" className={styles.notice}>Consultando designação e pessoas elegíveis…</p>}
    {loaded?.error && <p role="alert" className={`${styles.notice} ${styles.error}`}>{loaded.error}</p>}
    {notice && <p role={notice.error ? 'alert' : 'status'} className={`${styles.notice} ${notice.error ? styles.error : ''}`}>{notice.message}</p>}
    {loaded?.catalog && !canManage && !notice?.denied && <p className={styles.notice}>A gestão de responsáveis não está disponível para seu acesso neste contexto.</p>}
    {canManage && <>
      {record?.status === 'revoked' && <p className={styles.notice}>A designação anterior foi revogada. Escolha novos responsáveis para reativá-la; atribuições antigas não são selecionadas automaticamente.</p>}
      {catalog && Object.values(catalog.truncated).some(Boolean) && <p className={styles.help}>O catálogo de registros é parcial. Esta edição se refere somente ao alvo selecionado acima.</p>}
      <form className={styles.form} onSubmit={save}><fieldset disabled={busy}><div className={styles.choices}>
        <fieldset><legend>Pessoas responsáveis</legend><div className={styles.options}>{catalog?.people.map(person => <label key={person.userId}><input type="checkbox" name={`person:${person.userId}`} checked={selected.userIds.includes(person.userId)} onChange={() => toggle('userIds', person.userId)}/><span>{person.name}</span></label>)}{!catalog?.people.length && <p>Nenhuma pessoa elegível neste contexto.</p>}</div></fieldset>
        <fieldset><legend>Equipes responsáveis</legend><div className={styles.options}>{catalog?.teams.map(team => <label key={team.id}><input type="checkbox" name={`team:${team.id}`} checked={selected.teamIds.includes(team.id)} onChange={() => toggle('teamIds', team.id)}/><span>{team.name}</span></label>)}{!catalog?.teams.length && <p>Nenhuma equipe elegível neste contexto.</p>}</div></fieldset>
      </div><p className={styles.summary}>{selected.userIds.length} pessoa{selected.userIds.length !== 1 && 's'} e {selected.teamIds.length} equipe{selected.teamIds.length !== 1 && 's'} selecionadas. A designação não concede acesso ao projeto, estoque ou administração.</p><div className={styles.actions}><button type="submit" className="p-button p-button-primary">{busy ? 'Confirmando…' : record?.status === 'active' ? 'Salvar responsáveis' : 'Designar responsáveis'}</button>{record?.status === 'active' && <button type="button" className={`p-button ${styles.danger}`} onClick={() => setConfirmOwner(owner)}>Revogar designação</button>}</div></fieldset></form>
      {confirming && <section className={styles.confirmation} aria-label="Confirmar revogação"><h4>Revogar esta designação?</h4><p>As pessoas e equipes deixam de ser responsáveis por este registro. O histórico será preservado.</p><div className={styles.actions}><button type="button" className={`p-button ${styles.danger}`} disabled={busy} onClick={() => void submit(true)}>Confirmar revogação</button><button type="button" className="p-button" disabled={busy} onClick={() => setConfirmOwner(null)}>Manter designação</button></div></section>}
    </>}
  </section>;
}
