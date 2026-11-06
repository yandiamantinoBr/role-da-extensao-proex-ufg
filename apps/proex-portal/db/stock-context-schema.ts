import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { stockMovements, projects, organizationalUnits } from './base-schema';

/** Runtime 0032 additionally guards scope, active references and immutability. */
export const stockMovementContexts = sqliteTable('stock_movement_contexts', {
 movementId: text('movement_id').primaryKey().notNull().references(() => stockMovements.id),
 projectId: text('project_id').notNull().references(() => projects.id),
 counterpartyUnitId: text('counterparty_unit_id').references(() => organizationalUnits.id),
 counterpartyProjectId: text('counterparty_project_id').references(() => projects.id),
 processReference: text('process_reference').notNull().default(''), beneficiaryReference: text('beneficiary_reference').notNull().default(''),
 occurredAt: text('occurred_at').notNull(), dateSource: text('date_source').notNull(),
 materialName: text('material_name').notNull(), measurementUnit: text('measurement_unit').notNull(), createdAt: text('created_at').notNull(),
}, t => [
 index('stock_context_project_date_idx').on(t.projectId,t.occurredAt,t.movementId),
 index('stock_context_unit_idx').on(t.counterpartyUnitId,t.occurredAt,t.movementId),
 index('stock_context_counterparty_project_idx').on(t.counterpartyProjectId,t.occurredAt,t.movementId),
 check('stock_context_process_length',sql`length(${t.processReference})<=120`),
 check('stock_context_beneficiary_length',sql`length(${t.beneficiaryReference})<=160`),
 check('stock_context_occurred_valid',sql`julianday(${t.occurredAt}) IS NOT NULL`),
 check('stock_context_created_valid',sql`julianday(${t.createdAt}) IS NOT NULL`),
 check('stock_context_date_source',sql`${t.dateSource} IN('registration','declared')`),
 check('stock_context_name_length',sql`length(trim(${t.materialName})) BETWEEN 1 AND 200`),
 check('stock_context_unit_length',sql`length(trim(${t.measurementUnit})) BETWEEN 1 AND 200`),
 check('stock_context_exclusive',sql`${t.counterpartyUnitId} IS NULL OR ${t.counterpartyProjectId} IS NULL`),
 check('stock_context_date_range',sql`julianday(${t.occurredAt})>=julianday('2000-01-01') AND julianday(${t.occurredAt})<julianday('2201-01-01')`),
 check('stock_context_date_future',sql`julianday(${t.occurredAt})<=julianday(${t.createdAt})+5.0/1440`),
]);
