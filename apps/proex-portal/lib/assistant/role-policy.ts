// Browser-safe policy shared by Settings and the Rolê runtime.
export const ROLE_EFFORT_LABELS = {
  default: 'Padrão do Portal', off: 'Desligado', low: 'Baixo', medium: 'Médio', high: 'Alto', max: 'Máximo',
} as const;
export type RoleEffort = keyof typeof ROLE_EFFORT_LABELS;

export const DEFAULT_ROLE_POLICY = {
  roleReasoningEffort: 'default' as RoleEffort,
  roleHistoryMessages: 6,
  roleInputTokenCeiling: 0,
  roleOutputTokenLimit: 700,
  rolePortalContextEnabled: true,
  rolePublicSearchEnabled: true,
};
export type RolePolicy = typeof DEFAULT_ROLE_POLICY;
export const ROLE_POLICY_KEYS = Object.keys(DEFAULT_ROLE_POLICY) as (keyof RolePolicy)[];
export const ROLE_POLICY_BOUNDS = { roleHistoryMessages: [0, 6], roleInputTokenCeiling: [4_000, 120_000], roleOutputTokenLimit: [300, 4_000] } as const;

type ModelIdentity = { kind: string; baseUrl: string; model: string };
export function roleReasoningSupport({ kind, baseUrl, model }: ModelIdentity): readonly RoleEffort[] {
  if (kind !== 'openai_chat') return [];
  const base = baseUrl.replace(/\/$/, '');
  if (base === 'https://api.deepseek.com' && ['deepseek-flash', 'deepseek-v4-pro'].includes(model)) return ['off', 'low', 'high', 'max'];
  if (base === 'https://api.groq.com/openai/v1' && /^openai\/gpt-oss-(20b|120b)$/.test(model)) return ['low', 'medium', 'high'];
  return [];
}

export function roleReasoningParameters(identity: ModelIdentity, effort: RoleEffort) {
  const supported = roleReasoningSupport(identity);
  if (!supported.length || (effort !== 'default' && !supported.includes(effort))) return null;
  if (supported.includes('off')) return effort === 'default' || effort === 'off'
    ? { thinking: { type: 'disabled' } }
    : { thinking: { type: 'enabled' }, reasoning_effort: effort };
  return { reasoning_effort: effort === 'default' ? 'low' : effort, include_reasoning: false };
}

export function roleHistoryForPolicy<T>(history: readonly T[], messages: number): T[] {
  return messages > 0 ? history.slice(-messages) : [];
}
