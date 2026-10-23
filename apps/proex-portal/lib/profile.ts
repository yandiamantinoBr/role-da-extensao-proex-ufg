import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { HttpError } from './errors';

export type ProfileUser = { userId: string; email: string; displayName: string };
export type ProfileAffiliation = '' | 'student' | 'technical' | 'faculty' | 'scholar' | 'intern' | 'collaborator' | 'other';
export type ProfileRegistrationType = '' | 'siape' | 'student' | 'other';
export type OwnProfile = {
  displayName: string; email: string; unit: string; unitId: string | null; affiliation: ProfileAffiliation;
  jobTitle: string; phone: string; registrationType: ProfileRegistrationType; registrationNumber: string;
  avatarUrl: string | null; version: number;
};
type StoredProfile = {
  user_id: string; display_name: string; avatar_key: string | null; mime: string | null;
  unit: string; unit_id: string | null; affiliation: ProfileAffiliation; job_title: string; phone: string;
  registration_type: ProfileRegistrationType; registration_number: string; version: number; email: string | null; status: string;
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
function optionalText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `Informe ${label} como texto.`, 'invalid_profile_metadata');
  const normalized = value.normalize('NFC').trim();
  if (Array.from(normalized).length > max || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(normalized)) throw new HttpError(400, `Use até ${max} caracteres em ${label}, sem quebras de linha.`, 'invalid_profile_metadata');
  return normalized;
}
function optionalChoice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new HttpError(400, `Escolha ${label} válido.`, 'invalid_profile_metadata');
  return value as T;
}
function optionalUnitId(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new HttpError(400, 'Escolha uma unidade válida no catálogo.', 'invalid_profile_unit');
  return value;
}

async function storedProfile(db: D1Database, user: ProfileUser | null): Promise<StoredProfile> {
  requireUser(user);
  const account = await db.prepare('SELECT user_id,status,anonymized_at FROM portal_users WHERE user_id=?')
    .bind(user.userId).first<{ user_id: string; status: string; anonymized_at: string | null }>();
  if (!account || account.status !== 'active' || account.anonymized_at) {
    throw new HttpError(403, 'Seu acesso ao portal não está ativo.', 'account_inactive');
  }
  // Identity admission belongs to the session resolver. This only initializes a missing own profile.
  const initialName = Array.from((user.displayName || 'Integrante').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim()).slice(0, 80).join('') || 'Integrante';
  const now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO profiles
    (user_id,display_name,avatar_key,mime,version,created_at,updated_at)
    SELECT ?,?,NULL,NULL,1,?,? WHERE EXISTS
      (SELECT 1 FROM portal_users WHERE user_id=? AND status='active' AND anonymized_at IS NULL)`)
    .bind(user.userId, initialName, now, now, user.userId).run();
  const row = await db.prepare(`SELECT p.user_id,p.display_name,p.unit,p.unit_id,p.affiliation,p.job_title,p.phone,p.registration_type,p.registration_number,p.avatar_key,p.mime,p.version,u.email,u.status
    FROM profiles p JOIN portal_users u ON u.user_id=p.user_id WHERE p.user_id=? AND u.status='active' AND u.anonymized_at IS NULL`)
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
    unit: row.unit,
    unitId: row.unit_id,
    affiliation: row.affiliation,
    jobTitle: row.job_title,
    phone: row.phone,
    registrationType: row.registration_type,
    registrationNumber: row.registration_number,
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
  const account = await db.prepare('SELECT status,anonymized_at FROM portal_users WHERE user_id=?').bind(user.userId)
    .first<{ status: string; anonymized_at: string | null }>();
  if (!account || account.status !== 'active' || account.anonymized_at) throw new HttpError(403, 'Seu acesso ao portal não está ativo.', 'account_inactive');
  throw new HttpError(409, 'Seu perfil ou a unidade escolhida mudou. Atualize para conferir antes de salvar.', 'profile_conflict');
}

export async function updateOwnProfile(
  db: D1Database, user: ProfileUser | null, input: Record<string, unknown>, hasPassword: boolean,
): Promise<{ profile: OwnProfile; hasPassword: boolean }> {
  requireUser(user);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['displayName', 'unit', 'unitId', 'affiliation', 'jobTitle', 'phone', 'registrationType', 'registrationNumber', 'expectedVersion'].includes(key))) {
    throw new HttpError(400, 'Este formulário altera apenas os dados do seu perfil.', 'immutable_profile_fields');
  }
  const name = displayName(input.displayName);
  const version = expectedVersion(input.expectedVersion);
  const before = await storedProfile(db, user);
  const unit = Object.hasOwn(input, 'unit') ? optionalText(input.unit, 'unidade ou setor', 120) : before.unit;
  const unitId = Object.hasOwn(input, 'unitId') ? optionalUnitId(input.unitId) : before.unit_id;
  if (unitId !== null && unitId !== before.unit_id && !await db.prepare("SELECT id FROM organizational_units WHERE id=? AND status='active'").bind(unitId).first()) throw new HttpError(400, 'Escolha uma unidade ativa do catálogo.', 'invalid_profile_unit');
  const affiliation = Object.hasOwn(input, 'affiliation') ? optionalChoice(input.affiliation, ['', 'student', 'technical', 'faculty', 'scholar', 'intern', 'collaborator', 'other'] as const, 'um vínculo institucional') : before.affiliation;
  const jobTitle = Object.hasOwn(input, 'jobTitle') ? optionalText(input.jobTitle, 'vínculo ou função institucional', 120) : before.job_title;
  const phone = Object.hasOwn(input, 'phone') ? optionalText(input.phone, 'telefone de contato', 40) : before.phone;
  const registrationType = Object.hasOwn(input, 'registrationType') ? optionalChoice(input.registrationType, ['', 'siape', 'student', 'other'] as const, 'um tipo de matrícula') : before.registration_type;
  const registrationNumber = Object.hasOwn(input, 'registrationNumber') ? optionalText(input.registrationNumber, 'matrícula institucional', 40) : before.registration_number;
  if (registrationNumber && !registrationType) throw new HttpError(400, 'Escolha o tipo da matrícula ou deixe o número em branco.', 'invalid_registration_type');
  const fields = ['displayName', 'unit', 'unitId', 'affiliation', 'jobTitle', 'phone', 'registrationType', 'registrationNumber'].filter(field => Object.hasOwn(input, field));
  const now = new Date().toISOString();
  const result = await db.batch([
    db.prepare(`UPDATE profiles SET display_name=?,unit=?,unit_id=?,affiliation=?,job_title=?,phone=?,registration_type=?,registration_number=?,version=version+1,updated_at=?
      WHERE user_id=? AND version=? AND EXISTS
        (SELECT 1 FROM portal_users WHERE user_id=? AND status='active' AND anonymized_at IS NULL)
      AND (? IS NULL OR EXISTS(SELECT 1 FROM organizational_units WHERE id=? AND (status='active' OR id=?)))`)
      .bind(name, unit, unitId, affiliation, jobTitle, phone, registrationType, registrationNumber, now, user.userId, version, user.userId, unitId, unitId, before.unit_id),
    db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
      SELECT ?,?,NULL,'profile.update',?,?,? WHERE changes()=1`)
      .bind(crypto.randomUUID(), user.userId, user.userId, JSON.stringify({ fields }), now),
  ]);
  if (result[0].meta.changes !== 1) return changedError(db, user);
  return getOwnProfile(db, user, hasPassword);
}

