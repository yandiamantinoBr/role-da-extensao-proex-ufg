import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';

// Busca oficial do Rolê com dados 100% sintéticos: todo transporte é falso e nenhuma IA é chamada.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  source = source.replace(/import\(['"](pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs)['"]\)/g,
    (_match, dependency) => `import(${JSON.stringify(import.meta.resolve(dependency))})`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-official-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}

const { isOfficialSearch } = await import(compile('assistant/official-search-intent'));
const { searchOfficialPages } = await import(compile('assistant/official-sources'));
const { officialPageUrl } = await import(compile('assistant/official-pdf-url'));
const { officialSearchReply, runRoleTool } = await import(compile('assistant/role-tools'));

// Sem cópia diária nem Instagram: a resposta vem só da consulta ao vivo.
const emptyDb = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }) };
const FILES = 'https://files.cercomp.ufg.br/weby/up/694/o/';
const text = { 'content-type': 'text/plain' }, html = { 'content-type': 'text/html' }, xml = { 'content-type': 'application/xml' }, pdfType = { 'content-type': 'application/pdf' };

// Rodapé neutro: um PDF real tem bem mais texto que o carimbo de assinatura; nenhuma palavra dele responde às perguntas.
const FOOTER = ['Rodapé sintético de preenchimento, sem dado real, usado apenas nesta verificação automática.', 'Segunda linha neutra do rodapé sintético, também sem dado real e sem relação com a consulta.'];
async function pdfWith(...pages) {
  const pdf = await PDFDocument.create();
  for (const lines of pages) {
    const page = pdf.addPage([595, 842]);
    (lines.length ? [...lines, ...FOOTER] : []).forEach((line, index) => page.drawText(line, { x: 40, y: 800 - index * 18, size: 10 }));
  }
  return new Uint8Array(await pdf.save());
}
/** PDF só com uma linha curta (como o carimbo de assinatura do SEI), sem rodapé. */
async function stampPdf(line) {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]).drawText(line, { x: 40, y: 800, size: 10 });
  return new Uint8Array(await pdf.save());
}

