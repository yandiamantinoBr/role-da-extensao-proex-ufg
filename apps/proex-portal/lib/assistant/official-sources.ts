import { aiConfigurationAuthority, platformOwnerAuthoritySql, type PortalActor } from '../access';
import { one } from '../database';
import { HttpError } from '../errors';

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
  { id: 'conpeex-programacao', label: 'CONPEEX · programação geral', url: 'https://proex.ufg.br/p/59955-programacao-geral' },
  { id: 'conpeex-site', label: '23º CONPEEX', url: 'https://23conpeex.plateia.ufg.br/' },
] as const;
export const OFFICIAL_HOSTS = ['proex.ufg.br', '23conpeex.plateia.ufg.br'] as const;
const SNAPSHOT = 'role.official.v1', REFRESH_MS = 20 * 3600_000, PAGE_BYTES = 600_000;
const USER_AGENT = 'PortalPROEX-Role/1.0 (+https://proex-gestao.vercel.app; consulta diária de páginas públicas)';

export type OfficialPage = { id: string; label: string; url: string; fetchedAt: string | null; title: string; summary: string; links: { text: string; url: string }[]; error?: string };
export type OfficialSnapshot = { refreshedAt: string | null; startedAt?: string | null; pages: OfficialPage[] };

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', ordm: 'º', ordf: 'ª' };
const decode = (value: string) => value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => code[0] === '#' ? String.fromCodePoint(parseInt(code.slice(code[1] === 'x' || code[1] === 'X' ? 2 : 1), code[1] === 'x' || code[1] === 'X' ? 16 : 10)) : entities[code.toLowerCase()] ?? match);
const clean = (value: string, max: number) => decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max);

/** Extrai título, resumo curto (descrição ou primeiros parágrafos) e links de notícias/páginas do mesmo site. */
export function extractPage(html: string, base: string): { title: string; summary: string; links: { text: string; url: string }[] } {
  const body = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ');
  const title = clean(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '', 160);
  const description = body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? '';
  const paragraphs = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(match => clean(match[1], 400)).filter(text => text.length > 40).slice(0, 3).join(' ');
  const summary = clean(description, 600) || paragraphs.slice(0, 600);
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
