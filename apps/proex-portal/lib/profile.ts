import { Buffer } from 'node:buffer';
import { PNG } from 'pngjs';
import { HttpError } from './errors';

export type ProfileUser = { userId: string; email: string; displayName: string };
export type OwnProfile = { displayName: string; email: string; avatarUrl: string | null; version: number };
type StoredProfile = {
  user_id: string; display_name: string; avatar_key: string | null; mime: string | null;
  version: number; email: string | null; status: string;
};
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_AVATAR_BYTES + 64 * 1024;

function requireUser(user: ProfileUser | null): asserts user is ProfileUser {
  if (!user || typeof user.userId !== 'string' || !user.userId || user.userId.length > 200) {
    throw new HttpError(401, 'Entre para acessar seu perfil.', 'unauthenticated');
  }
}
function displayName(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'Informe seu nome de exibição.', 'invalid_name');
  const name = value.normalize('NFC').trim();
  if (!name || Array.from(name).length > 80 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(name)) {
    throw new HttpError(400, 'Use um nome entre 1 e 80 caracteres, sem quebras de linha.', 'invalid_name');
  }
  return name;
}
function expectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new HttpError(400, 'Atualize o perfil antes de salvar.', 'invalid_version');
  }
  return value;
}

async function storedProfile(db: D1Database, user: ProfileUser | null): Promise<StoredProfile> {
  requireUser(user);
  const account = await db.prepare('SELECT user_id,status FROM portal_users WHERE user_id=?')
    .bind(user.userId).first<{ user_id: string; status: string }>();
  if (!account || account.status !== 'active') {
    throw new HttpError(403, 'Seu acesso ao portal não está ativo.', 'account_inactive');
  }
  // Identity admission belongs to the session resolver. This only initializes a missing own profile.
  const initialName = Array.from((user.displayName || 'Integrante').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim()).slice(0, 80).join('') || 'Integrante';
  const now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO profiles
    (user_id,display_name,avatar_key,mime,version,created_at,updated_at)
    SELECT ?,?,NULL,NULL,1,?,? WHERE EXISTS
      (SELECT 1 FROM portal_users WHERE user_id=? AND status='active')`)
    .bind(user.userId, initialName, now, now, user.userId).run();
  const row = await db.prepare(`SELECT p.user_id,p.display_name,p.avatar_key,p.mime,p.version,u.email,u.status
    FROM profiles p JOIN portal_users u ON u.user_id=p.user_id WHERE p.user_id=? AND u.status='active'`)
    .bind(user.userId).first<StoredProfile>();
  if (!row || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new HttpError(403, 'Não foi possível acessar seu perfil ativo.', 'profile_unavailable');
  }
  return row;
}

function projectProfile(row: StoredProfile, user: ProfileUser): OwnProfile {
  return {
    displayName: row.display_name,
    email: row.email ?? user.email,
    avatarUrl: row.avatar_key && row.mime === 'image/png'
      ? `/api/profile/avatar/${encodeURIComponent(user.userId)}?v=${row.version}` : null,
    version: row.version,
  };
}

export async function getOwnProfile(
  db: D1Database, user: ProfileUser | null, hasPassword: boolean,
): Promise<{ profile: OwnProfile; hasPassword: boolean }> {
  const row = await storedProfile(db, user);
  return { profile: projectProfile(row, user!), hasPassword: hasPassword === true };
}

async function changedError(db: D1Database, user: ProfileUser): Promise<never> {
  const account = await db.prepare('SELECT status FROM portal_users WHERE user_id=?').bind(user.userId)
    .first<{ status: string }>();
  if (!account || account.status !== 'active') throw new HttpError(403, 'Seu acesso ao portal não está ativo.', 'account_inactive');
  throw new HttpError(409, 'Seu perfil mudou em outra sessão. Atualize para conferir antes de salvar.', 'profile_conflict');
}

export async function updateOwnProfile(
  db: D1Database, user: ProfileUser | null, input: Record<string, unknown>, hasPassword: boolean,
): Promise<{ profile: OwnProfile; hasPassword: boolean }> {
  requireUser(user);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['displayName', 'expectedVersion'].includes(key))) {
    throw new HttpError(400, 'Este formulário altera apenas o nome de exibição.', 'immutable_profile_fields');
  }
  const name = displayName(input.displayName);
  const version = expectedVersion(input.expectedVersion);
  await storedProfile(db, user);
  const now = new Date().toISOString();
  const result = await db.batch([
    db.prepare(`UPDATE profiles SET display_name=?,version=version+1,updated_at=?
      WHERE user_id=? AND version=? AND EXISTS
        (SELECT 1 FROM portal_users WHERE user_id=? AND status='active')`)
      .bind(name, now, user.userId, version, user.userId),
    db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
      SELECT ?,?,NULL,'profile.update',?,'{"fields":["displayName"]}',? WHERE changes()=1`)
      .bind(crypto.randomUUID(), user.userId, user.userId, now),
  ]);
  if (result[0].meta.changes !== 1) return changedError(db, user);
  return getOwnProfile(db, user, hasPassword);
}

