export const ROLE_VIDEO_MODEL = 'gemini-3.8-flash';
export const ROLE_VIDEO_LABEL = 'Gemini 3.8 Flash';
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
export function roleVideoCostMicros(inputTokens: number, outputTokens: number, now = Date.now()) {
  const multiplier = now < PRICE_CHANGE_UTC ? 1 : 2;
  return Math.ceil(multiplier * (.75 * inputTokens + 3.75 * outputTokens));
}

/** Offers the maximum accepted video duration until the server has inspected the clip. */
export function roleVideoEstimate({
  textBytes, maxOutputTokens, seconds = ROLE_VIDEO_MAX_SECONDS, now,
}: { textBytes: number; maxOutputTokens: number; seconds?: number; now?: number }) {
  const mediaTokens = (Math.ceil(seconds) + 1) * MEDIA_TOKENS_PER_SECOND;
  const inputTokens = textBytes + REQUEST_TOKENS + mediaTokens;
  return {
    tokens: inputTokens + maxOutputTokens,
    inputTokens,
    costMicros: roleVideoCostMicros(inputTokens, maxOutputTokens, now),
  };
}
