import { officialPdfUrl } from './official-pdf-url';
import { clean, decode, disallowed, USER_AGENT, withoutActiveContent } from './official-sources';

/*
 * Leitura de links oficiais pelo Rolê, sem IA e sem custo:
 * - lista fechada de domínios (host exato, HTTPS, porta padrão, sem usuário nem senha);
 * - robots.txt de cada domínio respeitado, até 2 redirecionamentos, cada destino conferido de novo;
 * - só HTML (o PDF segue a regra de officialPdfUrl), até 600 KB e o mesmo tempo da busca oficial.
 * O conteúdo lido é dado externo: sai sem controles nem caracteres invisíveis.
 */
export const OFFICIAL_READ_HOSTS = ['proex.ufg.br', '23conpeex.plateia.ufg.br', 'files.cercomp.ufg.br', 'analisa.ufg.br', 'centrodeeventos.ufg.br'] as const;
/** Nome antigo da Pró-Reitoria: lido como o endereço atual. */
const HOST_ALIASES: Record<string, string> = { 'proec.ufg.br': 'proex.ufg.br' };
export const PROEX_HOME = 'https://proex.ufg.br/';
export const PROEX_FEED = 'https://proex.ufg.br/feed';
export const READ_BYTES = 600_000;
const READ_TIMEOUT_MS = 2500;
const MAX_REDIRECTS = 2;
const MAX_LINKS = 80;

/** Link que o Rolê pode ler: domínio da lista, HTTPS, porta padrão, sem credencial, sem ".." no caminho, sem IDN. */
export function readableOfficialUrl(raw: string): URL | null {
  if (typeof raw !== 'string' || raw.length > 500 || /[\s\\]/.test(raw)) return null;
  const parts = /^https:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(raw);
  // Host só em ASCII (sem @, porta ou punycode) e caminho sem "." ".." nem barras codificadas.
  if (!parts || !/^[a-z0-9.-]+$/i.test(parts[1]) || /(^|\.)xn--/i.test(parts[1]) || /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c/i.test(parts[2])) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const host = parts[1].toLowerCase(), target = HOST_ALIASES[host] ?? host;
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(OFFICIAL_READ_HOSTS as readonly string[]).includes(target)) return null;
  // Query só de paginação ou idioma: outra query poderia levar dados para o site ou fugir do robots.txt.
  if (url.search && !/^\?(?:page=\d{1,4}|locale=[A-Za-z]{2}(?:-[A-Za-z]{2})?)$/.test(url.search)) return null;
  url.hostname = target;
  url.hash = '';
  if (target === 'files.cercomp.ufg.br') return officialPdfUrl(url.href);
  return url;
}

/** Primeiro link lido pelo Rolê na mensagem (sem pontuação final). */
export function readableOfficialUrlIn(message: string): URL | null {
  for (const link of message.match(/https:\/\/[^\s<>"']+/gi) ?? []) {
    const url = readableOfficialUrl(link) ?? readableOfficialUrl(link.replace(/[),.!?\]]+$/, ''));
    if (url) return url;
  }
  return null;
}

export type OfficialReadFailureKind = 'bloqueado' | 'redirecionamento' | 'grande' | 'indisponivel';
export class OfficialReadError extends Error {
  constructor(readonly kind: OfficialReadFailureKind) { super(kind); }
}

async function limitedText(response: Response, max: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) return null;
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8').decode(bytes);
}

/** Pedido da pessoa (cancelado se ela desistir) somado ao tempo máximo de cada leitura. */
const deadline = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]) : AbortSignal.timeout(READ_TIMEOUT_MS);
export type ReadOptions = { signal?: AbortSignal; now?: number };

