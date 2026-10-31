import { documentRows, type ExportColumn, type ExportRow } from './report-export';
import type { PDFFont, PDFPage } from 'pdf-lib';

let fontRequest: Promise<Uint8Array> | undefined;
function localFont(): Promise<Uint8Array> {
  fontRequest ??= fetch('/fonts/NotoSans-Regular.ttf').then(async response => {
    if (!response.ok) throw new Error('Não foi possível carregar a fonte do relatório. Confira sua conexão e tente novamente.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024) throw new Error('A fonte do relatório excedeu o tamanho esperado.');
    return bytes;
  }).catch(error => { fontRequest = undefined; throw error; });
  return fontRequest;
}

/** No remote conversion service receives the report or its data. */
export async function toPdf(title: string, columns: ExportColumn[], rows: ExportRow[], display: (row: ExportRow, key: string) => unknown, info: [string, string][], options?: { fontBytes?: Uint8Array }): Promise<Blob> {
  const data = documentRows(columns, rows, display);
  const [{ PDFDocument, rgb }, fontkit, bytes] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit'), options?.fontBytes ? Promise.resolve(options.fontBytes) : localFont()]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit.default);
  const font = await pdf.embedFont(bytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const text = (value: string) => Array.from(value.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g, '')).map(char => char === '\n' || supported.has(char.codePointAt(0)!) ? char : `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`).join('');
  const margin = 44, width = 612, height = 792, usable = width - 2 * margin, bottom = 46;
  const ink = rgb(.1, .08, .13), muted = rgb(.35, .31, .39), lineColor = rgb(.85, .82, .88), fill = rgb(.94, .92, .96);
  let page: PDFPage = pdf.addPage([width, height]), y = height - margin;
  const addPage = () => {
    if (pdf.getPageCount() >= 300) throw new Error('O relatório ultrapassou 300 páginas. Reduza o recorte e tente novamente.');
    page = pdf.addPage([width, height]); y = height - margin;
    if (pdf.getPageCount() > 1) {
      const label = fit(text(title), font, 9, usable);
      page.drawText(label, { x: margin, y: y - 9, size: 9, font, color: muted }); y -= 26;
    }
  };
  const ensure = (needed: number) => { if (y - needed < bottom) addPage(); };
  const paragraph = (value: string, size = 10.5, gap = 8) => {
    for (const line of wrap(text(value), font, size, usable)) {
      ensure(size * 1.4);
      page.drawText(line, { x: margin, y: y - size, size, font, color: ink }); y -= size * 1.4;
    }
    y -= gap;
  };
  pdf.setTitle(title); pdf.setAuthor('PROEX UFG'); pdf.setSubject('Relatório do recorte autorizado no Portal PROEX');
  paragraph(title, 21, 9);
  paragraph('Pró-Reitoria de Extensão da Universidade Federal de Goiás', 10, 12);
  paragraph(`${data.length} registro(s) no recorte selecionado.`, 11, 10);
  for (const [label, value] of info) paragraph(`${label}: ${value}`, 9.5, 4);
  y -= 6;

  if (columns.length <= 6) {
    const cellWidth = usable / columns.length, size = 9.5, leading = 13;
    const headers = columns.map(column => wrap(text(column.label), font, size, cellWidth - 12));
    const headerHeight = Math.max(...headers.map(lines => lines.length)) * leading + 14;
    const drawHeader = () => {
      ensure(headerHeight + leading + 12);
      page.drawRectangle({ x: margin, y: y - headerHeight, width: usable, height: headerHeight, color: fill });
      headers.forEach((lines, index) => lines.forEach((value, row) => page.drawText(value, { x: margin + index * cellWidth + 6, y: y - 9 - size - row * leading, size, font, color: ink })));
      y -= headerHeight;
    };
    drawHeader();
    for (const row of data) {
      const cells = row.map(value => wrap(text(value), font, size, cellWidth - 12));
      const total = Math.max(1, ...cells.map(lines => lines.length));
      const rowHeight = total * leading + 12;
      const freshSpace = height - margin - 26 - headerHeight - bottom;
      if (rowHeight <= freshSpace && y - rowHeight < bottom) { addPage(); drawHeader(); }
      for (let offset = 0; offset < total;) {
        let available = Math.floor((y - bottom - 12) / leading);
        if (available < 1) { addPage(); drawHeader(); available = Math.floor((y - bottom - 12) / leading); }
        const count = Math.min(total - offset, available), block = count * leading + 12;
        cells.forEach((lines, column) => lines.slice(offset, offset + count).forEach((value, rowIndex) => {
          const x = margin + column * cellWidth + 6;
          page.drawText(value, { x: columns[column].numeric ? x + cellWidth - 12 - font.widthOfTextAtSize(value, size) : x, y: y - 6 - size - rowIndex * leading, size, font, color: ink });
        }));
        y -= block;
        page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .5, color: lineColor });
        offset += count;
        if (offset < total) { addPage(); drawHeader(); }
      }
    }
  } else {
    paragraph('Detalhamento dos registros', 14, 12);
    data.forEach((row, index) => {
      const recordHeight = 12 * 1.4 + 16 + row.reduce((height, value, column) => height + wrap(text(`${columns[column].label}: ${value}`), font, 10.5, usable).length * 10.5 * 1.4 + 5, 0);
      ensure(recordHeight <= height - margin - 26 - bottom ? recordHeight : 65); paragraph(`Registro ${index + 1}`, 12, 7);
      row.forEach((value, column) => paragraph(`${columns[column].label}: ${value}`, 10.5, 5));
      y -= 9;
    });
  }
  pdf.getPages().forEach((item, index, pages) => item.drawText(`PROEX UFG | Página ${index + 1} de ${pages.length}`, { x: margin, y: 25, size: 8, font, color: muted }));
  const output = await pdf.save();
  return new Blob([output as BlobPart], { type: 'application/pdf' });
}

function fit(value: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  const chars = Array.from(value); let low = 0, high = chars.length;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (font.widthOfTextAtSize(chars.slice(0, middle).join('') + '…', size) <= width) low = middle; else high = middle - 1; }
  return chars.slice(0, low).join('') + '…';
}

function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      const joined = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(joined, size) <= width) { line = joined; continue; }
      if (line) { lines.push(line); line = ''; }
      let remaining = Array.from(word);
      while (remaining.length && font.widthOfTextAtSize(remaining.join(''), size) > width) {
        let low = 1, high = remaining.length;
        while (low < high) { const middle = Math.ceil((low + high) / 2); if (font.widthOfTextAtSize(remaining.slice(0, middle).join(''), size) <= width) low = middle; else high = middle - 1; }
        lines.push(remaining.slice(0, low).join('')); remaining = remaining.slice(low);
      }
      line = remaining.join('');
    }
    lines.push(line);
  }
  return lines;
}
