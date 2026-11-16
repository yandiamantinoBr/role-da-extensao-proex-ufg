import { aiConfigurationAuthority, platformOwnerAuthoritySql, type PortalActor } from '../access';
import { one } from '../database';
import { HttpError } from '../errors';
import { OFFICIAL_HOSTS, officialPageIn, officialPdfIn, officialPdfUrl, requestsOfficialPdf } from './official-pdf-url';
import { searchOfficialPdfs, type OfficialDocument, type OfficialPassage } from './official-pdfs';

/*
 * Fontes oficiais do Rolê, sem chamada paga:
 * - páginas públicas da PROEX e do 23º CONPEEX, numa lista fechada, copiadas no máximo uma vez a cada
 *   20 h (respeitando robots.txt). Guarda só título, um resumo curto e os links da página;
 * - publicações do Instagram coladas pela comunicação (link, data e legenda curta). Não há raspagem:
 *   o oEmbed da Meta exige token de aplicativo, e a API oficial depende de autorização da conta.
 * Tudo é dado público, guardado na tabela settings (sem migração).
 */

export const OFFICIAL_SOURCES = [
  { id: 'proex-inicio', label: 'PROEX · início', url: 'https://proex.ufg.br/' },
  { id: 'proex-noticias', label: 'PROEX · notícias', url: 'https://proex.ufg.br/news?direction=desc&sort=journal_news.created_at&tags=Noticias' },
  { id: 'proex-editais', label: 'PROEX · editais', url: 'https://proex.ufg.br/p/editais-proex' },
  { id: 'proex-editais-externos', label: 'PROEX · editais externos', url: 'https://proex.ufg.br/p/29463-editais-externos' },
  { id: 'proex-equipe', label: 'PROEX · equipe e contatos', url: 'https://proex.ufg.br/p/equipe-proex' },
  { id: 'proex-o-que-e', label: 'PROEX · o que é', url: 'https://proex.ufg.br/p/29427-o-que-e-a-proex' },
  { id: 'proex-role', label: 'PROEX · Rolê da Extensão', url: 'https://proex.ufg.br/p/60194-role-da-extensao' },
  { id: 'conpeex-programacao', label: 'CONPEEX · programação geral', url: 'https://23conpeex.plateia.ufg.br/p/59955-programacao-geral' },
  { id: 'conpeex-site', label: '23º CONPEEX', url: 'https://23conpeex.plateia.ufg.br/' },
] as const;
export { OFFICIAL_HOSTS };
const SNAPSHOT = 'role.official.v1', REFRESH_MS = 20 * 3600_000, PAGE_BYTES = 600_000;
const USER_AGENT = 'PortalPROEX-Role/1.0 (+https://proex-gestao.vercel.app; consulta de paginas publicas)';
const SEARCH_TIMEOUT_MS = 2500;
const SEARCH_INDEX_TTL_MS = 30 * 60_000;
const SEARCH_RETRY_MS = 60_000;
const SEARCH_PAGE_LIMIT = 5;

export type OfficialPage = { id: string; label: string; url: string; fetchedAt: string | null; title: string; summary: string; links: { text: string; url: string }[]; error?: string };
export type OfficialSnapshot = { refreshedAt: string | null; startedAt?: string | null; pages: OfficialPage[] };

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', ordm: 'º', ordf: 'ª' };
const decode = (value: string) => value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (match, code: string) => {
  if (code[0] !== '#') return entities[code.toLowerCase()] ?? match;
  const hex = code[1].toLowerCase() === 'x';
  const point = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
  return point <= 0x10ffff && (point < 0xd800 || point > 0xdfff) ? String.fromCodePoint(point) : match;
});
const clean = (value: string, max: number) => decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max);
const withoutActiveContent = (html: string) => html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ');
const descriptionOf = (body: string) => clean(body.match(/<meta\s+property=["']og:description["']\s+content=(["'])([\s\S]*?)\1/i)?.[2] ?? '', 600);

/** Limita a descoberta de PDFs aos links do corpo editorial da página. */
function pdfLinks(html: string, base: string): OfficialDocument[] {
  const body = withoutActiveContent(html);
  const article = body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';
  const documents = new Map<string, OfficialDocument>();
  for (const match of article.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let raw: URL;
    try { raw = new URL(decode(match[1]), base); } catch { continue; }
    const url = officialPdfUrl(raw.href);
    const title = clean(match[2], 150);
    if (!url || !title) continue;
    url.hash = '';
    if (!documents.has(url.href)) documents.set(url.href, { url: url.href, title });
    if (documents.size === 60) break;
  }
  return [...documents.values()];
}

