import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { brandBytes, fontBytes, reportExport, reportPdf, zipEntries } from './support/report-module.mjs';

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
  const blob = await reportPdf.toPdf('Saídas de materiais institucionais', columns, source, display, info, { fontBytes, brandBytes });
  assert.equal(blob.type, 'application/pdf');
  const bytes = new Uint8Array(await blob.arrayBuffer()); assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getTitle(), 'Saídas de materiais institucionais'); assert.ok(parsed.getPageCount() > 1);
  assert.ok(bytes.length > 1000);
  assert.equal(parsed.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict).keys().length, 2);
});

async function readPdfPages(blob) {
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true, disableFontFace: true });
  try {
    const document = await task.promise;
    return await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
      const page = await document.getPage(index + 1);
      return (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
    }));
  } finally { await task.destroy(); }
}

test('PDF keeps a table heading with its first row and terminates when one row exceeds a full page',async()=>{
 const longColumns=[{key:'name',label:'Registro'},{key:'details',label:'Conteúdo'}],source=[{name:'PRIMEIRA LINHA ALTA',details:'Conteúdo conferido da extensão. '.repeat(260)+' FIM DA LINHA ALTA'},{name:'SEGUNDA LINHA FINAL',details:'Texto conferido final.'}];
 const blob=await reportPdf.toPdf('Paginação com linha alta',longColumns,source,(row,key)=>row[key],Array.from({length:12},(_,i)=>['Contexto '+i,'Metadado de recorte conferido '.repeat(2)]),{fontBytes,brandBytes,presentation:{columnWeights:[1,2]}});
 const pages=await readPdfPages(blob);assert.ok(pages.length>=2&&pages.length<20);const all=pages.join(' ');assert.match(all,/FIM DA LINHA ALTA/);assert.match(all,/SEGUNDA LINHA FINAL/);
 for(const page of pages)if(page.includes('Registros do relatório'))assert.match(page,/PRIMEIRA LINHA ALTA|Conteúdo conferido|FIM DA LINHA ALTA|SEGUNDA LINHA FINAL/);
});

test('PDF column weights reject missing non-finite negative and unbalanced values instead of shrinking unreadable columns',async()=>{
 for(const columnWeights of [[1],[1,NaN,1,1],[1,-1,1,1],[.5,4,.5,.5]])await assert.rejects(reportPdf.toPdf('Pesos inválidos',columns,rows,display,info,{fontBytes,brandBytes,presentation:{columnWeights}}),/larguras de colunas equilibradas/);
});

test('project PDF contains its scoped title, exact metrics, missing fields and no unselected data', async () => {
  const projectName = 'Rolê da Extensão';
  const secret = 'contato-restrito@example.test';
  const blob = await reportPdf.toPdf('Projetos e ações', [
    { key: 'projeto', label: 'Projeto' }, { key: 'unidade_sigla', label: 'Unidade' },
    { key: 'materiais', label: 'Materiais', numeric: true },
  ], [{ projeto: projectName, unidade_sigla: null, materiais: 0, contato: secret }], display, [
    ['Relatório', 'Projetos e ações'], ['Recorte', projectName], ['Período', 'Todo o período'],
    ['Linhas', '1'], ['Gerado em', '04/11/2026 (Brasília)'],
  ], { fontBytes, brandBytes, presentation: { projectName, projectBrand: 'role-da-extensao', metrics: [
    { label: 'Materiais', value: 0 }, { label: 'Eventos', value: null },
  ] } });
  const pages = await readPdfPages(blob);
  assert.equal(pages.length, 1);
  const page = pages[0].replace(/\s+/g, ' ');
  assert.match(page, /FICHA DO PROJETO Rolê da Extensão/);
  assert.match(page, /0 Materiais .* Eventos Não informado/);
  assert.match(page, /Dados do projeto .* Unidade Não informado Materiais 0/);
  assert.match(page, /Página 1 de 1/);
  assert.ok(!page.includes(secret));
  const pdf = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(pdf.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict).keys().length, 3);
});

test('a long labeled field continues across pages and preserves selected data at both ends', async () => {
  const long = 'INÍCIO DO CONTEÚDO ' + 'Linha de conferência detalhada. '.repeat(260) + 'FINAL DO CONTEÚDO';
  const blob = await reportPdf.toPdf('Conferência da equipe', [
    { key: 'registro', label: 'Observação' }, { key: 'fim', label: 'Etapa' },
  ], [{ registro: long, fim: 'Concluída' }], display, info,
  { fontBytes, brandBytes, presentation: { projectName: 'Projeto fictício' } });
  const pages = await readPdfPages(blob);
  assert.ok(pages.length > 1);
  assert.match(pages[0], /INÍCIO DO CONTEÚDO/);
  assert.match(pages.at(-1), /FINAL DO CONTEÚDO/);
  assert.match(pages.at(-1), /Dados do projeto \(continuação\)/);
  assert.match(pages.at(-1), /Concluída/);
});

test('a typical CONPEEX fiche with a long title and official mark fits one A4 page', async () => {
  const projectName = '23º CONPEEX — Congresso de Pesquisa, Ensino e Extensão';
  const fields = ['Projeto', 'Unidade', 'Área temática', 'Modalidade', 'Abrangência', 'Etapa', 'Materiais', 'Eventos', 'Empréstimos', 'Registros'];
  const row = Object.fromEntries(fields.map((label, index) => [label, [projectName, '', null, 'Evento', 'Interno PROEX', 'Em andamento', 12, 5, 0, 3][index]]));
  const blob = await reportPdf.toPdf('Projetos e ações', fields.map(label => ({ key: label, label })), [row], display, [
    ['Recorte', projectName], ['Período', 'Todo o período'], ['Gerado em', '04/11/2026 (Brasília)'], ['Fonte', 'Dados sintéticos de homologação'],
  ], { fontBytes, brandBytes, presentation: {
    projectName, projectBrand: 'conpeex-2026', metrics: fields.slice(6).map(label => ({ label, value: row[label] })),
  } });
  const pdf = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 595.28, height: 841.89 });
  assert.equal(pdf.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict).keys().length, 3);
  assert.match((await readPdfPages(blob))[0], /Empréstimos\s+0\s+Registros\s+3/);
});

test('document limits reject excess data before rendering or fetching any resource', async () => {
  const excess = Array.from({ length: 2001 }, () => rows[0]);
  assert.throws(() => reportExport.toDocx('Relatório', columns, excess, display, info), /2\.000/);
  await assert.rejects(reportPdf.toPdf('Relatório', columns, excess, display, info), /2\.000/);
  assert.throws(() => reportExport.documentRows(columns, [{ material: 'x'.repeat(500001) }], display), /extenso/);
  assert.throws(() => reportExport.documentRows([], rows, display), /selecione colunas/);
});
