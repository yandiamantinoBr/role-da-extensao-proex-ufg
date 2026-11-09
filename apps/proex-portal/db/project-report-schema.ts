import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { projects } from './base-schema';
/*
 * Relatório do projeto (0041). Modelos salvos por projeto: seções, ordem, período, título e
 * observações. Visíveis a quem vê o projeto; salvar exige relatórios ou edição do projeto.
 */
export const projectReportTemplates = sqliteTable('project_report_templates', {
  id:text('id').primaryKey().notNull(), projectId:text('project_id').notNull().references(()=>projects.id),
  name:text('name').notNull(), configJson:text('config_json').notNull(),
  version:integer('version').notNull().default(1), createdBy:text('created_by').notNull(), updatedBy:text('updated_by').notNull(),
  createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('project_report_templates_name_idx').on(t.projectId,t.name),index('project_report_templates_project_idx').on(t.projectId,t.updatedAt),
  check('project_report_templates_name',sql`length(${t.name}) BETWEEN 1 AND 80`),check('project_report_templates_config',sql`json_valid(${t.configJson}) AND length(${t.configJson})<=40000`)]);
