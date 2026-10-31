import {getPortalUser} from '@/lib/session';
import { memberProjectScopeSql, getActor, requireCapability } from '../../../lib/access';
import { iso, one, text, uid } from '../../../lib/database';
import { HttpError, publicError } from '../../../lib/errors';
import { bucket, database } from '../../../lib/platform';
import { prepareMutation } from '../../../lib/mutations';
import { validatedRecordFile,queuePrivateObjectDeletion } from '../../../lib/records';

import { MAX_UPLOAD_FILE_BYTES as MAX_FILE_BYTES, MAX_UPLOAD_BODY_BYTES as MAX_BODY_BYTES, UPLOAD_LIMIT_MESSAGE } from '../../../lib/upload-limits';

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

function requireAction(request: Request): void {
  if (request.headers.get('X-Proex-Action') !== '1'
    || request.headers.get('Origin') !== new URL(request.url).origin) {
    throw new HttpError(403, 'Atualize o portal antes de enviar o anexo.', 'invalid_origin');
  }
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get('Content-Type') ?? '')) {
    throw new HttpError(415, 'Envie o arquivo pelo formulário de anexos.', 'invalid_content_type');
  }
}

/** Bound even chunked bodies before the multipart parser allocates the file. */
async function boundedFormData(request: Request): Promise<FormData> {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new HttpError(413, UPLOAD_LIMIT_MESSAGE, 'file_too_large');
  }
  if (!request.body) throw new HttpError(400, 'Escolha um arquivo.', 'missing_file');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, UPLOAD_LIMIT_MESSAGE, 'file_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return await new Response(body, { headers: {
      'Content-Type': request.headers.get('Content-Type')!,
    } }).formData();
  } catch {
    throw new HttpError(400, 'Não foi possível ler o formulário do anexo.', 'invalid_form');
  }
}

type DocumentRow = {
  id: string; loan_id: string; project_id: string; object_key: string;
  name: string; mime: string; size: number; created_at: string;
};
function projection(row: DocumentRow) {
  return { id: row.id, loanId: row.loan_id, name: row.name, mime: row.mime, size: row.size, createdAt: row.created_at };
}
async function documentById(db: D1Database, id: string): Promise<DocumentRow> {
  const row = await db.prepare(`SELECT d.id,d.loan_id,d.project_id,d.object_key,d.name,d.mime,d.size,d.created_at
    FROM documents d JOIN loans l ON l.id=d.loan_id AND l.project_id=d.project_id WHERE d.id=?`).bind(id).first<DocumentRow>();
  if (!row) throw new HttpError(404, 'Anexo não encontrado.', 'document_not_found');
  return row;
}

