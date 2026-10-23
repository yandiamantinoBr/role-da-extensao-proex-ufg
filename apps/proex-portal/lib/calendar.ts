import { accessibleProjects, getActor, writeAudit, type PortalActor } from './access';
import { all, one, type Row } from './database';
import { HttpError } from './errors';

export const CALENDAR_CATEGORIES = ['loans', 'materials', 'projects', 'consumption'] as const;
export type CalendarCategory = typeof CALENDAR_CATEGORIES[number];
export const CALENDAR_LABELS: Record<CalendarCategory, string> = {
  loans: 'Empréstimos', materials: 'Materiais', projects: 'Projetos e eventos', consumption: 'Consumo',
};
export type CalendarEntry = {
  uid: string; sourceId: string; sourceKind: string; projectId: string; projectName: string;
  category: CalendarCategory; title: string; startsAt: string; endsAt: string; allDay: boolean;
  status: 'CONFIRMED' | 'CANCELLED'; state: string; revision: number; lastModified: string;
  transparent: boolean; location: string;
};
export type CalendarRange = { from: string; to: string; startsAt: string; endsAt: string; timezone: string };
const DAY = 86_400_000;
const MAX_ENTRIES = 10_000;
const capabilities: Record<CalendarCategory, string[]> = {
  loans: ['loans.read'], materials: ['inventory.read'],
  projects: ['reports.read', 'campaigns.manage'], consumption: ['inventory.read'],
};

