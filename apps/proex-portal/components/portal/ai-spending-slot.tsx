'use client';
/** Ponto de troca do painel de gastos: hoje o painel completo; outra tela pode substituí-lo aqui. */
import AiSpendingPanel from './ai-spending-panel';
export default function AiSpendingSlot({ organizationId }: { organizationId: string }) {
  return <AiSpendingPanel organizationId={organizationId}/>;
}
