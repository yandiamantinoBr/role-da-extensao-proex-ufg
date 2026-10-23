import { accessibleProjects, requireCapability, type PortalActor } from './access';
import { HttpError } from './errors';
import { prepareMutation } from './mutations';

export const MAX_RECORD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_RECORD_FILE_BYTES + 64 * 1024;
const KINDS = ['observation', 'maintenance', 'distribution', 'consumption', 'project', 'material', 'loan'] as const;
type Kind = typeof KINDS[number];
type Scope = string[] | null;
type Row = Record<string, any>;
type StoredRecord = { id: string; project_id: string; kind: Kind; loan_id: string | null; item_id: string | null };
type Attachment = { id: string; record_id: string; project_id: string; object_key: string; name: string; mime: string; size: number };
export type RecordFileInput = { recordId: string; bytes: Uint8Array; name: string; declaredMime: string; operationKey: string };
const MIME_EXTENSIONS: Record<string, string[]> = {
  'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'],
};
const WRITE_CAP: Record<Kind, string> = { loan: 'loans.manage', maintenance: 'inventory.manage', distribution: 'inventory.manage', consumption: 'inventory.manage', material: 'inventory.manage', project: 'campaigns.manage', observation: 'campaigns.manage' };
const INVENTORY_KINDS = ['maintenance', 'distribution', 'consumption', 'material'];
function stmt(db: D1Database, sql: string, params: (string | number | null)[] = []) { return db.prepare(sql).bind(...params); }
function value(input: unknown, label: string, max: number, optional = false): string {
  if (input === undefined || input === null) { if (optional) return ''; throw new HttpError(400, `Informe ${label}.`, 'invalid_input'); }
  if (typeof input !== 'string') throw new HttpError(400, `Informe ${label} como texto.`, 'invalid_input');
  const result = input.normalize('NFC').trim();
  if ((!optional && !result) || result.length > max || /[\u0000\u000b\u000c\u007f]/u.test(result)) throw new HttpError(400, `${label} deve ter ${optional ? 'até' : 'entre 1 e'} ${max} caracteres válidos.`, 'invalid_input');
  return result;
}
function idValue(input: unknown, label: string, optional = false): string | null {
  const id = value(input, label, 200, optional);
  if (!id && optional) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) throw new HttpError(400, `Identificador inválido para ${label}.`, 'invalid_identifier');
  return id;
}
function isoValue(input: unknown, label: string, optional = false): string | null {
  if ((input === undefined || input === null || input === '') && optional) return null;
  const raw = value(input, label, 40);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(raw)) throw new HttpError(400, `${label} deve conter data, horário e fuso horário.`, 'invalid_date');
  const timestamp = Date.parse(raw), [year, month, day] = raw.slice(0, 10).split('-').map(Number);
  if (!Number.isFinite(timestamp) || year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new HttpError(400, `${label} não é uma data válida.`, 'invalid_date');
  return new Date(timestamp).toISOString();
}
function kindValue(input: unknown): Kind {
  if (typeof input !== 'string' || !(KINDS as readonly string[]).includes(input)) throw new HttpError(400, 'Escolha uma categoria de registro válida.', 'invalid_kind');
  return input as Kind;
}
function actorRequired(actor: PortalActor | null): asserts actor is PortalActor {
  if (!actor) throw new HttpError(401, 'Entre para acessar os registros.', 'unauthenticated');
}
function scopeUnion(...scopes: Scope[]): Scope { return scopes.some(scope => scope === null) ? null : [...new Set(scopes.flatMap(scope => scope ?? []))]; }
function scopeFilter(scope: Scope, column: string): { sql: string; params: string[] } {
  return scope === null ? { sql: '1=1', params: [] } : scope.length ? { sql: `${column} IN (${scope.map(() => '?').join(',')})`, params: scope } : { sql: '1=0', params: [] };
}
function writeRoles(record: Pick<StoredRecord, 'kind' | 'loan_id'>): string[] {
  if (record.loan_id && record.kind !== 'loan') return ['owner', 'manager'];
  return record.kind === 'loan' ? ['owner', 'manager', 'loans'] : INVENTORY_KINDS.includes(record.kind) ? ['owner', 'manager', 'inventory'] : ['owner', 'manager'];
}
function readRoles(record: Pick<StoredRecord, 'kind' | 'loan_id'>): string[] {
  return record.loan_id || record.kind === 'loan' ? ['owner', 'manager', 'loans'] : INVENTORY_KINDS.includes(record.kind) ? ['owner', 'manager', 'inventory'] : ['owner', 'manager', 'viewer'];
}
function requireWrite(actor: PortalActor, record: Pick<StoredRecord, 'kind' | 'loan_id' | 'project_id'>): void {
  requireCapability(actor, WRITE_CAP[record.kind], record.project_id);
  if (record.loan_id && record.kind !== 'loan') requireCapability(actor, 'loans.manage', record.project_id);
}
async function liveMembership(db: D1Database, actor: PortalActor, projectId: string, roles: string[]): Promise<void> {
  const row = await stmt(db, `SELECT id FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL
    AND m.role IN (${roles.map(() => '?').join(',')}) AND (m.project_id IS NULL OR m.project_id=?)
    AND NOT EXISTS (SELECT 1 FROM portal_users u WHERE u.user_id=m.user_id AND (u.status!='active' OR COALESCE(u.activation_pending,0)!=0 OR u.anonymized_at IS NOT NULL)) LIMIT 1`, [actor.userId, ...roles, projectId]).first();
  if (!row) throw new HttpError(403, 'Seu acesso a estes registros mudou. Atualize o portal.', 'access_changed');
}
async function recordById(db: D1Database, id: string): Promise<StoredRecord> {
  const record = await stmt(db, `SELECT r.id,r.project_id,r.kind,r.loan_id,r.item_id FROM records r
    LEFT JOIN items i ON i.id=r.item_id LEFT JOIN loans l ON l.id=r.loan_id
    WHERE r.id=? AND (r.item_id IS NULL OR i.project_id=r.project_id) AND (r.loan_id IS NULL OR l.project_id=r.project_id)`, [id]).first<StoredRecord>();
  if (!record || !(KINDS as readonly string[]).includes(record.kind)) throw new HttpError(404, 'Registro não encontrado.', 'record_not_found');
  return record;
}
async function requireRead(db: D1Database, actor: PortalActor, record: StoredRecord): Promise<void> {
  if (record.loan_id || record.kind === 'loan') requireCapability(actor, 'loans.read', record.project_id);
  else if (INVENTORY_KINDS.includes(record.kind)) requireCapability(actor, 'inventory.read', record.project_id);
  else {
    const scopes = scopeUnion(accessibleProjects(actor, 'reports.read'), accessibleProjects(actor, 'campaigns.manage'));
    if (scopes !== null && !scopes.includes(record.project_id)) throw new HttpError(403, 'Você não tem acesso a estes registros.', 'forbidden');
  }
  await liveMembership(db, actor, record.project_id, readRoles(record));
}
function attachmentProjection(row: Row) { return { id: row.id, name: row.name, mime: row.mime, size: row.size }; }
async function projectRecords(db: D1Database, rows: Row[]): Promise<Row[]> {
  if (!rows.length) return [];
  const attachments = (await stmt(db, `SELECT a.id,a.record_id,a.name,a.mime,a.size FROM record_attachments a
    JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id WHERE a.deleted_at IS NULL AND a.record_id IN (${rows.map(() => '?').join(',')}) ORDER BY a.created_at,a.id`, rows.map(row => row.id)).all<Row>()).results ?? [];
  return rows.map(row => ({ ...row, attachments: attachments.filter(attachment => attachment.record_id === row.id).map(attachmentProjection) }));
}
async function projectedRecord(db: D1Database, id: string): Promise<Row> {
  const record = await stmt(db, 'SELECT id,project_id,kind,title,body,occurred_at,starts_at,ends_at,item_id,loan_id,created_at FROM records WHERE id=?', [id]).first<Row>();
  if (!record) throw new HttpError(404, 'Registro não encontrado.', 'record_not_found');
  return (await projectRecords(db, [record]))[0];
}

