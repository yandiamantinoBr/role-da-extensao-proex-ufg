'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, FolderClosed } from 'lucide-react';
import type { ActivityMediaFolderView } from '@/lib/google-drive/activity-media';
import styles from './records-panel.module.css';

type Props = { userId: string; projectId: string; scheduleItemId: string };
type Load = { view: ActivityMediaFolderView | null; error: string };
const loadError = 'Não foi possível consultar a pasta da atividade.';
const saveError = 'Não foi possível salvar a pasta.';
const endpoint = '/api/records/activity-media';

function checked(body: unknown, owner: Props): ActivityMediaFolderView {
  const data = body as Partial<ActivityMediaFolderView> | null;
  if (data?.viewerId !== owner.userId || data.projectId !== owner.projectId || data.scheduleItemId !== owner.scheduleItemId) {
    throw new Error('Sua sessão ou atividade mudou. Atualize antes de continuar.');
  }
  if (!Array.isArray(data.folders) || !Number.isSafeInteger(data.version)) throw new Error(loadError);
  return data as ActivityMediaFolderView;
}

function responseError(body: unknown, fallback: string) {
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : fallback;
}

export default function ActivityMediaFolder(props: Props) {
  const { userId, projectId, scheduleItemId } = props;
  const query = new URLSearchParams({ projectId, scheduleItemId }).toString();
  const [result, setResult] = useState<Load | null>(null);
  const [reload, setReload] = useState(0);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const selectId = useId(), headingId = useId();
  const pending = useRef<{ folderId: string | null; operationKey: string } | null>(null);
  const operation = useRef<AbortController | null>(null);
  const view = result?.view;

  useEffect(() => {
    const load = new AbortController();
    fetch(endpoint + '?' + query, { cache: 'no-store', signal: load.signal }).then(async response => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, loadError));
      if (load.signal.aborted) return;
      const verified = checked(body, { userId, projectId, scheduleItemId });
      setChoice(verified.selected?.id ?? '');
      setResult({ view: verified, error: '' });
    }).catch(error => {
      if (!load.signal.aborted) setResult({ view: null, error: error instanceof Error ? error.message : loadError });
    });
    return () => { load.abort(); operation.current?.abort(); };
  }, [projectId, query, reload, scheduleItemId, userId]);

  function retry() {
    setResult(null); setMessage(''); pending.current = null;
    setReload(value => value + 1);
  }

  async function save(folderId: string | null) {
    if (operation.current || !view) return;
    if (pending.current?.folderId !== folderId) pending.current = { folderId, operationKey: crypto.randomUUID() };
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true); setMessage(''); setResult({ view, error: '' });
    try {
      const response = await fetch(endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' },
        body: JSON.stringify({ projectId, scheduleItemId, folderId, expectedVersion: view.version, operationKey: pending.current.operationKey }),
      });
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setResult({ view: [401, 403, 404, 409].includes(response.status) ? null : view, error: responseError(body, saveError) });
        return;
      }
      const verified = checked(body, props);
      setResult({ view: verified, error: '' });
      setChoice(verified.selected?.id ?? '');
      pending.current = null;
      setMessage(verified.selected?.id === folderId && folderId ? 'Pasta vinculada à atividade.'
        : !folderId && !verified.selected && !verified.unavailable ? 'Vínculo removido.' : 'Pasta atualizada. Confira o vínculo exibido.');
    } catch (error) {
      if (!controller.signal.aborted) setResult({ view: null, error: error instanceof Error ? error.message : saveError });
    } finally {
      if (operation.current === controller) operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (choice && choice !== view?.selected?.id) void save(choice);
  }

  return <section className={styles.mediaFolder} aria-labelledby={headingId} aria-busy={busy || !result}>
    <div className={styles.mediaFolderHeader}><FolderClosed size={18} aria-hidden="true"/><h3 id={headingId}>Vídeos da atividade</h3></div>
    {!result && <p role="status">Consultando pastas…</p>}
    {busy && <p role="status">Atualizando vínculo…</p>}
    {message && <p role="status">{message}</p>}
    {result?.error && <p className={`p-inline-error ${styles.mediaFolderError}`} role="alert">{result.error}</p>}
    {result && !view && <button type="button" className="p-button p-button-subtle" onClick={retry}>Atualizar consulta</button>}
    {view && <>
      {view.selected && <a className="p-button p-button-subtle" href={endpoint + '?' + query + '&view=open'} target="_blank" rel="noopener noreferrer">
        {view.selected.name}<ExternalLink size={16} aria-hidden="true"/><span className="sr-only"> (abre no Google Drive em nova aba)</span>
      </a>}
      {view.unavailable && <p role="status">A pasta vinculada está indisponível. Escolha outra ou remova o vínculo.</p>}
      {view.folders.length ? <form className={styles.mediaFolderForm} onSubmit={submit}>
        <label className="p-field" htmlFor={selectId}><span>Pasta para vídeos</span>
          <select id={selectId} disabled={busy} value={choice} onChange={event => { setChoice(event.target.value); setMessage(''); }}>
            <option value="">Escolha uma pasta restrita</option>
            {view.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy || !choice || choice === view.selected?.id} className="p-button p-button-primary">Vincular pasta</button>
      </form> : <p>Peça à administração que cadastre uma pasta do projeto com acesso só para a gestão.</p>}
      {view.truncated && <p>São exibidas até 100 pastas deste projeto.</p>}
      {(view.selected || view.unavailable) && <button disabled={busy} type="button" className="p-button p-button-subtle" onClick={() => void save(null)}>Remover vínculo</button>}
    </>}
  </section>;
}
