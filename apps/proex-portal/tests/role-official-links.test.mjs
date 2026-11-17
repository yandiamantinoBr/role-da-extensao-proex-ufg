import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Links oficiais, Instagram e notícias do Rolê com dados 100% sintéticos: todo transporte é falso e nenhuma IA é chamada.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  source = source.replace(/import\(['"](pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs)['"]\)/g,
    (_match, dependency) => `import(${JSON.stringify(import.meta.resolve(dependency))})`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-links-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}

const { readableOfficialUrl, readOfficial, extractLinkGroups, parseNewsFeed, readProexNews, READ_BYTES } = await import(compile('assistant/official-links'));
const { asksProexLinks, asksProexNews, directOfficialKind, officialRoute, isOfficialSearch } = await import(compile('assistant/official-search-intent'));
const { runRoleTool, officialLinksReply, proexNewsReply, shortLabel, DIRECT_REPLY_CHARS, ROLE_TOOL_NAMES } = await import(compile('assistant/role-tools'));
const { ROLE_TOOL_RESULT_BYTES } = await import(compile('assistant/role-contracts'));

const text = { 'content-type': 'text/plain' }, html = { 'content-type': 'text/html; charset=utf-8' }, rss = { 'content-type': 'application/rss+xml; charset=utf-8' };
// batch: o limite da busca oficial (portal_rate_limits) grava em lote; aqui não há limite.
const emptyDb = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }), batch: async () => [] };
/** Banco falso só com as publicações do Instagram cadastradas (mesma linha que instagramAction grava). */
const postsDb = posts => ({ prepare: sql => ({ bind: name => ({ first: async () => /FROM settings/.test(sql) && String(name).startsWith('role.instagram.v1:') ? { value: JSON.stringify(posts) } : null, all: async () => ({ results: [] }) }) }) , batch: async () => [] });
const POSTS = [
  { id: 'p1', url: 'https://www.instagram.com/p/AAAAA11111/', postedAt: '2026-11-02', caption: 'Oficina sintética de fotografia no campus, com inscrições abertas.', addedBy: 'Equipe', addedAt: '2026-11-02T12:00:00.000Z' },
  { id: 'p2', url: 'https://www.instagram.com/p/BBBBB22222/', postedAt: '2026-11-14', caption: 'Roda de conversa sintética sobre extensão e cultura.', addedBy: 'Equipe', addedAt: '2026-11-14T12:00:00.000Z' },
  { id: 'p3', url: 'https://www.instagram.com/reel/CCCCC33333/', postedAt: '2026-11-09', caption: 'Bastidores sintéticos da feira de projetos.', addedBy: 'Equipe', addedAt: '2026-11-09T12:00:00.000Z' },
];

const HOME = `<!doctype html><html><head><title>PROEX - Pró-Reitoria de Extensão</title>
<meta name="description" content="Página inicial sintética da Pró-Reitoria."><script>var oculto = '<a href="https://proex.ufg.br/escondido">x</a>';</script></head><body>
<nav aria-label="Menu principal"><a href="/p/29427-o-que-e-a-proex">O que é a PROEX</a><a href="javascript:void(0)">Abrir menu</a><a href="#conteudo">Pular</a></nav>
<h1>PROEX</h1>
<section><h2>Acesso Rápido</h2><ul>
<li><a href="https://proex.ufg.br/p/editais-proex">Editais</a></li>
<li><a href="https://docs.google.com/forms/d/e/sintetico/viewform">Formulário de inscrição</a></li>
<li><a href="https://drive.google.com/drive/folders/sintetica">Modelos de documentos</a></li>
<li><a href="https://proex.ufg.br/p/editais-proex">Editais (repetido)</a></li>
</ul></section>
<div class="component-title">Sistemas</div>
<ul><li><a href="https://sigaa.ufg.br/sigaa/">SIGAA</a></li><li><a href="https://analisa.ufg.br/p/sintetica">Analisa UFG</a></li><li><a href="http://antigo.example.test/">Sistema antigo</a></li></ul>
<h3>Estruturas vinculadas</h3><a href="https://centrodeeventos.ufg.br/">Centro de Eventos</a><a href="mailto:contato@example.test">Fale conosco</a>
<aside aria-label="Redes sociais"><a href="https://www.instagram.com/proex.sintetica/" title="Instagram"><img alt="ícone"></a><a href="https://www.youtube.com/@sintetico" aria-label="YouTube"></a></aside>
<footer><a href="https://proex.ufg.br/p/equipe-proex">Equipe​ e contatos</a></footer>
</body></html>`;