export async function listRecords(db: D1Database, actor: PortalActor | null, filters: { projectId?: unknown; from?: unknown; to?: unknown; limit?: unknown } = {}): Promise<{ records: Row[]; limit: number; truncated: boolean }> {
  actorRequired(actor);
  const projectId = idValue(filters.projectId, 'o projeto', true);
  const from = isoValue(filters.from, 'O início do período', true), to = isoValue(filters.to, 'O fim do período', true);
  if (from && to && to <= from) throw new HttpError(400, 'O fim do período deve ocorrer depois do início.', 'invalid_interval');
  const rawLimit = filters.limit === undefined || filters.limit === null || filters.limit === '' ? 100 : Number(filters.limit);
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1) throw new HttpError(400, 'Limite de registros inválido.', 'invalid_limit');
  const limit = Math.min(rawLimit, 100);
  const projectScope = scopeUnion(accessibleProjects(actor, 'reports.read'), accessibleProjects(actor, 'campaigns.manage'));
  const inventoryScope = accessibleProjects(actor, 'inventory.read'), loanScope = accessibleProjects(actor, 'loans.read');
  if (projectId && ![projectScope, inventoryScope, loanScope].some(scope => scope === null || scope.includes(projectId))) throw new HttpError(403, 'Você não tem acesso aos registros deste projeto.', 'forbidden');
  const project = scopeFilter(projectScope, 'r.project_id'), inventory = scopeFilter(inventoryScope, 'r.project_id'), loan = scopeFilter(loanScope, 'r.project_id');
  const params: (string | number | null)[] = [...loan.params, actor.userId, ...inventory.params, actor.userId, ...project.params, actor.userId];
  let conditions = `(((r.kind='loan' OR r.loan_id IS NOT NULL) AND (${loan.sql}) AND EXISTS(SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','manager','loans') AND (m.project_id IS NULL OR m.project_id=r.project_id)))
    OR (r.loan_id IS NULL AND r.kind IN ('maintenance','distribution','consumption','material') AND (${inventory.sql}) AND EXISTS(SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','manager','inventory') AND (m.project_id IS NULL OR m.project_id=r.project_id)))
    OR (r.loan_id IS NULL AND r.kind IN ('project','observation') AND (${project.sql}) AND EXISTS(SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','manager','viewer') AND (m.project_id IS NULL OR m.project_id=r.project_id))))`;
  conditions += ` AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=? AND (u.status!='active' OR COALESCE(u.activation_pending,0)!=0 OR u.anonymized_at IS NOT NULL))`;
  params.push(actor.userId);
  conditions += ' AND (r.item_id IS NULL OR i.project_id=r.project_id) AND (r.loan_id IS NULL OR l.project_id=r.project_id)';
  if (projectId) { conditions += ' AND r.project_id=?'; params.push(projectId); }
  if (from) { conditions += ' AND r.occurred_at>=?'; params.push(from); }
  if (to) { conditions += ' AND r.occurred_at<?'; params.push(to); }
  params.push(limit + 1);
  const rows = (await stmt(db, `SELECT r.id,r.project_id,r.kind,r.title,r.body,r.occurred_at,r.starts_at,r.ends_at,r.item_id,r.loan_id,r.created_at
    FROM records r LEFT JOIN items i ON i.id=r.item_id LEFT JOIN loans l ON l.id=r.loan_id WHERE ${conditions}
    ORDER BY r.occurred_at DESC,r.created_at DESC,r.id LIMIT ?`, params).all<Row>()).results ?? [];
  return { records: await projectRecords(db, rows.slice(0, limit)), limit, truncated: rows.length > limit };
}

