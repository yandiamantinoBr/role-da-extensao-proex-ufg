import type { PortalActor } from '../access';
import { isCivilDate } from '../civil-date';
import { all, one, uid, iso } from '../database';
import { HttpError } from '../errors';
import { prepareMutation } from '../mutations';
import { expectedVersion, identifier, only, personText, requireActor, requireInternalMember } from './shared';

/*
 * Personal widgets (notes and reminders). Private to their owner: every query is fenced by user_id
 * from the session, there is no management view and no audit row (a body never leaves this table).
 * Account anonymization deletes them (lib/privacy.ts).
 */
export const NOTE_LIMIT = 30;
export const OPEN_REMINDER_LIMIT = 50;
export type WidgetSettings = { notes: boolean; reminders: boolean; roleShortcut: boolean; version: number };
const flag = (value: unknown, label: string) => { if (typeof value !== 'boolean') throw new HttpError(400, `Escolha se ${label} fica ligado.`, 'invalid_widget_setting'); return value ? 1 : 0; };
function dueTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new HttpError(400, 'Use a hora no formato 24 horas, como 14:30.', 'invalid_reminder_time');
  return value;
}
function dueOn(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isCivilDate(value)) throw new HttpError(400, 'Escolha uma data válida para o lembrete.', 'invalid_reminder_date');
  return value;
}
function failure(error: unknown): never {
  const text = String(error);
  if (text.includes('community_access_changed')) throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'community_access_changed');
  if (text.includes('note_limit')) throw new HttpError(409, `Você já tem ${NOTE_LIMIT} anotações. Apague alguma para criar outra.`, 'note_limit');
  if (text.includes('reminder_limit')) throw new HttpError(409, `Você já tem ${OPEN_REMINDER_LIMIT} lembretes abertos. Conclua ou apague algum.`, 'reminder_limit');
  throw error;
}

/*
 * Floating dock (0043): which widgets the person turned on, which panel is open (or minimized) and which registered
 * launchers (e.g. the Rolê) are hidden. Personal UI state, last write wins. All widgets start off.
 */
export const DOCK_WIDGETS = ['notes', 'reminders', 'calendar', 'demands', 'shortcuts'] as const;
export type DockWidget = typeof DOCK_WIDGETS[number];
export type DockState = { enabled: DockWidget[]; open: DockWidget | 'gallery' | null; minimized: boolean; hidden: string[] };
const DOCK_ITEM = /^[a-z][a-z0-9-]{0,30}$/;
export function parseDock(raw: unknown, legacy?: { notes?: unknown; reminders?: unknown }): DockState {
  let value: Record<string, unknown> = {};
  try { const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as Record<string, unknown>; } catch { value = {}; }
  const enabledRaw = Array.isArray(value.enabled) ? value.enabled : [...(legacy?.notes ? ['notes'] : []), ...(legacy?.reminders ? ['reminders'] : [])];
  const enabled = DOCK_WIDGETS.filter(id => enabledRaw.includes(id));
  const open = value.open === 'gallery' || (enabled as string[]).includes(String(value.open)) ? value.open as DockState['open'] : null;
  const hidden = Array.isArray(value.hidden) ? [...new Set(value.hidden.filter((item): item is string => typeof item === 'string' && DOCK_ITEM.test(item)))].slice(0, 10) : [];
  return { enabled, open, minimized: open !== null && value.minimized === true, hidden };
}
export async function dockState(db: D1Database, rawActor: PortalActor | null) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const row = await one(db, 'SELECT notes,reminders,dock FROM personal_widget_settings WHERE user_id=?', [actor.userId]);
  const dock = parseDock(row?.dock ?? '{}', row ?? undefined);
  // One light count for the reminders badge; widget contents load only when a panel opens.
  const today = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const due = dock.enabled.includes('reminders') ? await one(db, "SELECT COUNT(*) n FROM personal_notes WHERE user_id=? AND kind='reminder' AND done_at IS NULL AND due_on IS NOT NULL AND due_on<=?", [actor.userId, today]) : null;
  return { dock, badges: { reminders: Number(due?.n ?? 0) } };
}
export async function saveDock(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor);
  const member = await requireInternalMember(db, actor);
  only(input, ['action', 'enabled', 'open', 'minimized', 'hidden']);
  if (!Array.isArray(input.enabled) || !Array.isArray(input.hidden) || typeof input.minimized !== 'boolean' || !(input.open === null || typeof input.open === 'string')) throw new HttpError(400, 'Estado da doca inválido.', 'invalid_dock');
  if (input.enabled.some(id => !(DOCK_WIDGETS as readonly unknown[]).includes(id)) || input.hidden.some(id => typeof id !== 'string' || !DOCK_ITEM.test(id)) || input.hidden.length > 10) throw new HttpError(400, 'Estado da doca inválido.', 'invalid_dock');
  const dock = parseDock(input), now = iso();
  const notes = dock.enabled.includes('notes') ? 1 : 0, reminders = dock.enabled.includes('reminders') ? 1 : 0;
  try {
    await db.batch([
      db.prepare(`SELECT CASE WHEN ${member.sql} THEN 1 ELSE json_extract('[]','community_access_changed') END`).bind(...member.values),
      db.prepare(`INSERT INTO personal_widget_settings(user_id,notes,reminders,role_shortcut,dock,version,updated_at) VALUES(?,?,?,0,?,1,?)
        ON CONFLICT(user_id) DO UPDATE SET notes=excluded.notes,reminders=excluded.reminders,dock=excluded.dock,version=version+1,updated_at=excluded.updated_at`).bind(actor.userId, notes, reminders, JSON.stringify(dock), now),
    ]);
  } catch (error) { failure(error); }
  return { dock };
}

