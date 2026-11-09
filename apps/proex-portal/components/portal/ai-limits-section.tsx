'use client';

import { CircleDollarSign, FlaskConical } from 'lucide-react';
import { TEST_MODE_LIMITS, type AssistantConfig } from '@/lib/assistant/contracts';
import { formatDuration, formatThousands, formatUsd } from '@/lib/assistant/limits-format';
import styles from './ai-limits-section.module.css';

export type AiUsage = { reserved_usd_micros: number; reserved_tokens: number; reserved_ms: number; calls: number };
type Props = {
  config: AssistantConfig; saved: AssistantConfig; usage?: AiUsage; busy: boolean; open: boolean;
  onOpenChange: (open: boolean) => void; onChange: (config: AssistantConfig) => void; onTestMode: (on: boolean) => void;
};

/** Os quatro limites diários da organização, com o uso de hoje e o que cada um protege. */
const METERS = [
  { key: 'dailyUsdMicros', used: 'reserved_usd_micros', label: 'Custo', format: formatUsd, protects: 'Protege o orçamento. Cada chamada separa o máximo que pode custar e devolve o que sobrar quando a resposta chega.' },
  { key: 'dailyTokens', used: 'reserved_tokens', label: 'Tokens', format: formatThousands, protects: 'Tokens são pedaços de texto (uma palavra tem 1 ou 2). Protege contra pedidos longos demais.' },
  { key: 'dailyCalls', used: 'calls', label: 'Chamadas', format: (value: number) => value.toLocaleString('pt-BR'), protects: 'Quantas vezes a IA pode ser usada por dia; cada pessoa usa no máximo metade.' },
  { key: 'dailyMs', used: 'reserved_ms', label: 'Tempo', format: formatDuration, protects: 'Soma do tempo de espera das chamadas. Evita fila e serviço travado.' },
] as const;

export default function AiLimitsSection({ config, saved, usage, busy, open, onOpenChange, onChange, onTestMode }: Props) {
  const testing = saved.testMode;
  const restore = saved.testModeRestore;
  return <details id="ai-limits" className={`${styles.section} ${testing ? styles.testing : ''}`} open={open} onToggle={event => onOpenChange(event.currentTarget.open)}>
    <summary><CircleDollarSign size={20} aria-hidden="true"/><span>Limites e cotas</span>{testing ? <span className={styles.testPill}><FlaskConical size={14} aria-hidden="true"/>Modo de testes ligado</span> : <small>até {formatUsd(saved.dailyUsdMicros)} por dia</small>}</summary>
    <div className={styles.body}>
    {testing && <div className={styles.banner} role="status">
      <FlaskConical size={20} aria-hidden="true"/>
      <p><strong>Modo de testes ligado.</strong> Os limites estão altos até alguém desligar.{restore ? ` Ao desligar, voltam ${formatUsd(restore.dailyUsdMicros)}, ${restore.dailyCalls.toLocaleString('pt-BR')} chamadas, ${formatThousands(restore.dailyTokens)} de tokens e ${formatDuration(restore.dailyMs)} por dia.` : ''}</p>
    </div>}
    <p className={styles.intro}>Os limites valem para toda a organização e zeram à meia-noite (horário de Brasília). Toda mudança fica em Registros, com quem mudou e quando.</p>
    <ul className={styles.meters} aria-label="Uso de hoje">
      {METERS.map(meter => {
        const limit = saved[meter.key], used = Number(usage?.[meter.used] ?? 0), share = Math.min(1, limit ? used / limit : 0);
        const level = share >= 0.9 ? 'high' : share >= 0.7 ? 'mid' : 'low';
        return <li key={meter.key} className={styles.meter} data-level={level}>
          <div className={styles.meterTop}><strong>{meter.label}</strong><span>{meter.format(used)} de {meter.format(limit)}</span></div>
          <div className={styles.track} role="meter" aria-label={`${meter.label} usado hoje`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)} aria-valuetext={`${meter.format(used)} de ${meter.format(limit)} (${Math.round(share * 100)}%)`}><i style={{ width: `${Math.max(share * 100, used ? 2 : 0)}%` }}/></div>
          <small>{meter.protects}</small>
        </li>;
      })}
    </ul>
    <fieldset className={styles.fields} disabled={busy}>
      <legend>Mudar os limites</legend>
      <label className="p-field"><span>Custo por dia (US$)</span><input type="number" inputMode="decimal" min="0.01" max="10" step="0.01" value={config.dailyUsdMicros / 1_000_000} onChange={event => onChange({ ...config, dailyUsdMicros: Math.round(Number(event.target.value) * 1_000_000) })}/></label>
      <label className="p-field"><span>Chamadas por dia</span><input type="number" inputMode="numeric" min="1" max="1000" step="1" value={config.dailyCalls} onChange={event => onChange({ ...config, dailyCalls: Number(event.target.value) })}/></label>
      <label className="p-field"><span>Tokens por dia (em mil)</span><input type="number" inputMode="numeric" min="1" max="5000" step="1" value={Math.round(config.dailyTokens / 1000)} aria-describedby="ai-limits-tokens-hint" onChange={event => onChange({ ...config, dailyTokens: Math.round(Number(event.target.value)) * 1000 })}/><small id="ai-limits-tokens-hint" className={styles.hint}>= {formatThousands(config.dailyTokens)} de tokens</small></label>
      <label className="p-field"><span>Tempo por dia (minutos)</span><input type="number" inputMode="numeric" min="1" max="240" step="1" value={Math.round(config.dailyMs / 60_000)} onChange={event => onChange({ ...config, dailyMs: Math.round(Number(event.target.value)) * 60_000 })}/></label>
      <label className="p-field"><span>Prazo por chamada (segundos)</span><input type="number" inputMode="numeric" min="1" max="20" step="1" value={config.timeoutMs / 1000} aria-describedby="ai-limits-timeout-hint" onChange={event => onChange({ ...config, timeoutMs: Number(event.target.value) * 1000 })}/><small id="ai-limits-timeout-hint" className={styles.hint}>Quanto a IA espera cada resposta antes de desistir.</small></label>
    </fieldset>
    <p className="p-form-help">Máximos: US$ 10, 1.000 chamadas, 5 milhões de tokens e 4 horas por dia. Salve com o botão abaixo da seção.</p>
    <div className={styles.test}>
      <div><strong>Modo de testes</strong><p>{testing ? 'Desligar devolve os limites de antes. Não mexe nas funções nem nas chaves.' : `Para uma fase de testes: sobe os limites para ${formatUsd(TEST_MODE_LIMITS.dailyUsdMicros)}, ${TEST_MODE_LIMITS.dailyCalls} chamadas, ${formatThousands(TEST_MODE_LIMITS.dailyTokens)} de tokens e ${formatDuration(TEST_MODE_LIMITS.dailyMs)} por dia, até alguém desligar. Salva na hora.`}</p></div>
      <button type="button" className={`p-button ${testing ? 'p-button-primary' : 'p-button-subtle'}`} disabled={busy} onClick={() => onTestMode(!testing)}><FlaskConical size={18} aria-hidden="true"/>{testing ? 'Desligar modo de testes' : 'Ligar modo de testes'}</button>
    </div>
    </div>
  </details>;
}
