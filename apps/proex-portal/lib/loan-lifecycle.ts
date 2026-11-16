/**
 * Reserva com horário vencido e sem retirada (decisão de 2026-11-16): fica com status 'cancelled' e
 * close_reason 'not_collected' e aparece como "Não retirado". O encerramento é feito em
 * lib/access.ts (closeUncollectedLoans), a cada requisição. Este arquivo também é usado pela tela.
 */
export const NOT_COLLECTED = 'not_collected';

/** Situação exibida: a reserva encerrada sem retirada aparece como "Não retirado", não como cancelada. */
export function loanDisplayState(status: unknown, closeReason: unknown): string {
  return closeReason === NOT_COLLECTED ? NOT_COLLECTED : String(status ?? '');
}