export async function createRecord(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>): Promise<{ record: Row; id: string; duplicate?: boolean }> {
  actorRequired(actor);
  const projectId = idValue(input.projectId, 'o projeto')!, kind = kindValue(input.kind);
  const itemId = idValue(input.itemId, 'o material', true), loanId = idValue(input.loanId, 'o empréstimo', true);
  const target = { project_id: projectId, kind, item_id: itemId, loan_id: loanId };
  requireWrite(actor, target);
  await liveMembership(db, actor, projectId, writeRoles(target));
  if (!await stmt(db, 'SELECT id FROM projects WHERE id=?', [projectId]).first()) throw new HttpError(404, 'Projeto não encontrado.', 'project_not_found');
  const mutation = await prepareMutation(db, actor.userId, 'record.create', input);
  if (mutation.existingId) return { id: mutation.existingId, record: await projectedRecord(db, mutation.existingId), duplicate: true };
  const title = value(input.title, 'o título', 160), body = value(input.body, 'o texto do registro', 6000, true);
  const occurredAt = isoValue(input.occurredAt, 'A data do registro')!;
  const startsAt = isoValue(input.startsAt, 'A data inicial', true), endsAt = isoValue(input.endsAt, 'A data final', true);
  if ((startsAt === null) !== (endsAt === null) || (startsAt && endsAt && endsAt < startsAt)) throw new HttpError(400, 'Informe início e fim válidos para o intervalo da atividade.', 'invalid_interval');
  if (itemId && !await stmt(db, 'SELECT id FROM items WHERE id=? AND project_id=?', [itemId, projectId]).first()) throw new HttpError(400, 'O material deve pertencer ao projeto do registro.', 'project_mismatch');
  if (loanId) {
    const loan = await stmt(db, 'SELECT id,item_id FROM loans WHERE id=? AND project_id=?', [loanId, projectId]).first<{ id: string; item_id: string }>();
    if (!loan || (itemId && loan.item_id !== itemId)) throw new HttpError(400, 'O empréstimo e o material devem pertencer ao projeto e ao mesmo atendimento.', 'project_mismatch');
  }
  const id = crypto.randomUUID(), now = new Date().toISOString(), roles = writeRoles(target);
  const authorization = `EXISTS(SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN (${roles.map(() => '?').join(',')}) AND (m.project_id IS NULL OR m.project_id=?))
    AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=? AND (u.status!='active' OR COALESCE(u.activation_pending,0)!=0 OR u.anonymized_at IS NOT NULL))`;
  let createdId = id;
  try {
    await db.batch([
      mutation.claimStatement(id),
      stmt(db, `INSERT INTO records(id,project_id,kind,title,body,occurred_at,starts_at,ends_at,item_id,loan_id,created_by,created_at)
        VALUES(?,CASE WHEN ${authorization} THEN ? ELSE NULL END,?,?,?,?,?,?,?,?,?,?)`,
        [id, actor.userId, ...roles, projectId, actor.userId, projectId, kind, title, body, occurredAt, startsAt, endsAt, itemId, loanId, actor.userId, now]),
      stmt(db, 'INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,\'record.create\',?,?,?)',
        [crypto.randomUUID(), actor.userId, projectId, id, JSON.stringify({ kind, linkedToItem: !!itemId, linkedToLoan: !!loanId }), now]),
    ]);
  } catch (error) { createdId = await mutation.recover(error); }
  return { id: createdId, record: await projectedRecord(db, createdId), ...(createdId !== id ? { duplicate: true } : {}) };
}

