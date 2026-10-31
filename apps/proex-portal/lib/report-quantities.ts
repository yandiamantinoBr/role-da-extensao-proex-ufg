/** Physical quantities can be summed only within a known common unit. */
export function quantityTotal(rows: Record<string, unknown>[], key: string, direction: 'all' | 'in' | 'out' = 'all'): number | null {
  const units = new Set(rows.map(row => String(row.unidade_medida ?? '').trim().toLocaleLowerCase('pt-BR')));
  if (rows.length && (units.size !== 1 || units.has(''))) return null;
  return rows.reduce((total, row) => {
    const value = Number(row[key]); if (!Number.isFinite(value)) return total;
    return total + (direction === 'in' ? Math.max(value, 0) : direction === 'out' ? Math.max(-value, 0) : value);
  }, 0);
}
