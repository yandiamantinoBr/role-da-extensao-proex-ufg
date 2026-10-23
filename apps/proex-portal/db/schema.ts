import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, check, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// The schema has no production seed data. All quantities begin at zero.
export const projectTypes = sqliteTable('project_types', {
  id: text('id').primaryKey(), key: text('key').notNull(), label: text('label').notNull(),
  description: text('description').notNull().default(''), status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('project_types_key_unique').on(t.key), check('project_types_status_check', sql`${t.status} IN ('active','archived')`)]);
export const organizationalUnits = sqliteTable('organizational_units', {
  id: text('id').primaryKey(), name: text('name').notNull(), acronym: text('acronym').notNull().default(''),
  kind: text('kind').notNull(), status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [
  index('organizational_units_status_name_idx').on(t.status, t.name),
  check('organizational_units_kind_check', sql`${t.kind} IN ('proex','academic','agency','external')`),
  check('organizational_units_status_check', sql`${t.status} IN ('active','archived')`),
  check('organizational_units_version_check', sql`${t.version} > 0`),
]);
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), name: text('name').notNull(),
  description: text('description').notNull().default(''), createdAt: text('created_at').notNull(),
  shortName: text('short_name').notNull().default(''), status: text('status').notNull().default('active'),
  color: text('color').notNull().default('#54216C'), officialUrl: text('official_url').notNull().default(''),
  startsAt: text('starts_at'), endsAt: text('ends_at'), location: text('location').notNull().default(''),
  version: integer('version').notNull().default(1),
  lifecycle: text('lifecycle').notNull().default('active'),
  typeId: text('type_id').references(() => projectTypes.id),
  parentId: text('parent_id').references((): AnySQLiteColumn => projects.id),
  unitId: text('unit_id').references(() => organizationalUnits.id), prizesEnabled: integer('prizes_enabled').notNull().default(0),
}, t => [
  index('projects_parent_idx').on(t.parentId), index('projects_unit_idx').on(t.unitId),
  check('projects_prizes_enabled_check', sql`${t.prizesEnabled} IN (0,1)`),
  check('projects_status_check', sql`${t.status} IN ('active','archived')`),
  check('projects_lifecycle_check', sql`${t.lifecycle} IN ('active','past','catalog')`),
  check('projects_version_check', sql`${t.version} > 0`),
  check('projects_interval_check', sql`${t.startsAt} IS NULL OR ${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
]);
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
export const materialCategories = sqliteTable('material_categories', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  label: text('label').notNull(), labelKey: text('label_key').notNull(), coreKind: text('core_kind').notNull(),
  description: text('description').notNull().default(''), status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('material_categories_label_unique').on(t.projectId, t.labelKey),
  index('material_categories_project_status_idx').on(t.projectId, t.status),
  check('material_categories_core_kind_check', sql`${t.coreKind} IN ('gift','equipment','distribution','consumption')`),
  check('material_categories_status_check', sql`${t.status} IN ('active','archived')`),
  check('material_categories_version_check', sql`${t.version} > 0`),
]);
export const items = sqliteTable('items', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(), category: text('category').notNull(), unit: text('unit').notNull(),
  stock: integer('stock').notNull().default(0), reserved: integer('reserved').notNull().default(0),
  lowStock: integer('low_stock').notNull().default(0), description: text('description').notNull().default(''),
  condition: text('condition').notNull().default('active'), createdAt: text('created_at').notNull(),
  assetCode: text('asset_code').notNull().default(''), version: integer('version').notNull().default(1),
  updatedAt: text('updated_at').notNull().default(''),
  categoryId: text('category_id').references(() => materialCategories.id),
}, t => [
  index('items_project_idx').on(t.projectId),
  uniqueIndex('items_asset_code_unique').on(t.projectId, t.assetCode).where(sql`${t.assetCode} != ''`),
  check('items_version_check', sql`${t.version} > 0`),
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
export const activityGroups = sqliteTable('activity_groups', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  title: text('title').notNull(), occurredAt: text('occurred_at').notNull(), kind: text('kind').notNull(),
  note: text('note').notNull().default(''), createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('activity_groups_project_occurred_idx').on(t.projectId, t.occurredAt), check('activity_groups_kind_check', sql`${t.kind} IN ('donation','loan','mixed')`)]);
export const stockMovements = sqliteTable('stock_movements', {
  id: text('id').primaryKey(), itemId: text('item_id').notNull().references(() => items.id),
  delta: integer('delta').notNull(), kind: text('kind').notNull(), note: text('note').notNull(),
  refId: text('ref_id'), actorId: text('actor_id').notNull(), createdAt: text('created_at').notNull(),
  groupId: text('group_id').references(() => activityGroups.id),
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
  checkedOutAt: text('checked_out_at'), updatedAt: text('updated_at').notNull().default(''),
  groupId: text('group_id').references(() => activityGroups.id),
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
  operationKey: text('operation_key'), contentHash: text('content_hash'),
}, t => [
  uniqueIndex('documents_object_key_unique').on(t.objectKey),
  uniqueIndex('documents_operation_key_unique').on(t.operationKey),
  check('documents_size_check', sql`${t.size} > 0`),
]);
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


// Canonical application identities remain separate from any authentication provider's tables.
export const portalUsers = sqliteTable('portal_users', {
  userId: text('user_id').primaryKey(), email: text('email'),
  status: text('status').notNull().default('active'), anonymizedAt: text('anonymized_at'), activationPending: integer('activation_pending').notNull().default(0), createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [check('portal_users_status_check', sql`${t.status} IN ('active','blocked')`)]);
export const profiles = sqliteTable('profiles', {
  userId: text('user_id').primaryKey(), displayName: text('display_name').notNull(),
  avatarKey: text('avatar_key'), mime: text('mime'),
  unitId: text('unit_id').references(() => organizationalUnits.id), affiliation: text('affiliation').notNull().default(''),
  registrationType: text('registration_type').notNull().default(''), registrationNumber: text('registration_number').notNull().default(''),
  unit: text('unit').notNull().default(''), jobTitle: text('job_title').notNull().default(''), phone: text('phone').notNull().default(''), version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [
  index('profiles_unit_idx').on(t.unitId),
  check('profiles_version_check', sql`${t.version} > 0`),
  check('profiles_affiliation_check', sql`${t.affiliation} IN ('','student','technical','faculty','scholar','intern','collaborator','other')`),
  check('profiles_registration_type_check', sql`${t.registrationType} IN ('','siape','student','other')`),
]);
export const identityAliases = sqliteTable('identity_aliases', {
  provider: text('provider').notNull(), subject: text('subject').notNull(),
  userId: text('user_id').notNull(), createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('identity_aliases_provider_subject_unique').on(t.provider, t.subject),
  index('identity_aliases_user_idx').on(t.userId),
]);
export const calendarFeeds = sqliteTable('calendar_feeds', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), tokenHash: text('token_hash').notNull(),
  category: text('category').notNull(), projectId: text('project_id').references(() => projects.id),
  expiresAt: text('expires_at').notNull(), revokedAt: text('revoked_at'), createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('calendar_feeds_token_hash_unique').on(t.tokenHash),
  index('calendar_feeds_owner_idx').on(t.ownerId, t.revokedAt),
]);
export const records = sqliteTable('records', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  kind: text('kind').notNull(), title: text('title').notNull(), body: text('body').notNull().default(''),
  occurredAt: text('occurred_at').notNull(), startsAt: text('starts_at'), endsAt: text('ends_at'),
  itemId: text('item_id').references(() => items.id), loanId: text('loan_id').references(() => loans.id),
  groupId: text('group_id').references(() => activityGroups.id),
  createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(),
}, t => [
  index('records_project_occurred_idx').on(t.projectId, t.occurredAt),
  index('records_loan_idx').on(t.loanId),
  index('records_item_idx').on(t.itemId),
  check('records_interval_check', sql`${t.startsAt} IS NULL OR ${t.endsAt} IS NULL OR ${t.endsAt} >= ${t.startsAt}`),
]);
export const recordAttachments = sqliteTable('record_attachments', {
  id: text('id').primaryKey(), recordId: text('record_id').notNull().references(() => records.id),
  projectId: text('project_id').notNull().references(() => projects.id), objectKey: text('object_key').notNull(),
  name: text('name').notNull(), mime: text('mime').notNull(), size: integer('size').notNull(),
  operationKey: text('operation_key').notNull(), createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  caption: text('caption').notNull().default(''), attachmentRole: text('attachment_role').notNull().default('photo'),
  displayOrder: integer('display_order').notNull().default(0), deletedAt: text('deleted_at'),
}, t => [
  uniqueIndex('record_attachments_object_key_unique').on(t.objectKey),
  uniqueIndex('record_attachments_operation_key_unique').on(t.operationKey),
  index('record_attachments_record_idx').on(t.recordId),
  check('record_attachments_size_check', sql`${t.size} > 0`),
]);
export const mutationKeys = sqliteTable('mutation_keys', {
  scope: text('scope').primaryKey(), fingerprint: text('fingerprint').notNull(),
  entityId: text('entity_id').notNull(), createdAt: text('created_at').notNull(),
});
export const portalRateLimits = sqliteTable('portal_rate_limits', {
  bucketKey: text('bucket_key').primaryKey(), count: integer('count').notNull().default(0),
  resetAt: integer('reset_at').notNull(),
}, t => [check('portal_rate_limits_count_check', sql`${t.count} >= 0`)]);

export * from './auth-schema';


export const calls = sqliteTable('calls', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  title: text('title').notNull(), referenceCode: text('reference_code').notNull().default(''),
  description: text('description').notNull().default(''), status: text('status').notNull().default('draft'),
  opensAt: text('opens_at'), closesAt: text('closes_at'), officialUrl: text('official_url').notNull().default(''),
  version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [index('calls_project_idx').on(t.projectId), check('calls_status_check', sql`${t.status} IN ('draft','open','closed','archived')`)]);
export const projectCalls = sqliteTable('project_calls', {
  callId: text('call_id').notNull().references(() => calls.id), projectId: text('project_id').notNull().references(() => projects.id),
}, t => [uniqueIndex('project_calls_unique').on(t.callId, t.projectId)]);
export const entityVersions = sqliteTable('entity_versions', {
  id: text('id').primaryKey(), entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id), version: integer('version').notNull(),
  snapshotJson: text('snapshot_json').notNull(), actorId: text('actor_id').notNull(), createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('entity_versions_revision_unique').on(t.entityType, t.entityId, t.version),
  index('entity_versions_project_created_idx').on(t.projectId, t.createdAt),
  check('entity_versions_type_check', sql`${t.entityType} IN ('project','item','category','call','project_link','project_schedule_item')`),
]);
export const loginIdentifiers = sqliteTable('login_identifiers', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), kind: text('kind').notNull(),
  lookupHash: text('lookup_hash').notNull(), displayHint: text('display_hint'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('login_identifiers_lookup_unique').on(t.lookupHash),
  uniqueIndex('login_identifiers_user_kind_unique').on(t.userId, t.kind),
  index('login_identifiers_user_idx').on(t.userId),
  check('login_identifiers_kind_check', sql`${t.kind} IN ('username','cpf')`),
]);
export const privacyRequests = sqliteTable('privacy_requests', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), status: text('status').notNull(),
  requestedAt: text('requested_at').notNull(), reviewedBy: text('reviewed_by'), reviewedAt: text('reviewed_at'),
  completedAt: text('completed_at'), reason: text('reason').notNull().default('account_anonymization'),
}, t => [index('privacy_requests_user_idx').on(t.userId), check('privacy_requests_status_check', sql`${t.status} IN ('pending','cleanup_pending','completed','rejected')`)]);
export const privateObjectDeletions = sqliteTable('private_object_deletions', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), objectKey: text('object_key'), mime: text('mime'),
  createdAt: text('created_at').notNull(), deletedAt: text('deleted_at'),
}, t => [index('private_object_deletions_user_idx').on(t.userId)]);

export const projectLinks = sqliteTable('project_links', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  label: text('label').notNull(), url: text('url').notNull(), kind: text('kind').notNull(),
  version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [index('project_links_project_idx').on(t.projectId), check('project_links_kind_check', sql`${t.kind} IN ('official','notice','report','gallery','other')`)]);
export const projectScheduleItems = sqliteTable('project_schedule_items', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  title: text('title').notNull(), startsAt: text('starts_at').notNull(), endsAt: text('ends_at').notNull(),
  status: text('status').notNull().default('planned'), note: text('note').notNull().default(''), url: text('url').notNull().default(''),
  version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [
  index('project_schedule_project_start_idx').on(t.projectId, t.startsAt),
  check('project_schedule_status_check', sql`${t.status} IN ('planned','completed','cancelled')`),
  check('project_schedule_interval_check', sql`${t.endsAt} >= ${t.startsAt}`),
]);
export const syncConnections = sqliteTable('sync_connections', {
  id: text('id').primaryKey(), provider: text('provider').notNull(), label: text('label').notNull(),
  externalId: text('external_id'), enabled: integer('enabled').notNull().default(0),
  createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [check('sync_connections_provider_check', sql`${t.provider} IN ('google_sheets','excel')`), check('sync_connections_enabled_check', sql`${t.enabled} IN (0,1)`)]);
export const syncRuns = sqliteTable('sync_runs', {
  id: text('id').primaryKey(), connectionId: text('connection_id').references(() => syncConnections.id),
  status: text('status').notNull(), direction: text('direction').notNull(), startedBy: text('started_by').notNull(),
  startedAt: text('started_at').notNull(), finishedAt: text('finished_at'),
  exportedCount: integer('exported_count').notNull().default(0), appliedCount: integer('applied_count').notNull().default(0),
  conflictCount: integer('conflict_count').notNull().default(0), errorCode: text('error_code'),
}, t => [check('sync_runs_status_check', sql`${t.status} IN ('running','completed','conflict','failed')`), check('sync_runs_direction_check', sql`${t.direction} IN ('export','import','bidirectional')`)]);
export const syncReceipts = sqliteTable('sync_receipts', {
  operationKey: text('operation_key').primaryKey(), fingerprint: text('fingerprint').notNull(), entityId: text('entity_id'),
  resultJson: text('result_json').notNull(), createdAt: text('created_at').notNull(),
});
export const syncConflicts = sqliteTable('sync_conflicts', {
  id: text('id').primaryKey(), connectionId: text('connection_id').references(() => syncConnections.id), runId: text('run_id').references(() => syncRuns.id),
  operationKey: text('operation_key').notNull(), entityType: text('entity_type').notNull(), entityId: text('entity_id'),
  expectedVersion: integer('expected_version'), actualVersion: integer('actual_version'), reason: text('reason').notNull(),
  status: text('status').notNull().default('open'), createdAt: text('created_at').notNull(), resolvedAt: text('resolved_at'),
}, t => [index('sync_conflicts_run_idx').on(t.runId), check('sync_conflicts_status_check', sql`${t.status} IN ('open','resolved')`)]);
export const syncAttachmentTickets = sqliteTable('sync_attachment_tickets', {
  tokenHash: text('token_hash').primaryKey(), ownerId: text('owner_id').notNull(),
  attachmentKind: text('attachment_kind').notNull(), attachmentId: text('attachment_id').notNull(),
  expiresAt: text('expires_at').notNull(), usedAt: text('used_at'), createdAt: text('created_at').notNull(),
}, t => [check('sync_attachment_tickets_kind_check', sql`${t.attachmentKind} IN ('record','loan','avatar')`)]);
export const syncAttachmentExports = sqliteTable('sync_attachment_exports', {
  id: text('id').primaryKey(), attachmentKind: text('attachment_kind').notNull(), attachmentId: text('attachment_id').notNull(),
  driveFileId: text('drive_file_id').notNull(), driveUrl: text('drive_url').notNull(), contentHash: text('content_hash').notNull(),
  size: integer('size').notNull(), exportedAt: text('exported_at').notNull(), deletedAt: text('deleted_at'),
}, t => [
  uniqueIndex('sync_attachment_exports_attachment_unique').on(t.attachmentKind, t.attachmentId),
  check('sync_attachment_exports_kind_check', sql`${t.attachmentKind} IN ('record','loan','avatar')`),
  check('sync_attachment_exports_size_check', sql`${t.size} > 0`),
]);
