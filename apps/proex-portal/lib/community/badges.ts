import type { PortalActor } from '../access';
import { isCivilDate } from '../civil-date';
import { all, one, iso } from '../database';
import { HttpError } from '../errors';
import { only, requireActor, requireInternalMember } from './shared';

/*
 * Badges (selos) reward healthy, varied use — never volume:
 * - at most one of each kind per week; a kind is either earned that week or not;
 * - only actions on weekdays between 07:00 and 19:59 (Brasília) count, so overtime is never rewarded;
 * - no ranking and no comparison: only the person sees their own badges;
 * - the person can turn badges off or pause them (exam week, leave), and nothing is computed meanwhile.
 * The art is PROVISIONAL until the communication team delivers it.
 */
export const BADGES = {
  closer: { label: 'Fechou o que abriu', hint: 'Concluiu uma demanda atribuída a você nesta semana.' },
  helpful: { label: 'Retorno que ajudou', hint: 'Uma sugestão ou problema que você enviou foi resolvido.' },
  thanks: { label: 'Reconheceu alguém', hint: 'Enviou um elogio para a equipe de um projeto ou evento.' },
  field: { label: 'Mão na massa', hint: 'Registrou uma entrega ou movimentação de material.' },
} as const;
export type Badge = keyof typeof BADGES;
export const BADGES_PER_LEVEL = 3, MAX_LEVEL = 10;

/** Monday 00:00 in Brasília (UTC-03:00, no daylight saving) as UTC instants, and the week id (Monday's civil date). */
export function brasiliaWeek(now = Date.now()) {
  const local = new Date(now - 3 * 3600000), day = (local.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day));
  const start = new Date(monday.getTime() + 3 * 3600000), end = new Date(start.getTime() + 7 * 86400000);
  return { week: monday.toISOString().slice(0, 10), start: start.toISOString(), end: end.toISOString(), today: local.toISOString().slice(0, 10) };
}
/** Weekday working hours in Brasília for an ISO instant column. */
const workingHours = (column: string) => `(CAST(strftime('%H',${column},'-3 hours') AS INTEGER) BETWEEN 7 AND 19 AND CAST(strftime('%w',${column},'-3 hours') AS INTEGER) BETWEEN 1 AND 5)`;
function earnedSql(): Record<Badge, string> {
  return {
    closer: `EXISTS(SELECT 1 FROM followup_tasks t JOIN followup_assignees a ON a.task_id=t.id AND a.user_id=? AND a.removed_at IS NULL
      WHERE t.status='completed' AND t.updated_at>=? AND t.updated_at<? AND ${workingHours('t.updated_at')})`,
    helpful: `EXISTS(SELECT 1 FROM portal_feedback WHERE author_id=? AND status='resolved' AND kind IN ('problem','suggestion') AND updated_at>=? AND updated_at<?)`,
    thanks: `EXISTS(SELECT 1 FROM portal_feedback WHERE author_id=? AND kind='praise' AND created_at>=? AND created_at<? AND ${workingHours('created_at')})`,
    field: `EXISTS(SELECT 1 FROM stock_movements WHERE actor_id=? AND created_at>=? AND created_at<? AND ${workingHours('created_at')})`,
  };
}
async function preferences(db: D1Database, userId: string) {
  const row = await one(db, 'SELECT badges,paused_until,seen_level,version FROM community_preferences WHERE user_id=?', [userId]);
  return { enabled: row ? !!row.badges : true, pausedUntil: (row?.paused_until as string | null) ?? null, seenLevel: Number(row?.seen_level ?? 1), version: Number(row?.version ?? 0) };
}
const levelOf = (total: number) => Math.min(MAX_LEVEL, 1 + Math.floor(total / BADGES_PER_LEVEL));