export function requireRecordMutation(request: Request, type: 'json' | 'form'): void {
  if (request.headers.get('X-Proex-Action') !== '1' || request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, 'Atualize o portal antes de enviar este registro.', 'invalid_origin');
  const contentType = request.headers.get('Content-Type') ?? '';
  if (type === 'json' ? !/^application\/json(?:\s*;|$)/i.test(contentType) : !/^multipart\/form-data\s*;/i.test(contentType)) throw new HttpError(415, 'Use o formulário de registros.', 'invalid_content_type');
}

export async function readRecordForm(request: Request): Promise<RecordFileInput> {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_FORM_BYTES)) throw new HttpError(413, 'O anexo deve ter até 10 MB.', 'file_too_large');
  if (!request.body) throw new HttpError(400, 'Escolha um arquivo.', 'missing_file');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > MAX_FORM_BYTES) { await reader.cancel(); throw new HttpError(413, 'O anexo deve ter até 10 MB.', 'file_too_large'); }
      chunks.push(chunk);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let form: FormData;
  try { form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type')! } }).formData(); }
  catch { throw new HttpError(400, 'Não foi possível ler o anexo.', 'invalid_form'); }
  if ([...form.keys()].some(key => !['recordId', 'file', 'operationKey'].includes(key)) || ['recordId', 'file', 'operationKey'].some(key => form.getAll(key).length !== 1)) throw new HttpError(400, 'Envie um registro, uma chave de operação e um arquivo.', 'invalid_form');
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size || file.size > MAX_RECORD_FILE_BYTES) throw new HttpError(413, 'Escolha um arquivo de até 10 MB.', 'invalid_file_size');
  return { recordId: idValue(form.get('recordId'), 'o registro')!, operationKey: value(form.get('operationKey'), 'a chave de operação', 120), name: file.name, declaredMime: file.type.toLowerCase(), bytes: new Uint8Array(await file.arrayBuffer()) };
}

