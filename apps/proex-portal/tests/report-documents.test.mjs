import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { fontBytes, reportExport, reportPdf, zipEntries } from './support/report-module.mjs';

const columns = [{ key: 'material', label: 'Material' }, { key: 'project', label: 'Projeto' }, { key: 'quantity', label: 'Quantidade', numeric: true }, { key: 'unit', label: 'Unidade' }];
const rows = [{ material: 'Caixa de som & projeção', project: 'Extensão e cultura', quantity: 3, unit: 'unidade', contact: 'nunca-exportar@example.test' }];
const display = (row, key) => row[key];
const info = [['Período', '01/10/2026 a 31/10/2026'], ['Recorte', 'Projeto fictício']];

test('DOCX is a real Word package with selected values, repeating headers and escaped text only', async () => {
  const blob = reportExport.toDocx('Materiais institucionais', columns, rows, display, info), entries = await zipEntries(blob);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(entries.has('[Content_Types].xml')); assert.ok(entries.has('word/styles.xml'));
  const body = entries.get('word/document.xml');
  assert.match(body, /w:pStyle w:val="Title"/); assert.match(body, /Caixa de som &amp; projeção/);
  assert.match(body, /Extensão e cultura/); assert.match(body, /01\/10\/2026 a 31\/10\/2026/);
  assert.match(body, /<w:tblHeader\/>/); assert.match(body, /<w:pgSz w:w="12240" w:h="15840"/);
  assert.doesNotMatch([...entries.values()].join(''), /nunca-exportar|https?:\/\/nunca/);
});

test('wide documents retain every field in labeled records without an unreadable wide table', async () => {
  const wide = Array.from({ length: 9 }, (_, index) => ({ key: `field${index}`, label: `Campo ${index}` }));
  const source = [Object.fromEntries(wide.map((column, index) => [column.key, `Valor ${index} ação <texto>`]))];
  const entries = await zipEntries(reportExport.toDocx('Detalhamento', wide, source, display, info));
  const body = entries.get('word/document.xml');
  assert.match(body, /Registro 1/); assert.doesNotMatch(body, /<w:tbl>/);
  for (let index = 0; index < 9; index++) assert.ok(body.includes(`Valor ${index} ação &lt;texto&gt;`));
});

test('PDF retains Unicode text in an embedded font and paginates long data as a valid document', async () => {
  const source = Array.from({ length: 80 }, (_, index) => ({ ...rows[0], material: `Material ${index} · ação, informação e extensão ${'descrição '.repeat(8)}` }));
  const blob = await reportPdf.toPdf('Saídas de materiais institucionais', columns, source, display, info, { fontBytes });
  assert.equal(blob.type, 'application/pdf');
  const bytes = new Uint8Array(await blob.arrayBuffer()); assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getTitle(), 'Saídas de materiais institucionais'); assert.ok(parsed.getPageCount() > 1);
  assert.ok(bytes.length > 1000);
});

test('document limits reject excess data before rendering or fetching any resource', async () => {
  const excess = Array.from({ length: 2001 }, () => rows[0]);
  assert.throws(() => reportExport.toDocx('Relatório', columns, excess, display, info), /2\.000/);
  await assert.rejects(reportPdf.toPdf('Relatório', columns, excess, display, info), /2\.000/);
  assert.throws(() => reportExport.documentRows(columns, [{ material: 'x'.repeat(500001) }], display), /extenso/);
  assert.throws(() => reportExport.documentRows([], rows, display), /selecione colunas/);
});