/** Site falso: sitemap da PROEX com as páginas dadas, CONPEEX vazio, robots liberado. */
function officialSite({ pages = {}, pdfs = {}, lastModified = {} } = {}) {
  const requested = [];
  const fetcher = async (raw, init) => {
    const url = String(raw);
    requested.push(url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *', { headers: text });
    if (url.endsWith('/sitemap.xml')) {
      const links = url.startsWith('https://proex.ufg.br') ? Object.keys(pages) : [];
      return new Response(`<urlset>${links.map(link => `<url><loc>${link}</loc><lastmod>${lastModified[link] ?? '2026-11-01'}</lastmod></url>`).join('')}</urlset>`, { headers: xml });
    }
    if (pages[url]) return new Response(pages[url], { headers: html });
    if (pdfs[url]) return new Response(await pdfs[url], { headers: pdfType });
    assert.fail(`pedido inesperado ${url}`);
  };
  return { fetcher, requested };
}
const pageHtml = (title, links) => `<h1>${title}</h1><article><p>Página sintética do edital para testes automáticos do Portal.</p>${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</article>`;

test('INTENÇÃO: perguntas sobre editais da PROEX vão para a busca oficial; operações e perguntas genéricas não', () => {
  const official = [
    'quantas bolsas tem o edital do PROBEC?',
    'qual o prazo de recurso do PROBEC depois do aditivo?',
    'edital preliminar do PROBEC',
    'Quais editais de extensão estão abertos?',
    'Qual o prazo do edital PROEX nº 133/2026?',
    'Me mostra o Edital 133/2026',
    'O que mudou no aditivo do edital?',
    'Saiu a retificação do edital de cultura?',
    'Quando sai o resultado do edital de bolsas?',
    'Tem termo aditivo do edital da PROEC?',
    'Me explica https://23conpeex.plateia.ufg.br/p/59955-programacao-geral',
    'Resume isto: https://proex.ufg.br/n/60322-edital-proec-n-08-2026',
    'https://files.cercomp.ufg.br/weby/up/694/o/SEI_6045486_Edital_133.pdf',
  ];
  const portal = [
    'Registre a entrega das camisetas do edital PROBEC',
    'Crie uma demanda para revisar o edital de extensão',
    'Mova o estoque de kits para o evento do edital PROEX',
    'Prepare um rascunho de demanda sobre o resultado do edital',
    'Me ajude a escrever um edital de extensão',
    'O que é um edital?',
    'Como funciona um edital?',
    'Quantas entregas estão pendentes?',
    'Qual o resultado da reunião de ontem?',
    'https://exemplo.test/p/123-edital-proex',
  ];
  for (const phrase of official) assert.equal(isOfficialSearch(phrase), true, `deveria buscar: ${phrase}`);
  for (const phrase of portal) assert.equal(isOfficialSearch(phrase), false, `não deveria buscar: ${phrase}`);
});

test('EDIÇÃO: sem ano, a edição mais recente vem primeiro e o Rolê avisa que há outra; com ano, só a edição pedida', async () => {
  const older = 'https://proex.ufg.br/p/201-edital-probec-2025-2026';
  const newer = 'https://proex.ufg.br/p/202-edital-probec-2026-2027';
  const oldPdf = `${FILES}probec-2025.pdf`, newPdf = `${FILES}probec-2026.pdf`;
  const site = () => officialSite({
    pages: {
      [older]: pageHtml('Edital PROBEC 2025/26', [[oldPdf, 'Edital PROBEC 2025/26']]),
      [newer]: pageHtml('Edital PROBEC 2026/27', [[newPdf, 'Edital PROBEC 2026/27 (final)']]),
    },
    // A página antiga foi mexida depois: a data de alteração não pode decidir a edição.
    lastModified: { [older]: '2026-11-10', [newer]: '2026-05-01' },
    pdfs: {
      [oldPdf]: pdfWith(['2.1 Serão ofertadas 80 bolsas para projetos de extensão do ciclo anterior.']),
      [newPdf]: pdfWith(['2.1 Serão ofertadas 100 bolsas para projetos de extensão do ciclo atual.']),
    },
  });
  const latest = site();
  const recent = await searchOfficialPages('quantas bolsas tem o edital do PROBEC?', latest.fetcher);
  assert.equal(recent.passages[0]?.title, 'Edital PROBEC 2026/27 (final)');
  assert.ok(!latest.requested.includes(oldPdf), 'só o documento escolhido é baixado');
  const reply = await officialSearchReply(emptyDb, 'org_test', 'quantas bolsas tem o edital do PROBEC?', site().fetcher);
  assert.match(reply.reply, /^Encontrei mais de um documento possível: Edital PROBEC 2026\/27 \(final\) e Edital PROBEC 2025\/26\. Usei o mais recente; diga se quer o outro\.$/m);
  assert.match(reply.reply, /100 bolsas/);

  const asked = site();
  const chosen = await searchOfficialPages('quantas bolsas tem o edital do PROBEC 2025?', asked.fetcher);
  assert.equal(chosen.passages[0]?.title, 'Edital PROBEC 2025/26');
  assert.ok(!asked.requested.includes(newPdf));
  const askedReply = await officialSearchReply(emptyDb, 'org_test', 'quantas bolsas tem o edital do PROBEC 2025?', site().fetcher);
  assert.doesNotMatch(askedReply.reply, /mais de um documento possível/);
  assert.match(askedReply.reply, /80 bolsas/);
});

test('EDIÇÃO: número do edital na pergunta aceita só a edição com aquele número', async () => {
  const page = 'https://proex.ufg.br/p/301-edital-probec-2026-inscricoes';
  const right = `${FILES}SEI_1_Edital_133.pdf`, wrong = `${FILES}SEI_2_Edital_120.pdf`;
  const { fetcher, requested } = officialSite({
    pages: { [page]: pageHtml('Editais de extensão PROBEC', [[wrong, 'Edital PROBEC nº 120/2026 (final)'], [right, 'Edital PROBEC nº 133/2026']]) },
    pdfs: {
      [right]: pdfWith(['3.1 As inscrições do edital 133 vão até 30/11/2026 pelo sistema sintético.']),
      [wrong]: pdfWith(['3.1 As inscrições do edital 120 vão até 10/10/2026 pelo sistema sintético.']),
    },
  });
  const result = await searchOfficialPages('Até quando vão as inscrições do edital PROBEC nº 133/2026?', fetcher);
  assert.equal(result.passages[0]?.title, 'Edital PROBEC nº 133/2026');
  assert.ok(!requested.includes(wrong));
});

test('LINK DE PÁGINA OFICIAL: é o destino exato; só aquela página é lida e o PDF dela é usado', async () => {
  const page = 'https://proex.ufg.br/p/60322-edital-proec-n-08-2026-conpeex';
  const amendment = `${FILES}SEI_9_Termo_Aditivo.pdf`, notice = `${FILES}SEI_8_Edital_08.pdf`;
  const pages = { [page]: pageHtml('Edital PROEC nº 08/2026 · 23º CONPEEX', [[notice, 'Edital PROEC nº 08/2026 (final)'], [amendment, 'Retificação nº 02 do Edital PROEC nº 08/2026']]) };
  const pdfs = {
    [amendment]: pdfWith(['Retificação nº 02. Onde se lê: envio da apresentação até 15/10/2026.', 'Leia-se: o envio da apresentação vai até 22/10/2026 às 17h.']),
    [notice]: pdfWith(['5.1 O envio da apresentação vai até 15/10/2026 às 17h pelo sistema sintético.']),
  };
  const { fetcher, requested } = officialSite({ pages, pdfs });
  const result = await searchOfficialPages(`Qual o prazo de envio da apresentação depois da retificação? ${page}`, fetcher);
  assert.deepEqual(requested, ['https://proex.ufg.br/robots.txt', page, 'https://files.cercomp.ufg.br/robots.txt', amendment]);
  assert.equal(result.passages[0]?.title, 'Retificação nº 02 do Edital PROEC nº 08/2026');
  assert.match(result.passages[0].text, /22\/10\/2026 às 17h/);
  assert.equal(result.pages[0]?.url, page);

  const plain = officialSite({ pages, pdfs });
  const notChanged = await searchOfficialPages(`Qual o prazo de envio da apresentação? ${page}`, plain.fetcher);
  assert.equal(notChanged.passages[0]?.title, 'Edital PROEC nº 08/2026 (final)');
  assert.ok(!plain.requested.some(url => url.endsWith('/sitemap.xml')));

  // Robots que bloqueia a página: nada além do robots é pedido.
  const blocked = [];
  const refused = await searchOfficialPages(page, async raw => {
    blocked.push(String(raw));
    return new Response(`User-agent: *\nDisallow: ${new URL(page).pathname}`, { headers: text });
  });
  assert.deepEqual(blocked, ['https://proex.ufg.br/robots.txt']);
  assert.equal(refused.status, 'unavailable');
  assert.deepEqual(refused.passages, []);
});

test('LINK DE PÁGINA OFICIAL: outro host, query ou redirecionamento são recusados como hoje', async () => {
  for (const pasted of ['https://proex.ufg.br.exemplo.test/p/60322-edital-proec', 'https://proex.ufg.br/p/60322-edital-proec?vazar=1', 'http://proex.ufg.br/p/60322-edital-proec']) {
    const requested = [];
    await searchOfficialPages(`Qual o prazo? ${pasted}`, async raw => {
      requested.push(String(raw));
      if (String(raw).endsWith('/robots.txt')) return new Response('User-agent: *', { headers: text });
      if (String(raw).endsWith('/sitemap.xml')) return new Response('<urlset></urlset>', { headers: xml });
      assert.fail(`pedido inesperado ${raw}`);
    });
    assert.ok(!requested.includes(pasted), `não segue ${pasted}`);
    assert.ok(requested.every(url => /^https:\/\/(?:proex\.ufg\.br|23conpeex\.plateia\.ufg\.br)\/(?:robots\.txt|sitemap\.xml)$/.test(url)));
  }
  const page = 'https://proex.ufg.br/p/60323-pagina-que-redireciona';
  const requested = [];
  const result = await searchOfficialPages(page, async raw => {
    requested.push(String(raw));
    if (String(raw).endsWith('/robots.txt')) return new Response('User-agent: *', { headers: text });
    if (String(raw) === page) return Response.redirect('https://exemplo.test/privado');
    assert.fail(`pedido inesperado ${raw}`);
  });
  assert.deepEqual(requested, ['https://proex.ufg.br/robots.txt', page]);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.pages, []);
});

