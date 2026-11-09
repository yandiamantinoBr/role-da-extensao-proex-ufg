import { getActor, projectAuthoritySql, requireCapability, requireLiveAccount, writeAudit, type PortalActor } from '../access';
import { all, iso, one, uid, type Row } from '../database';
import { HttpError } from '../errors';
import { recordAttachment } from '../records';
import { MAX_UPLOAD_FILE_BYTES } from '../upload-limits';
import { accessTokenFor, connectionView, driveConfigured, type DriveDeps } from './connection';
import { sha256Hex, signDrivePlan, verifyDrivePlan } from './crypto';
import { inspectFolder, usableFolder, usableFolders, type FolderView } from './folders';
import { uploadFile } from './google';

/*
 * "Salvar no Drive": a mesma função serve à tela e ao Rolê.
 *   options → pastas que a pessoa pode usar, sugestão pelo registro e a pergunta quando houver dúvida;
 *   prepare → prévia assinada (pasta, nome do arquivo, origem), válida por 10 minutos e presa à pessoa;
 *   apply   → reconfere tudo, envia com a conta Google da própria pessoa e grava no histórico.
 * Não existe ferramenta de apagar, mover ou compartilhar no Drive.
 */
export const CONNECT_HREF = '/?module=profile#google-drive';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MIME_EXTENSION: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const SIGNATURES: Record<string, number[]> = { 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
export type DriveSourceKind = 'record_attachment' | 'loan_document' | 'upload';
export type DriveSource = { kind: 'record_attachment' | 'loan_document'; id: string } | { kind: 'upload'; name: string; mime: string; bytes: number; sha256: string; projectId?: string | null };
export type SaveDeps = DriveDeps & { storage?: R2Bucket };

type ResolvedSource = { kind: DriveSourceKind; id: string | null; projectId: string | null; organizationId: string | null; name: string; mime: string; size: number; objectKey: string | null; sha256: string | null; label: string };

function requireActor(actor: PortalActor | null): PortalActor {
  if (!actor) throw new HttpError(401, 'Entre no portal para enviar ao Drive.', 'unauthenticated');
  return actor;
}
function parseSource(value: unknown): DriveSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Escolha o arquivo que vai para o Drive.', 'drive_source');
  const source = value as Record<string, unknown>;
  if ((source.kind === 'record_attachment' || source.kind === 'loan_document') && typeof source.id === 'string' && ID.test(source.id)) return { kind: source.kind, id: source.id };
  if (source.kind === 'upload') {
    const mime = String(source.mime ?? ''), bytes = Number(source.bytes), sha256 = String(source.sha256 ?? '');
    if (!Object.hasOwn(MIME_EXTENSION, mime)) throw new HttpError(415, 'O Drive do portal aceita PDF, JPG, PNG ou WebP.', 'unsupported_file');
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_UPLOAD_FILE_BYTES) throw new HttpError(413, 'O arquivo deve ter no máximo 4 MB.', 'file_too_large');
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, 'Envie o arquivo de novo.', 'drive_source');
    const projectId = source.projectId === undefined || source.projectId === null || source.projectId === '' ? null : String(source.projectId);
    if (projectId !== null && !ID.test(projectId)) throw new HttpError(400, 'Escolha um projeto válido.', 'invalid_project');
    return { kind: 'upload', name: typeof source.name === 'string' ? source.name : 'arquivo', mime, bytes, sha256, projectId };
  }
  throw new HttpError(400, 'Escolha o arquivo que vai para o Drive.', 'drive_source');
}

