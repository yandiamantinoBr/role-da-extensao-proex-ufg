import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { portalUsers } from './base-schema';
/*
 * Preferências pessoais de navegação (0038). Só a própria pessoa lê e grava.
 * Guarda apenas ids de projetos e equipes fixados (no máximo 12 de cada), nunca nomes ou permissões:
 * o acesso é conferido de novo a cada leitura, e ids sem acesso atual são ignorados na tela.
 */
export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id').primaryKey().notNull().references(() => portalUsers.userId),
  projectPins: text('project_pins').notNull().default('[]'),
  teamPins: text('team_pins').notNull().default('[]'),
  version: integer('version').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
}, t => [
  check('user_preferences_project_pins', sql`json_valid(${t.projectPins}) AND json_type(${t.projectPins})='array' AND json_array_length(${t.projectPins})<=12`),
  check('user_preferences_team_pins', sql`json_valid(${t.teamPins}) AND json_type(${t.teamPins})='array' AND json_array_length(${t.teamPins})<=12`),
  check('user_preferences_version', sql`${t.version} >= 1`),
]);