test('PROBEC: edital final, aditivo e preliminar na mesma página; cada pergunta lê o documento certo e cita a página', async () => {
  const page = 'https://proex.ufg.br/p/401-edital-proec-n-05-2026-probec-2026-2027';
  const final = `${FILES}SEI_100_Edital_133.pdf`, preliminary = `${FILES}SEI_090_Edital_Preliminar.pdf`, amendment = `${FILES}SEI_110_Termo_Aditivo.pdf`;
  const site = () => officialSite({
    pages: { [page]: pageHtml('Edital PROEC nº 05/2026 · PROBEC 2026/2027', [
      [preliminary, 'Edital Preliminar PROBEC 2026/2027'], [final, 'Edital Final PROBEC 2026/2027'], [amendment, 'Termo Aditivo nº 01 ao Edital PROBEC 2026/2027'],
    ]) },
    pdfs: {
      // Como no edital real, a abertura repete o nome do programa e a palavra "bolsas": o trecho certo é o item 2.1.
      [final]: pdfWith(['EDITAL PROEC Nº 05/2026 - PROBEC 2026/2027 - VERSÃO FINAL', 'A UFG convida os interessados ao Programa de Bolsas de Extensão e Cultura', '(PROBEC 2026/2027) nos termos deste edital.', '2.1 Serão ofertadas 100 bolsas, sendo 93 para projetos e 7 para programas', 'institucionais.', '2.2 O valor da bolsa é de R$ 700,00 mensais, por 12 meses.']),
      [preliminary]: pdfWith(['EDITAL PROEC Nº 05/2026 - PROBEC 2026/2027 - VERSÃO PRELIMINAR', '2.1 Serão ofertadas 90 bolsas para projetos e programas institucionais.']),
      [amendment]: pdfWith(['TERMO ADITIVO Nº 01 AO EDITAL PROEC Nº 05/2026 - PROBEC 2026/2027', 'Onde se lê: recurso da habilitação até 15/05/2026.', 'Leia-se: o prazo de recurso da habilitação passa para 18/05/2026 às 17h.']),
    },
  });
  const ask = message => officialSearchReply(emptyDb, 'org_test', message, site().fetcher);

  const grants = await ask('quantas bolsas tem o edital do PROBEC?');
  assert.match(grants.reply, /^Edital Final PROBEC 2026\/2027 · p\. 1\nLi o PDF e o trecho está na p\. 1\.\n2\.1 Serão ofertadas 100 bolsas, sendo 93 para projetos e 7 para programas institucionais\./);
  assert.ok(grants.reply.endsWith(`${final}#page=1`));
  assert.deepEqual(grants.sources, [{ label: 'Edital Final PROBEC 2026/2027 · p. 1', href: `${final}#page=1` }]);
  assert.doesNotMatch(grants.reply, /mais de um documento possível/);

  const appeal = await ask('qual o prazo de recurso do PROBEC depois do aditivo?');
  assert.match(appeal.reply, /^Termo Aditivo nº 01 ao Edital PROBEC 2026\/2027 · p\. 1\nLi o PDF e o trecho está na p\. 1\./);
  assert.match(appeal.reply, /18\/05\/2026 às 17h/);

  const draft = await ask('edital preliminar do PROBEC');
  assert.match(draft.reply, /^Edital Preliminar PROBEC 2026\/2027 · p\. 1\nLi o PDF e o trecho está na p\. 1\./);
  assert.ok(draft.reply.endsWith(`${preliminary}#page=1`));
});