export function validatedRecordFile(input: Pick<RecordFileInput, 'bytes' | 'name' | 'declaredMime'>): { mime: string; name: string } {
  const bytes = input.bytes;
  if (!bytes.byteLength || bytes.byteLength > MAX_RECORD_FILE_BYTES) throw new HttpError(413, 'Escolha um arquivo de até 10 MB.', 'file_too_large');
  const signature = (...values: number[]) => values.every((value, i) => bytes[i] === value);
  let mime: string | null = null;
  if (bytes.length >= 8 && signature(0x25, 0x50, 0x44, 0x46, 0x2d)) mime = 'application/pdf';
  else if (bytes.length >= 4 && signature(0xff, 0xd8, 0xff) && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) mime = 'image/jpeg';
  else if (bytes.length >= 33 && signature(137, 80, 78, 71, 13, 10, 26, 10)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR' || !view.getUint32(16) || !view.getUint32(20)) throw new HttpError(415, 'A imagem PNG não é válida.', 'invalid_image');
    let position = 8, end = false;
    while (position + 12 <= bytes.length) {
      const length = view.getUint32(position), kind = String.fromCharCode(...bytes.subarray(position + 4, position + 8));
      if (length > bytes.length - position - 12 || kind === 'acTL') throw new HttpError(415, 'Use uma imagem estática válida.', 'invalid_image');
      position += length + 12;
      if (kind === 'IEND') { end = length === 0 && position === bytes.length; break; }
    }
    if (!end) throw new HttpError(415, 'A imagem PNG está incompleta.', 'invalid_image');
    mime = 'image/png';
  } else if (bytes.length >= 20 && signature(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(4, true) + 8 !== bytes.length) throw new HttpError(415, 'A imagem WebP está incompleta.', 'invalid_image');
    let position = 12, image = false;
    while (position + 8 <= bytes.length) {
      const kind = String.fromCharCode(...bytes.subarray(position, position + 4)), length = view.getUint32(position + 4, true);
      if (length > bytes.length - position - 8 || ['ANIM', 'ANMF'].includes(kind)) throw new HttpError(415, 'Use uma imagem estática válida.', 'invalid_image');
      if (kind === 'VP8 ' || kind === 'VP8L') image = true;
      position += 8 + length + (length % 2);
    }
    if (!image || position !== bytes.length) throw new HttpError(415, 'A imagem WebP não é válida.', 'invalid_image');
    mime = 'image/webp';
  }
  if (!mime || (input.declaredMime && input.declaredMime !== 'application/octet-stream' && input.declaredMime.toLowerCase() !== mime)) throw new HttpError(415, 'Use PDF, JPEG, PNG ou WebP com o conteúdo correspondente.', 'file_type_mismatch');
  const basename = value(input.name, 'o nome do arquivo', 500).replace(/^.*[\\/]/, '').normalize('NFKC');
  if (/\.(?:svg|svgz|exe|dll|com|bat|cmd|ps1|sh|msi|scr|jar|js|mjs|html?|xhtml)(?:\.|$)/i.test(basename)) throw new HttpError(415, 'O nome do arquivo contém uma extensão não permitida.', 'unsupported_file');
  const extension = /\.([a-z0-9]+)$/i.exec(basename)?.[1].toLowerCase();
  if (extension && !MIME_EXTENSIONS[mime].includes(extension)) throw new HttpError(415, 'A extensão não corresponde ao conteúdo do arquivo.', 'file_type_mismatch');
  const stem = (extension ? basename.slice(0, -(extension.length + 1)) : basename).replace(/[^\p{L}\p{N}._ ()-]/gu, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'anexo';
  return { mime, name: `${stem}.${extension ?? MIME_EXTENSIONS[mime][0]}` };
}
/** Internal compensation only: keys originate from this request, never from client input. */
export async function queuePrivateObjectDeletion(db:D1Database,userId:string,key:string,mime:string):Promise<void>{
 await db.batch([
  db.prepare('INSERT INTO private_object_deletions(id,user_id,object_key,mime,created_at) VALUES(?,?,?,?,?)')
   .bind(crypto.randomUUID(),userId,key,mime,new Date().toISOString()),
  db.prepare(`UPDATE privacy_requests SET status='cleanup_pending',completed_at=NULL WHERE user_id=? AND status='completed'
   AND EXISTS(SELECT 1 FROM portal_users WHERE user_id=? AND anonymized_at IS NOT NULL)`).bind(userId,userId),
 ]);
}
async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function attachmentById(db: D1Database, id: string): Promise<Attachment> {
  const row = await stmt(db, `SELECT a.* FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id WHERE a.id=? AND a.deleted_at IS NULL`, [id]).first<Attachment>();
  if (!row) throw new HttpError(404, 'Anexo não encontrado.', 'attachment_not_found');
  return row;
}
export async function uploadRecordAttachment(db: D1Database, storage: R2Bucket, actor: PortalActor | null, input: RecordFileInput): Promise<{ attachment: ReturnType<typeof attachmentProjection>; recordId: string; duplicate?: boolean }> {
  actorRequired(actor);
  const record = await recordById(db, idValue(input.recordId, 'o registro')!);
  requireWrite(actor, record);
  await liveMembership(db, actor, record.project_id, writeRoles(record));
  const { mime, name } = validatedRecordFile(input), contentHash = await sha256(input.bytes);
  const mutation = await prepareMutation(db, actor.userId, `record.attachment:${record.id}`, { operationKey: input.operationKey, recordId: record.id, mime, name, size: input.bytes.byteLength, contentHash });
  if (mutation.existingId) return { attachment: attachmentProjection(await attachmentById(db, mutation.existingId)), recordId: record.id, duplicate: true };
  const id = crypto.randomUUID(), objectKey = `record-attachments/${crypto.randomUUID()}`, now = new Date().toISOString(), roles = writeRoles(record);
  let committed = false, safeToDelete = true, databaseAttempted = false, resultId = id;
  try {
    await storage.put(objectKey, input.bytes, { httpMetadata: { contentType: mime } });
    databaseAttempted = true;
    await db.batch([
      mutation.claimStatement(id),
      stmt(db, `INSERT INTO record_attachments(id,record_id,project_id,object_key,name,mime,size,operation_key,created_by,created_at)
        VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN (${roles.map(() => '?').join(',')}) AND (m.project_id IS NULL OR m.project_id=?)) AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=? AND (u.status!='active' OR COALESCE(u.activation_pending,0)!=0 OR u.anonymized_at IS NOT NULL)) THEN ? ELSE NULL END,?,?,?,?,?,?,?)`,
        [id, record.id, actor.userId, ...roles, record.project_id, actor.userId, record.project_id, objectKey, name, mime, input.bytes.byteLength, mutation.scope, actor.userId, now]),
      stmt(db, "INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,'record.attachment',?,?,?)", [crypto.randomUUID(), actor.userId, record.project_id, id, JSON.stringify({ recordId: record.id, mime, size: input.bytes.byteLength }), now]),
    ]);
    committed = true;
  } catch (error) {
    if (databaseAttempted) {
      try {
        resultId = await mutation.recover(error);
        const stored = await attachmentById(db, resultId);
        committed = stored.object_key === objectKey;
        return { attachment: attachmentProjection(stored), recordId: record.id, duplicate: true };
      } catch (recoveryError) {
        // A lost DB response may follow a successful commit. Never delete a possibly referenced object.
        try { committed = !!await stmt(db, 'SELECT id FROM record_attachments WHERE object_key=?', [objectKey]).first(); }
        catch { safeToDelete = false; }
        if (!committed) throw recoveryError;
      }
    } else throw error;
  } finally {
    if (!committed && safeToDelete) {
      try { await storage.delete(objectKey); }
      catch { try { await queuePrivateObjectDeletion(db,actor.userId,objectKey,mime); } catch { console.error('Private record cleanup could not be queued.'); } }
    }
  }
  return { attachment: attachmentProjection(await attachmentById(db, resultId)), recordId: record.id };
}

export async function recordAttachment(db: D1Database, actor: PortalActor | null, attachmentId: unknown): Promise<Attachment> {
  actorRequired(actor);
  const attachment = await attachmentById(db, idValue(attachmentId, 'o anexo')!);
  const record = await recordById(db, attachment.record_id);
  await requireRead(db, actor, record);
  if (!Object.hasOwn(MIME_EXTENSIONS, attachment.mime)) throw new HttpError(415, 'Este tipo de anexo não está disponível.', 'unsupported_file');
  return attachment;
}
