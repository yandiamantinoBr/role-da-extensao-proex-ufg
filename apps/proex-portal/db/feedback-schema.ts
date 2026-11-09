import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { campaigns, projects } from './base-schema';
/** Rebuilt by 0036_community: praise, event (campaign) target and a written reply from management. */
export const portalFeedback = sqliteTable('portal_feedback', {
  id:text('id').primaryKey().notNull(), authorId:text('author_id').notNull(), projectId:text('project_id').references(()=>projects.id),
  campaignId:text('campaign_id').references(()=>campaigns.id),
  kind:text('kind').notNull(), module:text('module').notNull(), body:text('body').notNull(), release:text('release').notNull(),
  status:text('status').notNull().default('new'), version:integer('version').notNull().default(1),
  response:text('response'), respondedBy:text('responded_by'), respondedAt:text('responded_at'),
  createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[index('portal_feedback_author_idx').on(t.authorId,t.createdAt),index('portal_feedback_project_idx').on(t.projectId,t.createdAt),index('portal_feedback_campaign_idx').on(t.campaignId),
  check('portal_feedback_kind',sql`${t.kind} IN ('problem','suggestion','praise')`),check('portal_feedback_body',sql`length(${t.body}) BETWEEN 10 AND 2000`),check('portal_feedback_status',sql`${t.status} IN ('new','reviewing','resolved')`),
  check('portal_feedback_campaign_project',sql`${t.campaignId} IS NULL OR ${t.projectId} IS NOT NULL`),
  check('portal_feedback_response',sql`(${t.response} IS NULL AND ${t.respondedBy} IS NULL AND ${t.respondedAt} IS NULL) OR (length(${t.response}) BETWEEN 1 AND 2000 AND ${t.respondedBy} IS NOT NULL AND ${t.respondedAt} IS NOT NULL)`)]);