test('LEITURA: cada documento diz se o PDF foi lido, se é escaneado, se não tinha trecho ou se não abriu', async () => {
  const link = `${FILES}SEI_7_Edital_Teste.pdf`;
  const question = `Quantas bolsas tem este edital? ${link}`;
  const transport = (bytes, status = 200) => async raw => {
    if (String(raw).endsWith('/robots.txt')) return new Response('User-agent: *', { headers: text });
    if (String(raw) === link) return status === 200 ? new Response(await bytes, { headers: pdfType }) : new Response('', { status });
    assert.fail(`pedido inesperado ${raw}`);
  };
  const cases = {
    lido: [pdfWith(['Apresentação do edital sintético de extensão.'], ['2.1 Serão ofertadas 40 bolsas para projetos de extensão.'])],
    sem_texto: [pdfWith([])],
    sem_trecho: [pdfWith(['O calendário de reuniões do comitê será divulgado depois.'])],
    indisponivel: [null, 503],
  };
  const replies = {};
  for (const [state, [bytes, status]] of Object.entries(cases)) {
    const lookup = await searchOfficialPages(question, transport(bytes, status));
    if (state === 'lido') assert.equal(lookup.passages[0]?.page, 2);
    else assert.deepEqual(lookup.unreadable.map(item => item.reason), [state]);
    replies[state] = (await officialSearchReply(emptyDb, 'org_test', question, transport(bytes, status))).reply;
  }
  assert.equal(replies.lido, ['SEI 7 Edital Teste.pdf · p. 2', 'Li o PDF e o trecho está na p. 2.', '2.1 Serão ofertadas 40 bolsas para projetos de extensão.', `${link}#page=2`].join('\n'));
  assert.equal(replies.sem_texto, ['SEI 7 Edital Teste.pdf', 'Encontrei o PDF, mas ele parece ser uma imagem escaneada: não há texto que eu consiga ler. Abra o link para conferir.', link].join('\n'));
  assert.equal(replies.sem_trecho, ['SEI 7 Edital Teste.pdf', 'Li o PDF, mas não achei um trecho que responda. Abra o documento ou diga a página.', link].join('\n'));
  assert.equal(replies.indisponivel, ['SEI 7 Edital Teste.pdf', 'Encontrei o link, mas não consegui abrir o PDF agora. O link está abaixo para você conferir.', link].join('\n'));
});

