'use client';
import AssetDetailsPanel from './asset-details-panel';
/* Protected same-origin images carry the viewer's session; do not proxy them through an image optimizer. */
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, Boxes, Camera, Check, History, ImagePlus, LoaderCircle, PackagePlus, RefreshCw, X } from 'lucide-react';
import styles from './material-detail-drawer.module.css';

type Category = { id: string; label: string; core_kind: string; status: string };
type Material = { id: string; project_id: string; name: string; category: string; category_id: string | null; unit: string; description: string; stock: number; reserved: number; low_stock: number; condition: string; asset_code: string; version: number };
type Movement = { id: string; delta: number; kind: string; reason: string; created_at: string; actor_name: string; group_title?: string };
type Photo = { id: string; name: string; url: string; caption?: string; title: string };
type Detail = { item: Material; category: Category | null; categories: Category[]; movements: Movement[]; photos: Photo[]; availability: { available: number; equipmentState: string | null }; permissions: { canManage: boolean; canUploadPhotos: boolean }; versions: {id:string;version:number;created_at:string}[]; historyTruncated: boolean; nextCursor: string | null };
type Props = { itemId: string | null; onClose: () => void; onChanged?: () => void | Promise<void>; renderWorkContext?: (context: {itemId: string; projectId: string}) => ReactNode };
type Upload = { file: File; recordId: string | null; recordKey: string; uploadKey: string; occurredAt: string; title: string };
const kindNames: Record<string, string> = { gift: 'Brindes', equipment: 'Equipamentos', distribution: 'Distribuição institucional', consumption: 'Consumo interno' };
const movementNames: Record<string, string> = { receive: 'Recebimento', distribute: 'Distribuição', consume: 'Consumo interno', adjust: 'Correção de contagem', redeem: 'Entrega de brinde', transfer: 'Transferência' };
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
async function preparedPhoto(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Escolha uma foto JPEG, PNG ou WebP.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Escolha uma foto com até 25 MB para preparar o envio.');
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image(); image.src = url; await image.decode();
    const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Não foi possível preparar esta foto.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Não foi possível preparar esta foto.')), 'image/jpeg', .88));
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'foto'}.jpg`, { type: 'image/jpeg' });
  } finally { URL.revokeObjectURL(url); }
}
export default function MaterialDetailDrawer(props: Props) { return props.itemId ? <MaterialDialog key={props.itemId} {...props} itemId={props.itemId} /> : null; }
function MaterialDialog({ itemId, onClose, onChanged, renderWorkContext }: Omit<Props, 'itemId'> & { itemId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null), mounted = useRef(false);
  const cameraInput = useRef<HTMLInputElement>(null), galleryInput = useRef<HTMLInputElement>(null);
  const requestNumber = useRef(0), movementKey = useRef<string | null>(null), categoryKey = useRef<string | null>(null), photoSelection = useRef(0);
  const [loaded, setData] = useState<Detail | null>(null), [tab, setTab] = useState<'summary' | 'move' | 'asset' | 'history' | 'photos' | 'work'>('summary');
  const data = loaded?.item.id === itemId ? loaded : null;
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loadingMore, setLoadingMore] = useState(false);
  const [upload, setUpload] = useState<Upload | null>(null), [preparing, setPreparing] = useState(false), [moveKind, setMoveKind] = useState('receive');
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
  function closed() {
    // A queued close from an unmounted/reopened dialog must not steal the new target's focus.
    if (!mounted.current || dialog.current?.open) return;
    if (typeof document !== 'undefined') {
      if (opener.current?.isConnected) opener.current.focus({preventScroll: true});
      if (!opener.current?.isConnected || document.activeElement !== opener.current) document.getElementById('main')?.focus({preventScroll: true});
    }
    onClose();
  }
  async function saved(message: string) {
    setNotice(message);
    try { await reload(); await onChanged?.(); }
    catch { setNotice(`${message} A atualização da tela está pendente; use Atualizar.`); }
  }
  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || busy) return;
    const form = event.currentTarget, fields = new FormData(form), quantity = Number(fields.get('quantity'));
    if (!Number.isSafeInteger(quantity) || quantity < 1) { setError('Informe uma quantidade inteira maior que zero.'); return; }
    const delta = moveKind === 'receive' || (moveKind === 'adjust' && fields.get('direction') !== 'remove') ? quantity : -quantity;
    movementKey.current ??= crypto.randomUUID(); setBusy(true); setError(''); setNotice('');
    try { await action('stock.move', { itemId, kind: moveKind, delta, reason: fields.get('reason'), operationKey: movementKey.current }); movementKey.current = null; form.reset(); await saved('Movimentação registrada no histórico.'); setTab('history'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível registrar. Tente novamente.'); }
    finally { setBusy(false); }
  }
  async function updateMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || busy) return;
    const fields = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await action('item.update', { id: itemId, expectedVersion: data.item.version, name: fields.get('name'), unit: fields.get('unit'), description: fields.get('description'), assetCode: fields.get('assetCode'), lowStock: Number(fields.get('lowStock')), condition: fields.get('condition'), categoryId: fields.get('categoryId') || null }); await saved('Cadastro atualizado.'); }
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
  async function choosePhoto(file?: File) {
    if (!file || !data) return;
    const selected = ++photoSelection.current; setPreparing(true); setError('');
    try { const prepared = await preparedPhoto(file); if (selected === photoSelection.current) setUpload({ file: prepared, recordId: null, recordKey: crypto.randomUUID(), uploadKey: crypto.randomUUID(), occurredAt: new Date().toISOString(), title: `Foto de ${data.item.name}` }); }
    catch (failure) { if (selected === photoSelection.current) setError(failure instanceof Error ? failure.message : 'Não foi possível preparar esta foto.'); }
    finally { if (selected === photoSelection.current) setPreparing(false); }
  }
  async function sendPhoto() {
    if (!upload || !data || busy) return;
    const selected = upload; setBusy(true); setError('');
    try {
      let recordId = selected.recordId;
      if (!recordId) {
        const response = await jsonResponse(await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: 'create', projectId: data.item.project_id, kind: 'material', itemId, title: selected.title, body: '', occurredAt: selected.occurredAt, operationKey: selected.recordKey }) }));
        recordId = String(response.id); setUpload({ ...selected, recordId });
      }
      const form = new FormData(); form.set('recordId', recordId); form.set('file', selected.file); form.set('operationKey', selected.uploadKey);
      await jsonResponse(await fetch('/api/records', { method: 'POST', headers: { 'X-Proex-Action': '1' }, body: form }));
      setUpload(null); await saved('Foto adicionada ao material.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível enviar. Use Tentar novamente.'); }
    finally { setBusy(false); }
  }
  async function olderMovements() {
    if (!data?.nextCursor || loadingMore) return;
    const previous = data, requestId = requestNumber.current; setLoadingMore(true); setError('');
    try { const payload = await jsonResponse(await fetch(`/api/materials/${encodeURIComponent(itemId)}?before=${encodeURIComponent(previous.nextCursor!)}`, { cache: 'no-store' })) as unknown as Detail; if (requestId === requestNumber.current) setData(current => current ? { ...current, movements: [...previous.movements, ...payload.movements], nextCursor: payload.nextCursor, historyTruncated: payload.historyTruncated } : current); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível carregar o histórico.'); }
    finally { setLoadingMore(false); }
  }
  const close = () => dialog.current?.close();
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="material-detail-title" onClose={closed} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={styles.shell}>
      <header className={styles.header}><div><span className={styles.eyebrow}>CATÁLOGO DE MATERIAIS</span><h2 id="material-detail-title">{data?.item.name || 'Detalhes do material'}</h2><p>{data?.category?.label || (data ? kindNames[data.item.category] : 'Carregando cadastro…')}</p></div><button className="p-icon-button" onClick={close} aria-label="Fechar detalhes"><X size={22}/></button></header>
      <div className={styles.toolbar}><nav aria-label="Detalhes do material">{([['summary', 'Resumo'], ...(data?.permissions.canManage ? [['move', 'Movimentar']] : []), ...(data?.permissions.canManage && data.item.category === 'equipment' ? [['asset', 'Patrimônio']] : []), ['history', 'Histórico'], ['photos', 'Fotos'], ...(data && renderWorkContext ? [['work', 'Acompanhamento']] : [])] as [typeof tab, string][]).map(([key, label]) => <button key={key} className={tab === key ? styles.activeTab : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => { setTab(key); setError(''); }}>{label}</button>)}</nav><button className="p-icon-button" onClick={() => void reload().catch(failure => setError(failure.message))} aria-label="Atualizar material" disabled={busy}><RefreshCw size={17}/></button></div>
      <div className={styles.body}>
        {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
        {!data ? <div className={styles.empty}><LoaderCircle className="p-spin" size={28}/><p>Carregando os registros do material…</p></div> : <>
          <div className={styles.balances}><div><small>Saldo registrado</small><strong>{data.item.stock}</strong><span>{data.item.unit}</span></div><div><small>Reservado em brindes</small><strong>{data.item.reserved}</strong><span>unidades prometidas</span></div><div className={styles.available}><small>{data.item.category === 'equipment' ? 'Disponível agora' : 'Disponível para uso'}</small><strong>{data.availability.available}</strong><span>{data.item.category === 'equipment' ? conditionNames[data.availability.equipmentState || 'active'] || 'Confira a agenda para outra data' : 'saldo após as reservas'}</span></div></div>
          {tab === 'work' && renderWorkContext?.({itemId: data.item.id, projectId: data.item.project_id})}
          {tab === 'summary' && <><div className={styles.summary}>{data.photos[0] ? <a href={data.photos[0].url} target="_blank" rel="noreferrer" aria-label="Abrir foto do material"><img src={data.photos[0].url} alt={data.photos[0].caption || data.item.name}/></a> : <div className={styles.noPhoto}><Boxes size={48}/><span>Ainda sem foto</span><button className="p-text-link" onClick={() => setTab('photos')}>Adicionar ou consultar fotos</button></div>}<div><span className={styles.tag}>{conditionNames[data.item.condition] || data.item.condition}</span><p>{data.item.description || 'Inclua uma descrição para facilitar a identificação e o uso deste material.'}</p>{data.item.asset_code && <p><strong>Identificação:</strong> {data.item.asset_code}</p>}<p className={styles.helper}>Alerta de estoque quando houver {data.item.low_stock} {data.item.unit} ou menos disponíveis.</p></div></div>
            {data.permissions.canManage && <><details className={styles.details}><summary>Editar cadastro do material</summary><form key={data.item.version} onSubmit={updateMetadata} className={styles.form}><fieldset disabled={busy}><label>Nome<input name="name" defaultValue={data.item.name} required maxLength={200}/></label><div className={styles.columns}><label>Categoria<select name="categoryId" defaultValue={data.item.category_id || ''}><option value="">{kindNames[data.item.category]} · sem categoria específica</option>{data.categories.filter(category => category.core_kind === data.item.category && (category.status === 'active' || category.id === data.item.category_id)).map(category => <option key={category.id} value={category.id}>{category.label}{category.status !== 'active' ? ' (arquivada)' : ''}</option>)}</select></label><label>Unidade de controle<input name="unit" defaultValue={data.item.unit} maxLength={40} required/></label></div><label>Descrição<textarea name="description" rows={3} defaultValue={data.item.description} maxLength={2000}/></label><div className={styles.columns}><label>Identificação ou patrimônio<input name="assetCode" defaultValue={data.item.asset_code} maxLength={100}/></label><label>Condição<select name="condition" defaultValue={data.item.condition}><option value="active">Em uso</option><option value="maintenance">Em manutenção</option><option value="inactive">Fora de uso</option></select></label></div><label>Alertar quando o saldo disponível for igual ou menor que<input name="lowStock" type="number" min="0" max={data.item.category === 'equipment' ? '1' : '1000000'} step="1" defaultValue={data.item.low_stock} required/><small>Informe a quantidade em {data.item.unit}. As unidades reservadas para brindes já são descontadas.</small></label><button className="p-button p-button-primary" type="submit"><Check size={17}/>Salvar cadastro</button></fieldset></form></details>
            <details className={styles.details}><summary>Criar uma categoria para estes materiais</summary><form onSubmit={createCategory} className={styles.form} onChange={() => { categoryKey.current = null; }}><fieldset disabled={busy}><label>Nome da categoria<input name="label" required maxLength={100} placeholder={data.item.category === 'equipment' ? 'Ex.: Equipamentos de som' : 'Ex.: Materiais para oficinas'}/></label><label>Descrição opcional<input name="description" maxLength={1000}/></label><p className={styles.helper}>A categoria ficará disponível para {kindNames[data.item.category].toLocaleLowerCase('pt-BR')} deste projeto.</p><button className="p-button p-button-subtle" type="submit"><PackagePlus size={17}/>Criar categoria</button></fieldset></form></details></>}
          </>}
          {tab === 'asset' && data.item.category === 'equipment' && data.permissions.canManage && <AssetDetailsPanel itemId={itemId} projectId={data.item.project_id} onSaved={async () => { await reload(); await onChanged?.(); }}/> }
          {tab === 'move' && <form onSubmit={submitMovement} className={styles.form} onChange={() => { movementKey.current = null; }}><fieldset disabled={busy}><h3>Registrar uma movimentação</h3><p className={styles.helper}>Escolha o que aconteceu e registre o motivo. O histórico anterior fica preservado.</p><div className={styles.columns}><label>O que aconteceu?<select value={moveKind} onChange={event => setMoveKind(event.target.value)}><option value="receive">Recebimento de material</option>{data.item.category !== 'equipment' && <><option value="distribute">Entrega ou distribuição</option><option value="consume">Uso pela equipe</option></>}<option value="adjust">Correção após conferir a contagem</option></select></label><label>Quantidade em {data.item.unit}<input name="quantity" type="number" min="1" max="1000000" step="1" defaultValue="1" required/></label></div>{moveKind === 'adjust' && <label>Como corrigir o saldo?<select name="direction"><option value="add">Acrescentar a quantidade informada</option><option value="remove">Retirar a quantidade informada</option></select></label>}<label>Motivo da movimentação<textarea name="reason" rows={4} required maxLength={2000} placeholder={moveKind === 'receive' ? 'Ex.: Recebimento conferido para a próxima ação' : moveKind === 'adjust' ? 'Descreva a diferença encontrada na contagem' : 'Ex.: Entrega à unidade ou uso em uma atividade'}/></label>{data.item.category === 'equipment' && <p className={styles.helper}>Para uma retirada temporária, registre um empréstimo na agenda. Aqui ficam o cadastro do bem e as correções do estoque.</p>}<button className="p-button p-button-primary" type="submit">{busy ? <LoaderCircle className="p-spin" size={17}/> : <Check size={17}/>}Confirmar movimentação</button></fieldset></form>}
          {tab === 'history' && <section><h3 className={styles.sectionTitle}><History size={19}/>Histórico do material</h3>{data.permissions.canManage && data.versions.length > 0 && <details className={styles.details}><summary>Versões do cadastro</summary><div className={styles.versions}><p className={styles.helper}>Restaure apenas nome, descrição e configurações. Saldos, reservas e movimentações permanecem no histórico.</p>{data.versions.map(version => <div key={version.id}><span>Versão {version.version} · {when(version.created_at)}</span>{version.version === data.item.version ? <small>Atual</small> : <button className="p-text-link" onClick={() => void restoreMetadata(version.version)} disabled={busy}>Restaurar cadastro</button>}</div>)}</div></details>}{data.movements.length ? <div className={styles.timeline}>{data.movements.map(movement => <article key={movement.id}><span className={movement.delta > 0 ? styles.incoming : styles.outgoing}>{movement.delta > 0 ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>}</span><div><div className={styles.row}><strong>{movementNames[movement.kind] || movement.kind}</strong><b className={movement.delta > 0 ? styles.positive : styles.negative}>{movement.delta > 0 ? '+' : ''}{movement.delta} {data.item.unit}</b></div><p>{movement.reason || 'Sem observação adicional'}</p>{movement.group_title && <p>Ação: {movement.group_title}</p>}<small>{when(movement.created_at)} · {movement.actor_name}</small></div></article>)}</div> : <div className={styles.empty}><History size={30}/><p>As movimentações deste material aparecerão aqui.</p></div>}{data.nextCursor && <button className="p-button p-button-subtle" onClick={() => void olderMovements()} disabled={loadingMore}>{loadingMore ? 'Carregando…' : 'Ver movimentações anteriores'}</button>}</section>}
          {tab === 'photos' && <section><h3 className={styles.sectionTitle}><Camera size={19}/>Fotos para identificar o material</h3><p className={styles.helper}>As imagens ficam disponíveis somente para a equipe autorizada.</p>{data.photos.length ? <div className={styles.gallery}>{data.photos.map(photo => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.caption || photo.title || data.item.name} loading="lazy"/><span>{photo.caption || photo.name}</span></a>)}</div> : <div className={styles.empty}><Camera size={32}/><p>Inclua a primeira foto para ajudar a equipe a reconhecer este material.</p></div>}{data.permissions.canUploadPhotos && <div className={styles.photoUpload}><div className={styles.photoButtons}><button type="button" className="p-button p-button-subtle" disabled={busy || preparing} onClick={() => cameraInput.current?.click()}><Camera size={18} aria-hidden="true"/>Usar câmera</button><input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden disabled={busy || preparing} onChange={event => { void choosePhoto(event.target.files?.[0]); event.target.value = ''; }}/><button type="button" className="p-button p-button-subtle" disabled={busy || preparing} onClick={() => galleryInput.current?.click()}><ImagePlus size={18} aria-hidden="true"/>Escolher foto</button><input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy || preparing} onChange={event => { void choosePhoto(event.target.files?.[0]); event.target.value = ''; }}/></div>{preparing && <p className={styles.helper}>Preparando a foto…</p>}{upload && <div className={styles.pendingPhoto}><div><strong>{upload.file.name}</strong><small>Foto pronta para enviar</small></div><button className="p-button p-button-primary" onClick={() => void sendPhoto()} disabled={busy}>{busy ? 'Enviando…' : error ? 'Tentar novamente' : 'Adicionar foto'}</button><button className="p-icon-button" aria-label="Descartar foto selecionada" onClick={() => setUpload(null)} disabled={busy}><X size={18}/></button></div>}</div>}</section>}
        </>}
      </div>
    </div>
  </dialog>;
}
