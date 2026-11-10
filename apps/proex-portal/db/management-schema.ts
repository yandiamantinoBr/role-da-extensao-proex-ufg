import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { campaigns, organizations, projects } from './base-schema';
import { followupTeams } from './follow-up-schema';
/*
 * Gestão da organização: guia da PROEX (páginas com versões e editores designados), registro de
 * riscos e o modelo usado ao criar cada equipe. Só acréscimos; nenhum dado é criado pela migração.
 */
export const orgGuidePages = sqliteTable('org_guide_pages', {
  id:text('id').primaryKey().notNull(), organizationId:text('organization_id').notNull().references(()=>organizations.id),
  slug:text('slug').notNull(), title:text('title').notNull(), section:text('section').notNull(), body:text('body').notNull(),
  position:integer('position').notNull().default(0), version:integer('version').notNull().default(1),
  updatedBy:text('updated_by').notNull(), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('org_guide_pages_slug_idx').on(t.organizationId,t.slug),
  check('org_guide_pages_slug',sql`length(${t.slug}) BETWEEN 1 AND 80 AND ${t.slug} NOT GLOB '*[^a-z0-9-]*'`),
  check('org_guide_pages_title',sql`length(${t.title}) BETWEEN 1 AND 160`),
  check('org_guide_pages_section',sql`${t.section} IN ('organizacao','processos','referencias')`),
  check('org_guide_pages_body',sql`length(${t.body}) <= 40000`)]);
export const orgGuidePageVersions = sqliteTable('org_guide_page_versions', {
  id:text('id').primaryKey().notNull(), pageId:text('page_id').notNull().references(()=>orgGuidePages.id),
  organizationId:text('organization_id').notNull().references(()=>organizations.id), version:integer('version').notNull(),
  title:text('title').notNull(), body:text('body').notNull(), authorId:text('author_id').notNull(), authorName:text('author_name').notNull(),
  note:text('note').notNull().default(''), createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('org_guide_page_versions_idx').on(t.pageId,t.version),
  check('org_guide_page_versions_note',sql`length(${t.note}) <= 300`)]);
export const orgGuideEditors = sqliteTable('org_guide_editors', {
  organizationId:text('organization_id').notNull().references(()=>organizations.id), userId:text('user_id').notNull(),
  grantedBy:text('granted_by').notNull(), createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.organizationId,t.userId]})]);
export const orgRisks = sqliteTable('org_risks', {
  id:text('id').primaryKey().notNull(), organizationId:text('organization_id').notNull().references(()=>organizations.id),
  projectId:text('project_id').references(()=>projects.id), campaignId:text('campaign_id').references(()=>campaigns.id),
  title:text('title').notNull(), description:text('description').notNull().default(''), category:text('category').notNull().default('operacional'),
  probability:integer('probability').notNull(), impact:integer('impact').notNull(), ownerLabel:text('owner_label').notNull().default(''),
  mitigation:text('mitigation').notNull().default(''), status:text('status').notNull().default('open'), reviewOn:text('review_on'),
  isExample:integer('is_example').notNull().default(0), version:integer('version').notNull().default(1),
  createdBy:text('created_by').notNull(), updatedBy:text('updated_by').notNull(), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[index('org_risks_scope_idx').on(t.organizationId,t.projectId,t.status,t.reviewOn),
  check('org_risks_title',sql`length(${t.title}) BETWEEN 1 AND 160`),
  check('org_risks_text',sql`length(${t.description}) <= 2000 AND length(${t.mitigation}) <= 2000 AND length(${t.ownerLabel}) <= 120`),
  check('org_risks_scale',sql`${t.probability} BETWEEN 1 AND 5 AND ${t.impact} BETWEEN 1 AND 5`),
  check('org_risks_status',sql`${t.status} IN ('open','monitoring','mitigated','closed')`),
  check('org_risks_category',sql`${t.category} IN ('operacional','tecnologia','pessoas','financeiro','reputacao','legal','outro')`),
  check('org_risks_example',sql`${t.isExample} IN (0,1)`),
  check('org_risks_campaign',sql`${t.campaignId} IS NULL OR ${t.projectId} IS NOT NULL`)]);
export const teamTemplateApplications = sqliteTable('team_template_applications', {
  teamId:text('team_id').primaryKey().notNull().references(()=>followupTeams.id), organizationId:text('organization_id').notNull().references(()=>organizations.id),
  templateId:text('template_id').notNull(), appliedBy:text('applied_by').notNull(), appliedAt:text('applied_at').notNull(),
},t=>[check('team_template_applications_template',sql`length(${t.templateId}) BETWEEN 1 AND 40`)]);
