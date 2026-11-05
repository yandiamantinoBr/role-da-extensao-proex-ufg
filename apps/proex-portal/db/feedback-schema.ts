import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from './base-schema';
export const portalFeedback = sqliteTable('portal_feedback', {
  id:text('id').primaryKey().notNull(), authorId:text('author_id').notNull(), projectId:text('project_id').references(()=>projects.id),
  kind:text('kind').notNull(), module:text('module').notNull(), body:text('body').notNull(), release:text('release').notNull(),
  status:text('status').notNull().default('new'), version:integer('version').notNull().default(1),
  createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[index('portal_feedback_author_idx').on(t.authorId,t.createdAt),index('portal_feedback_project_idx').on(t.projectId,t.createdAt),
  check('portal_feedback_kind',sql`${t.kind} IN ('problem','suggestion')`),check('portal_feedback_body',sql`length(${t.body}) BETWEEN 10 AND 2000`),check('portal_feedback_status',sql`${t.status} IN ('new','reviewing','resolved')`)]);
