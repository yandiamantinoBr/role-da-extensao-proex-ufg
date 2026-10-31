'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, FilePlus2, LoaderCircle, RefreshCw } from 'lucide-react';
import { ASSET_TEXT_FIELDS, assetCurrencyCents, assetMetadata } from '../../lib/asset-metadata';
import { MAX_UPLOAD_FILE_BYTES, UPLOAD_LIMIT_MESSAGE } from '../../lib/upload-limits';
import styles from './asset-details-panel.module.css';

type Row = Record<string, string | number | null>;
type Attachment = { id: string; name: string; mime: string; url: string; size: number };
type Detail = { item: Row; permissions: { canManage: boolean }; attachments: Attachment[]; attachmentsTruncated: boolean; loanHistory: Row[]; loanHistoryTruncated: boolean; movements: Row[]; historyTruncated: boolean; records: Row[]; recordsTruncated: boolean };
type Props = { itemId: string | null; projectId: string; onSaved?: (itemId: string) => void | Promise<void> };
type Proposal = { input: Record<string, unknown>; changes: { label: string; before: unknown; after: unknown; money: boolean }[]; operationKey: string };
type Upload = { file: File; recordId: string | null; recordKey: string; uploadKey: string; occurredAt: string };
const absent = (value: unknown) => value === null || value === undefined || value === '' ? 'Não informado' : String(value);
const previewValue = (value: unknown, money: boolean) => money && typeof value === 'number' ? (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : absent(value);
const when = (value: unknown) => value ? new Date(Number.isFinite(Number(value)) ? Number(value) : String(value)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Não informado';
async function responseJson(response: Response): Promise<Partial<Detail> & { id?: string; error?: string }> { const data = await response.json().catch(() => ({})) as Partial<Detail> & { id?: string; error?: string }; if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Não foi possível concluir a operação. Atualize e confira o cadastro.'); return data; }
export default function AssetDetailsPanel(props: Props) { return props.projectId ? <AssetEditor key={`${props.projectId}:${props.itemId ?? 'new'}`} {...props}/> : null; }
function AssetEditor({ itemId, projectId, onSaved }: Props) {
  const [createdId, setCreatedId] = useState<string | null>(null), [data, setData] = useState<Detail | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null), [upload, setUpload] = useState<Upload | null>(null);
  const activeId = itemId || createdId, sequence = useRef(0), previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (proposal) previewHeading.current?.focus(); }, [proposal]);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    const payload = await responseJson(await fetch(activeId ? `/api/materials/${encodeURIComponent(activeId)}` : `/api/materials?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store', credentials: 'same-origin' }));
    if (current !== sequence.current) return;
    if (activeId && payload.item?.project_id !== projectId) throw new Error('Este bem não pertence ao projeto selecionado.');
    setData(activeId ? payload as Detail : null); setReady(true);
  }, [activeId, projectId]);
  useEffect(() => { void load().catch(reason => setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o patrimônio.')); const counter = sequence; return () => { counter.current++; }; }, [load]);
  const canManage = ready && (!data || data.permissions.canManage);
  async function changed(id: string, message: string) { setNotice(message); try { if (activeId) await load(); await onSaved?.(id); } catch { setNotice(`${message} A atualização da tela está pendente; use Atualizar.`); } }
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canManage || busy) return;
    try {
      const form = new FormData(event.currentTarget), input: Record<string, unknown> = {};
      for (const [key] of ASSET_TEXT_FIELDS) input[key] = form.get(key) || null;
      input.acquisitionDate = form.get('acquisitionDate') || null;
      input.acquisitionValueCents = assetCurrencyCents(String(form.get('acquisitionValue') ?? ''));
      Object.assign(input, assetMetadata(input));
      input.name = String(form.get('name') ?? '').trim(); input.description = String(form.get('description') ?? '').trim(); input.assetCode = String(form.get('assetCode') ?? '').trim();
      if (!input.name) throw new Error('Informe o nome do bem.');
      const changes = [['name','name','Nome'],['description','description','Descrição'],['assetCode','asset_code','Tombamento'],...ASSET_TEXT_FIELDS.map(([key,column,label]) => [key,column,label]),['acquisitionDate','acquisition_date','Data de aquisição'],['acquisitionValueCents','acquisition_value_cents','Valor documentado (R$)']].map(([key,column,label]) => ({ label, before: data?.item[column] ?? null, after: input[key], money: key === 'acquisitionValueCents' })).filter(change => (change.before ?? '') !== (change.after ?? ''));
      if (!changes.length) { setNotice('O cadastro já contém os valores informados.'); return; }
      setError(''); setProposal({ input, changes, operationKey: crypto.randomUUID() });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Confira os campos.'); }
  }
  async function confirm() {
    if (!proposal || busy || !canManage) return; setBusy(true); setError('');
    try {
      const payload = await responseJson(await fetch('/api/portal', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: activeId ? 'item.update' : 'item.create', ...proposal.input, projectId, ...(activeId ? { id: activeId, expectedVersion: data?.item.version } : { category: 'equipment', unit: 'unidade', lowStock: 0, operationKey: proposal.operationKey }) }) }));
      if (typeof payload.item?.id !== 'string') throw new Error('O recibo não trouxe o identificador do bem. Atualize e confira antes de repetir.');
      const savedId = payload.item.id; if (!activeId) setCreatedId(savedId);
      setProposal(null); await changed(savedId, activeId ? 'Metadados registrados em nova versão. Saldo e histórico preservados.' : 'Bem cadastrado com saldo zero. Registre a entrada física somente após conferência.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }
  function chooseFile(file?: File) {
    if (!file) return;
    if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type) || file.size > MAX_UPLOAD_FILE_BYTES || !file.size) { setError(`Escolha um PDF ou uma foto JPEG, PNG ou WebP. ${UPLOAD_LIMIT_MESSAGE}`); return; }
    setError(''); setUpload({ file, recordId: null, recordKey: crypto.randomUUID(), uploadKey: crypto.randomUUID(), occurredAt: new Date().toISOString() });
  }
  async function sendFile() {
    if (!upload || !activeId || busy || !canManage) return; setBusy(true); setError('');
    try {
      let recordId = upload.recordId;
      if (!recordId) {
        const result = await responseJson(await fetch('/api/records', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: 'create', kind: 'material', title: `Documento ou foto de ${String(data?.item.name).slice(0, 130)}`, body: '', projectId, itemId: activeId, occurredAt: upload.occurredAt, operationKey: upload.recordKey }) }));
        if (typeof result.id !== 'string') throw new Error('O recibo não trouxe o identificador do registro. Atualize antes de reenviar.');
        recordId = result.id; setUpload({ ...upload, recordId });
      }
      const form = new FormData(); form.set('recordId', recordId); form.set('file', upload.file); form.set('operationKey', upload.uploadKey);
      await responseJson(await fetch('/api/records', { method: 'POST', credentials: 'same-origin', headers: { 'X-Proex-Action': '1' }, body: form }));
      setUpload(null); await changed(activeId, 'Arquivo privado vinculado ao histórico do bem.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'O envio falhou. Tente novamente para retomar o mesmo registro.'); }
    finally { setBusy(false); }
  }
  return <section className={`p-section ${styles.panel}`} aria-label="Cadastro patrimonial detalhado">
    <div className="p-section-heading"><div><h2>{activeId ? 'Cadastro patrimonial' : 'Cadastrar bem individual'}</h2><p>Preencha somente dados conferidos. Campos sem fonte permanecem ausentes; o tombamento é texto e preserva zeros.</p></div><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => { setProposal(null); void load().catch(reason => setError(reason instanceof Error ? reason.message : 'Falha ao atualizar.')); }}><RefreshCw size={16}/>Atualizar</button></div>
    <p className={styles.help}>Referência operacional do projeto. A situação patrimonial, a unidade e o responsável registrados não concedem acesso nem formalizam transferência no SIPAC/SEI. O estado de disponibilidade continua no controle de materiais.</p>
    {error && <p className="p-inline-error" role="alert">{error}</p>}{notice && <p className="p-form-help" role="status">{notice}</p>}
    {!ready ? <p role="status">Carregando cadastro autorizado…</p> : <>
    <form key={String(data?.item.version ?? 'new')} onSubmit={prepare} className="p-form"><fieldset disabled={!canManage || busy || Boolean(proposal)}><div className={styles.fields}>
      <label className="p-field"><span>Nome do bem *</span><input name="name" required maxLength={200} defaultValue={String(data?.item.name ?? '')}/></label>
      <label className="p-field"><span>Tombamento / patrimônio</span><input name="assetCode" type="text" inputMode="text" maxLength={100} defaultValue={String(data?.item.asset_code ?? '')}/><small>Ex.: 00001234. Não converta para número.</small></label>
      <label className={`p-field ${styles.wide}`}><span>Descrição conferida</span><textarea name="description" maxLength={2000} rows={3} defaultValue={String(data?.item.description ?? '')}/></label>
      {ASSET_TEXT_FIELDS.map(([key,column,label,max]) => <label className="p-field" key={key}><span>{label}</span><input name={key} maxLength={max} defaultValue={String(data?.item[column] ?? '')}/></label>)}
      <label className="p-field"><span>Data de aquisição na fonte</span><input name="acquisitionDate" type="date" defaultValue={String(data?.item.acquisition_date ?? '')}/></label>
      <label className="p-field"><span>Valor de aquisição documentado (R$)</span><input name="acquisitionValue" type="text" inputMode="decimal" placeholder="Ausente até ser comprovado" defaultValue={typeof data?.item.acquisition_value_cents === 'number' ? (data.item.acquisition_value_cents / 100).toFixed(2).replace('.', ',') : ''}/><small>Sem separador de milhar. Valor requer referência de fonte.</small></label>
    </div>{canManage && <button type="submit" className="p-button p-button-primary">Revisar alterações</button>}</fieldset></form>
    {proposal && <section className={styles.preview} aria-label="Prévia das alterações"><h3 ref={previewHeading} tabIndex={-1}>Confira antes de confirmar</h3><p>Dados ausentes continuam ausentes. {activeId ? 'Esta operação não altera estoque nem empréstimos.' : 'Novo equipamento inicia com saldo zero.'}</p><div className={styles.table}><table><thead><tr><th>Campo</th><th>Atual</th><th>Proposto</th></tr></thead><tbody>{proposal.changes.map(change => <tr key={change.label}><th>{change.label}</th><td>{previewValue(change.before, change.money)}</td><td>{previewValue(change.after, change.money)}</td></tr>)}</tbody></table></div><div className={styles.actions}><button type="button" className="p-button p-button-primary" disabled={busy} onClick={() => void confirm()}>{busy ? <LoaderCircle size={16}/> : <Check size={16}/>}Confirmar cadastro</button><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setProposal(null)}>Voltar à edição</button></div></section>}
    {activeId && data && <>
      <details><summary>Fotos e documentos privados ({data.attachments?.length ?? 0})</summary><p className={styles.help}>Acesso depende da permissão vigente neste projeto. Não inclua senhas, CPF ou documentos desnecessários.</p><ul className={styles.list}>{data.attachments?.map(file => <li key={file.id}><a href={file.url} target="_blank" rel="noreferrer">{file.name}</a><small>{file.mime} · {Math.ceil(file.size / 1024)} KiB</small></li>)}</ul>{data.attachmentsTruncated && <p>Exibindo os primeiros 100 anexos. Consulte os registros do projeto para os demais.</p>}{canManage && <div className={styles.actions}><label className="p-field"><span>Selecionar PDF ou foto privada</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = ''; }}/><small>{UPLOAD_LIMIT_MESSAGE}</small></label>{upload && <><span>{upload.file.name}</span><button type="button" className="p-button p-button-primary" disabled={busy} onClick={() => void sendFile()}><FilePlus2 size={16}/>{busy ? 'Enviando…' : 'Confirmar envio privado'}</button><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setUpload(null)}>Cancelar envio</button></>}</div>}</details>
      <details><summary>Histórico de empréstimos ({data.loanHistory?.length ?? 0})</summary><ul className={styles.list}>{data.loanHistory?.map(loan => <li key={String(loan.id)}><strong>{absent(loan.status)}</strong><span>{when(loan.starts_at)} a {when(loan.ends_at)}</span><small>Retirada: {when(loan.checked_out_at)} · Devolução: {when(loan.returned_at)}</small></li>)}</ul>{data.loanHistoryTruncated && <p>Primeiros 100 empréstimos. Consulte a área de empréstimos para os demais.</p>}<p className={styles.help}>Este resumo não expõe dados da pessoa que retirou o bem.</p></details>
      <details><summary>Movimentações e registros</summary><ul className={styles.list}>{data.movements?.map(move => <li key={String(move.id)}><strong>{absent(move.kind)} · {absent(move.delta)}</strong><span>{when(move.created_at)}</span></li>)}{data.records?.map(record => <li key={String(record.id)}><strong>{absent(record.title)}</strong><span>{when(record.occurred_at)}</span></li>)}</ul>{(data.historyTruncated || data.recordsTruncated) && <p>Há mais histórico. Consulte o detalhe de materiais e os registros do projeto.</p>}</details>
    </>}
    </>}
  </section>;
}
