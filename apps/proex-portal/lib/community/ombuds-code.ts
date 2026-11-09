/*
 * Ombuds tracking code: 20 Crockford base32 symbols (100 random bits), shown as OUV-XXXX-XXXX-XXXX-XXXX-XXXX.
 * Generated in the browser; the server stores only its SHA-256 and never the code itself.
 * Shared by client and server (no server imports here).
 */
export const OMBUDS_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newOmbudsCode(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(20));
  const symbols = Array.from(bytes, byte => OMBUDS_ALPHABET[byte & 31]).join('');
  return `OUV-${symbols.match(/.{4}/g)!.join('-')}`;
}
/** Accepts spaces, hyphens, lower case and the usual look-alikes (O→0, I/L→1). Returns null when malformed. */
export function normalizeOmbudsCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  let text = value.toUpperCase().replace(/[\s-]/g, '');
  if (text.startsWith('OUV')) text = text.slice(3);
  text = text.replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{20}$/.test(text) ? text : null;
}