/** Check size and IHDR before allocating pixels; re-encoding discards ancillary/private metadata. */
export function normalizeAvatarPng(bytes: Uint8Array): Uint8Array {
  if (!bytes.byteLength || bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new HttpError(413, 'A foto preparada deve ter até 2 MB.', 'avatar_too_large');
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((byte, index) => bytes[index] === byte)) {
    throw new HttpError(415, 'Envie a foto preparada em PNG pelo formulário.', 'invalid_avatar');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') {
    throw new HttpError(415, 'A foto PNG não é válida.', 'invalid_avatar');
  }
  const width = view.getUint32(16), height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 512 || height > 512) {
    throw new HttpError(400, 'Prepare a foto com até 512 pixels de largura e altura.', 'avatar_dimensions');
  }
  try {
    const decoded = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { checkCRC: true });
    if (decoded.width !== width || decoded.height !== height) throw new Error('invalid_dimensions');
    const clean = new PNG({ width, height });
    clean.data = decoded.data;
    const encoded = PNG.sync.write(clean, { colorType: 6, inputColorType: 6, bitDepth: 8, deflateLevel: 6 });
    if (encoded.byteLength > MAX_AVATAR_BYTES) throw new Error('encoded_avatar_too_large');
    return new Uint8Array(encoded);
  } catch {
    throw new HttpError(415, 'Não foi possível preparar esta foto PNG. Escolha outra imagem.', 'invalid_avatar');
  }
}