export async function POST(request: Request): Promise<Response> {
  let storedKey: string | null = null;
  let storage: R2Bucket | null = null;
  let committed = false;
  let safeToDelete = true;
  let uploadDb:D1Database|null=null,uploadOwnerId:string|null=null,uploadMime:string|null=null;
  try {
    requireAction(request);
    const db = database();
    uploadDb=db;
    let actor = await getActor(db, await getPortalUser());
    requireCapability(actor, 'loans.manage');
    const initialActorId = actor!.userId;
    const form = await boundedFormData(request);
    if ([...form.keys()].some(key => !['loanId', 'file', 'operationKey'].includes(key))
      || form.getAll('loanId').length !== 1 || form.getAll('file').length !== 1 || form.getAll('operationKey').length > 1) {
      throw new HttpError(400, 'Envie um empréstimo e um único arquivo.', 'invalid_form');
    }
    const loanId = text(form.get('loanId'), 200);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(loanId)) throw new HttpError(400, 'Selecione um empréstimo válido.', 'invalid_loan');
    const loan = await one(db, 'SELECT id,project_id FROM loans WHERE id=?', [loanId]);
    if (!loan) throw new HttpError(404, 'Empréstimo não encontrado.', 'loan_not_found');
    requireCapability(actor, 'loans.manage', loan.project_id);
    const entry = form.get('file');
    if (!entry || typeof entry === 'string' || typeof entry.arrayBuffer !== 'function') throw new HttpError(400, 'Escolha um arquivo.', 'missing_file');
    if (!entry.size || entry.size > MAX_FILE_BYTES) throw new HttpError(entry.size ? 413 : 400, UPLOAD_LIMIT_MESSAGE, 'invalid_file_size');
    const headerKey = request.headers.get('X-Operation-Key'), formKey = form.get('operationKey');
    if (headerKey && formKey !== null && formKey !== headerKey) throw new HttpError(400, 'As chaves da operação não correspondem. Atualize o formulário.', 'invalid_operation_key');
    const operationKey = headerKey ?? formKey;
    const data = new Uint8Array(await entry.arrayBuffer());
    const { name, mime } = validatedRecordFile({ bytes: data, name: entry.name, declaredMime: entry.type.toLowerCase() });
    const contentHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    actor = await getActor(db, await getPortalUser());
    requireCapability(actor, 'loans.manage', loan.project_id);
    if (actor!.userId !== initialActorId) throw new HttpError(403, 'Sua conta mudou durante o envio. Atualize o portal.', 'access_changed');
    const actorId = actor!.userId;
    uploadOwnerId=actorId;uploadMime=mime;
    const mutation = await prepareMutation(db, actorId, `document.upload:${loan.id}`, { loanId, operationKey, name, mime, size: data.byteLength, contentHash });
    if (mutation.existingId) return privateResponse(Response.json({ ...projection(await documentById(db, mutation.existingId)), duplicate: true }, { status: 201 }));
    const id = uid(), now = iso();
    storage = bucket();
    storedKey = `documents/${uid()}`;
    await storage.put(storedKey, data, { httpMetadata: { contentType: mime } });
    let stored: DocumentRow | null = null;
    let databaseAttempted = false;
    try {
      actor = await getActor(db, await getPortalUser());
      requireCapability(actor, 'loans.manage', loan.project_id);
      if (actor!.userId !== actorId) throw new HttpError(403, 'Sua conta mudou durante o envio. Atualize o portal.', 'access_changed');
      databaseAttempted = true;
      await db.batch([
        mutation.claimStatement(id),
        db.prepare(`INSERT INTO documents
          (id,loan_id,project_id,object_key,name,mime,size,created_by,created_at,operation_key,content_hash)
          VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM loans l WHERE l.id=? AND l.project_id=? AND EXISTS
            (SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL
              AND m.role IN ('owner','manager','loans') AND ${memberProjectScopeSql("m","l.project_id")}))
            AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=? AND (u.status!='active' OR COALESCE(u.activation_pending,0)!=0 OR u.anonymized_at IS NOT NULL)) THEN ? ELSE NULL END,?,?,?,?,?,?,?,?)`)
          .bind(id, loanId, loanId, loan.project_id, actorId, actorId, loan.project_id,
            storedKey, name, mime, data.byteLength, actorId, now, mutation.scope, contentHash),
        db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
          VALUES(?,?,?,'document.upload',?,?,?)`)
          .bind(uid(), actorId, loan.project_id, id, JSON.stringify({ mime, size: data.byteLength }), now),
      ]);
      committed = true;
      stored = { id, loan_id: loanId, project_id: loan.project_id, object_key: storedKey, name, mime, size: data.byteLength, created_at: now };
    } catch (error) {
      if (!databaseAttempted) throw error;
      try {
        const replayId = await mutation.recover(error);
        stored = await documentById(db, replayId);
        committed = stored.object_key === storedKey;
      } catch (recoveryError) {
        // A failed response can follow a committed transaction. Keep any possibly referenced object.
        try {
          stored = await db.prepare('SELECT id,loan_id,project_id,object_key,name,mime,size,created_at FROM documents WHERE object_key=?').bind(storedKey).first<DocumentRow>();
          committed = !!stored;
        } catch { safeToDelete = false; }
        if (!committed) throw recoveryError;
      }
    }
    if (!stored) throw new HttpError(500, 'Não foi possível recuperar o anexo enviado.', 'upload_unconfirmed');
    return privateResponse(Response.json({ ...projection(stored), ...(stored.id !== id ? { duplicate: true } : {}) }, { status: 201 }));
  } catch (error) {
    return privateResponse(publicError(error));
  } finally {
    if (storedKey && storage && !committed && safeToDelete) {
      try { await storage.delete(storedKey); }
      catch { try { if(uploadDb&&uploadOwnerId&&uploadMime)await queuePrivateObjectDeletion(uploadDb,uploadOwnerId,storedKey,uploadMime); } catch { console.error('Private document cleanup could not be queued.'); } }
    }
  }
}
