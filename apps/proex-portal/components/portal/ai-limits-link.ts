/**
 * Atalho "Ajustar limites": a mensagem de limite atingido leva direto a Configurações →
 * Inteligência artificial → Funções e acesso → Limites e cotas. O pedido fica guardado até o
 * painel montar (Configurações pode ainda não estar na tela) e é consumido uma única vez.
 */
export const AI_LIMITS_EVENT = 'proex:ai-limits';
let pending = false;
export function requestAiLimits() { pending = true; window.dispatchEvent(new Event(AI_LIMITS_EVENT)); }
export function hasAiLimitsRequest() { return pending; }
export function takeAiLimitsRequest() { const requested = pending; pending = false; return requested; }
