// Exportações da central de relatórios, geradas no navegador a partir das linhas já
// filtradas: CSV para planilhas, XLSX nativo (zip sem compressão) e JSON.
export type ExportColumn = { key: string; label: string; numeric?: boolean };
export type ExportRow = Record<string, unknown>;

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Fórmulas começando com = + - @ viram texto para não executar nada ao abrir no Excel.
function safeText(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) && !/^-?\d+([.,]\d+)?$/.test(text) ? `'${text}` : text;
}

export function toCsv(columns: ExportColumn[], rows: ExportRow[], display: (row: ExportRow, key: string) => unknown): Blob {
  const cell = (value: unknown) => { const text = safeText(value); return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const lines = [columns.map(column => cell(column.label)).join(';'), ...rows.map(row => columns.map(column => {
    const value = display(row, column.key);
    return column.numeric && typeof value === 'number' ? String(value).replace('.', ',') : cell(value);
  }).join(';'))];
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

export function toJson(meta: Record<string, unknown>, columns: ExportColumn[], rows: ExportRow[], display: (row: ExportRow, key: string) => unknown): Blob {
  const data = rows.map(row => Object.fromEntries(columns.map(column => [column.key, display(row, column.key) ?? null])));
  return new Blob([JSON.stringify({ ...meta, colunas: columns.map(({ key, label }) => ({ key, label })), linhas: data }, null, 2)], { type: 'application/json' });
}

const xml = (value: string) => value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function columnName(index: number): string { let name = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name; return name; }

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; data: string }[]): Blob {
  const encoder = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), data = encoder.encode(file.data), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true); entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, data); central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Planilha com cabeçalho fixo, filtro automático e uma aba de informações do recorte. */
export function toXlsx(sheetName: string, columns: ExportColumn[], rows: ExportRow[], display: (row: ExportRow, key: string) => unknown, info: [string, string][]): Blob {
  const cell = (ref: string, value: unknown, style = 0) => typeof value === 'number' && Number.isFinite(value)
    ? `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`
    : `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(safeText(value))}</t></is></c>`;
  const widths = columns.map(column => Math.min(60, Math.max(column.label.length, ...rows.slice(0, 300).map(row => String(display(row, column.key) ?? '').length)) + 2));
  const last = columnName(Math.max(columns.length - 1, 0));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData><row r="1">${columns.map((column, index) => cell(`${columnName(index)}1`, column.label, 1)).join('')}</row>${rows.map((row, rowIndex) => `<row r="${rowIndex + 2}">${columns.map((column, index) => { const value = display(row, column.key); return cell(`${columnName(index)}${rowIndex + 2}`, column.numeric && value !== '' && value !== null ? Number(value) : value); }).join('')}</row>`).join('')}</sheetData>${columns.length ? `<autoFilter ref="A1:${last}${rows.length + 1}"/>` : ''}</worksheet>`;
  const about = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="70" customWidth="1"/></cols><sheetData>${info.map(([label, value], index) => `<row r="${index + 1}">${cell(`A${index + 1}`, label, 1)}${cell(`B${index + 1}`, value)}</row>`).join('')}</sheetData></worksheet>`;
  const name = xml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Relatório');
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/><sheet name="Sobre o recorte" sheetId="2" r:id="rId2"/></sheets>${columns.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$1:$${last}$${rows.length + 1}</definedName></definedNames>` : ''}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF54216C"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    { name: 'xl/worksheets/sheet2.xml', data: about },
  ]);
}