/** Extrai título, resumo curto (descrição ou primeiros parágrafos) e links de notícias/páginas do mesmo site. */
export function extractPage(html: string, base: string): { title: string; summary: string; links: { text: string; url: string }[] } {
  const body = withoutActiveContent(html);
  const article = body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const title = clean(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '', 160);
  const description = body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? '';
  const paragraphs = [...(article ?? body).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match => clean(match[1], 400)).filter(text => text.length > 40).slice(0, 3).join(' ');
  const summary = descriptionOf(body) || (article && paragraphs.slice(0, 600)) || clean(description, 600) || paragraphs.slice(0, 600);
  const host = new URL(base).host, links: { text: string; url: string }[] = [], seen = new Set<string>();
  for (const match of body.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL; try { url = new URL(decode(match[1]), base); } catch { continue; }
    const text = clean(match[2], 140);
    if (url.protocol !== 'https:' || url.host !== host || !/^\/(n|p)\//.test(url.pathname) || text.length < 12 || seen.has(url.href)) continue;
    seen.add(url.href); links.push({ text, url: url.href });
    if (links.length >= 15) break;
  }
  return { title, summary, links };
}

function disallowed(robots: string, path: string): boolean {
  let applies = false; const rules: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const [key, ...rest] = line.split(':'); const value = rest.join(':').trim();
    if (/^user-agent$/i.test(key)) applies = value === '*';
    else if (applies && /^disallow$/i.test(key) && value) rules.push(value);
  }
  return rules.some(rule => path.startsWith(rule));
}
async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > PAGE_BYTES) break; chunks.push(value); } } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8').decode(bytes);
}

type SearchEntry = { url: string; title: string; lastModified: string };
type PublicIndex = SearchEntry[];
type PublicResult = SearchEntry & { summary: string; fetchedAt: string; documents: OfficialDocument[] };
/** Dois documentos parecidos (mesmo programa e tipo, edições diferentes) sem pedido que desempate. */
export type OfficialAmbiguity = { used: OfficialDocument; other: OfficialDocument };
type PublicLookup = { status: 'ok' | 'partial' | 'unavailable'; pages: PublicResult[]; passages: OfficialPassage[]; unreadable: OfficialDocument[]; ambiguity: OfficialAmbiguity | null };
const emptyLookup = { pages: [], passages: [], unreadable: [], ambiguity: null };
type SearchIndexCache = Map<string, { refreshAt: number; value: Promise<PublicIndex | null> }>;
const searchIndexes = new WeakMap<typeof fetch, SearchIndexCache>();
const searchWords = (value: string) => (value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
const searchFiller = new Set(['de', 'da', 'do', 'das', 'dos', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas', 'para', 'com', 'por', 'um', 'uma', 'que', 'esta', 'tem', 'foi', 'proex', 'proec', 'ufg', 'site', 'portal', 'oficial', 'favor', 'acesse', 'busque', 'consulte', 'procure', 'pesquise', 'veja', 'encontre', 'onde', 'quando', 'qual', 'quais', 'como', 'sobre', 'diga', 'mostre', 'me', 'quero', 'pode', 'informacao', 'informacoes']);
const singular = (word: string) => word.length > 4 ? word.replace(/oes$/, 'ao').replace(/s$/, '') : word;
export const officialSearchTerms = (value: string) => [...new Set(searchWords(value).filter(word => !searchFiller.has(word)).map(singular))];

function searchEntry(urlText: string, host: string, lastModified: string): SearchEntry | null {
  let url: URL;
  try { url = new URL(decode(urlText.trim())); } catch { return null; }
  if (url.origin !== `https://${host}` || url.username || url.password || url.search || url.hash || !/^\/(?:n|p)\/[a-z0-9][a-z0-9-]{1,240}\/?$/i.test(url.pathname)) return null;
  const title = url.pathname.slice(3).replace(/^\d+-|\/$/g, '').replace(/-/g, ' ');
  return { url: url.href, title, lastModified: /^\d{4}-\d{2}-\d{2}$/.test(lastModified) ? lastModified : '' };
}

async function fetchPublicText(url: string, accept: string, contentType: RegExp, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!response.ok || !contentType.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Fonte pública indisponível.');
  }
  return boundedText(response);
}

async function readSearchIndex(host: string, fetcher: typeof fetch): Promise<PublicIndex | null> {
  if (!searchIndexes.has(fetcher)) searchIndexes.set(fetcher, new Map());
  const indexes = searchIndexes.get(fetcher)!;
  const saved = indexes.get(host), now = Date.now();
  if (saved && saved.refreshAt > now) return saved.value;

  const value = (async () => {
    const origin = `https://${host}`;
    const robots = await fetchPublicText(`${origin}/robots.txt`, 'text/plain', /^text\/plain\b/i, fetcher);
    if (disallowed(robots, '/sitemap.xml')) return null;
    const xml = await fetchPublicText(`${origin}/sitemap.xml`, 'application/xml, text/xml', /^(?:application|text)\/xml\b/i, fetcher);
    if (!/<urlset\b/i.test(xml)) return null;
    const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].flatMap(([, block]) => {
      const url = block.match(/<loc>([^<]+)<\/loc>/i)?.[1];
      const modified = block.match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1]?.trim() ?? '';
      const entry = url && searchEntry(url, host, modified);
      return entry && !disallowed(robots, new URL(entry.url).pathname) ? [entry] : [];
    });
    return entries;
  })().catch(() => null);
  const current = { value, refreshAt: now + SEARCH_INDEX_TTL_MS };
  indexes.set(host, current);
  if (!await value) current.refreshAt = now + SEARCH_RETRY_MS;
  return value;
}

