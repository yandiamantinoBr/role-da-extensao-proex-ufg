import {sql} from 'drizzle-orm';
import {check,index,integer,sqliteTable,text,uniqueIndex} from 'drizzle-orm/sqlite-core';
import {items,organizationalUnits,organizations,projects,recordAttachments,records,stockMovements} from './base-schema';
/**
 * Mirrors drizzle/0039_material_movement_revisions.sql. Triggers (scope, immutability and the
 * deletion log required before hiding an attachment) live only in the SQL migration.
 */
export const materialDestinations=sqliteTable('material_destinations',{
 id:text('id').primaryKey().notNull(),organizationId:text('organization_id').notNull().references(()=>organizations.id),
 kind:text('kind').notNull(),name:text('name').notNull(),nameKey:text('name_key').notNull(),
 officialUrl:text('official_url').notNull().default(''),description:text('description').notNull().default(''),
 unitId:text('unit_id').references(()=>organizationalUnits.id),status:text('status').notNull().default('active'),
 version:integer('version').notNull().default(1),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),
 updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[
 uniqueIndex('material_destinations_name_unique').on(t.organizationId,t.nameKey),
 index('material_destinations_org_status_idx').on(t.organizationId,t.status,t.nameKey),
 check('material_destination_kind',sql`${t.kind} IN('event','place','unit','partner','other')`),
 check('material_destination_status',sql`${t.status} IN('active','archived')`),
]);
export const stockMovementDestinations=sqliteTable('stock_movement_destinations',{
 movementId:text('movement_id').primaryKey().notNull().references(()=>stockMovements.id),
 destinationId:text('destination_id').notNull().references(()=>materialDestinations.id),
 projectId:text('project_id').notNull().references(()=>projects.id),createdAt:text('created_at').notNull(),
},t=>[index('stock_movement_destinations_destination_idx').on(t.destinationId,t.createdAt,t.movementId)]);
export const stockMovementRevisions=sqliteTable('stock_movement_revisions',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),id:text('id').notNull().unique(),
 itemId:text('item_id').notNull().references(()=>items.id),projectId:text('project_id').notNull().references(()=>projects.id),
 rootMovementId:text('root_movement_id').notNull().references(()=>stockMovements.id),
 targetMovementId:text('target_movement_id').notNull().unique().references(()=>stockMovements.id),
 kind:text('kind').notNull(),
 reversalMovementId:text('reversal_movement_id').notNull().unique().references(()=>stockMovements.id),
 replacementMovementId:text('replacement_movement_id').unique().references(()=>stockMovements.id),
 reason:text('reason').notNull(),changesJson:text('changes_json').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[
 index('stock_movement_revisions_root_idx').on(t.rootMovementId,t.sequence),
 index('stock_movement_revisions_item_idx').on(t.itemId,t.sequence),
 check('stock_revision_kind',sql`${t.kind} IN('correction','reversal')`),
]);
export const stockMovementRecords=sqliteTable('stock_movement_records',{
 movementId:text('movement_id').primaryKey().notNull().references(()=>stockMovements.id),
 recordId:text('record_id').notNull().unique().references(()=>records.id),
 projectId:text('project_id').notNull().references(()=>projects.id),
 createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),
});
export const recordAttachmentDeletions=sqliteTable('record_attachment_deletions',{
 attachmentId:text('attachment_id').primaryKey().notNull().references(()=>recordAttachments.id),
 projectId:text('project_id').notNull().references(()=>projects.id),
 itemId:text('item_id').references(()=>items.id),movementId:text('movement_id').references(()=>stockMovements.id),
 reason:text('reason').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('record_attachment_deletions_item_idx').on(t.itemId,t.createdAt)]);
