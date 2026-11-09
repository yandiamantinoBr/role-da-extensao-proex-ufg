import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizations, portalUsers } from './base-schema';
/*
 * Community layer (0036). Personal widgets are private to their owner (no management view).
 * The ombuds tables intentionally have NO author column and keep only civil days, never instants:
 * see docs/COMUNIDADE.md. In SQL they are WITHOUT ROWID so physical order does not reveal arrival order.
 */
export const personalWidgetSettings = sqliteTable('personal_widget_settings', {
  userId:text('user_id').primaryKey().notNull().references(()=>portalUsers.userId),
  notes:integer('notes').notNull().default(0), reminders:integer('reminders').notNull().default(0), roleShortcut:integer('role_shortcut').notNull().default(0),
  version:integer('version').notNull().default(1), updatedAt:text('updated_at').notNull(),
},t=>[check('personal_widget_flags',sql`${t.notes} IN (0,1) AND ${t.reminders} IN (0,1) AND ${t.roleShortcut} IN (0,1)`)]);
export const personalNotes = sqliteTable('personal_notes', {
  id:text('id').primaryKey().notNull(), userId:text('user_id').notNull().references(()=>portalUsers.userId),
  kind:text('kind').notNull(), body:text('body').notNull(), dueOn:text('due_on'), dueTime:text('due_time'), doneAt:text('done_at'),
  version:integer('version').notNull().default(1), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[index('personal_notes_owner_idx').on(t.userId,t.kind,t.doneAt,t.dueOn),
  check('personal_notes_kind',sql`${t.kind} IN ('note','reminder')`),check('personal_notes_body',sql`length(${t.body}) BETWEEN 1 AND 500`)]);
export const ombudsReports = sqliteTable('ombuds_reports', {
  id:text('id').primaryKey().notNull(), codeHash:text('code_hash').notNull(), category:text('category').notNull(),
  status:text('status').notNull().default('received'), receivedOn:text('received_on').notNull(), updatedOn:text('updated_on').notNull(),
  version:integer('version').notNull().default(1),
},t=>[uniqueIndex('ombuds_reports_code_idx').on(t.codeHash),index('ombuds_reports_status_idx').on(t.status,t.receivedOn),
  check('ombuds_reports_category',sql`${t.category} IN ('conduct','workload','environment','process','platform','other')`),
  check('ombuds_reports_status',sql`${t.status} IN ('received','reviewing','answered','closed')`)]);
export const ombudsMessages = sqliteTable('ombuds_messages', {
  id:text('id').primaryKey().notNull(), reportId:text('report_id').notNull().references(()=>ombudsReports.id),
  side:text('side').notNull(), body:text('body').notNull(), sentOn:text('sent_on').notNull(), seq:integer('seq').notNull(),
},t=>[uniqueIndex('ombuds_messages_seq_idx').on(t.reportId,t.seq),
  check('ombuds_messages_side',sql`${t.side} IN ('reporter','ombuds')`),check('ombuds_messages_body',sql`length(${t.body}) BETWEEN 1 AND 4000`)]);
/* Phase 2 (0037): direct messages between people of the same organization, personal blocks, preferences and badges. */
export const communityMessages = sqliteTable('community_messages', {
  id:text('id').primaryKey().notNull(), organizationId:text('organization_id').notNull().references(()=>organizations.id),
  senderId:text('sender_id').notNull().references(()=>portalUsers.userId), recipientId:text('recipient_id').notNull().references(()=>portalUsers.userId),
  body:text('body').notNull(), createdAt:text('created_at').notNull(), readAt:text('read_at'),
  senderHiddenAt:text('sender_hidden_at'), recipientHiddenAt:text('recipient_hidden_at'),
},t=>[index('community_messages_inbox_idx').on(t.recipientId,t.readAt,t.createdAt),index('community_messages_sent_idx').on(t.senderId,t.createdAt),
  check('community_messages_body',sql`length(${t.body}) BETWEEN 1 AND 1000`),check('community_messages_people',sql`${t.senderId}!=${t.recipientId}`)]);
export const communityBlocks = sqliteTable('community_blocks', {
  userId:text('user_id').notNull().references(()=>portalUsers.userId), blockedId:text('blocked_id').notNull().references(()=>portalUsers.userId), createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.userId,t.blockedId]}),check('community_blocks_people',sql`${t.userId}!=${t.blockedId}`)]);
export const communityPreferences = sqliteTable('community_preferences', {
  userId:text('user_id').primaryKey().notNull().references(()=>portalUsers.userId),
  badges:integer('badges').notNull().default(1), pausedUntil:text('paused_until'), seenLevel:integer('seen_level').notNull().default(1),
  version:integer('version').notNull().default(1), updatedAt:text('updated_at').notNull(),
},t=>[check('community_preferences_badges',sql`${t.badges} IN (0,1)`)]);
export const communityBadges = sqliteTable('community_badges', {
  userId:text('user_id').notNull().references(()=>portalUsers.userId), badge:text('badge').notNull(), week:text('week').notNull(), earnedAt:text('earned_at').notNull(),
},t=>[primaryKey({columns:[t.userId,t.badge,t.week]}),check('community_badges_badge',sql`${t.badge} IN ('closer','helpful','thanks','field')`)]);