test('LEITURA: página sem PDF lido deixa claro que é resumo da página, não do documento', async () => {
  const page = 'https://proex.ufg.br/p/501-edital-de-extensao-sem-anexo';
  const { fetcher } = officialSite({ pages: { [page]: pageHtml('Edital de extensão sem anexo', []) } });
  const result = await officialSearchReply(emptyDb, 'org_test', `O que diz este edital? ${page}`, fetcher);
  assert.match(result.reply, /^Edital de extensão sem anexo\nIsto é o resumo da página, não do documento: não li nenhum PDF\.\nPágina sintética do edital/);
  assert.deepEqual(result.sources, [{ label: 'Edital de extensão sem anexo', href: page }]);
});

test('VERSÃO: com duas retificações do mesmo edital, a mais recente vem primeiro e o Rolê avisa da outra', async () => {
  const page = 'https://proex.ufg.br/p/60322-edital-proec-n-08-2026-conpeex';
  const first = `${FILES}SEI_1_Termo_Aditivo.pdf`, second = `${FILES}SEI_2_Termo_Aditivo.pdf`;
  const { fetcher, requested } = officialSite({
    pages: { [page]: pageHtml('Edital PROEC nº 08/2026 · 23º CONPEEX', [
      [first, 'Retificação Nº 01 - Edital PROEC N° 08/2026 - 23° Conpeex'], [second, 'Retificação Nº 02 - Edital PROEC N° 08/2026 - 23° Conpeex'],
    ]) },
    pdfs: {
      [first]: pdfWith(['Retificação nº 01. Leia-se: o envio da apresentação vai de 07/10 a 19/10/2026, até 17h.']),
      [second]: pdfWith(['Retificação nº 02. Leia-se: o envio da apresentação vai até 22/10/2026 às 17h.']),
    },
  });
  const question = `Qual o novo prazo de envio da apresentação depois da retificação? ${page}`;
  const result = await officialSearchReply(emptyDb, 'org_test', question, fetcher);
  assert.match(result.reply, /^Encontrei mais de um documento possível: Retificação Nº 02 - Edital PROEC N° 08\/2026 - 23° Conpeex e Retificação Nº 01 - Edital PROEC N° 08\/2026 - 23° Conpeex\. Usei o mais recente; diga se quer o outro\.\n\nRetificação Nº 02 .* · p\. 1\nLi o PDF e o trecho está na p\. 1\.\n.*22\/10\/2026 às 17h/);
  assert.ok(!requested.includes(first));
});

test('REVISÃO · INTENÇÃO: operação em qualquer forma, dado do Portal e link colado com pedido de operação não viram busca', () => {
  const official = [
    'quando o resultado do edital será publicado?',
    'qual o prazo para enviar a proposta do edital PROBEC?',
    'Quando abre o edital PROBEC?',
    'quantas bolsas para projetos tem o edital do PROBEC?',
    'No portal oficial da PROEX, qual o prazo do edital de extensão?',
    'Resume isto: https://proex.ufg.br/n/60322-edital-proec-n-08-2026',
    'Qual o prazo? https://files.cercomp.ufg.br/weby/up/694/o/SEI_6045486_Edital_133.pdf',
  ];
  const portal = [
    'Cria uma demanda de divulgação da notícia https://proex.ufg.br/n/60322-edital-proec-n-08-2026',
    'Registra a entrega de 20 brindes no evento https://23conpeex.plateia.ufg.br/p/59955-programacao-geral',
    'Anexa este PDF à demanda 14: https://files.cercomp.ufg.br/weby/up/694/o/SEI_6045486_Edital_133.pdf',
    'Prepara um rascunho de demanda sobre o resultado do edital',
    'Monta a lista de entregas do edital de extensão',
    'Edita a demanda do edital PROEX',
    'Lança no portal o resultado do edital de bolsas',
    'Movimenta o estoque de kits do edital PROEX',
    'Publica o resultado do edital no mural',
    'Envia o edital 3/2026 para a coordenadora',
    'Anexa o resultado do edital à demanda 14',
    'Vincula o projeto ao edital PROEX nº 5/2026',
    'Abre uma demanda para divulgar o edital 12/2026',
    'Pode criar uma demanda sobre o edital do PROBEC?',
    'Quantos projetos do portal estão no edital 5/2026?',
    'Quais demandas estão ligadas ao edital de extensão?',
    'Quem é o responsável pelo edital de extensão no portal?',
  ];
  for (const phrase of official) assert.equal(isOfficialSearch(phrase), true, `deveria buscar: ${phrase}`);
  for (const phrase of portal) assert.equal(isOfficialSearch(phrase), false, `não deveria buscar: ${phrase}`);
});

