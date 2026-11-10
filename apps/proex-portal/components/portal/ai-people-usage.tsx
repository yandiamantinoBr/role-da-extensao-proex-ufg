'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ExportFormats, { type DocumentFormat } from './export-formats';
import type { ExportColumn, ExportRow } from './report-export';
import type { PeopleUsage, UsageType } from '@/lib/assistant/usage-people';
import styles from './ai-people-usage.module.css';

const TYPES: { key: UsageType; label: string; color: string }[] = [
  { key: 'text', label: 'Texto', color: 'var(--pu-text)' }, { key: 'photo', label: 'Foto', color: 'var(--pu-photo)' },
  { key: 'audio', label: 'Áudio', color: 'var(--pu-audio)' }, { key: 'other', label: 'Outras', color: 'var(--pu-other)' },
];
const usd = (micros: number) => (micros / 1_000_000).toLocaleString('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: micros > 0 && micros < 10_000 ? 4 : 2, maximumFractionDigits: micros > 0 && micros < 10_000 ? 4 : 2 });
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

/** Uso de IA por pessoa (administração geral) ou só o meu (demais pessoas). Mesmo período do painel de gastos. */
export default function AiPeopleUsage({ organizationId, from, to }: { organizationId: string; from: string; to: string }) {
  const key = `${organizationId}|${from}|${to}`;
  const [loaded, setLoaded] = useState<{ key: string; data: PeopleUsage | null; error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/assistant/usage?${new URLSearchParams({ organizationId, from, to })}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal })
      .then(async response => { const body = await response.json().catch(() => null) as (PeopleUsage & { error?: string }) | null; if (!response.ok || !body || !Array.isArray(body.people)) throw new Error(body?.error ?? 'Não foi possível carregar o uso por pessoa.'); setLoaded({ key, data: body, error: '' }); })
      .catch(cause => { if (!controller.signal.aborted) setLoaded({ key, data: null, error: cause instanceof Error ? cause.message : 'Não foi possível carregar o uso por pessoa.' }); });
    return () => controller.abort();
  }, [organizationId, from, to, key]);
  const current = loaded?.key === key ? loaded : null, data = current?.data ?? null;
  const top = (data?.people ?? []).slice(0, 10).map(person => ({ name: (person.isMe ? `${person.name} (você)` : person.name).slice(0, 26), ...Object.fromEntries(TYPES.map(type => [type.key, person.byType[type.key].spentUsdMicros / 1_000_000])) }));

  async function exportFile(format: DocumentFormat) {
    if (!data) throw new Error('Carregue o uso antes de baixar.');
    const columns: ExportColumn[] = [{ key: 'person', label: 'Pessoa' }, { key: 'day', label: 'Dia' }, { key: 'calls', label: 'Chamadas', numeric: true }, { key: 'spent', label: 'Gasto (US$)', numeric: true }];
    const rows: ExportRow[] = data.people.flatMap(person => [...person.days.map(day => ({ person: person.name, day: longDay(day.day), calls: day.calls, spent: day.spentUsdMicros })), { person: person.name, day: 'Total da pessoa', calls: person.calls, spent: person.spentUsdMicros }]);
    const display = (row: ExportRow, column: string) => column === 'spent' ? (format === 'xlsx' ? Number(row.spent) / 1_000_000 : usd(Number(row.spent))) : row[column];
    const info: [string, string][] = [['Organização', data.organizationId], ['Período', `${longDay(data.from)} a ${longDay(data.to)} (horário de Brasília)`], ['Gasto', 'Custo informado pelo provedor; quando não informa, o valor máximo reservado da chamada.']];
    const [{ documentExport }, { download }] = await Promise.all([import('./document-export'), import('./report-export')]);
    download(`proex-uso-ia-por-pessoa-${data.from}-a-${data.to}.${format}`, await documentExport(format, 'Uso de IA por pessoa', columns, rows, display, info));
  }

  return <section className={styles.panel} aria-labelledby="ai-people-title">
    <header className={styles.heading}>
      <div><h4 id="ai-people-title"><Users size={18} aria-hidden="true"/>{data?.scope === 'mine' ? 'Meu uso de IA' : 'Uso por pessoa'}</h4>
        <p>{data?.scope === 'mine' ? 'Só você vê o seu uso. A administração geral vê o de todas as pessoas.' : 'Gasto e chamadas de cada pessoa no período, com dicas para economizar. Só a administração geral vê esta lista.'}</p></div>
      {data && data.people.length > 0 && <ExportFormats onExport={exportFile} label="Baixar uso por pessoa"/>}
    </header>
    {!current && <p className={styles.state} role="status"><LoaderCircle size={16} className="p-spin" aria-hidden="true"/>Carregando o uso por pessoa…</p>}
    {current?.error && <p className="p-inline-error" role="alert">{current.error}</p>}
    {data && data.people.length === 0 && <p className={styles.state}>Ninguém usou IA neste período.</p>}
    {data && data.people.length > 0 && <>
      {data.partial && <p className={styles.warning} role="note">Há chamadas demais neste período; os números mostram só uma parte.</p>}
      <figure className={styles.chart}>
        <figcaption>Gasto por pessoa (US$), separado por tipo</figcaption>
        <ul className={styles.legend} aria-label="Legenda">{TYPES.map(type => <li key={type.key}><i style={{ background: type.color }}/>{type.label}</li>)}</ul>
        <div className={styles.chartArea} style={{ height: Math.max(120, top.length * 38 + 40) }} role="img" aria-label={`Gasto das ${top.length} pessoas que mais usaram IA. A tabela abaixo tem os números.`}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
            <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }} barCategoryGap="22%">
              <CartesianGrid horizontal={false} stroke="var(--pu-grid)"/>
              <XAxis type="number" tick={{ fill: 'var(--pu-axis)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}/>
              <YAxis type="category" dataKey="name" width={170} tick={{ fill: 'var(--pu-axis)', fontSize: 12 }} axisLine={false} tickLine={false}/>
              <Tooltip formatter={(value, name) => [usd(Math.round(Number(value ?? 0) * 1_000_000)), TYPES.find(type => type.key === String(name))?.label ?? String(name)]} cursor={{ fill: 'var(--pu-hover)' }}/>
              {TYPES.map(type => <Bar key={type.key} dataKey={type.key} stackId="usage" fill={type.color} isAnimationActive={false}/>)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Uso por pessoa">
        <table className={styles.table}>
          <thead><tr><th scope="col">Pessoa</th><th scope="col" className={styles.num}>Texto</th><th scope="col" className={styles.num}>Foto</th><th scope="col" className={styles.num}>Áudio</th><th scope="col" className={styles.num}>Outras</th><th scope="col" className={styles.num}>Gasto</th></tr></thead>
          <tbody>{data.people.map(person => <tr key={person.key}>
            <th scope="row">{person.name}{person.isMe && <span className={styles.me}>você</span>}{person.tips.length > 0 && <ul className={styles.tips}>{person.tips.map(tip => <li key={tip}>{tip}</li>)}</ul>}</th>
            {TYPES.map(type => <td key={type.key} className={styles.num} data-label={type.label}>{person.byType[type.key].calls}</td>)}
            <td className={styles.num} data-label="Gasto"><strong>{usd(person.spentUsdMicros)}</strong></td>
          </tr>)}</tbody>
          {data.people.length > 1 && <tfoot><tr><th scope="row">Total</th>{TYPES.map(type => <td key={type.key} className={styles.num} data-label={type.label}>{data.people.reduce((sum, person) => sum + person.byType[type.key].calls, 0)}</td>)}<td className={styles.num} data-label="Gasto"><strong>{usd(data.totalSpentUsdMicros)}</strong></td></tr></tfoot>}
        </table>
      </div>
    </>}
  </section>;
}
