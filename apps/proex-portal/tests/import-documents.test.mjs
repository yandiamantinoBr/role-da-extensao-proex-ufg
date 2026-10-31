import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = fileURLToPath(new URL('../', import.meta.url)), cache = new Map();
function compile(name) {
  if (cache.has(name)) return cache.get(name);
  let code = ts.transpileModule(readFileSync(`${directory}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, relative) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), relative))))}`);
  const url = `data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${name}-import-documents-test.mjs`).toString('base64')}`; cache.set(name, url); return url;
}
const { docxText, extractImportFile, boundedImportForm } = await import(compile('importer/documents'));
const { parseImportDocument } = await import(compile('importer/parse'));
const { extractPdfText } = await import(compile('../components/portal/import-pdf-text'));
globalThis.window = { setTimeout, clearTimeout };
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [filename, text] of entries) {
    const name = Buffer.from(filename), bytes = Buffer.from(text), compressed = deflateRawSync(bytes), checksum = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, compressed); central.push(directory, name); offset += header.length + name.length + compressed.length;
  }
  const end = Buffer.alloc(22), directoryBytes = Buffer.concat(central); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBytes, end]);
}
const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Nome:</w:t></w:r></w:p><w:p><w:r><w:t>Projetor de demonstração</w:t></w:r></w:p><w:p><w:r><w:t>Tombamento: 000042</w:t></w:r></w:p><w:p><w:r><w:t>Marca: Marca &amp; Modelo QA</w:t></w:r></w:p></w:body></w:document>';
const packageEntries = main => [['[Content_Types].xml', '<Types/>'], ['word/document.xml', main]];

test('DOCX reads genuine ZIP/body XML, retains field values, and never resolves external relations', async () => {
  const bytes = zip([...packageEntries(xml), ['word/_rels/document.xml.rels', '<Relationships><Relationship TargetMode="External" Target="http://127.0.0.1/private"/></Relationships>'], ['word/comments.xml', '<private>not imported</private>']]);
  const extracted = await extractImportFile('qa-synthetic.docx', bytes), candidate = parseImportDocument('asset', extracted.content, extracted.format)[0];
  assert.equal(candidate.fields.name, 'Projetor de demonstração'); assert.equal(candidate.fields.assetCode, '000042'); assert.equal(candidate.fields.brand, 'Marca & Modelo QA');
  assert.equal(extracted.provenance.extraction, 'server-docx'); assert.match(extracted.provenance.sha256, /^[a-f0-9]{64}$/);
  assert.equal(extracted.content.includes('not imported'), false); assert.equal(extracted.content.includes('127.0.0.1'), false);
  assert.throws(() => docxText(zip([...packageEntries(xml), ['word/document.xml', xml]])), error => error.code === 'import_docx_invalid');
});

test('DOCX rejects bomb sizes, corrupt ZIP/CRC, macros, unsafe entries and external entity declarations', () => {
  for (const bytes of [zip(packageEntries(xml.repeat(4000))), zip(packageEntries('<!DOCTYPE a [<!ENTITY external SYSTEM "file:///private">]>' + xml)), zip([...packageEntries(xml), ['../outside', 'no write']]), zip([...packageEntries(xml), ['word/vbaProject.bin', 'macro']]), zip(packageEntries(xml)).subarray(0, 50)]) assert.throws(() => docxText(bytes), error => error.code === 'import_docx_invalid');
  const broken = zip(packageEntries(xml)), central = broken.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), 1); broken.writeUInt32LE(123, central + 16);
  // Corrupt the checksum for document.xml rather than the unread content-types part.
  const second = broken.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), central + 4); broken.writeUInt32LE(456, second + 16);
  assert.throws(() => docxText(broken), error => error.code === 'import_docx_invalid');
});

test('PDF upload provenance binds original bytes and identifies browser extraction/pages honestly', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\nsynthetic test payload');
  const first = await extractImportFile('qa.pdf', bytes, { text: '[Página 1]\nTítulo: Projeto QA', pageCount: 1 });
  assert.equal(first.provenance.extraction, 'browser-pdf'); assert.deepEqual(first.provenance.pages, [1]); assert.match(first.warnings[0], /sem comparar/);
  await assert.rejects(extractImportFile('qa.pdf', bytes), error => error.code === 'import_pdf_text');
  await assert.rejects(extractImportFile('qa.pdf', bytes, { text: 'Texto', pageCount: 51 }), error => error.code === 'import_pdf_text');
  await assert.rejects(extractImportFile('qa.pdf', new TextEncoder().encode('not a PDF'), { text: 'Texto', pageCount: 1 }), error => error.code === 'import_pdf_invalid');
});

test('multipart file reading is bounded and preserves binary DOCX data without using native FormData serialization', async () => {
  const bytes = zip(packageEntries(xml)), boundary = 'qa-import-boundary';
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="qa.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const form = await boundedImportForm(new Request('http://127.0.0.1/api/imports/document', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body }));
  const file = form.get('file'); assert.equal(file.size, bytes.length); assert.equal(docxText(new Uint8Array(await file.arrayBuffer())).includes('000042'), true);
  await assert.rejects(boundedImportForm(new Request('http://127.0.0.1/api/imports/document', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(5 * 1024 * 1024) }, body: 'x' })), error => error.code === 'import_file_limit');
});

function fakeEngine(pages) {
  const state = { destroyed: 0, cleaned: 0, options: null };
  return { state, engine: { GlobalWorkerOptions: {}, getDocument(options) { state.options = options; return { promise: Promise.resolve({ numPages: pages.length, async getPage(index) { return { async getTextContent() { return { items: pages[index - 1].map((text, index) => ({ str: text, transform: [1, 0, 0, 1, 0, 500 - index * 20], width: 100, hasEOL: true })) }; }, cleanup() { state.cleaned++; } }; } }), async destroy() { state.destroyed++; } }; } } };
}
test('browser PDF pipeline uses text-only safe options, tracks pages and cleans its worker', async () => {
  const fake = fakeEngine([['Nome: Equipamento QA', 'Tombamento: 000789'], ['Marca: Marca QA']]);
  const file = new Blob(['%PDF-1.7\nsynthetic']);
  const extracted = await extractPdfText(file, async () => fake.engine);
  assert.equal(extracted.pageCount, 2); assert.match(extracted.text, /Página 2/);
  assert.equal(parseImportDocument('asset', extracted.text, 'text')[0].fields.assetCode, '000789');
  assert.equal(fake.state.options.isEvalSupported, false); assert.equal(fake.state.options.enableXfa, false); assert.equal(fake.state.options.useWorkerFetch, false);
  assert.equal(fake.state.options.url, undefined); assert.equal(fake.state.options.useWasm, false); assert.equal(fake.state.destroyed, 1); assert.equal(fake.state.cleaned, 2);
  const tooMany = fakeEngine(Array.from({ length: 51 }, () => []));
  await assert.rejects(extractPdfText(file, async () => tooMany.engine), /cinquenta páginas/); assert.equal(tooMany.state.destroyed, 1);
  const scanned = fakeEngine([[]]); await assert.rejects(extractPdfText(file, async () => scanned.engine), /OCR/);
  const huge = fakeEngine([['x'.repeat(256 * 1024 + 1)]]); await assert.rejects(extractPdfText(file, async () => huge.engine), /excede 256 KiB/);
});