const WEBY = `<title>PROEX</title><nav class="menu_accessibility_component"><a href="https://www.gov.br/acessoinformacao">Acesso à Informação</a><a href="https://www.brasil.gov.br/">Portal do Governo Brasileiro</a><a href="https://epwg.governoeletronico.gov.br/barra/atualize.html">Atualize sua Barra de Governo</a><a href="https://portais.ufg.br/login?back_url=x">Entrar</a></nav><nav class="menu_i18n_component"><a href="/?locale=en">Inglês</a></nav>
<nav class="menu_component"><ul class="menu-res dropdown"><li><a role="button" class="empty-href" href="javascript:void(0);">A PROEX</a><ul class="menu-res submenu"><li><a href="/p/29427-o-que-e-a-proex">Apresentação</a></li><li><a href="/p/equipe-proex">Equipe</a></li></ul></li>
<li><a role="button" class="empty-href" href="javascript:void(0);">Sistemas</a><ul class="menu-res submenu"><li><a href="https://analisa.ufg.br/">Analisa Dados UFG</a></li></ul></li></ul></nav>
<div class="components_group_component social-icons"><figure class="image_component social-icon"><a href="https://www.instagram.com/sintetico" title="Instagram"><img alt=""></a></figure></div>
<section class="components_group_component section-fast-access"><h1>Acesso Rápido</h1><a href="/p/55763-editais-proec">Editais PROEX</a></section>
<section class="components_group_component highlight-news"><h2 class="front_news_title">Notícias</h2><h3><a href="/n/1-noticia-sintetica">Notícia sintética com link no título</a></h3><a class="category" href="/news?tags=Noticias">Notícias</a><a href="/news?tags=Not%C3%ADcias">Notícias</a><a href="/news?tags=NOTICIAS">Notícias</a><a href="https://proex.ufg.br/p/${'a'.repeat(320)}">Link gigante</a>
<ul class="pagination"><li><a href="/components/1?page=2">2</a></li><li><a href="/components/1?page=9">Última</a></li></ul></section>
<section class="components_group_component footer"><a href="/feedback">Fale conosco</a></section>`;

