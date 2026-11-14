import { LEGACY_ORGANIZATION_ID, organizationAuthoritySql, requireLiveAccount, writeAudit, type PortalActor } from '../access';
import { all, iso, one, uid, type Row } from '../database';
import { HttpError } from '../errors';
import { accessTokenFor, type DriveDeps } from './connection';
import { getFolder } from './google';

/*
 * Registro de pastas do Drive da PROEX. A administração (dona da organização) escolhe a pasta no Google Picker
 * e descreve nome, finalidade, unidade ou projeto e quem pode usar. O portal guarda só o id e esses metadados.
 * Quem pode usar é conferido em SQL, junto com a linha da pasta, a cada leitura e a cada envio.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
export const AUDIENCES = { organization: 'Toda a organização', project: 'Equipe do projeto', managers: 'Só gestão (donos e gestores)' } as const;
export type Audience = keyof typeof AUDIENCES;

const ACTIVE_USER = "u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL";
/** Pode usar a pasta `alias`: conferido em SQL com a membresia viva. */
export function folderAudienceSql(alias: string) {
  return `EXISTS(SELECT 1 FROM members m JOIN portal_users u ON u.user_id=m.user_id WHERE m.user_id=? AND m.revoked_at IS NULL AND ${ACTIVE_USER} AND (
    (m.role='owner' AND m.project_id IS NULL AND m.organization_id IS NULL)
    OR (m.project_id IS NULL AND COALESCE(m.organization_id,'${LEGACY_ORGANIZATION_ID}')=${alias}.organization_id AND (${alias}.audience!='managers' OR m.role IN ('owner','manager')))
    OR (m.project_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects mp WHERE mp.id=m.project_id AND mp.organization_id=${alias}.organization_id)
      AND (${alias}.audience='organization'
        OR (${alias}.audience='project' AND m.project_id=${alias}.project_id)
        OR (${alias}.audience='managers' AND m.role IN ('owner','manager') AND (${alias}.project_id IS NULL OR m.project_id=${alias}.project_id))))))`;
}

function requireActor(actor: PortalActor | null): PortalActor {
  if (!actor) throw new HttpError(401, 'Entre no portal para continuar.', 'unauthenticated');
  return actor;
}
function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new HttpError(400, `Escolha ${label}.`, 'invalid_input');
  return value;
}
function optionalId(value: unknown, label: string): string | null {
  return value === null || value === undefined || value === '' ? null : id(value, label);
}
function cleanText(value: unknown, label: string, max: number): string {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!text) throw new HttpError(400, `Preencha ${label}.`, 'invalid_input');
  if (text.length > max) throw new HttpError(400, `${label[0].toUpperCase()}${label.slice(1)} pode ter no máximo ${max} caracteres.`, 'invalid_input');
  return text;
}
function audience(value: unknown): Audience {
  if (typeof value !== 'string' || !Object.hasOwn(AUDIENCES, value)) throw new HttpError(400, 'Escolha quem pode usar a pasta.', 'invalid_input');
  return value as Audience;
}
function driveFolderId(value: unknown): string {
  if (typeof value !== 'string' || !DRIVE_ID.test(value)) throw new HttpError(400, 'Escolha a pasta no seletor do Google.', 'drive_folder_invalid');
  return value;
}

async function requireOrganizationAdmin(db: D1Database, actor: PortalActor, organizationId: string) {
  const authority = organizationAuthoritySql(actor, organizationId);
  if (!await one(db, `SELECT 1 FROM organizations WHERE id=? AND status='active' AND ${authority.sql}`, [organizationId, ...authority.values])) {
    throw new HttpError(403, 'Só a administração desta organização cadastra pastas do Drive.', 'drive_folder_admin');
  }
}

export type FolderView = { id: string; organizationId: string; organizationName: string; name: string; purpose: string; driveName: string; sharedDrive: boolean;
  unitId: string | null; unitName: string | null; projectId: string | null; projectName: string | null; audience: Audience; audienceLabel: string; status: 'active' | 'archived';
  version: number; confirmedByMe: boolean; driveFolderId: string; driveUrl: string; updatedAt: string };
