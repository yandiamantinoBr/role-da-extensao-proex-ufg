export const TRIAGE_INPUT_LIMIT = 4096;
export const TRIAGE_CONTEXT_LIMIT = 600;
export const TRIAGE_CRITERIA = {
 urgency: {
  high: 'O prazo imediato ou o risco de atraso exige ação rápida.',
  medium: 'Existe prazo ou dependência próxima e há tempo para planejar.',
  low: 'A atividade pode esperar sem consequência imediata.',
 },
 importance: {
  high: 'O impacto sobre um compromisso, a segurança ou a operação é significativo.',
  medium: 'A atividade contribui para uma entrega ou rotina, com impacto limitado.',
  low: 'A atividade é complementar e tem impacto pequeno.',
 },
} as const;
export type TriageLevel = keyof typeof TRIAGE_CRITERIA.urgency;
export type TriageProposal = { urgency:TriageLevel; importance:TriageLevel };
export type TriageResponse =
 | { status:'ready'; proposalId:string; proposal:TriageProposal }
 | { status:'abstained' };
export const TRIAGE_CURRENCY = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'USD',minimumFractionDigits:6,maximumFractionDigits:6});
