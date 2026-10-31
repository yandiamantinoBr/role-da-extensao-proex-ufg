import {sql} from 'drizzle-orm';
import {check,index,integer,sqliteTable,text} from 'drizzle-orm/sqlite-core';
import {organizations,projects} from './base-schema';
// Reexport/snapshot integration is coordinated after 0016; no circular schema import.
export const aiDocumentCalls=sqliteTable('ai_document_calls',{
 id:text('id').primaryKey().notNull(),organizationId:text('organization_id').notNull().references(()=>organizations.id),actorId:text('actor_id').notNull(),projectId:text('project_id').references(()=>projects.id),kind:text('kind').notNull(),sourceDigest:text('source_digest').notNull(),configRevision:integer('config_revision').notNull(),fingerprint:text('fingerprint').notNull(),admissionNonce:text('admission_nonce').notNull(),status:text('status').notNull(),day:text('day').notNull(),createdAt:text('created_at').notNull(),expiresAt:integer('expires_at').notNull(),resultCiphertext:text('result_ciphertext'),resultDigest:text('result_digest'),
},t=>[index('ai_document_calls_org_actor_idx').on(t.organizationId,t.actorId,t.expiresAt),check('ai_document_kind',sql`${t.kind} IN ('project','asset')`),check('ai_document_config_revision',sql`${t.configRevision}>0`),check('ai_document_status',sql`${t.status} IN ('reserved','complete','failed')`),check('ai_document_target',sql`${t.projectId} IS NOT NULL OR ${t.kind}='project'`)]);
