import { PROVIDERS } from './contracts';
import type { EffortProbeLevel, EffortProbeOutcome, EffortProbeProvider } from './effort-probe-contract';
import { requestProvider } from './provider-transport';
import { ROLE_MODELS } from './role-contracts';
import { roleReasoningParameters, roleReasoningSupport, type RoleEffort } from './role-policy';

const RESPONSE_BYTES = 32 * 1024;
const INPUT_TOKEN_RESERVATION = 768;
const TYPED_OUTPUT_RESERVATION = 128;
const MAX_REPORTED_TOKENS = 1_000_000;
const STATE = 'Em um teste fictício, a caixa A tem 2 fichas, B tem o dobro de A e C tem uma ficha a mais que B.';
const ANSWER = '11';
const chatIdentity = (model: { model: string; endpoint: string }) => ({
  kind: 'openai_chat', model: model.model, baseUrl: model.endpoint.replace('/chat/completions', ''),
});

const models = {
  deepseek: ROLE_MODELS.deepseek,
  groq: ROLE_MODELS.groq,
  typesafe: { ...PROVIDERS.typesafe, outputMicrosPerToken: 0 },
  openai: {
    ...PROVIDERS.openai,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    inputMicrosPerToken: 0.20,
  },
};

const levels: Record<EffortProbeProvider, readonly EffortProbeLevel[]> = {
  deepseek: roleReasoningSupport(chatIdentity(models.deepseek)).filter(level => level !== 'default'),
  groq: roleReasoningSupport(chatIdentity(models.groq)).filter(level => level !== 'default'),
  typesafe: ['decision'],
  openai: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
};

export type EffortProbe = {
  id: string;
  provider: EffortProbeProvider;
  level: EffortProbeLevel;
  model: string;
};

export const EFFORT_PROBES: readonly EffortProbe[] = (Object.keys(levels) as EffortProbeProvider[])
  .flatMap(provider => levels[provider].map(level => ({
    id: `${provider}.${level}`, provider, level, model: models[provider].model,
  })));

export function effortProbeCost(provider: EffortProbeProvider, input: number, output: number) {
  const { inputMicrosPerToken, outputMicrosPerToken } = models[provider];
  return Math.ceil(input * inputMicrosPerToken + output * outputMicrosPerToken);
}

export function effortProbeLimits(probe: EffortProbe, roleOutputTokens: number) {
  const input = INPUT_TOKEN_RESERVATION;
  const output = probe.provider === 'typesafe' ? TYPED_OUTPUT_RESERVATION : Math.min(roleOutputTokens, 1024);
  return { input, output, cost: effortProbeCost(probe.provider, input, output) };
}

export function effortProbeBody(probe: EffortProbe, outputLimit: number): Record<string, unknown> {
  const { provider, level, model } = probe;
  if (provider === 'typesafe') {
    return {
      model,
      state: STATE,
      questions: {
        total: {
          type: 'choice',
          instructions: 'Quantas fichas há nas três caixas?',
          criteria: { eleven: '11 fichas', nine: '9 fichas', unknown: 'Não há informação suficiente.' },
        },
      },
    };
  }
  const common = {
    model,
    messages: [{ role: 'user', content: `${STATE} Quantas fichas há no total? Responda somente com o número.` }],
    stream: false,
  };
  if (provider === 'openai') {
    return { ...common, reasoning_effort: level === 'off' ? 'none' : level, max_completion_tokens: outputLimit, store: false };
  }
  return {
    ...common,
    ...roleReasoningParameters(chatIdentity(models[provider]), level as RoleEffort),
    ...(provider === 'deepseek' ? { max_tokens: outputLimit } : { max_completion_tokens: outputLimit }),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function tokens(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_REPORTED_TOKENS ? value : null;
}

function matchesModel(probe: EffortProbe, reported: unknown) {
  if (reported === probe.model) return true;
  if (typeof reported !== 'string') return false;
  if (probe.provider === 'openai') return /^gpt-5\.6-luna-\d{4}-\d{2}-\d{2}$/.test(reported);
  if (probe.provider === 'typesafe') return /^jev-1\.14\.0[-+][a-z0-9.-]{1,40}$/i.test(reported);
  return false;
}

export type EffortProviderResult = {
  outcome: EffortProbeOutcome;
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
};

const failure = (outcome: EffortProbeOutcome, httpStatus: number | null): EffortProviderResult => ({
  outcome, httpStatus, inputTokens: null, outputTokens: null, reasoningTokens: null,
});

async function providerJson(response: Response, key: string): Promise<Record<string, unknown>> {
  const declared = response.headers.get('content-length');
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ||
      (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > RESPONSE_BYTES))) {
    await response.body?.cancel().catch(() => {});
    return {};
  }
  const reader = response.body?.getReader();
  if (!reader) return {};
  const buffer = new Uint8Array(RESPONSE_BYTES);
  let offset = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (offset + next.value.byteLength > buffer.byteLength) return {};
      buffer.set(next.value, offset);
      offset += next.value.byteLength;
    }
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
    if (content.includes(key)) return {};
    return record(JSON.parse(content));
  } finally {
    buffer.fill(0);
    await reader.cancel().catch(() => {});
  }
}

