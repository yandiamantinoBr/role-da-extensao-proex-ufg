/**
 * Por que um equipamento não pode ser reservado (ou está ocupado agora), para o seletor e o cartão do empréstimo.
 * O servidor continua conferindo tudo na gravação (lib/materials.ts e os gatilhos de loans); isto só explica na tela.
 * Mesma regra do servidor: só reserva um equipamento ativo com exatamente uma unidade de entrada no estoque.
 */
export type EquipmentLike = { name?: unknown; condition?: unknown; stock?: unknown; on_loan?: unknown; onLoan?: unknown; reserved_now?: unknown; reservedNow?: unknown };
export type EquipmentStatus = { reservable: boolean; reason: string };

export function equipmentStatus(item: EquipmentLike): EquipmentStatus {
  const condition = String(item.condition ?? 'active');
  if (condition === 'inactive') return { reservable: false, reason: 'inativo' };
  if (condition === 'maintenance') return { reservable: false, reason: 'manutenção' };
  if (condition !== 'active') return { reservable: false, reason: 'indisponível' };
  if (item.stock !== undefined && item.stock !== null && Number(item.stock) !== 1) return { reservable: false, reason: 'sem estoque' };
  // Ocupado agora não impede reservar outro horário; o servidor confere o choque de horários.
  if (truthy(item.on_loan ?? item.onLoan)) return { reservable: true, reason: 'em uso agora' };
  if (truthy(item.reserved_now ?? item.reservedNow)) return { reservable: true, reason: 'reservado agora' };
  return { reservable: true, reason: '' };
}
export function equipmentOptionLabel(item: EquipmentLike): string {
  const name = String(item.name ?? 'Equipamento'), { reason } = equipmentStatus(item);
  return reason ? `${name} · ${reason}` : name;
}
/** Mensagem do servidor quando a reserva ou a retirada esbarra no estado do equipamento. */
export function equipmentBlockMessage(item: EquipmentLike, action: 'reserve' | 'checkout'): string | null {
  const { reservable, reason } = equipmentStatus(item);
  if (reservable) return null;
  const what = action === 'checkout' ? 'A retirada fica bloqueada' : 'Não é possível reservar';
  return `${what}: ${equipmentBlockCause(item)}. ${BLOCK_FIX[reason] ?? ''}`.trim();
}
const BLOCK_FIX: Record<string, string> = {
  'manutenção': 'Registre a volta dele ao uso na ficha do material.',
  'inativo': 'Reative-o na ficha do material, se ele voltou a ser usado.',
  'sem estoque': 'Registre o recebimento na ficha do material.',
};
/** "o equipamento está em manutenção" etc.; vazio quando nada bloqueia. */
export function equipmentBlockCause(item: EquipmentLike): string {
  const { reservable, reason } = equipmentStatus(item);
  if (reservable) return '';
  if (reason === 'manutenção') return 'o equipamento está em manutenção';
  if (reason === 'inativo') return 'o equipamento está inativo';
  if (reason === 'sem estoque') return 'o equipamento não tem a unidade registrada no estoque';
  return 'o equipamento está indisponível';
}
function truthy(value: unknown): boolean { return value === true || value === 1 || value === '1'; }