/** Lê a origem com a permissão de leitura dela (o mesmo filtro da tela que mostra o arquivo). */
async function resolveSource(db: D1Database, actor: PortalActor, source: DriveSource): Promise<ResolvedSource> {
  if (source.kind === 'record_attachment') {
    // Sem leitura = "não encontrado", igual a um id inexistente: não revela se o anexo existe.
    const attachment = await recordAttachment(db, actor, source.id).catch(error => { throw error instanceof HttpError && error.status === 403 ? new HttpError(404, 'Anexo não encontrado.', 'attachment_not_found') : error; });
    const row = await one(db, `SELECT p.organization_id,p.name project_name,r.kind,i.name item_name FROM records r JOIN projects p ON p.id=r.project_id LEFT JOIN items i ON i.id=r.item_id WHERE r.id=?`, [attachment.record_id]);
    const label = row?.item_name ? `Foto ou anexo de "${row.item_name}"` : `Anexo de registro (${row?.project_name ?? 'projeto'})`;
    return { kind: 'record_attachment', id: attachment.id, projectId: attachment.project_id, organizationId: row?.organization_id ?? null, name: attachment.name, mime: attachment.mime, size: Number(attachment.size), objectKey: attachment.object_key, sha256: null, label };
  }
  if (source.kind === 'loan_document') {
    const notFound = () => new HttpError(404, 'Anexo não encontrado.', 'document_not_found');
    try { requireCapability(actor, 'loans.read'); } catch { throw notFound(); }
    const document = await one(db, `SELECT d.*,p.organization_id,p.name project_name FROM documents d JOIN loans l ON l.id=d.loan_id AND l.project_id=d.project_id JOIN projects p ON p.id=d.project_id WHERE d.id=?`, [source.id]);
    if (!document) throw notFound();
    try { requireCapability(actor, 'loans.read', document.project_id); } catch { throw notFound(); }
    if (!Object.hasOwn(MIME_EXTENSION, document.mime)) throw new HttpError(415, 'Este tipo de anexo não está disponível.', 'unsupported_file');
    return { kind: 'loan_document', id: document.id, projectId: document.project_id, organizationId: document.organization_id, name: document.name, mime: document.mime, size: Number(document.size), objectKey: document.object_key, sha256: document.content_hash ?? null, label: `Termo ou anexo de empréstimo (${document.project_name})` };
  }
  if (source.kind !== 'upload') throw new HttpError(400, 'Escolha o arquivo que vai para o Drive.', 'drive_source');
  let organizationId: string | null = null;
  if (source.projectId) {
    // Só um projeto de que a pessoa participa; senão, o mesmo erro de projeto inexistente.
    const authority = projectAuthoritySql(actor, [], '?');
    const project = await one(db, `SELECT organization_id FROM projects WHERE id=? AND ${authority.sql}`, [source.projectId, ...authority.values, source.projectId]);
    if (!project) throw new HttpError(404, 'Projeto não encontrado.', 'invalid_project');
    organizationId = project.organization_id;
  }
  return { kind: 'upload', id: null, projectId: source.projectId ?? null, organizationId, name: source.name, mime: source.mime, size: source.bytes, objectKey: null, sha256: source.sha256, label: 'Arquivo enviado agora' };
}

/** Nome seguro para o Drive, com a extensão certa para o conteúdo. */
export function safeFileName(value: unknown, mime: string, fallback: string): string {
  const extension = MIME_EXTENSION[mime] ?? 'bin';
  let name = (typeof value === 'string' ? value : fallback).normalize('NFC').replace(/[\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/\.(pdf|jpe?g|png|webp)$/i, '').slice(0, 150).trim() || 'arquivo';
  return `${name}.${extension}`;
}
function defaultFileName(source: ResolvedSource, now: number): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  return safeFileName(`${day} ${source.name}`, source.mime, 'arquivo');
}

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['para', 'pasta', 'drive', 'salvar', 'salva', 'coloca', 'colocar', 'enviar', 'manda', 'foto', 'fotos', 'arquivo', 'essa', 'esse', 'esta', 'este', 'dentro', 'google']);
export type Suggestion = { folderId: string | null; reason: string; ask: string | null };
/** Sugestão pelo registro: projeto igual pesa mais, depois unidade, depois palavras do pedido. Empate = pergunta. */
export async function suggestFolder(db: D1Database, folders: FolderView[], source: { projectId: string | null }, hint: string): Promise<Suggestion> {
  if (!folders.length) return { folderId: null, reason: 'Nenhuma pasta do Drive está registrada para você.', ask: 'Ainda não há pasta do Drive registrada para você. Peça à administração para cadastrar uma em Configurações › Dados e cópias.' };
  const project = source.projectId ? await one(db, 'SELECT unit_id FROM projects WHERE id=?', [source.projectId]) : null;
  const words = normalize(hint).split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !STOP.has(word));
  const scored = folders.map(folder => {
    let score = 0; const why: string[] = [];
    if (source.projectId && folder.projectId === source.projectId) { score += 4; why.push('é do mesmo projeto'); }
    else if (source.projectId && folder.projectId) score -= 3;
    if (project?.unit_id && folder.unitId === project.unit_id) { score += 2; why.push('é da mesma unidade'); }
    const text = normalize(`${folder.name} ${folder.purpose} ${folder.projectName ?? ''} ${folder.unitName ?? ''}`);
    const hits = words.filter(word => text.includes(word));
    if (hits.length) { score += hits.length * 2; why.push(`combina com "${hits.slice(0, 3).join('", "')}"`); }
    return { folder, score, why };
  }).sort((a, b) => b.score - a.score || a.folder.name.localeCompare(b.folder.name, 'pt-BR'));
  const [best, second] = scored;
  if (folders.length === 1 && best.score >= 0) return { folderId: best.folder.id, reason: best.why.length ? `É a única pasta disponível e ${best.why.join(' e ')}.` : 'É a única pasta registrada para você.', ask: null };
  if (best.score > 0 && (!second || best.score > second.score)) return { folderId: best.folder.id, reason: `Sugerida porque ${best.why.join(' e ')}.`, ask: null };
  const options = scored.slice(0, 4).map(item => `"${item.folder.name}" (${item.folder.purpose})`).join('; ');
  return { folderId: null, reason: 'Mais de uma pasta serve, ou nenhuma combina com o pedido.', ask: `Em qual pasta devo salvar? Opções: ${options}.` };
}

