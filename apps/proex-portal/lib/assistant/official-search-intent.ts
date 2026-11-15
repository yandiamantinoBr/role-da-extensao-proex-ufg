/** Encaminha perguntas que pedem explicitamente uma consulta ao site público. */
export function isOfficialSearch(message: string): boolean {
  const value = message.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const site = /\b(?:(?:site|portal)\s+oficial\b|(?:site|portal)\s+(?:da|do)\s+(?:proe[xc]|23[º°o]?\s*conpeex|conpeex)\b|(?:proex\.ufg\.br|23conpeex\.plateia\.ufg\.br)(?![\w.-]))/;
  const lookup = /\b(?:pesquise|pesquisar|busque|buscar|procure|procurar|consulte|consultar|ache|encontre|encontrar|verifique|confira|acesse|veja|qual|quais|onde|quando|quanto|quantos|quantas|saber|tem|esta)\b/;
  return site.test(value) && (lookup.test(value) || value.includes('?') || /^(?:site|portal|https:\/\/)/.test(value));
}