test('REVISÃO · PÁGINA COLADA QUE NÃO ABRE: diz isso, com o link, sem cópia diária nem Instagram', async () => {
  const page = 'https://proex.ufg.br/p/60322-edital-proec-n-08-2026-conpeex';
  const noCopy = { prepare: () => assert.fail('não deve consultar a cópia diária nem o Instagram') };
  const fetcher = async raw => String(raw).endsWith('/robots.txt') ? new Response('User-agent: *', { headers: text }) : new Response('', { status: 404 });
  const result = await officialSearchReply(noCopy, 'org_test', `Qual o prazo do edital? ${page}`, fetcher);
  assert.equal(result.reply, 'Não consegui abrir a página colada agora. Abra o link para conferir.');
  assert.deepEqual(result.sources.map(source => source.href), [page]);
});

test('REVISÃO · ANO INCIDENTAL: não descarta o PDF da página colada, e datas dd/mm/aaaa não contam como ano pedido', async () => {
  const page = 'https://proex.ufg.br/p/601-edital-proec-n-05-2026-probec';
  const file = `${FILES}SEI_5_Edital_05.pdf`;
  const pasted = officialSite({
    pages: { [page]: pageHtml('Edital PROEC nº 05/2026 · PROBEC', [[file, 'Edital PROBEC nº 05/2026']]) },
    pdfs: { [file]: pdfWith(['4.1 A vigência das bolsas vai até 31/03/2027, sem prorrogação automática.']) },
  });
  const result = await searchOfficialPages(`Esse edital vale para 2027? ${page}`, pasted.fetcher);
  assert.equal(result.passages[0]?.title, 'Edital PROBEC nº 05/2026');

  const older = 'https://proex.ufg.br/p/201-edital-probec-2025-2026', newer = 'https://proex.ufg.br/p/202-edital-probec-2026-2027';
  const oldPdf = `${FILES}probec-2025.pdf`, newPdf = `${FILES}probec-2026.pdf`;
  const { fetcher } = officialSite({
    pages: { [older]: pageHtml('Edital PROBEC 2025/26', [[oldPdf, 'Edital PROBEC 2025/26']]), [newer]: pageHtml('Edital PROBEC 2026/27', [[newPdf, 'Edital PROBEC 2026/27 (final)']]) },
    pdfs: { [oldPdf]: pdfWith(['3.1 O prazo de inscrição do ciclo anterior terminou em 20/11/2025.']), [newPdf]: pdfWith(['3.1 O prazo de inscrição do ciclo atual vai até 20/11/2027.']) },
  });
  const dated = await officialSearchReply(emptyDb, 'org_test', 'O prazo de inscrição de 20/11/2027 vale para o edital do PROBEC?', fetcher);
  assert.match(dated.reply, /^Encontrei mais de um documento possível: Edital PROBEC 2026\/27 \(final\) e Edital PROBEC 2025\/26\./);
});

test('REVISÃO · TEXTO EXTERNO: controle e formatação saem dos títulos; a escolha vai ao modelo como dado', async () => {
  const page = 'https://proex.ufg.br/p/701-edital-probec-2026-2027';
  const older = 'https://proex.ufg.br/p/700-edital-probec-2025-2026';
  const file = `${FILES}probec-2026.pdf`, oldFile = `${FILES}probec-2025.pdf`;
  const site = () => officialSite({
    pages: {
      [page]: pageHtml('Edital​ PROBEC\u0007 2026/27', [[file, 'Edital‮ PROBEC 2026/27 (final)']]),
      [older]: pageHtml('Edital PROBEC 2025/26', [[oldFile, 'Edital PROBEC 2025/26']]),
    },
    pdfs: { [file]: pdfWith(['2.1 Serão ofertadas 100 bolsas para projetos de extensão.']), [oldFile]: pdfWith(['2.1 Serão ofertadas 80 bolsas para projetos de extensão.']) },
  });
  const pasted = await searchOfficialPages(page, site().fetcher);
  assert.equal(pasted.pages[0].title, 'Edital PROBEC 2026/27');
  assert.equal(pasted.passages[0].title, 'Edital PROBEC 2026/27 (final)');
  const tool = await runRoleTool(emptyDb, null, 'org_test', 'consultar_fontes_oficiais', { texto: 'quantas bolsas tem o edital do PROBEC?' }, undefined, null, site().fetcher);
  assert.deepEqual(JSON.parse(tool.content).escolha, { usado: 'Edital PROBEC 2026/27 (final)', outro: 'Edital PROBEC 2025/26' });
});

