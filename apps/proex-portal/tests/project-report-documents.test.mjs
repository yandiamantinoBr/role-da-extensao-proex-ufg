import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fontBytes, load, marks, syntheticReportData, zipEntries } from './support/project-report-module.mjs';

const config = await load('lib/project-report-config.ts');
const documents = await load('components/portal/project-report/document.ts');
const ooxml = await load('components/portal/project-report/ooxml.ts');
const pdfModule = await load('components/portal/project-report/pdf.ts');
const now = new Date('2026-11-09T15:00:00.000Z');
const full = { ...config.defaultReportConfig(), title: 'Relatório sintético', sections: config.REPORT_SECTION_IDS.map(id => ({ id, on: true })), notes: 'Primeira observação da equipe.\n\nSegunda observação, com acentuação: ação e extensão.', sectionNotes: { demands: 'A equipe priorizou o estande na semana do evento.', timeline: 'A oficina de outubro concentrou a maior parte das entregas.' } };
// PROEX_REPORT_OUT=<pasta> grava os três arquivos para abrir de verdade (conferência manual).
const out = process.env.PROEX_REPORT_OUT;
const save = async (name, blob) => { if (out) { mkdirSync(out, { recursive: true }); writeFileSync(`${out}/${name}`, Buffer.from(await blob.arrayBuffer())); } };

test('the document keeps the chosen order, numbers sections and always ends with references', () => {
  const order = ['notes', 'summary', 'references', 'timeline'];
  const chosen = config.normalizeReportConfig({ ...full, sections: order.map(id => ({ id, on: true })) });
  const doc = documents.buildReportDocument(syntheticReportData(), chosen, now);
  assert.deepEqual(doc.sections.map(section => [section.number, section.id]), [[1, 'notes'], [2, 'summary'], [3, 'timeline'], [4, 'references']]);
  assert.equal(doc.sections.at(-1).blocks[0].kind, 'references');
  assert.deepEqual(doc.sections.at(-1).blocks[0].items.map(item => item.type), ['Link', 'Planilha', 'Documento']);
  assert.equal(doc.sections[0].blocks[0].kind, 'callout');
  assert.match(documents.blockText(doc.sections[0].blocks[0]), /Primeira observação[\s\S]*Segunda observação/);
});

test('sections without permission disappear from the document and are listed only for the screen', () => {
  const data = syntheticReportData();
  data.sections.materials = null; data.sections.history = null; data.sections.loans = null;
  const doc = documents.buildReportDocument(data, config.normalizeReportConfig(full), now);
  assert.deepEqual(doc.unavailable, ['Materiais e movimentações', 'Empréstimos', 'Históricos e versões do cadastro']);
  assert.ok(!doc.sections.some(section => ['materials', 'loans', 'history'].includes(section.id)));
  const timeline = doc.sections.find(section => section.id === 'timeline').blocks[0];
  assert.doesNotMatch(documents.blockText(timeline), /Cadastro corrigido|Mostra sintética|versão 2/);
});

test('demand chart counts created and completed per month and the period filters the timeline', () => {
  const doc = documents.buildReportDocument(syntheticReportData(), config.normalizeReportConfig(full), now);
  const chart = doc.sections.find(section => section.id === 'demands').blocks.find(block => block.kind === 'chart');
  assert.deepEqual(chart.categories, ['ago/26', 'set/26', 'out/26']);
  assert.deepEqual(chart.series.map(series => series.values.reduce((sum, value) => sum + value, 0)), [14, 4]);
  const data = syntheticReportData({ period: { from: '2026-10-01', to: '2026-10-31' } });
  const october = documents.buildReportDocument(data, config.normalizeReportConfig({ ...full, period: { mode: 'month', month: '2026-10' } }), now);
  const items = october.sections.find(section => section.id === 'timeline').blocks[0].items;
  assert.ok(items.length > 0 && items.every(item => item.month === 'Outubro de 2026' && (!item.date || item.date.endsWith('/10/2026'))));
  assert.equal(october.period, 'outubro de 2026');
});

