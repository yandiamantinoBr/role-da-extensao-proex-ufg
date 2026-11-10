'use client';
/* Protected same-origin files carry the viewer's session; do not proxy them through an image optimizer. */
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Check, FileText, History, LoaderCircle, MapPin, Paperclip, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import type { StockContext } from '@/lib/stock-context';
import DateTimeField from './date-time-field';
import DestinationField, { destinationFields, loadDestinations } from './destination-field';
import { MOVEMENT_NAMES, when } from './material-movement-history';
import { UPLOAD_LIMIT_LABEL, MAX_UPLOAD_FILE_BYTES, uploadErrorMessage } from '@/lib/upload-limits';
import styles from './material-movements.module.css';

type Snapshot = { delta: number; note: string; counterpartyName: string | null; processReference: string; beneficiaryReference: string; occurredAt: string; destinationName: string | null; unit: string };
type Revision = { id: string; kind: 'correction' | 'reversal'; actorName: string; createdAt: string; reason: string; targetMovementId: string; replacementMovementId: string | null; before: Snapshot | null; after: Snapshot | null };
type FileRow = { id: string; name: string; mime: string; size: number; createdAt: string; actorName: string; url: string };
type Version = { id: string; delta: number; kind: string; kindLabel: string; note: string; createdAt: string; actorName: string; groupTitle: string | null; context: StockContext | null; destination: { id: string; name: string; kind: string } | null; origin: { via: string; label: string; summary?: string }; status: 'current' | 'corrected' | 'undone'; isMirror: boolean; attachments: FileRow[]; recordId: string | null };
type Detail = { movement: Version; role: 'original' | 'correction' | 'mirror'; rootMovementId: string; currentMovementId: string | null; item: { id: string; projectId: string; name: string; unit: string; stock: number; reserved: number; category: string }; balance: { before: number; after: number; current: number }; versions: Version[]; revisions: Revision[]; deletedAttachments: { attachmentId: string; movementId: string; name: string; reason: string; createdAt: string; actorName: string }[]; permissions: { canManage: boolean; canRevise: boolean; canAttach: boolean } };
/** ISO → value of the device-local date/time field (YYYY-MM-DDTHH:mm). */
const localInput = (iso: string) => { const date = new Date(iso), pad = (value: number) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; };
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`;
async function jsonResponse(response: Response) {
  let data: Record<string, unknown> = {};
  try { data = await response.json() as Record<string, unknown>; } catch { /* platform error page */ }
  if (!response.ok) throw new Error(uploadErrorMessage(response.status, data.error, 'Não foi possível concluir. Tente novamente.'));
  return data;
}
async function portalAction(name: string, payload: Record<string, unknown>) {
  return jsonResponse(await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: name, ...payload }) }));
}
/** Photos are reduced on the device (max 2000 px, JPEG) so a phone picture fits the upload limit. */
async function preparedFile(file: File): Promise<File> {
  if (file.type === 'application/pdf') { if (file.size > MAX_UPLOAD_FILE_BYTES) throw new Error(`O PDF deve ter no máximo ${UPLOAD_LIMIT_LABEL}.`); return file; }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use uma foto (JPEG, PNG ou WebP) ou um PDF.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Escolha uma foto com até 25 MB para preparar o envio.');
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image(); image.src = url; await image.decode();
    const ratio = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Não foi possível preparar esta foto.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Não foi possível preparar esta foto.')), 'image/jpeg', .86));
    if (blob.size > MAX_UPLOAD_FILE_BYTES) throw new Error(`A foto ficou maior que ${UPLOAD_LIMIT_LABEL}. Tente outra.`);
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'comprovante'}.jpg`, { type: 'image/jpeg' });
  } finally { URL.revokeObjectURL(url); }
}
function Changes({ before, after }: { before: Snapshot | null; after: Snapshot | null }) {
  if (!before) return null;
  if (!after) return <ul className={styles.diff}><li>Quantidade: <del>{signed(before.delta)} {before.unit}</del> → anulada</li></ul>;
  const rows: [string, string, string][] = [];
  const add = (label: string, a: string, b: string) => { if (a !== b) rows.push([label, a || '—', b || '—']); };
  add('Quantidade', `${signed(before.delta)} ${before.unit}`, `${signed(after.delta)} ${after.unit}`);
  add('Finalidade', before.note, after.note); add('Destino', before.destinationName ?? '', after.destinationName ?? '');
  add('Unidade ou projeto', before.counterpartyName ?? '', after.counterpartyName ?? ''); add('Processo SEI', before.processReference, after.processReference);
  add('Atendido', before.beneficiaryReference, after.beneficiaryReference); add('Quando aconteceu', when(before.occurredAt), when(after.occurredAt));
  return <ul className={styles.diff}>{rows.map(([label, a, b]) => <li key={label}>{label}: <del>{a}</del> → <strong>{b}</strong></li>)}</ul>;
}

