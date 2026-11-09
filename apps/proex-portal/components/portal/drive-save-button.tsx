'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CloudUpload, ExternalLink, FolderCheck, HardDrive, LoaderCircle, Sparkles, X } from 'lucide-react';
import styles from './google-drive.module.css';
import { driveRequest, pickDriveFolder, sizeLabel, type DriveError, type DrivePicker, type DriveStatus } from './google-drive-api';

export type DriveSaveSource = { kind: 'record_attachment' | 'loan_document'; id: string };
type Folder = { id: string; driveFolderId: string; name: string; purpose: string; unit: string | null; project: string | null; sharedDrive: boolean; confirmedByMe: boolean };
type Options = { connection: { status: string; account: string | null; href: string }; folders: Folder[]; suggestion: { folderId: string | null; reason: string; ask: string | null }; fileName: string; source: { label: string; mime: string; bytes: number } };
type Preview = { fileName: string; folderName: string; folderPurpose: string; organizationName: string; sharedDrive: boolean; sourceLabel: string; bytes: number; account: string | null };

/** Botão discreto ao lado de um anexo; o diálogo faz escolha → prévia → confirmação. */
export default function DriveSaveButton({ source, label }: { source: DriveSaveSource; label: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={styles.sendButton} onClick={() => setOpen(true)} aria-label={`Enviar ${label} ao Google Drive`}><CloudUpload size={15} aria-hidden="true"/>Enviar ao Drive</button>
    {open && <DriveSaveDialog source={source} label={label} onClose={() => setOpen(false)}/>}
  </>;
}

function DriveSaveDialog({ source, label, onClose }: { source: DriveSaveSource; label: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), title = useRef<HTMLHeadingElement>(null), alertRef = useRef<HTMLParagraphElement>(null);
  const [options, setOptions] = useState<Options | null>(null), [picker, setPicker] = useState<DrivePicker | null>(null);
  const [folderId, setFolderId] = useState(''), [fileName, setFileName] = useState(''), [preview, setPreview] = useState<{ token: string; data: Preview } | null>(null);
  const [attempt, setAttempt] = useState(0), [done, setDone] = useState<{ link: string | null; folder: string } | null>(null), [busy, setBusy] = useState(''), [failure, setFailure] = useState('');
  useEffect(() => {
    const node = dialog.current, opener = document.activeElement; node?.showModal(); title.current?.focus();
    return () => { if (node?.open) node.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([driveRequest<Options>('/api/drive/save', { action: 'options', source }, controller.signal), driveRequest<DriveStatus>('/api/drive', undefined, controller.signal)])
      .then(([value, status]) => { setOptions(value); setPicker(status.picker); setFolderId(value.suggestion.folderId ?? ''); setFileName(value.fileName); })
      .catch(error => { if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : 'Não foi possível abrir o envio.'); });
    return () => controller.abort();
  }, [source, attempt]);
  useEffect(() => { if (failure) alertRef.current?.focus(); }, [failure]);

  async function run(name: string, task: () => Promise<void>) {
    if (busy) return; setBusy(name); setFailure('');
    try { await task(); } catch (error) { const e = error as DriveError; setFailure(e.message || 'Não foi possível concluir.'); if (e.code === 'drive_folder_confirm_required' && options) setOptions({ ...options, folders: options.folders.map(folder => folder.id === folderId ? { ...folder, confirmedByMe: false } : folder) }); }
    finally { setBusy(''); }
  }
  const folder = options?.folders.find(item => item.id === folderId) ?? null;
  const release = () => run('release', async () => {
    if (!folder || !picker) throw new Error('O seletor do Google ainda não está ativo. Peça à administração geral.');
    const picked = await pickDriveFolder(picker, { onlyId: folder.driveFolderId, title: `Selecione "${folder.name}" para liberar` });
    if (!picked) return;
    await driveRequest('/api/drive', { action: 'confirm-folder', folderId: folder.id, pickedId: picked.id });
    setOptions(current => current && { ...current, folders: current.folders.map(item => item.id === folder.id ? { ...item, confirmedByMe: true } : item) });
  });
  const prepare = () => run('prepare', async () => {
    const result = await driveRequest<{ planToken: string; preview: Preview }>('/api/drive/save', { action: 'prepare', source, folderId, fileName, via: 'screen' });
    setPreview({ token: result.planToken, data: result.preview });
  });
  const apply = () => run('apply', async () => {
    if (!preview) return;
    const result = await driveRequest<{ upload: { webViewLink: string | null } }>('/api/drive/save', { action: 'apply', planToken: preview.token });
    setDone({ link: result.upload.webViewLink, folder: preview.data.folderName }); setPreview(null);
  });

  const connection = options?.connection.status, step = done ? 3 : preview ? 2 : 1;
  const blocked = connection && connection !== 'connected';
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="drive-save-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={styles.dialogHeader}><div><h2 ref={title} tabIndex={-1} id="drive-save-title"><HardDrive size={20} aria-hidden="true"/>Enviar ao Google Drive</h2><p>{label}{options ? ` · ${sizeLabel(options.source.bytes)}` : ''}</p></div><button className="p-icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy === 'apply'}><X size={20}/></button></header>
    <div className={styles.dialogBody}>
      {!blocked && options && options.folders.length > 0 && <ol className={styles.steps} aria-label={`Etapa ${step} de 3`}>{['Escolher pasta', 'Conferir', 'Enviado'].map((name, index) => <li key={name} aria-current={step === index + 1 ? 'step' : undefined}>{name}</li>)}</ol>}
      {failure && <p ref={alertRef} tabIndex={-1} className="p-inline-error" role="alert">{failure}</p>}
      {failure && !options && <div className={styles.footer}><button type="button" className="p-button p-button-subtle" onClick={onClose}>Fechar</button><button type="button" className="p-button p-button-primary" onClick={() => { setFailure(''); setAttempt(n => n + 1); }}>Tentar de novo</button></div>}
      {!options && !failure && <p role="status" className={styles.muted}><LoaderCircle size={16} className="p-spin" aria-hidden="true"/> Procurando as pastas certas…</p>}
      {options && blocked && <div className={styles.confirm}>
        <p>{connection === 'unconfigured' ? 'A conexão com o Google Drive ainda não foi ativada no portal. Avise a administração geral.' : connection === 'revoked' ? 'A permissão da sua conta Google foi cancelada ou venceu. Conecte de novo para enviar.' : 'Para enviar, conecte antes a sua conta Google. Os arquivos saem com o seu nome e só vão para pastas onde você já pode gravar.'}</p>
        {connection !== 'unconfigured' && <div className={styles.actions}><a className="p-button p-button-primary" href={options.connection.href}><HardDrive size={17} aria-hidden="true"/>Ir para Conta › Google Drive</a></div>}
      </div>}
      {options && !blocked && !preview && !done && <>
        {options.folders.length === 0 ? <><p className={styles.note}>Ainda não há pasta do Drive registrada para você. Peça à administração para cadastrar uma em Configurações › Dados e cópias.</p><div className={styles.footer}><button type="button" className="p-button p-button-subtle" onClick={onClose}>Fechar</button></div></> : <>
          {options.suggestion.ask ? <p className={styles.note}><Sparkles size={16} aria-hidden="true"/><span>Mais de uma pasta combina com este arquivo. Escolha a de destino abaixo.</span></p> : options.suggestion.folderId && <p className={styles.note}><Sparkles size={16} aria-hidden="true"/><span>{options.suggestion.reason} Confira antes de continuar.</span></p>}
          <fieldset className={styles.choices} disabled={!!busy}><legend>Pasta de destino</legend>{options.folders.map(item => <label key={item.id} className={styles.choice}>
            <input type="radio" name="drive-folder" value={item.id} checked={folderId === item.id} onChange={() => setFolderId(item.id)}/>
            <span><strong>{item.name}{item.id === options.suggestion.folderId && <span className={`${styles.pill} ${styles.ok}`}>Sugerida</span>}{!item.confirmedByMe && <span className={`${styles.pill} ${styles.neutral}`}>Ainda não liberada</span>}</strong><small>{item.purpose}{item.project ? ` · ${item.project}` : ''}{item.unit ? ` · ${item.unit}` : ''}{item.sharedDrive ? ' · Drive compartilhado' : ''}</small></span>
          </label>)}</fieldset>
          {folder && !folder.confirmedByMe && <p className={styles.note}><FolderCheck size={16} aria-hidden="true"/><span>Primeiro envio para “{folder.name}”. Toque em <b>Liberar no Google</b> e, na janela do Google, clique em <b>Selecionar</b>. Isso libera só esta pasta, só na sua conta.</span></p>}
          <label className="p-field"><span>Nome do arquivo no Drive</span><input value={fileName} onChange={event => setFileName(event.target.value)} maxLength={160} required disabled={!!busy}/></label>
          <div className={styles.footer}><button type="button" className="p-button p-button-subtle" onClick={onClose} disabled={!!busy}>Cancelar</button>{folder && !folder.confirmedByMe
            ? <button type="button" className="p-button p-button-primary" onClick={() => void release()} disabled={!!busy || !picker}>{busy === 'release' ? <LoaderCircle size={17} className="p-spin" aria-hidden="true"/> : <FolderCheck size={17} aria-hidden="true"/>}Liberar no Google</button>
            : <button type="button" className="p-button p-button-primary" onClick={() => void prepare()} disabled={!!busy || !folder || !fileName.trim()}>{busy === 'prepare' ? <LoaderCircle size={17} className="p-spin" aria-hidden="true"/> : null}Conferir envio</button>}</div>
          {!folder && <p className={styles.muted}>Escolha uma pasta para continuar.</p>}
        </>}
      </>}
      {preview && <>
        <dl className={styles.preview}>
          <div><dt>Pasta</dt><dd>{preview.data.folderName}<small>{preview.data.folderPurpose} · {preview.data.organizationName}{preview.data.sharedDrive ? ' · Drive compartilhado' : ''}</small></dd></div>
          <div><dt>Nome do arquivo</dt><dd>{preview.data.fileName}</dd></div>
          <div><dt>Origem</dt><dd>{preview.data.sourceLabel}<small>{sizeLabel(preview.data.bytes)}</small></dd></div>
          <div><dt>Vai sair em nome de</dt><dd>{preview.data.account ?? 'sua conta Google'}<small>Fica registrado no histórico do portal e no Drive.</small></dd></div>
        </dl>
        <div className={styles.footer}><button type="button" className="p-button p-button-subtle" onClick={() => setPreview(null)} disabled={!!busy}><ArrowLeft size={16} aria-hidden="true"/>Voltar</button><button type="button" className="p-button p-button-primary" onClick={() => void apply()} disabled={!!busy}>{busy === 'apply' ? <LoaderCircle size={17} className="p-spin" aria-hidden="true"/> : <CloudUpload size={17} aria-hidden="true"/>}{busy === 'apply' ? 'Enviando…' : 'Confirmar envio'}</button></div>
      </>}
      {done && <div className={styles.success} role="status"><Check size={22} aria-hidden="true"/><p><b>Enviado para “{done.folder}”.</b> Está registrado no seu histórico, em Conta › Google Drive.</p>
        <div className={styles.actions}>{done.link && <a className="p-button p-button-primary" href={done.link} target="_blank" rel="noopener noreferrer">Abrir no Drive <ExternalLink size={15} aria-hidden="true"/><span className="sr-only"> (nova aba)</span></a>}<button type="button" className="p-button p-button-subtle" onClick={onClose}>Fechar</button></div></div>}
    </div>
  </dialog>;
}
