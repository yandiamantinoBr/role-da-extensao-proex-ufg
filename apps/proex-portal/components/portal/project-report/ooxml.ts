// DOCX e XLSX do relatório do projeto, gerados no navegador a partir do mesmo documento da prévia.
// Capa, sumário, seções numeradas, gráficos nativos (editáveis no Word/Excel) e referências no fim.
import { zip } from '../report-export';
import type { Block, ReportDocument } from './document';

export const SERIES_COLORS = ['54216C', 'C25E00'];
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const xml = (value: string) => value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function columnName(index: number): string { let name = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name; return name; }
/** "1.234,5" → 1234.5; outros textos continuam texto. */
export function numericValue(value: string): number | null {
  const text = value.trim();
  if (!/^-?\+?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\+?\d+(,\d+)?$/.test(text)) return null;
  const parsed = Number(text.replace('+', '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) && numericValue(value) === null ? `'${value}` : value;
}

type ChartRefs = { sheet: string; categories: [number, number, number]; series: { name: [number, number]; values: [number, number, number] }[] };
/** Gráfico de colunas agrupadas. Com `refs`, aponta para as células da planilha (XLSX). */
export function chartXml(block: Extract<Block, { kind: 'chart' }>, refs?: ChartRefs): string {
  const sheet = refs ? `'${refs.sheet.replace(/'/g, "''")}'` : 'Dados';
  const strCache = (values: string[]) => `<c:strCache><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${xml(value)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const numCache = (values: number[]) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')}</c:numCache>`;
  const n = block.categories.length;
  const categoryRef = refs ? `${sheet}!$${columnName(refs.categories[0])}$${refs.categories[1]}:$${columnName(refs.categories[0])}$${refs.categories[2]}` : `${sheet}!$A$2:$A$${n + 1}`;
  const series = block.series.map((entry, index) => {
    const ref = refs?.series[index];
    const nameRef = ref ? `${sheet}!$${columnName(ref.name[0])}$${ref.name[1]}` : `${sheet}!$${columnName(index + 1)}$1`;
    const valueRef = ref ? `${sheet}!$${columnName(ref.values[0])}$${ref.values[1]}:$${columnName(ref.values[0])}$${ref.values[2]}` : `${sheet}!$${columnName(index + 1)}$2:$${columnName(index + 1)}$${n + 1}`;
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:strRef><c:f>${xml(nameRef)}</c:f>${strCache([entry.label])}</c:strRef></c:tx>`
      + `<c:spPr><a:solidFill><a:srgbClr val="${SERIES_COLORS[index % SERIES_COLORS.length]}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`
      + `<c:cat><c:strRef><c:f>${xml(categoryRef)}</c:f>${strCache(block.categories)}</c:strRef></c:cat>`
      + `<c:val><c:numRef><c:f>${xml(valueRef)}</c:f>${numCache(entry.values)}</c:numRef></c:val></c:ser>`;
  }).join('');
  const text = (size: number, bold = false) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="292333"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>`;
  return `${XML_HEADER}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:lang val="pt-BR"/><c:roundedCorners val="0"/><c:chart>`
    + `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="1200" b="1"><a:solidFill><a:srgbClr val="3B1753"/></a:solidFill></a:rPr><a:t>${xml(block.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    + `<c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="70"/><c:overlap val="-10"/><c:axId val="50010"/><c:axId val="50020"/></c:barChart>`
    + `<c:catAx><c:axId val="50010"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="BFB6C8"/></a:solidFill></a:ln></c:spPr>${text(900)}<c:crossAx val="50020"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
    + `<c:valAx><c:axId val="50020"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E6E1EB"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${text(900)}<c:crossAx val="50010"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`
    + `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/>${text(900)}</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
    + `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`;
}

// ---------------------------------------------------------------- DOCX

const PAGE_WIDTH = 11906, PAGE_HEIGHT = 16838, MARGIN = 1134, USABLE = PAGE_WIDTH - 2 * MARGIN;

export function toReportDocx(doc: ReportDocument): Blob {
  const relationships: string[] = [];
  const charts: string[] = [];
  let relationId = 10, drawingId = 1;
  const rel = (type: string, target: string, external = false) => { const id = `rId${relationId++}`; relationships.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`); return id; };
  const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${text.split('\n').map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t>`).join('')}</w:r>`;
  const para = (content: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;
  const styled = (text: string, style: string, extra = '') => para(run(text), `<w:pStyle w:val="${style}"/>${extra}`);
  const muted = '<w:color w:val="5B4E66"/>';
  const cellMargins = '<w:tcMar><w:top w:w="70" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar>';
  const cell = (content: string, width: number, fill = '', right = false) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}${cellMargins}</w:tcPr>${content.startsWith('<w:p') ? content : para(content, `<w:spacing w:before="0" w:after="0"/>${right ? '<w:jc w:val="right"/>' : ''}`)}</w:tc>`;
  const table = (widths: number[], rows: string[], borders = true) => `<w:tbl><w:tblPr><w:tblW w:w="${USABLE}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders ? '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D8D3DE"/><w:bottom w:val="single" w:sz="4" w:color="D8D3DE"/><w:insideH w:val="single" w:sz="4" w:color="E6E1EB"/></w:tblBorders>' : ''}</w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>${para('', '<w:spacing w:after="80"/>')}`;
  const widthsOf = (weights: number[]) => { const total = weights.reduce((sum, weight) => sum + weight, 0); const widths = weights.map(weight => Math.floor(USABLE * weight / total)); widths[widths.length - 1] += USABLE - widths.reduce((sum, width) => sum + width, 0); return widths; };

  function block(entry: Block): string {
    switch (entry.kind) {
      case 'paragraph': return para(run(entry.text), '<w:spacing w:after="140"/>');
      case 'note': return para(run(entry.text, `<w:i/>${muted}<w:sz w:val="20"/>`), '<w:spacing w:after="120"/>');
      case 'facts': {
        const widths = widthsOf([1.2, 2.8]);
        return table(widths, entry.items.map(([key, value]) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(run(key, `<w:b/>${muted}<w:sz w:val="20"/>`), widths[0], 'F6F2F8')}${cell(run(value), widths[1])}</w:tr>`));
      }
      case 'metrics': {
        const widths = widthsOf(entry.items.map(() => 1));
        const content = (item: typeof entry.items[number]) => para(run(item.value, '<w:b/><w:color w:val="3B1753"/><w:sz w:val="36"/>'), '<w:spacing w:after="0"/>') + para(run(item.label, '<w:sz w:val="18"/>'), '<w:spacing w:after="0"/>') + (item.detail ? para(run(item.detail, `${muted}<w:sz w:val="16"/>`), '<w:spacing w:after="0"/>') : '');
        return table(widths, [`<w:tr><w:trPr><w:cantSplit/></w:trPr>${entry.items.map((item, index) => `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F6F2F8"/><w:tcBorders><w:top w:val="single" w:sz="12" w:color="54216C"/></w:tcBorders>${cellMargins}</w:tcPr>${content(item)}</w:tc>`).join('')}</w:tr>`], false);
      }
      case 'table': {
        const widths = widthsOf(entry.columns.map(column => column.width ?? 1));
        const header = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${entry.columns.map((column, index) => cell(run(column.label, '<w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/>'), widths[index], '54216C', column.numeric)).join('')}</w:tr>`;
        const rows = entry.rows.map((row, rowIndex) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((value, index) => cell(run(value, '<w:sz w:val="19"/>'), widths[index], rowIndex % 2 ? 'FAF8FB' : '', entry.columns[index]?.numeric)).join('')}</w:tr>`);
        return (entry.title ? styled(entry.title, 'Heading2') : '') + table(widths, [header, ...rows]) + (entry.note ? block({ kind: 'note', text: entry.note }) : '');
      }
      case 'chart': {
        charts.push(chartXml(entry));
        const id = rel('chart', `charts/chart${charts.length}.xml`), cx = Math.round(USABLE * 635), cy = Math.round(cx * 0.48), docId = drawingId++;
        return para(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docId}" name="Gráfico ${docId}" descr="${xml(`${entry.title}: ${entry.series.map(series => `${series.label} ${series.values.join(', ')}`).join('; ')}`)}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${id}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, '<w:keepNext/><w:spacing w:after="60"/>')
          + (entry.note ? block({ kind: 'note', text: entry.note }) : '');
      }
      case 'callout': {
        const content = (entry.title ? para(run(entry.title.toUpperCase(), '<w:b/><w:color w:val="3B1753"/><w:sz w:val="17"/>'), '<w:spacing w:after="60"/>') : '') + entry.text.split(/\n{2,}/).map(part => para(run(part), '<w:spacing w:after="80"/>')).join('');
        return `<w:tbl><w:tblPr><w:tblW w:w="${USABLE}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:left w:val="single" w:sz="24" w:color="FFAA3D"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="${USABLE}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${USABLE}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F6F2F8"/><w:tcMar><w:top w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="220" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar></w:tcPr>${content}</w:tc></w:tr></w:tbl>${para('', '<w:spacing w:after="120"/>')}`;
      }
      case 'timeline': {
        const widths = widthsOf([.9, .9, 4]);
        const monthRow = (month: string) => `<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${USABLE}" w:type="dxa"/><w:gridSpan w:val="3"/>${cellMargins}</w:tcPr>${para(run(month, '<w:b/><w:color w:val="3B1753"/>'), '<w:keepNext/><w:spacing w:before="120" w:after="20"/>')}</w:tc></w:tr>`;
        return table(widths, entry.items.flatMap((item, index) => [...(index === 0 || entry.items[index - 1].month !== item.month ? [monthRow(item.month)] : []), item]).map(item => typeof item === 'string' ? item : `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(run(item.date, '<w:b/><w:sz w:val="19"/>'), widths[0])}${cell(run(item.tag, `${muted}<w:sz w:val="18"/>`), widths[1])}${cell(para(run(item.title, '<w:sz w:val="19"/>'), '<w:spacing w:after="0"/>') + (item.detail ? para(run(item.detail, `${muted}<w:sz w:val="17"/>`), '<w:spacing w:after="0"/>') : ''), widths[2])}</w:tr>`)) + (entry.note ? block({ kind: 'note', text: entry.note }) : '');
      }
      case 'references': return entry.items.map(item => {
        const id = rel('hyperlink', item.url, true);
        return para(run(`[${item.number}] `, '<w:b/><w:color w:val="3B1753"/>') + run(item.title, '<w:b/>') + run(` — ${item.type} · ${item.source}`, muted), '<w:keepNext/><w:spacing w:after="0"/>')
          + para(`<w:hyperlink r:id="${id}" w:history="1">${run(item.url, '<w:rStyle w:val="Hyperlink"/><w:sz w:val="18"/>')}</w:hyperlink>`, '<w:spacing w:after="140"/><w:ind w:left="360"/>');
      }).join('');
    }
  }

  const cover = [
    para(run('PRÓ-REITORIA DE EXTENSÃO · UNIVERSIDADE FEDERAL DE GOIÁS', '<w:b/><w:color w:val="54216C"/><w:sz w:val="18"/><w:spacing w:val="20"/>'), '<w:spacing w:before="1800" w:after="600"/><w:pBdr><w:bottom w:val="single" w:sz="18" w:color="FFAA3D" w:space="8"/></w:pBdr>'),
    styled('RELATÓRIO DO PROJETO', 'Kicker'),
    styled(doc.title, 'Title'),
    styled(doc.projectName, 'Subtitle'),
    ...(doc.subtitle ? [para(run(doc.subtitle, muted), '<w:spacing w:after="600"/>')] : []),
    para(run('Período: ', '<w:b/>') + run(doc.period)),
    para(run('Gerado em: ', '<w:b/>') + run(doc.generatedAt)),
    para(run('Seções: ', '<w:b/>') + run(String(doc.sections.length))),
    para(run('Dados conforme o acesso de quem gerou o relatório no Portal PROEX.', `<w:i/>${muted}<w:sz w:val="18"/>`), '<w:spacing w:before="1200"/>'),
    para('<w:r><w:br w:type="page"/></w:r>'),
  ].join('');
  const contents = styled('Sumário', 'TOCHeading') + doc.sections.map(section =>
    para(`<w:hyperlink w:anchor="secao_${section.number}" w:history="1">${run(`${section.number}. ${section.title}`, '<w:color w:val="292333"/>')}</w:hyperlink>`, '<w:spacing w:after="80"/><w:pBdr><w:bottom w:val="dotted" w:sz="4" w:color="D8D3DE" w:space="2"/></w:pBdr>')).join('')
    + para('<w:r><w:br w:type="page"/></w:r>');
  const body = doc.sections.map(section =>
    para(`<w:bookmarkStart w:id="${section.number}" w:name="secao_${section.number}"/>${run(`${section.number}. ${section.title}`)}<w:bookmarkEnd w:id="${section.number}"/>`, `<w:pStyle w:val="Heading1"/>${section.number > 1 && section.id === 'references' ? '<w:pageBreakBefore/>' : ''}`)
    + section.blocks.map(block).join('')).join('');
  const footer = `${XML_HEADER}<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:color="D8D3DE" w:space="4"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${USABLE}"/></w:tabs></w:pPr>${run(`PROEX UFG · ${doc.projectName}`, '<w:color w:val="5B4E66"/><w:sz w:val="16"/>')}<w:r><w:tab/></w:r>${run('Página ', '<w:sz w:val="16"/>')}<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>${run(' de ', '<w:sz w:val="16"/>')}<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const document = `${XML_HEADER}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><w:body>${cover}${contents}${body}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="${PAGE_WIDTH}" w:h="${PAGE_HEIGHT}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/><w:titlePg/></w:sectPr></w:body></w:document>`;
  const heading = (id: string, name: string, size: number, extra = '', color = '3B1753', level?: number) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/>${extra}${level !== undefined ? `<w:outlineLvl w:val="${level}"/>` : ''}</w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `${XML_HEADER}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:color w:val="292333"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + heading('Title', 'Title', 56, '<w:spacing w:after="160"/>')
    + heading('Subtitle', 'Subtitle', 32, '<w:spacing w:after="120"/>', '292333')
    + heading('Kicker', 'Kicker', 18, '<w:spacing w:after="120"/>', 'C25E00')
    + heading('TOCHeading', 'TOC Heading', 32, '<w:spacing w:after="240"/>')
    + heading('Heading1', 'heading 1', 32, '<w:spacing w:before="360" w:after="160"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:color="FFAA3D" w:space="4"/></w:pBdr>', '3B1753', 0)
    + heading('Heading2', 'heading 2', 23, '<w:spacing w:before="220" w:after="100"/>', '3B1753', 1)
    + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="54216C"/><w:u w:val="single"/></w:rPr></w:style></w:styles>';
  const chartTypes = charts.map((_, index) => `<Override PartName="/word/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('');
  return zip([
    { name: '[Content_Types].xml', data: `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${chartTypes}</Types>` },
    { name: '_rels/.rels', data: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(`${doc.title} — ${doc.projectName}`)}</dc:title><dc:creator>Portal PROEX UFG</dc:creator><dc:language>pt-BR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${doc.generatedIso.slice(0, 19)}Z</dcterms:created></cp:coreProperties>` },
    { name: 'word/document.xml', data: document },
    { name: 'word/_rels/document.xml.rels', data: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer.xml"/>${relationships.join('')}</Relationships>` },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/footer.xml', data: footer },
    ...charts.map((data, index) => ({ name: `word/charts/chart${index + 1}.xml`, data })),
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// ---------------------------------------------------------------- XLSX

type Cell = { value: string | number; style?: number; link?: string };
// Estilos: 0 normal, 1 cabeçalho roxo, 2 título, 3 rótulo, 4 nota, 5 número, 6 texto quebrado, 7 link, 8 seção
const XLSX_STYLES = `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.##"/></numFmts><fonts count="7"><font><sz val="11"/><color rgb="FF292333"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF3B1753"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF5B4E66"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF5B4E66"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF54216C"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FF3B1753"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF54216C"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF6F2F8"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="9"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf><xf fontId="2" applyFont="1"/><xf fontId="3" fillId="3" applyFont="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="4" applyFont="1"><alignment wrapText="1"/></xf><xf numFmtId="164" applyNumberFormat="1"><alignment vertical="top"/></xf><xf applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="5" applyFont="1"/><xf fontId="6" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const SHORT_SHEET: Record<string, string> = { summary: 'Resumo', team: 'Equipe', demands: 'Demandas', materials: 'Materiais', loans: 'Empréstimos', schedule: 'Agenda', campaigns: 'Dinâmicas', timeline: 'Linha do tempo', history: 'Histórico', notes: 'Observações', references: 'Referências' };
function sheetName(number: number, id: string): string {
  return `${number} ${SHORT_SHEET[id] ?? id}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim();
}

export function toReportXlsx(doc: ReportDocument): Blob {
  type Sheet = { name: string; rows: Cell[][]; widths: number[]; charts: { xml: string; row: number; col: number }[]; merges?: string[] };
  const sheets: Sheet[] = [];
  const contents: Cell[][] = [
    [{ value: 'PRÓ-REITORIA DE EXTENSÃO · UNIVERSIDADE FEDERAL DE GOIÁS', style: 3 }],
    [{ value: doc.title, style: 2 }],
    [{ value: doc.projectName, style: 8 }],
    ...(doc.subtitle ? [[{ value: doc.subtitle }]] : []),
    [],
    [{ value: 'Período', style: 3 }, { value: doc.period }],
    [{ value: 'Gerado em', style: 3 }, { value: doc.generatedAt }],
    [{ value: 'Origem', style: 3 }, { value: 'Portal PROEX, conforme o acesso de quem gerou o relatório' }],
    [],
    [{ value: 'Sumário', style: 8 }],
    ...doc.sections.map(section => [{ value: section.number, style: 5 }, { value: section.title, style: 7, link: sheetName(section.number, section.id) }]),
  ];
  sheets.push({ name: 'Capa', rows: contents, widths: [18, 80], charts: [] });
  for (const section of doc.sections) {
    const rows: Cell[][] = [[{ value: `${section.number}. ${section.title}`, style: 2 }], []];
    const charts: Sheet['charts'] = [];
    let widths = [16, 28, 18, 18, 18, 30];
    const name = sheetName(section.number, section.id);
    for (const entry of section.blocks) {
      if (entry.kind === 'paragraph') rows.push([{ value: entry.text, style: 6 }]);
      else if (entry.kind === 'note') rows.push([{ value: entry.text, style: 4 }]);
      else if (entry.kind === 'callout') { if (entry.title) rows.push([{ value: entry.title, style: 8 }]); for (const part of entry.text.split(/\n{2,}/)) rows.push([{ value: safeText(part), style: 6 }]); }
      else if (entry.kind === 'facts') for (const [key, value] of entry.items) rows.push([{ value: key, style: 3 }, { value }]);
      else if (entry.kind === 'metrics') for (const item of entry.items) rows.push([{ value: item.label, style: 3 }, { value: numericValue(item.value) ?? item.value, style: numericValue(item.value) === null ? 0 : 5 }, ...(item.detail ? [{ value: item.detail, style: 4 }] : [])]);
      else if (entry.kind === 'table') {
        if (entry.title) rows.push([{ value: entry.title, style: 8 }]);
        rows.push(entry.columns.map(column => ({ value: column.label, style: 1 })));
        for (const row of entry.rows) rows.push(row.map((value, index) => { const number = entry.columns[index]?.numeric ? numericValue(value) : null; return number === null ? { value: safeText(value), style: 6 } : { value: number, style: 5 }; }));
        if (entry.note) rows.push([{ value: entry.note, style: 4 }]);
        widths = widths.map((width, index) => index < entry.columns.length ? Math.max(width, Math.min(60, 10 + (entry.columns[index].width ?? 1) * 12)) : width);
      } else if (entry.kind === 'chart') {
        rows.push([{ value: entry.title, style: 8 }]);
        const head = rows.length + 1;
        rows.push([{ value: 'Mês', style: 1 }, ...entry.series.map(series => ({ value: series.label, style: 1 }))]);
        entry.categories.forEach((category, index) => rows.push([{ value: category }, ...entry.series.map(series => ({ value: series.values[index], style: 5 }))]));
        const last = rows.length;
        charts.push({ row: head - 1, col: entry.series.length + 2, xml: chartXml(entry, { sheet: name, categories: [0, head + 1, last], series: entry.series.map((_, index) => ({ name: [index + 1, head] as [number, number], values: [index + 1, head + 1, last] as [number, number, number] })) }) });
        if (entry.note) rows.push([{ value: entry.note, style: 4 }]);
        const chartRows = 16 - entry.categories.length;
        for (let index = 0; index < chartRows; index++) rows.push([]);
      } else if (entry.kind === 'timeline') {
        rows.push([{ value: 'Data', style: 1 }, { value: 'Tipo', style: 1 }, { value: 'Acontecimento', style: 1 }, { value: 'Detalhe', style: 1 }]);
        let month = '';
        for (const item of entry.items) {
          if (item.month !== month) { month = item.month; rows.push([{ value: month, style: 8 }]); }
          rows.push([{ value: item.date }, { value: item.tag }, { value: safeText(item.title), style: 6 }, { value: safeText(item.detail ?? ''), style: 6 }]);
        }
        if (entry.note) rows.push([{ value: entry.note, style: 4 }]);
        widths = [14, 14, 60, 40, 18, 18];
      } else if (entry.kind === 'references') {
        rows.push([{ value: 'Nº', style: 1 }, { value: 'Título', style: 1 }, { value: 'Tipo', style: 1 }, { value: 'Origem', style: 1 }, { value: 'Endereço', style: 1 }]);
        for (const item of entry.items) rows.push([{ value: item.number, style: 5 }, { value: safeText(item.title), style: 6 }, { value: item.type }, { value: item.source }, { value: item.url, style: 7, link: item.url }]);
        widths = [8, 42, 14, 22, 70, 18];
      }
      rows.push([]);
    }
    if (section.id === 'summary' || section.id === 'notes') widths = [26, 90, 22, 18, 18, 18];
    sheets.push({ name, rows, widths, charts });
  }

  const files: { name: string; data: string }[] = [];
  const contentTypes: string[] = [];
  let chartCount = 0;
  sheets.forEach((sheet, index) => {
    const number = index + 1, links: string[] = [], linkRels: string[] = [];
    const data = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, column) => {
      const ref = `${columnName(column)}${rowIndex + 1}`;
      if (cell.link) {
        if (/^https?:/.test(cell.link)) { const id = `rIdL${links.length + 1}`; linkRels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(cell.link)}" TargetMode="External"/>`); links.push(`<hyperlink ref="${ref}" r:id="${id}"/>`); }
        else links.push(`<hyperlink ref="${ref}" location="${xml(`'${cell.link.replace(/'/g, "''")}'!A1`)}" display="${xml(String(cell.value))}"/>`);
      }
      return typeof cell.value === 'number' && Number.isFinite(cell.value)
        ? `<c r="${ref}"${cell.style ? ` s="${cell.style}"` : ''}><v>${cell.value}</v></c>`
        : `<c r="${ref}" t="inlineStr"${cell.style ? ` s="${cell.style}"` : ''}><is><t xml:space="preserve">${xml(String(cell.value))}</t></is></c>`;
    }).join('')}</row>`).join('');
    const drawingRels: string[] = [];
    let drawing = '';
    if (sheet.charts.length) {
      const anchors = sheet.charts.map(chart => {
        chartCount++;
        files.push({ name: `xl/charts/chart${chartCount}.xml`, data: chart.xml });
        contentTypes.push(`<Override PartName="/xl/charts/chart${chartCount}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
        drawingRels.push(`<Relationship Id="rIdC${chartCount}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartCount}.xml"/>`);
        return `<xdr:twoCellAnchor><xdr:from><xdr:col>${chart.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chart.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${chart.col + 6}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chart.row + 16}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${chartCount + 1}" name="Gráfico ${chartCount}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdC${chartCount}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
      }).join('');
      files.push({ name: `xl/drawings/drawing${number}.xml`, data: `${XML_HEADER}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>` });
      files.push({ name: `xl/drawings/_rels/drawing${number}.xml.rels`, data: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels.join('')}</Relationships>` });
      contentTypes.push(`<Override PartName="/xl/drawings/drawing${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      drawing = '<drawing r:id="rIdD"/>';
    }
    const sheetRels = [...linkRels, ...(drawing ? [`<Relationship Id="rIdD" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${number}.xml"/>`] : [])];
    files.push({ name: `xl/worksheets/sheet${number}.xml`, data: `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ''} showGridLines="0"/></sheetViews><cols>${sheet.widths.map((width, column) => `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData>${links.length ? `<hyperlinks>${links.join('')}</hyperlinks>` : ''}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>${xml(`&L${doc.projectName.replace(/&/g, '&&')}&RPágina &P de &N`)}</oddFooter></headerFooter>${drawing}</worksheet>` });
    if (sheetRels.length) files.push({ name: `xl/worksheets/_rels/sheet${number}.xml.rels`, data: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels.join('')}</Relationships>` });
  });
  return zip([
    { name: '[Content_Types].xml', data: `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${contentTypes.join('')}</Types>` },
    { name: '_rels/.rels', data: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: XLSX_STYLES },
    ...files,
  ]);
}
