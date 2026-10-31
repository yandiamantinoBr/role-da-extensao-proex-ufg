import { HttpError } from '../errors';
import type { ImportReview } from './contracts';

const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, value => String.fromCharCode(value)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decode(value: string): Uint8Array { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0)); }
async function signature(secret: string, payload: string,version:2|3=2): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`proex-import-v${version}:${payload}`)));
}
export async function signImportReview(secret: string, review: ImportReview): Promise<string> {
  const payload = encode(encoder.encode(JSON.stringify(review)));
  if (payload.length > 180000) throw new HttpError(413, 'A prévia ficou muito grande. Divida o documento.', 'import_review_limit');
  return `${payload}.${encode(await signature(secret, payload,review.version))}`;
}
export async function readImportReview(secret: string, token: unknown, actorId: string, now = Date.now()): Promise<ImportReview> {
  const invalid = () => new HttpError(400, 'Gere uma nova prévia antes de confirmar a importação.', 'import_review_invalid');
  if (typeof token !== 'string' || token.length > 180100 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
  const [payload, supplied] = token.split('.');
  let review: ImportReview; try { review = JSON.parse(new TextDecoder().decode(decode(payload))) as ImportReview; } catch { throw invalid(); }
  if(review.version!==2&&review.version!==3)throw invalid();
  const expected = await signature(secret, payload,review.version), received = decode(supplied);
  let difference = expected.length ^ received.length;
  for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ received[index];
  if (difference) throw invalid();
  if (review.version !== 2&&review.version!==3 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(review.organizationId) || review.provenance?.organizationId !== review.organizationId || review.actorId !== actorId || !Number.isFinite(review.expiresAt) || review.expiresAt <= now || review.expiresAt > now + 16 * 60000) throw invalid();
  if(review.version===3&&(!review.provenance.ai||!Number.isSafeInteger(review.provenance.ai.configRevision)||review.provenance.ai.configRevision<1))throw invalid();
  return review;
}
export async function importDigest(value: string | Uint8Array): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value))), byte => byte.toString(16).padStart(2, '0')).join(''); }
