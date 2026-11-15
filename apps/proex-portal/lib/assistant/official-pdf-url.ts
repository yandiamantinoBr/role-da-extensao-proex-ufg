const origin = 'https://files.cercomp.ufg.br';
export const OFFICIAL_PDF_PATH = '/weby/up/694/o/';

/** Somente arquivos públicos da coleção da PROEX, inclusive citações #page=N. */
export function officialPdfUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.origin !== origin || url.username || url.password || url.search || !url.pathname.startsWith(OFFICIAL_PDF_PATH)) return null;
    const name = decodeURIComponent(url.pathname.slice(OFFICIAL_PDF_PATH.length));
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _.,()+-]{0,230}\.pdf$/iu.test(name)) return null;
    if (url.hash && !/^#page=[1-9]\d{0,2}$/.test(url.hash)) return null;
    return url;
  } catch { return null; }
}

export function officialPdfIn(message: string): URL | null {
  const links = message.match(/https:\/\/[^\s<>"']+/gi) ?? [];
  for (const link of links) {
    const url = officialPdfUrl(link) ?? officialPdfUrl(link.replace(/[),.!?\]]+$/, ''));
    if (url) return url;
  }
  return null;
}

/** Consulta que pede um documento público identificável, sem confundir com operações no Portal. */
export function requestsOfficialPdf(value: string): boolean {
  return /\b(?:pdf|edita(?:l|is)|retificac(?:ao|oes)|aditiv[oa]s?)\b/.test(value);
}
