import { EXTENSION_LINES, THEMATIC_AREAS } from '../extension-catalog';
import { HttpError } from '../errors';
import { IMPORT_MAX_ROWS, IMPORT_TEXT_LIMIT, importFields, type ImportCandidate, type ImportKind } from './contracts';

export const normalizedLabel = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string[]> = {
  name: ['name', 'nome', 'titulo', 'titulo da acao', 'denominacao', 'nome do bem'], shortName: ['shortName', 'short_name', 'nome curto', 'sigla'],
  description: ['description', 'descricao', 'resumo', 'resumo da acao'], startsAt: ['startsAt', 'starts_at', 'inicio', 'data de inicio', 'data inicial'],
  endsAt: ['endsAt', 'ends_at', 'fim', 'data de fim', 'data de termino', 'data de término', 'data final', 'termino', 'término'], location: ['location', 'local', 'localizacao', 'municipios de realizacao'],
  thematicArea: ['thematicArea', 'thematic_area', 'area tematica', 'area principal'], extensionLine: ['extensionLine', 'extension_line', 'linha de extensao'],
  unitName: ['unitName', 'unidade proponente', 'unidade responsavel'], modality: ['modality', 'modalidade', 'tipo de acao', 'tipo'],
  sourceYear: ['sourceYear', 'ano'], sourceStatus: ['sourceStatus', 'situacao', 'status'], funding: ['funding', 'fonte de financiamento', 'financiamento'],
  assetCode: ['assetCode', 'asset_code', 'tombamento', 'numero de tombamento', 'numero de patrimonio', 'patrimonio', 'tombo'],
  unit: ['unit', 'unidade de medida'], brand: ['brand', 'marca'], model: ['model', 'modelo'], serialNumber: ['serialNumber', 'numero de serie', 'serie'],
  responsibleUnit: ['responsibleUnit', 'unidade responsavel', 'unidade de lotacao'],
  assetLocation: ['assetLocation','asset_location','location','local','localizacao','localizacao fisica','localizacao do bem'],
  responsibleReference: ['responsibleReference','responsible_reference','responsavel indicado na fonte','responsavel documentado'],
  conservationState: ['conservationState','conservation_state','sourceCondition','estado do bem','estado de conservacao','condicao'],
  assetStatus: ['assetStatus','asset_status','situacao patrimonial'],
  origin: ['origin','origem'], destination: ['destination','destino'],
  processReference: ['processReference','process_reference','processo','referencia do processo'],
  responsibilityTerm: ['responsibilityTerm','responsibility_term','termo de responsabilidade'],
  invoiceReference: ['invoiceReference','invoice_reference','nota fiscal','referencia da nota fiscal'],
  sourceReference: ['sourceReference','source_reference','fonte do cadastro','referencia documental','pagina do documento'],
  acquisitionDate: ['acquisitionDate','acquisition_date','data de aquisicao'],
  acquisitionValueCents: ['acquisitionValueCents','acquisition_value_cents','valor em centavos','valor documentado em centavos'],
};
const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', eacute: 'é', ecirc: 'ê', iacute: 'í', oacute: 'ó', ocirc: 'ô', otilde: 'õ', uacute: 'ú', uuml: 'ü', ccedil: 'ç', ordm: 'º', ordf: 'ª', ndash: '–', mdash: '—' };
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) { const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)); return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : ''; }
    const decoded = ENTITIES[entity.toLowerCase()]; return decoded === undefined ? match : entity[0] === entity[0].toUpperCase() && entity.toLowerCase() !== entity ? decoded.toUpperCase() : decoded;
  });
}
function visibleHtml(value: string): string { return value.replace(/<!--[^]*?-->/g, '').replace(/<(script|style|noscript)\b[^>]*>[^]*?<\/\1\s*>/gi, ''); }
const cellText = (value: string) => decodeEntities(value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ' ')).replace(/[\t ]+/g, ' ').trim();
function htmlRecord(content: string): Record<string, unknown> {
  const html = visibleHtml(content), record: Record<string, unknown> = Object.create(null);
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([^]*?)<\/tr\s*>/gi)) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([^]*?)<\/t[dh]\s*>/gi)].map(([, cell]) => cellText(cell));
    for (let index = 0; index + 1 < cells.length; index++) if (cells[index].length < 100 && /:\s*$/.test(cells[index])) record[cells[index].replace(/:\s*$/, '')] = cells[index + 1];
  }
  return Object.keys(record).length ? record : textRecord(cellText(html.replace(/<\/(?:p|div|h\d|tr)>/gi, '\n')));
}
function textRecord(content: string): Record<string, unknown> {
  const record: Record<string, unknown> = Object.create(null), lines = content.split(/\r?\n/).map(line => line.trim());
  const known = new Set(Object.values(ALIASES).flat().map(normalizedLabel));
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^([^:]{1,80}):\s*(.*)$/);
    if (match) record[match[1]] = match[2] || (index + 1 < lines.length && !known.has(normalizedLabel(lines[index + 1].split(':', 1)[0])) ? lines[++index] : '');
  }
  return record;
}
function csvRows(content: string, delimiter: string): string[][] {
  const rows: string[][] = [], row: string[] = []; let cell = '', quoted = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === '"') { if (quoted && content[index + 1] === '"') { cell += '"'; index++; } else if (quoted || !cell) quoted = !quoted; else throw new HttpError(400, 'Aspas inválidas no CSV.', 'import_csv'); }
    else if (!quoted && (character === delimiter || character === '\n' || character === '\r')) {
      row.push(cell); cell = '';
      if (character !== delimiter) { if (row.some(value => value.trim())) rows.push(row.splice(0)); else row.splice(0); if (character === '\r' && content[index + 1] === '\n') index++; }
    } else cell += character;
  }
  if (quoted) throw new HttpError(400, 'Feche as aspas do CSV antes de importar.', 'import_csv');
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
function parseCsv(content: string): Record<string, unknown>[] {
  const firstLine = content.split(/\r?\n/, 1)[0];
  const counts = new Map([[';', 0], [',', 0], ['\t', 0]]); let quoted = false;
  for (let index = 0; index < firstLine.length; index++) {
    if (firstLine[index] === '"') { if (quoted && firstLine[index + 1] === '"') index++; else quoted = !quoted; }
    else if (!quoted && counts.has(firstLine[index])) counts.set(firstLine[index], counts.get(firstLine[index])! + 1);
  }
  const delimiter = Array.from(counts).sort((a, b) => b[1] - a[1])[0][0];
  const [header, ...rows] = csvRows(content, delimiter);
  if (!header || header.length < 2 || new Set(header.map(normalizedLabel)).size !== header.length) throw new HttpError(400, 'Use cabeçalhos distintos e pelo menos duas colunas no CSV.', 'import_csv');
  return rows.map(row => { if (row.length !== header.length) throw new HttpError(400, 'O CSV tem linhas com quantidade diferente de colunas.', 'import_csv'); return Object.fromEntries(header.map((key, index) => [key, row[index]])); });
}
function importedDate(value: string, end: boolean): string {
  const brazil = value.match(/^(\d\d)\/(\d\d)\/(\d{4})$/), date = brazil ? `${brazil[3]}-${brazil[2]}-${brazil[1]}` : value;
  const dayOnly = /^\d{4}-\d\d-\d\d$/.test(date), iso = dayOnly ? `${date}T${end ? '23:59:59.999' : '00:00:00.000'}-03:00` : date;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(iso)) throw new Error('Informe data completa ou data e horário com fuso.');
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number), timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp) || year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error('A data informada não existe.');
  return new Date(timestamp).toISOString();
}
export function validateImportedFields(kind: ImportKind, raw: Record<string, unknown>): { fields: Record<string, string>; problems: Record<string, string>; warnings: string[] } {
  const fields: Record<string, string> = Object.create(null), problems: Record<string, string> = {}, warnings: string[] = [];
  for (const definition of importFields(kind)) {
    if (!Object.hasOwn(raw, definition.key)) continue;
    const value = raw[definition.key];
    if (typeof value !== 'string' && typeof value !== 'number') { problems[definition.key] = 'Use texto neste campo.'; continue; }
    let text = String(value).normalize('NFC').trim();
    if (definition.key === 'assetCode' && typeof value === 'number') warnings.push('Confira o tombamento: números no arquivo podem ter perdido zeros iniciais. Prefira essa coluna como texto.');
    // Operational descriptions can mention contacts. Never copy contact/CPF values
    // into the import receipt or public project metadata automatically.
    const sanitized = text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[contato omitido]').replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[identificador omitido]');
    if (sanitized !== text) { text = sanitized; if (!warnings.includes('Contatos e identificadores pessoais foram omitidos.')) warnings.push('Contatos e identificadores pessoais foram omitidos.'); }
    fields[definition.key] = text;
    if (!text) continue;
    if (text.length > definition.maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) { problems[definition.key] = `Use até ${definition.maximum} caracteres válidos.`; continue; }
    try {
      if (definition.key === 'startsAt' || definition.key === 'endsAt') { fields[definition.key] = importedDate(text, definition.key === 'endsAt'); if (!text.includes('T') && !warnings.includes('Datas sem horário usam o início e o fim do dia em Brasília.')) warnings.push('Datas sem horário usam o início e o fim do dia em Brasília.'); }
      if (definition.key === 'thematicArea') { const area = THEMATIC_AREAS.find(area => normalizedLabel(area.key) === normalizedLabel(text) || normalizedLabel(area.label) === normalizedLabel(text)); if (!area) throw new Error('Escolha uma das áreas temáticas da UFG.'); fields[definition.key] = area.key; }
      if (definition.key === 'extensionLine') { const key = text.match(/^\d{1,2}(?=\D|$)/)?.[0].padStart(2, '0'); if (!key || !EXTENSION_LINES.some(line => line.key === key)) throw new Error('Escolha uma linha de extensão de 01 a 53.'); fields[definition.key] = key; }
      if (definition.key === 'acquisitionDate') { const date = text.match(/^(\d\d)\/(\d\d)\/(\d{4})$/); const normalized = date ? `${date[3]}-${date[2]}-${date[1]}` : text; if (!/^\d{4}-\d\d-\d\d$/.test(normalized) || new Date(`${normalized}T00:00:00Z`).toISOString().slice(0,10) !== normalized) throw new Error('Informe uma data de aquisição válida.'); fields[definition.key] = normalized; }
      if (definition.key === 'acquisitionValueCents' && (!/^\d{1,13}$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > 1000000000000)) throw new Error('Use centavos inteiros explicitamente documentados. Não estime nem converta moeda automaticamente.');
      if (definition.key === 'sourceYear' && !/^(20|21)\d\d$/.test(text)) throw new Error('Informe um ano de quatro dígitos.');
    } catch (error) { problems[definition.key] = error instanceof Error ? error.message : 'Valor inválido.'; }
  }
  if (fields.startsAt && fields.endsAt && !problems.startsAt && !problems.endsAt && fields.endsAt <= fields.startsAt) problems.endsAt = 'O fim deve ser posterior ao início.';
  if (kind === 'asset' && fields.acquisitionValueCents && !['sourceReference','invoiceReference','processReference','responsibilityTerm'].some(key => fields[key]?.trim())) problems.acquisitionValueCents = 'Inclua e selecione uma referência documental para o valor.';
  return { fields, problems, warnings };
}
export function parseImportDocument(kind: ImportKind, content: string, format: string): ImportCandidate[] {
  if (!content.trim() || new TextEncoder().encode(content).byteLength > IMPORT_TEXT_LIMIT) throw new HttpError(413, 'Use um documento textual de até 256 KiB.', 'import_document_limit');
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:BETTER_AUTH_SECRET|SETUP_TOKEN|SYNC_TOKEN|DATABASE_URL)\s*[=:]|\b(?:postgres(?:ql)?):\/\/[^\s]+@|\b(?:sk-proj-|sk-live-|pxs_)[A-Za-z0-9_-]{20,}/i.test(content)) throw new HttpError(400, 'O documento parece conter credenciais. Remova os dados de acesso antes de importar.', 'import_sensitive_content');
  let records: unknown[];
  if (format === 'json') {
    let parsed: unknown; try { parsed = JSON.parse(content); } catch { throw new HttpError(400, 'O JSON não pôde ser lido.', 'import_json'); }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { const root = parsed as Record<string, unknown>; parsed = root[kind === 'project' ? 'projects' : 'items'] ?? parsed; }
    records = Array.isArray(parsed) ? parsed : [parsed];
  } else if (format === 'csv') records = parseCsv(content.replace(/^\uFEFF/, ''));
  else if (format === 'html') records = [htmlRecord(content)];
  else if (format === 'text') records = [textRecord(content)];
  else throw new HttpError(400, 'Use texto, HTML, JSON ou CSV.', 'import_format');
  if (!records.length || records.length > IMPORT_MAX_ROWS) throw new HttpError(400, 'Importe de 1 a 20 registros por documento, conferindo um por vez.', 'import_row_limit');
  return records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new HttpError(400, 'Cada registro precisa ser um objeto com campos identificados.', 'import_record');
    const raw: Record<string, unknown> = Object.create(null);
    for (const definition of importFields(kind)) {
      const aliases = new Set((ALIASES[definition.key] ?? [definition.key]).map(normalizedLabel));
      const values = Object.entries(record).filter(([key]) => aliases.has(normalizedLabel(key)));
      if (values.length > 1 && values.some(([, value]) => String(value) !== String(values[0][1]))) throw new HttpError(400, `Há colunas diferentes para ${definition.label.toLowerCase()}. Confira o documento.`, 'import_ambiguous_field');
      if (values.length) raw[definition.key] = values[0][1];
    }
    const candidate = { key: `row-${index + 1}`, ...validateImportedFields(kind, raw) };
    if (!candidate.fields.name) candidate.problems.name = 'O documento precisa informar um nome ou título.';
    return candidate;
  });
}
