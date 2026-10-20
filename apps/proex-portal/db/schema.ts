import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';

// The schema has no production seed data. All quantities begin at zero.
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), name: text('name').notNull(),
  description: text('description').notNull().default(''), createdAt: text('created_at').notNull(),
});
export const members = sqliteTable('members', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), email: text('email').notNull(),
  role: text('role').notNull(), projectId: text('project_id').references(() => projects.id),
  revokedAt: text('revoked_at'), createdAt: text('created_at').notNull(),
}, t => [
  index('members_user_active_idx').on(t.userId, t.revokedAt),
  index('members_project_idx').on(t.projectId),
  check('members_role_check', sql`${t.role} IN ('owner','manager','operator','inventory','loans','viewer')`),
  check('members_owner_scope_check', sql`${t.role} != 'owner' OR ${t.projectId} IS NULL`),
]);
export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(), tokenHash: text('token_hash').notNull(), email: text('email').notNull(),
  role: text('role').notNull(), projectId: text('project_id').references(() => projects.id),
  createdBy: text('created_by').notNull(), expiresAt: text('expires_at').notNull(),
  acceptedBy: text('accepted_by'), acceptedAt: text('accepted_at'), revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('invites_token_hash_unique').on(t.tokenHash),
  index('invites_email_idx').on(t.email),
  check('invites_role_check', sql`${t.role} IN ('manager','operator','inventory','loans','viewer')`),
  check('invites_accepted_pair_check', sql`(${t.acceptedAt} IS NULL) = (${t.acceptedBy} IS NULL)`),
]);
export const items = sqliteTable('items', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(), category: text('category').notNull(), unit: text('unit').notNull(),
  stock: integer('stock').notNull().default(0), reserved: integer('reserved').notNull().default(0),
  lowStock: integer('low_stock').notNull().default(0), description: text('description').notNull().default(''),
  condition: text('condition').notNull().default('active'), createdAt: text('created_at').notNull(),
}, t => [
  index('items_project_idx').on(t.projectId),
  check('items_category_check', sql`${t.category} IN ('gift','equipment','distribution','consumption')`),
  check('items_condition_check', sql`${t.condition} IN ('active','maintenance','inactive')`),
  check('items_quantities_check', sql`${t.stock} >= 0 AND ${t.reserved} >= 0 AND ${t.reserved} <= ${t.stock} AND ${t.lowStock} >= 0`),
  check('items_equipment_single_check', sql`${t.category} != 'equipment' OR ${t.stock} <= 1`),
]);
export const offers = sqliteTable('offers', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(), kind: text('kind').notNull(), active: integer('active').notNull().default(1),
}, t => [
  index('offers_project_idx').on(t.projectId),
  check('offers_kind_check', sql`${t.kind} IN ('brinde','super')`),
  check('offers_active_check', sql`${t.active} IN (0,1)`),
]);
export const offerComponents = sqliteTable('offer_components', {
  offerId: text('offer_id').notNull().references(() => offers.id),
  itemId: text('item_id').notNull().references(() => items.id), quantity: integer('quantity').notNull(),
}, t => [
  uniqueIndex('offer_components_unique').on(t.offerId, t.itemId),
  check('offer_components_quantity_check', sql`${t.quantity} > 0`),
]);
export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(), location: text('location').notNull().default(''),
  startsAt: text('starts_at').notNull(), endsAt: text('ends_at').notNull(),
  status: text('status').notNull().default('draft'), retryLimit: integer('retry_limit'),
  brindeOfferId: text('brinde_offer_id').references(() => offers.id),
  superOfferId: text('super_offer_id').references(() => offers.id),
  rulesText: text('rules_text').notNull().default(''), version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
}, t => [
  index('campaigns_project_idx').on(t.projectId),
  check('campaigns_status_check', sql`${t.status} IN ('draft','active','paused','closed')`),
  check('campaigns_retry_check', sql`${t.retryLimit} IS NULL OR ${t.retryLimit} BETWEEN 0 AND 3`),
  check('campaigns_version_check', sql`${t.version} > 0`),
]);
export const participations = sqliteTable('participations', {
  id: text('id').primaryKey(), campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  identityId: text('identity_id').notNull(), identityMethod: text('identity_method').notNull(),
  modality: text('modality').notNull(), attemptCount: integer('attempt_count').notNull().default(0),
  state: text('state').notNull(), createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('participations_campaign_identity_unique').on(t.campaignId, t.identityId),
  check('participations_identity_method_check', sql`${t.identityMethod} IN ('account','ticket')`),
  check('participations_modality_check', sql`${t.modality} IN ('wheel','dice','physical')`),
  check('participations_attempt_count_check', sql`${t.attemptCount} >= 0`),
]);
export const attempts = sqliteTable('attempts', {
  id: text('id').primaryKey(), participationId: text('participation_id').notNull().references(() => participations.id),
  number: integer('number').notNull(), idempotencyKey: text('idempotency_key').notNull(),
  result: text('result').notNull(), state: text('state').notNull(), createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('attempts_participation_number_unique').on(t.participationId, t.number),
  uniqueIndex('attempts_idempotency_unique').on(t.idempotencyKey),
  check('attempts_number_check', sql`${t.number} > 0`),
]);
export const reservations = sqliteTable('reservations', {
  id: text('id').primaryKey(), participationId: text('participation_id').notNull().references(() => participations.id),
  attemptId: text('attempt_id').notNull().references(() => attempts.id),
  offerId: text('offer_id').notNull().references(() => offers.id),
  itemId: text('item_id').notNull().references(() => items.id), quantity: integer('quantity').notNull(),
  state: text('state').notNull(),
}, t => [
  uniqueIndex('reservations_attempt_offer_item_unique').on(t.attemptId, t.offerId, t.itemId),
  index('reservations_item_state_idx').on(t.itemId, t.state),
  check('reservations_quantity_check', sql`${t.quantity} > 0`),
  check('reservations_state_check', sql`${t.state} IN ('held','released','consumed')`),
]);
export const entitlements = sqliteTable('entitlements', {
  id: text('id').primaryKey(), attemptId: text('attempt_id').notNull().references(() => attempts.id),
  participationId: text('participation_id').notNull().references(() => participations.id),
  offerId: text('offer_id').notNull().references(() => offers.id), state: text('state').notNull(),
  createdAt: text('created_at').notNull(), deliveredAt: text('delivered_at'), deliveredBy: text('delivered_by'),
}, t => [
  uniqueIndex('entitlements_attempt_unique').on(t.attemptId),
  check('entitlements_state_check', sql`${t.state} IN ('reserved','delivered','cancelled')`),
]);
export const stockMovements = sqliteTable('stock_movements', {
  id: text('id').primaryKey(), itemId: text('item_id').notNull().references(() => items.id),
  delta: integer('delta').notNull(), kind: text('kind').notNull(), note: text('note').notNull(),
  refId: text('ref_id'), actorId: text('actor_id').notNull(), createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('stock_movements_ref_unique').on(t.refId),
  index('stock_movements_item_idx').on(t.itemId, t.createdAt),
  check('stock_movements_delta_check', sql`${t.delta} != 0`),
  check('stock_movements_kind_check', sql`${t.kind} IN ('receive','distribute','consume','adjust','redeem','transfer')`),
]);
export const loans = sqliteTable('loans', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  itemId: text('item_id').notNull().references(() => items.id), actionName: text('action_name').notNull(),
  borrowerName: text('borrower_name').notNull(), borrowerContact: text('borrower_contact').notNull().default(''),
  startsAt: integer('starts_at').notNull(), endsAt: integer('ends_at').notNull(),
  status: text('status').notNull().default('reserved'), note: text('note').notNull().default(''),
  conditionOut: text('condition_out').notNull().default(''), conditionIn: text('condition_in').notNull().default(''),
  createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(), returnedAt: text('returned_at'),
}, t => [
  index('loans_item_interval_idx').on(t.itemId, t.status, t.startsAt, t.endsAt),
  index('loans_project_idx').on(t.projectId),
  check('loans_interval_check', sql`${t.endsAt} > ${t.startsAt}`),
  check('loans_status_check', sql`${t.status} IN ('reserved','out','returned','cancelled')`),
]);
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(), loanId: text('loan_id').notNull().references(() => loans.id),
  projectId: text('project_id').notNull().references(() => projects.id), objectKey: text('object_key').notNull(),
  name: text('name').notNull(), mime: text('mime').notNull(), size: integer('size').notNull(),
  createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('documents_object_key_unique').on(t.objectKey), check('documents_size_check', sql`${t.size} > 0`)]);
export const audit = sqliteTable('audit', {
  id: text('id').primaryKey(), actorId: text('actor_id').notNull(),
  projectId: text('project_id').references(() => projects.id), action: text('action').notNull(),
  entityId: text('entity_id').notNull(), details: text('details').notNull().default('{}'), createdAt: text('created_at').notNull(),
}, t => [index('audit_project_created_idx').on(t.projectId, t.createdAt)]);
export const settings = sqliteTable('settings', {
  name: text('name').primaryKey(), value: text('value').notNull(), updatedAt: text('updated_at').notNull(),
});
export const visits = sqliteTable('visits', {
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  day: text('day').notNull(), hits: integer('hits').notNull().default(0),
}, t => [uniqueIndex('visits_campaign_day_unique').on(t.campaignId, t.day), check('visits_hits_check', sql`${t.hits} >= 0`)]);
