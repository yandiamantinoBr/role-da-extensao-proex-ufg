import { toXlsx, type ExportColumn, type ExportRow } from '../../components/portal/report-export';
import { SPENDING_FUNCTIONS, SPENDING_PROVIDERS, SPENDING_RESULTS, type AiSpendingDay } from './spending';

type Filters = { fn: string | null; provider: string | null; result: string | null };
const columns: ExportColumn[] = [
  { key: 'time', label: 'Hora (Brasília)' },
  { key: 'functionLabel', label: 'Função' },
  { key: 'providerLabel', label: 'Provedor' },
  { key: 'model', label: 'Modelo' },
  { key: 'resultLabel', label: 'Resultado' },
  { key: 'inputTokens', label: 'Tokens de entrada', numeric: true },
  { key: 'outputTokens', label: 'Tokens de saída', numeric: true },
  { key: 'realUsdMicros', label: 'Gasto real (US$)', numeric: true },
  { key: 'ceilingUsdMicros', label: 'Teto (US$)', numeric: true },
  { key: 'who', label: 'Quem' },
];

function label(options: Record<string, string>, key: string | null) {
  return key && Object.hasOwn(options, key) ? options[key] : 'Todos';
}

/** Somente as colunas já autorizadas na consulta do dia são registradas na planilha. */
export function spendingCallsWorkbook(detail: AiSpendingDay, filters: Filters) {
  const [year, month, day] = detail.day.split('-');
  const display = (row: ExportRow, key: string) => {
    const value = row[key];
    if (key === 'realUsdMicros' || key === 'ceilingUsdMicros') return typeof value === 'number' ? value / 1_000_000 : '';
    return value ?? '';
  };
  const info: [string, string][] = [
    ['Dia', `${day}/${month}/${year}`],
    ['Fuso horário', 'Brasília'],
    ['Função', label(SPENDING_FUNCTIONS, filters.fn)],
    ['Provedor', label(SPENDING_PROVIDERS, filters.provider)],
    ['Resultado', label(SPENDING_RESULTS, filters.result)],
    ['Linhas exportadas', String(detail.calls.length)],
    ['Células vazias', 'Dado não informado ou indisponível.'],
  ];
  if (detail.truncated || detail.partial) info.push(['Recorte parcial', 'A planilha contém só as chamadas mais recentes encontradas para este filtro.']);
  return toXlsx('Chamadas de IA', columns, detail.calls, display, info);
}
