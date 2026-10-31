import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { organizations, portalUsers } from './base-schema';
import { followupNotifications, followupTasks } from './follow-up-schema';

// Internal dispatch state. Full encrypted backup includes it; Sheets and portable
// projections never expose credentials, preferences or recipient queues.
export const followupEmailDispatchTokens = sqliteTable('followup_email_dispatch_tokens', {
  id: text('id'), organizationId: text('organization_id').notNull().references(() => organizations.id),
  userId: text('user_id').notNull().references(() => portalUsers.userId), tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull(), createdAt: text('created_at').notNull(), expiresAt: text('expires_at').notNull(), revokedAt: text('revoked_at'),
}, t => [primaryKey({ columns: [t.id] })]);

export const followupEmailConfiguration = sqliteTable('followup_email_configuration', {
  organizationId: text('organization_id').references(() => organizations.id), version: integer('version').notNull().default(1),
  enabled: integer('enabled').notNull().default(0), senderEmail: text('sender_email').notNull(), portalOrigin: text('portal_origin').notNull(),
  dailyLimit: integer('daily_limit').notNull().default(50), personDailyLimit: integer('person_daily_limit').notNull().default(3),
  eventLimit: integer('event_limit').notNull().default(100), intervalSeconds: integer('interval_seconds').notNull().default(300),
  nextSendAt: integer('next_send_at').notNull().default(0), updatedBy: text('updated_by').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.organizationId] }),
  check('followup_email_enabled_check', sql`${t.enabled} IN (0,1)`),
  check('followup_email_daily_limit_check', sql`${t.dailyLimit} BETWEEN 1 AND 500`),
  check('followup_email_person_limit_check', sql`${t.personDailyLimit} BETWEEN 1 AND 10`),
  check('followup_email_event_limit_check', sql`${t.eventLimit} BETWEEN 1 AND 500`),
  check('followup_email_interval_check', sql`${t.intervalSeconds} BETWEEN 60 AND 3600`),
]);

export const followupEmailPreferences = sqliteTable('followup_email_preferences', {
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  userId: text('user_id').notNull().references(() => portalUsers.userId), enabled: integer('enabled').notNull().default(0),
  consentEmail: text('consent_email').notNull(), enabledAt: text('enabled_at'), updatedAt: text('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.organizationId, t.userId] }), check('followup_email_preference_check', sql`${t.enabled} IN (0,1)`)]);

export const followupEmailQueue = sqliteTable('followup_email_queue', {
  id: text('id'), notificationId: text('notification_id').notNull().unique().references(() => followupNotifications.id),
  organizationId: text('organization_id').notNull().references(() => organizations.id), taskId: text('task_id').notNull().references(() => followupTasks.id),
  userId: text('user_id').notNull().references(() => portalUsers.userId), eventKey: text('event_key').notNull(),
  status: text('status').notNull().default('queued'), claimHash: text('claim_hash'), claimNonce: text('claim_nonce'),
  claimExpiresAt: integer('claim_expires_at'), dispatcherId: text('dispatcher_id'), credentialHash: text('credential_hash'),
  configurationVersion: integer('configuration_version'), sendNonce: text('send_nonce'), acceptanceHash: text('acceptance_hash'),
  sendingAt: text('sending_at'), acceptedAt: text('accepted_at'), reconciledAt: text('reconciled_at'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.id] }), unique().on(t.taskId, t.userId, t.eventKey),
  index('followup_email_queue_dispatch_idx').on(t.organizationId, t.status, t.createdAt, t.id),
  check('followup_email_queue_status_check', sql`${t.status} IN ('queued','claimed','sending','accepted','accepted_attested','uncertain','closed_unconfirmed','cancelled')`),
]);

export const followupEmailUsage = sqliteTable('followup_email_usage', {
  organizationId: text('organization_id').notNull().references(() => organizations.id), day: text('day').notNull(),
  bucket: text('bucket').notNull(), reserved: integer('reserved').notNull().default(0),
}, t => [primaryKey({ columns: [t.organizationId, t.day, t.bucket] })]);

export const followupEmailDispatchState = sqliteTable('followup_email_dispatch_state', {
  organizationId: text('organization_id').references(() => organizations.id), lastAttemptAt: text('last_attempt_at'),
  lastAcceptedAt: text('last_accepted_at'), remainingQuota: integer('remaining_quota'),
  lastOutcome: text('last_outcome').notNull().default('not_started'), updatedAt: text('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.organizationId] })]);
