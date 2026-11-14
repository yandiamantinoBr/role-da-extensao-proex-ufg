function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

/** Searches fields already visible to the caller. Every typed term must match. */
export function listSearch(query: string): (fields: readonly (string | null | undefined)[]) => boolean {
  const terms = fold(query.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length) return () => true;
  return fields => {
    const haystack = fold(fields.join(' '));
    return terms.every(term => haystack.includes(term));
  };
}
