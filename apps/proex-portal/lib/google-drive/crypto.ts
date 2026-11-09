import { HttpError } from '../errors';
import { credentialKeyId, type CredentialKeys } from '../assistant/crypto';

/*
 * Cofre dos tokens do Google Drive. Usa o mesmo segredo dedicado da central de chaves (PROEX_KEYS_SECRET,
 * com PROEX_KEYS_PREVIOUS_SECRET durante a rotação), mas com domínio HKDF próprio: um envelope de token do
 * Drive nunca abre como chave de IA, nem o contrário. O contexto autenticado prende o envelope à pessoa e à
 * conta Google; trocar a linha de dono no banco faz a decifragem falhar.
 */
const encoder = new TextEncoder();
const DOMAIN = 'proex.google-drive.refresh-token/v1';
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
function un64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('base64');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
}
async function key(secret: string) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(DOMAIN), info: encoder.encode('server-only') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const context = (userId: string, googleSub: string, keyId: string) => encoder.encode(JSON.stringify([DOMAIN, userId, googleSub, keyId]));
export const driveVaultUnavailable = () => new HttpError(503, 'O cofre do portal ainda não está configurado. Procure a administração geral.', 'drive_vault_unavailable');

/** Falha se o segredo dedicado faltar ou for igual ao da sessão: nunca cai para outra chave. */
export async function driveKeyId(keys: CredentialKeys, authSecret: string): Promise<string> {
  try { return await credentialKeyId(keys.current, authSecret); } catch { throw driveVaultUnavailable(); }
}

export async function sealRefreshToken(token: string, owner: { userId: string; googleSub: string }, keys: CredentialKeys, authSecret: string): Promise<{ ciphertext: string; keyId: string }> {
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) throw new HttpError(502, 'O Google não devolveu uma autorização válida. Tente conectar de novo.', 'drive_oauth_token');
  const keyId = await driveKeyId(keys, authSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12)), plain = encoder.encode(token);
  try {
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(owner.userId, owner.googleSub, keyId) }, await key(keys.current!), plain);
    return { ciphertext: `gd1.${keyId}.${b64(iv)}.${b64(new Uint8Array(sealed))}`, keyId };
  } finally { plain.fill(0); }
}

/** Abre com a chave atual ou, durante a rotação, com a anterior. Qualquer falha vira o mesmo erro genérico. */
export async function openRefreshToken(envelope: string, owner: { userId: string; googleSub: string }, keys: CredentialKeys, authSecret: string): Promise<string> {
  try {
    const fields = envelope.split('.');
    const [version, keyId, nonce, body] = fields;
    if (fields.length !== 4 || version !== 'gd1' || !/^[A-Za-z0-9_-]{16}$/.test(keyId) || envelope.length > 8000) throw new Error('format');
    for (const secret of [keys.current, keys.previous]) {
      if (!secret) continue;
      let id: string;
      try { id = await credentialKeyId(secret, authSecret); } catch { continue; }
      if (id !== keyId) continue;
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(nonce), additionalData: context(owner.userId, owner.googleSub, keyId) }, await key(secret), un64(body)));
      try { return new TextDecoder().decode(plain); } finally { plain.fill(0); }
    }
  } catch { /* cai no erro genérico */ }
  // Segredo trocado sem o anterior, ou linha adulterada: erro de configuração. Nada é apagado aqui.
  throw driveVaultUnavailable();
}

/* Estado do OAuth: envelope curto num cookie HttpOnly, com o verificador PKCE e a pessoa que iniciou. */
const STATE_DOMAIN = 'proex.google-drive.oauth-state/v1';
async function stateKey(secret: string) {
  if (typeof secret !== 'string' || secret.length < 32) throw driveVaultUnavailable();
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(STATE_DOMAIN), info: encoder.encode('cookie') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export type OAuthState = { userId: string; state: string; verifier: string; expiresAt: number; returnTo: string };
export async function sealOAuthState(value: OAuthState, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(STATE_DOMAIN) }, await stateKey(secret), encoder.encode(JSON.stringify(value)));
  return `${b64(iv)}.${b64(new Uint8Array(sealed))}`;
}
export async function openOAuthState(value: string | undefined, secret: string, now = Date.now()): Promise<OAuthState | null> {
  try {
    if (!value || value.length > 2000) return null;
    const [nonce, body, extra] = value.split('.');
    if (!nonce || !body || extra) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(nonce), additionalData: encoder.encode(STATE_DOMAIN) }, await stateKey(secret), un64(body));
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as OAuthState;
    if (typeof parsed.userId !== 'string' || typeof parsed.state !== 'string' || typeof parsed.verifier !== 'string' || typeof parsed.returnTo !== 'string' || !Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= now || parsed.expiresAt > now + 11 * 60000) return null;
    return parsed;
  } catch { return null; }
}
export function randomToken(bytes = 32): string { return b64(crypto.getRandomValues(new Uint8Array(bytes))); }
export async function pkceChallenge(verifier: string): Promise<string> { return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)))); }
export async function sha256Hex(bytes: Uint8Array): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, '0')).join(''); }

/* Plano assinado de envio (prévia → confirmação), igual ao fluxo prepare/apply do assistente. */
const PLAN_DOMAIN = 'proex.google-drive.plan/v1';
async function planKey(secret: string) {
  if (typeof secret !== 'string' || secret.length < 32) throw driveVaultUnavailable();
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(PLAN_DOMAIN), info: encoder.encode('hmac') }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
}
export async function signDrivePlan(secret: string, payload: Record<string, unknown>): Promise<string> {
  const body = b64(encoder.encode(JSON.stringify(payload)));
  return `${body}.${b64(new Uint8Array(await crypto.subtle.sign('HMAC', await planKey(secret), encoder.encode(`${PLAN_DOMAIN}:${body}`))))}`;
}
export async function verifyDrivePlan<T extends Record<string, unknown>>(secret: string, token: unknown, actorId: string, now = Date.now()): Promise<T> {
  try {
    if (typeof token !== 'string' || token.length > 4000) throw new Error('token');
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra || !await crypto.subtle.verify('HMAC', await planKey(secret), un64(signature), encoder.encode(`${PLAN_DOMAIN}:${body}`))) throw new Error('signature');
    const payload = JSON.parse(new TextDecoder().decode(un64(body)));
    if (payload.actorId !== actorId || typeof payload.id !== 'string' || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now || payload.expiresAt > now + 11 * 60000) throw new Error('expired');
    return payload as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(409, 'A prévia expirou, mudou ou pertence a outra pessoa. Prepare o envio de novo.', 'drive_plan_invalid');
  }
}
