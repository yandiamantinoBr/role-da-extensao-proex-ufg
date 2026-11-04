'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SHEET_TAB_KEYS, SHEET_TAB_LABELS, sheetTabGid, type SheetTabKey, type SheetTabs } from '@/lib/sync/sheet-tab-catalog';

type Draft = Partial<Record<SheetTabKey, string>>;
const path = '/api/sync?sheetTabs=1';

export default function SyncSheetTabSettings({ spreadsheetId, onSaved }: { spreadsheetId: string; onSaved: () => void }) {
  const [opened, setOpened] = useState(false);
  const [saved, setSaved] = useState<SheetTabs | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    void fetch(path, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json() as SheetTabs & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar os atalhos.');
      if (result.spreadsheetId !== spreadsheetId) throw new Error('A planilha conectada mudou. Atualize o status da integração.');
      if (controller.signal.aborted) return;
      setSaved(result);
      setDraft(Object.fromEntries(SHEET_TAB_KEYS.flatMap(tab => result.tabs[tab] ? [[tab, result.tabs[tab].url]] : [])));
      setError('');
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os atalhos.');
    });
    return () => controller.abort();
  }, [opened, spreadsheetId, reload]);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !saved) return;
    setError('');
    setMessage('');
    const tabs: Partial<Record<SheetTabKey, number>> = {};
    for (const key of SHEET_TAB_KEYS) {
      const link = draft[key]?.trim();
      if (!link) continue;
      const gid = sheetTabGid(link, spreadsheetId);
      if (gid === null) {
        setError(`Cole o link da aba “${SHEET_TAB_LABELS[key]}” da planilha mestre conectada.`);
        return;
      }
      if (Object.values(tabs).includes(gid)) {
        setError('O mesmo link de aba foi preenchido em mais de um campo. Confira os endereços.');
        return;
      }
      tabs[key] = gid;
    }
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    try {
      const response = await fetch('/api/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' },
        signal: controller.signal,
        body: JSON.stringify({ action: 'sheet_tabs.configure', spreadsheetId, expectedVersion: saved.version, tabs, operationKey: crypto.randomUUID() }),
      });
      const result = await response.json() as SheetTabs & { error?: string };
      if (!response.ok || result.spreadsheetId !== spreadsheetId) throw new Error(result.error || 'Não foi possível salvar os atalhos.');
      if (controller.signal.aborted) return;
      setSaved(result);
      setDraft(Object.fromEntries(SHEET_TAB_KEYS.flatMap(tab => result.tabs[tab] ? [[tab, result.tabs[tab].url]] : [])));
      setMessage('Atalhos da planilha mestre salvos.');
      onSaved();
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os atalhos.');
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return <details className="rounded-xl border border-border p-4" onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className="min-h-11 cursor-pointer py-2 font-medium">Configurar atalhos das abas</summary>
    <p className="mt-2 text-sm">Abra a aba na planilha mestre, copie o endereço do navegador e cole no campo correspondente. Campos vazios ficam sem atalho. Esta configuração não muda as células nem o acesso no Google.</p>
    {error && <p className="my-3 text-sm text-[var(--danger)]" role="alert">{error}</p>}
    {message && <p className="my-3 text-sm font-medium" role="status">{message}</p>}
    {opened && !saved && !error && <p className="my-3 text-sm" role="status">Carregando atalhos…</p>}
    {saved && <form onSubmit={submit} className="mt-4 grid gap-4">
      <fieldset disabled={saving} className="grid min-w-0 gap-3 sm:grid-cols-2">
        {SHEET_TAB_KEYS.map(key => <label key={key} className="p-field !mb-0">
          <span>{SHEET_TAB_LABELS[key]}</span>
          <input type="url" value={draft[key] ?? ''} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} maxLength={1024} placeholder="Link da aba no Google Sheets" />
        </label>)}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="p-button p-button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar atalhos'}</button>
        {error && <button type="button" className="p-button p-button-subtle" onClick={() => { setSaved(null); setReload(value => value + 1); setError(''); }}>Recarregar atalhos</button>}
      </div>
    </form>}
    {!saved && error && <button type="button" className="p-button p-button-subtle" onClick={() => { setReload(value => value + 1); setError(''); }}>Tentar novamente</button>}
  </details>;
}
