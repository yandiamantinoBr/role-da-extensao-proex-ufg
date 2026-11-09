'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ExportFormats, { type DocumentFormat } from './export-formats';
import type { ExportColumn, ExportRow } from './report-export';
import type { AiSpending, AiSpendingDay, SpendingBucket, SpendingDay, SpendingFunction, SpendingProvider } from '@/lib/assistant/spending';
import styles from './ai-spending-panel.module.css';

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];
type View = 'provider' | 'function';
const PROVIDER_KEYS: SpendingProvider[] = ['deepseek', 'groq', 'openai', 'typesafe', 'deepgram', 'other'];
const FUNCTION_KEYS: SpendingFunction[] = ['role', 'photos', 'operations', 'documents', 'speech', 'triage', 'compare'];

const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const usd2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Marcas redondas no eixo (1, 2, 2,5 ou 5 × 10ⁿ). */
function niceTicks(top: number) {
  const raw = Math.max(top, 0.0001) / 4, power = 10 ** Math.floor(Math.log10(raw)), n = raw / power;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
  const ticks = Array.from({ length: Math.ceil(top / step) + 1 }, (_, index) => Number((index * step).toFixed(6)));
  return { ticks, digits: Math.max(2, -Math.floor(Math.log10(step)) + (n <= 2.5 && n > 2 ? 1 : 0)) };
}
/** Valor grande com 2 casas e o exato pequeno, para leigos. */
function Money({ micros, zero }: { micros: number; zero?: string }) {
  if (!micros) return <>{zero ?? 'US$ 0,00'}</>;
  return <>{micros < 10_000 ? 'menos de US$ 0,01' : usd2.format(micros / 1_000_000)}<small className={styles.exact}> ({formatUsdMicros(micros)})</small></>;
}
const integer = new Intl.NumberFormat('pt-BR');
/** US$ com 4 casas (ex.: US$ 0,0012) e espaço fixo para não quebrar a linha. */
function formatUsdMicros(micros: number | null | undefined): string {
  return micros === null || micros === undefined || !Number.isFinite(micros) ? '—' : usd.format(micros / 1_000_000).replace(/\s/g, ' ');
}
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const longDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const todayInBrazil = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (day: string, amount: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + amount * 86_400_000).toISOString().slice(0, 10);

async function requestJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
  let body: unknown = null;
  try { body = await response.json(); } catch (reason) { if (signal.aborted) throw reason; }
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!response.ok) throw new Error(typeof record?.error === 'string' ? record.error : 'Não foi possível carregar os gastos de IA. Tente de novo.');
  if (!record) throw new Error('A resposta dos gastos veio incompleta. Tente de novo.');
  return record as T;
}
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

type ChartRow = { day: string; label: string } & Record<string, number | string>;
type TooltipProps = { active?: boolean; payload?: { name?: string; value?: number; color?: string; dataKey?: string | number }[]; label?: string; rows: Map<string, SpendingDay>; names: Record<string, string> };
function SpendingTooltip({ active, payload, label, rows, names }: TooltipProps) {
  if (!active || !payload?.length || !label) return null;
  const row = rows.get(label);
  return <div className={styles.tooltip}>
    <strong>{longDay(label)}</strong>
    {payload.filter(item => Number(item.value) > 0).map(item => <span key={String(item.dataKey)}><i style={{ background: item.color }} />{names[String(item.dataKey)] ?? item.name}<b>{usd.format(Number(item.value) || 0)}</b></span>)}
    {row && <>
      <span className={styles.tooltipSplit}>Gasto real<b>{formatUsdMicros(row.realUsdMicros)}</b></span>
      <span>Teto reservado<b>{formatUsdMicros(row.reservedUsdMicros)}</b></span>
      <span>Chamadas<b>{integer.format(row.calls)}</b></span>
    </>}
    <small>Clique na barra para ver as chamadas.</small>
  </div>;
}

