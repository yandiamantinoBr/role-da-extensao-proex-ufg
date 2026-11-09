'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink, FolderCheck, FolderOpen, HardDrive, LoaderCircle, ShieldCheck, Unplug, UserRound } from 'lucide-react';
import styles from './google-drive.module.css';
import { driveRequest, failedReason, pickDriveFolder, takeOAuthResult, when, type DriveStatus, type DriveUpload } from './google-drive-api';

const STATUS = {
  connected: { label: 'Conectada', tone: styles.ok },
  not_connected: { label: 'Não conectada', tone: styles.neutral },
  revoked: { label: 'Precisa reconectar', tone: styles.warn },
  unconfigured: { label: 'Ainda não disponível', tone: styles.neutral },
} as const;

/** Conta › Google Drive: a pessoa conecta a própria conta, libera as pastas e vê os próprios envios. */
export default function GoogleDriveConnectionPanel() {
  const group = useRef<HTMLDetailsElement>(null), alertRef = useRef<HTMLParagraphElement>(null), confirmRef = useRef<HTMLDivElement>(null), disconnectRef = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false), [data, setData] = useState<DriveStatus | null>(null), [uploads, setUploads] = useState<DriveUpload[] | null>(null);
  const [busy, setBusy] = useState(''), [failure, setFailure] = useState(''), [notice, setNotice] = useState(''), [confirmRevoke, setConfirmRevoke] = useState(false);
  const reload = useCallback(async () => {
    const [status, history] = await Promise.all([driveRequest<DriveStatus>('/api/drive'), driveRequest<{ uploads: DriveUpload[] }>('/api/drive/history?scope=mine').catch(() => ({ uploads: [] }))]);
    setData(status); setUploads(history.uploads.slice(0, 8));
  }, []);
  useEffect(() => {
    const result = takeOAuthResult();
    const open = window.location.hash === '#google-drive' || !!result;
    const timer = window.setTimeout(() => {
      if (result) { if (result.ok) setNotice(result.message); else setFailure(result.message); }
      if (open && group.current) { group.current.open = true; group.current.scrollIntoView({ block: 'start' }); group.current.querySelector('summary')?.focus({ preventScroll: true }); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { if (!opened) return; const timer = window.setTimeout(() => { void reload().catch(error => setFailure(error instanceof Error ? error.message : 'Não foi possível consultar o Google Drive.')); }, 0); return () => window.clearTimeout(timer); }, [opened, reload]);
  useEffect(() => { if (failure) alertRef.current?.focus(); }, [failure]);
  useEffect(() => { if (confirmRevoke) confirmRef.current?.focus(); }, [confirmRevoke]);

  async function run(label: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setFailure(''); setNotice('');
    try { await task(); } catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível concluir.'); } finally { setBusy(''); }
  }
  const connect = () => run('connect', async () => {
    const { url } = await driveRequest<{ url: string }>('/api/drive/oauth/start', {});
    if (!/^https:\/\/accounts\.google\.com\//.test(url)) throw new Error('Endereço de conexão inesperado. Atualize a página.');
    window.location.assign(url);
  });
  const disconnect = (revoke: boolean) => run(revoke ? 'revoke' : 'disconnect', async () => {
    const result = await driveRequest<{ revokedAtGoogle: boolean }>('/api/drive', { action: 'disconnect', revoke });
    setConfirmRevoke(false); await reload();
    setNotice(revoke && result.revokedAtGoogle ? 'Conta desconectada e permissão cancelada no Google. O portal não guarda mais nenhum acesso seu.' : 'Conta desconectada deste portal. A permissão continua na sua conta Google até você tirá-la em myaccount.google.com › Segurança › Apps de terceiros.');
  });
  const release = (folderId: string, driveFolderId: string, name: string) => run(`release:${folderId}`, async () => {
    if (!data?.picker) throw new Error('O seletor do Google ainda não está ativo. Peça à administração geral.');
    const picked = await pickDriveFolder(data.picker, { onlyId: driveFolderId, title: `Selecione "${name}" para liberar` });
    if (!picked) return;
    await driveRequest('/api/drive', { action: 'confirm-folder', folderId, pickedId: picked.id });
    await reload(); setNotice(`Pasta "${name}" liberada. Já dá para enviar arquivos para ela.`);
  });

  const connection = data?.connection, state = connection ? STATUS[connection.status] : null;
  return <details ref={group} id="google-drive" className={`p-card ${styles.panel}`} onToggle={event => setOpened(event.currentTarget.open)}>
    <summary className={styles.summary}><HardDrive size={20} aria-hidden="true"/><span><strong>Google Drive</strong><small>Envie fotos e anexos às pastas da PROEX com a sua própria conta Google.</small></span><ChevronDown size={18} className={styles.chevron} aria-hidden="true"/></summary>
    {opened && <div className={styles.body}>
      {failure && <p ref={alertRef} tabIndex={-1} className="p-inline-error" role="alert">{failure}</p>}
      {notice && <p className={styles.note} role="status"><Check size={16} aria-hidden="true"/>{notice}</p>}
      {!data ? (failure ? <div className={styles.actions}><button type="button" className="p-button p-button-subtle" onClick={() => { setFailure(''); void reload().catch(error => setFailure(error instanceof Error ? error.message : 'Não foi possível consultar o Google Drive.')); }}>Tentar de novo</button></div> : <p role="status" className={styles.muted}><LoaderCircle size={16} className="p-spin" aria-hidden="true"/> Consultando sua conexão…</p>) : <>
        <div className={styles.status}>
          <UserRound size={22} aria-hidden="true"/>
          <div>
            <strong>{connection!.status === 'connected' ? <>Conectada como <span className={styles.account}>{connection!.account}</span></> : connection!.status === 'revoked' ? 'O Google não aceita mais esta permissão' : connection!.status === 'unconfigured' ? 'A conexão com o Google ainda não foi ativada' : 'Nenhuma conta Google conectada'}</strong>
            <small>{connection!.status === 'connected' ? `Desde ${when(connection!.connectedAt!)}${connection!.lastUsedAt ? ` · último envio ${when(connection!.lastUsedAt)}` : ''}` : connection!.status === 'revoked' ? 'Ela foi cancelada na conta Google ou venceu. Conecte de novo para voltar a enviar.' : connection!.status === 'unconfigured' ? 'A administração geral do portal ainda precisa ativar a conexão com o Google. Até lá, nada é enviado ao Drive.' : 'Conecte para enviar arquivos do portal direto para as pastas registradas.'}</small>
          </div>
          {connection!.status !== 'connected' && <span className={`${styles.pill} ${state!.tone}`}>{state!.label}</span>}
        </div>
        <ul className={styles.facts} aria-label="Como funciona">
          <li><UserRound size={17} aria-hidden="true"/><span><b>Sai com o seu nome.</b> O Drive registra você como quem enviou; ninguém usa a sua conta.</span></li>
          <li><ShieldCheck size={17} aria-hidden="true"/><span><b>Acesso mínimo.</b> O portal só enxerga as pastas que você liberar e os arquivos que enviar por ele.</span></li>
          <li><Unplug size={17} aria-hidden="true"/><span><b>Você decide.</b> Desconecte quando quiser; a permissão fica guardada com proteção e nunca aparece na tela.</span></li>
        </ul>
        {connection!.status !== 'unconfigured' && <div className={styles.actions}>
          {connection!.status !== 'connected' && <button type="button" className="p-button p-button-primary" onClick={connect} disabled={!!busy}>{busy === 'connect' ? <LoaderCircle size={17} className="p-spin" aria-hidden="true"/> : <HardDrive size={17} aria-hidden="true"/>}{connection!.status === 'revoked' ? 'Conectar de novo' : 'Conectar conta Google'}</button>}
          {connection!.status === 'connected' && <>
            <button type="button" className="p-button p-button-subtle" onClick={connect} disabled={!!busy}>Trocar de conta</button>
            <button ref={disconnectRef} type="button" className="p-button p-button-subtle" onClick={() => setConfirmRevoke(true)} disabled={!!busy} aria-expanded={confirmRevoke}><Unplug size={17} aria-hidden="true"/>Desconectar</button>
          </>}
          {connection!.status === 'revoked' && <button type="button" className="p-button p-button-subtle" onClick={() => void disconnect(false)} disabled={!!busy}>Apagar registro da conexão</button>}
        </div>}
        {confirmRevoke && <div ref={confirmRef} tabIndex={-1} className={styles.confirm} role="group" aria-label="Como desconectar">
          <p>Os arquivos já enviados continuam no Drive. Para enviar de novo, será preciso conectar outra vez.</p>
          <div className={styles.actions}>
            <button type="button" className="p-button p-button-primary" onClick={() => void disconnect(true)} disabled={!!busy}>{busy === 'revoke' ? <LoaderCircle size={17} className="p-spin" aria-hidden="true"/> : null}Desconectar e tirar a permissão no Google (recomendado)</button>
            <button type="button" className="p-button p-button-subtle" onClick={() => void disconnect(false)} disabled={!!busy}>{busy === 'disconnect' ? <LoaderCircle size={17} className="p-spin" aria-hidden="true"/> : null}Só desconectar deste portal</button>
            <button type="button" className="p-button p-button-subtle" onClick={() => { setConfirmRevoke(false); window.setTimeout(() => disconnectRef.current?.focus(), 0); }} disabled={!!busy}>Cancelar</button>
          </div>
        </div>}
        {data.configured && <section aria-labelledby="drive-my-folders">
          <h3 id="drive-my-folders" className={styles.sectionTitle}><FolderOpen size={18} aria-hidden="true"/>Pastas que você pode usar</h3>
          <p className={styles.muted}>Na primeira vez, libere cada pasta no seletor do Google (um clique). Depois disso os envios vão direto.</p>
          {data.folders.length ? <ul className={styles.list} style={{ marginTop: 12 }}>{data.folders.map(folder => <li key={folder.id} className={styles.item}>
            <div><strong>{folder.name}</strong><p>{folder.purpose}</p><div className={styles.meta}>{folder.unitName && <span className={styles.tag}>{folder.unitName}</span>}{folder.projectName && <span className={styles.tag}>{folder.projectName}</span>}<span className={styles.tag}>{folder.audienceLabel}</span>{folder.sharedDrive && <span className={styles.tag}>Drive compartilhado</span>}</div></div>
            <div className={styles.itemActions}>{folder.confirmedByMe ? <span className={`${styles.pill} ${styles.ok}`}><FolderCheck size={14} aria-hidden="true"/>Liberada</span> : <button type="button" className="p-button p-button-subtle" disabled={!!busy || connection!.status !== 'connected' || !data.picker} onClick={() => void release(folder.id, folder.driveFolderId, folder.name)}>{busy === `release:${folder.id}` ? <LoaderCircle size={16} className="p-spin" aria-hidden="true"/> : <FolderCheck size={16} aria-hidden="true"/>}Liberar no Google</button>}</div>
          </li>)}</ul> : <p className={styles.note} style={{ marginTop: 12 }}><FolderOpen size={16} aria-hidden="true"/>Ainda não há pasta registrada para você. A administração cadastra as pastas em Configurações › Dados e cópias.</p>}
        </section>}
        {!!uploads?.length && <section aria-labelledby="drive-my-uploads">
          <h3 id="drive-my-uploads" className={styles.sectionTitle}><HardDrive size={18} aria-hidden="true"/>Seus envios recentes</h3>
          <ul className={styles.list} style={{ marginTop: 12 }}>{uploads.map(upload => <li key={upload.id} className={styles.item}>
            <div><strong>{upload.fileName}</strong><p>{upload.folderName} · {when(upload.createdAt)}{upload.via === 'role' ? ' · pelo Rolê' : ''}</p>{upload.status !== 'sent' && <p>{failedReason(upload.errorCode)}</p>}</div>
            <div className={styles.itemActions}>{upload.status === 'sent' && upload.webViewLink ? <a className="p-text-link" href={upload.webViewLink} target="_blank" rel="noopener noreferrer">Abrir no Drive <ExternalLink size={13} aria-hidden="true"/><span className="sr-only"> (nova aba)</span></a> : <span className={`${styles.pill} ${styles.warn}`}>Não chegou ao Drive</span>}</div>
          </li>)}</ul>
        </section>}
      </>}
    </div>}
  </details>;
}
