import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizations, projects, members, portalUsers, items, campaigns, loans, projectScheduleItems, followupTasks } from './base-schema';
export { followupTasks } from './base-schema';

// Export these tables from db/schema.ts when integrating 0014. Runtime SQL owns
// relationship/immutability triggers; Drizzle has no trigger model.
export const followupTeams = sqliteTable('followup_teams', {
 id:text('id').primaryKey().notNull(), organizationId:text('organization_id').notNull().references(()=>organizations.id),
 name:text('name').notNull(), status:text('status').notNull().default('active'), version:integer('version').notNull().default(1),
 createdBy:text('created_by').notNull(), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[index('followup_teams_org_idx').on(t.organizationId,t.status,t.name),check('followup_team_name',sql`length(${t.name}) BETWEEN 1 AND 100`),check('followup_team_status',sql`${t.status} IN ('active','archived')`),check('followup_team_version',sql`${t.version}>0`)]);
export const followupTeamMembers = sqliteTable('followup_team_members', {
 id:text('id').primaryKey().notNull(), teamId:text('team_id').notNull().references(()=>followupTeams.id),userId:text('user_id').notNull().references(()=>portalUsers.userId),
 addedBy:text('added_by').notNull(),createdAt:text('created_at').notNull(),removedAt:text('removed_at'),
},t=>[uniqueIndex('followup_team_member_active_idx').on(t.teamId,t.userId).where(sql`${t.removedAt} IS NULL`)]);
export const followupAssignees = sqliteTable('followup_assignees', {
 id:text('id').primaryKey().notNull(),taskId:text('task_id').notNull().references(()=>followupTasks.id),userId:text('user_id').references(()=>portalUsers.userId),teamId:text('team_id').references(()=>followupTeams.id),createdAt:text('created_at').notNull(),removedAt:text('removed_at'),
},t=>[uniqueIndex('followup_assignee_active_idx').on(t.taskId,sql`COALESCE(${t.userId},'')`,sql`COALESCE(${t.teamId},'')`).where(sql`${t.removedAt} IS NULL`),check('followup_assignee_one',sql`(${t.userId} IS NULL)!=(${t.teamId} IS NULL)`)]);
export const followupHistory = sqliteTable('followup_history', {
 id:text('id').primaryKey().notNull(),taskId:text('task_id').notNull().references(()=>followupTasks.id),version:integer('version').notNull(),snapshotJson:text('snapshot_json').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('followup_history_version_idx').on(t.taskId,t.version)]);
export const followupChecklists = sqliteTable('followup_checklists', {
 id:text('id').primaryKey().notNull(),organizationId:text('organization_id').notNull().references(()=>organizations.id),projectId:text('project_id').notNull().references(()=>projects.id),campaignId:text('campaign_id').references(()=>campaigns.id),taskId:text('task_id').notNull().unique().references(()=>followupTasks.id),title:text('title').notNull(),kind:text('kind').notNull().default('materials'),status:text('status').notNull().default('open'),version:integer('version').notNull().default(1),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
 scheduleItemId:text('schedule_item_id').references(()=>projectScheduleItems.id),
},t=>[index('followup_checklists_schedule_idx').on(t.scheduleItemId,t.taskId),check('followup_checklist_kind',sql`${t.kind} IN ('materials','activity')`),check('followup_checklist_title',sql`length(${t.title}) BETWEEN 1 AND 160`),check('followup_checklist_status',sql`${t.status} IN ('open','completed')`),check('followup_checklist_version',sql`${t.version}>0`)]);
export const followupChecklistItems = sqliteTable('followup_checklist_items', {
 id:text('id').primaryKey().notNull(),checklistId:text('checklist_id').notNull().references(()=>followupChecklists.id),itemId:text('item_id').notNull().references(()=>items.id),size:text('size').notNull().default(''),expected:integer('expected').notNull(),counted:integer('counted'),damaged:integer('damaged').notNull().default(0),note:text('note').notNull().default(''),
},t=>[unique().on(t.checklistId,t.itemId,t.size),check('followup_checklist_size',sql`length(${t.size})<=40`),check('followup_checklist_expected',sql`${t.expected} BETWEEN 0 AND 1000000`),check('followup_checklist_counted',sql`${t.counted} IS NULL OR ${t.counted} BETWEEN 0 AND 1000000`),check('followup_checklist_damaged',sql`${t.damaged}>=0`),check('followup_checklist_note',sql`length(${t.note})<=600`),check('followup_checklist_damage_limit',sql`(${t.counted} IS NULL AND ${t.damaged}=0) OR (${t.counted} IS NOT NULL AND ${t.damaged}<=${t.counted})`)]);
export const followupChecklistActions = sqliteTable('followup_checklist_actions', {
 checklistId:text('checklist_id').notNull().references(()=>followupChecklists.id),rowId:text('row_id').notNull().references(()=>followupChecklistItems.id),taskId:text('task_id').notNull().unique().references(()=>followupTasks.id),
},t=>[primaryKey({columns:[t.checklistId,t.rowId]})]);
export const followupNotifications = sqliteTable('followup_notifications', {
 id:text('id').primaryKey().notNull(),taskId:text('task_id').notNull().references(()=>followupTasks.id),userId:text('user_id').notNull().references(()=>portalUsers.userId),causeKey:text('cause_key').notNull(),readAt:text('read_at'),createdAt:text('created_at').notNull(),
},t=>[unique().on(t.taskId,t.userId,t.causeKey),index('followup_notifications_inbox_idx').on(t.userId,t.readAt,t.createdAt,t.id)]);
export const followupInboxEntries = sqliteTable('followup_inbox_entries', {
 sequence:integer('sequence').primaryKey({autoIncrement:true}),
 notificationId:text('notification_id').notNull().unique().references(()=>followupNotifications.id,{onDelete:'cascade'}),
 dismissedAt:text('dismissed_at'),
});
export const followupHiddenPending = sqliteTable('followup_hidden_pending', {
 userId:text('user_id').notNull().references(()=>portalUsers.userId),
 taskId:text('task_id').notNull().references(()=>followupTasks.id),
 taskVersion:integer('task_version').notNull(),
},t=>[primaryKey({columns:[t.userId,t.taskId]}),check('followup_hidden_pending_version',sql`${t.taskVersion}>0`)]);
export const followupWorkGrants = sqliteTable('followup_work_grants', {
 id:text('id').primaryKey().notNull(),taskId:text('task_id').notNull().references(()=>followupTasks.id),userId:text('user_id').notNull().references(()=>portalUsers.userId),grantorMemberId:text('grantor_member_id').notNull().references(()=>members.id),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),revokedAt:text('revoked_at'),
 canRecordActivity:integer('can_record_activity',{mode:'boolean'}).notNull().default(false),
 coverageGrantorMemberId:text('coverage_grantor_member_id').references(()=>members.id),
},t=>[uniqueIndex('followup_work_grants_active_idx').on(t.taskId,t.userId).where(sql`${t.revokedAt} IS NULL`),check('followup_grant_record_activity',sql`${t.canRecordActivity} IN (0,1)`)]);

