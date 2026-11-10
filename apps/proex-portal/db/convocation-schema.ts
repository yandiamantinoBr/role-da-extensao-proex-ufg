import {index,integer,primaryKey,sqliteTable,text,uniqueIndex} from 'drizzle-orm/sqlite-core';
import {organizations,portalUsers,projects} from './base-schema';
/**
 * Mirrors drizzle/0044_convocations.sql (CHECKs and triggers live only in the SQL migration).
 * A convocation invites people without a portal account (e.g. scholarship students) to confirm attendance
 * through a link; each guest only ever reaches their own answer through a personal edit token.
 */
export const convocations=sqliteTable('convocations',{
 id:text('id').primaryKey().notNull(),organizationId:text('organization_id').notNull().references(()=>organizations.id),
 projectId:text('project_id').notNull().references(()=>projects.id),title:text('title').notNull(),edition:text('edition').notNull().default(''),
 location:text('location').notNull().default(''),eventDate:text('event_date').notNull(),responseDeadline:text('response_deadline'),
 description:text('description').notNull().default(''),purposeNotice:text('purpose_notice').notNull(),retentionDays:integer('retention_days').notNull().default(180),
 status:text('status').notNull().default('open'),version:integer('version').notNull().default(1),createdBy:text('created_by').notNull(),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),purgedAt:text('purged_at'),
},t=>[index('convocations_project_idx').on(t.projectId,t.eventDate),index('convocations_org_idx').on(t.organizationId,t.status,t.eventDate)]);
export const convocationShifts=sqliteTable('convocation_shifts',{
 id:text('id').primaryKey().notNull(),convocationId:text('convocation_id').notNull().references(()=>convocations.id),
 label:text('label').notNull(),startsAt:text('starts_at').notNull(),endsAt:text('ends_at').notNull(),position:integer('position').notNull(),
},t=>[uniqueIndex('convocation_shifts_position_unique').on(t.convocationId,t.position)]);
export const convocationProjects=sqliteTable('convocation_projects',{
 convocationId:text('convocation_id').notNull().references(()=>convocations.id),projectId:text('project_id').notNull().references(()=>projects.id),
},t=>[primaryKey({columns:[t.convocationId,t.projectId]}),index('convocation_projects_project_idx').on(t.projectId)]);
export const convocationResponsibles=sqliteTable('convocation_responsibles',{
 convocationId:text('convocation_id').notNull().references(()=>convocations.id),userId:text('user_id').notNull().references(()=>portalUsers.userId),
 addedBy:text('added_by').notNull(),addedAt:text('added_at').notNull(),
},t=>[primaryKey({columns:[t.convocationId,t.userId]}),index('convocation_responsibles_user_idx').on(t.userId)]);
export const convocationInvites=sqliteTable('convocation_invites',{
 id:text('id').primaryKey().notNull(),convocationId:text('convocation_id').notNull().references(()=>convocations.id),
 tokenHash:text('token_hash').notNull(),label:text('label').notNull().default(''),expiresAt:text('expires_at').notNull(),
 maxUses:integer('max_uses').notNull(),useCount:integer('use_count').notNull().default(0),revokedAt:text('revoked_at'),
 createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('convocation_invites_token_unique').on(t.tokenHash),index('convocation_invites_convocation_idx').on(t.convocationId)]);
export const convocationGuests=sqliteTable('convocation_guests',{
 id:text('id').primaryKey().notNull(),convocationId:text('convocation_id').notNull().references(()=>convocations.id),
 inviteId:text('invite_id').notNull().references(()=>convocationInvites.id),editHash:text('edit_hash').notNull(),
 name:text('name').notNull(),enrollment:text('enrollment').notNull(),projectId:text('project_id').notNull().references(()=>projects.id),
 response:text('response').notNull(),consentAt:text('consent_at').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
 version:integer('version').notNull().default(1),
},t=>[uniqueIndex('convocation_guests_edit_unique').on(t.editHash),index('convocation_guests_convocation_idx').on(t.convocationId,t.projectId)]);
export const convocationGuestShifts=sqliteTable('convocation_guest_shifts',{
 guestId:text('guest_id').notNull().references(()=>convocationGuests.id),shiftId:text('shift_id').notNull().references(()=>convocationShifts.id),
},t=>[primaryKey({columns:[t.guestId,t.shiftId]})]);
export const convocationEvents=sqliteTable('convocation_events',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),id:text('id').notNull().unique(),
 convocationId:text('convocation_id').notNull().references(()=>convocations.id),kind:text('kind').notNull(),
 guestId:text('guest_id'),projectId:text('project_id'),actorId:text('actor_id'),details:text('details').notNull().default('{}'),createdAt:text('created_at').notNull(),
},t=>[index('convocation_events_convocation_idx').on(t.convocationId,t.sequence)]);
export const convocationReceipts=sqliteTable('convocation_receipts',{
 userId:text('user_id').notNull().references(()=>portalUsers.userId),convocationId:text('convocation_id').notNull().references(()=>convocations.id),
 seenSequence:integer('seen_sequence').notNull().default(0),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.userId,t.convocationId]})]);
export const convocationNotificationPreferences=sqliteTable('convocation_notification_preferences',{
 userId:text('user_id').notNull().references(()=>portalUsers.userId),kind:text('kind').notNull(),channel:text('channel').notNull(),
 enabled:integer('enabled').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.userId,t.kind,t.channel]})]);
export const convocationEmailQueue=sqliteTable('convocation_email_queue',{
 id:text('id').primaryKey().notNull(),noticeKey:text('notice_key').notNull(),convocationId:text('convocation_id').notNull().references(()=>convocations.id),
 organizationId:text('organization_id').notNull().references(()=>organizations.id),userId:text('user_id').notNull().references(()=>portalUsers.userId),
 kind:text('kind').notNull(),status:text('status').notNull().default('queued'),claimHash:text('claim_hash'),claimNonce:text('claim_nonce'),
 claimExpiresAt:integer('claim_expires_at'),dispatcherId:text('dispatcher_id'),credentialHash:text('credential_hash'),configurationVersion:integer('configuration_version'),
 sendNonce:text('send_nonce'),acceptanceHash:text('acceptance_hash'),sendingAt:text('sending_at'),acceptedAt:text('accepted_at'),reconciledAt:text('reconciled_at'),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('convocation_email_queue_notice_unique').on(t.noticeKey),index('convocation_email_queue_dispatch_idx').on(t.organizationId,t.status,t.createdAt,t.id)]);
