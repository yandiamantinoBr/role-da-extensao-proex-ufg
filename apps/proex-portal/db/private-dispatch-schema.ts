import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { followupTasks, organizations, portalUsers } from './base-schema';
/*
 * Demandas privadas e despachos (0053, pedido de 17/11/2026).
 * Uma demanda sem linha em followup_task_privacy continua como sempre (visível pelo projeto ou pela organização).
 * Com a linha, só quem participa (ou, em `leadership`, quem está na Gestão superior da organização) a vê:
 * o filtro fica em lib/follow-up/scope.ts (taskAuthority/publicTask), nunca na tela.
 * Nada muda nas demandas existentes. Quem administra o banco tecnicamente pode ler (docs/ACESSOS-E-ESCOPO.md).
 */
export const followupTaskPrivacy = sqliteTable('followup_task_privacy', {
  taskId: text('task_id').primaryKey().notNull().references(() => followupTasks.id),
  visibility: text('visibility').notNull(),
  createdBy: text('created_by').notNull().references(() => portalUsers.userId),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [check('followup_task_privacy_visibility', sql`${t.visibility} IN ('leadership','participants')`)]);

export const followupTaskParticipants = sqliteTable('followup_task_participants', {
  id: text('id').primaryKey().notNull(),
  taskId: text('task_id').notNull().references(() => followupTasks.id),
  userId: text('user_id').notNull().references(() => portalUsers.userId),
  addedBy: text('added_by').notNull().references(() => portalUsers.userId),
  createdAt: text('created_at').notNull(),
  removedAt: text('removed_at'),
}, t => [
  uniqueIndex('followup_task_participant_active_idx').on(t.taskId, t.userId).where(sql`${t.removedAt} IS NULL`),
  index('followup_task_participant_user_idx').on(t.userId, t.removedAt, t.taskId),
]);

/** "Gestão superior": Pró-Reitoria e coordenações, mantido pela administração geral em Pessoas e acessos. */
export const leadershipGroupMembers = sqliteTable('leadership_group_members', {
  id: text('id').primaryKey().notNull(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  userId: text('user_id').notNull().references(() => portalUsers.userId),
  addedBy: text('added_by').notNull().references(() => portalUsers.userId),
  createdAt: text('created_at').notNull(),
  removedAt: text('removed_at'),
}, t => [uniqueIndex('leadership_group_active_idx').on(t.organizationId, t.userId).where(sql`${t.removedAt} IS NULL`)]);

/** Campos do despacho: tipo, documento, com quem está, referência (SEI/Drive) e se entra na pauta. */
export const followupDispatchDetails = sqliteTable('followup_dispatch_details', {
  taskId: text('task_id').primaryKey().notNull().references(() => followupTasks.id),
  kind: text('kind').notNull(),
  documentKind: text('document_kind'),
  holderUserId: text('holder_user_id').references(() => portalUsers.userId),
  documentRef: text('document_ref').notNull().default(''),
  urgency: text('urgency').notNull().default('medium'),
  onAgenda: integer('on_agenda', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
}, t => [
  check('followup_dispatch_kind', sql`${t.kind} IN ('signature','question','decision','document_review','referral','agenda')`),
  check('followup_dispatch_document', sql`${t.documentKind} IS NULL OR ${t.documentKind} IN ('term','draft','notice','dispatch','acknowledgement','agreement','other')`),
  check('followup_dispatch_ref', sql`length(${t.documentRef}) <= 500`),
  check('followup_dispatch_agenda', sql`${t.onAgenda} IN (0,1)`),
  check('followup_dispatch_urgency', sql`${t.urgency} IN ('immediate','high','medium','low')`),
]);
