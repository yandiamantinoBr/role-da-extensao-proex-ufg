import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizationalUnits, organizations, portalUsers, projects } from './base-schema';
/*
 * Google Drive por pessoa (0042). Cada pessoa conecta a própria conta Google com o escopo drive.file;
 * o token de atualização fica cifrado (PROEX_KEYS_SECRET) e nunca sai do servidor. O registro de pastas
 * guarda só o id e metadados escolhidos pela administração no Google Picker. Ver docs/GOOGLE-DRIVE.md.
 */
export const googleDriveConnections = sqliteTable('google_drive_connections', {
  userId: text('user_id').primaryKey().notNull().references(() => portalUsers.userId),
  googleSub: text('google_sub').notNull(), googleEmail: text('google_email').notNull(),
  scopes: text('scopes').notNull(), tokenCiphertext: text('token_ciphertext'), keyId: text('key_id'),
  status: text('status').notNull().default('active'),
  connectedAt: text('connected_at').notNull(), updatedAt: text('updated_at').notNull(),
  lastUsedAt: text('last_used_at'), revokedAt: text('revoked_at'),
  version: integer('version').notNull().default(1),
}, t => [
  check('google_drive_connections_status', sql`${t.status} IN ('active','revoked')`),
  check('google_drive_connections_token', sql`(${t.status}='active' AND ${t.tokenCiphertext} IS NOT NULL AND ${t.keyId} IS NOT NULL) OR (${t.status}='revoked' AND ${t.tokenCiphertext} IS NULL)`),
]);
export const googleDriveFolders = sqliteTable('google_drive_folders', {
  id: text('id').primaryKey().notNull(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  driveFolderId: text('drive_folder_id').notNull(), sharedDriveId: text('shared_drive_id'),
  name: text('name').notNull(), driveName: text('drive_name').notNull(), purpose: text('purpose').notNull(),
  unitId: text('unit_id').references(() => organizationalUnits.id),
  projectId: text('project_id').references(() => projects.id),
  audience: text('audience').notNull().default('organization'),
  status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull().references(() => portalUsers.userId), createdAt: text('created_at').notNull(),
  updatedBy: text('updated_by').notNull().references(() => portalUsers.userId), updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull().default(1),
}, t => [
  uniqueIndex('google_drive_folders_drive_idx').on(t.organizationId, t.driveFolderId),
  index('google_drive_folders_org_idx').on(t.organizationId, t.status, t.name),
  check('google_drive_folders_audience', sql`${t.audience} IN ('organization','project','managers')`),
  check('google_drive_folders_project', sql`${t.audience}!='project' OR ${t.projectId} IS NOT NULL`),
  check('google_drive_folders_status', sql`${t.status} IN ('active','archived')`),
  check('google_drive_folders_text', sql`length(${t.name}) BETWEEN 1 AND 120 AND length(${t.purpose}) BETWEEN 1 AND 300 AND length(${t.driveName}) BETWEEN 1 AND 300`),
]);
/** Confirmação da pasta pela própria pessoa no Picker: o drive.file concede acesso por pessoa e por app. */
export const googleDriveFolderGrants = sqliteTable('google_drive_folder_grants', {
  userId: text('user_id').notNull().references(() => portalUsers.userId),
  folderId: text('folder_id').notNull().references(() => googleDriveFolders.id),
  googleSub: text('google_sub').notNull(), confirmedAt: text('confirmed_at').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.folderId] })]);
/** Histórico: quem enviou, o quê, para qual pasta, por qual caminho e o link devolvido pelo Drive. */
export const googleDriveUploads = sqliteTable('google_drive_uploads', {
  id: text('id').primaryKey().notNull(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  projectId: text('project_id').references(() => projects.id),
  userId: text('user_id').notNull().references(() => portalUsers.userId),
  via: text('via').notNull(), folderId: text('folder_id').notNull().references(() => googleDriveFolders.id),
  driveFolderId: text('drive_folder_id').notNull(),
  sourceKind: text('source_kind').notNull(), sourceId: text('source_id'),
  fileName: text('file_name').notNull(), mime: text('mime').notNull(), bytes: integer('bytes').notNull(), sha256: text('sha256').notNull(),
  driveFileId: text('drive_file_id'), webViewLink: text('web_view_link'),
  status: text('status').notNull(), errorCode: text('error_code'),
  planId: text('plan_id').notNull(), createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('google_drive_uploads_plan_idx').on(t.planId),
  index('google_drive_uploads_org_idx').on(t.organizationId, t.createdAt),
  index('google_drive_uploads_user_idx').on(t.userId, t.createdAt),
  index('google_drive_uploads_folder_idx').on(t.folderId, t.createdAt),
  check('google_drive_uploads_via', sql`${t.via} IN ('screen','role')`),
  check('google_drive_uploads_source', sql`length(${t.sourceKind}) BETWEEN 3 AND 40`),
  check('google_drive_uploads_status', sql`${t.status} IN ('sent','failed')`),
  check('google_drive_uploads_bytes', sql`${t.bytes} > 0`),
]);
