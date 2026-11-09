'use client';
/** Ponto de troca do painel de gastos (o painel completo entra nesta mesma rodada). */
export default function AiSpendingSlot({ organizationId }: { organizationId: string }) {
  return <p role="status" data-organization={organizationId}>O painel de gastos está sendo preparado.</p>;
}
