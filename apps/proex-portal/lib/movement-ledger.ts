/**
 * Movements are append-only. A correction appends a mirror of the superseded movement and its
 * replacement; an undo appends only the mirror. The stock balance sums every row (database
 * trigger). Reports that count quantities by kind, sign, date or destination must count each
 * chain once: the current version only, never a superseded row nor a mirror.
 */
export function effectiveMovementSql(alias: string): string {
  return `NOT EXISTS(SELECT 1 FROM stock_movement_revisions superseded_${alias} WHERE superseded_${alias}.target_movement_id=${alias}.id OR superseded_${alias}.reversal_movement_id=${alias}.id)`;
}
