import { getPortalUser } from '@/lib/session';
import { database } from '@/lib/platform';
import { getActor } from '@/lib/access';
import { HttpError, publicError } from '@/lib/errors';
import { boundedJson } from '@/lib/http';
import { requireSyncOwner } from '@/lib/sync/contracts';
import { rateLimit } from '@/lib/rate-limit';
import { completeBackupBinding } from '@/lib/backup';
export const dynamic = 'force-dynamic';
const secureHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function protect(response: Response) { for (const [name, value] of Object.entries(secureHeaders)) response.headers.set(name, value); return response; }
function backupError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const known: Record<string, [number, string]> = {
    backup_password: [400, 'Use uma frase de proteção com 16 a 256 caracteres.'],
    backup_limit: [413, 'O backup excede os limites desta ferramenta. Nenhum backup parcial foi gerado.'],
    backup_forbidden: [403, 'Seu acesso mudou durante o backup. Nenhum arquivo foi enviado.'],
    backup_busy: [429, 'Outro backup está em preparação. Aguarde a conclusão.'],
    backup_runtime: [503, 'O runtime ainda não oferece os recursos necessários para o backup completo.'],
    backup_source: [409, 'Não foi possível obter uma cópia consistente. Tente novamente.'],
    backup_sqlite: [409, 'O banco não passou na verificação de integridade. O backup foi interrompido.'],
    backup_objects: [409, 'Há divergências entre banco e arquivos. O backup foi interrompido.'],
  };
  if (code && known[code]) return protect(publicError(new HttpError(known[code][0], known[code][1], code)));
  return protect(publicError(error));
}
export async function GET() {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser()); await requireSyncOwner(db, actor);
    const binding = completeBackupBinding();
    return Response.json({ supported: !!binding, formatVersion: 1, encryption: 'AES-256-GCM', kdf: 'scrypt', limits: binding?.limits ?? null }, { headers: secureHeaders });
  } catch (error) { return backupError(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Proex-Action') !== '1' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(403, 'Atualize o portal e tente novamente.', 'invalid_origin');
    const db = database(), actor = await getActor(db, await getPortalUser()); await requireSyncOwner(db, actor);
    const binding = completeBackupBinding(); if (!binding) throw new HttpError(501, 'O backup completo está disponível na hospedagem Node. A exportação portátil continua separada.', 'backup_unsupported');
    const input = await boundedJson(request, 4096);
    if (Object.keys(input).length !== 1 || typeof input.password !== 'string' || [...input.password].length < 16 || [...input.password].length > 256 || new TextEncoder().encode(input.password).byteLength > 1024 || /[\r\n\0]/.test(input.password)) throw new HttpError(400, 'Use uma frase de proteção com 16 a 256 caracteres.', 'backup_password');
    await rateLimit(db, 'backup:global', 3, 10 * 60 * 1000);
    let encrypted: Uint8Array;
    try { encrypted = await binding.createEncrypted(actor!.userId, input.password); }
    finally { input.password = ''; } // no persistence, echo, URL, or audit payload
    await requireSyncOwner(db, await getActor(db, await getPortalUser()));
    // A bounded, already authenticated encrypted archive is sent in chunks. The
    // Vercel proxy pipes the body; no plaintext or provider URL is ever streamed.
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { if (offset >= encrypted.byteLength) { controller.close(); return; } const end = Math.min(offset + 64 * 1024, encrypted.byteLength); controller.enqueue(encrypted.subarray(offset, end)); offset = end; } });
    return new Response(body, { headers: { ...secureHeaders, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="proex-completo-${new Date().toISOString().slice(0, 10)}.proexbackup"` } });
  } catch (error) { return backupError(error); }
}