function folderView(row: Row): FolderView {
  return {
    id: row.id, organizationId: row.organization_id, organizationName: row.organization_name ?? '', name: row.name, purpose: row.purpose, driveName: row.drive_name,
    sharedDrive: !!row.shared_drive_id, unitId: row.unit_id ?? null, unitName: row.unit_name ?? null, projectId: row.project_id ?? null, projectName: row.project_name ?? null,
    audience: row.audience, audienceLabel: AUDIENCES[row.audience as Audience] ?? row.audience, status: row.status, version: Number(row.version),
    confirmedByMe: !!row.confirmed_by_me, driveFolderId: row.drive_folder_id, driveUrl: `https://drive.google.com/drive/folders/${encodeURIComponent(row.drive_folder_id)}`, updatedAt: row.updated_at,
  };
}
const FOLDER_SELECT = `SELECT f.*,o.name organization_name,un.name unit_name,p.name project_name,
  EXISTS(SELECT 1 FROM google_drive_folder_grants g JOIN google_drive_connections c ON c.user_id=g.user_id AND c.google_sub=g.google_sub AND c.status='active' WHERE g.folder_id=f.id AND g.user_id=?) confirmed_by_me
  FROM google_drive_folders f JOIN organizations o ON o.id=f.organization_id LEFT JOIN organizational_units un ON un.id=f.unit_id LEFT JOIN projects p ON p.id=f.project_id`;

/** Pastas que a pessoa pode usar agora (ativas, da organização dela e do público certo). */
export async function usableFolders(db: D1Database, actor: PortalActor, filter: { projectId?: string | null } = {}): Promise<FolderView[]> {
  const rows = await all(db, `${FOLDER_SELECT} WHERE f.status='active' AND o.status='active' AND ${folderAudienceSql('f')} ORDER BY o.name,f.name,f.id`, [actor.userId, actor.userId]);
  const views = rows.map(folderView);
  if (!filter.projectId) return views;
  const project = await one(db, 'SELECT organization_id FROM projects WHERE id=?', [filter.projectId]);
  return views.filter(folder => folder.organizationId === project?.organization_id);
}
/** Uma pasta utilizável, relida com a autorização. Sem acesso = não encontrada (não revela se existe). */
export async function usableFolder(db: D1Database, actor: PortalActor, folderId: unknown): Promise<Row & FolderView> {
  const row = await one(db, `${FOLDER_SELECT} WHERE f.id=? AND f.status='active' AND o.status='active' AND ${folderAudienceSql('f')}`, [actor.userId, id(folderId, 'uma pasta'), actor.userId]);
  if (!row) throw new HttpError(404, 'Esta pasta não está disponível para você. Escolha outra da lista.', 'drive_folder_unavailable');
  return { ...row, ...folderView(row) };
}

/** Tela da administração: organizações que a pessoa administra, pastas (inclusive arquivadas), unidades e projetos. */
export async function folderAdminView(db: D1Database, actor: PortalActor | null) {
  const current = requireActor(actor);
  const organizations: Row[] = [];
  for (const organization of current.organizations ?? []) {
    if (!organization.canManage || organization.status !== 'active') continue;
    const authority = organizationAuthoritySql(current, organization.id);
    if (await one(db, `SELECT 1 WHERE ${authority.sql}`, authority.values)) organizations.push({ id: organization.id, name: organization.name });
  }
  if (!organizations.length) return { canManage: false, organizations: [], folders: [], units: [], projects: [] };
  const ids = organizations.map(row => row.id), marks = ids.map(() => '?').join(',');
  const folders = (await all(db, `${FOLDER_SELECT} WHERE f.organization_id IN (${marks}) ORDER BY f.status,o.name,f.name,f.id`, [current.userId, ...ids])).map(folderView);
  const units = await all(db, "SELECT id,name,acronym FROM organizational_units WHERE status='active' ORDER BY name,id");
  const projects = await all(db, `SELECT id,name,organization_id organizationId FROM projects WHERE organization_id IN (${marks}) AND COALESCE(status,'active')!='archived' ORDER BY name,id`, ids);
  return { canManage: true, organizations, folders, units: units.map(row => ({ id: row.id, name: row.acronym ? `${row.name} (${row.acronym})` : row.name })), projects };
}

