import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizations, portalUsers, projects } from './base-schema';
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
  messageEmail:integer('message_email').notNull().default(1),
  version:integer('version').notNull().default(1), updatedAt:text('updated_at').notNull(),
},t=>[check('community_preferences_badges',sql`${t.badges} IN (0,1)`)]);
export const communityBadges = sqliteTable('community_badges', {
  userId:text('user_id').notNull().references(()=>portalUsers.userId), badge:text('badge').notNull(), week:text('week').notNull(), earnedAt:text('earned_at').notNull(),
},t=>[primaryKey({columns:[t.userId,t.badge,t.week]}),check('community_badges_badge',sql`${t.badge} IN ('closer','helpful','thanks','field')`)]);
/* Phase 3 (0040): chat (project and direct conversations) with images, and optional e-mail notices for direct messages. */
export const chatConversations = sqliteTable('chat_conversations', {
  id:text('id').primaryKey().notNull(), kind:text('kind').notNull(), organizationId:text('organization_id').notNull().references(()=>organizations.id),
  projectId:text('project_id').references(()=>projects.id), userA:text('user_a').references(()=>portalUsers.userId), userB:text('user_b').references(()=>portalUsers.userId),
  createdAt:text('created_at').notNull(), lastMessageAt:text('last_message_at'),
},t=>[uniqueIndex('chat_conversations_project_idx').on(t.projectId).where(sql`${t.kind}='project'`),uniqueIndex('chat_conversations_pair_idx').on(t.organizationId,t.userA,t.userB).where(sql`${t.kind}='direct'`),
  check('chat_conversations_kind',sql`(${t.kind}='project' AND ${t.projectId} IS NOT NULL AND ${t.userA} IS NULL AND ${t.userB} IS NULL) OR (${t.kind}='direct' AND ${t.projectId} IS NULL AND ${t.userA} IS NOT NULL AND ${t.userB} IS NOT NULL AND ${t.userA}<${t.userB})`)]);
export const chatAttachments = sqliteTable('chat_attachments', {
  id:text('id').primaryKey().notNull(), conversationId:text('conversation_id').notNull().references(()=>chatConversations.id), uploaderId:text('uploader_id').notNull().references(()=>portalUsers.userId),
  objectKey:text('object_key').notNull(), mime:text('mime').notNull(), size:integer('size').notNull(), createdAt:text('created_at').notNull(), expiresAt:text('expires_at').notNull(), deletedAt:text('deleted_at'),
},t=>[uniqueIndex('chat_attachments_key_idx').on(t.objectKey),index('chat_attachments_expiry_idx').on(t.deletedAt,t.expiresAt),index('chat_attachments_uploader_idx').on(t.uploaderId,t.createdAt),
  check('chat_attachments_mime',sql`${t.mime} IN ('image/jpeg','image/png','image/webp')`),check('chat_attachments_size',sql`${t.size} BETWEEN 1 AND 1572864`)]);
export const chatMessages = sqliteTable('chat_messages', {
  id:text('id').primaryKey().notNull(), conversationId:text('conversation_id').notNull().references(()=>chatConversations.id), senderId:text('sender_id').notNull().references(()=>portalUsers.userId),
  body:text('body').notNull().default(''), attachmentId:text('attachment_id').references(()=>chatAttachments.id), createdAt:text('created_at').notNull(), deletedAt:text('deleted_at'),
},t=>[index('chat_messages_conversation_idx').on(t.conversationId,t.createdAt),index('chat_messages_sender_idx').on(t.senderId,t.createdAt),
  check('chat_messages_body',sql`length(${t.body})<=2000`)]);
export const chatReads = sqliteTable('chat_reads', {
  conversationId:text('conversation_id').notNull().references(()=>chatConversations.id), userId:text('user_id').notNull().references(()=>portalUsers.userId), lastReadAt:text('last_read_at').notNull(),
},t=>[primaryKey({columns:[t.conversationId,t.userId]})]);
export const communityEmailQueue = sqliteTable('community_email_queue', {
  id:text('id').primaryKey().notNull(), messageId:text('message_id').notNull(), organizationId:text('organization_id').notNull().references(()=>organizations.id), userId:text('user_id').notNull().references(()=>portalUsers.userId),
  status:text('status').notNull().default('queued'), claimHash:text('claim_hash'), claimNonce:text('claim_nonce'), claimExpiresAt:integer('claim_expires_at'), dispatcherId:text('dispatcher_id'), credentialHash:text('credential_hash'),
  configurationVersion:integer('configuration_version'), sendNonce:text('send_nonce'), acceptanceHash:text('acceptance_hash'), sendingAt:text('sending_at'), acceptedAt:text('accepted_at'), reconciledAt:text('reconciled_at'),
  createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('community_email_queue_message_idx').on(t.messageId),index('community_email_queue_dispatch_idx').on(t.organizationId,t.status,t.createdAt,t.id),
  check('community_email_queue_status',sql`${t.status} IN ('queued','claimed','sending','accepted','accepted_attested','uncertain','closed_unconfirmed','cancelled')`)]);
/* Ombuds readers (0040): portal-wide owners/managers by default, plus people designated by the general administration, with dates and reason. */
export const ombudsDesignations = sqliteTable('ombuds_designations', {
  id:text('id').primaryKey().notNull(), userId:text('user_id').notNull().references(()=>portalUsers.userId), designatedBy:text('designated_by').notNull(),
  reason:text('reason').notNull(), startsOn:text('starts_on').notNull(), endsOn:text('ends_on').notNull(), createdAt:text('created_at').notNull(),
  revokedAt:text('revoked_at'), revokedBy:text('revoked_by'), revokeReason:text('revoke_reason'),
},t=>[index('ombuds_designations_user_idx').on(t.userId,t.revokedAt,t.startsOn,t.endsOn),
  check('ombuds_designations_reason',sql`length(${t.reason}) BETWEEN 3 AND 300`),check('ombuds_designations_dates',sql`${t.endsOn}>=${t.startsOn}`),
  check('ombuds_designations_revoke',sql`(${t.revokedAt} IS NULL AND ${t.revokedBy} IS NULL AND ${t.revokeReason} IS NULL) OR (${t.revokedAt} IS NOT NULL AND ${t.revokedBy} IS NOT NULL AND length(${t.revokeReason}) BETWEEN 3 AND 300)`)]);
