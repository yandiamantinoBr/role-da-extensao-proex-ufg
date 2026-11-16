import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { portalUsers } from './base-schema';
/*
 * Progresso dos tutoriais do Portal (0051). Só a própria pessoa lê e grava.
 * Guarda apenas o capítulo, a versão, o último passo, a situação e as datas: nada de projeto,
 * evento, anexo ou texto livre. O convite do Rolê no Início usa o capítulo reservado `convite`.
 * A anonimização da conta apaga as linhas (lib/privacy.ts).
 */
export const userTutorials = sqliteTable('user_tutorials', {
  userId: text('user_id').notNull().references(() => portalUsers.userId),
  chapterId: text('chapter_id').notNull(),
  chapterVersion: integer('chapter_version').notNull(),
  stepId: text('step_id').notNull().default(''),
  status: text('status').notNull(),
  completedAt: text('completed_at'),
  updatedAt: text('updated_at').notNull(),
}, t => [
  primaryKey({ columns: [t.userId, t.chapterId] }),
  check('user_tutorials_ids', sql`length(${t.chapterId}) BETWEEN 1 AND 40 AND length(${t.stepId}) <= 40`),
  check('user_tutorials_status', sql`${t.status} IN ('in_progress','paused','completed','dismissed','started')`),
  check('user_tutorials_version', sql`${t.chapterVersion} >= 1`),
]);
