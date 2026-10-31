import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizations, projects, items, loans, campaigns, portalUsers } from './base-schema';
import { followupTeams } from './follow-up-schema';

// Runtime 0017 also owns scope, immutable identity and history triggers.
export const workResponsibilityScopes=sqliteTable('work_responsibility_scopes',{
 id:text('id').primaryKey().notNull(),organizationId:text('organization_id').notNull().references(()=>organizations.id),projectId:text('project_id').notNull().references(()=>projects.id),
 area:text('area').notNull(),itemId:text('item_id').references(()=>items.id),loanId:text('loan_id').references(()=>loans.id),campaignId:text('campaign_id').references(()=>campaigns.id),
 targetKey:text('target_key').notNull().default(''),status:text('status').notNull().default('active'),version:integer('version').notNull().default(1),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('work_responsibility_target_idx').on(t.projectId,t.area,t.targetKey),index('work_responsibility_scope_idx').on(t.organizationId,t.projectId,t.status,t.area,t.id),check('work_responsibility_area',sql`${t.area} IN ('projects','materials','loans','campaigns')`),check('work_responsibility_status',sql`${t.status} IN ('active','revoked')`),check('work_responsibility_version',sql`${t.version}>0`),check('work_responsibility_target_key',sql`${t.targetKey}=COALESCE(${t.itemId},${t.loanId},${t.campaignId},'')`),check('work_responsibility_target',sql`(${t.area}='projects' AND ${t.itemId} IS NULL AND ${t.loanId} IS NULL AND ${t.campaignId} IS NULL) OR (${t.area}='materials' AND ${t.loanId} IS NULL AND ${t.campaignId} IS NULL) OR (${t.area}='loans' AND ${t.itemId} IS NULL AND ${t.campaignId} IS NULL) OR (${t.area}='campaigns' AND ${t.itemId} IS NULL AND ${t.loanId} IS NULL)`)]);
export const workResponsibilityAssignees=sqliteTable('work_responsibility_assignees',{
 id:text('id').primaryKey().notNull(),scopeId:text('scope_id').notNull().references(()=>workResponsibilityScopes.id),userId:text('user_id').references(()=>portalUsers.userId),teamId:text('team_id').references(()=>followupTeams.id),createdAt:text('created_at').notNull(),revokedAt:text('revoked_at'),
},t=>[uniqueIndex('work_responsibility_person_idx').on(t.scopeId,t.userId).where(sql`${t.revokedAt} IS NULL AND ${t.userId} IS NOT NULL`),uniqueIndex('work_responsibility_team_idx').on(t.scopeId,t.teamId).where(sql`${t.revokedAt} IS NULL AND ${t.teamId} IS NOT NULL`),index('work_responsibility_user_idx').on(t.userId,t.revokedAt,t.scopeId),check('work_responsibility_subject',sql`(${t.userId} IS NULL)!=(${t.teamId} IS NULL)`)]);
export const workResponsibilityHistory=sqliteTable('work_responsibility_history',{
 id:text('id').primaryKey().notNull(),scopeId:text('scope_id').notNull().references(()=>workResponsibilityScopes.id),version:integer('version').notNull(),snapshotJson:text('snapshot_json').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[unique().on(t.scopeId,t.version)]);