function categoryValue(value: unknown): CalendarCategory {
  if (typeof value !== 'string' || !CALENDAR_CATEGORIES.includes(value as CalendarCategory)) {
    throw new HttpError(400, 'Escolha uma categoria da agenda.', 'invalid_calendar_category');
  }
  return value as CalendarCategory;
}
function projectValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new HttpError(400, 'Escolha um projeto válido.', 'invalid_project');
  }
  return value;
}
function dayInBrazil(value: string | number | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
function dateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
export function calendarRange(from?: string | null, to?: string | null, now = new Date()): CalendarRange {
  const today = dayInBrazil(now);
  const first = `${today.slice(0, 7)}-01`;
  const next = new Date(`${first}T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCDate(0);
  const start = from || first, end = to || next.toISOString().slice(0, 10);
  if (!dateOnly(start) || !dateOnly(end)) throw new HttpError(400, 'Informe datas válidas para a agenda.', 'invalid_calendar_range');
  // Dates are civil days in Brasília. Explicit UTC-03 matches this portal's supported event period.
  const startsAt = new Date(`${start}T00:00:00-03:00`), endsAt = new Date(Date.parse(`${end}T00:00:00-03:00`) + DAY);
  if (endsAt.getTime() <= startsAt.getTime() || endsAt.getTime() - startsAt.getTime() > 732 * DAY) {
    throw new HttpError(400, 'Escolha um intervalo de até dois anos.', 'invalid_calendar_range');
  }
  return { from: start, to: end, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), timezone: 'America/Sao_Paulo' };
}
function categoryScope(actor: PortalActor | null, category: CalendarCategory): string[] | null {
  const scopes = capabilities[category].map(capability => accessibleProjects(actor, capability));
  return scopes.some(scope => scope === null) ? null : [...new Set(scopes.flatMap(scope => scope ?? []))];
}
function requireScope(actor: PortalActor | null, category: CalendarCategory, projectId: string | null, global = false): string[] | null {
  if (!actor) throw new HttpError(401, 'Entre para acessar a agenda.', 'unauthenticated');
  const scope = categoryScope(actor, category);
  if (global ? scope !== null : (scope !== null && (projectId ? !scope.includes(projectId) : !scope.length))) {
    throw new HttpError(403, 'Você não tem permissão para esta categoria ou projeto.', 'forbidden');
  }
  return projectId ? [projectId] : scope;
}
function sqlScope(column: string, scope: string[] | null): { sql: string; values: unknown[] } {
  if (scope === null) return { sql: '1=1', values: [] };
  if (!scope.length) return { sql: '1=0', values: [] };
  return { sql: `${column} IN (${scope.map(() => '?').join(',')})`, values: scope };
}
function iso(value: unknown, fallback: string): string {
  const parsed = typeof value === 'number' || typeof value === 'string' ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}
function entry(row: Row, category: CalendarCategory, sourceKind: string, allDay = false): CalendarEntry {
  const startsAt = allDay ? String(row.starts_at) : iso(row.starts_at, row.created_at);
  const endsAt = allDay ? String(row.ends_at) : iso(row.ends_at, startsAt);
  return {
    uid: `${sourceKind}.${row.id}@proex-gestao`, sourceId: String(row.id), sourceKind,
    projectId: String(row.project_id), projectName: String(row.project_name), category,
    title: String(row.title), startsAt, endsAt, allDay,
    status: row.state === 'cancelled' || row.state === 'archived' ? 'CANCELLED' : 'CONFIRMED',
    state: String(row.state || 'recorded'), revision: Math.max(0, Number(row.revision) || 0),
    lastModified: iso(row.last_modified, iso(row.created_at, `${startsAt.slice(0, 10)}T12:00:00.000Z`)),
    transparent: allDay || row.state === 'returned' || row.state === 'cancelled' || row.state === 'archived',
    location: String(row.location || ''),
  };
}

/** A public projection: SQL never selects contacts, free notes, document keys or account identities. */
export async function calendarEntries(db: D1Database, actor: PortalActor | null, options: {
  category?: string | null; projectId?: string | null; range: CalendarRange;
}): Promise<{ entries: CalendarEntry[]; availableCategories: CalendarCategory[] }> {
  if (!actor) throw new HttpError(401, 'Entre para acessar a agenda.', 'unauthenticated');
  const projectId = projectValue(options.projectId);
  const availableCategories = CALENDAR_CATEGORIES.filter(category => {
    const scope = categoryScope(actor, category);
    return scope === null || (projectId ? scope.includes(projectId) : scope.length > 0);
  });
  const categories = !options.category || options.category === 'all' ? availableCategories : [categoryValue(options.category)];
  if (!categories.length) throw new HttpError(403, 'Seu acesso não permite consultar esta agenda.', 'forbidden');
  const result: CalendarEntry[] = [];
  const { range } = options;
  for (const category of categories) {
    const scope = requireScope(actor, category, projectId), filter = sqlScope('p.id', scope);
    let rows: Row[] = [];
    if (category === 'loans') {
      rows = await all(db, `SELECT l.id,l.project_id,p.name project_name,
        'Empréstimo · ' || i.name || ' · ' || l.action_name title,l.starts_at,l.ends_at,l.status state,
        l.created_at,COALESCE(NULLIF(l.updated_at,''),l.returned_at,l.checked_out_at,l.created_at) last_modified,
        (SELECT COUNT(*) FROM audit a WHERE a.entity_id=l.id)+1 revision
        FROM loans l JOIN projects p ON p.id=l.project_id JOIN items i ON i.id=l.item_id AND i.project_id=l.project_id
        WHERE ${filter.sql} AND l.starts_at<? AND l.ends_at>? LIMIT ${MAX_ENTRIES + 1}`,
      [...filter.values, Date.parse(range.endsAt), Date.parse(range.startsAt)]);
      result.push(...rows.map(row => entry(row, category, 'loan')));
    } else if (category === 'projects') {
      rows = await all(db, `SELECT p.id,p.id project_id,p.name project_name,'Projeto · ' || p.name title,
        p.starts_at,p.ends_at,p.status state,p.version revision,p.location,p.created_at,
        COALESCE((SELECT MAX(a.created_at) FROM audit a WHERE a.entity_id=p.id),p.created_at) last_modified
        FROM projects p WHERE ${filter.sql} AND p.starts_at IS NOT NULL AND p.ends_at IS NOT NULL
        AND julianday(p.starts_at)<julianday(?) AND julianday(p.ends_at)>julianday(?) LIMIT ${MAX_ENTRIES + 1}`,
      [...filter.values, range.endsAt, range.startsAt]);
      result.push(...rows.map(row => entry(row, category, 'project')));
      rows = await all(db, `SELECT c.id,c.project_id,p.name project_name,'Evento · ' || c.name title,
        c.starts_at,c.ends_at,c.status state,c.version revision,c.location,c.created_at,
        COALESCE((SELECT MAX(a.created_at) FROM audit a WHERE a.entity_id=c.id),c.created_at) last_modified
        FROM campaigns c JOIN projects p ON p.id=c.project_id WHERE ${filter.sql} AND c.status!='draft'
        AND julianday(c.starts_at)<julianday(?) AND julianday(c.ends_at)>julianday(?) LIMIT ${MAX_ENTRIES + 1}`,
      [...filter.values, range.endsAt, range.startsAt]);
      result.push(...rows.map(row => entry(row, category, 'campaign')));
    } else {
      // These are actual ledger dates, grouped by item/kind/civil day, never invented future reservations.
      rows = await all(db, `SELECT i.id || '.' || m.kind || '.' || date(m.created_at,'-3 hours') id,
        i.project_id,p.name project_name,? || ' · ' || i.name || ' · ' || SUM(m.delta) || ' ' || i.unit title,
        date(m.created_at,'-3 hours') starts_at,date(m.created_at,'-3 hours','+1 day') ends_at,
        'recorded' state,COUNT(*) revision,MIN(m.created_at) created_at,MAX(m.created_at) last_modified
        FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id
        WHERE ${filter.sql} AND m.kind${category === 'consumption' ? '=' : '!='}'consume'
        AND julianday(m.created_at)>=julianday(?) AND julianday(m.created_at)<julianday(?)
        GROUP BY i.id,m.kind,date(m.created_at,'-3 hours') LIMIT ${MAX_ENTRIES + 1}`,
      [CALENDAR_LABELS[category], ...filter.values, range.startsAt, range.endsAt]);
      result.push(...rows.map(row => entry(row, category, 'movement', true)));
    }
    const kinds: Record<CalendarCategory, string[]> = {
      loans: ['loan'], materials: ['material', 'maintenance', 'distribution'],
      projects: ['project'], consumption: ['consumption'],
    };
    const linkedLoanScope = sqlScope('r.project_id', accessibleProjects(actor, 'loans.read'));
    rows = await all(db, `SELECT r.id,r.project_id,p.name project_name,'Registro · ' || r.title title,
      COALESCE(r.starts_at,r.occurred_at) starts_at,COALESCE(r.ends_at,r.starts_at,r.occurred_at) ends_at,
      r.starts_at scheduled,'recorded' state,0 revision,r.created_at,r.created_at last_modified
      FROM records r JOIN projects p ON p.id=r.project_id
      LEFT JOIN loans linked_loan ON linked_loan.id=r.loan_id
      LEFT JOIN items linked_item ON linked_item.id=r.item_id WHERE ${filter.sql}
      AND (r.loan_id IS NULL OR (linked_loan.project_id=r.project_id AND (${linkedLoanScope.sql})))
      AND (r.item_id IS NULL OR linked_item.project_id=r.project_id)
      AND r.kind IN (${kinds[category].map(() => '?').join(',')})
      AND julianday(COALESCE(r.starts_at,r.occurred_at))<julianday(?)
      AND julianday(COALESCE(r.ends_at,r.starts_at,r.occurred_at))>=julianday(?) LIMIT ${MAX_ENTRIES + 1}`,
    [...filter.values, ...linkedLoanScope.values, ...kinds[category], range.endsAt, range.startsAt]);
    for (const row of rows) {
      if (!row.scheduled || Date.parse(row.ends_at) <= Date.parse(row.starts_at)) {
        row.starts_at = dayInBrazil(row.starts_at);
        row.ends_at = new Date(Date.parse(`${row.starts_at}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
        result.push(entry(row, category, 'record', true));
      } else result.push(entry(row, category, 'record'));
    }
    if (result.length > MAX_ENTRIES) throw new HttpError(422, 'Há muitos registros. Reduza o período ou escolha um projeto.', 'calendar_range_too_large');
  }
  return { entries: result.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.uid.localeCompare(b.uid)), availableCategories };
}