export async function driveSaveOptions(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, deps: SaveDeps) {
  const current = requireActor(actor);
  const connection = await connectionView(db, current, deps);
  const source = await resolveSource(db, current, parseSource(input.source));
  const folders = (await usableFolders(db, current)).filter(folder => !source.organizationId || folder.organizationId === source.organizationId);
  const hint = typeof input.hint === 'string' ? input.hint.slice(0, 500) : '';
  return {
    connection: { status: connection.status, account: connection.account, href: CONNECT_HREF },
    folders: folders.map(folder => ({ id: folder.id, driveFolderId: folder.driveFolderId, name: folder.name, purpose: folder.purpose, unit: folder.unitName, project: folder.projectName, projectId: folder.projectId, sharedDrive: folder.sharedDrive, confirmedByMe: folder.confirmedByMe })),
    suggestion: await suggestFolder(db, folders, source, hint),
    fileName: defaultFileName(source, deps.now ?? Date.now()), source: { label: source.label, mime: source.mime, bytes: source.size },
  };
}

/**
 * Origem e destino na mesma fronteira: arquivo de um projeto não vai para a pasta de outro projeto, e termo de
 * empréstimo (dados pessoais) só vai para a pasta do próprio projeto ou para uma pasta "Só gestão".
 */
export function requireCompatibleDestination(source: { kind: DriveSourceKind; projectId: string | null }, folder: { projectId: string | null; audience: string }) {
  if (source.projectId && folder.projectId && folder.projectId !== source.projectId) throw new HttpError(400, 'Esta pasta é de outro projeto. Escolha uma pasta do projeto do arquivo ou da organização.', 'drive_folder_other_project');
  if (source.kind === 'loan_document' && folder.projectId !== source.projectId && folder.audience !== 'managers') throw new HttpError(400, 'Termos de empréstimo têm dados pessoais: envie só para a pasta do próprio projeto ou para uma pasta "Só gestão".', 'drive_folder_sensitive');
}
type Plan = { id: string; actorId: string; expiresAt: number; via: 'screen' | 'role'; folderId: string; driveFolderId: string; source: DriveSource; size: number; mime: string; fileName: string; sha256: string | null; projectId: string | null; organizationId: string };
const PLAN_TTL_MS = 10 * 60000;
function via(value: unknown): 'screen' | 'role' { return value === 'role' ? 'role' : 'screen'; }