/** Check size and IHDR before allocating pixels; re-encoding discards ancillary/private metadata. */
export async function normalizeAvatarPng(bytes: Uint8Array): Promise<Uint8Array> {
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
    // Reject a later IHDR before decoding: its dimensions must not bypass the bounded first header.
    let offset = 8, hasEnd = false;
    const compressed: Buffer[] = [];
    while (offset + 12 <= bytes.byteLength) {
      const length = view.getUint32(offset), kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (length > bytes.byteLength - offset - 12 || (kind === 'IHDR' && offset !== 8)) throw new Error('invalid_png_chunks');
      if (kind === 'IDAT') compressed.push(Buffer.from(bytes.buffer, bytes.byteOffset + offset + 8, length));
      offset += length + 12;
      if (kind === 'IEND') { hasEnd = length === 0 && offset === bytes.byteLength; break; }
    }
    if (!compressed.length || !hasEnd) throw new Error('incomplete_png');
    // Bound decompression before pngjs streams pixels. Allow 16-bit RGBA plus Adam7 row filters.
    inflateSync(Buffer.concat(compressed), { maxOutputLength: width * height * 8 + height * 7 });
    // pngjs.sync.read subclasses private Node zlib internals and fails under workerd.
    // The public asynchronous parser uses supported zlib streams, with CRC checks enabled.
    const decoded = await new Promise<PNG>((resolve, reject) => {
      new PNG({ checkCRC: true }).parse(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), (error, image) => error ? reject(error) : resolve(image));
    });
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

async function deletePrivateAvatar(db: D1Database, storage: R2Bucket, userId: string, key: string): Promise<void> {
  try { await storage.delete(key); }
  catch {
    try {
      await db.batch([
        db.prepare('INSERT INTO private_object_deletions(id,user_id,object_key,mime,created_at) VALUES(?,?,?,?,?)')
          .bind(crypto.randomUUID(), userId, key, 'image/png', new Date().toISOString()),
        // An upload can finish I/O after account anonymization has already completed its cleanup.
        db.prepare(`UPDATE privacy_requests SET status='cleanup_pending',completed_at=NULL
          WHERE user_id=? AND status='completed' AND EXISTS
            (SELECT 1 FROM portal_users WHERE user_id=? AND anonymized_at IS NOT NULL)`)
          .bind(userId, userId),
      ]);
    } catch { console.error('Private avatar cleanup could not be queued.'); }
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
  const normalized = await normalizeAvatarPng(bytes);
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
          (SELECT 1 FROM portal_users WHERE user_id=? AND status='active' AND anonymized_at IS NULL)`)
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
      await deletePrivateAvatar(db, storage, user.userId, key);
    }
  }
  if (before.avatar_key && before.avatar_key !== key) {
    await deletePrivateAvatar(db, storage, user.userId, before.avatar_key);
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
