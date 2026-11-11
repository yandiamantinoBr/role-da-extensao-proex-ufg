// Conjuntos da central de Relatórios e o endereço que abre a central já filtrada.
// É o destino único do botão "Exportar" das outras telas: os dados em tabela saem só por Relatórios.
export const REPORT_DATASET_IDS = ['projects', 'materials', 'movements', 'outflows', 'outflow_details', 'loans', 'records', 'campaigns', 'campaign_days', 'demands', 'reviews'] as const;
export type ReportDatasetId = typeof REPORT_DATASET_IDS[number];
export const isReportDataset = (value: unknown): value is ReportDatasetId => typeof value === 'string' && (REPORT_DATASET_IDS as readonly string[]).includes(value);

const REPORT_ARRIVAL = 'recorte';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const reportDay = (value: unknown): string => typeof value === 'string' && DAY.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : '';
/** Texto de busca que chega pelo endereço: curto, sem quebras de linha nem caracteres de controle. */
export const reportSearch = (value: unknown): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';

export type ReportLink = { dataset: ReportDatasetId; projectId?: string; from?: string; to?: string; search?: string };
/** Endereço interno de Relatórios com o conjunto, o projeto, o período e a busca já escolhidos. */
export function reportHref({ dataset, projectId, from, to, search }: ReportLink): string {
  const params = new URLSearchParams({ module: 'reports' });
  if (projectId) params.set('project', projectId);
  params.set('report', dataset);
  params.set(REPORT_ARRIVAL, '1');
  const start = reportDay(from), end = reportDay(to), text = reportSearch(search);
  if (start) params.set('from', start);
  if (end) params.set('to', end);
  if (text) params.set('q', text);
  return `/?${params}`;
}
/** Parâmetros que valem só na chegada; a tela os aplica e os tira do endereço. */
export const REPORT_ARRIVAL_PARAMS = [REPORT_ARRIVAL, 'from', 'to', 'q'] as const;
/**
 * Recorte pedido por um botão "Exportar": período e busca. Sem a marca de chegada, devolve null e a
 * tela mantém o período que a pessoa já tinha escolhido. Com a marca, período vazio significa "todo o período".
 */
export function readReportArrival(params: URLSearchParams): { from: string; to: string; search: string } | null {
  if (params.get('module') !== 'reports' || params.get(REPORT_ARRIVAL) !== '1') return null;
  const from = reportDay(params.get('from')), to = reportDay(params.get('to')), search = reportSearch(params.get('q'));
  return from && to && from > to ? { from: to, to: from, search } : { from, to, search };
}