export async function driveSavePrepare(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, deps: SaveDeps) {
  const current = requireActor(actor);
  if (!driveConfigured(deps)) throw new HttpError(503, 'A conexão com o Google Drive ainda não foi configurada no servidor.', 'drive_unconfigured');
  await requireLiveAccount(db, current.userId);
  const sourceInput = parseSource(input.source), source = await resolveSource(db, current, sourceInput);
  const folder = await usableFolder(db, current, input.folderId);
  if (source.organizationId && folder.organizationId !== source.organizationId) throw new HttpError(400, 'Esta pasta é de outra organização. Escolha uma pasta da organização do arquivo.', 'drive_folder_unavailable');
  requireCompatibleDestination(source, folder);
  const connection = await connectionView(db, current, deps);
  if (connection.status !== 'connected') throw Object.assign(new HttpError(409, connection.status === 'revoked' ? 'A autorização do Google desta conta foi revogada. Conecte de novo em Conta › Google Drive.' : 'Conecte sua conta Google em Conta › Google Drive antes de enviar.', connection.status === 'revoked' ? 'drive_reconnect_required' : 'drive_connect_required'), { href: CONNECT_HREF });
  if (!folder.confirmedByMe) throw Object.assign(new HttpError(409, `Antes do primeiro envio, confirme a pasta "${folder.name}" no seletor do Google (uma vez por pessoa).`, 'drive_folder_confirm_required'), { folderId: folder.id });
  const now = deps.now ?? Date.now(), fileName = safeFileName(input.fileName ?? defaultFileName(source, now), source.mime, source.name);
  const plan: Plan = { id: `gdu_${uid()}`, actorId: current.userId, expiresAt: now + PLAN_TTL_MS, via: via(input.via), folderId: folder.id, driveFolderId: folder.driveFolderId, source: sourceInput, size: source.size, mime: source.mime, fileName, sha256: source.sha256, projectId: source.projectId, organizationId: folder.organizationId };
  return {
    planToken: await signDrivePlan(deps.keys.current!, plan), expiresAt: new Date(plan.expiresAt).toISOString(),
    preview: { fileName, folderName: folder.name, folderPurpose: folder.purpose, organizationName: folder.organizationName, sharedDrive: folder.sharedDrive, sourceLabel: source.label, bytes: source.size, mime: source.mime, account: connection.account },
  };
}

function matchesSignature(bytes: Uint8Array, mime: string) { return (SIGNATURES[mime] ?? []).every((byte, index) => bytes[index] === byte); }
function errorCode(error: unknown) { return error instanceof HttpError ? error.code.slice(0, 60) : 'unexpected'; }