export const aiTaskTriageCalls = sqliteTable('ai_task_triage_calls', {
 id:text('id').primaryKey().notNull(), actorId:text('actor_id').notNull(), organizationId:text('organization_id').notNull().references(()=>organizations.id),
 taskId:text('task_id').notNull().references(()=>followupTasks.id), taskVersion:integer('task_version').notNull(), configRevision:integer('config_revision').notNull(),
 fingerprint:text('fingerprint').notNull(), admissionNonce:text('admission_nonce').notNull(), status:text('status').notNull(), model:text('model').notNull(),
 reservedTokens:integer('reserved_tokens').notNull(), reservedUsdMicros:integer('reserved_usd_micros').notNull(), inputTokens:integer('input_tokens'),
 proposalJson:text('proposal_json'), day:text('day').notNull(), expiresAt:integer('expires_at').notNull(), createdAt:text('created_at').notNull(),
},t=>[index('ai_task_triage_usage_idx').on(t.organizationId,t.day),check('ai_task_triage_status',sql`${t.status} IN ('reserved','ready','abstained','applied','failed')`)]);

export const followupChecklistSteps = sqliteTable('followup_checklist_steps', {
 id:text('id').primaryKey().notNull(), checklistId:text('checklist_id').notNull().references(()=>followupChecklists.id),
 position:integer('position').notNull(),label:text('label').notNull(),answer:text('answer'),note:text('note').notNull().default(''),
 version:integer('version').notNull().default(1),updatedAt:text('updated_at').notNull(),
},t=>[unique().on(t.checklistId,t.position),check('followup_step_position',sql`${t.position} BETWEEN 0 AND 99`),check('followup_step_label',sql`length(${t.label}) BETWEEN 1 AND 160`),check('followup_step_answer',sql`${t.answer} IS NULL OR ${t.answer} IN ('yes','no','not_applicable')`),check('followup_step_note',sql`length(${t.note})<=600`),check('followup_step_version',sql`${t.version}>0`)]);