test('REVISÃO · LINK DE PÁGINA: /P/ ou slug em maiúscula é recusado; "?" vazio é removido', () => {
  assert.equal(officialPageUrl('https://proex.ufg.br/P/60322-edital-proec'), null);
  assert.equal(officialPageUrl('https://proex.ufg.br/N/60322-edital-proec'), null);
  assert.equal(officialPageUrl('https://proex.ufg.br/p/60322-Edital-proec'), null);
  assert.equal(officialPageUrl('https://proex.ufg.br/p/60322-edital-proec?')?.href, 'https://proex.ufg.br/p/60322-edital-proec');
  assert.equal(officialPageUrl('https://proex.ufg.br/p/60322-edital-proec?a=1'), null);
});

test('REVISÃO · LEITURA: PDF só com carimbo é sem_texto; robots que bloqueia o PDF tem estado e texto próprios', async () => {
  const link = `${FILES}SEI_7_Edital_Teste.pdf`;
  const question = `Quantas bolsas tem este edital? ${link}`;
  const stamp = await stampPdf('Documento assinado eletronicamente por Pessoa Sintética.');
  const stamped = async raw => String(raw).endsWith('/robots.txt') ? new Response('User-agent: *', { headers: text }) : new Response(stamp, { headers: pdfType });
  assert.deepEqual((await searchOfficialPages(question, stamped)).unreadable.map(item => item.reason), ['sem_texto']);

  const requested = [];
  const blocked = async raw => {
    requested.push(String(raw));
    return new Response(`User-agent: *\nDisallow: ${new URL(link).pathname}`, { headers: text });
  };
  assert.deepEqual((await searchOfficialPages(question, blocked)).unreadable.map(item => item.reason), ['bloqueado']);
  assert.deepEqual(requested, ['https://files.cercomp.ufg.br/robots.txt']);
  const reply = await officialSearchReply(emptyDb, 'org_test', question, blocked);
  assert.equal(reply.reply, ['SEI 7 Edital Teste.pdf', 'Encontrei o PDF, mas o site não permite leitura automática dele. Abra o link para conferir.', link].join('\n'));
});

test('TELA · MODO: chat indisponível com busca disponível abre só a busca; a alternância manda a pergunta à busca', async () => {
  const { roleComposerMode, officialRoute } = await import(compile('assistant/official-search-intent'));
  assert.equal(roleComposerMode(null), 'off');
  assert.equal(roleComposerMode({ available: true, policy: { publicSearch: false } }), 'chat');
  assert.equal(roleComposerMode({ available: false, policy: { publicSearch: true } }), 'search');
  assert.equal(roleComposerMode({ available: false, policy: { publicSearch: false } }), 'off');
  assert.equal(roleComposerMode({ available: false }), 'off', 'status sem política (Rolê não configurado) continua desligado');
  const plain = 'Como registro a entrega de brindes?', notice = 'Quais editais de extensão estão abertos?';
  const base = { mode: 'chat', toggled: false, publicSearch: true, attachment: false };
  assert.deepEqual(officialRoute({ ...base, text: plain }), { official: false, explicit: false });
  assert.deepEqual(officialRoute({ ...base, text: notice }), { official: true, explicit: false }, 'o reconhecimento automático continua');
  assert.deepEqual(officialRoute({ ...base, toggled: true, text: plain }), { official: true, explicit: true });
  assert.deepEqual(officialRoute({ ...base, toggled: true, attachment: true, text: plain }), { official: false, explicit: false }, 'com anexo não vai à busca');
  assert.deepEqual(officialRoute({ ...base, toggled: true, publicSearch: false, text: notice }), { official: false, explicit: false });
  assert.deepEqual(officialRoute({ ...base, mode: 'search', text: plain }), { official: true, explicit: true }, 'só a busca disponível: todo envio é busca');
  assert.deepEqual(officialRoute({ ...base, mode: 'off', toggled: true, text: notice }), { official: false, explicit: false });
});

