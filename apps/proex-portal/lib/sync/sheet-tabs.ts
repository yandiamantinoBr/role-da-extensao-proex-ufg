import { all, iso, uid } from '../database';
import { HttpError } from '../errors';
import { prepareMutation } from '../mutations';
import type { PortalActor } from '../access';
import { requireSyncOwner, SYNC_CONFIGURATION_KEY, SYNC_OWNER_SQL } from './contracts';
import { SHEET_TAB_KEYS, type SheetTabKey, type SheetTabs } from './sheet-tab-catalog';

export const SHEET_TABS_KEY = 'sync.google_sheets.sheet_tabs';
type TabIds = Partial<Record<SheetTabKey, number>>;

function spreadsheetId(value: unknown): value is string {
  return typeof value === 'string' && /^[-_A-Za-z0-9]{10,200}$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsed(value: string | null): Record<string, unknown> | null {
  try {
    const result: unknown = JSON.parse(value ?? 'null');
    return record(result) ? result : null;
  } catch {
    return null;
  }
}

function tabIds(value: unknown): TabIds | null {
  if (!record(value)) return null;
  const entries = Object.entries(value);
  const used = new Set<number>();
  for (const [name, gid] of entries) {
    if (!SHEET_TAB_KEYS.some(key => key === name) || typeof gid !== 'number' ||
      !Number.isSafeInteger(gid) || gid < 0 || gid > 2147483647 || used.has(gid)) return null;
    used.add(gid);
  }
  return Object.fromEntries(entries);
}

async function readState(db: D1Database) {
  const rows = await all(db, 'SELECT name,value FROM settings WHERE name IN (?,?)', [SYNC_CONFIGURATION_KEY, SHEET_TABS_KEY]);
  const configValue: string | null = rows.find(row => row.name === SYNC_CONFIGURATION_KEY)?.value ?? null;
  const tabsValue: string | null = rows.find(row => row.name === SHEET_TABS_KEY)?.value ?? null;
  const config = parsed(configValue), mapping = parsed(tabsValue);
  const activeId = spreadsheetId(config?.spreadsheetId) ? config.spreadsheetId : null;
  const validTabs = activeId && mapping?.spreadsheetId === activeId ? tabIds(mapping.tabs) : null;
  const version = validTabs && typeof mapping?.version === 'number' && Number.isSafeInteger(mapping.version) && mapping.version > 0 ? mapping.version : 0;
  return { configValue, tabsValue, activeId, version, tabs: version ? validTabs ?? {} : {} };
}

function configurationChanged() {
  return new HttpError(409, 'A planilha mestre mudou. Atualize a configuração antes de salvar os atalhos.', 'sheet_tabs_configuration_changed');
}

function mappingChanged() {
  return new HttpError(409, 'Os atalhos foram alterados. Releia a configuração e tente novamente.', 'sheet_tabs_changed');
}

export async function sheetTabsStatus(db: D1Database, actor: PortalActor | null): Promise<SheetTabs> {
  await requireSyncOwner(db, actor);
  const { activeId, version, tabs } = await readState(db);
  await requireSyncOwner(db, actor);
  const spreadsheetUrl = activeId ? `https://docs.google.com/spreadsheets/d/${activeId}/edit` : null;
  return {
    spreadsheetId: activeId, spreadsheetUrl, version,
    tabs: spreadsheetUrl ? Object.fromEntries(Object.entries(tabs).map(([key, gid]) => [key, { gid, url: `${spreadsheetUrl}?gid=${gid}#gid=${gid}` }])) : {},
  };
}

export async function configureSheetTabs(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>): Promise<SheetTabs> {
  await requireSyncOwner(db, actor);
  if (!actor) throw new HttpError(401, 'Entre para configurar os atalhos.', 'unauthenticated');
  const tabs = tabIds(input.tabs);
  if (!spreadsheetId(input.spreadsheetId) || !tabs || typeof input.expectedVersion !== 'number' ||
    !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion === Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, 'Confira a planilha, a versão e os identificadores distintos das abas.', 'invalid_sheet_tabs');
  }
  const state = await readState(db);
  if (state.activeId !== input.spreadsheetId) throw configurationChanged();
  const responseForWorkbook = async () => {
    const current = await sheetTabsStatus(db, actor);
    if (current.spreadsheetId !== input.spreadsheetId) throw configurationChanged();
    return current;
  };
  const mutation = await prepareMutation(db, actor.userId, 'sheet_tabs.configure', input);
  if (mutation.existingId) return responseForWorkbook();
  if (input.expectedVersion !== state.version) throw mappingChanged();
  const now = iso();
  const next = JSON.stringify({ spreadsheetId: input.spreadsheetId, tabs, version: state.version + 1 });
  try {
    await db.batch([
      db.prepare(`SELECT CASE WHEN ${SYNC_OWNER_SQL} THEN 1 ELSE json_extract('[]','sheet_tabs_forbidden') END`).bind(actor.userId),
      db.prepare("SELECT CASE WHEN (SELECT value FROM settings WHERE name=?) IS ? THEN 1 ELSE json_extract('[]','sheet_tabs_configuration_changed') END").bind(SYNC_CONFIGURATION_KEY, state.configValue),
      db.prepare("SELECT CASE WHEN (SELECT value FROM settings WHERE name=?) IS ? THEN 1 ELSE json_extract('[]','sheet_tabs_changed') END").bind(SHEET_TABS_KEY, state.tabsValue),
      mutation.claimStatement(SHEET_TABS_KEY),
      db.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(SHEET_TABS_KEY, next, now),
      db.prepare("INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) VALUES(?,?,'sheet_tabs.configure',?,'{}',?)").bind(uid(), actor.userId, SHEET_TABS_KEY, now),
    ]);
  } catch (error) {
    await requireSyncOwner(db, actor);
    if (String(error).includes('sheet_tabs_configuration_changed')) throw configurationChanged();
    try {
      await mutation.recover(error);
    } catch (failure) {
      if (String(failure).includes('sheet_tabs_changed')) throw mappingChanged();
      throw failure;
    }
  }
  return responseForWorkbook();
}
