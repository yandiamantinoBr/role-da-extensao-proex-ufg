/** Formatos dos limites diários, iguais no servidor (mensagens, histórico) e na tela. */
export const formatUsd = (micros: number) => (micros / 1_000_000).toLocaleString('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: micros > 0 && micros < 10_000 ? 4 : 2 });
export const formatThousands = (value: number) => {
  if (value >= 1_000_000) { const millions = Math.round(value / 100_000) / 10; return `${millions.toLocaleString('pt-BR')} ${millions >= 2 ? 'milhões' : 'milhão'}`; }
  return value >= 1000 ? `${Math.round(value / 1000).toLocaleString('pt-BR')} mil` : value.toLocaleString('pt-BR');
};
/** Duração legível: 12 s, 5 min, 1 h, 1,5 h. */
export const formatDuration = (ms: number) => ms < 120_000 ? `${Math.round(ms / 1000).toLocaleString('pt-BR')} s` : ms < 7_200_000 && ms % 3_600_000 ? `${Math.round(ms / 60_000).toLocaleString('pt-BR')} min` : `${(Math.round(ms / 360_000) / 10).toLocaleString('pt-BR')} h`;
