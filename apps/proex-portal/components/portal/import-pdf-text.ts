'use client';
import { IMPORT_TEXT_LIMIT } from '../../lib/importer/contracts';
import { MAX_UPLOAD_FILE_BYTES } from '../../lib/upload-limits';

type PdfEngine = Pick<typeof import('pdfjs-dist'), 'getDocument' | 'GlobalWorkerOptions'>;
async function pdfEngine(): Promise<PdfEngine> {
  const [engine, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  engine.GlobalWorkerOptions.workerSrc = worker.default;
  return engine;
}
export async function extractPdfText(file: Pick<File, 'size' | 'arrayBuffer'>, loadEngine: () => Promise<PdfEngine> = pdfEngine): Promise<{ text: string; pageCount: number }> {
  if (!file.size || file.size > MAX_UPLOAD_FILE_BYTES) throw new Error('O PDF excede o limite de arquivo do portal.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('O arquivo não tem uma assinatura de PDF válida.');
  let engine: PdfEngine;
  try { engine = await loadEngine(); } catch { throw new Error('Este navegador não carregou o leitor de PDF. Tente um navegador atualizado ou copie o texto do documento.'); }
  // PDF.js 6 removed the old eval-based code path and the corresponding type;
  // retain an explicit false for compatible older adapters used by tests/hosts.
  const options = { data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false,
    disableAutoFetch: true, disableStream: true, disableRange: true, enableXfa: false, useWasm: false, verbosity: 0, stopAtErrors: true };
  const task = engine.getDocument(options);
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; void task.destroy().catch(() => {}); }, 15000);
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 50) throw new Error('Use um PDF com até cinquenta páginas. Divida o documento antes de importar.');
    const pages: string[] = []; let textBytes = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number), content = await page.getTextContent(), lines: string[] = []; let line = '', y: number | null = null, previousEnd = 0;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const nextY = item.transform[5], nextX = item.transform[4];
        if (y !== null && Math.abs(nextY - y) > 3 && line) { lines.push(line); line = ''; }
        if (line && nextX - previousEnd > 2) line += ' ';
        line += item.str; y = nextY; previousEnd = nextX + item.width;
        if (item.hasEOL) { if (line) lines.push(line); line = ''; y = null; }
      }
      if (line) lines.push(line);
      const text = `[Página ${number}]\n${lines.join('\n')}`;
      textBytes += new TextEncoder().encode(text).byteLength;
      if (textBytes > IMPORT_TEXT_LIMIT) throw new Error('O texto do PDF excede 256 KiB. Divida o documento antes de importar.');
      pages.push(text); page.cleanup();
    }
    if (!pages.some(page => page.replace(/^\[Página \d+\]\s*/, '').trim())) throw new Error('Não foi possível extrair texto deste PDF. Documentos digitalizados precisam de OCR fora deste fluxo.');
    return { text: pages.join('\n\n'), pageCount: pdf.numPages };
  } catch (error) {
    if (timedOut) throw new Error('O PDF não pôde ser lido em quinze segundos. Divida o documento ou copie o texto relevante.');
    if (error instanceof Error && /Use um PDF|excede 256 KiB|Não foi possível extrair/.test(error.message)) throw error;
    throw new Error('Não foi possível ler este PDF. Confira se está íntegro, sem senha e com texto selecionável.');
  } finally { window.clearTimeout(timer); await task.destroy().catch(() => {}); }
}
