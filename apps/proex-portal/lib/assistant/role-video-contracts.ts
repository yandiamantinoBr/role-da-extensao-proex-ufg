export const ROLE_VIDEO_EFFORT_LABELS = { low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'XHigh' } as const;
export type RoleVideoEffort = keyof typeof ROLE_VIDEO_EFFORT_LABELS;

export const ROLE_VIDEO_MODELS = {
  'gemini-3.8-flash': { label: 'Gemini 3.8 Flash', efforts: ['low', 'medium', 'high'], defaultEffort: 'low' },
  'gemini-4-hydrogen': { label: 'Gemini 4 Hydrogen', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'xhigh' },
} as const satisfies Record<string, { label: string; efforts: readonly RoleVideoEffort[]; defaultEffort: RoleVideoEffort }>;
export type RoleVideoModel = keyof typeof ROLE_VIDEO_MODELS;
export const DEFAULT_ROLE_VIDEO = { model: 'gemini-3.8-flash', effort: 'low' } as const;
export type RoleVideoProfile = { model: RoleVideoModel; effort: RoleVideoEffort };
export type RoleVideoStatus = RoleVideoProfile & { label: string; approval: string };

export function supportsRoleVideo(model: unknown, effort: unknown) {
  if (typeof model !== 'string' || !Object.hasOwn(ROLE_VIDEO_MODELS, model)) return false;
  const { efforts } = ROLE_VIDEO_MODELS[model as RoleVideoModel];
  return efforts.some(level => level === effort);
}
export const ROLE_VIDEO_MIME = 'video/mp4';
export const ROLE_VIDEO_MAX_BYTES = 2_000_000;
export const ROLE_VIDEO_MAX_SECONDS = 12;
export const ROLE_VIDEO_MIN_SECONDS = 1;
export const ROLE_VIDEO_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// Google documents approximately 100 tokens per second at low resolution, including audio.
// Reserve above its documented high resolution rate, including an extra frame and metadata.
const MEDIA_TOKENS_PER_SECOND = 400;
const REQUEST_TOKENS = 512;
const PRICE_CHANGE_UTC = Date.UTC(2027, 0, 1);

/** Standard paid tier, USD per million tokens, numerically equal to micro-USD per token. */
export function roleVideoCostMicros(inputTokens: number, outputTokens: number, now = Date.now(), model: RoleVideoModel = DEFAULT_ROLE_VIDEO.model) {
  const multiplier = model === 'gemini-4-hydrogen' || now >= PRICE_CHANGE_UTC ? 2 : 1;
  return Math.ceil(multiplier * (.75 * inputTokens + 3.75 * outputTokens));
}

/** Offers the maximum accepted video duration until the server has inspected the clip. */
export function roleVideoEstimate({
  textBytes, maxOutputTokens, seconds = ROLE_VIDEO_MAX_SECONDS, now, model,
}: { textBytes: number; maxOutputTokens: number; seconds?: number; now?: number; model?: RoleVideoModel }) {
  const mediaTokens = (Math.ceil(seconds) + 1) * MEDIA_TOKENS_PER_SECOND;
  const inputTokens = textBytes + REQUEST_TOKENS + mediaTokens;
  return {
    tokens: inputTokens + maxOutputTokens,
    inputTokens,
    costMicros: roleVideoCostMicros(inputTokens, maxOutputTokens, now, model),
  };
}