test('TELA · COMPOSITOR: alternância "Fontes oficiais" com estado visível, pedido explícito e aviso de só busca', () => {
  const tsx = readFileSync(`${root}components/portal/role-assistant.tsx`, 'utf8');
  const css = readFileSync(`${root}components/portal/role-assistant.module.css`, 'utf8');
  assert.match(tsx, /<button type="button" className=\{styles\.officialToggle\} aria-pressed=\{officialMode\} aria-label="Fontes oficiais: buscar nas páginas da PROEX"[^>]*>/);
  assert.match(tsx, /\{officialMode \? <Check size=\{18\} aria-hidden="true"\/> : <Landmark size=\{18\} aria-hidden="true"\/>\}Fontes oficiais<\/button>/);
  assert.match(tsx, /\.\.\.\(route\.explicit \? \{ officialSearch: true \} : \{ consent: true \}\)/, 'pedido explícito vai sem ciência de IA; a conversa continua com ela');
  assert.match(tsx, /history: encodedVideo \|\| officialLookup \|\| document \? \[\] : history/, 'busca segue sem histórico');
  assert.match(tsx, /acceptedCostMicros: officialLookup \|\| !estimate \? 0 : estimate\.costMicros/);
  assert.match(tsx, /Consulta às fontes oficiais, <span className=\{styles\.nowrap\}>sem custo de IA\.<\/span>/);
  assert.match(tsx, /aria-label=\{officialLookup \? 'Enviar para as fontes oficiais'/, 'o nome acessível contém o texto visível "Enviar"');
  assert.doesNotMatch(tsx, /'Consultar fontes oficiais'/);
  assert.match(tsx, /\{searchOnly \|\| officialLookup \? 'O Rolê pode errar\. Confira no link da fonte antes de usar\.' :/, 'sem "Respondido por" na busca');
  assert.match(tsx, /<p className=\{styles\.searchOnlyNotice\} role="note">Por enquanto, o Rolê só procura nas páginas oficiais da PROEX\. A conversa com IA está desligada\.<\/p>/);
  // A sonda do botão conta a busca; a conversa só é apagada quando a conversa com IA deixa de existir.
  assert.match(tsx, /setReady\(roleComposerMode\(next\) !== 'off'\)/);
  assert.match(tsx, /if \(previousMode\.current === 'chat' && nextMode !== 'chat'\) resetConversation\(\);\s*previousMode\.current = nextMode;/);
  assert.match(tsx, /\{status && mode === 'off' && <div className=\{styles\.unavailable\}/);
  // Sem botão visível, sem busca invisível ligada.
  assert.match(tsx, /if \(nextMode !== 'chat' \|\| !next\.policy\?\.publicSearch\) setOfficialMode\(false\);/);
  assert.match(tsx, /cause\.code === 'role_official_disabled'\) \{\s*\/\/[^\n]*\n\s*setOfficialMode\(false\);/);
  // "Procurar em" não vale para a busca: some no modo só busca e trava com o botão ligado.
  assert.match(tsx, /\{!searchOnly && <label className=\{styles\.project\}><span>Procurar em<\/span><select value=\{scopeValue\} disabled=\{officialOn \|\| busy/);
  // Botão ligado esmaece todos os anexos e a voz.
  assert.match(tsx, /disabled=\{!status\.speech\.available \|\| officialOn \|\| !consent/);
  assert.match(tsx, /<input type="file" accept="\.wav,audio\/wav" disabled=\{officialOn \|\| !consent/);
  assert.match(tsx, /'Muitas buscas seguidas\. Espere um minuto e tente de novo\.'/);
  assert.match(tsx, /data-search-only=\{searchOnly \? true : undefined\}/);
  // Toque de 44 px, ligado sem parecer um segundo Enviar, bordas com contraste e tema escuro.
  assert.match(css, /\.officialToggle\{[^}]*min-height:44px[^}]*padding:0 \.6rem/);
  assert.match(css, /\.officialToggle\[aria-pressed=true\]\{background:#efe6f6;border:2px solid var\(--purple\);color:var\(--purple\)\}/);
  assert.match(css, /:global\(html\[data-theme=dark\]\) \.officialToggle\[aria-pressed=true\]\{background:#3a2850;border-color:#b48ad6;color:#f2ebf8\}/);
  assert.match(css, /\.dialog\{--role-control-border:#8e7aa0\}/);
  assert.match(css, /:global\(html\[data-theme=dark\]\) \.dialog\{--role-control-border:#8a6ba0\}/);
  assert.match(css, /\.iconButton,\.officialToggle\{border-color:var\(--role-control-border\)\}/);
  assert.match(css, /\.searchOnlyNotice\{[^}]*border-left:4px solid/);
  assert.match(css, /@container \(max-width:390px\)\{\.composer\[data-search-only\] \.cost\{flex-basis:auto;order:0\}\}/);
});
