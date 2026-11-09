import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { portalUsers } from './base-schema';
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