function editalNumber(value: string): string | null {
  const match = value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .match(/\bedital(?:\s+(?:proex|proec|final|preliminar))*\s*(?:n[º°o.]?\s*)?(\d{1,3})[\s/-]+(20\d{2})\b/i);
  return match ? `${Number(match[1])}/${match[2]}` : null;
}

function documentPriority(title: string, wanted: string[], updated: boolean, preliminary: boolean) {
  const words = new Set(searchWords(title));
  const heading = [...words].join(' ');
  const draft = /\bpreliminar\b/.test(heading);
  const amendment = /\b(?:aditivo|retificacao|prorrogacao)\b/.test(heading);
  const edition = /^edital\b/.test(heading) && !/\bresultado\b/.test(heading);
  const related = /\b(?:avaliadores|homologacao|resultado)\b/.test(heading)
    && !wanted.some(word => ['avaliadore', 'homologacao', 'resultado'].includes(word));
  const main = edition ? draft ? (preliminary ? 20 : -15) : words.has('final') ? 20 : 13 : 0;
  return wanted.filter(word => words.has(word)).length * 2
    + (updated ? amendment ? 22 : -5 : amendment ? -10 : 0) + main - (related ? 30 : 0);
}

type Edition = { start: number | null; end: number | null; numbers: { n: number; year: number | null }[] };
const plain = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[_+]/g, ' ');

/** Ano ou ciclo (2026/27, 2026-2027, 2026) e número (nº 133/2026, Edital 133) de títulos e nomes de arquivo. */
function editionOf(...texts: string[]): Edition {
  const edition: Edition = { start: null, end: null, numbers: [] };
  for (const raw of texts) {
    const value = plain(raw);
    for (const match of value.matchAll(/\bedital(?:\s+(?:proex|proec|final|preliminar|probec|conpeex))*\s*(?:n\s*[º°o.]?\s*)?(\d{1,3})\b(?:\s*[/\s-]\s*(20\d{2})\b)?|\bn\s*[º°.]\s*(\d{1,3})\s*\/\s*(20\d{2})\b/g)) {
      const n = Number(match[1] ?? match[3]), year = Number(match[2] ?? match[4]) || null;
      if (!edition.numbers.some(item => item.n === n && item.year === year)) edition.numbers.push({ n, year });
    }
    if (edition.start) continue;
    const cycle = [...value.matchAll(/\b(20\d{2})\s*[/\s-]\s*(?:20)?(\d{2})\b/g)].find(match => (Number(match[1]) + 1) % 100 === Number(match[2]));
    const year = cycle?.[1] ?? value.match(/\b(20\d{2})\b/)?.[1];
    if (year) { edition.start = Number(year); edition.end = cycle ? edition.start + 1 : null; }
  }
  return edition;
}