export async function badgeState(db: D1Database, rawActor: PortalActor | null, now = Date.now()) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const prefs = await preferences(db, actor.userId), period = brasiliaWeek(now);
  const paused = !!prefs.pausedUntil && prefs.pausedUntil >= period.today;
  if (!prefs.enabled) return { enabled: false, paused: false, pausedUntil: prefs.pausedUntil, version: prefs.version };
  if (!paused) {
    // After a pause ends mid-week, only actions from the day after the pause count.
    const resumeAt = prefs.pausedUntil ? new Date(Date.parse(`${prefs.pausedUntil}T03:00:00.000Z`) + 86400000).toISOString() : null;
    const from = resumeAt && resumeAt > period.start ? resumeAt : period.start;
    // Record only what was newly earned this week; a repeated read writes nothing.
    const already = new Set((await all(db, 'SELECT badge FROM community_badges WHERE user_id=? AND week=?', [actor.userId, period.week])).map(row => String(row.badge)));
    const missing = (Object.keys(BADGES) as Badge[]).filter(badge => !already.has(badge));
    if (missing.length) {
      const checks = earnedSql(), earned: Badge[] = [];
      for (const badge of missing) if (await one(db, `SELECT 1 ok WHERE ${checks[badge]}`, [actor.userId, from, period.end])) earned.push(badge);
      if (earned.length) await db.batch(earned.map(badge => db.prepare('INSERT OR IGNORE INTO community_badges(user_id,badge,week,earned_at) VALUES(?,?,?,?)').bind(actor.userId, badge, period.week, iso())));
    }
  }
  const history = await all(db, 'SELECT badge,COUNT(*) n FROM community_badges WHERE user_id=? GROUP BY badge', [actor.userId]);
  const thisWeek = new Set((await all(db, 'SELECT badge FROM community_badges WHERE user_id=? AND week=?', [actor.userId, period.week])).map(row => String(row.badge)));
  const total = history.reduce((sum, row) => sum + Number(row.n), 0), level = levelOf(total);
  return {
    enabled: true, paused, pausedUntil: prefs.pausedUntil, version: prefs.version, week: period.week,
    level, seenLevel: prefs.seenLevel, total, nextLevelAt: level >= MAX_LEVEL ? null : level * BADGES_PER_LEVEL,
    badges: (Object.keys(BADGES) as Badge[]).map(badge => ({ id: badge, ...BADGES[badge], thisWeek: thisWeek.has(badge), times: Number(history.find(row => row.badge === badge)?.n ?? 0) })),
  };
}

export async function badgeAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor);
  await requireInternalMember(db, actor);
  const now = iso(), prefs = await preferences(db, actor.userId);
  if (input.action === 'preferences') {
    only(input, ['action', 'enabled', 'pausedUntil', 'expectedVersion']);
    if (typeof input.enabled !== 'boolean') throw new HttpError(400, 'Escolha se os selos ficam ligados.', 'invalid_badge_setting');
    const paused = input.pausedUntil === null || input.pausedUntil === undefined || input.pausedUntil === '' ? null : input.pausedUntil;
    if (paused !== null && (!isCivilDate(paused) || paused < brasiliaWeek().today || paused > new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10))) throw new HttpError(400, 'Escolha uma data de retorno nos próximos 120 dias.', 'invalid_badge_pause');
    if (input.expectedVersion !== prefs.version) throw new HttpError(409, 'Suas preferências mudaram em outra janela. Atualize a página.', 'badge_preferences_changed');
    const result = prefs.version === 0
      ? await db.prepare('INSERT INTO community_preferences(user_id,badges,paused_until,seen_level,version,updated_at) VALUES(?,?,?,1,1,?) ON CONFLICT(user_id) DO NOTHING').bind(actor.userId, input.enabled ? 1 : 0, paused, now).run()
      : await db.prepare('UPDATE community_preferences SET badges=?,paused_until=?,version=version+1,updated_at=? WHERE user_id=? AND version=?').bind(input.enabled ? 1 : 0, paused, now, actor.userId, prefs.version).run();
    if (result.meta.changes !== 1) throw new HttpError(409, 'Suas preferências mudaram em outra janela. Atualize a página.', 'badge_preferences_changed');
    return { enabled: input.enabled, pausedUntil: paused };
  }
  if (input.action === 'seen') {
    only(input, ['action', 'level']);
    if (!Number.isSafeInteger(input.level) || (input.level as number) < 1 || (input.level as number) > MAX_LEVEL) throw new HttpError(400, 'Nível inválido.', 'invalid_level');
    await db.prepare('INSERT INTO community_preferences(user_id,badges,seen_level,version,updated_at) VALUES(?,1,?,1,?) ON CONFLICT(user_id) DO UPDATE SET seen_level=MAX(seen_level,excluded.seen_level),updated_at=excluded.updated_at').bind(actor.userId, input.level, now).run();
    return { seenLevel: input.level };
  }
  throw new HttpError(400, 'Operação de selos inválida.', 'invalid_action');
}