export async function driveSaveApply(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, deps: SaveDeps, file?: Uint8Array) {
  const signed = requireActor(actor);
  if (!driveConfigured(deps)) throw new HttpError(503, 'A conexão com o Google Drive ainda não foi configurada no servidor.', 'drive_unconfigured');
  const plan = await verifyDrivePlan<Plan>(deps.keys.current!, input.planToken, signed.userId, deps.now);
  // Relê permissões a cada envio: revogação entre a prévia e a confirmação interrompe aqui.
  const current = await getActor(db, signed);
  if (!current) throw new HttpError(403, 'Seu acesso mudou. Entre novamente.', 'account_inactive');
  await requireLiveAccount(db, current.userId);
  const existing = await one(db, 'SELECT * FROM google_drive_uploads WHERE plan_id=?', [plan.id]);
  if (existing?.status === 'sent') return { duplicate: true, upload: uploadView(existing) };
  if (existing) throw new HttpError(409, 'Esta prévia já foi usada. Prepare o envio de novo.', 'drive_plan_used');
  const folder = await usableFolder(db, current, plan.folderId);
  if (folder.driveFolderId !== plan.driveFolderId) throw new HttpError(409, 'A pasta mudou depois da prévia. Prepare o envio de novo.', 'drive_plan_invalid');
  const source = await resolveSource(db, current, plan.source);
  requireCompatibleDestination(source, folder);
  if (source.size !== plan.size || source.mime !== plan.mime) throw new HttpError(409, 'O arquivo mudou depois da prévia. Prepare o envio de novo.', 'drive_plan_invalid');
  let bytes: Uint8Array;
  if (source.kind === 'upload') {
    if (!file) throw new HttpError(400, 'Envie o arquivo junto com a confirmação.', 'missing_file');
    bytes = file;
  } else {
    if (!deps.storage) throw new HttpError(503, 'O armazenamento de anexos ainda não está disponível.', 'storage_unavailable');
    const object = await deps.storage.get(source.objectKey!);
    if (!object) throw new HttpError(404, 'O arquivo não foi encontrado no portal.', 'document_not_found');
    if (object.size !== plan.size || object.size > MAX_UPLOAD_FILE_BYTES) throw new HttpError(409, 'O arquivo não corresponde à prévia. Prepare o envio de novo.', 'drive_plan_invalid');
    bytes = new Uint8Array(await object.arrayBuffer());
  }
  if (bytes.byteLength !== plan.size || bytes.byteLength > MAX_UPLOAD_FILE_BYTES || !matchesSignature(bytes, plan.mime)) throw new HttpError(409, 'O arquivo não corresponde à prévia. Prepare o envio de novo.', 'drive_plan_invalid');
  const sha256 = await sha256Hex(bytes);
  if (plan.sha256 && source.kind === 'upload' && plan.sha256 !== sha256) throw new HttpError(409, 'O arquivo não corresponde à prévia. Prepare o envio de novo.', 'drive_plan_invalid');
  const now = iso();
  // Reserva o plano antes de falar com o Google: duas confirmações simultâneas não geram dois arquivos.
  try {
    await db.prepare(`INSERT INTO google_drive_uploads(id,organization_id,project_id,user_id,via,folder_id,drive_folder_id,source_kind,source_id,file_name,mime,bytes,sha256,status,error_code,plan_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'failed','sending',?,?)`).bind(`gdh_${uid()}`, plan.organizationId, plan.projectId, current.userId, plan.via, folder.id, folder.driveFolderId, source.kind, source.id, plan.fileName, plan.mime, bytes.byteLength, sha256, plan.id, now).run();
  } catch { throw new HttpError(409, 'Esta prévia já está sendo enviada. Aguarde e atualize o histórico.', 'drive_plan_used'); }
  try {
    const token = await accessTokenFor(db, current.userId, deps), { accessToken } = token;
    try { await inspectFolder(db, current, folder.driveFolderId, deps, token); }
    catch (error) {
      if (error instanceof HttpError && error.code === 'drive_folder_confirm_required') await db.prepare('DELETE FROM google_drive_folder_grants WHERE user_id=? AND folder_id=?').bind(current.userId, folder.id).run();
      throw error;
    }
    // Última conferência no portal, logo antes de gravar: acesso ou pasta revogados no meio do caminho param aqui.
    const fresh = await getActor(db, current);
    if (!fresh) throw new HttpError(403, 'Seu acesso mudou. Entre novamente.', 'account_inactive');
    await usableFolder(db, fresh, folder.id);
    const description = `Enviado pelo Portal PROEX${plan.via === 'role' ? ' pelo Rolê, a pedido de quem enviou' : ''}. Origem: ${source.label}.`.slice(0, 500);
    const result = await uploadFile(deps.fetcher ?? fetch, accessToken, { folderId: folder.driveFolderId, name: plan.fileName, mime: plan.mime, bytes, description });
    await db.prepare("UPDATE google_drive_uploads SET status='sent',error_code=NULL,drive_file_id=?,web_view_link=? WHERE plan_id=?").bind(result.id, result.webViewLink, plan.id).run();
    await writeAudit(db, current, 'google_drive.upload', plan.id, plan.projectId, { via: plan.via, folderId: folder.id, sourceKind: source.kind });
    return { duplicate: false, upload: uploadView((await one(db, 'SELECT * FROM google_drive_uploads WHERE plan_id=?', [plan.id]))!) };
  } catch (error) {
    await db.prepare('UPDATE google_drive_uploads SET error_code=? WHERE plan_id=?').bind(errorCode(error), plan.id).run();
    throw error;
  }
}

function uploadView(row: Row) {
  return { id: row.id, fileName: row.file_name, folderId: row.folder_id, folderName: row.folder_name ?? null, via: row.via, status: row.status, errorCode: row.error_code ?? null,
    webViewLink: row.status === 'sent' ? row.web_view_link : null, bytes: Number(row.bytes), sourceKind: row.source_kind, createdAt: row.created_at, personName: row.person_name ?? null };
}

/** Histórico: cada pessoa vê os próprios envios; a administração da organização vê os envios das pastas dela. */
export async function uploadHistory(db: D1Database, actor: PortalActor | null, scope: unknown) {
  const current = requireActor(actor);
  const admin = scope === 'organization';
  const manageable = (current.organizations ?? []).filter(organization => organization.canManage).map(organization => organization.id);
  if (admin && !manageable.length) throw new HttpError(403, 'Só a administração vê o histórico de toda a organização.', 'drive_history_forbidden');
  const where = admin ? `h.organization_id IN (${manageable.map(() => '?').join(',')})` : 'h.user_id=?';
  const rows = await all(db, `SELECT h.*,f.name folder_name,COALESCE(p.display_name,'Pessoa da equipe') person_name FROM google_drive_uploads h JOIN google_drive_folders f ON f.id=h.folder_id LEFT JOIN profiles p ON p.user_id=h.user_id
    WHERE ${where} ORDER BY h.created_at DESC,h.id LIMIT 100`, admin ? manageable : [current.userId]);
  return { scope: admin ? 'organization' : 'mine', uploads: rows.map(uploadView) };
}