/** Confere a pasta no Drive com a conta da própria pessoa: é pasta, não está na lixeira, não é pública, aceita arquivos. */
export async function inspectFolder(db: D1Database, actor: PortalActor, driveId: string, deps: DriveDeps, token?: { accessToken: string; googleSub: string }, options: { requireKnownSharing?: boolean } = {}) {
  const { accessToken, googleSub } = token ?? await accessTokenFor(db, actor.userId, deps);
  const folder = await getFolder(deps.fetcher ?? fetch, accessToken, driveId);
  if (folder.trashed) throw new HttpError(409, 'Esta pasta está na lixeira do Drive. Escolha outra.', 'drive_folder_trashed');
  if (folder.isPublic) throw new HttpError(409, 'Esta pasta está aberta a qualquer pessoa com o link ou a todo o domínio. O portal só envia para pastas privadas; ajuste o compartilhamento no Drive.', 'drive_folder_public');
  if (options.requireKnownSharing && !folder.sharingKnown) throw new HttpError(409, 'Não foi possível conferir com quem esta pasta está compartilhada. Cadastre com uma conta que gerencia a pasta.', 'drive_folder_sharing_unknown');
  if (!folder.canAddChildren) throw new HttpError(403, 'Sua conta Google não pode adicionar arquivos nesta pasta. Peça acesso de editor (ou "Colaborador de conteúdo" no drive compartilhado).', 'drive_permission_denied');
  return { folder, accessToken, googleSub };
}

async function projectInOrganization(db: D1Database, projectId: string | null, organizationId: string) {
  if (projectId && !await one(db, 'SELECT 1 FROM projects WHERE id=? AND organization_id=?', [projectId, organizationId])) throw new HttpError(400, 'O projeto escolhido não pertence a esta organização.', 'invalid_input');
}
async function unitExists(db: D1Database, unitId: string | null) {
  if (unitId && !await one(db, "SELECT 1 FROM organizational_units WHERE id=? AND status='active'", [unitId])) throw new HttpError(400, 'Escolha uma unidade ativa.', 'invalid_input');
}