/** robots.txt do domínio: 404/410 é "sem regras"; outra falha impede a leitura. */
async function robotsOf(host: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<string> {
  const response = await fetcher(`https://${host}/robots.txt`, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' }, redirect: 'manual', credentials: 'omit', signal: deadline(signal) });
  if (response.status === 404 || response.status === 410) { await response.body?.cancel().catch(() => {}); return ''; }
  if (!response.ok || !/^text\/plain\b/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    throw new OfficialReadError('indisponivel');
  }
  const text = await limitedText(response, READ_BYTES);
  if (text === null) throw new OfficialReadError('indisponivel');
  return text;
}

/**
 * Cópia em memória da instância, por transporte: robots.txt por domínio e a página inicial e o RSS da
 * PROEX por 10 minutos. Falha não fica guardada (a próxima pergunta tenta de novo).
 */
const CACHE_MS = 10 * 60_000;
const CACHED_PAGES = new Set([PROEX_HOME, PROEX_FEED]);
type Cached<T> = { expires: number; value: Promise<T> };
type ReadCache = { robots: Map<string, Cached<string>>; pages: Map<string, Cached<{ url: URL; text: string }>> };
const readCaches = new WeakMap<typeof fetch, ReadCache>();
function cacheFor(fetcher: typeof fetch): ReadCache {
  let cache = readCaches.get(fetcher);
  if (!cache) { cache = { robots: new Map(), pages: new Map() }; readCaches.set(fetcher, cache); }
  return cache;
}
function remember<T>(map: Map<string, Cached<T>>, key: string, now: number, load: () => Promise<T>): Promise<T> {
  const saved = map.get(key);
  if (saved && saved.expires > now) return saved.value;
  const value = load();
  map.set(key, { expires: now + CACHE_MS, value });
  value.catch(() => { if (map.get(key)?.value === value) map.delete(key); });
  return value;
}

/** Lê uma página da lista, seguindo até 2 redirecionamentos que continuem na lista e liberados pelo robots.txt. */
export async function readOfficial(start: URL, accept: string, type: RegExp, fetcher: typeof fetch = fetch, options: ReadOptions = {}): Promise<{ url: URL; text: string }> {
  const cache = cacheFor(fetcher), now = options.now ?? Date.now();
  if (CACHED_PAGES.has(start.href)) return remember(cache.pages, `${accept} ${start.href}`, now, () => readFresh(start, accept, type, fetcher, cache, now, options.signal));
  return readFresh(start, accept, type, fetcher, cache, now, options.signal);
}

async function readFresh(start: URL, accept: string, type: RegExp, fetcher: typeof fetch, cache: ReadCache, now: number, signal?: AbortSignal): Promise<{ url: URL; text: string }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    let rules: string;
    try { rules = await remember(cache.robots, url.host, now, () => robotsOf(url.host, fetcher, signal)); }
    catch (error) { throw error instanceof OfficialReadError ? error : new OfficialReadError('indisponivel'); }
    if (disallowed(rules, url.pathname + url.search)) throw new OfficialReadError('bloqueado');
    let response: Response;
    try {
      response = await fetcher(url.href, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, redirect: 'manual', credentials: 'omit', signal: deadline(signal) });
    } catch { throw new OfficialReadError('indisponivel'); }
    if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      const location = response.headers.get('location');
      let next: URL | null = null;
      try { next = location && hop < MAX_REDIRECTS ? readableOfficialUrl(new URL(location, url).href) : null; } catch { next = null; }
      if (!next || next.hostname === 'files.cercomp.ufg.br') throw new OfficialReadError('redirecionamento');
      url = next;
      continue;
    }
    if (!response.ok || !type.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel().catch(() => {});
      throw new OfficialReadError('indisponivel');
    }
    if (Number(response.headers.get('content-length') ?? 0) > READ_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new OfficialReadError('grande');
    }
    const text = await limitedText(response, READ_BYTES);
    if (text === null) throw new OfficialReadError('grande');
    return { url, text };
  }
}

export type OfficialLinkItem = { text: string; url: string; readable: boolean };
export type OfficialLinkGroup = { title: string; links: OfficialLinkItem[] };
export type OfficialLinkPage = { url: string; title: string; summary: string; groups: OfficialLinkGroup[]; total: number; omitted: number; fetchedAt: string };

