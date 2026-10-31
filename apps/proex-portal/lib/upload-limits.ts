// One new-upload contract for the browser and both APIs. Keep the entire
// multipart request below the Vercel Function's 4.5 MB body limit.
export const MAX_UPLOAD_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_FILE_BYTES + 64 * 1024;
export const UPLOAD_LIMIT_LABEL = '4 MB';
export const UPLOAD_LIMIT_MESSAGE = `O arquivo deve ter no máximo ${UPLOAD_LIMIT_LABEL}.`;

export function uploadErrorMessage(status: number, error: unknown, fallback: string): string {
  // The hosting platform can reject the body before our API runs and return
  // plain text or HTML instead of our usual JSON error.
  if (status === 413) return UPLOAD_LIMIT_MESSAGE;
  return typeof error === 'string' && error.trim() ? error : fallback;
}