const documentKind = (title: string) => {
  const heading = searchWords(title).join(' ');
  return /\b(?:aditivo|retificacao|prorrogacao|errata)\b/.test(heading) ? 'alteracao' : /^edital\b/.test(heading) && !/\bresultado\b/.test(heading) ? 'edital' : 'outro';
};
const programOf = (value: string) => searchWords(value).find(word => word === 'probec' || word === 'conpeex') ?? '';

/** Ordena os PDFs das páginas pela pergunta: edição pedida, versão final/preliminar, aditivo e edição mais recente. */
function chooseDocument(results: PublicResult[], subject: string) {
  const question = subject.replace(/https:\/\/\S+/gi, ' ');
  const wanted = officialSearchTerms(question), normalized = searchWords(question).join(' ');
  const amended = /\b(?:retificac(?:ao|oes)|aditiv[oa]s?|prorrogac(?:ao|oes)|recurso)\b/.test(normalized);
  const preliminary = /\bpreliminar\b/.test(normalized);
  const asked = editionOf(question);
  const askedYears = [...new Set([asked.start, ...searchWords(question).filter(word => /^20\d{2}$/.test(word)).map(Number)].filter((year): year is number => !!year))];
  const askedNumbers = asked.numbers;
  const byUrl = new Map<string, { pdf: OfficialDocument; priority: number; score: number; edition: Edition; kind: string; program: string }>();
  results.forEach((page, index) => {
    const pageEdition = editionOf(page.title, new URL(page.url).pathname.replace(/[/-]/g, ' '));
    for (const pdf of page.documents) {
      const own = editionOf(pdf.title, decodeURIComponent(new URL(pdf.url).pathname.split('/').at(-1) ?? ''));
      const edition = { start: own.start ?? pageEdition.start, end: own.start ? own.end : pageEdition.end, numbers: [...own.numbers, ...pageEdition.numbers] };
      const priority = documentPriority(pdf.title, wanted, amended, preliminary);
      const choice = { pdf, priority, score: priority + (3 - index) * 5, edition, kind: documentKind(pdf.title), program: programOf(`${pdf.title} ${page.title}`) };
      const saved = byUrl.get(pdf.url);
      if (!saved || saved.score < choice.score) byUrl.set(pdf.url, choice);
    }
  });
  let choices = [...byUrl.values()];
  if (askedNumbers.length) {
    choices = choices.filter(({ edition }) => !edition.numbers.length || askedNumbers.some(item => edition.numbers.some(found => found.n === item.n && (!item.year || !found.year || found.year === item.year))));
  }
  if (askedYears.length) {
    const byStart = choices.filter(({ edition }) => edition.start !== null && askedYears.includes(edition.start));
    choices = byStart.length ? byStart : choices.filter(({ edition }) => edition.end !== null && askedYears.includes(edition.end));
  }
  const decided = askedYears.length > 0 || askedNumbers.length > 0;
  const newest = Math.max(0, ...choices.map(({ edition }) => edition.start ?? 0));
  for (const choice of choices) {
    if (!decided && choice.edition.start) choice.score += (choice.edition.start - newest) * 25;
    if (askedNumbers.length && choice.edition.numbers.length) choice.score += 45;
  }
  choices.sort((a, b) => b.score - a.score);
  const best = choices[0];
  const other = best && !decided && best.edition.start ? choices.find(choice => choice.pdf.url !== best.pdf.url && choice.kind === best.kind && choice.kind !== 'outro'
    && choice.program === best.program && choice.edition.start !== null && choice.edition.start !== best.edition.start && Math.abs(choice.priority - best.priority) <= 10) : undefined;
  return { best: best?.pdf ?? null, ambiguity: best && other ? { used: best.pdf, other: other.pdf } : null };
}

/** Link de página oficial colado: lê só essa página (robots, HTTPS, host exato, sem redirecionamento) e os PDFs dela. */
async function searchPastedPage(page: URL, subject: string, fetcher: typeof fetch): Promise<PublicLookup> {
  let result: PublicResult;
  try {
    const robots = await fetchPublicText(`${page.origin}/robots.txt`, 'text/plain', /^text\/plain\b/i, fetcher);
    if (disallowed(robots, page.pathname)) throw new Error('Página não liberada para consulta automática.');
    const html = await fetchPublicText(page.href, 'text/html', /^text\/html\b/i, fetcher);
    const { title, summary } = extractPage(html, page.href);
    if (!title) throw new Error('Página pública sem título.');
    result = { url: page.href, title, lastModified: '', summary, fetchedAt: new Date().toISOString(), documents: pdfLinks(html, page.href) };
  } catch {
    return { status: 'unavailable', ...emptyLookup };
  }
  const { best, ambiguity } = chooseDocument([result], subject);
  const pdf = await searchOfficialPdfs(best ? [best] : [], subject, fetcher, USER_AGENT, officialSearchTerms, disallowed);
  return { status: 'ok', pages: [result], ...pdf, ambiguity };
}