export async function replaceOwnAvatar(
  db: D1Database, storage: R2Bucket, user: ProfileUser | null,
  bytes: Uint8Array, versionInput: unknown, hasPassword: boolean,
): Promise<{ profile: OwnProfile; hasPassword: boolean }> {
  requireUser(user);
  const version = expectedVersion(versionInput);
  const before = await storedProfile(db, user);
  if (before.version !== version) return changedError(db, user);
  const normalized = normalizeAvatarPng(bytes);
  const key = `avatars/${crypto.randomUUID()}.png`;
  const now = new Date().toISOString();
  let committed = false;
  let databaseAttempted = false;
  let safeToDelete = true;
  try {
    await storage.put(key, normalized, { httpMetadata: { contentType: 'image/png' } });
    databaseAttempted = true;
    const result = await db.batch([
      db.prepare(`UPDATE profiles SET avatar_key=?,mime='image/png',version=version+1,updated_at=?
        WHERE user_id=? AND version=? AND EXISTS
          (SELECT 1 FROM portal_users WHERE user_id=? AND status='active')`)
        .bind(key, now, user.userId, version, user.userId),
      db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
        SELECT ?,?,NULL,'profile.avatar',?,'{"fields":["avatar"]}',? WHERE changes()=1`)
        .bind(crypto.randomUUID(), user.userId, user.userId, now),
    ]);
    if (result[0].meta.changes !== 1) return await changedError(db, user);
    committed = true;
  } catch (error) {
    if (databaseAttempted) {
      // A lost database response does not prove rollback. Do not delete an object still referenced
      // by a committed profile; preserve an uncertain object for later reconciliation if DB is down.
      try {
        const current = await db.prepare('SELECT avatar_key FROM profiles WHERE user_id=?')
          .bind(user.userId).first<{ avatar_key: string | null }>();
        committed = current?.avatar_key === key;
      } catch { safeToDelete = false; }
    }
    if (!committed) throw error;
  } finally {
    if (!committed && safeToDelete) {
      try { await storage.delete(key); } catch { console.error('Private avatar compensation failed.'); }
    }
  }
  if (before.avatar_key && before.avatar_key !== key) {
    try { await storage.delete(before.avatar_key); } catch { console.error('Previous private avatar cleanup failed.'); }
  }
  return getOwnProfile(db, user, hasPassword);
}

/** Self-only for this increment. A global admin is not implicitly entitled to another user's photo. */
export async function getOwnAvatar(
  db: D1Database, user: ProfileUser | null, requestedUserId: string,
): Promise<{ key: string; version: number }> {
  requireUser(user);
  if (requestedUserId !== user.userId) throw new HttpError(404, 'Foto não encontrada.', 'avatar_not_found');
  const row = await storedProfile(db, user);
  if (!row.avatar_key || row.mime !== 'image/png') throw new HttpError(404, 'Foto não encontrada.', 'avatar_not_found');
  return { key: row.avatar_key, version: row.version };
}

export function requireProfileMutation(request: Request, contentType: 'json' | 'form'): void {
  if (request.headers.get('X-Proex-Action') !== '1' || request.headers.get('Origin') !== new URL(request.url).origin) {
    throw new HttpError(403, 'Atualize o portal antes de salvar seu perfil.', 'invalid_origin');
  }
  const value = request.headers.get('Content-Type') ?? '';
  if (contentType === 'json' ? !/^application\/json(?:\s*;|$)/i.test(value) : !/^multipart\/form-data\s*;/i.test(value)) {
    throw new HttpError(415, 'Use o formulário do perfil para esta operação.', 'invalid_content_type');
  }
}

export async function readAvatarForm(request: Request): Promise<{ bytes: Uint8Array; expectedVersion: number }> {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_FORM_BYTES)) {
    throw new HttpError(413, 'A foto preparada deve ter até 2 MB.', 'avatar_too_large');
  }
  if (!request.body) throw new HttpError(400, 'Escolha uma foto.', 'missing_avatar');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FORM_BYTES) { await reader.cancel(); throw new HttpError(413, 'A foto preparada deve ter até 2 MB.', 'avatar_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  let form: FormData;
  try { form = await new Response(body, { headers: { 'Content-Type': request.headers.get('Content-Type')! } }).formData(); }
  catch { throw new HttpError(400, 'Não foi possível ler a foto enviada.', 'invalid_avatar_form'); }
  if ([...form.keys()].some((key) => !['file', 'expectedVersion'].includes(key))
    || form.getAll('file').length !== 1 || form.getAll('expectedVersion').length !== 1) {
    throw new HttpError(400, 'Este formulário altera somente a foto do seu perfil.', 'immutable_profile_fields');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string' || file.size < 1 || file.size > MAX_AVATAR_BYTES) {
    throw new HttpError(413, 'Escolha uma foto preparada com até 2 MB.', 'avatar_too_large');
  }
  if (file.type && !['image/png', 'application/octet-stream'].includes(file.type.toLowerCase())) {
    throw new HttpError(415, 'Prepare a foto em PNG pelo formulário.', 'invalid_avatar');
  }
  const rawVersion = form.get('expectedVersion');
  if (typeof rawVersion !== 'string' || !/^[1-9]\d{0,14}$/.test(rawVersion)) {
    throw new HttpError(400, 'Atualize o perfil antes de enviar a foto.', 'invalid_version');
  }
  return { bytes: new Uint8Array(await file.arrayBuffer()), expectedVersion: expectedVersion(Number(rawVersion)) };
}