/** Sites falsos: robots liberado, página inicial e RSS sintéticos. Confere o modo de redirecionamento manual. */
function site({ pages = {}, robots = {}, onRequest } = {}) {
  const requested = [];
  const fetch = async (raw, init) => {
    const url = String(raw);
    requested.push(url);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.body, undefined);
    onRequest?.(url);
    if (url.endsWith('/robots.txt')) return robots[new URL(url).host] ?? new Response('User-agent: *\nDisallow: /admin', { headers: text });
    const page = pages[url];
    if (typeof page === 'function') return page();
    if (page) return new Response(page, { headers: url.endsWith('/feed') ? rss : html });
    return new Response('', { status: 404 });
  };
  return { fetch, requested };
}

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>PROEX</title>
<item><title><![CDATA[Inscrições abertas para oficina sintética]]></title><link>https://proex.ufg.br/n/90001-oficina-sintetica</link><pubDate>Fri, 14 Nov 2026 13:00:00 -0300</pubDate><description><![CDATA[<p>Resumo sintético da oficina.</p>]]></description></item>
<item><title>Resultado sintético &amp; prazo</title><link>https://proex.ufg.br/n/90002-resultado-sintetico</link><pubDate>Mon, 10 Nov 2026 09:00:00 -0300</pubDate><description>&lt;p&gt;Outro resumo.&lt;/p&gt;</description></item>
<item><title>Link de fora</title><link>https://example.test/n/1-fora</link><pubDate>Mon, 10 Nov 2026 09:00:00 -0300</pubDate></item>
</channel></rss>`;

test('DOMÍNIOS: lê só os cinco domínios oficiais, com HTTPS, porta padrão e sem credencial; recusa o resto', () => {
  for (const ok of ['https://proex.ufg.br/', 'https://proex.ufg.br/news?page=2', 'https://proex.ufg.br/?locale=pt-BR', 'https://23conpeex.plateia.ufg.br/p/1-programacao', 'https://analisa.ufg.br/p/abc', 'https://centrodeeventos.ufg.br/', 'https://files.cercomp.ufg.br/weby/up/694/o/edital-sintetico.pdf', 'https://PROEX.ufg.br/p/1-x']) {
    assert.ok(readableOfficialUrl(ok), `deveria ler: ${ok}`);
  }
  assert.equal(readableOfficialUrl('https://proec.ufg.br/p/1-x')?.href, 'https://proex.ufg.br/p/1-x', 'nome antigo vira o endereço atual');
  assert.equal(readableOfficialUrl('https://proex.ufg.br/p/1-x#topo')?.href, 'https://proex.ufg.br/p/1-x');
  for (const refused of [
    'https://example.test/', 'https://ufg.br/', 'https://evil.proex.ufg.br/', 'https://proex.ufg.br.example.test/', 'https://proex.ufg.br./',
    'http://proex.ufg.br/', 'https://proex.ufg.br:443/', 'https://proex.ufg.br:8443/', 'https://user:senha@proex.ufg.br/', 'https://user@proex.ufg.br/',
    'https://próex.ufg.br/', 'https://xn--prex-6oa.ufg.br/', 'https://proex.ufg.br/p/../admin', 'https://proex.ufg.br/%2e%2e/admin', 'https://proex.ufg.br/p/%2Fadmin',
    'https://proex.ufg.br/a b', 'https://proex.ufg.br/news?direction=desc', 'https://proex.ufg.br/p/1-x?leak=1', 'https://proex.ufg.br/?page=2&x=1', 'https://proex.ufg.br/?page=12345', 'https://files.cercomp.ufg.br/weby/up/999/o/outro.pdf', 'https://files.cercomp.ufg.br/pagina.html', 'ftp://proex.ufg.br/', 'javascript:alert(1)',
  ]) assert.equal(readableOfficialUrl(refused), null, `deveria recusar: ${refused}`);
});

test('LEITURA: robots de cada domínio, até 2 redirecionamentos conferidos, só HTML e no máximo 600 KB', async () => {
  const start = readableOfficialUrl('https://proec.ufg.br/inicio');
  // Redirecionamento dentro da lista: segue e confere o robots do novo domínio.
  const inside = site({ pages: {
    'https://proex.ufg.br/inicio': () => new Response(null, { status: 301, headers: { location: 'https://centrodeeventos.ufg.br/agenda' } }),
    'https://centrodeeventos.ufg.br/agenda': () => new Response(null, { status: 302, headers: { location: '/agenda/2026' } }),
    'https://centrodeeventos.ufg.br/agenda/2026': '<h1>Agenda sintética</h1>',
  } });
  const read = await readOfficial(start, 'text/html', /^text\/html\b/i, inside.fetch);
  assert.equal(read.url.href, 'https://centrodeeventos.ufg.br/agenda/2026');
  assert.deepEqual(inside.requested, ['https://proex.ufg.br/robots.txt', 'https://proex.ufg.br/inicio', 'https://centrodeeventos.ufg.br/robots.txt', 'https://centrodeeventos.ufg.br/agenda', 'https://centrodeeventos.ufg.br/agenda/2026']);

  const kind = async (fetcher, url = 'https://proex.ufg.br/inicio') => readOfficial(new URL(url), 'text/html', /^text\/html\b/i, fetcher).then(() => 'ok', error => error.kind);
  const outside = site({ pages: { 'https://proex.ufg.br/inicio': () => new Response(null, { status: 302, headers: { location: 'https://example.test/coleta' } }) } });
  assert.equal(await kind(outside.fetch), 'redirecionamento');
  assert.ok(outside.requested.every(url => !url.includes('example.test')), 'destino fora da lista nunca é pedido');
  const toHttp = site({ pages: { 'https://proex.ufg.br/inicio': () => new Response(null, { status: 302, headers: { location: 'http://proex.ufg.br/inicio' } }) } });
  assert.equal(await kind(toHttp.fetch), 'redirecionamento');
  const loop = site({ pages: { 'https://proex.ufg.br/inicio': () => new Response(null, { status: 302, headers: { location: '/inicio' } }) } });
  assert.equal(await kind(loop.fetch), 'redirecionamento', 'no máximo 2 redirecionamentos');
  assert.equal(loop.requested.filter(url => url.endsWith('/inicio')).length, 3);
  const blocked = site({ robots: { 'proex.ufg.br': new Response('User-agent: *\nDisallow: /inicio', { headers: text }) }, pages: { 'https://proex.ufg.br/inicio': '<h1>x</h1>' } });
  assert.equal(await kind(blocked.fetch), 'bloqueado');
  assert.deepEqual(blocked.requested, ['https://proex.ufg.br/robots.txt'], 'robots que bloqueia: a página não é pedida');
  const wildcard = site({ robots: { 'proex.ufg.br': new Response('User-agent: *\nDisallow: /p/*/rascunho$', { headers: text }) }, pages: { 'https://proex.ufg.br/p/1-x': '<h1>x</h1>' } });
  assert.equal(await kind(wildcard.fetch, 'https://proex.ufg.br/p/1-x'), 'bloqueado', 'regra com * ou $ vale como bloqueio');
  const byQuery = site({ robots: { 'proex.ufg.br': new Response('User-agent: *\nDisallow: /news?page=', { headers: text }) }, pages: { 'https://proex.ufg.br/news?page=2': '<h1>x</h1>' } });
  assert.equal(await kind(byQuery.fetch, 'https://proex.ufg.br/news?page=2'), 'bloqueado', 'robots compara caminho e query');
  const redirectBlocked = site({ robots: { 'analisa.ufg.br': new Response('User-agent: *\nDisallow: /', { headers: text }) }, pages: { 'https://proex.ufg.br/inicio': () => new Response(null, { status: 302, headers: { location: 'https://analisa.ufg.br/p/1' } }) } });
  assert.equal(await kind(redirectBlocked.fetch), 'bloqueado', 'o destino do redirecionamento também respeita o robots');
  const noRobots = site({ robots: { 'proex.ufg.br': new Response('', { status: 404 }) }, pages: { 'https://proex.ufg.br/inicio': '<h1>x</h1>' } });
  assert.equal(await kind(noRobots.fetch), 'ok', 'robots inexistente (404) não tem regras');
  const robotsDown = site({ robots: { 'proex.ufg.br': new Response('', { status: 503 }) }, pages: { 'https://proex.ufg.br/inicio': '<h1>x</h1>' } });
  assert.equal(await kind(robotsDown.fetch), 'indisponivel');
  const declared = site({ pages: { 'https://proex.ufg.br/inicio': () => new Response('<h1>x</h1>', { headers: { ...html, 'content-length': String(READ_BYTES + 1) } }) } });
  assert.equal(await kind(declared.fetch), 'grande');
  const streamed = site({ pages: { 'https://proex.ufg.br/inicio': () => new Response(`<h1>x</h1>${'a'.repeat(READ_BYTES)}`, { headers: html }) } });
  assert.equal(await kind(streamed.fetch), 'grande');
  const json = site({ pages: { 'https://proex.ufg.br/inicio': () => new Response('{}', { headers: { 'content-type': 'application/json' } }) } });
  assert.equal(await kind(json.fetch), 'indisponivel');
});

test('LINKS DA PÁGINA: agrupados pelo título de seção mais próximo; fora da lista vão como "só link"; limite de itens', () => {
  const page = extractLinkGroups(HOME, 'https://proex.ufg.br/');
  assert.equal(page.title, 'PROEX - Pró-Reitoria de Extensão', 'título da aba (o h1 dos sites da UFG é título de bloco)');
  assert.equal(page.summary, 'Página inicial sintética da Pró-Reitoria.');
  const titles = page.groups.map(group => group.title);
  assert.deepEqual(titles, ['Menu principal', 'Acesso Rápido', 'Sistemas', 'Estruturas vinculadas', 'Redes sociais', 'Rodapé']);
  const group = name => page.groups.find(entry => entry.title === name).links;
  assert.deepEqual(group('Acesso Rápido').map(link => [link.text, link.readable]), [['Editais', true], ['Formulário de inscrição', false], ['Modelos de documentos', false]], 'repetido sai; Google Forms e Drive são só link');
  assert.deepEqual(group('Sistemas').map(link => [link.text, link.readable]), [['SIGAA', false], ['Analisa UFG', true]], 'link http fica de fora');
  assert.deepEqual(group('Redes sociais').map(link => [link.text, link.url, link.readable]), [['Instagram', 'https://www.instagram.com/proex.sintetica/', false], ['YouTube', 'https://www.youtube.com/@sintetico', false]], 'ícone sem texto usa title ou aria-label');
  assert.deepEqual(group('Rodapé').map(link => link.text), ['Equipe e contatos'], 'rodapé sem rótulo não herda o título anterior; caractere invisível sai do texto');
  const all = page.groups.flatMap(entry => entry.links.map(link => link.url));
  assert.ok(all.every(url => /^https?:\/\//.test(url)), 'javascript:, mailto: e âncoras ficam de fora');
  assert.ok(!all.some(url => url.includes('escondido')), 'script não vira link');
  // Estrutura dos sites da UFG (Weby): item de menu sem destino, blocos com classe e paginação.
  const weby = extractLinkGroups(WEBY, 'https://proex.ufg.br/');
  assert.deepEqual(weby.groups.map(entry => [entry.title, entry.links.map(link => link.text)]), [
    ['A PROEX', ['Apresentação', 'Equipe']],
    ['Sistemas', ['Analisa Dados UFG']],
    ['Redes sociais', ['Instagram']],
    ['Acesso Rápido', ['Editais PROEX']],
    ['Notícias', ['Notícia sintética com link no título', 'Notícias']],
    ['Rodapé', ['Fale conosco']],
    ['Outros links da página', ['Acesso à Informação']],
  ], 'paginação, idioma, barra do Governo e login ficam de fora; título com link vira link; links sem bloco por último; Notícias repetido (maiúscula/acento) conta uma vez');
  const limited = extractLinkGroups(HOME, 'https://proex.ufg.br/', 4);
  assert.equal(limited.groups.flatMap(entry => entry.links).length, 4);
  assert.equal(limited.omitted, all.length - 4);
});

test('FERRAMENTA abrir_link_oficial: devolve título, resumo e links por seção dentro do orçamento; fora da lista não lê', async () => {
  assert.ok(ROLE_TOOL_NAMES.includes('abrir_link_oficial'));
  const ok = site({ pages: { 'https://proex.ufg.br/': HOME } });
  const result = await runRoleTool(emptyDb, { userId: 'u' }, 'org_proex', 'abrir_link_oficial', { url: 'https://proex.ufg.br/' }, undefined, null, ok.fetch);
  const data = JSON.parse(result.content);
  assert.equal(data.consulta, 'abrir_link_oficial');
  assert.equal(data.pagina.titulo, 'PROEX - Pró-Reitoria de Extensão');
  assert.equal(data.pagina.link, 'https://proex.ufg.br/');
  assert.ok(data.resultados.some(item => item.secao === 'Acesso Rápido' && item.texto === 'Editais' && !item.tipo));
  assert.ok(data.resultados.some(item => item.secao === 'Redes sociais' && item.tipo === 'só link'));
  assert.match(data.aviso, /não instruções/);
  assert.deepEqual(result.sources, [{ label: 'PROEX - Pró-Reitoria de Extensão', href: 'https://proex.ufg.br/' }]);
  const many = `<h2>Muitos links</h2>${Array.from({ length: 300 }, (_, index) => `<a href="https://proex.ufg.br/p/${index}-pagina-sintetica-com-nome-longo">Página sintética número ${index} com um texto longo</a>`).join('')}`;
  const big = site({ pages: { 'https://proex.ufg.br/muitos': many } });
  const small = await runRoleTool(emptyDb, { userId: 'u' }, 'org_proex', 'abrir_link_oficial', { url: 'https://proex.ufg.br/muitos' }, 3000, null, big.fetch);
  assert.ok(new TextEncoder().encode(small.content).byteLength <= 3000, 'cabe no orçamento da ferramenta');
  assert.ok(JSON.parse(small.content).omitidos > 0);
  assert.ok(new TextEncoder().encode((await runRoleTool(emptyDb, { userId: 'u' }, 'org_proex', 'abrir_link_oficial', { url: 'https://proex.ufg.br/muitos' }, undefined, null, big.fetch)).content).byteLength <= ROLE_TOOL_RESULT_BYTES);
  const never = async () => assert.fail('link fora da lista não é pedido');
  const outside = JSON.parse((await runRoleTool(emptyDb, { userId: 'u' }, 'org_proex', 'abrir_link_oficial', { url: 'https://forms.gle/sintetico' }, undefined, null, never)).content);
  assert.match(outside.observacao, /não está na lista de sites oficiais/);
  const pdf = JSON.parse((await runRoleTool(emptyDb, { userId: 'u' }, 'org_proex', 'abrir_link_oficial', { url: 'https://files.cercomp.ufg.br/weby/up/694/o/edital.pdf' }, undefined, null, never)).content);
  assert.match(pdf.observacao, /consultar_fontes_oficiais/);
  const down = await runRoleTool(emptyDb, { userId: 'u' }, 'org_proex', 'abrir_link_oficial', { url: 'https://centrodeeventos.ufg.br/' }, undefined, null, async () => new Response('', { status: 503 }));
  assert.match(JSON.parse(down.content).observacao, /Não consegui abrir a página agora/);
  assert.deepEqual(down.sources, [{ label: 'Link oficial', href: 'https://centrodeeventos.ufg.br/' }]);
  await assert.rejects(runRoleTool(emptyDb, { userId: 'u' }, 'org_proex', 'abrir_link_oficial', { url: 'x'.repeat(501) }, undefined, null, never), error => error.status === 400);
});

test('LINKS DA PROEX · RESPOSTA: primeira linha fixa, blocos clicáveis (linkGroups) e texto de reserva com "(site externo)"; página fora do ar diz isso e dá o link', async () => {
  const ok = site({ pages: { 'https://proex.ufg.br/': HOME } });
  const answer = await officialLinksReply(undefined, ok.fetch, Date.parse('2026-11-17T15:00:00Z'));
  const lines = answer.reply.split('\n');
  assert.equal(lines[0], 'Estes são os links publicados na página inicial da PROEX.');
  assert.match(answer.reply, /\n\nAcesso Rápido\n• Editais: https:\/\/proex\.ufg\.br\/p\/editais-proex\n• Formulário de inscrição \(site externo\): https:\/\/docs\.google\.com/);
  assert.match(answer.reply, /\n\nRedes sociais\n• Instagram \(site externo\): https:\/\/www\.instagram\.com\/proex\.sintetica\//);
  assert.match(answer.reply, /Fonte: página inicial da PROEX, consultada em 17\/11\/2026, 12:00 \(Brasília\)\.$/);
  assert.deepEqual(answer.sources, [{ label: 'PROEX · página inicial', href: 'https://proex.ufg.br/' }]);
  assert.deepEqual(answer.linkGroups.map(group => group.title), ['Menu principal', 'Acesso Rápido', 'Sistemas', 'Estruturas vinculadas', 'Redes sociais', 'Rodapé']);
  assert.deepEqual(answer.linkGroups[1].links[1], { text: 'Formulário de inscrição', url: 'https://docs.google.com/forms/d/e/sintetico/viewform', readable: false });
  assert.match(answer.linkIntro, /^Estes são os links publicados na página inicial da PROEX\.\nFonte: página inicial da PROEX/);
  const down = await officialLinksReply(undefined, async () => new Response('', { status: 503 }));
  assert.equal(down.reply, 'Não consegui abrir a página inicial da PROEX agora. Os links estão em https://proex.ufg.br/');
  assert.equal(down.linkGroups, undefined);
});

test('REVISÃO · LIMITES DA RESPOSTA DIRETA: texto até ~8.000 caracteres com "mais N links"; credencial na página não sai', async () => {
  const many = `<title>PROEX</title><h2>Muitos</h2>${Array.from({ length: 80 }, (_, index) => `<a href="https://proex.ufg.br/p/${index}-pagina-sintetica-com-um-nome-bem-comprido-para-encher-a-linha-da-resposta">Página sintética número ${index} com um nome comprido para encher a resposta</a>`).join('')}`;
  const big = await officialLinksReply(undefined, site({ pages: { 'https://proex.ufg.br/': many } }).fetch);
  assert.ok(big.reply.length <= DIRECT_REPLY_CHARS, `texto com ${big.reply.length} caracteres`);
  assert.match(big.reply, /Há mais \d+ links na página; abra a página para ver todos\./);
  assert.equal(big.linkGroups[0].links.length, 80, 'os blocos clicáveis trazem todos os links lidos');
  const leakyLink = `<title>PROEX</title><h2>Acesso</h2><a href="https://proex.ufg.br/p/1-x">senha: segredo-sintetico-123</a><a href="https://proex.ufg.br/p/2-y">Editais</a>`;
  const dropped = await officialLinksReply(undefined, site({ pages: { 'https://proex.ufg.br/': leakyLink } }).fetch);
  assert.deepEqual(dropped.linkGroups[0].links.map(link => link.text), ['Editais'], 'link com credencial sai');
  assert.doesNotMatch(dropped.reply, /segredo/);
  const leaky = `<title>PROEX</title><h2>senha: segredo-sintetico-123</h2><a href="https://proex.ufg.br/p/1-x">Editais</a>`;
  const guarded = await officialLinksReply(undefined, site({ pages: { 'https://proex.ufg.br/': leaky } }).fetch);
  assert.equal(guarded.reply, 'Não consegui mostrar os links agora. Confira em https://proex.ufg.br/');
  assert.equal(guarded.linkGroups, undefined);
  assert.equal(shortLabel('Disponível o resultado preliminar de trabalhos aprovados para apresentar no 23º Conpeex'), 'Disponível o resultado preliminar de trabalhos aprovados para apresentar no…');
  assert.equal(shortLabel('Título curto'), 'Título curto');
});

test('NOTÍCIAS: RSS lido sem dependência, com título, data, resumo e só links do próprio site', async () => {
  const news = parseNewsFeed(FEED);
  assert.deepEqual(news.map(entry => [entry.title, entry.url]), [['Inscrições abertas para oficina sintética', 'https://proex.ufg.br/n/90001-oficina-sintetica'], ['Resultado sintético & prazo', 'https://proex.ufg.br/n/90002-resultado-sintetico']]);
  assert.equal(news[0].summary, 'Resumo sintético da oficina.');
  assert.equal(news[1].summary, 'Outro resumo.');
  assert.equal(news[0].publishedAt, '2026-11-14T16:00:00.000Z');
  const feed = site({ pages: { 'https://proex.ufg.br/feed': FEED } });
  assert.equal((await readProexNews(feed.fetch)).length, 2);
  assert.deepEqual(feed.requested, ['https://proex.ufg.br/robots.txt', 'https://proex.ufg.br/feed']);
  const blocked = site({ robots: { 'proex.ufg.br': new Response('User-agent: *\nDisallow: /feed', { headers: text }) }, pages: { 'https://proex.ufg.br/feed': FEED } });
  await assert.rejects(readProexNews(blocked.fetch), error => error.kind === 'bloqueado');
});

const INSTAGRAM_FIRST = 'O Instagram não deixa o Rolê ler os posts sozinho. Veja o perfil em https://www.instagram.com/proex.ufg. Abaixo estão as publicações cadastradas pela comunicação e as últimas notícias do site.';
test('INSTAGRAM E NOTÍCIAS · RESPOSTA: perfil e cadastradas por data em blocos clicáveis, notícias do RSS; dica só para quem cadastra; RSS fora do ar, o aviso', async () => {
  const feed = site({ pages: { 'https://proex.ufg.br/feed': FEED } });
  const answer = await proexNewsReply(postsDb(POSTS), 'org_proex', feed.fetch);
  const parts = answer.reply.split('\n\n');
  assert.equal(parts[0], INSTAGRAM_FIRST);
  assert.deepEqual(parts[1].split('\n').map(line => line.slice(0, 14)), ['Instagram da P', '• Perfil da PR', '• 14/11/2026 ·', '• 09/11/2026 ·', '• 02/11/2026 ·'], 'perfil e mais recentes primeiro');
  assert.match(parts[2], /^Últimas notícias do site da PROEX\n• 14\/11\/2026 · Inscrições abertas para oficina sintética: https:\/\/proex\.ufg\.br\/n\/90001-oficina-sintetica/);
  assert.deepEqual(answer.linkGroups.map(group => [group.title, group.links.length]), [['Instagram da PROEX', 4], ['Últimas notícias do site da PROEX', 2]]);
  assert.deepEqual(answer.linkGroups[0].links[0], { text: 'Perfil da PROEX no Instagram', url: 'https://www.instagram.com/proex.ufg', readable: false });
  assert.deepEqual(answer.sources, [], 'notícias e publicações já vêm nos blocos; as fontes não repetem');
  assert.equal(answer.linkIntro, INSTAGRAM_FIRST);
  const none = await proexNewsReply(emptyDb, 'org_proex', feed.fetch);
  assert.equal(none.reply.split('\n\n')[1], 'Nenhuma publicação do Instagram foi cadastrada ainda. Peça à comunicação para cadastrar os posts no Portal.');
  const curator = await proexNewsReply(emptyDb, 'org_proex', feed.fetch, undefined, true);
  assert.equal(curator.reply.split('\n\n')[1], 'Nenhuma publicação do Instagram foi cadastrada ainda. A comunicação pode cadastrar posts em Configurações → Chaves e modelos → Fontes oficiais do Rolê.');
  assert.match(none.reply, /Últimas notícias do site da PROEX/);
  const offline = await proexNewsReply(postsDb(POSTS), 'org_proex', async () => new Response('', { status: 503 }));
  assert.equal(offline.reply.split('\n\n')[1], 'Não consegui abrir as notícias do site da PROEX agora. Confira em https://proex.ufg.br/.');
  assert.match(offline.reply, /Instagram da PROEX\n• Perfil da PROEX no Instagram/);
});

test('FERRAMENTA consultar_fontes_oficiais: "instagram", "posts", "últimos" são palavras vazias e as notícias do RSS entram como fonte', async () => {
  const feed = site({ pages: { 'https://proex.ufg.br/feed': FEED } });
  const recent = JSON.parse((await runRoleTool(postsDb(POSTS), { userId: 'u' }, 'org_proex', 'consultar_fontes_oficiais', { texto: 'últimos posts do Instagram da PROEX' }, undefined, null, feed.fetch)).content);
  assert.deepEqual(recent.resultados.filter(item => item.legenda).map(item => item.publicadoEm), ['2026-11-14', '2026-11-09', '2026-11-02']);
  assert.ok(recent.resultados.some(item => item.fonte === 'Notícias do site da PROEX' && item.publicadoEm === '14/11/2026'));
  assert.match(recent.observacao, /O Instagram não deixa o Rolê ler os posts sozinho/);
  // Com assunto: a legenda precisa ter só o assunto, não "instagram" nem "publicações".
  const topical = await runRoleTool(postsDb(POSTS), { userId: 'u' }, 'org_proex', 'consultar_fontes_oficiais', { texto: 'publicações do Instagram sobre fotografia' }, undefined, null, async (raw, init) => String(raw).endsWith('/feed') || String(raw).endsWith('/robots.txt') ? feed.fetch(raw, init) : new Response('', { status: 503 }));
  assert.ok(topical.sources.some(source => source.href === 'https://www.instagram.com/p/AAAAA11111/'));
  const oficina = await runRoleTool(emptyDb, { userId: 'u' }, 'org_proex', 'consultar_fontes_oficiais', { texto: 'notícias da oficina' }, undefined, null, async (raw, init) => String(raw).endsWith('/feed') || String(raw).endsWith('/robots.txt') ? feed.fetch(raw, init) : new Response('', { status: 503 }));
  assert.ok(oficina.sources.some(source => source.href === 'https://proex.ufg.br/n/90001-oficina-sintetica'), 'notícia do RSS com o assunto aparece');
});

test('INTENÇÃO: "links da PROEX" e "Instagram/notícias" disparam a resposta direta; operações, redação e dados do Portal não', () => {
  const links = ['abra os links digitais da PROEX', 'Links da PROEX', 'quais são os links úteis da PROEX?', 'acesso rápido da PROEX', 'Sistemas da PROEX', 'me mostra os serviços da Pró-Reitoria de Extensão', 'links da página inicial da PROEX', 'o que tem na página inicial da PROEC?', 'link do instagram da proex'];
  const news = ['últimos posts do Instagram da PROEX', 'Quais as últimas publicações do Instagram?', 'o que a PROEX publicou?', 'O que a PROEX postou essa semana?', 'notícias recentes da PROEX', 'tem novidades da PROEX?', 'últimas notícias do site'];
  const neither = ['registrar entrega de 20 brindes', 'criar demanda para o Projeto A', 'links do projeto X no portal', 'escreva um post para o Instagram sobre o CONPEEX', 'crie uma legenda para o instagram da PROEX', 'publique no Instagram as fotos do evento', 'Qual o prazo do edital PROBEC?', 'Como registro a entrega de brindes?', 'quais os links das demandas abertas?', 'sistemas de estoque', 'faça um texto com as notícias da PROEX',
    // Revisão de segurança (2026-11-17): perguntas do Portal e com assunto vão ao modelo (ou à busca por assunto).
    'Quais as últimas novidades da agenda?', 'Quais as novidades recentes dos empréstimos?', 'Tem notícias novas sobre o meu saldo?',
    'Quantos posts novos do Instagram a equipe agendou na agenda?', 'Resuma as últimas notícias e diga o que importa para a equipe',
    'Quais os links da reunião da PROEX amanhã?', 'Me manda os links dos brindes da PROEX', 'Quais as últimas notícias sobre o edital de bolsas da PROEX?',
    'últimas notícias do edital de bolsas de extensão da PROEX', 'links da PROEX para inscrição no edital de cultura', 'compare as últimas notícias da PROEX'];
  for (const phrase of links) { assert.equal(asksProexLinks(phrase), true, `links: ${phrase}`); assert.equal(directOfficialKind(phrase), 'links', phrase); }
  for (const phrase of news) { assert.equal(asksProexNews(phrase), true, `notícias: ${phrase}`); assert.equal(directOfficialKind(phrase), 'news', phrase); }
  for (const phrase of neither) assert.equal(directOfficialKind(phrase), null, `não deveria disparar: ${phrase}`);
});

test('TELA: officialLookup segue a regra — direto (sem custo) com o botão, no modo só busca e para links/notícias; edital reconhecido vai ao modelo', () => {
  const base = { mode: 'chat', toggled: false, publicSearch: true, attachment: false };
  const edital = 'Quais editais de extensão estão abertos?';
  assert.equal(isOfficialSearch(edital), true, 'a frase continua reconhecida');
  assert.deepEqual(officialRoute({ ...base, text: edital }), { official: false, explicit: false }, 'com a conversa disponível vai ao modelo, com custo');
  assert.deepEqual(officialRoute({ ...base, toggled: true, text: edital }), { official: true, explicit: true });
  assert.deepEqual(officialRoute({ ...base, mode: 'search', text: edital }), { official: true, explicit: true });
  assert.deepEqual(officialRoute({ ...base, text: 'abra os links digitais da PROEX' }), { official: true, explicit: false }, 'links da PROEX: direto e sem custo');
  assert.deepEqual(officialRoute({ ...base, text: 'últimos posts do Instagram da PROEX' }), { official: true, explicit: false });
  assert.deepEqual(officialRoute({ ...base, publicSearch: false, text: 'links da PROEX' }), { official: false, explicit: false });
  for (const text of ['Quais as últimas novidades da agenda?', 'Quais as últimas notícias sobre o edital de bolsas da PROEX?', 'Me manda os links dos brindes da PROEX']) {
    assert.deepEqual(officialRoute({ ...base, text }), { official: false, explicit: false }, `vai ao modelo: ${text}`);
  }
  assert.deepEqual(officialRoute({ ...base, attachment: true, text: 'links da PROEX' }), { official: false, explicit: false });
  const tsx = readFileSync(`${root}components/portal/role-assistant.tsx`, 'utf8');
  assert.match(tsx, /const officialLookup = route\.official;/, 'a tela usa a mesma regra para o custo mostrado');
});

test('REVISÃO · CÓPIA E CANCELAMENTO: página inicial e RSS ficam 10 min em memória, robots por domínio; o pedido cancelado chega ao transporte', async () => {
  const home = site({ pages: { 'https://proex.ufg.br/': HOME } }), at = Date.parse('2026-11-17T15:00:00Z');
  await officialLinksReply(undefined, home.fetch, at);
  await officialLinksReply(undefined, home.fetch, at + 5 * 60_000);
  assert.deepEqual(home.requested, ['https://proex.ufg.br/robots.txt', 'https://proex.ufg.br/'], 'dentro de 10 min, nada é pedido de novo');
  await officialLinksReply(undefined, home.fetch, at + 11 * 60_000);
  assert.equal(home.requested.length, 4, 'depois de 10 min, lê de novo');
  const pages = site({ pages: { 'https://proex.ufg.br/p/1-a': '<h1>a</h1>', 'https://proex.ufg.br/p/2-b': '<h1>b</h1>' } });
  await readOfficial(new URL('https://proex.ufg.br/p/1-a'), 'text/html', /^text\/html\b/i, pages.fetch, { now: at });
  await readOfficial(new URL('https://proex.ufg.br/p/2-b'), 'text/html', /^text\/html\b/i, pages.fetch, { now: at });
  assert.deepEqual(pages.requested, ['https://proex.ufg.br/robots.txt', 'https://proex.ufg.br/p/1-a', 'https://proex.ufg.br/p/2-b'], 'robots uma vez por domínio; outras páginas não ficam guardadas');
  let failing = true;
  const flaky = site({ pages: { 'https://proex.ufg.br/feed': () => failing ? new Response('', { status: 503 }) : new Response(FEED, { headers: rss }) } });
  await assert.rejects(readProexNews(flaky.fetch, 8, { now: at }));
  failing = false;
  assert.equal((await readProexNews(flaky.fetch, 8, { now: at })).length, 2, 'falha não fica guardada');
  const controller = new AbortController(); controller.abort();
  const seen = [];
  const watcher = async (_raw, init) => { seen.push(init.signal.aborted); throw new Error('cancelado'); };
  await assert.rejects(readOfficial(new URL('https://analisa.ufg.br/p/1'), 'text/html', /^text\/html\b/i, watcher, { signal: controller.signal }), error => error.kind === 'indisponivel');
  assert.deepEqual(seen, [true], 'o sinal do pedido chega ao fetch');
});
