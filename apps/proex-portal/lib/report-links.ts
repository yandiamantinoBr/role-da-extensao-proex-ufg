import { isCivilDate } from './civil-date';

// Identificadores e endereços de Relatórios. A leitura aceita links que já circulam.
export const REPORT_DATASET_IDS = ['projects', 'materials', 'movements', 'outflows', 'outflow_details', 'loans', 'records', 'campaigns', 'campaign_days', 'demands', 'reviews'] as const;
export type ReportDatasetId = typeof REPORT_DATASET_IDS[number];
export const isReportDataset = (value: unknown): value is ReportDatasetId => typeof value === 'string' && (REPORT_DATASET_IDS as readonly string[]).includes(value);

const REPORT_ARRIVAL = 'recorte';
const reportDay = (value: unknown): string => isCivilDate(value) ? value : '';
/** Texto de busca que chega pelo endereço: curto, sem quebras de linha nem caracteres de controle. */
const reportSearch = (value: unknown): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';

/** Parâmetros que valem só na chegada; a tela os aplica e os tira do endereço. */
export const REPORT_ARRIVAL_PARAMS = [REPORT_ARRIVAL, 'from', 'to', 'q'] as const;
/**
 * Recorte pedido por um endereço de relatório. Sem a marca de chegada, devolve null e a
 * tela mantém o período que a pessoa já tinha escolhido. Com a marca, período vazio significa "todo o período".
 */
export function readReportArrival(params: URLSearchParams): { from: string; to: string; search: string } | null {
  if (params.get('module') !== 'reports' || params.get(REPORT_ARRIVAL) !== '1') return null;
  const from = reportDay(params.get('from')), to = reportDay(params.get('to')), search = reportSearch(params.get('q'));
  return from && to && from > to ? { from: to, to: from, search } : { from, to, search };
}
