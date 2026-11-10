import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { fontBytes, load, marks, zipEntries } from './support/project-report-module.mjs';

const markdown = await load('components/portal/management/markdown.ts');
const starter = await load('lib/management/guide-starter.ts');
const ooxml = await load('components/portal/project-report/ooxml.ts');
const pdfModule = await load('components/portal/project-report/pdf.ts');

test('the guide markdown keeps structure and never produces unsafe links', () => {
  const blocks = markdown.parseMarkdown('# Título\n\n## Seção\n\nTexto com **negrito**, _itálico_ e [site](https://proex.ufg.br) e [ruim](javascript:alert(1)).\n\n- item\n  - subitem\n1. primeiro');
  assert.deepEqual(blocks.map(block => block.type), ['h1', 'h2', 'p', 'list', 'list']);
  const inline = blocks[2].inline;
  assert.ok(inline.some(part => part.bold && part.text === 'negrito'));
  assert.ok(inline.some(part => part.italic && part.text === 'itálico'));
  assert.equal(inline.find(part => part.text === 'site').href, 'https://proex.ufg.br/');
  assert.equal(inline.find(part => part.text === 'ruim').href, undefined);
  assert.deepEqual(blocks[3].items.map(item => item.depth), [0, 1]);
  assert.equal(blocks[4].ordered, true);
});

test('every starter page cites sources and only uses known live blocks; no secrets or private notes', () => {
  assert.equal(starter.GUIDE_STARTER.length, 11);
  for (const page of starter.GUIDE_STARTER) {
    for (const [, name] of page.body.matchAll(/\{\{([a-z-]+)\}\}/g)) assert.ok(starter.LIVE_BLOCKS.includes(name), `${page.slug}: ${name}`);
    if (!['calendario'].includes(page.slug)) assert.match(page.body, /Fontes?:/, page.slug);
    assert.doesNotMatch(page.body, /bolsa de|R\$|CPF|senha|token|drive\.google\.com|@gmail/i, page.slug);
  }
  assert.ok(starter.GUIDE_STARTER.some(page => /_a confirmar_/.test(page.body)));
});

test('the whole guide exports to real DOCX and PDF with the guide cover, contents and numbering', async () => {
  const pages = starter.GUIDE_STARTER.map(page => ({ slug: page.slug, title: page.title, sectionLabel: starter.GUIDE_SECTION_LABEL[page.section], markdown: page.body.replace(/\{\{[a-z-]+\}\}/g, '- bloco vivo sintético'), updatedAt: null, updatedBy: '', version: 0 }));
  const doc = markdown.guideDocument('PROEX UFG', pages, new Date('2026-11-09T15:00:00Z'));
  assert.equal(doc.sections.length, 11);
  assert.equal(doc.kicker, 'Guia da organização');
  const docx = await zipEntries(ooxml.toReportDocx(doc));
  const body = docx.get('word/document.xml');
  assert.match(body, /GUIA DA ORGANIZAÇÃO/); assert.match(body, /Guia da PROEX UFG/); assert.match(body, /w:name="secao_11"/);
  assert.match(body, /w:pStyle w:val="Heading2"/);
  const bytes = new Uint8Array(await (await pdfModule.toReportPdf(doc, { fontBytes, marks })).arrayBuffer());
  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getTitle(), 'Guia da PROEX UFG — Como a organização funciona');
  assert.ok(parsed.getPageCount() >= 4);
});