export async function calendarFeeds(db: D1Database, actor: PortalActor | null): Promise<Row[]> {
  if (!actor) throw new HttpError(401, 'Entre para acessar suas assinaturas.', 'unauthenticated');
  return all(db, `SELECT f.id,f.category,f.project_id,p.name project_name,f.created_at,f.expires_at,f.revoked_at
    FROM calendar_feeds f LEFT JOIN projects p ON p.id=f.project_id WHERE f.owner_id=? ORDER BY f.created_at DESC LIMIT 200`, [actor.userId]);
}
export async function calendarTokenHash(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function calendarAction(db: D1Database, actor: PortalActor | null, input: Row, origin: string): Promise<Row> {
  if (!actor) throw new HttpError(401, 'Entre para gerenciar suas assinaturas.', 'unauthenticated');
  if (input.action === 'feed.create') {
    const category = categoryValue(input.category), projectId = projectValue(input.projectId);
    requireScope(actor, category, projectId, projectId === null);
    if (projectId && !await one(db, 'SELECT id FROM projects WHERE id=?', [projectId])) throw new HttpError(404, 'Projeto não encontrado.');
    const count = await one(db, `SELECT COUNT(*) n FROM calendar_feeds WHERE owner_id=? AND revoked_at IS NULL AND expires_at>?`, [actor.userId, new Date().toISOString()]);
    if (Number(count?.n) >= 20) throw new HttpError(409, 'Revogue uma assinatura antiga antes de criar outra.', 'calendar_feed_limit');
    const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const id = crypto.randomUUID(), createdAt = new Date().toISOString(), expiresAt = new Date(Date.parse(createdAt) + 365 * DAY).toISOString();
    await db.prepare(`INSERT INTO calendar_feeds(id,owner_id,token_hash,category,project_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?)`)
      .bind(id, actor.userId, await calendarTokenHash(token), category, projectId, expiresAt, createdAt).run();
    await writeAudit(db, actor, 'calendar.feed.create', id, projectId, { category });
    return { id, category, projectId, expiresAt, feedUrl: `${new URL(origin).origin}/api/calendar/feed/${token}` };
  }
  if (input.action === 'feed.revoke') {
    if (typeof input.id !== 'string' || input.id.length > 200) throw new HttpError(400, 'Assinatura inválida.');
    const feed = await one(db, 'SELECT id,project_id FROM calendar_feeds WHERE id=? AND owner_id=?', [input.id, actor.userId]);
    if (!feed) throw new HttpError(404, 'Assinatura não encontrada.');
    await db.prepare('UPDATE calendar_feeds SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND owner_id=?')
      .bind(new Date().toISOString(), feed.id, actor.userId).run();
    await writeAudit(db, actor, 'calendar.feed.revoke', feed.id, feed.project_id);
    return { id: feed.id, revoked: true };
  }
  throw new HttpError(400, 'Ação de agenda inválida.', 'invalid_calendar_action');
}

/** Feed bearer grants only its stored category/scope; it never grants an application session. */
export async function calendarFeed(db: D1Database, token: string, now = new Date()): Promise<{ entries: CalendarEntry[]; category: CalendarCategory }> {
  const missing = () => new HttpError(404, 'Esta assinatura não está disponível. Gere um novo link no painel.', 'calendar_feed_unavailable');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw missing();
  const feed = await one(db, `SELECT f.owner_id,f.category,f.project_id,f.expires_at,f.revoked_at,u.email,u.status
    FROM calendar_feeds f JOIN portal_users u ON u.user_id=f.owner_id WHERE f.token_hash=?`, [await calendarTokenHash(token)]);
  if (!feed || feed.revoked_at || feed.status !== 'active' || !Number.isFinite(Date.parse(feed.expires_at)) || Date.parse(feed.expires_at) <= now.getTime()) throw missing();
  const category = categoryValue(feed.category);
  // No OWNER_EMAIL bootstrap: membership and canonical account status are re-read for each fetch.
  const actor = await getActor(db, { userId: feed.owner_id, email: feed.email || 'calendar-account@invalid.example', displayName: 'Agenda' });
  try { requireScope(actor, category, feed.project_id, feed.project_id === null); } catch { throw missing(); }
  const from = dayInBrazil(new Date(now.getTime() - 365 * DAY)), to = dayInBrazil(new Date(now.getTime() + 365 * DAY));
  return { ...await calendarEntries(db, actor, { category, projectId: feed.project_id, range: calendarRange(from, to, now) }), category };
}

export function escapeICalText(value: string): string {
  return value.replaceAll('\\', '\\\\').replace(/\r\n|\r|\n/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}
export function foldICalLine(value: string): string {
  let line = '', size = 0; const lines: string[] = [], encoder = new TextEncoder();
  for (const character of value) {
    const length = encoder.encode(character).length;
    if (size + length > 75) { lines.push(line); line = ' '; size = 1; }
    line += character; size += length;
  }
  lines.push(line); return lines.join('\r\n');
}
function icalTime(value: string): string { return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
export function serializeCalendar(entries: CalendarEntry[], label = 'Agenda PROEX'): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PROEX//Gestao institucional//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeICalText(label)}`, 'X-WR-TIMEZONE:America/Sao_Paulo'];
  for (const event of entries) {
    lines.push('BEGIN:VEVENT', `UID:${escapeICalText(event.uid)}`, `DTSTAMP:${icalTime(event.lastModified)}`, `LAST-MODIFIED:${icalTime(event.lastModified)}`, `SEQUENCE:${event.revision}`);
    if (event.allDay) lines.push(`DTSTART;VALUE=DATE:${event.startsAt.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${event.endsAt.replaceAll('-', '')}`);
    else lines.push(`DTSTART:${icalTime(event.startsAt)}`, `DTEND:${icalTime(event.endsAt)}`);
    lines.push(`SUMMARY:${escapeICalText(event.title)}`, `DESCRIPTION:${escapeICalText(`${event.projectName} · ${event.state}`)}`, `CATEGORIES:${escapeICalText(CALENDAR_LABELS[event.category])}`, `STATUS:${event.status}`, `TRANSP:${event.transparent ? 'TRANSPARENT' : 'OPAQUE'}`, 'CLASS:PRIVATE');
    if (event.location) lines.push(`LOCATION:${escapeICalText(event.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldICalLine).join('\r\n') + '\r\n';
}