test('template validation rejects unknown sections and broken periods and keeps references last', () => {
  assert.throws(() => config.normalizeReportConfig({ ...full, sections: [{ id: 'secret', on: true }] }), /não é reconhecida/);
  assert.throws(() => config.normalizeReportConfig({ ...full, period: { mode: 'range', from: '2026-10-10', to: '2026-10-01' } }), /período válido/);
  assert.throws(() => config.normalizeReportConfig({ ...full, notes: 'x'.repeat(config.REPORT_NOTES_LIMIT + 1) }), /observações/);
  const normalized = config.normalizeReportConfig({ title: ' Mensal ', sections: [{ id: 'references', on: true }, { id: 'summary', on: true }], period: { mode: 'month', month: '2026-02' } });
  assert.equal(normalized.title, 'Mensal');
  assert.equal(normalized.sections.at(-1).id, 'references');
  assert.equal(normalized.sections.length, config.REPORT_SECTION_IDS.length);
  assert.deepEqual(config.periodRange(normalized.period), { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(config.referenceType('https://docs.google.com/document/d/x/edit'), 'document');
  assert.equal(config.referenceType('https://example.org/dados.xlsx'), 'spreadsheet');
});

test('DOCX has cover, linked contents, numbered headings, a native chart, page numbers and references at the end', async () => {
  const doc = documents.buildReportDocument(syntheticReportData(), config.normalizeReportConfig(full), now);
  const blob = ooxml.toReportDocx(doc), entries = await zipEntries(blob);
  await save('relatorio-sintetico.docx', blob);
  const body = entries.get('word/document.xml');
  assert.match(body, /RELATÓRIO DO PROJETO/); assert.match(body, /Sumário/);
  assert.match(body, /w:anchor="secao_1"/); assert.match(body, /w:name="secao_11"/);
  assert.ok(body.indexOf('11. Referências') > body.indexOf('10. Observações'));
  assert.match(body, /c:chart [^>]*r:id="rId\d+"/); assert.ok(entries.has('word/charts/chart1.xml'));
  assert.match(entries.get('word/charts/chart1.xml'), /<c:barChart>.*Criadas.*Concluídas/s);
  assert.match(entries.get('word/footer.xml'), /PAGE.*NUMPAGES/s);
  assert.match(entries.get('word/_rels/document.xml.rels'), /Target="https:\/\/example\.org\/plano\.pdf" TargetMode="External"/);
  assert.match(body, /conferir brindes &amp; ação/);
  assert.match(body, /A equipe priorizou o estande na semana do evento\./);
  assert.match(body, /A oficina de outubro concentrou/);
});

test('XLSX has a cover with linked contents, one numbered sheet per section, native charts and safe formulas', async () => {
  const doc = documents.buildReportDocument(syntheticReportData(), config.normalizeReportConfig(full), now);
  const blob = ooxml.toReportXlsx(doc), entries = await zipEntries(blob);
  await save('relatorio-sintetico.xlsx', blob);
  const workbook = entries.get('xl/workbook.xml');
  assert.match(workbook, /<sheet name="Capa"/); assert.match(workbook, /name="1 Resumo"/); assert.match(workbook, /name="11 Referências"/);
  assert.match(entries.get('xl/worksheets/sheet1.xml'), /location="'3 Demandas'!A1"/);
  assert.ok([...entries.keys()].some(name => /^xl\/charts\/chart\d+\.xml$/.test(name)));
  assert.match([...entries.entries()].find(([name]) => name.startsWith('xl/charts/'))[1], /<c:f>'3 Demandas'!\$A\$\d+:\$A\$\d+<\/c:f>/);
  const materials = entries.get(`xl/worksheets/sheet${doc.sections.findIndex(section => section.id === 'materials') + 2}.xml`);
  assert.match(materials, /'=SOMA\(A1\)/);
  assert.match(entries.get('xl/worksheets/sheet12.xml'), /<hyperlinks>/);
});

test('PDF has cover, contents with real page numbers, numbered pages and clickable references', async () => {
  const doc = documents.buildReportDocument(syntheticReportData(), config.normalizeReportConfig(full), now);
  const blob = await pdfModule.toReportPdf(doc, { fontBytes, marks });
  await save('relatorio-sintetico.pdf', blob);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getTitle(), 'Relatório sintético — Projeto Sintético de Extensão');
  const pdf = await getDocument({ data: bytes, useSystemFonts: false, disableFontFace: true }).promise;
  const pageText = async number => (await (await pdf.getPage(number)).getTextContent()).items.map(item => item.str).join(' ');
  assert.match(await pageText(1), /RELATÓRIO DO PROJETO/);
  const contents = await pageText(2);
  assert.match(contents, /Sumário/); assert.match(contents, /11\.\s+Referências/);
  const lastPage = await pageText(pdf.numPages);
  assert.match(lastPage, new RegExp(`Página ${pdf.numPages} de ${pdf.numPages}`));
  assert.match(lastPage, /\[3\] Plano de trabalho fictício/);
  // O número do sumário aponta para a página onde a seção começa.
  const match = contents.match(/1\.\s+Resumo[ .]*?(\d+)/);
  assert.ok(match, contents);
  assert.match(await pageText(Number(match[1])), /Resumo/);
  const annotations = await (await pdf.getPage(pdf.numPages)).getAnnotations();
  assert.ok(annotations.some(annotation => annotation.url === 'https://example.org/plano.pdf'));
});

test('a reference URL with parentheses or a non-web scheme cannot break the PDF link or reach the documents', async () => {
  const data = syntheticReportData();
  data.sections.references.rows = [
    { titulo: 'Link com parênteses', url: 'https://example.org/x)/S/JavaScript/JS(app.alert(1)', origem: 'Links e documentos', tipo: 'link' },
    { titulo: 'Script', url: 'javascript:alert(1)', origem: 'Links e documentos', tipo: 'link' },
  ];
  const doc = documents.buildReportDocument(data, config.normalizeReportConfig({ ...full, sections: [{ id: 'references', on: true }] }), now);
  assert.deepEqual(doc.sections[0].blocks[0].items.map(item => item.title), ['Link com parênteses']);
  const bytes = Buffer.from(await (await pdfModule.toReportPdf(doc, { fontBytes, marks })).arrayBuffer());
  const parsed = await PDFDocument.load(bytes);
  const actions = parsed.context.enumerateIndirectObjects().map(([, object]) => String(object)).filter(text => text.includes('/URI'));
  assert.ok(actions.length >= 1 && actions.every(text => !/\/S \/JavaScript|\/JS \(/.test(text)), actions.join(' | '));
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true }).promise;
  const links = (await (await pdf.getPage(pdf.numPages)).getAnnotations()).filter(annotation => annotation.url);
  assert.deepEqual(links.map(annotation => annotation.url), ['https://example.org/x%29/S/JavaScript/JS%28app.alert%281%29']);
  assert.doesNotMatch(JSON.stringify(doc), /javascript:/);
});

test('team remarks close their section, chosen references stay out, history reads in plain words and busy days are grouped', () => {
  const data = syntheticReportData();
  data.sections.demands.rows.forEach(row => { row.data = '2026-10-20'; row.concluida_em = null; });
  const chosen = config.normalizeReportConfig({ ...full, timeline: 'all', sectionNotes: { demands: 'A equipe priorizou o estande.' }, excludedReferences: ['https://example.org/plano.pdf'] });
  const doc = documents.buildReportDocument(data, chosen, now);
  const demands = doc.sections.find(section => section.id === 'demands');
  assert.deepEqual(demands.blocks.at(-1), { kind: 'callout', title: 'Observação da equipe', text: 'A equipe priorizou o estande.' });
  assert.deepEqual(doc.sections.at(-1).blocks[0].items.map(item => item.title), ['Página oficial do projeto', 'Planilha fictícia']);
  const history = doc.sections.find(section => section.id === 'history').blocks[0];
  assert.deepEqual(history.columns.map(column => column.label), ['Data', 'Item', 'Versão', 'O que mudou', 'Por']);
  assert.equal(history.rows[0][3], 'Alterou: Descrição e Local');
  assert.equal(history.rows[1][3], 'Cadastro criado');
  const timeline = doc.sections.find(section => section.id === 'timeline').blocks[0];
  const busy = timeline.items.filter(item => item.date === '20/10/2026' && item.tag === 'Demanda');
  assert.equal(busy.length, 1);
  assert.match(busy[0].title, /^14 demandas criadas$/);
  assert.equal(timeline.items.find(item => item.date === '20/10/2026').month, 'Outubro de 2026');
  const milestones = documents.buildReportDocument(data, config.normalizeReportConfig({ ...full }), now).sections.find(section => section.id === 'timeline').blocks[0];
  assert.deepEqual(milestones.items.filter(item => item.tag === 'Demandas').map(item => [item.date, item.month, item.title]), [['', 'Outubro de 2026', 'Demandas no mês: 14 criadas']]);
  assert.ok(!milestones.items.some(item => item.tag === 'Demanda'));
  assert.throws(() => config.normalizeReportConfig({ ...full, sectionNotes: { inventada: 'x' } }), /não é reconhecida/);
  assert.throws(() => config.normalizeReportConfig({ ...full, sectionNotes: { demands: 'x'.repeat(config.REPORT_SECTION_NOTE_LIMIT + 1) } }), /até/);
});
