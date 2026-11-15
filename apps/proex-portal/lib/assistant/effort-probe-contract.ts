export const EFFORT_PROBE_LABELS = {
  off: 'Desligado', low: 'Baixo', medium: 'Médio', high: 'Alto',
  xhigh: 'Extra alto', max: 'Máximo', decision: 'Decisão tipada',
} as const;

export const EFFORT_PROBE_PROVIDERS = {
  deepseek: 'DeepSeek', groq: 'Groq', typesafe: 'TypeSafe JEV', openai: 'OpenAI',
} as const;

export type EffortProbeProvider = keyof typeof EFFORT_PROBE_PROVIDERS;
export type EffortProbeLevel = keyof typeof EFFORT_PROBE_LABELS;
export type EffortProbeOutcome =
  | 'pending' | 'passed' | 'unexpected_answer' | 'truncated' | 'usage_limit'
  | 'rejected' | 'no_credit' | 'rate_limited' | 'invalid_response'
  | 'timeout' | 'cancelled' | 'unavailable';

export type EffortProbeReceipt = {
  outcome: EffortProbeOutcome;
  checkedAt: string;
  elapsedMs: number | null;
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  estimatedCostMicros: number | null;
  reservedCostMicros: number;
};

export type EffortProbeOption = {
  id: string;
  provider: EffortProbeProvider;
  level: EffortProbeLevel;
  model: string;
  available: boolean;
  ceilingMicros: number;
  receipt: EffortProbeReceipt | null;
};

export type EffortProbeStatus = {
  organizationId: string;
  revision: number;
  day: string;
  probes: EffortProbeOption[];
};
