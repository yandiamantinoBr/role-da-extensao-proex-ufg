import {sql} from 'drizzle-orm';
import {check,index,integer,primaryKey,sqliteTable,text,uniqueIndex} from 'drizzle-orm/sqlite-core';
import {items,projects,portalUsers} from './base-schema';
export const materialAttentionEpisodes=sqliteTable('material_attention_episodes',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),id:text('id').notNull().unique(),itemId:text('item_id').notNull().references(()=>items.id),projectId:text('project_id').notNull().references(()=>projects.id),
 openedAt:text('opened_at').notNull(),openedAvailable:integer('opened_available').notNull(),openedThreshold:integer('opened_threshold').notNull(),cause:text('cause').notNull(),resolvedAt:text('resolved_at'),resolvedAvailable:integer('resolved_available'),resolution:text('resolution'),
},t=>[uniqueIndex('material_attention_open_idx').on(t.itemId).where(sql`${t.resolvedAt} IS NULL`),index('material_attention_scope_idx').on(t.projectId,t.resolvedAt,t.sequence),check('material_attention_threshold',sql`${t.openedThreshold}>=0`),check('material_attention_cause',sql`${t.cause} IN('stock','threshold')`),check('material_attention_resolution',sql`${t.resolution} IN('recovered','inactive')`),check('material_attention_resolved',sql`(${t.resolvedAt} IS NULL AND ${t.resolvedAvailable} IS NULL AND ${t.resolution} IS NULL) OR (${t.resolvedAt} IS NOT NULL AND ${t.resolvedAvailable} IS NOT NULL AND ${t.resolution} IS NOT NULL)`)]);
export const materialAttentionReceipts=sqliteTable('material_attention_receipts',{
 episodeId:text('episode_id').notNull().references(()=>materialAttentionEpisodes.id),userId:text('user_id').notNull().references(()=>portalUsers.userId),readAt:text('read_at'),dismissedAt:text('dismissed_at'),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.episodeId,t.userId]}),index('material_attention_user_idx').on(t.userId,t.dismissedAt,t.episodeId)]);
