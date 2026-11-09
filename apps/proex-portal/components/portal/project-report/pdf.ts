// PDF do relatório do projeto: capa, sumário com páginas, seções numeradas, gráficos vetoriais,
// numeração "Página X de Y" e referências clicáveis no fim. Gerado no navegador com pdf-lib.
import type { Color, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import { fit, localAsset, wrap } from '../report-pdf';
import type { Block, ReportDocument } from './document';

type ProjectMark = 'role-da-extensao' | 'conpeex-2026';
const MARK_PATHS: Record<ProjectMark, string> = { 'role-da-extensao': '/brand/role-da-extensao.png', 'conpeex-2026': '/brand/conpeex-2026.png' };
export type ReportPdfOptions = { fontBytes?: Uint8Array; marks?: { proex?: Uint8Array; ufg?: Uint8Array; project?: Uint8Array }; projectBrand?: ProjectMark };

export async function toReportPdf(doc: ReportDocument, options: ReportPdfOptions = {}): Promise<Blob> {
  const browser = typeof window !== 'undefined';
  const [{ PDFDocument, PDFName, PDFString, rgb, StandardFonts }, fontkit, fontBytes, proexBytes, ufgBytes, projectBytes] = await Promise.all([
    import('pdf-lib'), import('@pdf-lib/fontkit'),
    options.fontBytes ?? localAsset('/fonts/NotoSans-Regular.ttf', 2 * 1024 * 1024),
    options.marks?.proex ?? (browser ? localAsset('/brand/proex.png', 256 * 1024).catch(() => undefined) : undefined),
    options.marks?.ufg ?? (browser ? localAsset('/brand/ufg-white.png', 256 * 1024).catch(() => undefined) : undefined),
    options.marks?.project ?? (browser && options.projectBrand ? localAsset(MARK_PATHS[options.projectBrand], 256 * 1024).catch(() => undefined) : undefined),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit.default);
  const [font, bold, proex, ufg, projectMark] = await Promise.all([
    pdf.embedFont(fontBytes, { subset: true }), pdf.embedFont(StandardFonts.HelveticaBold),
    proexBytes ? pdf.embedPng(proexBytes).catch(() => undefined) : undefined,
    ufgBytes ? pdf.embedPng(ufgBytes).catch(() => undefined) : undefined,
    projectBytes ? pdf.embedPng(projectBytes).catch(() => undefined) : undefined,
  ]);
  const supported = new Set(font.getCharacterSet()), boldSupported = new Set(bold.getCharacterSet());
  const clean = (value: string) => Array.from(value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, ''))
    .map(char => char === '\n' || supported.has(char.codePointAt(0)!) ? char : '?').join('');
  const strong = (value: string) => Array.from(value).every(char => char === '\n' || boldSupported.has(char.codePointAt(0)!)) ? bold : font;

  const W = 595.28, H = 841.89, M = 48, U = W - 2 * M, BOTTOM = 62;
  const ink = rgb(41 / 255, 35 / 255, 51 / 255), purple = rgb(59 / 255, 23 / 255, 83 / 255), brand = rgb(84 / 255, 33 / 255, 108 / 255);
  const orange = rgb(1, 170 / 255, 61 / 255), deepOrange = rgb(194 / 255, 94 / 255, 0), white = rgb(1, 1, 1);
  const muted = rgb(.36, .31, .40), line = rgb(.85, .82, .88), tint = rgb(.965, .949, .973), zebra = rgb(.98, .973, .984);
  const seriesColors = [brand, deepOrange];
  let page!: PDFPage, y = 0;
  const bodyPages: PDFPage[] = [];
  const sectionPages: number[] = [];

  const paint = (value: string, x: number, top: number, size: number, color: Color = ink, face: PDFFont = font) => page.drawText(value, { x, y: top - size, size, font: face, color });
  const rule = (top: number, color: Color = line, thickness = .6, left = M, right = W - M) => page.drawLine({ start: { x: left, y: top }, end: { x: right, y: top }, color, thickness });
  const logo = (image: PDFImage, left: number, top: number, maxWidth: number, maxHeight: number) => { const size = image.scaleToFit(maxWidth, maxHeight); page.drawImage(image, { x: left + (maxWidth - size.width) / 2, y: top - (maxHeight + size.height) / 2, ...size }); };
  const linkTo = (target: PDFPage, x: number, top: number, width: number, height: number, url?: string) => {
    // pdf-lib não escapa parênteses nem barra invertida: codificados como %XX, o link continua o mesmo.
    const action = url ? { Type: 'Action', S: 'URI', URI: PDFString.of(url.replace(/[()\\]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())) } : undefined;
    const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, top - height, x + width, top], Border: [0, 0, 0], ...(action ? { A: action } : {}) });
    const ref = pdf.context.register(annotation);
    target.node.addAnnot(ref);
    return annotation;
  };

  function newPage() {
    if (pdf.getPageCount() >= 400) throw new Error('O relatório passou de 400 páginas. Reduza o período ou as seções.');
    page = pdf.addPage([W, H]);
    bodyPages.push(page);
    page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: brand });
    paint('PROEX / UFG', M, H - 26, 8.5, brand, bold);
    paint(fit(clean(`${doc.title} · ${doc.projectName}`).replace(/\s+/g, ' '), font, 8.5, U - 90), M + 90, H - 26, 8.5, muted);
    rule(H - 42);
    y = H - 62;
  }
  const ensure = (needed: number) => { if (y - needed < BOTTOM) newPage(); };

  // ---- Capa
  page = pdf.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - 250, width: W, height: 250, color: purple });
  page.drawRectangle({ x: 0, y: H - 256, width: W, height: 6, color: orange });
  if (proex) { page.drawRectangle({ x: M, y: H - 112, width: 128, height: 64, color: white }); logo(proex, M + 8, H - 52, 112, 56); }
  else paint('PROEX', M, H - 70, 26, white, bold);
  if (ufg) logo(ufg, W - M - 96, H - 50, 96, 60); else paint('UFG', W - M - 60, H - 70, 24, white, bold);
  paint('PRÓ-REITORIA DE EXTENSÃO', M, H - 150, 10, orange, bold);
  paint('Universidade Federal de Goiás', M, H - 166, 10, white);
  paint('RELATÓRIO DO PROJETO', M, H - 300, 10, deepOrange, bold);
  y = H - 322;
  const title = clean(doc.title), titleFace = strong(title);
  for (const text of wrap(title, titleFace, 30, U).slice(0, 3)) { paint(text, M, y, 30, purple, titleFace); y -= 38; }
  y -= 4;
  const project = clean(doc.projectName), projectFace = strong(project);
  for (const text of wrap(project, projectFace, 17, projectMark ? U - 150 : U).slice(0, 3)) { paint(text, M, y, 17, ink, projectFace); y -= 23; }
  if (doc.subtitle) { for (const text of wrap(clean(doc.subtitle), font, 11, U).slice(0, 2)) { paint(text, M, y - 2, 11, muted); y -= 16; } }
  if (projectMark) logo(projectMark, W - M - 130, H - 322, 130, 80);
  y -= 26;
  for (const [key, value] of [['Período', doc.period], ['Gerado em', doc.generatedAt], ['Seções', String(doc.sections.length)]] as const) {
    rule(y + 6);
    paint(key.toUpperCase(), M, y - 2, 8.5, muted, bold);
    paint(fit(clean(value), font, 11, U - 120), M + 120, y - 1, 11, ink);
    y -= 28;
  }
  rule(y + 6);
  paint('Dados conforme o acesso de quem gerou o relatório no Portal PROEX.', M, BOTTOM + 10, 9, muted);

  // ---- Corpo
  newPage();
  const sectionHeading = (number: number, text: string) => {
    ensure(110);
    sectionPages[number] = bodyPages.length - 1;
    page.drawRectangle({ x: M, y: y - 26, width: 26, height: 26, color: brand });
    const label = String(number);
    paint(label, M + 13 - bold.widthOfTextAtSize(label, 13) / 2, y - 6, 13, white, bold);
    const heading = clean(text), face = strong(heading);
    paint(fit(heading, face, 17, U - 40), M + 36, y - 4, 17, purple, face);
    y -= 34;
    rule(y, orange, 1.4);
    y -= 16;
  };
  const subheading = (text: string) => { ensure(60); const value = clean(text), face = strong(value); paint(fit(value, face, 11.5, U), M, y, 11.5, purple, face); y -= 20; };
  const paragraph = (text: string, size = 10.5, color: Color = ink, leading = 15) => {
    for (const part of wrap(clean(text), font, size, U)) { ensure(leading); paint(part, M, y, size, color); y -= leading; }
    y -= 6;
  };

  function table(columns: { label: string; numeric?: boolean; width?: number }[], rows: string[][], header = true, firstBold = false) {
    const weights = columns.map(column => column.width ?? 1), total = weights.reduce((sum, weight) => sum + weight, 0);
    const widths = weights.map(weight => U * weight / total), pad = 5, size = 9, leading = 12;
    const drawHeader = () => {
      if (!header) return;
      const cells = columns.map((column, index) => wrap(clean(column.label), strong(column.label), 8.5, widths[index] - 2 * pad));
      const height = Math.max(...cells.map(cell => cell.length)) * 11 + 2 * pad;
      page.drawRectangle({ x: M, y: y - height, width: U, height, color: brand });
      let x = M;
      cells.forEach((cell, index) => { cell.forEach((text, row) => { const face = strong(columns[index].label); paint(text, columns[index].numeric ? x + widths[index] - pad - face.widthOfTextAtSize(text, 8.5) : x + pad, y - pad - row * 11, 8.5, white, face); }); x += widths[index]; });
      y -= height;
    };
    const rowHeight = (row: string[]) => Math.max(...row.map((value, index) => wrap(clean(value || '—'), font, size, widths[index] - 2 * pad).length)) * leading + 2 * pad;
    const heights = rows.map(rowHeight);
    ensure(36 + heights.slice(0, 3).reduce((sum, height) => sum + height, 0)); drawHeader();
    rows.forEach((row, rowIndex) => {
      // Sem linhas órfãs: se as últimas (até 3) não cabem todas aqui, vão juntas para a próxima página.
      const rest = heights.slice(rowIndex);
      if (rowIndex > 0 && rest.length <= 3 && rest.reduce((sum, height) => sum + height, 0) > y - BOTTOM && rest.reduce((sum, height) => sum + height, 0) <= H - 62 - BOTTOM - 40) { newPage(); drawHeader(); }
      const cells = row.map((value, index) => wrap(clean(value || '—'), firstBold && index === 0 ? strong(value) : font, size, widths[index] - 2 * pad));
      let remaining = cells.map(cell => [...cell]);
      const full = Math.max(...cells.map(cell => cell.length)) * leading + 2 * pad;
      // Uma linha que cabe numa página nova não é partida.
      if (y - full < BOTTOM && full <= H - 62 - BOTTOM - 40) { newPage(); drawHeader(); }
      while (remaining.some(cell => cell.length)) {
        if (Math.floor((y - BOTTOM - 2 * pad) / leading) < 1) { newPage(); drawHeader(); }
        const count = Math.min(Math.max(...remaining.map(cell => cell.length)), Math.floor((y - BOTTOM - 2 * pad) / leading));
        const height = count * leading + 2 * pad;
        if (rowIndex % 2) page.drawRectangle({ x: M, y: y - height, width: U, height, color: zebra });
        let x = M;
        remaining.forEach((cell, index) => {
          const face = firstBold && index === 0 ? strong(row[index]) : font;
          cell.slice(0, count).forEach((text, lineIndex) => paint(text, columns[index].numeric ? x + widths[index] - pad - face.widthOfTextAtSize(text, size) : x + pad, y - pad - lineIndex * leading, size, firstBold && index === 0 ? purple : ink, face));
          x += widths[index];
        });
        y -= height;
        rule(y, line, .4);
        remaining = remaining.map(cell => cell.slice(count));
        if (remaining.some(cell => cell.length)) { newPage(); drawHeader(); }
      }
    });
    y -= 12;
  }

  function metrics(items: { label: string; value: string; detail?: string }[]) {
    const perRow = Math.min(items.length, 5), gap = 8, width = (U - gap * (perRow - 1)) / perRow;
    for (let start = 0; start < items.length; start += perRow) {
      const group = items.slice(start, start + perRow);
      const labels = group.map(item => wrap(clean(item.label), font, 8.5, width - 16));
      const height = 44 + Math.max(...labels.map(lines => lines.length)) * 11 + (group.some(item => item.detail) ? 12 : 0);
      ensure(height + 10);
      group.forEach((item, index) => {
        const x = M + index * (width + gap);
        page.drawRectangle({ x, y: y - height, width, height, color: tint });
        page.drawRectangle({ x, y: y - 2.5, width, height: 2.5, color: brand });
        const value = clean(item.value), face = strong(value);
        paint(fit(value, face, 20, width - 16), x + 8, y - 10, 20, purple, face);
        labels[index].forEach((text, row) => paint(text, x + 8, y - 36 - row * 11, 8.5, ink));
        if (item.detail) paint(fit(clean(item.detail), font, 7.5, width - 16), x + 8, y - 38 - labels[index].length * 11, 7.5, muted);
      });
      y -= height + 14;
    }
  }

  function chart(block: Extract<Block, { kind: 'chart' }>) {
    const height = 190;
    ensure(height + 40);
    subheading(block.title);
    const top = y, plotLeft = M + 30, plotRight = W - M - 4, plotTop = top - 8, plotBottom = top - height + 42;
    const max = Math.max(1, ...block.series.flatMap(series => series.values));
    const step = max <= 5 ? 1 : Math.ceil(max / 4);
    const ceiling = Math.ceil(max / step) * step;
    for (let value = 0; value <= ceiling; value += step) {
      const gy = plotBottom + (plotTop - plotBottom) * value / ceiling;
      page.drawLine({ start: { x: plotLeft, y: gy }, end: { x: plotRight, y: gy }, color: value ? line : rgb(.62, .57, .67), thickness: value ? .4 : .8 });
      const label = String(value);
      page.drawText(label, { x: plotLeft - 6 - font.widthOfTextAtSize(label, 7.5), y: gy - 2.5, size: 7.5, font, color: muted });
    }
    const groups = block.categories.length, slot = (plotRight - plotLeft) / Math.max(groups, 1), barWidth = Math.min(16, slot * .7 / block.series.length);
    const labelEvery = Math.ceil(groups / Math.floor((plotRight - plotLeft) / 34));
    block.categories.forEach((category, index) => {
      const center = plotLeft + slot * (index + .5), start = center - barWidth * block.series.length / 2;
      block.series.forEach((series, serie) => {
        const value = series.values[index] ?? 0, barHeight = (plotTop - plotBottom) * value / ceiling;
        if (barHeight > 0) page.drawRectangle({ x: start + serie * barWidth, y: plotBottom, width: barWidth - 1, height: barHeight, color: seriesColors[serie % seriesColors.length] });
      });
      if (index % labelEvery === 0) page.drawText(category, { x: center - font.widthOfTextAtSize(category, 7.5) / 2, y: plotBottom - 12, size: 7.5, font, color: muted });
    });
    let legend = plotLeft;
    block.series.forEach((series, index) => {
      page.drawRectangle({ x: legend, y: plotBottom - 30, width: 9, height: 9, color: seriesColors[index % seriesColors.length] });
      const label = `${clean(series.label)} (${series.values.reduce((sum, value) => sum + value, 0)})`;
      page.drawText(label, { x: legend + 13, y: plotBottom - 29, size: 8.5, font, color: ink });
      legend += 30 + font.widthOfTextAtSize(label, 8.5);
    });
    y = top - height;
    if (block.note) paragraph(block.note, 8.5, muted, 12);
  }

  function callout(title: string, text: string) {
    const lines = wrap(clean(text), font, 10, U - 30);
    let index = 0, first = true;
    while (index < lines.length || first) {
      const head = first && title ? 22 : 8;
      ensure(first ? 48 : 30);
      const room = Math.max(1, Math.floor((y - BOTTOM - head - 12) / 14));
      const chunk = lines.slice(index, index + room), height = head + chunk.length * 14 + 10;
      page.drawRectangle({ x: M, y: y - height, width: U, height, color: tint });
      page.drawRectangle({ x: M, y: y - height, width: 3.5, height, color: orange });
      let top = y - 9;
      if (first && title) { paint(clean(title).toUpperCase(), M + 14, top, 8.5, purple, bold); top -= 15; }
      chunk.forEach((line, row) => paint(line, M + 14, top - row * 14, 10, ink));
      y -= height + (index + room >= lines.length ? 14 : 0);
      index += room; first = false;
      if (index < lines.length) newPage();
    }
  }

  function timeline(items: Extract<Block, { kind: 'timeline' }>['items']) {
    let month = '', lastDate = '';
    for (const item of items) {
      if (item.month !== month) { month = item.month; ensure(44); paint(clean(month), M, y - 4, 10.5, purple, strong(month)); y -= 24; }
      const title = wrap(clean(item.title), font, 9.5, U - 150), detail = item.detail ? wrap(clean(item.detail), font, 8.5, U - 150) : [];
      const height = title.length * 13 + detail.length * 11 + 10;
      ensure(height);
      if (item.date !== lastDate || item.month !== month) paint(clean(item.date), M, y, 9.5, purple, bold);
      lastDate = item.date;
      paint(fit(clean(item.tag), font, 8, 62), M + 66, y + .5, 8, muted);
      page.drawCircle({ x: M + 136, y: y - 5, size: 3, color: brand });
      page.drawLine({ start: { x: M + 136, y: y - 10 }, end: { x: M + 136, y: y - height + 1 }, color: line, thickness: .8 });
      title.forEach((text, index) => paint(text, M + 150, y - index * 13, 9.5, ink));
      detail.forEach((text, index) => paint(text, M + 150, y - title.length * 13 - index * 11, 8.5, muted));
      y -= height;
    }
    y -= 8;
  }

  function references(items: Extract<Block, { kind: 'references' }>['items']) {
    for (const item of items) {
      const heading = wrap(clean(`[${item.number}] ${item.title}`), bold, 10, U), meta = `${item.type} · ${item.source}`, address = wrap(item.url, font, 8.5, U - 18);
      ensure(heading.length * 14 + 12 + address.length * 11 + 10);
      heading.forEach((text, index) => paint(text, M, y - index * 14, 10, purple, strong(text)));
      y -= heading.length * 14;
      paint(fit(clean(meta), font, 8.5, U - 18), M + 18, y, 8.5, muted);
      y -= 13;
      const top = y;
      address.forEach((text, index) => paint(text, M + 18, y - index * 11, 8.5, brand));
      y -= address.length * 11;
      linkTo(page, M + 18, top + 2, U - 18, address.length * 11 + 2, item.url);
      y -= 10;
    }
  }

  for (const section of doc.sections) {
    if (section.id === 'references' && y < H - 62) newPage();
    sectionHeading(section.number, section.title);
    for (const block of section.blocks) {
      if (block.kind === 'paragraph') paragraph(block.text);
      else if (block.kind === 'note') paragraph(block.text, 9, muted, 13);
      else if (block.kind === 'facts') table([{ label: '', width: 1.25 }, { label: '', width: 2.75 }], block.items.map(([key, value]) => [key, value]), false, true);
      else if (block.kind === 'metrics') metrics(block.items);
      else if (block.kind === 'table') { if (block.title) subheading(block.title); table(block.columns, block.rows); if (block.note) paragraph(block.note, 8.5, muted, 12); }
      else if (block.kind === 'chart') chart(block);
      else if (block.kind === 'timeline') { timeline(block.items); if (block.note) paragraph(block.note, 8.5, muted, 12); }
      else if (block.kind === 'references') references(block.items);
      else if (block.kind === 'callout') callout(block.title, block.text);
    }
    y -= 10;
  }

  // ---- Sumário (inserido como página 2 depois de conhecer as páginas de cada seção)
  const tocCount = Math.max(1, Math.ceil(doc.sections.length / 26));
  const offset = 1 + tocCount;
  for (let index = 0; index < tocCount; index++) {
    page = pdf.insertPage(1 + index, [W, H]);
    page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: brand });
    y = H - 70;
    if (!index) { paint('Sumário', M, y, 22, purple, bold); y -= 40; rule(y + 14, orange, 1.4); y -= 10; }
    for (const section of doc.sections.slice(index * 26, index * 26 + 26)) {
      const number = String(sectionPages[section.number] + offset + 1), label = clean(`${section.number}.  ${section.title}`);
      const face = strong(label), labelWidth = face.widthOfTextAtSize(label, 11.5), numberWidth = bold.widthOfTextAtSize(number, 11.5);
      paint(label, M, y, 11.5, ink, face);
      let dots = '';
      while (font.widthOfTextAtSize(dots + ' .', 11.5) < U - labelWidth - numberWidth - 16) dots += ' .';
      paint(dots, M + labelWidth + 4, y, 11.5, line);
      paint(number, W - M - numberWidth, y, 11.5, purple, bold);
      const target = bodyPages[sectionPages[section.number]];
      const annotation = linkTo(page, M, y + 2, U, 18);
      annotation.set(PDFName.of('Dest'), pdf.context.obj([target.ref, PDFName.of('XYZ'), null, H - 40, null]));
      y -= 26;
    }
  }

  // ---- Rodapé "Página X de Y" (a capa conta como página 1, sem rodapé, como no DOCX)
  const pages = pdf.getPages(), total = pages.length;
  pages.forEach((current, index) => {
    if (!index) return;
    current.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, color: line, thickness: .5 });
    current.drawText(fit(clean(`PROEX UFG · ${doc.projectName}`), font, 8, U - 90), { x: M, y: 27, size: 8, font, color: muted });
    const label = `Página ${index + 1} de ${total}`;
    current.drawText(label, { x: W - M - font.widthOfTextAtSize(label, 8), y: 27, size: 8, font, color: muted });
  });
  pdf.setTitle(`${doc.title} — ${doc.projectName}`);
  pdf.setAuthor('PROEX UFG');
  pdf.setSubject('Relatório do projeto gerado no Portal PROEX');
  pdf.setLanguage('pt-BR');
  pdf.setCreationDate(new Date(doc.generatedIso));
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