/** Lê os mapas, as páginas públicas e seus PDFs oficiais. Nenhum termo é enviado ao site. */
export async function searchOfficialPages(subject: string, fetcher: typeof fetch = fetch): Promise<PublicLookup> {
  const direct = officialPdfIn(subject);
  if (direct) {
    const title = decodeURIComponent(direct.pathname.split('/').at(-1)!).replace(/_/g, ' ');
    const pdf = await searchOfficialPdfs([{ url: direct.href, title }], subject, fetcher, USER_AGENT, officialSearchTerms, disallowed);
    return { status: pdf.passages.length ? 'ok' : 'partial', pages: [], ...pdf, ambiguity: null };
  }
  const page = officialPageIn(subject);
  if (page) return searchPastedPage(page, subject, fetcher);
  const wanted = officialSearchTerms(subject);
  if (!wanted.length) return { status: 'ok', ...emptyLookup };
  const pdfSearch = requestsOfficialPdf(searchWords(subject).join(' '));
  const programs = wanted.filter(word => word === 'probec' || word === 'conpeex');
  const years = wanted.filter(word => /^20\d{2}$/.test(word));
  const targetEdition = pdfSearch ? editalNumber(subject) : null;
  const documentFocus = pdfSearch ? officialSearchTerms(subject.split(/[,:?]/).find(part => /\b(?:probec|conpeex|edital)\b/i.test(part)) ?? subject) : [];
  const indexes = await Promise.all(OFFICIAL_HOSTS.map(host => readSearchIndex(host, fetcher)));
  const entries = new Map(indexes.flatMap(index => index ?? []).map(entry => [entry.url, entry]));
  const minimum = wanted.length <= 2 ? wanted.length : Math.ceil(wanted.length / 2);
  const focus = wanted.filter(word => word !== 'conpeex' && !/^\d+$/.test(word));
  const ranked = [...entries.values()].flatMap(entry => {
    const words = new Set(officialSearchTerms(entry.title));
    // O site do evento tem páginas como “Programação geral” com o nome do evento só no domínio.
    const conpeexSite = new URL(entry.url).hostname === OFFICIAL_HOSTS[1];
    const hits = wanted.filter(word => words.has(word) || conpeexSite && (word === 'conpeex' || word === '23')).length;
    const editions = years.filter(year => words.has(year)).length;
    const topicalPdf = pdfSearch && (programs.length
      ? programs.some(program => words.has(program)) && (words.has('edital') || words.has('retificacao'))
      : words.has('edital') && documentFocus.filter(word => words.has(word)).length >= Math.min(3, documentFocus.length));
    if (!topicalPdf && hits < minimum) return [];
    if (topicalPdf && years.length && !editions) return [];
    const fullPhrase = focus.length > 1 && [...words].join(' ').includes(focus.join(' '));
    const precision = hits / words.size;
    const editionScore = targetEdition && editalNumber(entry.title) === targetEdition ? 45 : 0;
    const documentScore = topicalPdf ? 12 + editions * 12 + (words.has('edital') && [...words][0] === 'edital' ? 14 : 0) : 0;
    return [{ entry, topicalPdf, start: editionOf(entry.title).start, score: editionScore + documentScore + hits * 6 + Number(fullPhrase) * 2 + precision + Number(conpeexSite && wanted.includes('conpeex')) }];
  });
  // Sem ano na pergunta, a edição mais recente de um edital vem antes da anterior.
  const newestPage = Math.max(0, ...ranked.filter(item => item.topicalPdf).map(item => item.start ?? 0));
  if (!years.length) for (const item of ranked) if (item.topicalPdf && item.start) item.score += Math.max(-3, item.start - newestPage) * 8;
  ranked.sort((a, b) => b.score - a.score || b.entry.lastModified.localeCompare(a.entry.lastModified));

  let failed = indexes.filter(index => !index).length;
  const pages = await Promise.all(ranked.slice(0, SEARCH_PAGE_LIMIT).map(async ({ entry, score }) => {
    try {
      const html = await fetchPublicText(entry.url, 'text/html', /^text\/html\b/i, fetcher);
      const { title, summary } = extractPage(html, entry.url);
      if (!title) throw new Error('Página pública sem título.');
      const summaryWords = new Set(officialSearchTerms(summary));
      return {
        result: { ...entry, title, summary, fetchedAt: new Date().toISOString(), documents: pdfSearch ? pdfLinks(html, entry.url) : [] },
        score: score + focus.filter(word => summaryWords.has(word)).length * 2,
      };
    } catch {
      failed += 1;
      return null;
    }
  }));
  const results = pages.filter(page => page !== null).sort((a, b) => b.score - a.score).slice(0, 3).map(page => page.result);
  const status = failed ? indexes.every(index => !index) || (ranked.length > 0 && !results.length) ? 'unavailable' : 'partial' : 'ok';
  const { best, ambiguity } = chooseDocument(results, subject);
  const pdf = await searchOfficialPdfs(best ? [best] : [], subject, fetcher, USER_AGENT, officialSearchTerms, disallowed);
  return { status, pages: results, ...pdf, ambiguity };
}

