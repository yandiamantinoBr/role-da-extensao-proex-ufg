import { HttpError } from './errors';

/** Descriptive, private metadata. None of these fields changes stock, ACL or legal custody. */
export const ASSET_TEXT_FIELDS = [
  ['brand', 'brand', 'Marca', 120], ['model', 'model', 'Modelo', 160],
  ['serialNumber', 'serial_number', 'Número de série', 160], ['assetLocation', 'asset_location', 'Localização do bem', 300],
  ['responsibleUnit', 'responsible_unit', 'Unidade responsável na fonte', 240],
  ['responsibleReference', 'responsible_reference', 'Responsável indicado na fonte', 240],
  ['conservationState', 'conservation_state', 'Estado de conservação observado', 200],
  ['assetStatus', 'asset_status', 'Situação patrimonial informada', 160],
  ['origin', 'origin', 'Origem informada', 240], ['destination', 'destination', 'Destino informado', 240],
  ['processReference', 'process_reference', 'Referência do processo', 120],
  ['responsibilityTerm', 'responsibility_term', 'Termo de responsabilidade', 160],
  ['invoiceReference', 'invoice_reference', 'Referência da nota fiscal', 160],
  ['sourceReference', 'source_reference', 'Fonte do cadastro / página do documento', 500],
] as const;
export const ASSET_METADATA_KEYS = [...ASSET_TEXT_FIELDS.map(field => field[0]), 'acquisitionDate', 'acquisitionValueCents'] as const;
export const ASSET_METADATA_COLUMNS = [...ASSET_TEXT_FIELDS.map(field => field[1]), 'acquisition_date', 'acquisition_value_cents'] as const;
export type AssetMetadata = Record<typeof ASSET_TEXT_FIELDS[number][0], string | null> & { acquisitionDate: string | null; acquisitionValueCents: number | null };
export function assetMetadata(input: Record<string, unknown>, previous: Record<string, unknown> = {}): AssetMetadata {
  const output: Record<string, string | number | null> = {};
  for (const [key, column, label, max] of ASSET_TEXT_FIELDS) {
    const raw = input[key] === undefined ? previous[column] ?? null : input[key];
    if (raw === null || raw === '') { output[key] = null; continue; }
    if (typeof raw !== 'string') throw new HttpError(400, `Informe ${label.toLocaleLowerCase('pt-BR')} como texto.`, 'invalid_asset_metadata');
    const value = raw.normalize('NFC').trim();
    if (value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new HttpError(400, `${label} deve ter até ${max} caracteres válidos.`, 'invalid_asset_metadata');
    output[key] = value || null;
  }
  const date = input.acquisitionDate === undefined ? previous.acquisition_date ?? null : input.acquisitionDate;
  if (date !== null && date !== '') {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new HttpError(400, 'Informe uma data de aquisição válida, ou deixe ausente.', 'invalid_asset_date');
    output.acquisitionDate = date;
  } else output.acquisitionDate = null;
  const cents = input.acquisitionValueCents === undefined ? previous.acquisition_value_cents ?? null : input.acquisitionValueCents;
  if (cents !== null && cents !== '') {
    if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents < 0 || cents > 1_000_000_000_000) throw new HttpError(400, 'Informe o valor documentado em centavos inteiros, ou deixe ausente.', 'invalid_asset_value');
    if (!output.sourceReference && !output.invoiceReference && !output.processReference && !output.responsibilityTerm) throw new HttpError(400, 'O valor precisa de referência da fonte. Não estime um valor ausente.', 'asset_value_source_required');
    output.acquisitionValueCents = cents;
  } else output.acquisitionValueCents = null;
  return output as AssetMetadata;
}
export function assetMetadataValues(metadata: AssetMetadata): (string | number | null)[] { return ASSET_METADATA_KEYS.map(key => metadata[key]); }
/** UI decimal input to exact cents; no guessing of thousands separators or missing values. */
export function assetCurrencyCents(value: string): number | null {
  const text = value.trim(); if (!text) return null;
  if (!/^\d{1,10}(?:[,.]\d{1,2})?$/.test(text)) throw new HttpError(400, 'Use reais sem separador de milhar, por exemplo 1234,56. Deixe vazio quando o valor não estiver na fonte.', 'invalid_asset_value');
  const [whole, fraction = ''] = text.split(/[,.]/);
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents > 1_000_000_000_000) throw new HttpError(400, 'O valor documentado excede o limite do cadastro.', 'invalid_asset_value');
  return cents;
}
