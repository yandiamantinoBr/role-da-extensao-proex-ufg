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
function zip(files: { name: string; data: string }[], mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'): Blob {
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
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: mime });
}

/** Documents use the same chosen columns and filtered rows as the spreadsheet. */
export function documentRows(columns: ExportColumn[], rows: ExportRow[], display: (row: ExportRow, key: string) => unknown): string[][] {
  if (!columns.length || rows.length > 2000) throw new Error('Para PDF ou Word, selecione colunas e até 2.000 linhas. Divida pelos filtros ou use Excel para o conjunto completo.');
  let characters = 0;
  return rows.map(row => columns.map(column => {
    const value = String(display(row, column.key) ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    characters += value.length;
    if (characters > 500000) throw new Error('O documento ficou muito extenso. Reduza o período ou as colunas e tente novamente.');
    return value;
  }));
}

/** Editable Word report. Wide datasets use labeled records to retain readable type. */
export function toDocx(title: string, columns: ExportColumn[], rows: ExportRow[], display: (row: ExportRow, key: string) => unknown, info: [string, string][]): Blob {
  const data = documentRows(columns, rows, display);
  const run = (text: string, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}${text.split(/\r?\n/).map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t>`).join('')}</w:r>`;
  const paragraph = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${run(text)}</w:p>`;
  const numeric = (column: ExportColumn) => column.numeric ? '<w:jc w:val="right"/>' : '';
  const width = Math.floor(9360 / Math.max(columns.length, 1));
  const cell = (text: string, column: ExportColumn, heading = false) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${heading ? '<w:shd w:fill="EDE7F2"/>' : ''}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr>${numeric(column)}<w:spacing w:after="20"/></w:pPr>${run(text, heading)}</w:p></w:tc>`;
  const records = columns.length <= 6
    ? `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:bottom w:val="single" w:sz="4" w:color="D8D3DE"/><w:insideH w:val="single" w:sz="4" w:color="E6E1EB"/></w:tblBorders></w:tblPr><w:tblGrid>${columns.map(() => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${columns.map(column => cell(column.label, column, true)).join('')}</w:tr>${data.map(row => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((value, index) => cell(value, columns[index])).join('')}</w:tr>`).join('')}</w:tbl>`
    : data.map((row, index) => `${paragraph(`Registro ${index + 1}`, 'Heading2')}${row.map((value, column) => `<w:p><w:pPr>${column < row.length - 1 ? '<w:keepNext/>' : ''}<w:keepLines/><w:spacing w:after="70"/></w:pPr>${run(`${columns[column].label}: `, true)}${run(value)}</w:p>`).join('')}`).join('');
  const body = `${paragraph(title, 'Title')}${paragraph('Pró-Reitoria de Extensão da Universidade Federal de Goiás', 'Subtitle')}${paragraph(`${data.length} registro(s) no recorte selecionado. Os campos e filtros correspondem à consulta que gerou este relatório.`)}${info.map(([label, value]) => `<w:p><w:pPr><w:spacing w:after="50"/></w:pPr>${run(`${label}: `, true)}${run(value)}</w:p>`).join('')}${paragraph('Registros', 'Heading1')}${records}`;
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zip([
    { name: '[Content_Types].xml', data: `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>` },
    { name: '_rels/.rels', data: `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', data: `${header}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440" w:header="360" w:footer="360"/></w:sectPr></w:body></w:document>` },
    { name: 'word/_rels/document.xml.rels', data: `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer.xml"/></Relationships>` },
    { name: 'word/styles.xml', data: `${header}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="000000"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="120"/></w:pPr><w:rPr><w:sz w:val="40"/><w:b/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="22"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="000000"/></w:rPr></w:style></w:styles>` },
    { name: 'word/footer.xml', data: `${header}<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run('PROEX UFG | Página ')}<w:fldSimple w:instr="PAGE"/>${run(' de ')}<w:fldSimple w:instr="NUMPAGES"/></w:p></w:ftr>` },
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
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