export default function AiSpendingPanel({ organizationId }: { organizationId: string }) {
  const [period, setPeriod] = useState<Period>(30);
  const [view, setView] = useState<View>('provider');
  const [reload, setReload] = useState(0);
  // Cada resposta guarda a chave do pedido: o estado de carregamento é derivado, sem setState síncrono em efeitos.
  const requestKey = `${organizationId}|${period}|${reload}`;
  const [loaded, setLoaded] = useState<{ key: string; data: AiSpending | null; error: string } | null>(null);
  const loading = loaded?.key !== requestKey;
  const data = loaded?.data && loaded.data.organizationId === organizationId ? loaded.data : null;
  const error = loading ? '' : loaded?.error ?? '';
  const [selected, setSelected] = useState<{ organizationId: string; day: string }>({ organizationId, day: '' });
  // Dia de outra organização ou fora do período atual fecha a lista sozinho.
  const day = selected.organizationId === organizationId && data?.days.some(item => item.day === selected.day) ? selected.day : '';
  const setDay = useCallback((value: string) => setSelected({ organizationId, day: value }), [organizationId]);
  const detailKey = `${organizationId}|${day}|${reload}`;
  const [detailLoaded, setDetailLoaded] = useState<{ key: string; detail: AiSpendingDay | null; error: string } | null>(null);
  const detailLoading = !!day && detailLoaded?.key !== detailKey;
  const detail = !detailLoading && detailLoaded?.key === detailKey ? detailLoaded.detail : null;
  const detailError = !detailLoading && detailLoaded?.key === detailKey ? detailLoaded.error : '';
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController(), key = `${organizationId}|${period}|${reload}`;
    const to = todayInBrazil(), from = addDays(to, -(period - 1));
    const query = new URLSearchParams({ organizationId, from, to });
    requestJson<AiSpending>(`/api/assistant/spending?${query}`, controller.signal)
      .then(value => { if (!Array.isArray(value.days) || !value.totals || !value.today) throw new Error('A resposta dos gastos veio incompleta. Tente de novo.'); setLoaded({ key, data: value, error: '' }); })
      .catch(cause => { if (!isAbort(cause) && !controller.signal.aborted) setLoaded({ key, data: null, error: cause instanceof Error ? cause.message : 'Não foi possível carregar os gastos de IA.' }); });
    return () => controller.abort();
  }, [organizationId, period, reload]);

  useEffect(() => {
    if (!day) return;
    const controller = new AbortController(), key = `${organizationId}|${day}|${reload}`;
    requestJson<AiSpendingDay>(`/api/assistant/spending?${new URLSearchParams({ organizationId, day })}`, controller.signal)
      .then(value => { if (!Array.isArray(value.calls)) throw new Error('A lista de chamadas veio incompleta.'); setDetailLoaded({ key, detail: value, error: '' }); })
      .catch(cause => { if (!isAbort(cause) && !controller.signal.aborted) setDetailLoaded({ key, detail: null, error: cause instanceof Error ? cause.message : 'Não foi possível carregar as chamadas do dia.' }); });
    return () => controller.abort();
  }, [organizationId, day, reload]);

  const openDay = useCallback((value: string) => {
    setDay(value);
    window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  }, [setDay]);

  const keys: string[] = view === 'provider' ? PROVIDER_KEYS : FUNCTION_KEYS;
  const names = useMemo(() => Object.fromEntries((view === 'provider' ? data?.providers : data?.functions)?.map(item => [item.key, item.label]) ?? []), [data, view]);
  const usedKeys = useMemo(() => {
    if (!data) return [];
    const totals = view === 'provider' ? data.totals.byProvider : data.totals.byFunction;
    return keys.filter(key => ((totals as Record<string, SpendingBucket | undefined>)[key]?.calls ?? 0) > 0);
  }, [data, keys, view]);
  const rowsByDay = useMemo(() => new Map((data?.days ?? []).map(item => [item.day, item])), [data]);
  const chart = useMemo<ChartRow[]>(() => (data?.days ?? []).map(item => {
    const buckets = (view === 'provider' ? item.byProvider : item.byFunction) as Record<string, SpendingBucket | undefined>;
    return { day: item.day, label: shortDay(item.day), ...Object.fromEntries(usedKeys.map(key => [key, (buckets[key]?.spentUsdMicros ?? 0) / 1_000_000])) };
  }), [data, usedKeys, view]);
  const hasCalls = !!data && (data.totals.calls > 0 || data.totals.reservedUsdMicros > 0);
  const limit = data ? data.dailyLimitUsdMicros / 1_000_000 : 0;
  // Gastos de milésimos de dólar sumiriam numa escala até o limite: a linha só entra quando o gasto chega perto dele.
  const peak = chart.reduce((max, row) => Math.max(max, usedKeys.reduce((sum, key) => sum + Number((row as Record<string, unknown>)[key] ?? 0), 0)), 0);
  const showLimit = limit > 0 && peak >= limit * 0.3;
  const axis = niceTicks(showLimit ? Math.max(peak, limit) : peak);

  async function exportFile(format: DocumentFormat) {
    if (!data) throw new Error('Carregue os gastos antes de baixar.');
    const columns: ExportColumn[] = [
      { key: 'day', label: 'Dia' }, { key: 'calls', label: 'Chamadas', numeric: true },
      { key: 'real', label: 'Gasto real (US$)', numeric: true }, { key: 'spent', label: 'Gasto real ou teto da chamada (US$)', numeric: true },
      { key: 'reserved', label: 'Teto reservado do dia (US$)', numeric: true },
    ];
    const rows: ExportRow[] = [...data.days.map(item => ({ day: longDay(item.day), calls: item.calls, real: item.realUsdMicros, spent: item.spentUsdMicros, reserved: item.reservedUsdMicros })),
      { day: 'Total do período', calls: data.totals.calls, real: data.totals.realUsdMicros, spent: data.totals.spentUsdMicros, reserved: data.totals.reservedUsdMicros }];
    const display = (row: ExportRow, key: string) => {
      const value = row[key];
      if (key === 'day' || key === 'calls') return value;
      // Excel recebe número em dólar; PDF e Word recebem o texto já formatado.
      return format === 'xlsx' ? Number(value) / 1_000_000 : formatUsdMicros(Number(value));
    };
    const info: [string, string][] = [
      ['Organização', data.organizationId], ['Período', `${longDay(data.from)} a ${longDay(data.to)} (horário de Brasília)`],
      ['Limite por dia', formatUsdMicros(data.dailyLimitUsdMicros)],
      ['Gasto real', 'Custo informado pelo provedor, quando ele informa.'],
      ['Teto reservado', 'O valor máximo guardado antes de cada chamada.'],
    ];
    const [{ documentExport }, { download }] = await Promise.all([import('./document-export'), import('./report-export')]);
    download(`proex-gastos-ia-${data.from}-a-${data.to}.${format}`, await documentExport(format, 'Gastos de IA', columns, rows, display, info));
  }

  return <section className={styles.panel} aria-labelledby="ai-spending-title" aria-busy={loading}>
    <header className={styles.heading}>
      <div>
        <h3 id="ai-spending-title">Gastos de IA</h3>
        <p>Quanto a organização gastou com IA por dia, em dólar e no horário de Brasília.</p>
      </div>
      <button type="button" className="p-button p-button-subtle" onClick={() => setReload(value => value + 1)} disabled={loading}>
        {loading ? <LoaderCircle size={16} className="p-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />} Atualizar
      </button>
    </header>

    <div className={styles.controls}>
      <div className={styles.controlGroup}><span className={styles.controlLabel}>Período</span><div role="group" aria-label="Período" className={styles.segmented}>
        {PERIODS.map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{value} dias</button>)}
      </div></div>
      <div className={styles.controlGroup}><span className={styles.controlLabel}>Mostrar por</span><div role="group" aria-label="Separar o gráfico" className={styles.segmented}>
        <button type="button" aria-pressed={view === 'provider'} onClick={() => setView('provider')}>Por provedor</button>
        <button type="button" aria-pressed={view === 'function'} onClick={() => setView('function')}>Por função</button>
      </div></div>
    </div>

    {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" className="p-button p-button-subtle" onClick={() => setReload(value => value + 1)}>Tentar de novo</button></div>}
    {loading && !data && !error && <p className={styles.loading} role="status"><LoaderCircle size={18} className="p-spin" aria-hidden="true" /> Carregando os gastos…</p>}

    {data && <>
      <dl className={styles.metrics}>
        <div><dt>Gasto real hoje</dt><dd><Money micros={data.today.realUsdMicros} zero="Nada gasto hoje"/></dd></div>
        <div><dt>Limite por dia</dt><dd>{usd2.format(data.dailyLimitUsdMicros / 1_000_000)}</dd></div>
        <div><dt>Gasto real no período</dt><dd><Money micros={data.totals.realUsdMicros} zero="Nada gasto"/></dd></div>
        <div><dt>Reservado no período (máximo possível)</dt><dd><Money micros={data.totals.reservedUsdMicros} zero="Nada reservado"/></dd></div>
      </dl>
      <ul className={styles.glossary}>
        <li><strong>Gasto real:</strong> o custo que o provedor informou. Algumas funções ainda não informam o custo.</li>
        <li><strong>Reservado:</strong> antes de cada uso, o portal separa o custo máximo possível. O limite por dia conta esse valor.</li>
        <li>Hoje já foram reservados {formatUsdMicros(data.today.reservedUsdMicros)} de {formatUsdMicros(data.dailyLimitUsdMicros)}.</li>
      </ul>
      {data.partial && <p className={styles.warning} role="note">Há chamadas demais neste período; os números mostram só uma parte. Escolha um período menor.</p>}

      {!hasCalls ? <div className={styles.empty}><strong>Nenhum gasto de IA neste período.</strong><p>Quando alguém usar o Rolê, a voz para texto ou outra função paga, o gasto aparece aqui.</p></div> : <>
        <figure className={styles.chart}>
          <figcaption>
            <strong>Gasto por dia, {view === 'provider' ? 'por provedor' : 'por função'}</strong>
            <small>Cada barra soma o gasto real; quando o provedor não informa o custo, usa o teto da chamada. {showLimit ? 'A linha tracejada é o limite por dia.' : `O limite por dia (${usd2.format(data.dailyLimitUsdMicros / 1_000_000)}) está bem acima destes valores e fica fora da escala.`}</small>
          </figcaption>
          <ul className={styles.legend} aria-label="Legenda">
            {usedKeys.map(key => <li key={key}><i style={{ background: `var(--as-${keys.indexOf(key) + 1})` }} />{names[key] ?? key}</li>)}
          </ul>
          <div className={styles.chartArea} role="img" aria-label={`Gráfico de barras com o gasto de ${data.days.length} dias. Use a lista abaixo para abrir as chamadas de um dia.`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 12, right: 8, bottom: 4, left: 4 }} barCategoryGap={period === 90 ? 1 : 3}>
                <CartesianGrid vertical={false} stroke="var(--as-grid)" />
                <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: 'var(--as-axis)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={14} />
                <YAxis width={78} tick={{ fill: 'var(--as-axis)', fontSize: 12 }} axisLine={false} tickLine={false} ticks={axis.ticks} domain={[0, axis.ticks[axis.ticks.length - 1]]} tickFormatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: axis.digits, maximumFractionDigits: axis.digits }).format(value)} />
                <Tooltip cursor={{ fill: 'var(--as-hover)' }} content={<SpendingTooltip rows={rowsByDay} names={names} />} />
                {showLimit && <ReferenceLine y={limit} stroke="var(--as-limit)" strokeDasharray="6 4" strokeWidth={1.5} ifOverflow="extendDomain" label={{ value: 'Limite por dia', position: 'insideTopRight', fill: 'var(--as-limit)', fontSize: 11 }} />}
                {usedKeys.map((key, index) => <Bar key={key} dataKey={key} name={names[key] ?? key} stackId="spent" fill={`var(--as-${keys.indexOf(key) + 1})`} maxBarSize={36} cursor="pointer"
                  radius={index === usedKeys.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false}
                  onClick={(entry: { payload?: { day?: unknown } }) => { const value = entry?.payload?.day; if (typeof value === 'string') openDay(value); }} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
      </>}

      <div className={styles.dayPicker}>
        <label className="p-field"><span>Ver chamadas do dia</span>
          <select value={day} onChange={event => setDay(event.target.value)}>
            <option value="">Escolha um dia</option>
            {[...data.days].reverse().map(item => <option key={item.day} value={item.day}>{longDay(item.day)} · {item.calls === 1 ? '1 chamada' : `${integer.format(item.calls)} chamadas`}</option>)}
          </select>
        </label>
        <ExportFormats onExport={exportFile} disabled={loading} label="Baixar gastos do período" />
      </div>

      <div ref={detailRef} className={styles.detail} aria-live="polite">
        {day && detailLoading && <p className={styles.loading} role="status"><LoaderCircle size={18} className="p-spin" aria-hidden="true" /> Carregando as chamadas de {longDay(day)}…</p>}
        {day && detailError && <p className="p-inline-error" role="alert">{detailError}</p>}
        {day && detail && !detailLoading && detail.day === day && <>
          <div className={styles.detailHead}>
            <strong>Chamadas de {longDay(day)}</strong>
            <small>{detail.truncated ? `Mostrando as ${integer.format(detail.calls.length)} mais recentes de ${integer.format(detail.total)}.` : detail.total === 1 ? '1 chamada.' : `${integer.format(detail.total)} chamadas.`}</small>
            <button type="button" className="p-button p-button-subtle" onClick={() => setDay('')}>Fechar lista</button>
          </div>
          {detail.calls.length === 0 ? <p className={styles.emptyLine}>Nenhuma chamada registrada neste dia. O teto reservado pode vir de chamadas que falharam.</p> :
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={`Chamadas de ${longDay(day)}`}>
              <table>
                <thead><tr><th scope="col">Hora</th><th scope="col">Função</th><th scope="col">Provedor</th><th scope="col">Modelo</th><th scope="col" className={styles.num}>Gasto real</th><th scope="col" className={styles.num}>Teto</th><th scope="col">Quem</th></tr></thead>
                <tbody>{detail.calls.map((call, index) => <tr key={`${call.at}-${index}`}>
                  <td className={styles.num}>{call.time}</td><td>{call.functionLabel}</td><td>{call.providerLabel}</td><td className={styles.model}>{call.model ?? '—'}</td>
                  <td className={styles.num}>{formatUsdMicros(call.realUsdMicros)}</td><td className={styles.num}>{formatUsdMicros(call.ceilingUsdMicros)}</td><td>{call.who}</td>
                </tr>)}</tbody>
              </table>
            </div>}
        </>}
      </div>
    </>}
  </section>;
}
