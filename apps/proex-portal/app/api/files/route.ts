import { getChatGPTUser } from '../../chatgpt-auth';
import { getActor, requireCapability } from '../../../lib/access';
import { iso, one, text, uid } from '../../../lib/database';
import { HttpError, publicError } from '../../../lib/errors';
import { bucket, database, ownerEmail } from '../../../lib/platform';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;
const FORM_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const EXTENSIONS: Record<string, string[]> = {
  'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'], 'image/webp': ['webp'],
};

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
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
    throw new HttpError(413, 'O anexo deve ter no máximo 10 MB.', 'file_too_large');
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
        throw new HttpError(413, 'O anexo deve ter no máximo 10 MB.', 'file_too_large');
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

function detectedMime(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (bytes.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (bytes.length >= 4 && starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (bytes.length >= 12 && starts(0x52, 0x49, 0x46, 0x46)
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  if (bytes.length >= 8 && starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  return null;
}

function safeFilename(rawName: string, mime: string): string {
  const basename = rawName.replace(/^.*[\\/]/, '').normalize('NFKC');
  // A renamed executable/SVG is not an acceptable document, even with another suffix.
  if (/\.(?:svg|svgz|exe|dll|com|bat|cmd|ps1|sh|msi|scr|jar|js|mjs|html?|xhtml)(?:\.|$)/i.test(basename)) {
    throw new HttpError(415, 'Use apenas PDF, JPEG, PNG ou WebP.', 'unsupported_file');
  }
  const extension = /\.([a-z0-9]+)$/i.exec(basename)?.[1].toLowerCase();
  if (extension && !EXTENSIONS[mime].includes(extension)) {
    throw new HttpError(415, 'A extensão não corresponde ao conteúdo do arquivo.', 'file_type_mismatch');
  }
  const stem = (extension ? basename.slice(0, -(extension.length + 1)) : basename)
    .replace(/[^\p{L}\p{N}._ ()-]/gu, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'anexo';
  return `${stem}.${extension ?? EXTENSIONS[mime][0]}`;
}

export async function POST(request: Request): Promise<Response> {
  let storedKey: string | null = null;
  let storage: R2Bucket | null = null;
  try {
    requireAction(request);
    const db = database();
    const user = await getChatGPTUser();
    let actor = await getActor(db, user, ownerEmail());
    requireCapability(actor, 'loans.manage');
    const form = await boundedFormData(request);
    const loanId = text(form.get('loanId'), 200);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(loanId)) {
      throw new HttpError(400, 'Selecione um empréstimo válido.', 'invalid_loan');
    }
    const loan = await one(db, 'SELECT id,project_id FROM loans WHERE id=?', [loanId]);
    if (!loan) throw new HttpError(404, 'Empréstimo não encontrado.', 'loan_not_found');
    requireCapability(actor, 'loans.manage', loan.project_id);
    const entry = form.get('file');
    if (!entry || typeof entry === 'string' || typeof entry.arrayBuffer !== 'function'
      || form.getAll('file').length !== 1) {
      throw new HttpError(400, 'Escolha um único arquivo.', 'missing_file');
    }
    if (!entry.size || entry.size > MAX_FILE_BYTES) {
      throw new HttpError(entry.size ? 413 : 400, 'Escolha um arquivo de até 10 MB.', 'invalid_file_size');
    }
    const declaredMime = entry.type.toLowerCase();
    if (declaredMime && declaredMime !== 'application/octet-stream' && !FORM_TYPES.has(declaredMime)) {
      throw new HttpError(415, 'Use apenas PDF, JPEG, PNG ou WebP.', 'unsupported_file');
    }
    const data = await entry.arrayBuffer();
    const mime = detectedMime(new Uint8Array(data));
    if (!mime || (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== mime)) {
      throw new HttpError(415, 'O conteúdo não corresponde a um PDF ou imagem permitido.', 'file_type_mismatch');
    }
    const name = safeFilename(entry.name, mime);
    const id = uid();
    const now = iso();
    storage = bucket();
    storedKey = `documents/${uid()}`;
    await storage.put(storedKey, data, { httpMetadata: { contentType: mime } });

    // Re-read access after the upload; never rely on client role/project claims.
    actor = await getActor(db, user, ownerEmail());
    requireCapability(actor, 'loans.manage', loan.project_id);
    const actorId = actor!.userId;
    const result = await db.batch([
      db.prepare(`INSERT INTO documents
        (id,loan_id,project_id,object_key,name,mime,size,created_by,created_at)
        SELECT ?,l.id,l.project_id,?,?,?,?,?,? FROM loans l
        WHERE l.id=? AND l.project_id=? AND EXISTS
          (SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL
            AND m.role IN ('owner','manager','loans')
            AND (m.project_id IS NULL OR m.project_id=l.project_id))`)
        .bind(id, storedKey, name, mime, data.byteLength, actorId, now,
          loanId, loan.project_id, actorId),
      db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
        SELECT ?,?,?,'document.upload',?,?,? WHERE EXISTS (SELECT 1 FROM documents WHERE id=?)`)
        .bind(uid(), actorId, loan.project_id, id, JSON.stringify({ mime, size: data.byteLength }), now, id),
    ]);
    if (result[0].meta.changes !== 1 || result[1].meta.changes !== 1) {
      throw new HttpError(403, 'Seu acesso ou o empréstimo mudou. Atualize o portal.', 'access_changed');
    }
    storedKey = null;
    return privateResponse(Response.json({ id, loanId, name, mime, size: data.byteLength, createdAt: now }, { status: 201 }));
  } catch (error) {
    if (storedKey && storage) {
      try { await storage.delete(storedKey); } catch {
        // Do not log keys, filenames, provider errors, or document contents.
        console.error('Private attachment compensation failed.');
      }
    }
    return privateResponse(publicError(error));
  }
}