const attribute = (attrs: string, name: string) => decode(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(attrs)?.[2] ?? '');
const OTHER_LINKS = 'Outros links da página';

/** Blocos sem título visível nos sites da UFG (Weby): o nome vem da classe do bloco. */
const BLOCK_LABELS: [RegExp, string][] = [[/\bsocial/i, 'Redes sociais'], [/banner/i, 'Destaques'], [/news|noticia/i, 'Notícias'], [/footer|rodape/i, 'Rodapé']];
const blockLabel = (tag: string, attrs: string) => attribute(attrs, 'aria-label')
  || BLOCK_LABELS.find(([pattern]) => pattern.test(attribute(attrs, 'class')))?.[1]
  || (tag.toLowerCase() === 'footer' ? 'Rodapé' : '');
/** Paginação ("1", "2", "Última"), troca de idioma, barra do Governo e login não são links da página. */
const navigationNoise = (text: string, url: URL) => /^(?:\d{1,3}|[«»‹›<>]+|primeira|anterior|pr[oó]xima|[uú]ltima)$/i.test(text) || url.searchParams.has('locale')
  || /(?:^|\.)(?:epwg\.governoeletronico\.gov\.br|brasil\.gov\.br)$/i.test(url.hostname) || /^portais\.ufg\.br$/i.test(url.hostname) && /^\/login\b/i.test(url.pathname);
/** Mesmo endereço com maiúsculas ou acento diferentes ("Notícias", "notícias", "Noticias") conta uma vez. */
const linkKey = (href: string) => { let value = href; try { value = decodeURIComponent(href); } catch { /* fica como veio */ } return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase(); };
/** Domínio oficial da lista (mostrado como site oficial); a leitura pelo Rolê segue readableOfficialUrl. */
const officialHost = (url: URL) => (OFFICIAL_READ_HOSTS as readonly string[]).includes(HOST_ALIASES[url.hostname] ?? url.hostname);
const MAX_HREF = 300;

/**
 * Todos os links da página, agrupados pelo título de seção mais próximo: h1 a h6 (sem link dentro),
 * rótulo aria-label ou classe conhecida do bloco, bloco com classe de título ou item de menu sem destino
 * (javascript:). Links fora da lista de leitura vão como "só link".
 */
