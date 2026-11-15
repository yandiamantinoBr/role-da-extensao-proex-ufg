// Entrada exclusiva de PDFs públicos validados. Não executa conteúdo do documento.
export type PdfTextPage = { number: number; text: string };

export async function readOfficialPdfText(bytes: Uint8Array): Promise<PdfTextPage[]> {
  const [engine, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ]);
  // O PDF.js usa o manipulador incluído no bundle como worker local no servidor.
  const host = globalThis as typeof globalThis & { pdfjsWorker?: typeof worker };
  host.pdfjsWorker ??= worker;
  const task = engine.getDocument({
    data: bytes, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false,
    disableAutoFetch: true, disableStream: true, disableRange: true, enableXfa: false,
    useWasm: false, verbosity: 0, stopAtErrors: true,
  });
  const timer = setTimeout(() => { void task.destroy().catch(() => {}); }, 5_000);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 50) throw new Error('PDF acima do limite de páginas.');
    const pages: PdfTextPage[] = [];
    let textSize = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.flatMap(item => 'str' in item ? [item.str + (item.hasEOL ? '\n' : ' ')] : []).join('');
      page.cleanup();
      textSize += text.length;
      if (textSize > 160_000) throw new Error('PDF acima do limite de texto.');
      if (text.trim()) pages.push({ number, text });
    }
    return pages;
  } finally {
    clearTimeout(timer);
    await task.destroy().catch(() => {});
  }
}
