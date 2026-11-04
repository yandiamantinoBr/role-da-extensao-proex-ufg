'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, FileSpreadsheet } from 'lucide-react';
import { SHEET_TAB_KEYS, SHEET_TAB_LABELS, type SheetTabKey } from '@/lib/sync/sheet-tab-catalog';
import styles from './sheet-shortcuts.module.css';

type Props = {
  canSync: boolean;
  userId: string;
  context: 'reports' | 'settings' | 'project';
  tabKeys?: readonly SheetTabKey[];
  projectScoped?: boolean;
  refreshKey?: number;
};
type LinkSet = { master: string; tabs: Partial<Record<SheetTabKey, string>> };
type Result = { status: 'loading' | 'empty' | 'error' } | { status: 'ready'; links: LinkSet };

function shortcutLinks(body: unknown): LinkSet | null {
  if (!body || typeof body !== 'object') return null;
  const { spreadsheetId, spreadsheetUrl, tabs } = body as {
    spreadsheetId?: unknown;
    spreadsheetUrl?: unknown;
    tabs?: Partial<Record<SheetTabKey, { gid?: unknown; url?: unknown }>>;
  };
  if (typeof spreadsheetId !== 'string' || !/^[-_A-Za-z0-9]{10,200}$/.test(spreadsheetId)) return null;
  const master = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  if (spreadsheetUrl !== master) return null;
  const shortcuts: LinkSet['tabs'] = {};
  for (const key of SHEET_TAB_KEYS) {
    const tab = tabs?.[key];
    const gid = tab?.gid;
    if (typeof gid !== 'number' || !Number.isSafeInteger(gid) || gid < 0 || gid > 2147483647) continue;
    const url = `${master}?gid=${gid}#gid=${gid}`;
    if (tab?.url === url || tab?.url === `${master}#gid=${gid}`) shortcuts[key] = url;
  }
  return { master, tabs: shortcuts };
}

function AvailableShortcuts({ context, tabKeys, projectScoped }: Pick<Props, 'context' | 'tabKeys' | 'projectScoped'>) {
  const [result, setResult] = useState<Result>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/sync?sheetTabs=1', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok) throw new Error('Não foi possível consultar os atalhos.');
        return shortcutLinks(await response.json());
      })
      .then(links => {
        if (!controller.signal.aborted) setResult(links ? { status: 'ready', links } : { status: 'empty' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ status: 'error' });
      });
    return () => controller.abort();
  }, []);

  if (result.status !== 'ready') {
    if (context !== 'settings' || result.status === 'empty') return null;
    return <p className={styles.help} role="status">{result.status === 'loading' ? 'Consultando atalhos da planilha…' : 'Não foi possível consultar os atalhos da planilha.'}</p>;
  }
  const { master, tabs } = result.links;
  const linkedTabs = (context === 'settings' ? SHEET_TAB_KEYS : tabKeys ?? []).filter(key => Boolean(tabs[key]));
  const mainTab = context === 'reports' ? linkedTabs[0] : undefined;
  return <aside className={styles.root} aria-label="Planilha mestre">
    <div className={styles.heading}>
      <div><strong><FileSpreadsheet size={17} aria-hidden="true" />Planilha mestre</strong>
        <p className={styles.help}>{projectScoped
          ? 'Acesso geral da gestão. A planilha reúne vários projetos.'
          : context === 'reports'
            ? 'Consulte a base geral no Google Sheets.'
            : 'Consulte a base geral com sua conta autorizada no Google.'}</p>
      </div>
      <a className="p-button p-button-subtle" href={mainTab ? tabs[mainTab] : master} target="_blank" rel="noopener noreferrer">
        {mainTab ? `Abrir aba ${SHEET_TAB_LABELS[mainTab]}` : 'Abrir planilha mestre'}<ExternalLink size={15} aria-hidden="true" />
      </a>
    </div>
    {context === 'reports' && <p className={styles.help}>A planilha mostra a base geral. O Excel e os demais arquivos baixados seguem os filtros deste relatório.</p>}
    {context === 'settings' && linkedTabs.length > 0 && <ul className={styles.tabs} aria-label="Abas da planilha mestre">
      {linkedTabs.map(key => <li key={key}><a className="p-button p-button-subtle" href={tabs[key]} target="_blank" rel="noopener noreferrer">{SHEET_TAB_LABELS[key]}<ExternalLink size={14} aria-hidden="true" /></a></li>)}
    </ul>}
    <p className={styles.help}>Para editar pela planilha, use as colunas em creme ou a aba <strong>Operações</strong>. Na planilha, use <strong>PROEX → Sincronizar agora</strong> para enviar as mudanças ao portal.</p>
  </aside>;
}

export function SheetShortcuts({ canSync, userId, refreshKey = 0, ...props }: Props) {
  if (!canSync || !userId) return null;
  return <AvailableShortcuts key={JSON.stringify([userId, refreshKey])} {...props} />;
}