export function extractLinkGroups(html: string, base: string, maxLinks = MAX_LINKS): Omit<OfficialLinkPage, 'url' | 'fetchedAt'> {
  const body = withoutActiveContent(html).replace(/<!--[\s\S]*?-->/g, ' ');
  const title = clean(body.match(/<meta\s+property=["']og:title["']\s+content=(["'])([\s\S]*?)\1/i)?.[2] ?? body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '', 160);
  const summary = clean(body.match(/<meta\s+(?:property=["']og:description["']|name=["']description["'])\s+content=(["'])([\s\S]*?)\1/i)?.[2] ?? '', 400);
  const groups: OfficialLinkGroup[] = [], seen = new Set<string>();
  let current: OfficialLinkGroup | null = null, total = 0, omitted = 0;
  const label = (value: string) => {
    const text = clean(value, 120);
    if (text.length >= 2 && text.length <= 80 && (current as OfficialLinkGroup | null)?.title !== text) current = { title: text, links: [] };
  };
  // 1-2: título h1-h6 sem link dentro; 3-4: bloco com classe de título; 5-6: bloco (nav, section, div...); 7-8: link.
  const token = /<(h[1-6])\b[^>]*>((?:(?!<a\b|<\/h[1-6])[\s\S])*?)<\/\1>|<(div|span|p|strong|header)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:title|titulo|heading|panel-title|widget-title|component-title)\b[^"']*["'][^>]*>((?:(?!<\/?(?:div|a|ul|li|nav|section)\b)[\s\S])*?)<\/\3>|<(nav|section|aside|footer|header|div)\b([^>]*)>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of body.matchAll(token)) {
    if (match[1]) { label(match[2]); continue; }
    if (match[3]) { label(match[4]); continue; }
    if (match[5]) { const name = blockLabel(match[5], match[6]); if (name) label(name); continue; }
    const attrs = match[7] ?? '', href = attribute(attrs, 'href').trim(), inner = match[8] ?? '';
    // Item de menu que só abre um submenu (javascript:) é o título dos links que vêm depois.
    if (/^javascript:/i.test(href) || !href && /\brole\s*=\s*["']button["']/i.test(attrs)) { label(inner); continue; }
    if (!href || href.length > MAX_HREF || href.startsWith('#') || /^(?:mailto|tel|data):/i.test(href)) continue;
    let url: URL;
    try { url = new URL(href, base); } catch { continue; }
    // Só HTTPS e endereços curtos: link inseguro ou gigante não chega à pessoa.
    if (url.protocol !== 'https:' || url.href.length > MAX_HREF) continue;
    url.hash = '';
    const key = linkKey(url.href);
    if (seen.has(key)) continue;
    seen.add(key);
    const text = clean(inner, 140) || clean(attribute(attrs, 'aria-label'), 140) || clean(attribute(attrs, 'title'), 140) || clean(attribute(inner, 'alt'), 140) || url.hostname;
    if (navigationNoise(text, url)) continue;
    total++;
    if (total > maxLinks) { omitted++; continue; }
    const group: OfficialLinkGroup = current ?? { title: OTHER_LINKS, links: [] };
    if (!current) current = group;
    if (!groups.includes(group)) groups.push(group);
    group.links.push({ text, url: url.href, readable: officialHost(url) });
  }
  // Links sem bloco (barra de acessibilidade, topo) vão por último.
  const ordered = [...groups.filter(group => group.title !== OTHER_LINKS), ...groups.filter(group => group.title === OTHER_LINKS)];
  return { title, summary, groups: ordered, total: Math.min(total, maxLinks), omitted };
}

/** Lê a página oficial e devolve título, resumo e links agrupados. */
export async function readOfficialLinks(page: URL, fetcher: typeof fetch = fetch, now = Date.now(), signal?: AbortSignal): Promise<OfficialLinkPage> {
  const { url, text } = await readOfficial(page, 'text/html', /^text\/html\b/i, fetcher, { now, signal });
  return { url: url.href, ...extractLinkGroups(text, url.href), fetchedAt: new Date(now).toISOString() };
}

// ---- Notícias do site da PROEX (RSS) ---------------------------------------------------------
export type OfficialNews = { title: string; url: string; publishedAt: string | null; summary: string };

/** Lê o RSS sem dependência: cada <item> com título, link do próprio site, data e resumo curto. */
export function parseNewsFeed(xml: string, max = 10): OfficialNews[] {
  const news: OfficialNews[] = [];
  for (const [, block] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const field = (name: string) => {
      const raw = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block)?.[1] ?? '';
      const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
      return cdata ? cdata[1] : decode(raw);
    };
    const url = readableOfficialUrl(decode(field('link').trim()));
    const title = clean(field('title'), 200);
    if (!url || !title) continue;
    const time = Date.parse(field('pubDate').trim());
    news.push({ title, url: url.href, publishedAt: Number.isFinite(time) ? new Date(time).toISOString() : null, summary: clean(field('description'), 300) });
    if (news.length >= max) break;
  }
  return news;
}

export async function readProexNews(fetcher: typeof fetch = fetch, max = 8, options: ReadOptions = {}): Promise<OfficialNews[]> {
  const { text } = await readOfficial(new URL(PROEX_FEED), 'application/rss+xml, application/xml, text/xml', /^(?:application\/(?:rss\+)?xml|text\/xml)\b/i, fetcher, options);
  return parseNewsFeed(text, max);
}

/** Data curta em Brasília (dd/mm/aaaa). */
export function brasiliaDay(iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date(time)) : '';
}