/** Cadastrar, editar, arquivar e reativar. Edição e arquivamento conferem a versão (sem sobrescrever o trabalho de outra pessoa). */
export async function folderAction(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, deps: DriveDeps) {
  const current = requireActor(actor);
  await requireLiveAccount(db, current.userId);
  const action = input.action;
  if (action === 'register') {
    const organizationId = id(input.organizationId, 'a organização');
    await requireOrganizationAdmin(db, current, organizationId);
    const driveId = driveFolderId(input.driveFolderId);
    const name = cleanText(input.name, 'o nome', 120), purpose = cleanText(input.purpose, 'a finalidade', 300);
    const who = audience(input.audience), projectId = optionalId(input.projectId, 'um projeto'), unitId = optionalId(input.unitId, 'uma unidade');
    if (who === 'project' && !projectId) throw new HttpError(400, 'Escolha o projeto cuja equipe pode usar a pasta.', 'invalid_input');
    await projectInOrganization(db, projectId, organizationId); await unitExists(db, unitId);
    if (await one(db, 'SELECT 1 FROM google_drive_folders WHERE organization_id=? AND drive_folder_id=?', [organizationId, driveId])) {
      throw new HttpError(409, 'Esta pasta já está cadastrada nesta organização. Edite ou reative o cadastro existente.', 'drive_folder_duplicate');
    }
    const { folder, googleSub } = await inspectFolder(db, current, driveId, deps, undefined, { requireKnownSharing: true });
    const folderId = `gdf_${uid()}`, now = iso(), authority = organizationAuthoritySql(current, organizationId);
    const results = await db.batch([
      db.prepare(`INSERT INTO google_drive_folders(id,organization_id,drive_folder_id,shared_drive_id,name,drive_name,purpose,unit_id,project_id,audience,status,created_by,created_at,updated_by,updated_at,version)
        SELECT ?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,1 WHERE ${authority.sql}`)
        .bind(folderId, organizationId, driveId, folder.sharedDriveId, name, folder.name, purpose, unitId, projectId, who, current.userId, now, current.userId, now, ...authority.values),
      db.prepare('INSERT OR REPLACE INTO google_drive_folder_grants(user_id,folder_id,google_sub,confirmed_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM google_drive_folders WHERE id=?)')
        .bind(current.userId, folderId, googleSub, now, folderId),
    ]);
    if (!results[0].meta?.changes) throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'drive_folder_admin');
    await writeAudit(db, current, 'google_drive.folder.register', folderId, projectId, { audience: who, sharedDrive: !!folder.sharedDriveId });
    return { folder: folderView((await one(db, `${FOLDER_SELECT} WHERE f.id=?`, [current.userId, folderId]))!) };
  }
  const folderId = id(input.folderId, 'uma pasta');
  const row = await one(db, 'SELECT * FROM google_drive_folders WHERE id=?', [folderId]);
  if (!row) throw new HttpError(404, 'Pasta não encontrada.', 'drive_folder_unavailable');
  await requireOrganizationAdmin(db, current, row.organization_id);
  const version = Number(input.version);
  if (!Number.isSafeInteger(version) || version !== Number(row.version)) throw new HttpError(409, 'Outra pessoa mudou este cadastro. Atualize a lista antes de salvar.', 'drive_folder_changed');
  const authority = organizationAuthoritySql(current, row.organization_id), now = iso();
  let statement: D1PreparedStatement;
  if (action === 'update') {
    const name = cleanText(input.name, 'o nome', 120), purpose = cleanText(input.purpose, 'a finalidade', 300);
    const who = audience(input.audience), projectId = optionalId(input.projectId, 'um projeto'), unitId = optionalId(input.unitId, 'uma unidade');
    if (who === 'project' && !projectId) throw new HttpError(400, 'Escolha o projeto cuja equipe pode usar a pasta.', 'invalid_input');
    await projectInOrganization(db, projectId, row.organization_id); await unitExists(db, unitId);
    statement = db.prepare(`UPDATE google_drive_folders SET name=?,purpose=?,audience=?,project_id=?,unit_id=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND ${authority.sql}`)
      .bind(name, purpose, who, projectId, unitId, current.userId, now, folderId, version, ...authority.values);
  } else if (action === 'archive' || action === 'restore') {
    statement = db.prepare(`UPDATE google_drive_folders SET status=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND ${authority.sql}`)
      .bind(action === 'archive' ? 'archived' : 'active', current.userId, now, folderId, version, ...authority.values);
  } else throw new HttpError(400, 'Ação desconhecida.', 'invalid_input');
  const result = await statement.run();
  if (!result.meta?.changes) throw new HttpError(409, 'Outra pessoa mudou este cadastro. Atualize a lista antes de salvar.', 'drive_folder_changed');
  await writeAudit(db, current, `google_drive.folder.${action}`, folderId, row.project_id ?? null, {});
  return { folder: folderView((await one(db, `${FOLDER_SELECT} WHERE f.id=?`, [current.userId, folderId]))!) };
}

/**
 * Confirmação pela própria pessoa: ela abriu o seletor do Google já na pasta registrada e clicou em Selecionar.
 * Com o escopo drive.file, é esse clique que libera a pasta para o portal na conta dela.
 */
export async function confirmFolder(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, deps: DriveDeps) {
  const current = requireActor(actor);
  const folder = await usableFolder(db, current, input.folderId);
  if (driveFolderId(input.pickedId) !== folder.driveFolderId) throw new HttpError(400, `Você escolheu outra pasta. Selecione "${folder.driveName}" no seletor.`, 'drive_folder_mismatch');
  const { googleSub } = await inspectFolder(db, current, folder.driveFolderId, deps);
  const now = iso();
  const result = await db.prepare(`INSERT OR REPLACE INTO google_drive_folder_grants(user_id,folder_id,google_sub,confirmed_at)
    SELECT ?,?,?,? FROM google_drive_folders f WHERE f.id=? AND f.status='active' AND ${folderAudienceSql('f')}`)
    .bind(current.userId, folder.id, googleSub, now, folder.id, current.userId).run();
  if (!result.meta?.changes) throw new HttpError(404, 'Esta pasta não está mais disponível para você.', 'drive_folder_unavailable');
  return { folderId: folder.id, confirmedByMe: true };
}