export default function MaterialMovementPanel({ movementId, onClose, onChanged, onOpenMovement, onDestinationOpen }: { movementId: string; onClose: () => void; onChanged?: () => void | Promise<void>; onOpenMovement: (id: string) => void; onDestinationOpen?: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), fileInput = useRef<HTMLInputElement>(null), cameraInput = useRef<HTMLInputElement>(null);
  const keys = useRef<Record<string, string>>({});
  const [data, setData] = useState<Detail | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'view' | 'correct' | 'undo'>('view'), [removing, setRemoving] = useState<string | null>(null);
  const operationKey = (name: string) => (keys.current[name] ??= crypto.randomUUID());
  const reload = useCallback(async () => {
    const payload = await jsonResponse(await fetch(`/api/materials/movements/${encodeURIComponent(movementId)}`, { cache: 'no-store' })) as unknown as Detail;
    if (payload.movement?.id !== movementId) throw new Error('A resposta não corresponde à movimentação.');
    setData(payload);
  }, [movementId]);
  useEffect(() => {
    const node = dialog.current, opener = document.activeElement;
    node?.showModal(); heading.current?.focus({ preventScroll: true });
    const start = window.setTimeout(() => void reload().catch(failure => setError(failure instanceof Error ? failure.message : 'Não foi possível carregar a movimentação.')), 0);
    return () => { window.clearTimeout(start); if (node?.open) node.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }); };
  }, [reload]);
  async function done(message: string) { setNotice(message); setMode('view'); keys.current = {}; await reload().catch(() => undefined); await onChanged?.(); }
  async function submitRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || busy) return;
    const fields = new FormData(event.currentTarget), movement = data.movement;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload: Record<string, unknown> = { movementId: movement.id, mode, reason: fields.get('reason'), operationKey: operationKey(mode) };
      if (mode === 'correct') {
        // An untouched date keeps the recorded instant (seconds included); only a changed one is sent.
        const occurred = String(fields.get('occurredAt') ?? ''), unchanged = occurred === localInput(movement.context?.occurredAt ?? movement.createdAt);
        Object.assign(payload, {
          quantity: Number(fields.get('quantity')), note: fields.get('note'), ...(movement.kind === 'adjust' ? { direction: fields.get('direction') } : {}),
          processReference: fields.get('processReference') ?? '', beneficiaryReference: fields.get('beneficiaryReference') ?? '',
          ...(occurred && !unchanged ? { occurredAt: new Date(occurred).toISOString() } : {}), ...destinationFields(fields),
        });
      }
      const result = await portalAction('stock.revise', payload) as { currentMovementId?: string | null };
      loadDestinations(data.item.projectId, true).catch(() => undefined);
      if (mode === 'correct' && result.currentMovementId) { await onChanged?.(); keys.current = {}; onOpenMovement(result.currentMovementId); return; }
      await done(mode === 'undo' ? 'Movimentação desfeita. O saldo voltou e o registro original continua no histórico.' : 'Correção salva.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }
  async function attach(file?: File) {
    if (!file || !data || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const prepared = await preparedFile(file);
      const { recordId } = await portalAction('stock.evidence.prepare', { movementId: data.movement.id, operationKey: operationKey('evidence') }) as { recordId: string };
      const form = new FormData(); form.set('recordId', recordId); form.set('file', prepared); form.set('operationKey', crypto.randomUUID());
      await jsonResponse(await fetch('/api/records', { method: 'POST', headers: { 'X-Proex-Action': '1' }, body: form }));
      await done('Anexo vinculado a esta movimentação.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível enviar o anexo.'); }
    finally { setBusy(false); }
  }
  async function removeFile(event: FormEvent<HTMLFormElement>, file: FileRow) {
    event.preventDefault(); if (!data || busy) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    setBusy(true); setError('');
    try { await portalAction('stock.attachment.delete', { movementId: data.movement.id, attachmentId: file.id, reason, operationKey: operationKey(`delete:${file.id}`) }); setRemoving(null); await done('Anexo excluído. Quem excluiu, quando e o motivo ficam registrados.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível excluir o anexo.'); }
    finally { setBusy(false); }
  }
  const close = () => { if (!busy) onClose(); };
  const movement = data?.movement, measure = movement?.context?.measurementUnit ?? data?.item.unit ?? '';
  const supersededBy = data?.revisions.find(revision => revision.targetMovementId === movement?.id);
  const ownCorrection = data?.revisions.find(revision => revision.replacementMovementId === movement?.id);
  const deletedHere = data?.deletedAttachments.filter(entry => entry.movementId === movement?.id) ?? [];
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="movement-panel-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClose={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}>
    <div className={styles.shell}>
      <header className={styles.head}><div><span className={styles.eyebrow}>MOVIMENTAÇÃO DE ESTOQUE</span><h2 id="movement-panel-title" ref={heading} tabIndex={-1}>{movement ? `${MOVEMENT_NAMES[movement.kind] ?? movement.kind} de ${Math.abs(movement.delta)} ${measure}` : 'Carregando movimentação…'}</h2><p>{data?.item.name}</p></div><button type="button" className="p-icon-button" aria-label="Fechar movimentação" onClick={close} disabled={busy}><X size={20}/></button></header>
      <div className={styles.body}>
        {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
        {!data || !movement ? !error && <div className={styles.loading}><LoaderCircle className="p-spin" size={22}/>Carregando…</div> : <>
          {data.role === 'mirror' && <div className={`${styles.banner} ${styles.bannerWarn}`}><strong>Lançamento de anulação</strong>Este registro só cancela outra movimentação, para corrigir ou desfazer sem apagar o passado.<br/><button type="button" className="p-text-link" onClick={() => onOpenMovement(data.rootMovementId)}>Abrir a movimentação original</button></div>}
          {supersededBy && <div className={`${styles.banner} ${supersededBy.kind === 'reversal' ? styles.bannerDanger : styles.bannerWarn}`}><strong>{supersededBy.kind === 'reversal' ? `Desfeita por ${supersededBy.actorName}` : `Corrigida por ${supersededBy.actorName}`} em {when(supersededBy.createdAt)}</strong>Motivo: {supersededBy.reason}{data.currentMovementId && <><br/><button type="button" className="p-text-link" onClick={() => onOpenMovement(data.currentMovementId!)}>Abrir a versão atual</button></>}</div>}
          {ownCorrection && movement.status === 'current' && <div className={`${styles.banner} ${styles.bannerOk}`}><strong>Versão corrigida por {ownCorrection.actorName} em {when(ownCorrection.createdAt)}</strong>Motivo: {ownCorrection.reason}</div>}
          <dl className={styles.facts}>
            <div><dt>Saldo antes → depois deste registro</dt><dd className={styles.balance}>{data.balance.before} → {data.balance.after} <span>{data.item.unit} · hoje {data.balance.current}</span></dd></div>
            <div><dt>Quando aconteceu</dt><dd>{when(movement.context?.occurredAt ?? movement.createdAt)}{movement.context?.dateSource !== 'declared' && ' (horário do registro)'}</dd></div>
            <div><dt>Origem do registro</dt><dd>{movement.origin.label}<br/><small>{when(movement.createdAt)}{movement.origin.via === 'assistant' && ' · a pessoa conferiu a prévia antes de gravar'}</small></dd></div>
            {movement.origin.summary && <div className={styles.factWide}><dt>Pedido feito ao Rolê</dt><dd>“{movement.origin.summary}”</dd></div>}
            <div><dt>{movement.kind === 'receive' ? 'Veio de' : 'Destino'}</dt><dd>{movement.destination ? <button type="button" className={styles.linkButton} onClick={() => onDestinationOpen?.(movement.destination!.id)}><MapPin size={13} aria-hidden="true"/> {movement.destination.name}</button> : movement.context?.counterpartyName ?? 'Não informado'}{movement.destination && movement.context?.counterpartyName && <><br/><small>Unidade ou projeto: {movement.context.counterpartyName}</small></>}</dd></div>
            <div className={styles.factWide}><dt>Finalidade</dt><dd>{movement.note || 'Sem observação'}</dd></div>
            <div><dt>Processo e pessoa atendida</dt><dd>{movement.context?.processReference || 'Sem processo'}{movement.context?.beneficiaryReference ? ` · ${movement.context.beneficiaryReference}` : ''}{movement.groupTitle && <><br/><small>Ação: {movement.groupTitle}</small></>}</dd></div>
          </dl>
          {data.permissions.canRevise && mode === 'view' && <div className={styles.actions}><button type="button" className="p-button p-button-primary" onClick={() => { setMode('correct'); setNotice(''); }}><Pencil size={16} aria-hidden="true"/>Corrigir</button><button type="button" className="p-button p-button-subtle" onClick={() => { setMode('undo'); setNotice(''); }}><RotateCcw size={16} aria-hidden="true"/>Desfazer</button></div>}
          {mode !== 'view' && <form className={styles.form} onSubmit={submitRevision}><fieldset disabled={busy} style={{ display: 'contents' }}>
            <h3>{mode === 'undo' ? 'Desfazer esta movimentação' : 'Corrigir esta movimentação'}</h3>
            <p className="p-form-help">{mode === 'undo' ? `O saldo volta ${movement.delta < 0 ? 'a somar' : 'a subtrair'} ${Math.abs(movement.delta)} ${measure}. O registro original continua visível como desfeito.` : 'A versão atual fica marcada como corrigida e uma nova versão entra no lugar. O saldo é ajustado pela diferença.'}</p>
            {mode === 'correct' && <>
              <div className={styles.grid2}><label>Quantidade correta em {measure}<input name="quantity" type="number" min="1" max="1000000" step="1" required defaultValue={Math.abs(movement.delta)}/></label>{movement.kind === 'adjust' ? <label>Ajuste<select name="direction" defaultValue={movement.delta > 0 ? 'add' : 'remove'}><option value="add">Acrescentar</option><option value="remove">Retirar</option></select></label> : <label>Quando aconteceu<DateTimeField aria-label="Quando aconteceu" name="occurredAt" defaultValue={localInput(movement.context?.occurredAt ?? movement.createdAt)}/></label>}</div>
              <label>Finalidade<textarea name="note" rows={2} maxLength={2000} required={movement.kind !== 'adjust'} defaultValue={movement.note}/></label>
              <DestinationField projectId={data.item.projectId} kind={movement.kind} defaultName={movement.destination?.name ?? ''}/>
              <div className={styles.grid2}><label>Processo SEI ou referência<input name="processReference" maxLength={120} defaultValue={movement.context?.processReference ?? ''}/></label><label>Setor, equipe ou pessoa atendida<input name="beneficiaryReference" maxLength={160} defaultValue={movement.context?.beneficiaryReference ?? ''}/></label></div>
              {movement.context?.counterpartyName && <p className="p-form-help">Unidade ou projeto informado ({movement.context.counterpartyName}) é mantido.</p>}
            </>}
            <label>{mode === 'undo' ? 'Por que desfazer?' : 'Por que corrigir?'}<textarea name="reason" rows={2} required minLength={3} maxLength={2000} placeholder={mode === 'undo' ? 'Ex.: lançado em duplicidade' : 'Ex.: foram 150 unidades, conferido no recibo'}/><small>Fica registrado com seu nome e o horário.</small></label>
            <div className={styles.actions}><button type="submit" className={`p-button ${mode === 'undo' ? 'p-button-danger' : 'p-button-primary'}`}>{busy ? <LoaderCircle className="p-spin" size={16}/> : mode === 'undo' ? <RotateCcw size={16} aria-hidden="true"/> : <Check size={16} aria-hidden="true"/>}{mode === 'undo' ? 'Confirmar e desfazer' : 'Salvar correção'}</button><button type="button" className="p-button p-button-subtle" onClick={() => { setMode('view'); setError(''); }}>Cancelar</button></div>
          </fieldset></form>}
          <section className={styles.section} aria-labelledby="movement-files-title"><h3 id="movement-files-title"><Paperclip size={16} aria-hidden="true"/>Anexos desta movimentação</h3>
            {movement.attachments.length ? <div className={styles.files}>{movement.attachments.map(file => <div key={file.id} className={styles.file}>
              {file.mime.startsWith('image/') ? <a href={file.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${file.name}`}><img src={file.url} alt="" loading="lazy"/></a> : <a href={file.url} target="_blank" rel="noreferrer" className={styles.filePdf} aria-label={`Baixar ${file.name}`}><FileText size={34}/></a>}
              <div className={styles.fileBody}><span>{file.name}</span><small>{file.actorName} · {when(file.createdAt)}</small>
                {data.permissions.canAttach && (removing === file.id ? <form className={styles.confirm} onSubmit={event => void removeFile(event, file)}><label>Motivo da exclusão<textarea name="reason" rows={2} required minLength={3} maxLength={500} placeholder="Ex.: foto de outra entrega"/></label><div className={styles.fileActions}><button type="submit" className="p-button p-button-danger" disabled={busy}>Excluir</button><button type="button" className="p-button p-button-subtle" onClick={() => setRemoving(null)}>Cancelar</button></div></form>
                  : <div className={styles.fileActions}><button type="button" className="p-button p-button-subtle" onClick={() => setRemoving(file.id)} disabled={busy}><Trash2 size={14} aria-hidden="true"/>Excluir</button></div>)}
              </div></div>)}</div> : <p className="p-form-help">Nenhum anexo. Inclua a foto da entrega, o papel com o processo CI ou um PDF.</p>}
            {data.permissions.canAttach && <div className={styles.upload}><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => cameraInput.current?.click()}><Camera size={16} aria-hidden="true"/>Tirar foto</button><input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => { void attach(event.target.files?.[0]); event.target.value = ''; }}/><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip size={16} aria-hidden="true"/>Escolher foto ou PDF</button><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => { void attach(event.target.files?.[0]); event.target.value = ''; }}/><p>Foto JPEG, PNG ou WebP, ou PDF de até {UPLOAD_LIMIT_LABEL}. Fica guardado junto das fotos dos materiais, visível para quem consulta este estoque.</p></div>}
            {deletedHere.length > 0 && <div className={styles.deleted}><strong>Anexos excluídos</strong>{deletedHere.map(entry => <span key={entry.attachmentId}>{entry.name} · excluído por {entry.actorName} em {when(entry.createdAt)} · {entry.reason}</span>)}</div>}
          </section>
          {(data.revisions.length > 0) && <section className={styles.section} aria-labelledby="movement-chain-title"><h3 id="movement-chain-title"><History size={16} aria-hidden="true"/>Histórico de alterações</h3><ol className={styles.steps}>
            {(() => { const first = data.versions[0]; return first ? <li><strong>Registro original</strong><small>{first.origin.label} · {when(first.createdAt)}</small>{signed(first.delta)} {measure} · {first.note}{first.id !== movement.id && <><br/><button type="button" className="p-text-link" onClick={() => onOpenMovement(first.id)}>Abrir</button></>}</li> : null; })()}
            {data.revisions.map(revision => <li key={revision.id}><strong>{revision.kind === 'reversal' ? 'Desfeita' : 'Corrigida'} por {revision.actorName}</strong><small>{when(revision.createdAt)} · motivo: {revision.reason}</small><Changes before={revision.before} after={revision.after}/>{revision.replacementMovementId && revision.replacementMovementId !== movement.id && <button type="button" className="p-text-link" onClick={() => onOpenMovement(revision.replacementMovementId!)}>Abrir esta versão</button>}</li>)}
          </ol></section>}
        </>}
      </div>
    </div>
  </dialog>;
}