export async function widgetState(db: D1Database, rawActor: PortalActor | null) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const row = await one(db, 'SELECT notes,reminders,role_shortcut,version FROM personal_widget_settings WHERE user_id=?', [actor.userId]);
  const settings: WidgetSettings = { notes: !!row?.notes, reminders: !!row?.reminders, roleShortcut: !!row?.role_shortcut, version: Number(row?.version ?? 0) };
  const notes = settings.notes ? await all(db, "SELECT id,body,version,updated_at updatedAt FROM personal_notes WHERE user_id=? AND kind='note' ORDER BY updated_at DESC,id LIMIT ?", [actor.userId, NOTE_LIMIT]) : [];
  const reminders = settings.reminders ? await all(db, `SELECT id,body,due_on dueOn,due_time dueTime,done_at doneAt,version FROM personal_notes
    WHERE user_id=? AND kind='reminder' AND (done_at IS NULL OR done_at>?)
    ORDER BY done_at IS NOT NULL, due_on IS NULL, due_on, due_time IS NULL, due_time, created_at, id LIMIT ?`, [actor.userId, new Date(Date.now() - 7 * 86400000).toISOString(), OPEN_REMINDER_LIMIT + 20]) : [];
  return { settings, notes, reminders };
}

export async function widgetAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor);
  const member = await requireInternalMember(db, actor);
  const memberGuard = () => db.prepare(`SELECT CASE WHEN ${member.sql} THEN 1 ELSE json_extract('[]','community_access_changed') END`).bind(...member.values);
  const now = iso();
  if (input.action === 'settings') {
    only(input, ['action', 'notes', 'reminders', 'roleShortcut', 'expectedVersion']);
    const notes = flag(input.notes, 'Anotações'), reminders = flag(input.reminders, 'Lembretes'), role = flag(input.roleShortcut, 'o atalho do Rolê');
    if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) throw new HttpError(400, 'Atualize a página e tente novamente.', 'invalid_version');
    const version = input.expectedVersion as number;
    const write = version === 0
      ? db.prepare('INSERT INTO personal_widget_settings(user_id,notes,reminders,role_shortcut,version,updated_at) VALUES(?,?,?,?,1,?) ON CONFLICT(user_id) DO NOTHING').bind(actor.userId, notes, reminders, role, now)
      : db.prepare('UPDATE personal_widget_settings SET notes=?,reminders=?,role_shortcut=?,version=version+1,updated_at=? WHERE user_id=? AND version=?').bind(notes, reminders, role, now, actor.userId, version);
    let results: D1Result[];
    try { results = await db.batch([memberGuard(), write]); } catch (error) { failure(error); }
    if (results[1].meta.changes !== 1) throw new HttpError(409, 'Seus widgets mudaram em outra janela. Atualize a página.', 'widget_settings_changed');
    return { settings: { notes: !!notes, reminders: !!reminders, roleShortcut: !!role, version: version + 1 } };
  }
  if (input.action === 'create') {
    only(input, ['action', 'kind', 'body', 'dueOn', 'dueTime', 'operationKey']);
    if (input.kind !== 'note' && input.kind !== 'reminder') throw new HttpError(400, 'Escolha anotação ou lembrete.', 'invalid_note_kind');
    const body = personText(input.body, 1, 500, 'Escreva de 1 a 500 caracteres.');
    const day = input.kind === 'reminder' ? dueOn(input.dueOn) : null, time = input.kind === 'reminder' ? dueTime(input.dueTime) : null;
    if (input.kind === 'note' && (input.dueOn || input.dueTime)) throw new HttpError(400, 'Anotações não têm data. Use um lembrete.', 'invalid_note_fields');
    if (time && !day) throw new HttpError(400, 'Escolha a data antes da hora.', 'invalid_reminder_time');
    // The private text is deliberately left out of the idempotency fingerprint (mutation_keys outlives the note).
    const mutation = await prepareMutation(db, actor.userId, `widget.${input.kind}.create`, { kind: input.kind, dueOn: day, dueTime: time, operationKey: input.operationKey });
    if (mutation.existingId) return { id: mutation.existingId, duplicate: true };
    const id = uid();
    const limit = input.kind === 'note'
      ? db.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM personal_notes WHERE user_id=? AND kind='note')<? THEN 1 ELSE json_extract('[]','note_limit') END").bind(actor.userId, NOTE_LIMIT)
      : db.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM personal_notes WHERE user_id=? AND kind='reminder' AND done_at IS NULL)<? THEN 1 ELSE json_extract('[]','reminder_limit') END").bind(actor.userId, OPEN_REMINDER_LIMIT);
    try {
      await db.batch([memberGuard(), limit,
        db.prepare('INSERT INTO personal_notes(id,user_id,kind,body,due_on,due_time,version,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)').bind(id, actor.userId, input.kind, body, day, time, now, now),
        mutation.claimStatement(id)]);
    } catch (error) {
      if (/note_limit|reminder_limit|community_access_changed/.test(String(error))) failure(error);
      return { id: await mutation.recover(error), duplicate: true };
    }
    return { id, duplicate: false };
  }
  if (input.action === 'update' || input.action === 'done' || input.action === 'delete') {
    const allowed = { update: ['action', 'id', 'body', 'dueOn', 'dueTime', 'expectedVersion'], done: ['action', 'id', 'done', 'expectedVersion'], delete: ['action', 'id', 'expectedVersion'] }[input.action];
    only(input, allowed);
    const id = identifier(input.id, 'o item'), version = expectedVersion(input.expectedVersion);
    const current = await one(db, 'SELECT kind FROM personal_notes WHERE id=? AND user_id=?', [id, actor.userId]);
    if (!current) throw new HttpError(404, 'Este item não existe mais. Atualize a página.', 'note_not_found');
    let write: D1PreparedStatement;
    if (input.action === 'delete') write = db.prepare('DELETE FROM personal_notes WHERE id=? AND user_id=? AND version=?').bind(id, actor.userId, version);
    else if (input.action === 'done') {
      if (current.kind !== 'reminder' || typeof input.done !== 'boolean') throw new HttpError(400, 'Só lembretes podem ser concluídos.', 'invalid_note_fields');
      write = input.done
        ? db.prepare('UPDATE personal_notes SET done_at=?,version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=?').bind(now, now, id, actor.userId, version)
        : db.prepare("UPDATE personal_notes SET done_at=NULL,version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=? AND (SELECT COUNT(*) FROM personal_notes WHERE user_id=? AND kind='reminder' AND done_at IS NULL)<?").bind(now, id, actor.userId, version, actor.userId, OPEN_REMINDER_LIMIT);
    } else {
      const body = personText(input.body, 1, 500, 'Escreva de 1 a 500 caracteres.');
      const day = current.kind === 'reminder' ? dueOn(input.dueOn) : null, time = current.kind === 'reminder' ? dueTime(input.dueTime) : null;
      if (current.kind === 'note' && (input.dueOn || input.dueTime)) throw new HttpError(400, 'Anotações não têm data. Use um lembrete.', 'invalid_note_fields');
      if (time && !day) throw new HttpError(400, 'Escolha a data antes da hora.', 'invalid_reminder_time');
      write = db.prepare('UPDATE personal_notes SET body=?,due_on=?,due_time=?,version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=?').bind(body, day, time, now, id, actor.userId, version);
    }
    let results: D1Result[];
    try { results = await db.batch([memberGuard(), write]); } catch (error) { failure(error); }
    if (results[1].meta.changes !== 1) throw new HttpError(409, 'Este item mudou em outra janela. Atualize a página.', 'note_changed');
    return { id };
  }
  throw new HttpError(400, 'Operação de widget inválida.', 'invalid_action');
}
