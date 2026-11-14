'use client';
import AssetDetailsPanel from './asset-details-panel';
import {MATERIAL_ATTENTION_CHANGED} from './material-attention-inbox';
import StockContextFields, {stockContextFields} from './stock-context-fields';
import MaterialMovementHistory, { type HistoryMovement } from './material-movement-history';
import { historyHref } from './history-timeline';
import MaterialMovementPanel from './material-movement-panel';
import DestinationField, { destinationFields, loadDestinations } from './destination-field';
import MaterialOwnershipFields from './material-ownership-fields';
/* Protected same-origin images carry the viewer's session; do not proxy them through an image optimizer. */
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, Camera, Check, History, ImagePlus, LoaderCircle, MapPin, PackagePlus, Pencil, RefreshCw, Star, Trash2, X } from 'lucide-react';
import styles from './material-detail-drawer.module.css';
import DriveSaveButton from './drive-save-button';

type Category = { id: string; label: string; core_kind: string; status: string };
type Material = { id: string; project_id: string; name: string; category: string; category_id: string | null; unit: string; description: string; stock: number; reserved: number; low_stock: number; condition: string; asset_code: string; version: number; owner_unit_id?: string | null; event_destination_id?: string | null };
type Movement = HistoryMovement;
type Ownership = { projectName: string | null; ownerUnit: { id: string; name: string; acronym: string } | null; eventDestination: { id: string; name: string; kind: string; href: string } | null };
type DeletedPhoto = { attachmentId: string; name: string; reason: string; createdAt: string; actorName: string };
type Photo = { id: string; name: string; url: string; caption?: string; title: string };
type PhotoChange = { id: string; attachmentId: string; previousAttachmentId: string | null; url: string | null; previousUrl: string | null; deleted?: boolean; previousDeleted?: boolean; actorName: string; createdAt: string };
type Detail = { item: Material; category: Category | null; categories: Category[]; movements: Movement[]; photos: Photo[]; primaryPhotoId?: string | null; primaryPhotoPinned?: boolean; photoHistory?: PhotoChange[]; deletedPhotos?: DeletedPhoto[]; ownership?: Ownership; availability: { available: number; equipmentState: string | null }; permissions: { canManage: boolean; canUploadPhotos: boolean }; versions: {id:string;version:number;created_at:string}[]; historyTruncated: boolean; nextCursor: string | null };
export type MaterialDrawerMode = 'view' | 'edit' | 'move' | 'history';
type Props = { onUnitOpen?:(unitId:string)=>void; onDestinationOpen?:(destinationId:string)=>void; itemId: string | null; initialMode?: MaterialDrawerMode; onClose: () => void; onChanged?: () => void | Promise<void>; renderWorkContext?: (context: {itemId: string; projectId: string}) => ReactNode };
type Upload = { file: File; previewUrl: string; warnings: string[]; recordId: string | null; recordKey: string; uploadKey: string; primaryKey: string; attachmentId: string | null; occurredAt: string; title: string };
const kindNames: Record<string, string> = { gift: 'Brindes', equipment: 'Equipamentos', distribution: 'Distribuição institucional', consumption: 'Consumo interno' };
const conditionNames: Record<string, string> = { active: 'Em uso', maintenance: 'Em manutenção', inactive: 'Fora de uso', out: 'Emprestado', reserved: 'Reservado' };
const when = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
async function jsonResponse(response: Response) {
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Não foi possível concluir. Tente novamente.');
  return data;
}
async function action(name: string, payload: Record<string, unknown>) {
  return jsonResponse(await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: name, ...payload }) }));
}
/** Light checks that catch accidental shots (dark webcam frame, tiny or blank picture). Advisory only. */
function photoWarnings(image: HTMLImageElement): string[] {
  const warnings: string[] = [];
  if (Math.max(image.naturalWidth, image.naturalHeight) < 480) warnings.push('A foto tem pouca resolução.');
  try {
    const probe = document.createElement('canvas'); probe.width = 24; probe.height = 24;
    const context = probe.getContext('2d', { willReadFrequently: true }); if (!context) return warnings;
    context.drawImage(image, 0, 0, 24, 24); const pixels = context.getImageData(0, 0, 24, 24).data; let sum = 0, square = 0;
    for (let index = 0; index < pixels.length; index += 4) { const light = .2126 * pixels[index] + .7152 * pixels[index + 1] + .0722 * pixels[index + 2]; sum += light; square += light * light; }
    const count = pixels.length / 4, mean = sum / count, spread = Math.sqrt(Math.max(0, square / count - mean * mean));
    if (mean < 50) warnings.push('A foto parece muito escura.'); else if (spread < 12) warnings.push('A foto parece quase lisa, sem o material em destaque.');
  } catch { /* The preview itself remains the main check. */ }
  return warnings;
}
async function preparedPhoto(file: File): Promise<{ file: File; warnings: string[] }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Escolha uma foto JPEG, PNG ou WebP.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Escolha uma foto com até 25 MB para preparar o envio.');
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image(); image.src = url; await image.decode();
    const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight)), warnings = photoWarnings(image);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Não foi possível preparar esta foto.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Não foi possível preparar esta foto.')), 'image/jpeg', .88));
    return { file: new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'foto'}.jpg`, { type: 'image/jpeg' }), warnings };
  } finally { URL.revokeObjectURL(url); }
}
/** "28 unidades", "1 unidade"; unidades já no plural ficam como estão. */
function unitLabel(count: unknown, unit: unknown): string { const name = String(unit || 'unidade'); return Math.abs(Number(count)) === 1 || /s$/i.test(name) ? name : `${name}s`; }
export default function MaterialDetailDrawer(props: Props) { return props.itemId ? <MaterialDialog key={`${props.itemId}:${props.initialMode ?? 'view'}`} {...props} itemId={props.itemId} /> : null; }
function MaterialDialog({ itemId, initialMode = 'view', onClose, onChanged, renderWorkContext, onDestinationOpen }: Omit<Props, 'itemId'> & { itemId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null), mounted = useRef(false);
  const cameraInput = useRef<HTMLInputElement>(null), galleryInput = useRef<HTMLInputElement>(null);
  const requestNumber = useRef(0), movementKey = useRef<string | null>(null), categoryKey = useRef<string | null>(null), photoSelection = useRef(0);
  const [loaded, setData] = useState<Detail | null>(null), [tab, setTab] = useState<'summary' | 'move' | 'asset' | 'history' | 'photos' | 'work'>(initialMode === 'move' ? 'move' : initialMode === 'history' ? 'history' : 'summary');
  const data = loaded?.item.id === itemId ? loaded : null;
  const [editing, setEditing] = useState(initialMode === 'edit');
  const editTrigger = useRef<HTMLButtonElement>(null), editHeading = useRef<HTMLHeadingElement>(null), moveHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<MaterialDrawerMode | null>(initialMode === 'view' || initialMode === 'history' ? null : initialMode);
  const visibleTab = data && !data.permissions.canManage && (tab === 'move' || tab === 'asset') ? 'summary' : tab;
  const editOpen = Boolean(data?.permissions.canManage && editing && visibleTab === 'summary');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loadingMore, setLoadingMore] = useState(false);
  const [confirmPrimary, setConfirmPrimary] = useState<string | null>(null), [confirmWarnings, setConfirmWarnings] = useState<string[]>([]);
  const [upload, setUpload] = useState<Upload | null>(null), [preparing, setPreparing] = useState(false), [moveKind, setMoveKind] = useState('');
  const [openMovementId, setOpenMovementId] = useState<string | null>(null), [removingPhoto, setRemovingPhoto] = useState<string | null>(null), photoDeleteKey = useRef<string | null>(null);
  const reload = useCallback(async () => {
    const requestId = ++requestNumber.current;
    try {
      const response = await fetch(`/api/materials/${encodeURIComponent(itemId)}`, { cache: 'no-store' });
      const payload = await jsonResponse(response) as unknown as Detail;
      if (payload?.item?.id !== itemId || typeof payload.item.project_id !== 'string' || !payload.item.project_id) throw new Error('A resposta não corresponde ao material solicitado.');
      if (requestNumber.current === requestId) setData(payload);
    } catch (failure) {
      if (requestNumber.current === requestId) setData(null);
      throw failure;
    }
  }, [itemId]);
  useEffect(() => {
    const node = dialog.current;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    opener.current = typeof HTMLElement !== 'undefined' && active instanceof HTMLElement && active !== document.body && active !== document.documentElement && !node?.contains(active) ? active : null;
    mounted.current = true;
    node?.showModal();
    void reload().catch(failure => setError(failure instanceof Error ? failure.message : 'Não foi possível carregar este material.'));
    const activeRequest = requestNumber;
    return () => { mounted.current = false; activeRequest.current++; if (node?.open) node.close(); };
  }, [reload]);
  useEffect(() => {
    if (!data?.permissions.canManage || !pendingFocus.current) return;
    const target = pendingFocus.current === 'edit' && editOpen ? editHeading.current : pendingFocus.current === 'move' && visibleTab === 'move' ? moveHeading.current : null;
    if (!target) return;
    pendingFocus.current = null;
    target.focus({preventScroll: true});
    target.scrollIntoView({block: 'nearest'});
  }, [data?.item.id, data?.permissions.canManage, editOpen, visibleTab]);
  function openEditor() {
    if (!data?.permissions.canManage || busy) return;
    pendingFocus.current = 'edit';
    setTab('summary'); setEditing(true); setError('');
    if (editOpen) { pendingFocus.current = null; editHeading.current?.focus(); }
  }
  function closeEditor() {
    if (busy) return;
    pendingFocus.current = null; setEditing(false);
    editTrigger.current?.focus({preventScroll: true});
  }
  function openMovement() {
    if (!data?.permissions.canManage || busy) return;
    pendingFocus.current = 'move'; setTab('move'); setError('');
    if (visibleTab === 'move') { pendingFocus.current = null; moveHeading.current?.focus(); }
  }
  function closed() {
    // A queued close from an unmounted/reopened dialog must not steal the new target's focus.
    if (!mounted.current || dialog.current?.open) return;
    mounted.current = false;
    if (typeof document !== 'undefined') {
      if (opener.current?.isConnected) opener.current.focus({preventScroll: true});
      if (!opener.current?.isConnected || document.activeElement !== opener.current) document.getElementById('main')?.focus({preventScroll: true});
    }
    onClose();
  }
  async function saved(message: string) {
    window.dispatchEvent(new Event(MATERIAL_ATTENTION_CHANGED));
    setNotice(message);
    try { await reload(); await onChanged?.(); }
    catch { setNotice(`${message} A atualização da tela está pendente; use Atualizar.`); }
  }
  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || busy) return;
    const form = event.currentTarget, fields = new FormData(form), quantity = Number(fields.get('quantity'));
    if (!moveKind) { setError('Escolha o que aconteceu: recebimento, entrega, consumo ou ajuste.'); return; }
    if (!Number.isSafeInteger(quantity) || quantity < 1) { setError('Informe uma quantidade inteira maior que zero.'); return; }
    const delta = moveKind === 'receive' || (moveKind === 'adjust' && fields.get('direction') !== 'remove') ? quantity : -quantity;
    movementKey.current ??= crypto.randomUUID(); setBusy(true); setError(''); setNotice('');
    try { await action('stock.move', { itemId, kind: moveKind, delta, reason: fields.get('reason'), ...stockContextFields(fields), ...destinationFields(fields), operationKey: movementKey.current }); movementKey.current = null; form.reset(); setMoveKind(''); loadDestinations(data.item.project_id, true).catch(() => undefined); await saved('Movimentação registrada no histórico.'); setTab('history'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível registrar. Tente novamente.'); }
    finally { setBusy(false); }
  }
  async function updateMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || busy) return;
    const fields = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await action('item.update', { id: itemId, expectedVersion: data.item.version, name: fields.get('name'), unit: fields.get('unit'), description: fields.get('description'), assetCode: fields.get('assetCode'), lowStock: Number(fields.get('lowStock')), condition: fields.get('condition'), categoryId: fields.get('categoryId') || null, ...(fields.has('ownerUnitId') ? { ownerUnitId: fields.get('ownerUnitId') || null, eventDestinationId: fields.get('eventDestinationId') || null } : {}) }); await saved('Cadastro atualizado.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar.'); }
    finally { setBusy(false); }
  }
  async function restoreMetadata(version: number) {
    if (!data || busy) return;
    setBusy(true); setError('');
    try { await action('item.restore', { id: itemId, expectedVersion: data.item.version, restoreVersion: version }); await saved('Cadastro restaurado em uma nova versão. Os saldos e as movimentações foram preservados.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível restaurar o cadastro.'); }
    finally { setBusy(false); }
  }
  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || busy) return;
    const form = event.currentTarget, fields = new FormData(form); categoryKey.current ??= crypto.randomUUID(); setBusy(true); setError('');
    try { await action('material.category.create', { projectId: data.item.project_id, label: fields.get('label'), description: fields.get('description'), coreKind: data.item.category, operationKey: categoryKey.current }); categoryKey.current = null; form.reset(); await saved('Categoria criada. Selecione-a no cadastro do material.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível criar a categoria.'); }
    finally { setBusy(false); }
  }
  function discardUpload() { setUpload(current => { if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl); return null; }); }
  async function choosePhoto(file?: File) {
    if (!file || !data) return;
    const selected = ++photoSelection.current; setPreparing(true); setError(''); setNotice(''); setConfirmPrimary(null);
    try { const prepared = await preparedPhoto(file); if (selected === photoSelection.current) { discardUpload(); setUpload({ file: prepared.file, previewUrl: URL.createObjectURL(prepared.file), warnings: prepared.warnings, recordId: null, recordKey: crypto.randomUUID(), uploadKey: crypto.randomUUID(), primaryKey: crypto.randomUUID(), attachmentId: null, occurredAt: new Date().toISOString(), title: `Foto de ${data.item.name}` }); } }
    catch (failure) { if (selected === photoSelection.current) setError(failure instanceof Error ? failure.message : 'Não foi possível preparar esta foto.'); }
    finally { if (selected === photoSelection.current) setPreparing(false); }
  }
  async function choosePrimary(attachmentId: string, expected: string | null, operationKey: string) {
    await action('item.photo.primary', { itemId, attachmentId, expectedAttachmentId: expected, operationKey });
  }
  /** Two steps: upload the photo (kept forever), then, only if asked, point the material to it. */
  async function sendPhoto(primary: boolean) {
    if (!upload || !data || busy) return;
    const selected = upload, shownPrimary = data.primaryPhotoId ?? null; setBusy(true); setError('');
    try {
      // "Only add" must not silently change the main photo of a material that never had an explicit choice.
      if (!primary && !selected.attachmentId && shownPrimary && !data.primaryPhotoPinned) await choosePrimary(shownPrimary, shownPrimary, `${selected.primaryKey}-keep`);
      let recordId = selected.recordId, attachmentId = selected.attachmentId;
      if (!attachmentId) {
        if (!recordId) {
          const response = await jsonResponse(await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: 'create', projectId: data.item.project_id, kind: 'material', itemId, title: selected.title, body: '', occurredAt: selected.occurredAt, operationKey: selected.recordKey }) }));
          recordId = String(response.id); setUpload({ ...selected, recordId });
        }
        const form = new FormData(); form.set('recordId', recordId); form.set('file', selected.file); form.set('operationKey', selected.uploadKey);
        const stored = await jsonResponse(await fetch('/api/records', { method: 'POST', headers: { 'X-Proex-Action': '1' }, body: form }));
        attachmentId = String((stored.attachment as { id?: unknown } | undefined)?.id ?? ''); setUpload({ ...selected, recordId, attachmentId });
      }
      if (primary && attachmentId) await choosePrimary(attachmentId, shownPrimary, selected.primaryKey);
      discardUpload(); await saved(primary ? 'Foto principal trocada. A anterior continua no histórico.' : 'Foto adicionada à galeria do material.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar. Use o botão de novo para tentar.'); }
    finally { setBusy(false); }
  }
  async function promotePhoto(photoId: string) {
    if (!data || busy) return;
    setBusy(true); setError('');
    try { await choosePrimary(photoId, data.primaryPhotoId ?? null, crypto.randomUUID()); setConfirmPrimary(null); await saved('Foto principal trocada. A anterior continua no histórico.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível trocar a foto principal.'); }
    finally { setBusy(false); }
  }
  async function deletePhoto(event: FormEvent<HTMLFormElement>, photoId: string) {
    event.preventDefault(); if (!data || busy) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? ''); photoDeleteKey.current ??= crypto.randomUUID(); setBusy(true); setError('');
    try { await action('item.photo.delete', { itemId, attachmentId: photoId, reason, operationKey: photoDeleteKey.current }); photoDeleteKey.current = null; setRemovingPhoto(null); await saved('Foto excluída. Quem excluiu, quando e o motivo ficam no histórico.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível excluir a foto.'); }
    finally { setBusy(false); }
  }
  async function olderMovements() {
    if (!data?.nextCursor || loadingMore) return;
    const previous = data, requestId = requestNumber.current; setLoadingMore(true); setError('');
    try { const payload = await jsonResponse(await fetch(`/api/materials/${encodeURIComponent(itemId)}?before=${encodeURIComponent(previous.nextCursor!)}`, { cache: 'no-store' })) as unknown as Detail; if (requestId === requestNumber.current) setData(current => current ? { ...current, movements: [...previous.movements, ...payload.movements], nextCursor: payload.nextCursor, historyTruncated: payload.historyTruncated } : current); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível carregar o histórico.'); }
    finally { setLoadingMore(false); }
  }
  const close = () => { if (!busy && !preparing) dialog.current?.close(); };
  return <dialog ref={dialog} className={styles.dialog} data-mode={editOpen?'edit':visibleTab} aria-labelledby="material-detail-title" onClose={closed} onCancel={event => { if (busy || preparing) event.preventDefault(); else if (editOpen) { event.preventDefault(); closeEditor(); } }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={styles.shell}>
      <header className={styles.header}><div><span className={styles.eyebrow}>CATÁLOGO DE MATERIAIS</span><h2 id="material-detail-title">{data?.item.name || 'Detalhes do material'}</h2><p>{data?.category?.label || (data ? kindNames[data.item.category] : 'Carregando cadastro…')}</p></div><button type="button" className="p-icon-button" onClick={close} disabled={busy || preparing} aria-label="Fechar detalhes"><X size={22}/></button></header>
      <div className={styles.toolbar}><nav aria-label="Detalhes do material">{([['summary', 'Resumo'], ...(data?.permissions.canManage ? [['move', 'Movimentar']] : []), ...(data?.permissions.canManage && data.item.category === 'equipment' ? [['asset', 'Patrimônio']] : []), ['history', 'Histórico'], ['photos', 'Fotos'], ...(data && renderWorkContext ? [['work', 'Acompanhamento']] : [])] as [typeof tab, string][]).map(([key, label]) => <button type="button" key={key} disabled={busy} className={visibleTab === key ? styles.activeTab : ''} aria-current={visibleTab === key ? 'page' : undefined} onClick={() => { if (key === 'move') openMovement(); else { pendingFocus.current = null; setTab(key); setError(''); } }}>{label}</button>)}</nav><button className="p-icon-button" onClick={() => void reload().catch(failure => setError(failure.message))} aria-label="Atualizar material" disabled={busy}><RefreshCw size={17}/></button></div>
      {data?.permissions.canManage && <div className={styles.recordActions} aria-label="Ações do material"><button ref={editTrigger} type="button" className="p-button p-button-subtle" disabled={busy} aria-expanded={editOpen} aria-controls="material-edit-panel" onClick={openEditor}><Pencil size={16} aria-hidden="true"/>Editar cadastro</button><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={openMovement}><ArrowDownLeft size={16} aria-hidden="true"/>Movimentar estoque</button></div>}
      <div className={styles.body}>
        {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
        {!data ? <div className={styles.empty}><LoaderCircle className="p-spin" size={28}/><p>Carregando os registros do material…</p></div> : <>
          <div className={styles.balances}><div><small>Saldo registrado</small><strong>{data.item.stock}</strong><span>{unitLabel(data.item.stock, data.item.unit)}</span></div><div><small>Reservado em brindes</small><strong>{data.item.reserved}</strong><span>unidades prometidas</span></div><div className={styles.available}><small>{data.item.category === 'equipment' ? 'Disponível agora' : 'Disponível para uso'}</small><strong>{data.availability.available}</strong><span>{data.item.category === 'equipment' ? conditionNames[data.availability.equipmentState || 'active'] || 'Confira a agenda para outra data' : 'saldo após as reservas'}</span></div></div>
          {visibleTab === 'work' && renderWorkContext?.({itemId: data.item.id, projectId: data.item.project_id})}
          {visibleTab === 'summary' && <div className={styles.summary}>{data.photos[0] ? <a href={data.photos[0].url} target="_blank" rel="noreferrer" aria-label="Abrir foto do material"><img src={data.photos[0].url} alt={data.photos[0].caption || data.item.name}/></a> : <div className={styles.noPhoto}><Boxes size={48}/><span>Ainda sem foto</span><button className="p-text-link" onClick={() => setTab('photos')}>Adicionar ou consultar fotos</button></div>}<div><span className={styles.tag}>{conditionNames[data.item.condition] || data.item.condition}</span><p>{data.item.description || 'Inclua uma descrição para facilitar a identificação e o uso deste material.'}</p>{data.item.asset_code && <p><strong>Identificação:</strong> {data.item.asset_code}</p>}<p><strong>Dono:</strong> {data.ownership?.ownerUnit ? `${data.ownership.ownerUnit.acronym ? `${data.ownership.ownerUnit.acronym} · ` : ''}${data.ownership.ownerUnit.name} (guardado em ${data.ownership.projectName ?? 'este projeto'})` : data.ownership?.projectName ?? 'o projeto'}</p>{data.ownership?.eventDestination && <p><strong>Destinado a:</strong> {onDestinationOpen ? <button type="button" className="p-text-link" onClick={() => onDestinationOpen(data.ownership!.eventDestination!.id)}><MapPin size={13} aria-hidden="true"/> {data.ownership.eventDestination.name}</button> : data.ownership.eventDestination.name}</p>}<p className={styles.helper}>Alerta de estoque quando houver {data.item.low_stock} {data.item.unit} ou menos disponíveis.</p></div></div>}
            {data.permissions.canManage && <><section id="material-edit-panel" className={styles.editPanel} hidden={!editOpen} aria-labelledby="material-edit-title" onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !busy) { event.preventDefault(); event.stopPropagation(); closeEditor(); } }}><div className={styles.editHeading}><h3 id="material-edit-title" ref={editHeading} tabIndex={-1}>Editar cadastro do material</h3><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={closeEditor}><X size={15} aria-hidden="true"/>Fechar edição</button></div><form key={data.item.version} onSubmit={updateMetadata} className={styles.form}><fieldset disabled={busy}><label>Nome<input name="name" defaultValue={data.item.name} required maxLength={200}/></label><div className={styles.columns}><label>Categoria<select name="categoryId" defaultValue={data.item.category_id || ''}><option value="">{kindNames[data.item.category]} · sem categoria específica</option>{data.categories.filter(category => category.core_kind === data.item.category && (category.status === 'active' || category.id === data.item.category_id)).map(category => <option key={category.id} value={category.id}>{category.label}{category.status !== 'active' ? ' (arquivada)' : ''}</option>)}</select></label><label>Unidade de controle<input name="unit" defaultValue={data.item.unit} maxLength={40} required/></label></div><label>Descrição<textarea name="description" rows={3} defaultValue={data.item.description} maxLength={2000}/></label><div className={styles.columns}><label>Identificação ou patrimônio<input name="assetCode" defaultValue={data.item.asset_code} maxLength={100}/></label><label>Condição<select name="condition" defaultValue={data.item.condition}><option value="active">Em uso</option><option value="maintenance">Em manutenção</option><option value="inactive">Fora de uso</option></select></label></div><MaterialOwnershipFields projectId={data.item.project_id} projectName={data.ownership?.projectName ?? 'Projeto'} ownerUnitId={data.item.owner_unit_id ?? null} eventDestinationId={data.item.event_destination_id ?? null}/><label>Alertar quando o saldo disponível for igual ou menor que<input name="lowStock" type="number" min="0" max={data.item.category === 'equipment' ? '1' : '1000000'} step="1" defaultValue={data.item.low_stock} required/><small>Informe a quantidade em {data.item.unit}. As unidades reservadas para brindes já são descontadas.</small></label><button className="p-button p-button-primary" type="submit"><Check size={17}/>Salvar cadastro</button></fieldset></form></section>
            {visibleTab === 'summary' && <details className={styles.details}><summary>Criar uma categoria para estes materiais</summary><form onSubmit={createCategory} className={styles.form} onChange={() => { categoryKey.current = null; }}><fieldset disabled={busy}><label>Nome da categoria<input name="label" required maxLength={100} placeholder={data.item.category === 'equipment' ? 'Ex.: Equipamentos de som' : 'Ex.: Materiais para oficinas'}/></label><label>Descrição opcional<input name="description" maxLength={1000}/></label><p className={styles.helper}>A categoria ficará disponível para {kindNames[data.item.category].toLocaleLowerCase('pt-BR')} deste projeto.</p><button className="p-button p-button-subtle" type="submit"><PackagePlus size={17}/>Criar categoria</button></fieldset></form></details>}</>}
          {visibleTab === 'asset' && data.item.category === 'equipment' && data.permissions.canManage && <AssetDetailsPanel itemId={itemId} projectId={data.item.project_id} onSaved={async () => { await reload(); await onChanged?.(); }}/> }
          {visibleTab === 'move' && data.permissions.canManage && <form onSubmit={submitMovement} className={styles.form} onChange={() => { movementKey.current = null; }}><fieldset disabled={busy}><h3 ref={moveHeading} tabIndex={-1} className={styles.focusAnchor}>Registrar uma movimentação</h3><p className={styles.helper}>Escolha o que aconteceu e registre o motivo. O histórico anterior fica preservado.</p><div className={styles.columns}><label>O que aconteceu?<select required value={moveKind} onChange={event => setMoveKind(event.target.value)}><option value="" disabled>Escolha o que aconteceu</option><option value="receive">Recebimento de material</option>{data.item.category !== 'equipment' && <><option value="distribute">Entrega ou distribuição</option><option value="consume">Uso pela equipe</option></>}<option value="adjust">Correção após conferir a contagem</option></select></label><label>Quantidade em {data.item.unit}<input name="quantity" type="number" min="1" max="1000000" step="1" defaultValue="1" required/></label></div>{moveKind === 'adjust' && <label>Como corrigir o saldo?<select name="direction"><option value="add">Acrescentar a quantidade informada</option><option value="remove">Retirar a quantidade informada</option></select></label>}<DestinationField key={moveKind} projectId={data.item.project_id} kind={moveKind}/><StockContextFields projectId={data.item.project_id} kind={moveKind}/><label>Motivo da movimentação<textarea name="reason" rows={4} required maxLength={2000} placeholder={moveKind === 'receive' ? 'Ex.: Recebimento conferido para a próxima ação' : moveKind === 'adjust' ? 'Descreva a diferença encontrada na contagem' : 'Ex.: Entrega à unidade ou uso em uma atividade'}/></label>{data.item.category === 'equipment' && <p className={styles.helper}>Para uma retirada temporária, registre um empréstimo na agenda. Aqui ficam o cadastro do bem e as correções do estoque.</p>}<button className="p-button p-button-primary" type="submit">{busy ? <LoaderCircle className="p-spin" size={17}/> : <Check size={17}/>}Confirmar movimentação</button></fieldset></form>}
          {visibleTab === 'history' && <section><h3 className={styles.sectionTitle}><History size={19}/>Histórico do material</h3><p className="p-form-help"><a className="p-text-link" href={historyHref({ kind: 'item', id: data.item.id }, data.item.project_id)} aria-label="Ver histórico deste material em Registros">Ver histórico<ArrowUpRight size={14} aria-hidden="true"/></a> em Registros: movimentações, empréstimos, demandas e registros deste material, por data.</p>{(data.photoHistory?.length ?? 0) > 0 && <div className={styles.photoHistory}><h4>Trocas da foto principal</h4><ol>{data.photoHistory!.map(change => <li key={change.id}><div className={styles.photoPair}><figure><figcaption>Antes</figcaption>{change.previousUrl ? <a href={change.previousUrl} target="_blank" rel="noreferrer" aria-label="Abrir foto anterior"><img src={change.previousUrl} alt="Foto anterior" loading="lazy"/></a> : <span className={styles.compareEmpty}>{change.previousDeleted ? 'Foto excluída' : 'Sem foto'}</span>}</figure><ArrowUpRight size={16} aria-hidden="true" className={styles.photoArrow}/><figure><figcaption>Depois</figcaption>{change.url ? <a href={change.url} target="_blank" rel="noreferrer" aria-label="Abrir nova foto"><img src={change.url} alt="Nova foto principal" loading="lazy"/></a> : <span className={styles.compareEmpty}>Foto excluída</span>}</figure></div><p><strong>{change.previousAttachmentId ? 'Foto principal trocada' : 'Foto principal definida'}</strong><small>{change.actorName} · {when(change.createdAt)}</small></p></li>)}</ol></div>}{data.permissions.canManage && data.versions.length > 0 && <details className={styles.details}><summary>Versões do cadastro</summary><div className={styles.versions}><p className={styles.helper}>Restaure apenas nome, descrição e configurações. Saldos, reservas e movimentações permanecem no histórico.</p>{data.versions.map(version => <div key={version.id}><span>Versão {version.version} · {when(version.created_at)}</span>{version.version === data.item.version ? <small>Atual</small> : <button className="p-text-link" onClick={() => void restoreMetadata(version.version)} disabled={busy}>Restaurar cadastro</button>}</div>)}</div></details>}<MaterialMovementHistory movements={data.movements} unit={data.item.unit} onOpen={setOpenMovementId} onDestinationOpen={onDestinationOpen}/>{(data.deletedPhotos?.length ?? 0) > 0 && <details className={styles.details}><summary>Fotos excluídas ({data.deletedPhotos!.length})</summary><ul className={styles.deletedList}>{data.deletedPhotos!.map(entry => <li key={entry.attachmentId}><strong>{entry.name}</strong><small>Excluída por {entry.actorName} em {when(entry.createdAt)} · {entry.reason}</small></li>)}</ul></details>}{data.nextCursor && <button className="p-button p-button-subtle" onClick={() => void olderMovements()} disabled={loadingMore}>{loadingMore ? 'Carregando…' : 'Ver movimentações anteriores'}</button>}</section>}
          {visibleTab === 'photos' && <section><h3 className={styles.sectionTitle}><Camera size={19}/>Fotos para identificar o material</h3><p className={styles.helper}>A foto principal aparece no resumo do material. Trocar a foto não apaga as anteriores. Uma foto errada pode ser excluída com o motivo; quem excluiu e quando ficam no histórico.</p>{data.photos.length ? <div className={styles.gallery}>{data.photos.map(photo => { const isPrimary = photo.id === data.primaryPhotoId; return <figure key={photo.id} className={isPrimary ? styles.primaryPhoto : undefined}><a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${photo.caption || photo.name}`}><img src={photo.url} alt={photo.caption || photo.title || data.item.name} loading="lazy"/></a><figcaption>{isPrimary && <b className={styles.primaryBadge}><Star size={12} aria-hidden="true"/>Foto principal</b>}<span>{photo.caption || photo.name}</span><DriveSaveButton source={{ kind: 'record_attachment', id: photo.id }} label={photo.caption || photo.name}/></figcaption>{data.permissions.canUploadPhotos && !isPrimary && (confirmPrimary === photo.id ? <div className={styles.photoConfirm} role="group" aria-label="Confirmar troca da foto principal">{confirmWarnings.length > 0 && <p className={styles.photoWarning} role="note"><AlertTriangle size={15} aria-hidden="true"/><span>{confirmWarnings.join(' ')}</span></p>}<p>Usar esta foto como principal? A atual fica no histórico.</p><div>{confirmWarnings.length > 0 && <button type="button" className="p-button p-button-primary" disabled={busy} onClick={() => setConfirmPrimary(null)}>Manter a atual</button>}<button type="button" className={`p-button ${confirmWarnings.length ? 'p-button-subtle' : 'p-button-primary'}`} disabled={busy} onClick={() => void promotePhoto(photo.id)}>{busy ? 'Trocando…' : confirmWarnings.length ? 'Trocar mesmo assim' : 'Trocar foto'}</button>{confirmWarnings.length === 0 && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setConfirmPrimary(null)}>Cancelar</button>}</div></div> : <button type="button" className={`p-button p-button-subtle ${styles.photoAction}`} disabled={busy || !!upload} onClick={event => { const image = event.currentTarget.closest('figure')?.querySelector('img'); setConfirmWarnings(image?.complete ? photoWarnings(image) : []); setConfirmPrimary(photo.id); setError(''); }}><Star size={15} aria-hidden="true"/>Usar como foto principal</button>)}{data.permissions.canUploadPhotos && (!isPrimary || data.photos.length === 1) && (removingPhoto === photo.id ? <form className={styles.photoConfirm} onSubmit={event => void deletePhoto(event, photo.id)} onChange={() => { photoDeleteKey.current = null; }}><label className={styles.photoReason}>Por que excluir esta foto?<textarea name="reason" rows={2} required minLength={3} maxLength={500} placeholder="Ex.: foto de outro material"/></label>{isPrimary && <p>É a única foto: o material ficará sem foto.</p>}<div><button type="submit" className="p-button p-button-danger" disabled={busy}>{busy ? 'Excluindo…' : 'Excluir foto'}</button><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setRemovingPhoto(null)}>Cancelar</button></div></form> : <button type="button" className={`p-button p-button-subtle ${styles.photoAction}`} disabled={busy || !!upload} onClick={() => { setRemovingPhoto(photo.id); setConfirmPrimary(null); setError(''); }}><Trash2 size={15} aria-hidden="true"/>Excluir foto</button>)}{isPrimary && data.photos.length > 1 && data.permissions.canUploadPhotos && <small className={styles.photoNote}>Para excluir a foto principal, escolha outra antes.</small>}</figure>; })}</div> : <div className={styles.empty}><Camera size={32}/><p>Inclua a primeira foto para ajudar a equipe a reconhecer este material.</p></div>}{data.permissions.canUploadPhotos && <div className={styles.photoUpload}><div className={styles.photoButtons}><button type="button" className="p-button p-button-subtle" disabled={busy || preparing} onClick={() => cameraInput.current?.click()}><Camera size={18} aria-hidden="true"/>Usar câmera</button><input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden disabled={busy || preparing} onChange={event => { void choosePhoto(event.target.files?.[0]); event.target.value = ''; }}/><button type="button" className="p-button p-button-subtle" disabled={busy || preparing} onClick={() => galleryInput.current?.click()}><ImagePlus size={18} aria-hidden="true"/>Escolher foto</button><input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy || preparing} onChange={event => { void choosePhoto(event.target.files?.[0]); event.target.value = ''; }}/></div>{preparing && <p className={styles.helper}>Preparando a foto…</p>}{upload && <div className={styles.photoReview} aria-labelledby="photo-review-title"><h4 id="photo-review-title">Confira antes de salvar</h4><div className={styles.compare}><figure><figcaption>Foto principal hoje</figcaption>{data.photos[0] && data.primaryPhotoId ? <img src={data.photos[0].url} alt="Foto principal atual"/> : <div className={styles.compareEmpty}><Boxes size={28} aria-hidden="true"/>Sem foto</div>}</figure><figure><figcaption>Nova foto</figcaption><img src={upload.previewUrl} alt="Prévia da nova foto"/></figure></div>{upload.warnings.length > 0 && <p className={styles.photoWarning} role="note"><AlertTriangle size={16} aria-hidden="true"/><span>{upload.warnings.join(' ')} Confira se o material aparece bem antes de salvar.</span></p>}<p className={styles.helper}>Nada é salvo até você escolher. A foto principal anterior continua guardada no histórico.</p><div className={styles.photoDecision}>{upload.warnings.length > 0 && <button type="button" className="p-button p-button-primary" onClick={() => { discardUpload(); cameraInput.current?.click(); }} disabled={busy}><Camera size={17} aria-hidden="true"/>Tirar outra foto</button>}<button type="button" className={`p-button ${upload.warnings.length ? 'p-button-subtle' : 'p-button-primary'}`} onClick={() => void sendPhoto(true)} disabled={busy}>{busy ? <LoaderCircle className="p-spin" size={17} aria-hidden="true"/> : <Star size={17} aria-hidden="true"/>}{upload.warnings.length ? 'Usar mesmo assim como principal' : 'Usar como foto principal'}</button><button type="button" className="p-button p-button-subtle" onClick={() => void sendPhoto(false)} disabled={busy}>Só adicionar à galeria</button><button type="button" className="p-button p-button-subtle" aria-label="Descartar foto selecionada" onClick={discardUpload} disabled={busy}><X size={17} aria-hidden="true"/>Descartar</button></div></div>}</div>}</section>}
        </>}
      </div>
    </div>
    {openMovementId && <MaterialMovementPanel key={openMovementId} movementId={openMovementId} onClose={() => setOpenMovementId(null)} onOpenMovement={setOpenMovementId} onDestinationOpen={onDestinationOpen ? id => { setOpenMovementId(null); onDestinationOpen(id); } : undefined} onChanged={async () => { window.dispatchEvent(new Event(MATERIAL_ATTENTION_CHANGED)); await reload().catch(() => undefined); await onChanged?.(); }}/>}
  </dialog>;
}
