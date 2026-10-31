// A periodic connector is expected every 30 minutes. Three missed intervals are
// a diagnostic threshold, never evidence about the trigger's installation.
export const SYNC_STALE_AFTER_MS = 90 * 60 * 1000;
type Run = { status?: unknown; finished_at?: unknown };
export function syncVerificationState(runs: readonly Run[], checkedAt: number): { state: 'recent' | 'stale' | 'unverified'; lastVerifiedAt: string | null } {
  const completed = runs.filter(run => run.status === 'completed' && typeof run.finished_at === 'string')
    .map(run => ({ at: run.finished_at as string, time: Date.parse(run.finished_at as string) }))
    .filter(run => Number.isFinite(run.time)).sort((a, b) => b.time - a.time)[0];
  if (!completed || !Number.isFinite(checkedAt) || completed.time > checkedAt) return { state: 'unverified', lastVerifiedAt: null };
  return { state: checkedAt - completed.time >= SYNC_STALE_AFTER_MS ? 'stale' : 'recent', lastVerifiedAt: completed.at };
}
