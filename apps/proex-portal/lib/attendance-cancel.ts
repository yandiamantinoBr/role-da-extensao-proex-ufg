import { requireCapability, type PortalActor } from './access';
import { iso, one } from './database';
import { HttpError } from './errors';

/** Cancel an unobserved physical attendance; never invent a losing result or restore a chance. */
export async function cancelAttendance(
  db: D1Database, actor: PortalActor, input: Record<string, unknown>,
): Promise<{ cancelled: true }> {
  const attemptId = typeof input?.attemptId === 'string' ? input.attemptId : '';
  const reason = input?.reason;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(attemptId)
    || (reason !== 'abandoned' && reason !== 'staff_error')) {
    throw new HttpError(400, 'Selecione o atendimento e um motivo válido de cancelamento.', 'invalid_cancellation');
  }
  const attempt = await one(db, `SELECT a.id,a.state,a.result,a.participation_id,
    p.modality,c.project_id,
    EXISTS(SELECT 1 FROM entitlements e WHERE e.attempt_id=a.id) AS has_prize
    FROM attempts a JOIN participations p ON p.id=a.participation_id
    JOIN campaigns c ON c.id=p.campaign_id WHERE a.id=?`, [attemptId]);
  if (!attempt) throw new HttpError(404, 'Atendimento não encontrado.', 'attendance_not_found');
  requireCapability(actor, 'participation.operate', attempt.project_id);
  if (attempt.state === 'cancelled' && attempt.result === 'cancelled' && !attempt.has_prize) {
    return { cancelled: true };
  }
  if (attempt.state !== 'pending' || attempt.modality !== 'physical' || attempt.has_prize) {
    throw new HttpError(409, 'Somente um atendimento presencial pendente pode ser cancelado. Resultados e prêmios já registrados são preservados.', 'attendance_not_pending');
  }

  const now = iso();
  const results = await db.batch([
    db.prepare(`UPDATE attempts SET state='cancelled',result='cancelled'
      WHERE id=? AND state='pending'
        AND NOT EXISTS(SELECT 1 FROM entitlements WHERE attempt_id=attempts.id)
        AND EXISTS(SELECT 1 FROM participations p WHERE p.id=attempts.participation_id
          AND p.modality='physical' AND p.state='physical_pending')
        AND EXISTS(SELECT 1 FROM members auth WHERE auth.user_id=? AND auth.revoked_at IS NULL
          AND auth.role IN ('owner','manager','operator')
          AND (auth.project_id IS NULL OR auth.project_id=?))`)
      .bind(attempt.id, actor.userId, attempt.project_id),
    db.prepare(`UPDATE reservations SET state='released' WHERE attempt_id=? AND state='held'
      AND EXISTS(SELECT 1 FROM attempts WHERE id=? AND state='cancelled' AND result='cancelled')`)
      .bind(attempt.id, attempt.id),
    db.prepare(`INSERT OR IGNORE INTO audit
      (id,actor_id,project_id,action,entity_id,details,created_at)
      SELECT ?,?,?,'participation.cancel',?,?,?
      WHERE EXISTS(SELECT 1 FROM attempts WHERE id=? AND state='cancelled' AND result='cancelled')`)
      .bind(`attendance-cancel:${attempt.id}`, actor.userId, attempt.project_id, attempt.id,
        JSON.stringify({ reason }), now, attempt.id),
  ]);
  if (results[0].meta.changes !== 1) {
    const latest = await one(db, 'SELECT state,result FROM attempts WHERE id=?', [attempt.id]);
    if (latest?.state === 'cancelled' && latest.result === 'cancelled') return { cancelled: true };
    throw new HttpError(409, 'O atendimento ou seu acesso mudou. Atualize antes de continuar.', 'attendance_changed');
  }
  return { cancelled: true };
}
