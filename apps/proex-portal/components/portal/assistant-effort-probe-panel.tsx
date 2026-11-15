'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EFFORT_PROBE_LABELS, EFFORT_PROBE_PROVIDERS,
  type EffortProbeOption, type EffortProbeOutcome, type EffortProbeStatus,
} from '@/lib/assistant/effort-probe-contract';

const endpoint = '/api/assistant/effort-probe';
const outcomes: Record<EffortProbeOutcome, string> = {
  pending: 'Iniciado, aguardando resultado',
  passed: 'Acertou o teste',
  unexpected_answer: 'Respondeu diferente do esperado',
  truncated: 'Atingiu o limite de saída',
  usage_limit: 'O provedor informou uso acima do previsto',
  rejected: 'O provedor recusou a chamada',
  no_credit: 'Crédito insuficiente no provedor',
  rate_limited: 'O provedor limitou a chamada',
  invalid_response: 'Resposta fora do formato esperado',
  timeout: 'Prazo esgotado',
  cancelled: 'Teste cancelado',
  unavailable: 'O provedor não respondeu',
};
const formatMoney = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6,
});
const usd = (micros: number) => formatMoney.format(micros / 1_000_000);
const button = 'min-h-11 rounded-xl border border-[var(--line)] px-3 text-sm disabled:opacity-50';

async function readStatus(response: Response): Promise<EffortProbeStatus> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
    throw new Error(typeof error === 'string' ? error : 'Não foi possível consultar o diagnóstico.');
  }
  if (!body || typeof body !== 'object' || !('probes' in body) || !Array.isArray(body.probes)) {
    throw new Error('Resposta do diagnóstico indisponível. Atualize a lista.');
  }
  return body as EffortProbeStatus;
}

function ProbeForm({ organizationId }: { organizationId: string }) {
  const [status, setStatus] = useState<EffortProbeStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const query = new URLSearchParams({ organizationId });
      const next = await readStatus(await fetch(`${endpoint}?${query}`, { cache: 'no-store', signal: controller.signal }));
      if (!controller.signal.aborted) setStatus(next);
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(null);
        setMessage(error instanceof Error ? error.message : 'Não foi possível consultar.');
      }
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }, [organizationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      active.current?.abort();
    };
  }, [load]);

  async function run(probes: EffortProbeOption[]) {
    if (active.current || !status || probes.length === 0) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    const unavailable = new Set<EffortProbeOption['provider']>();
    try {
      for (const [index, probe] of probes.entries()) {
        if (unavailable.has(probe.provider)) continue;
        setMessage(`Testando ${EFFORT_PROBE_PROVIDERS[probe.provider]} · ${EFFORT_PROBE_LABELS[probe.level]} (${index + 1}/${probes.length})…`);
        const next = await readStatus(await fetch(endpoint, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' },
          body: JSON.stringify({
            organizationId, probeId: probe.id, expectedRevision: status.revision, expectedDay: status.day,
            acceptedCostMicros: probe.ceilingMicros, consent: true,
          }),
        }));
        if (controller.signal.aborted) return;
        if (next.organizationId !== organizationId || next.revision !== status.revision || next.day !== status.day) {
          setStatus(next);
          setMessage('O dia ou a configuração mudou. Confira os limites atuais antes de continuar.');
          return;
        }
        setStatus(next);
        const receipt = next.probes.find(row => row.id === probe.id)?.receipt;
        if (receipt?.httpStatus && [401, 402, 403, 429].includes(receipt.httpStatus)) unavailable.add(probe.provider);
      }
      setMessage(unavailable.size
        ? 'Resultados atualizados. Alguns níveis ficaram pendentes após recusa de acesso, falta de crédito ou limite do provedor.'
        : 'Resultados atualizados.');
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Resultado indisponível. Atualize a lista.');
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  const remaining = status?.probes.filter(probe => probe.available && !probe.receipt) ?? [];
  const ceiling = remaining.reduce((sum, probe) => sum + probe.ceilingMicros, 0);
  return <section className="space-y-3 rounded-xl border border-[var(--line)] p-3" aria-label="Teste real de esforço dos modelos">
    <h4 className="font-medium">Testar níveis de esforço</h4>
    <p className="text-sm">Envia uma pergunta fictícia aos provedores selecionados com as chaves já salvas. Cada botão mostra o teto da chamada. As chamadas contam nas cotas da organização.</p>
    <p className="text-sm">O JEV recebe a mesma pergunta como decisão tipada. O provedor não oferece níveis de esforço.</p>
    { status && <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy || remaining.length === 0}
        onClick={() => void run(remaining)}>Testar níveis disponíveis · até {usd(ceiling)}</button>
      <button type="button" className={button} disabled={busy} onClick={() => void load()}>Atualizar testes</button>
    </div> }
    { !status && <button type="button" className={button} disabled={busy} onClick={() => void load()}>Consultar testes</button> }
    { message && <p role="status" className="text-sm">{message}</p> }
    { status && <ul className="space-y-3 text-sm">
      {Object.entries(EFFORT_PROBE_PROVIDERS).map(([provider, label]) => {
        const probes = status.probes.filter(probe => probe.provider === provider);
        if (probes.length === 0) return null;
        return <li key={provider} className="space-y-2 rounded-xl bg-[var(--surface-soft)] p-3">
          <strong>{label} · {probes[0].model}</strong>
          { !probes[0].available ? <p>Chave ativa indisponível no cofre desta organização.</p> :
            <ul className="space-y-2">{probes.map(probe => {
              const { receipt } = probe;
              return <li key={probe.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{EFFORT_PROBE_LABELS[probe.level]}</span>
                { receipt ? <div>
                  <p>{outcomes[receipt.outcome]}{receipt.httpStatus ? ` · HTTP ${receipt.httpStatus}` : ''}{receipt.elapsedMs !== null ? ` · ${receipt.elapsedMs} ms` : ''}</p>
                  { receipt.inputTokens !== null && receipt.outputTokens !== null &&
                    <p>Tokens: {receipt.inputTokens} de entrada · {receipt.outputTokens} de saída{receipt.reasoningTokens !== null ? ` (${receipt.reasoningTokens} de raciocínio)` : ''}</p> }
                  <p>{receipt.estimatedCostMicros === null ? `Reservado: ${usd(receipt.reservedCostMicros)}` :
                    `Custo estimado pelo uso informado: ${usd(receipt.estimatedCostMicros)}`}</p>
                </div> : <button type="button" className={button} disabled={busy} onClick={() => void run([probe])}
                  aria-label={`Testar ${label} · ${EFFORT_PROBE_LABELS[probe.level]} · até ${usd(probe.ceilingMicros)}`}>
                  Testar · até {usd(probe.ceilingMicros)}
                </button> }
              </li>;
            })}</ul> }
        </li>;
      })}
    </ul> }
  </section>;
}

export default function AssistantEffortProbePanel({ organizationId }: { organizationId: string }) {
  return organizationId ? <ProbeForm key={organizationId} organizationId={organizationId} /> : null;
}