function httpOutcome(status: number): EffortProbeOutcome {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) return 'rejected';
  if (status === 402) return 'no_credit';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

function typedOutcome(data: Record<string, unknown>): EffortProbeOutcome {
  const answer = record(record(data.answers).total);
  const probabilities = record(answer.probabilities);
  const probability = probabilities[String(answer.choice)];
  if (answer.type !== 'choice' || !['eleven', 'nine', 'unknown'].includes(String(answer.choice)) ||
      typeof answer.confidence !== 'number' || answer.confidence < 0 || answer.confidence > 1 ||
      typeof probability !== 'number' || probability < 0 || probability > 1) return 'invalid_response';
  return answer.choice === 'eleven' ? 'passed' : 'unexpected_answer';
}

function chatOutcome(data: Record<string, unknown>): EffortProbeOutcome {
  if (!Array.isArray(data.choices) || data.choices.length !== 1) return 'invalid_response';
  const choice = record(data.choices[0]);
  if (choice.finish_reason === 'length') return 'truncated';
  const message = record(choice.message);
  if (choice.finish_reason !== 'stop' || message.tool_calls !== undefined && message.tool_calls !== null ||
      typeof message.content !== 'string') return 'invalid_response';
  return message.content.trim() === ANSWER ? 'passed' : 'unexpected_answer';
}

export async function runEffortProvider(probe: EffortProbe, key: string, limits: ReturnType<typeof effortProbeLimits>,
  signal: AbortSignal, fetcher?: typeof fetch): Promise<EffortProviderResult> {
  const body = JSON.stringify(effortProbeBody(probe, limits.output));
  // The fixed text request plus a margin for provider framing must fit the input reservation.
  if (new TextEncoder().encode(body).byteLength + 128 > limits.input) throw new Error('Effort probe input exceeds its reservation.');
  const response = await requestProvider(models[probe.provider].endpoint, {
    method: 'POST', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
  }, fetcher);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return failure(httpOutcome(response.status), response.status);
  }
  let data: Record<string, unknown>;
  try { data = await providerJson(response, key); }
  catch (error) {
    if (signal.aborted) throw error;
    return failure('invalid_response', response.status);
  }
  if (!matchesModel(probe, data.model)) return failure('invalid_response', response.status);
  const usage = record(data.usage);
  const typed = probe.provider === 'typesafe';
  const inputTokens = tokens(typed ? usage.input_tokens : usage.prompt_tokens);
  const outputTokens = tokens(typed ? usage.output_tokens : usage.completion_tokens);
  if (inputTokens === null || outputTokens === null) return failure('invalid_response', response.status);
  const reasoning = tokens(record(usage.completion_tokens_details).reasoning_tokens);
  const reasoningTokens = reasoning !== null && reasoning <= outputTokens ? reasoning : null;
  const outcome = inputTokens > limits.input || outputTokens > limits.output
    ? 'usage_limit' : typed ? typedOutcome(data) : chatOutcome(data);
  return { outcome, httpStatus: response.status, inputTokens, outputTokens, reasoningTokens };
}
