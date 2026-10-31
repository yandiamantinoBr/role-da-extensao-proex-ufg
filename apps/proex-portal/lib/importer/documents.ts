import { inflateRawSync } from 'node:zlib';
import { HttpError } from '../errors';
import { MAX_UPLOAD_FILE_BYTES } from '../upload-limits';
import { IMPORT_TEXT_LIMIT, type ImportFileProvenance } from './contracts';
import { decodeEntities } from './parse';
import { importDigest } from './review';

const XML_LIMIT = 1024 * 1024;
function invalidDocx(): HttpError { return new HttpError(400, 'O arquivo DOCX está incompleto, protegido ou usa um formato não suportado.', 'import_docx_invalid'); }
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function mainDocxXml(bytes: Uint8Array): string {
  if (bytes.byteLength < 22) throw invalidDocx();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw invalidDocx();
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directory = view.getUint32(end + 16, true);
  if (!count || count > 2000 || view.getUint16(end + 8, true) !== count || directory + directorySize !== end) throw invalidDocx();
  let offset = directory, main: { compressed: number; size: number; method: number; local: number; crc: number } | null = null, contentTypes = false;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw invalidDocx();
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true), nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true), local = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength + extraLength + commentLength > end || flags & 1 || compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw invalidDocx();
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /vbaproject\.bin$/i.test(name)) throw invalidDocx();
    if (name === '[Content_Types].xml') contentTypes = true;
    if (name.toLowerCase() === 'word/document.xml') { if (main || name !== 'word/document.xml' || size > XML_LIMIT || ![0, 8].includes(method)) throw invalidDocx(); main = { compressed, size, method, local, crc: view.getUint32(offset + 16, true) }; }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!main || !contentTypes || offset !== end || main.local + 30 > directory || view.getUint32(main.local, true) !== 0x04034b50 || view.getUint16(main.local + 6, true) & 1 || view.getUint16(main.local + 8, true) !== main.method) throw invalidDocx();
  const nameLength = view.getUint16(main.local + 26, true), extraLength = view.getUint16(main.local + 28, true), start = main.local + 30 + nameLength + extraLength;
  if (new TextDecoder().decode(bytes.subarray(main.local + 30, main.local + 30 + nameLength)) !== 'word/document.xml' || start + main.compressed > directory) throw invalidDocx();
  let xml: Uint8Array;
  try { xml = main.method === 8 ? new Uint8Array(inflateRawSync(bytes.subarray(start, start + main.compressed), { maxOutputLength: XML_LIMIT })) : bytes.subarray(start, start + main.compressed); } catch { throw invalidDocx(); }
  if (xml.byteLength !== main.size || xml.byteLength > XML_LIMIT || crc32(xml) !== main.crc) throw invalidDocx();
  return new TextDecoder(xml[0] === 0xff && xml[1] === 0xfe ? 'utf-16le' : 'utf-8', { fatal: true }).decode(xml);
}
export function docxText(bytes: Uint8Array): string {
  try {
    const xml = mainDocxXml(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/<(?:\w+:)?document\b/.test(xml)) throw invalidDocx();
    // Read only body text. Relationships, macros, comments, attachments, URLs and
    // external entities are never resolved. No package path is written to disk.
    let content = '';
    for (const match of xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([^]*?)<\/(?:\w+:)?t\s*>|<\/(?:\w+:)?p\s*>|<(?:\w+:)?(?:br|tab)\b[^>]*\/?\s*>/g)) content += match[1] === undefined ? '\n' : decodeEntities(match[1].replace(/<[^>]*>/g, ''));
    if (!content.trim()) throw new HttpError(422, 'O DOCX não tem texto no corpo principal. Use um documento com texto selecionável.', 'import_document_empty');
    if (new TextEncoder().encode(content).byteLength > IMPORT_TEXT_LIMIT) throw new HttpError(413, 'O texto extraído excede 256 KiB. Divida o documento.', 'import_document_limit');
    return content;
  } catch (error) { if (error instanceof HttpError) throw error; throw invalidDocx(); }
}
export type ExtractedImportFile = { content: string; format: string; provenance: ImportFileProvenance; warnings: string[] };
export async function extractImportFile(name: string, bytes: Uint8Array, browserPdf?: { text: string; pageCount: number }): Promise<ExtractedImportFile> {
  if (!bytes.length || bytes.length > MAX_UPLOAD_FILE_BYTES) throw new HttpError(413, 'O documento excede o limite de arquivo do portal.', 'import_file_limit');
  const extension = name.split('.').pop()?.toLowerCase(), sha256 = await importDigest(bytes);
  if (extension === 'docx') return { content: docxText(bytes), format: 'text', provenance: { fileFormat: 'docx', sha256, extraction: 'server-docx' }, warnings: ['Texto extraído do corpo principal do DOCX. Cabeçalhos, rodapés, comentários, imagens e paginação não foram importados.'] };
  if (extension === 'pdf') {
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new HttpError(415, 'O arquivo não tem uma assinatura de PDF válida.', 'import_pdf_invalid');
    if (!browserPdf || !Number.isInteger(browserPdf.pageCount) || browserPdf.pageCount < 1 || browserPdf.pageCount > 50 || !browserPdf.text.trim() || new TextEncoder().encode(browserPdf.text).byteLength > IMPORT_TEXT_LIMIT) throw new HttpError(422, 'O PDF precisa ter texto extraído no navegador, com até 50 páginas e 256 KiB de texto. PDFs digitalizados precisam de OCR fora deste fluxo.', 'import_pdf_text');
    return { content: browserPdf.text, format: 'text', provenance: { fileFormat: 'pdf', sha256, extraction: 'browser-pdf', pages: Array.from({ length: browserPdf.pageCount }, (_, index) => index + 1) }, warnings: ['Texto extraído do PDF no navegador; confira os campos e a ordem da leitura. O servidor confere o arquivo e seu hash, sem comparar o texto com as páginas.'] };
  }
  if (!['txt', 'csv', 'tsv', 'json', 'html', 'htm'].includes(extension ?? '') || bytes.length > IMPORT_TEXT_LIMIT) throw new HttpError(415, 'Use PDF, DOCX, TXT, HTML, JSON ou CSV dentro dos limites informados.', 'import_file_format');
  let content: string; try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new HttpError(415, 'Salve o arquivo textual em UTF-8 ou copie o trecho relevante.', 'import_file_encoding'); }
  return { content, format: extension === 'json' ? 'json' : extension === 'csv' || extension === 'tsv' ? 'csv' : extension === 'html' || extension === 'htm' ? 'html' : 'text', provenance: { fileFormat: extension!, sha256, extraction: 'text-file' }, warnings: [] };
}
export async function boundedImportForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get('Content-Type') ?? '', limit = MAX_UPLOAD_FILE_BYTES + IMPORT_TEXT_LIMIT + 32768;
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) throw new HttpError(415, 'Envie o documento como arquivo.', 'import_file_form');
  if (Number(request.headers.get('Content-Length') ?? 0) > limit) throw new HttpError(413, 'O envio excede o limite de arquivo e texto.', 'import_file_limit');
  const chunks: Uint8Array[] = [], reader = request.body.getReader(); let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new HttpError(413, 'O envio excede o limite de arquivo e texto.', 'import_file_limit'); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return await new Request(request.url, { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes }).formData(); } catch { throw new HttpError(400, 'O arquivo não pôde ser lido. Envie-o novamente.', 'import_file_form'); }
}
