// Operational entry points in the existing, private Google Sheets workbook.
export const SHEET_TAB_LABELS = {
  projects: 'Projetos e ações',
  items: 'Materiais e patrimônio',
  stock_movements: 'Movimentações de estoque',
  loans: 'Empréstimos',
  records: 'Registros',
  campaigns: 'Dinâmicas e eventos',
  project_schedule_items: 'Agenda de projetos',
  followup_tasks: 'Demandas',
  followup_checklists: 'Conferências',
  'Operações': 'Operações',
  'Conflitos': 'Conflitos',
  'Controle': 'Controle',
} as const;

export type SheetTabKey = keyof typeof SHEET_TAB_LABELS;
export const SHEET_TAB_KEYS = Object.keys(SHEET_TAB_LABELS) as SheetTabKey[];
export type SheetTabs = {
  spreadsheetId: string | null;
  spreadsheetUrl: string | null;
  version: number;
  tabs: Partial<Record<SheetTabKey, { gid: number; url: string }>>;
};

/** A link can only configure a tab of the workbook that is already connected. */
export function sheetTabGid(link: string, spreadsheetId: string): number | null {
  try {
    const url = new URL(link.trim());
    if (url.origin !== 'https://docs.google.com' || url.username || url.password) return null;
    const match = url.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)\/edit\/?$/);
    if (match?.[1] !== spreadsheetId) return null;
    const query = url.searchParams.getAll('gid');
    const fragment = new URLSearchParams(url.hash.slice(1)).getAll('gid');
    const ids = [...query, ...fragment];
    if (!ids.length || ids.some(id => id !== ids[0]) || !/^\d{1,10}$/.test(ids[0])) return null;
    const gid = Number(ids[0]);
    return gid <= 2147483647 ? gid : null;
  } catch { return null; }
}
