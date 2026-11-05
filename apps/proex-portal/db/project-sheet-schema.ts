import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { projects } from './base-schema';

export const projectSheetConnections=sqliteTable('project_sheet_connections',{
 id:text('id').primaryKey(),projectId:text('project_id').notNull().references(()=>projects.id),spreadsheetId:text('spreadsheet_id').notNull(),label:text('label').notNull(),
 enabled:integer('enabled').notNull().default(1),version:integer('version').notNull().default(1),tabsJson:text('tabs_json').notNull().default('{}'),tabsVersion:integer('tabs_version').notNull().default(0),
 createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('project_sheet_connections_project_unique').on(t.projectId),uniqueIndex('project_sheet_connections_file_unique').on(t.spreadsheetId),check('project_sheet_enabled_check',sql`${t.enabled} IN (0,1)`),check('project_sheet_version_check',sql`${t.version}>0`)]);
export const projectSheetTokens=sqliteTable('project_sheet_tokens',{
 id:text('id').primaryKey(),connectionId:text('connection_id').notNull().references(()=>projectSheetConnections.id),connectionVersion:integer('connection_version').notNull(),tokenHash:text('token_hash').notNull(),userId:text('user_id').notNull(),scope:text('scope').notNull(),label:text('label').notNull(),createdAt:text('created_at').notNull(),expiresAt:text('expires_at').notNull(),revokedAt:text('revoked_at'),lastUsedAt:text('last_used_at'),
},t=>[uniqueIndex('project_sheet_tokens_hash_unique').on(t.tokenHash),index('project_sheet_tokens_connection_idx').on(t.connectionId),check('project_sheet_scope_check',sql`${t.scope} IN ('read','materials')`)]);
export const projectSheetRuns=sqliteTable('project_sheet_runs',{
 id:text('id').primaryKey(),connectionId:text('connection_id').notNull().references(()=>projectSheetConnections.id),tokenId:text('token_id').notNull().references(()=>projectSheetTokens.id),connectionVersion:integer('connection_version').notNull(),requestId:text('request_id').notNull(),status:text('status').notNull(),startedAt:text('started_at').notNull(),finishedAt:text('finished_at'),exportedCount:integer('exported_count').notNull().default(0),appliedCount:integer('applied_count').notNull().default(0),conflictCount:integer('conflict_count').notNull().default(0),
},t=>[uniqueIndex('project_sheet_runs_request_unique').on(t.tokenId,t.requestId),check('project_sheet_run_status_check',sql`${t.status} IN ('running','completed','conflict','failed')`)]);
export const projectSheetReceipts=sqliteTable('project_sheet_receipts',{
 operationKey:text('operation_key').primaryKey(),connectionId:text('connection_id').notNull().references(()=>projectSheetConnections.id),fingerprint:text('fingerprint').notNull(),entityId:text('entity_id'),resultJson:text('result_json').notNull(),createdAt:text('created_at').notNull(),
});
export const projectSheetConflicts=sqliteTable('project_sheet_conflicts',{
 id:text('id').primaryKey(),connectionId:text('connection_id').notNull().references(()=>projectSheetConnections.id),entityType:text('entity_type').notNull(),entityId:text('entity_id'),expectedVersion:integer('expected_version'),reason:text('reason').notNull(),status:text('status').notNull().default('open'),createdAt:text('created_at').notNull(),
},t=>[check('project_sheet_conflict_status_check',sql`${t.status} IN ('open','resolved')`)]);
