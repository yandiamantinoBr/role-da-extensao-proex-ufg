'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Archive, Check, ExternalLink, FolderPlus, FolderSearch, LoaderCircle, Pencil, RotateCcw, ShieldCheck } from 'lucide-react';
import styles from './google-drive.module.css';
import { driveRequest, failedReason, pickDriveFolder, when, type DriveFolder, type DriveStatus, type DriveUpload, type PickedFolder } from './google-drive-api';

type AdminView = { canManage: boolean; organizations: { id: string; name: string }[]; folders: DriveFolder[]; units: { id: string; name: string }[]; projects: { id: string; name: string; organizationId: string }[] };
const AUDIENCES = [
  { value: 'organization', label: 'Toda a organização', help: 'Qualquer pessoa da equipe com acesso ao portal nesta organização.' },
  { value: 'project', label: 'Equipe de um projeto', help: 'Só quem participa do projeto escolhido no campo Projeto, logo abaixo.' },
  { value: 'managers', label: 'Só gestão', help: 'Donos e gestores; bolsistas e monitores não veem a pasta.' },
] as const;

/** Configurações › Dados e cópias › Pastas do Drive. Só a administração da organização vê. */
export default function GoogleDriveFoldersPanel() {
  const [view, setView] = useState<AdminView | null>(null), [status, setStatus] = useState<DriveStatus | null>(null), [history, setHistory] = useState<DriveUpload[] | null>(null);
  const [editing, setEditing] = useState<DriveFolder | 'new' | null>(null), [picked, setPicked] = useState<PickedFolder | null>(null), [audience, setAudience] = useState<string>('organization');
  const [busy, setBusy] = useState(''), [failure, setFailure] = useState(''), [notice, setNotice] = useState('');
  const alertRef = useRef<HTMLParagraphElement>(null), formTitle = useRef<HTMLHeadingElement>(null);
  const reload = useCallback(async () => {
    const [admin, drive] = await Promise.all([driveRequest<AdminView>('/api/drive/folders'), driveRequest<DriveStatus>('/api/drive')]);
    setView(admin); setStatus(drive);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void reload().catch(error => setFailure(error instanceof Error ? error.message : 'Não foi possível consultar as pastas.')); }, 0); return () => window.clearTimeout(timer); }, [reload]);
  useEffect(() => { if (failure) alertRef.current?.focus(); }, [failure]);
  useEffect(() => { if (editing) formTitle.current?.focus(); }, [editing]);

  async function run(label: string, task: () => Promise<void>) {
    if (busy) return; setBusy(label); setFailure(''); setNotice('');
    try { await task(); } catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível concluir.'); } finally { setBusy(''); }
  }
  const choose = () => run('pick', async () => {
    if (!status?.picker) throw new Error('O seletor do Google ainda não está ativo. Peça à administração geral.');
    const folder = await pickDriveFolder(status.picker, { title: 'Escolha a pasta da PROEX' });
    if (folder) setPicked(folder);
  });
  function open(target: DriveFolder | 'new') { setEditing(target); setPicked(null); setAudience(target === 'new' ? 'organization' : target.audience); setFailure(''); setNotice(''); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), target = editing;
    if (!target) return;
    const common = { name: form.get('name'), purpose: form.get('purpose'), audience: form.get('audience'), projectId: form.get('projectId') || null, unitId: form.get('unitId') || null };
    await run('save', async () => {
      if (target === 'new') {
        if (!picked) throw new Error('Escolha a pasta no seletor do Google antes de salvar.');
        await driveRequest('/api/drive/folders', { action: 'register', organizationId: form.get('organizationId'), driveFolderId: picked.id, ...common });
        setNotice(`Pasta "${String(common.name)}" cadastrada.`);
      } else {
        await driveRequest('/api/drive/folders', { action: 'update', folderId: target.id, version: target.version, ...common });
        setNotice('Cadastro atualizado.');
      }
      setEditing(null); setPicked(null); await reload();
    });
  }
  const toggleArchive = (folder: DriveFolder) => run(`archive:${folder.id}`, async () => {
    await driveRequest('/api/drive/folders', { action: folder.status === 'active' ? 'archive' : 'restore', folderId: folder.id, version: folder.version });
    setNotice(folder.status === 'active' ? `"${folder.name}" arquivada. Ninguém envia mais para ela; o histórico continua.` : `"${folder.name}" reativada.`);
    await reload();
  });
  const loadHistory = () => run('history', async () => { setHistory((await driveRequest<{ uploads: DriveUpload[] }>('/api/drive/history?scope=organization')).uploads); });

  if (!view) return <div className={styles.embedded}>{failure ? <p ref={alertRef} tabIndex={-1} className="p-inline-error" role="alert">{failure}</p> : <p role="status" className={styles.muted}><LoaderCircle size={16} className="p-spin" aria-hidden="true"/> Consultando as pastas…</p>}</div>;
  if (!view.canManage) return <p className={styles.muted}>Só a administração da organização cadastra pastas do Drive.</p>;
  const connected = status?.connection.status === 'connected', configured = status?.configured;
  const target = editing && editing !== 'new' ? editing : null;
  const organizationId = target?.organizationId ?? view.organizations[0]?.id;
  return <div className={styles.embedded}>
    <p className={styles.note}><ShieldCheck size={16} aria-hidden="true"/><span>O portal guarda só o endereço da pasta e a descrição. Cada pessoa envia com a própria conta Google, então só grava onde já tem permissão no Drive. Pastas abertas a qualquer pessoa com o link ou a toda a instituição são recusadas.</span></p>
    {failure && <p ref={alertRef} tabIndex={-1} className="p-inline-error" role="alert">{failure}</p>}
    {notice && <p className={styles.note} role="status"><Check size={16} aria-hidden="true"/>{notice}</p>}
    {!configured && <p className={styles.note}><FolderSearch size={16} aria-hidden="true"/><span>A conexão com o Google ainda não foi ativada. Peça à administração geral do portal para ativá-la; até lá, as pastas podem ser vistas, mas não cadastradas.</span></p>}
    {configured && !connected && <p className={styles.note}><FolderSearch size={16} aria-hidden="true"/><span>Para escolher pastas, conecte primeiro a sua conta Google em <button type="button" className="p-text-link" onClick={() => { window.location.hash = 'google-drive'; window.location.search = '?module=profile'; }}>Conta › Google Drive</button>.</span></p>}

    {editing ? <form className={styles.form} onSubmit={event => void submit(event)} autoComplete="off">
      <h3 ref={formTitle} tabIndex={-1} className={styles.sectionTitle}>{target ? <><Pencil size={17} aria-hidden="true"/>Editar “{target.name}”</> : <><FolderPlus size={17} aria-hidden="true"/>Cadastrar pasta</>}</h3>
      <fieldset disabled={!!busy}>
        {!target && <div className={styles.picked}>
          <span>{picked ? <>Pasta no Drive: <b>{picked.name || 'sem nome'}</b></> : <>Nenhuma pasta escolhida ainda.<small className={styles.hint}>Escolha a pasta no Google para poder cadastrar.</small></>}</span>
          <button type="button" className="p-button p-button-subtle" onClick={() => void choose()} disabled={!connected || !status?.picker}>{busy === 'pick' ? <LoaderCircle size={16} className="p-spin" aria-hidden="true"/> : <FolderSearch size={16} aria-hidden="true"/>}{picked ? 'Escolher outra' : 'Escolher no Google'}</button>
        </div>}
        <div className={styles.grid} style={{ marginTop: 16 }}>
          {!target && view.organizations.length > 1 && <label className={`p-field ${styles.wide}`}><span>Organização</span><select name="organizationId" defaultValue={organizationId} required>{view.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
          {!target && view.organizations.length === 1 && <input type="hidden" name="organizationId" value={organizationId}/>}
          <label className={`p-field ${styles.wide}`}><span>Nome no portal</span><input name="name" required maxLength={120} defaultValue={target?.name ?? picked?.name ?? ''} key={picked?.id ?? target?.id ?? 'new'} placeholder="Ex.: Fotos do CONPEEX 2026"/></label>
          <label className={`p-field ${styles.wide}`}><span>Para que serve</span><input name="purpose" required maxLength={300} defaultValue={target?.purpose ?? ''} placeholder="Ex.: fotos de divulgação do evento"/></label>
          <fieldset className={`${styles.choices} ${styles.wide}`}><legend>Quem pode usar</legend>{AUDIENCES.map(option => <label key={option.value} className={styles.choice}><input type="radio" name="audience" value={option.value} checked={audience === option.value} onChange={() => setAudience(option.value)}/><span><strong>{option.label}</strong><small>{option.help}</small></span></label>)}</fieldset>
          <label className="p-field"><span>Projeto {audience === 'project' ? '(obrigatório)' : '(opcional)'}</span><select name="projectId" defaultValue={target?.projectId ?? ''} required={audience === 'project'}><option value="">Nenhum</option>{view.projects.filter(project => project.organizationId === organizationId || view.organizations.length > 1).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="p-field"><span>Unidade (opcional)</span><select name="unitId" defaultValue={target?.unitId ?? ''}><option value="">Nenhuma</option>{view.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        </div>
        <div className={styles.footer} style={{ marginTop: 16 }}>
          <button type="button" className="p-button p-button-subtle" onClick={() => { setEditing(null); setPicked(null); }}>Cancelar</button>
          <button type="submit" className="p-button p-button-primary" disabled={!target && !picked}>{busy === 'save' ? <LoaderCircle size={17} className="p-spin" aria-hidden="true"/> : <Check size={17} aria-hidden="true"/>}{target ? 'Salvar alterações' : 'Cadastrar pasta'}</button>
        </div>
      </fieldset>
    </form> : <div className={styles.actions}><button type="button" className="p-button p-button-primary" onClick={() => open('new')} disabled={!configured || !connected}><FolderPlus size={17} aria-hidden="true"/>Cadastrar pasta</button></div>}

    <section aria-labelledby="drive-registry-title">
      <h3 id="drive-registry-title" className={styles.sectionTitle}>Pastas cadastradas</h3>
      {view.folders.length ? <ul className={styles.list} style={{ marginTop: 12 }}>{view.folders.map(folder => <li key={folder.id} className={`${styles.item} ${folder.status === 'archived' ? styles.archived : ''}`}>
        <div><strong>{folder.name}</strong><p>{folder.purpose}</p><div className={styles.meta}>
          <span className={`${styles.pill} ${folder.status === 'active' ? styles.ok : styles.neutral}`}>{folder.status === 'active' ? 'Em uso' : 'Arquivada'}</span>
          <span className={styles.tag}>{folder.audienceLabel}</span>{folder.projectName && <span className={styles.tag}>{folder.projectName}</span>}{folder.unitName && <span className={styles.tag}>{folder.unitName}</span>}{folder.sharedDrive ? <span className={styles.tag}>Drive compartilhado</span> : <span className={`${styles.pill} ${styles.warn}`}>Fora do drive compartilhado</span>}{view.organizations.length > 1 && <span className={styles.tag}>{folder.organizationName}</span>}
        </div>{!folder.sharedDrive && <p className={styles.warnText}>Cada arquivo fica na conta de quem enviou. Se a pessoa sair, a PROEX pode perder o acesso. Prefira uma pasta de drive compartilhado.</p>}<p>No Drive: {folder.driveName} · atualizado em {when(folder.updatedAt)}</p></div>
        <div className={styles.itemActions}>
          <a className="p-button p-button-subtle" href={folder.driveUrl} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${folder.name} no Drive (nova aba)`}><ExternalLink size={15} aria-hidden="true"/>Abrir</a>
          {folder.status === 'active' && <button type="button" className="p-button p-button-subtle" onClick={() => open(folder)} disabled={!!busy}><Pencil size={15} aria-hidden="true"/>Editar</button>}
          <button type="button" className="p-button p-button-subtle" onClick={() => void toggleArchive(folder)} disabled={!!busy}>{folder.status === 'active' ? <><Archive size={15} aria-hidden="true"/>Arquivar</> : <><RotateCcw size={15} aria-hidden="true"/>Reativar</>}</button>
        </div>
      </li>)}</ul> : <p className={styles.muted} style={{ marginTop: 8 }}>Nenhuma pasta cadastrada. Comece pela pasta que a equipe mais usa (por exemplo, as fotos da comunicação do evento).</p>}
    </section>

    <section aria-labelledby="drive-org-history">
      <h3 id="drive-org-history" className={styles.sectionTitle}>Histórico de envios</h3>
      {history === null ? <button type="button" className="p-button p-button-subtle" style={{ marginTop: 8 }} onClick={() => void loadHistory()} disabled={!!busy}>{busy === 'history' ? <LoaderCircle size={16} className="p-spin" aria-hidden="true"/> : null}Ver quem enviou o quê</button>
        : history.length ? <ul className={styles.list} style={{ marginTop: 12 }}>{history.map(upload => <li key={upload.id} className={styles.item}>
          <div><strong>{upload.fileName}</strong><p>{upload.personName}{upload.via === 'role' ? ' pelo Rolê' : ''} · {upload.folderName} · {when(upload.createdAt)}</p>{upload.status !== 'sent' && <p>{failedReason(upload.errorCode)}</p>}</div>
          <div className={styles.itemActions}>{upload.status === 'sent' && upload.webViewLink ? <a className="p-text-link" href={upload.webViewLink} target="_blank" rel="noopener noreferrer">Abrir no Drive <ExternalLink size={13} aria-hidden="true"/><span className="sr-only"> (nova aba)</span></a> : <span className={`${styles.pill} ${styles.warn}`}>Não chegou ao Drive</span>}</div>
        </li>)}</ul> : <p className={styles.muted} style={{ marginTop: 8 }}>Nenhum envio ainda.</p>}
    </section>
  </div>;
}