export async function readOfficialSnapshot(db: D1Database): Promise<OfficialSnapshot> {
  const row = await one(db, 'SELECT value FROM settings WHERE name=?', [SNAPSHOT]);
  try { const parsed = JSON.parse(String(row?.value ?? '')) as OfficialSnapshot; if (parsed && Array.isArray(parsed.pages)) return parsed; } catch { /* sem cópia ainda */ }
  return { refreshedAt: null, pages: [] };
}

/** Copia as páginas da lista fechada. Uma por vez não trava as outras; falha mantém a cópia anterior da página. */
export async function refreshOfficialSources(db: D1Database, now = Date.now(), fetcher: typeof fetch = fetch): Promise<OfficialSnapshot> {
  const previous = await readOfficialSnapshot(db), robots = new Map<string, Promise<string>>();
  const robotsFor = (host: string) => { if (!robots.has(host)) robots.set(host, fetcher(`https://${host}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, redirect: 'error', signal: AbortSignal.timeout(8000) }).then(response => response.ok ? boundedText(response) : '').catch(() => '')); return robots.get(host)!; };
  const pages = await Promise.all(OFFICIAL_SOURCES.map(async source => {
    const old = previous.pages.find(page => page.id === source.id), at = new Date(now).toISOString(), url = new URL(source.url);
    try {
      if (!(OFFICIAL_HOSTS as readonly string[]).includes(url.host)) throw new Error('host');
      if (disallowed(await robotsFor(url.host), url.pathname)) throw new Error('robots');
      const response = await fetcher(source.url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel().catch(() => {}); throw new Error(`http ${response.status}`); }
      return { id: source.id, label: source.label, url: source.url, fetchedAt: at, ...extractPage(await boundedText(response), source.url) } satisfies OfficialPage;
    } catch (error) {
      return { ...(old ?? { id: source.id, label: source.label, url: source.url, fetchedAt: null, title: '', summary: '', links: [] }), error: error instanceof Error ? error.message.slice(0, 40) : 'erro' } satisfies OfficialPage;
    }
  }));
  const snapshot: OfficialSnapshot = { refreshedAt: new Date(now).toISOString(), pages };
  await db.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(SNAPSHOT, JSON.stringify(snapshot), snapshot.refreshedAt).run();
  return snapshot;
}

/** Chamado pela rotina diária (/api/health). Trava de 20 h: chamadas extras não buscam nada. */
export async function maybeRefreshOfficialSources(db: D1Database, now = Date.now(), fetcher: typeof fetch = fetch): Promise<boolean> {
  const row = await one(db, 'SELECT updated_at FROM settings WHERE name=?', [SNAPSHOT]);
  const last = Date.parse(String(row?.updated_at ?? ''));
  if (Number.isFinite(last) && now - last < REFRESH_MS) return false;
  // Marca o início antes de buscar: duas chamadas ao mesmo tempo não buscam em dobro.
  const marker = new Date(now).toISOString();
  const claim = row
    ? await db.prepare('UPDATE settings SET updated_at=? WHERE name=? AND updated_at=?').bind(marker, SNAPSHOT, row.updated_at).run()
    : await db.prepare("INSERT INTO settings(name,value,updated_at) VALUES(?,'{\"refreshedAt\":null,\"pages\":[]}',?) ON CONFLICT(name) DO NOTHING").bind(SNAPSHOT, marker).run();
  if (Number(claim.meta?.changes ?? 0) !== 1) return false;
  await refreshOfficialSources(db, now, fetcher);
  return true;
}

// ---- Publicações do Instagram coladas pela comunicação --------------------------------------
export type InstagramPost = { id: string; url: string; postedAt: string; caption: string; addedBy: string; addedAt: string };
const postsName = (organizationId: string) => `role.instagram.v1:${organizationId}`;
const POST_URL = /^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]{5,40}\/?$/;

export async function listInstagramPosts(db: D1Database, organizationId: string): Promise<InstagramPost[]> {
  const row = await one(db, 'SELECT value FROM settings WHERE name=?', [postsName(organizationId)]);
  try { const parsed = JSON.parse(String(row?.value ?? '[]')) as InstagramPost[]; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
async function requireCurator(db: D1Database, actor: PortalActor | null, organizationId: string) {
  if (!actor) throw new HttpError(401, 'Entre para cadastrar publicações.', 'unauthenticated');
  const owner = platformOwnerAuthoritySql(actor), configure = aiConfigurationAuthority(actor, organizationId);
  if (!await one(db, `SELECT 1 WHERE (${owner.sql}) OR (${configure.sql})`, [...owner.values, ...configure.values])) throw new HttpError(403, 'Só a administração ou quem configura a IA da organização cadastra publicações do Instagram.', 'instagram_forbidden');
}
/** Ações: list (qualquer membro ativo da organização), add e remove (administração ou quem configura a IA). */
export async function instagramAction(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, now = Date.now()) {
  if (typeof input.organizationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.organizationId)) throw new HttpError(400, 'Escolha uma organização.', 'instagram_organization');
  const organizationId = input.organizationId, name = postsName(organizationId);
  if (input.action === 'list') {
    if (!actor) throw new HttpError(401, 'Entre para ver as publicações.', 'unauthenticated');
    return { posts: await listInstagramPosts(db, organizationId) };
  }
  await requireCurator(db, actor, organizationId);
  const row = await one(db, 'SELECT value,updated_at FROM settings WHERE name=?', [name]);
  const posts = await listInstagramPosts(db, organizationId);
  let next: InstagramPost[];
  if (input.action === 'add') {
    const url = typeof input.url === 'string' ? input.url.trim().split('?')[0] : '';
    if (!POST_URL.test(url)) throw new HttpError(400, 'Cole o link de uma publicação do Instagram (instagram.com/p/… ou /reel/…).', 'instagram_url');
    const postedAt = typeof input.postedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.postedAt) ? input.postedAt : '';
    if (!postedAt) throw new HttpError(400, 'Informe a data da publicação.', 'instagram_date');
    const caption = typeof input.caption === 'string' ? input.caption.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    if (caption.length < 10) throw new HttpError(400, 'Resuma a legenda em pelo menos 10 letras.', 'instagram_caption');
    if (posts.some(post => post.url === url)) throw new HttpError(409, 'Esta publicação já está cadastrada.', 'instagram_duplicate');
    const profile = await one(db, 'SELECT display_name FROM profiles WHERE user_id=?', [actor!.userId]);
    const addedBy = typeof profile?.display_name === 'string' && profile.display_name.trim() && !profile.display_name.includes('@') ? profile.display_name.trim().slice(0, 80) : 'Equipe';
    next = [{ id: crypto.randomUUID(), url, postedAt, caption, addedBy, addedAt: new Date(now).toISOString() }, ...posts].sort((a, b) => b.postedAt.localeCompare(a.postedAt)).slice(0, 100);
  } else if (input.action === 'remove') {
    next = posts.filter(post => post.id !== input.id);
    if (next.length === posts.length) throw new HttpError(404, 'Publicação não encontrada.', 'instagram_missing');
  } else throw new HttpError(400, 'Ação desconhecida.', 'instagram_action');
  const at = new Date(now).toISOString();
  const result = row
    ? await db.prepare('UPDATE settings SET value=?,updated_at=? WHERE name=? AND updated_at=?').bind(JSON.stringify(next), at, name, row.updated_at).run()
    : await db.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO NOTHING').bind(name, JSON.stringify(next), at).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new HttpError(409, 'A lista mudou enquanto você salvava. Atualize e tente de novo.', 'instagram_conflict');
  return { posts: next };
}
