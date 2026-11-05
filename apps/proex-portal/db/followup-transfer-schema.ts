import {sql} from 'drizzle-orm';
import {check,index,integer,sqliteTable,text,unique,uniqueIndex} from 'drizzle-orm/sqlite-core';
import {organizations,portalUsers,projects} from './base-schema';
import {followupTasks} from './follow-up-schema';
/** Mirrors drizzle/0031_followup_task_transfers.sql. Guards and the replaced scope trigger live only in SQL. */
export const followupTaskTransfers=sqliteTable('followup_task_transfers',{
 id:text('id').primaryKey().notNull(),
 taskId:text('task_id').notNull().references(()=>followupTasks.id),
 organizationId:text('organization_id').notNull().references(()=>organizations.id),
 sourceProjectId:text('source_project_id').notNull().references(()=>projects.id),
 destProjectId:text('dest_project_id').notNull().references(()=>projects.id),
 fromVersion:integer('from_version').notNull(),
 toVersion:integer('to_version').notNull(),
 actorId:text('actor_id').notNull().references(()=>portalUsers.userId),
 reason:text('reason').notNull(),
 operationHash:text('operation_hash').notNull(),
 fingerprint:text('fingerprint').notNull(),
 state:text('state').notNull().default('pending'),
 createdAt:text('created_at').notNull(),
 appliedAt:text('applied_at'),
},t=>[
 unique().on(t.actorId,t.operationHash),
 index('followup_task_transfers_task_idx').on(t.taskId,t.createdAt,t.id),
 uniqueIndex('followup_task_transfers_pending_idx').on(t.taskId).where(sql`${t.state}='pending'`),
 check('followup_transfer_id',sql`length(${t.id}) BETWEEN 1 AND 200`),
 check('followup_transfer_from_version',sql`typeof(${t.fromVersion})='integer' AND ${t.fromVersion}>0`),
 check('followup_transfer_to_version',sql`typeof(${t.toVersion})='integer'`),
 check('followup_transfer_reason',sql`length(${t.reason}) BETWEEN 1 AND 500 AND ${t.reason}=trim(${t.reason})`),
 check('followup_transfer_operation',sql`length(${t.operationHash})=64`),
 check('followup_transfer_fingerprint',sql`length(${t.fingerprint})=64`),
 check('followup_transfer_state',sql`${t.state} IN ('pending','applied','void')`),
 check('followup_transfer_distinct',sql`${t.sourceProjectId}<>${t.destProjectId}`),
 check('followup_transfer_step',sql`${t.toVersion}=${t.fromVersion}+1`),
 check('followup_transfer_settled',sql`(${t.state}='pending')=(${t.appliedAt} IS NULL)`),
]);
