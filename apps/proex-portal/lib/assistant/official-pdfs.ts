import { officialPdfUrl } from './official-pdf-url';
import { readOfficialPdfText, type PdfTextPage } from './official-pdf-text';

export type OfficialDocument = { url: string; title: string };
export type OfficialPassage = OfficialDocument & { page: number; text: string };
/** Por que um PDF encontrado não virou trecho: escaneado (sem texto), sem trecho que responda ou não abriu. */
export type OfficialReadFailure = 'sem_texto' | 'sem_trecho' | 'bloqueado' | 'indisponivel';
export type OfficialUnread = OfficialDocument & { reason: OfficialReadFailure };
const PDF_BYTES = 2_000_000;
/** Abaixo disso, o texto do PDF é só carimbo de assinatura ou numeração: o conteúdo é imagem. */
const MIN_PDF_TEXT = 200;
const FETCH_TIMEOUT_MS = 4_000;
const robotsUrl = new URL('/robots.txt', 'https://files.cercomp.ufg.br').href;

async function pdfRobots(fetcher: typeof fetch, userAgent: string): Promise<string | null> {
  const response = await fetcher(robotsUrl, { headers: { 'User-Agent': userAgent, Accept: 'text/plain' }, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const robotsUnavailable = [401, 403, 404, 410].includes(response.status);
  if (!response.ok || !/^text\/plain\b/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    return robotsUnavailable ? '' : null;
  }
  const bytes = await readBounded(response, 128_000);
  return new TextDecoder().decode(bytes);
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Fonte pública sem conteúdo.');
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Fonte pública acima do limite de tamanho.');
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

function passageFor(document: OfficialDocument, pages: PdfTextPage[], subject: string, terms: (text: string) => string[]): OfficialPassage | null {
  const question = subject.match(/\b(?:quais|qual|quantas|quantos|quando|quanto|onde|como|o que)\b[^?]*/i)?.[0] ?? subject;
  // Programa e ano já escolheram o documento; dentro dele, não pesam (a abertura repete os dois).
  const wanted = terms(question).filter(word => !['edital', 'pdf', 'pagina', 'cite', 'link', 'final', 'quantas', 'quantos', 'leia', 'diga', 'probec', 'conpeex'].includes(word) && !/^20\d{2}$/.test(word));
  const anchor = officialPdfUrl(document.url);
  if (!anchor) return null;
  const requestedPage = Number(anchor.hash.slice(6)) || 0;
  const candidates = pages.flatMap(({ number, text }) => {
    if (requestedPage && number !== requestedPage) return [];
    const normalized = text.replace(/[\u0000-\u001f\u007f\u00ad]+/g, ' ').replace(/\s+/g, ' ').trim();
    const corrected = normalized.match(/\bLeia[- ]se\s*:\s*(.+)/i)?.[1];
    const paragraphs = (corrected ?? normalized).split(/(?=(?<![\d.])\b\d{1,2}\.\d{1,2}(?:\.\d{1,2}){0,2}\.?\s+\p{L})|(?<=\.)\s+(?=\p{Lu})/u);
    return paragraphs.flatMap((text, position) => {
      const cleaned = text.trim();
      if (cleaned.length < 25) return [];
      const clipped = cleaned.length > 700 ? cleaned.slice(0, 700).replace(/\s+\S*$/, '') + '…' : cleaned;
      const words = new Set(terms(clipped));
      const hits = wanted.filter(word => words.has(word)).length;
      const quantityCue = /\b(?:quantas|quantos|quanto)\b/i.test(question)
        && /\b(?:ofertad[ao]s?|distribu[ií]d[ao]s?|totalizam?|corresponder[aá])\b/i.test(clipped);
      const score = hits ? hits * 3 + Number(quantityCue) : 0;
      return [{ number, position, score, text: clipped }];
    });
  });
  const best = candidates.sort((a, b) => b.score - a.score || a.number - b.number || a.position - b.position)[0];
  if (!best || (!requestedPage && !best.score && /\b(?:quais|qual|quantas|quantos|quando|quanto|onde|como|o que)\b/i.test(question))) return null;
  anchor.hash = `page=${best.number}`;
  return { title: document.title, url: anchor.href, page: best.number, text: best.text };
}

export async function searchOfficialPdfs(
  documents: OfficialDocument[], subject: string, fetcher: typeof fetch, userAgent: string,
  terms: (text: string) => string[], disallowed: (robots: string, path: string) => boolean,
): Promise<{ passages: OfficialPassage[]; unreadable: OfficialUnread[] }> {
  const passages: OfficialPassage[] = [], unreadable: OfficialUnread[] = [];
  if (!documents.length) return { passages, unreadable };
  let robots: string | null = null;
  try { robots = await pdfRobots(fetcher, userAgent); } catch { /* respeita indisponibilidade temporária */ }
  if (robots === null) return { passages, unreadable: documents.map(document => ({ ...document, reason: 'indisponivel' as const })) };
  await Promise.all(documents.map(async document => {
    const url = officialPdfUrl(document.url);
    if (!url) return;
    let reason: OfficialReadFailure = 'indisponivel';
    try {
      if (disallowed(robots, url.pathname)) { reason = 'bloqueado'; throw new Error('Documento não liberado para consulta automática.'); }
      url.hash = '';
      const response = await fetcher(url.href, {
        headers: { 'User-Agent': userAgent, Accept: 'application/pdf' },
        redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok || !/^application\/pdf\b/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length')) > PDF_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Documento público indisponível.');
      }
      const bytes = await readBounded(response, PDF_BYTES);
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Assinatura de PDF ausente.');
      // Sem OCR: um PDF que abre com zero páginas de texto é tratado como imagem escaneada.
      const pages = await readOfficialPdfText(bytes);
      const textSize = pages.reduce((size, page) => size + page.text.replace(/\s+/g, ' ').trim().length, 0);
      if (textSize < MIN_PDF_TEXT) { reason = 'sem_texto'; throw new Error('PDF sem texto.'); }
      const passage = passageFor(document, pages, subject, terms);
      if (!passage) { reason = 'sem_trecho'; throw new Error('Sem texto relevante.'); }
      passages.push(passage);
    } catch { unreadable.push({ ...document, reason }); }
  }));
  const documentIndex = (url: string) => documents.findIndex(document => document.url.split('#')[0] === url.split('#')[0]);
  passages.sort((a, b) => documentIndex(a.url) - documentIndex(b.url));
  unreadable.sort((a, b) => documentIndex(a.url) - documentIndex(b.url));
  return { passages, unreadable };
}
