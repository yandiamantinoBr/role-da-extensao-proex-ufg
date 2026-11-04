import { documentRows, type ExportColumn, type ExportRow } from './report-export';
import type { Color, PDFFont, PDFImage, PDFPage } from 'pdf-lib';

const PROJECT_MARK_PATHS = {
  'role-da-extensao': '/brand/role-da-extensao.png',
  'conpeex-2026': '/brand/conpeex-2026.png',
} as const;

type ProjectMark = keyof typeof PROJECT_MARK_PATHS;
export type ReportPdfPresentation = {
  projectName?: string;
  projectBrand?: ProjectMark;
  metrics?: readonly { label: string; value: number | null; detail?: string }[];
};

type Marks = Partial<Record<'proex' | 'ufg' | ProjectMark, Uint8Array>>;
type Options = { fontBytes?: Uint8Array; brandBytes?: Marks; presentation?: ReportPdfPresentation };

const assetRequests = new Map<string, Promise<Uint8Array>>();
function localAsset(path: string, limit: number): Promise<Uint8Array> {
  const saved = assetRequests.get(path);
  if (saved) return saved;
  const request = fetch(path, { redirect: 'error' }).then(async response => {
    if (!response.ok) throw new Error('Não foi possível carregar os recursos do PDF. Tente novamente.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error('Um recurso do PDF excedeu o tamanho esperado.');
    return bytes;
  }).catch(error => { assetRequests.delete(path); throw error; });
  assetRequests.set(path, request);
  return request;
}

async function localMarks(projectBrand: ProjectMark | undefined): Promise<Marks> {
  const [proex, ufg, project] = await Promise.all([
    localAsset('/brand/proex.png', 256 * 1024).catch(() => undefined),
    localAsset('/brand/ufg-white.png', 256 * 1024).catch(() => undefined),
    projectBrand ? localAsset(PROJECT_MARK_PATHS[projectBrand], 256 * 1024).catch(() => undefined) : undefined,
  ]);
  return projectBrand ? { proex, ufg, [projectBrand]: project } : { proex, ufg };
}

/** Generate the document locally. Only bundled fonts and official marks are requested. */
export async function toPdf(
  title: string,
  columns: ExportColumn[],
  rows: ExportRow[],
  display: (row: ExportRow, key: string) => unknown,
  info: [string, string][],
  options?: Options,
): Promise<Blob> {
  const data = documentRows(columns, rows, display);
  const projectName = options?.presentation?.projectName?.trim() || '';
  const selectedBrand = options?.presentation?.projectBrand;
  const projectBrand = projectName && selectedBrand && Object.hasOwn(PROJECT_MARK_PATHS, selectedBrand) ? selectedBrand : undefined;
  const [{ PDFDocument, rgb, StandardFonts }, fontkit, bytes, marks] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
    options?.fontBytes ?? localAsset('/fonts/NotoSans-Regular.ttf', 2 * 1024 * 1024),
    options?.brandBytes ?? (typeof window === 'undefined' ? {} : localMarks(projectBrand)),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit.default);
  const projectBytes = projectBrand ? marks[projectBrand] : undefined;
  const [font, bold, proex, ufg, projectMark] = await Promise.all([
    pdf.embedFont(bytes, { subset: true }),
    pdf.embedFont(StandardFonts.HelveticaBold),
    marks.proex ? pdf.embedPng(marks.proex).catch(() => undefined) : undefined,
    marks.ufg ? pdf.embedPng(marks.ufg).catch(() => undefined) : undefined,
    projectBytes ? pdf.embedPng(projectBytes).catch(() => undefined) : undefined,
  ]);
  const supported = new Set(font.getCharacterSet());
  const boldSupported = new Set(bold.getCharacterSet());
  const text = (value: string) => Array.from(value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g, '')).map(char =>
    char === '\n' || supported.has(char.codePointAt(0)!) ? char : '[U+' + char.codePointAt(0)!.toString(16).toUpperCase() + ']').join('');
  const strongFont = (value: string) => Array.from(value).every(char => char === '\n' || boldSupported.has(char.codePointAt(0)!)) ? bold : font;

  const width = 595.28, height = 841.89, margin = 42, usable = width - 2 * margin, bottom = 52;
  const ink = rgb(41 / 255, 35 / 255, 51 / 255), purple = rgb(59 / 255, 23 / 255, 83 / 255);
  const orange = rgb(1, 170 / 255, 61 / 255), white = rgb(1, 1, 1);
  const muted = rgb(.34, .29, .38), border = rgb(.86, .82, .89), tint = rgb(.96, .94, .97);
  const wash = rgb(.98, .97, .985);
  const projectSheet = Boolean(projectName && data.length === 1);
  const mainTitle = projectName || title;
  let page: PDFPage;
  let y = 0;

  function paint(value: string, x: number, top: number, size: number, color: Color = ink, face = font) {
    page.drawText(value, { x, y: top - size, size, font: face, color });
  }

  function rule(top: number, color = border, thickness = .65) {
    page.drawLine({ start: { x: margin, y: top }, end: { x: width - margin, y: top }, color, thickness });
  }

  function logo(image: PDFImage, left: number, top: number, maxWidth: number, maxHeight: number) {
    const size = image.scaleToFit(maxWidth, maxHeight);
    page.drawImage(image, {
      x: left + (maxWidth - size.width) / 2, y: top - (maxHeight + size.height) / 2, ...size,
    });
  }

  function addPage() {
    if (pdf.getPageCount() >= 300) throw new Error('O relatório ultrapassou 300 páginas. Reduza o recorte e tente novamente.');
    const first = !pdf.getPageCount();
    page = pdf.addPage([width, height]);
    page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: purple });
    if (first) {
      if (proex) logo(proex, margin, height - 29, 100, 52);
      else paint('PROEX', margin, height - 40, 24, purple, bold);
      page.drawRectangle({ x: width - margin - 90, y: height - 82, width: 90, height: 54, color: purple });
      if (ufg) logo(ufg, width - margin - 81, height - 34, 72, 42);
      else paint('UFG', width - margin - 64, height - 42, 21, white, bold);
      const middle = margin + 120;
      paint('PRÓ-REITORIA DE EXTENSÃO', middle, height - 43, 9, purple, bold);
      paint('Universidade Federal de Goiás', middle, height - 58, 9, muted);
      rule(height - 96, orange, 2);
      y = height - 117;
    } else {
      paint('PROEX / UFG', margin, height - 25, 9, purple, bold);
      const running = fit(text(mainTitle).replace(/\s+/g, ' '), font, 9, usable - 105);
      paint(running, margin + 105, height - 25, 9, muted);
      rule(height - 44);
      y = height - 61;
    }
    return page;
  }

  const ensure = (required: number) => { if (y - required < bottom) addPage(); };
  const heading = (value: string, next = 34) => {
    ensure(26 + next);
    paint(value, margin, y, 13, purple, bold);
    y -= 25;
  };

  pdf.setTitle(projectName ? projectName + ' - ' + title : title);
  pdf.setAuthor('PROEX UFG');
  pdf.setSubject('Relatório do recorte autorizado no Portal PROEX');
  const firstPage = addPage();

  paint(projectName ? 'FICHA DO PROJETO' : 'RELATÓRIO INSTITUCIONAL', margin, y, 10, purple, bold);
  y -= 21;
  const heroTop = y, heroWidth = projectMark ? usable - 146 : usable;
  if (projectMark) {
    const x = width - margin - 128;
    const dark = projectBrand === 'role-da-extensao';
    firstPage.drawRectangle({ x, y: heroTop - 65, width: 128, height: 65, color: dark ? purple : wash, borderColor: dark ? purple : border, borderWidth: .65 });
    logo(projectMark, x + 6, heroTop - 4, 116, 57);
  }
  const hero = text(mainTitle), heroFace = strongFont(hero);
  const heroSize = projectMark && wrap(hero, heroFace, 27, heroWidth).length > 2 ? 22 : 27;
  const heroLines = wrap(hero, heroFace, heroSize, heroWidth);
  heroLines.slice(0, 3).forEach((line, index) => {
    const shown = index === 2 && heroLines.length > 3 ? fit(line + '…', heroFace, heroSize, heroWidth) : line;
    paint(shown, margin, y, heroSize, purple, heroFace);
    y -= heroSize + 6;
  });
  if (projectName) {
    paint(fit(text(title).replace(/\s+/g, ' '), font, 10, heroWidth), margin, y - 3, 10, muted);
    y -= 18;
  }
  if (projectMark) y = Math.min(y, heroTop - 65);
  y -= 12;

  const metrics = options?.presentation?.metrics?.slice(0, 4) ?? [];
  const overview = metrics.length ? metrics : [{ label: data.length === 1 ? 'Registro no recorte' : 'Registros no recorte', value: data.length }];
  const metricWidth = (usable - (overview.length - 1) * 9) / overview.length;
  const metricCards = overview.map(metric => {
    const available = metric.value !== null && Number.isFinite(metric.value);
    const value = available ? Number(metric.value).toLocaleString('pt-BR', { maximumFractionDigits: 20 }) : '—';
    const label = text(metric.label), face = strongFont(label);
    return {
      value, face, lines: wrap(label, face, 9.5, metricWidth - 22),
      detail: metric.detail?.trim() || (available ? '' : 'Não informado'),
    };
  });
  const metricHeight = 53 + Math.max(...metricCards.map(metric => metric.lines.length * 12 + (metric.detail ? 15 : 0)));
  ensure(metricHeight);
  metricCards.forEach((metric, index) => {
    const x = margin + index * (metricWidth + 9);
    page.drawRectangle({ x, y: y - metricHeight, width: metricWidth, height: metricHeight, color: tint, borderColor: border, borderWidth: .65 });
    page.drawRectangle({ x, y: y - 2, width: metricWidth, height: 2, color: purple });
    const value = text(metric.value), face = strongFont(value);
    const size = Math.max(10, Math.min(25, 25 * (metricWidth - 22) / Math.max(1, face.widthOfTextAtSize(value, 25))));
    paint(fit(value, face, size, metricWidth - 22), x + 11, y - 11, size, purple, face);
    metric.lines.forEach((line, row) => paint(line, x + 11, y - 45 - row * 12, 9.5, ink, metric.face));
    if (metric.detail) paint(fit(text(metric.detail).replace(/\s+/g, ' '), font, 8, metricWidth - 22), x + 11, y - 47 - metric.lines.length * 12, 8, muted);
  });
  y -= metricHeight + 24;

  /**
   * Reuse one row painter for metadata, short tables and wide records. A row
   * that fits on a fresh page stays together. Larger rows continue with the
   * appropriate heading repeated by their caller.
   */
  function tableRow(values: string[], widths: number[], aligns: (boolean | undefined)[], background: Color, onBreak: () => void, isHeader = false) {
    const size = isHeader ? 9.5 : 10, leading = 14;
    const padding = projectSheet && !isHeader ? 6 : 9;
    const faces = values.map(value => isHeader ? strongFont(value) : font);
    const cells = values.map((value, index) => wrap(value, faces[index], size, widths[index] - 2 * padding));
    const total = Math.max(1, ...cells.map(lines => lines.length));
    const room = () => Math.floor((y - bottom - 2 * padding) / leading);
    if (!isHeader && (room() < 1 || (room() < total && total * leading + 2 * padding <= height - 160))) onBreak();
    for (let offset = 0; offset < total;) {
      if (room() < 1) onBreak();
      const count = Math.min(total - offset, Math.max(1, room()));
      const block = count * leading + 2 * padding;
      page.drawRectangle({ x: margin, y: y - block, width: usable, height: block, color: background });
      let x = margin;
      cells.forEach((lines, index) => {
        const face = faces[index], alignRight = aligns[index];
        lines.slice(offset, offset + count).forEach((line, row) => {
          const position = alignRight ? x + widths[index] - padding - face.widthOfTextAtSize(line, size) : x + padding;
          paint(line, position, y - padding - row * leading, size, isHeader ? white : ink, face);
        });
        x += widths[index];
      });
      y -= block;
      rule(y);
      offset += count;
    }
  }

  const context = info.filter(([label, value]) => value.trim() && value.trim() !== '—'
    && !(label === 'Relatório' && value === title)
    && !(label === 'Linhas' && value === String(data.length) && (projectSheet || !metrics.length))
    && !(label === 'Recorte' && value === projectName && heroLines.length <= 3));
  if (context.length) {
    const widths = [120, usable - 120];
    heading('Sobre o recorte');
    context.forEach(([label, value], index) => {
      tableRow([text(label), text(value)], widths, [], index % 2 ? white : wash, () => {
        addPage();
        heading('Sobre o recorte (continuação)');
      });
    });
    y -= 23;
  }

  if (!data.length) {
    heading('Registros do relatório');
    paint('Nenhum registro corresponde ao recorte selecionado.', margin, y, 10, muted);
  } else if (columns.length <= 6 && !projectName) {
    const weights = columns.map(column => column.numeric ? .8 : 1.15);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const widths = weights.map(weight => weight * usable / totalWeight);
    const numeric = columns.map(column => column.numeric);
    const headers = columns.map(column => text(column.label));
    const headerHeight = Math.max(...headers.map((label, index) => wrap(label, strongFont(label), 9.5, widths[index] - 18).length)) * 14 + 18;
    const tableHeading = (continued = false) => {
      heading(continued ? 'Registros do relatório (continuação)' : 'Registros do relatório', headerHeight + 32);
      tableRow(headers, widths, numeric, purple, addPage, true);
    };
    tableHeading();
    data.forEach((row, index) => tableRow(row.map(value => text(value.trim() ? value : '—')), widths, numeric, index % 2 ? wash : white, () => {
      addPage();
      tableHeading(true);
    }));
  } else {
    const widths = [171, usable - 171];
    data.forEach((row, index) => {
      const label = projectSheet ? 'Dados do projeto' : 'Registro ' + (index + 1);
      heading(label, 64);
      tableRow(['Campo', 'Informação'], widths, [], purple, addPage, true);
      row.forEach((value, column) => tableRow([text(columns[column].label), text(value.trim() ? value : 'Não informado')], widths, [], column % 2 ? wash : white, () => {
        addPage();
        heading(label + ' (continuação)', 64);
        tableRow(['Campo', 'Informação'], widths, [], purple, addPage, true);
      }));
      y -= 20;
    });
  }

  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    page = item;
    rule(39);
    paint('PORTAL PROEX / UFG', margin, 31, 8, muted, bold);
    const number = 'Página ' + (index + 1) + ' de ' + pages.length;
    paint(number, width - margin - font.widthOfTextAtSize(number, 8), 31, 8, muted);
  });
  const output = await pdf.save();
  return new Blob([output as BlobPart], { type: 'application/pdf' });
}

function fit(value: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  const chars = Array.from(value);
  let low = 0, high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (font.widthOfTextAtSize(chars.slice(0, middle).join('') + '…', size) <= width) low = middle;
    else high = middle - 1;
  }
  return chars.slice(0, low).join('') + '…';
}

function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      const joined = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(joined, size) <= width) { line = joined; continue; }
      if (line) lines.push(line);
      const chars = Array.from(word);
      let start = 0;
      while (start < chars.length) {
        let low = 1, high = Math.min(chars.length - start, 16);
        const prefix = (length: number) => chars.slice(start, start + length).join('');
        while (high < chars.length - start && font.widthOfTextAtSize(prefix(high), size) <= width) {
          low = high;
          high = Math.min(chars.length - start, high * 2);
        }
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (font.widthOfTextAtSize(prefix(middle), size) <= width) low = middle;
          else high = middle - 1;
        }
        line = prefix(low);
        start += low;
        if (start < chars.length) lines.push(line);
      }
    }
    lines.push(line);
  }
  return lines;
}
