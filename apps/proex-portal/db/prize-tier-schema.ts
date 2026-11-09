import {sql} from 'drizzle-orm';
import {check,index,integer,primaryKey,sqliteTable,text} from 'drizzle-orm/sqlite-core';
import {campaigns,items,offers,projects,recordAttachments} from './base-schema';
/** Mirrors drizzle/0035_prize_tiers_and_primary_photos.sql. Triggers live only in the SQL migration. */
export const campaignPrizeSettings=sqliteTable('campaign_prize_settings',{
 campaignId:text('campaign_id').primaryKey().notNull().references(()=>campaigns.id),superSuperPercent:integer('super_super_percent').notNull(),
 version:integer('version').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[check('prize_settings_percent',sql`typeof(${t.superSuperPercent})='integer' AND ${t.superSuperPercent} BETWEEN 0 AND 100`),check('prize_settings_version',sql`typeof(${t.version})='integer' AND ${t.version}>=1`),check('prize_settings_updated_by',sql`length(${t.updatedBy}) BETWEEN 1 AND 200`)]);
export const campaignPrizeTiers=sqliteTable('campaign_prize_tiers',{
 campaignId:text('campaign_id').notNull().references(()=>campaignPrizeSettings.campaignId),offerId:text('offer_id').notNull().references(()=>offers.id),
 tier:text('tier').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.campaignId,t.offerId]}),index('campaign_prize_tiers_offer_idx').on(t.offerId),check('prize_tier_value',sql`${t.tier} IN('brinde','super','super_super')`),check('prize_tier_updated_by',sql`length(${t.updatedBy}) BETWEEN 1 AND 200`)]);
export const campaignPrizeHistory=sqliteTable('campaign_prize_history',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),id:text('id').notNull().unique(),
 campaignId:text('campaign_id').notNull().references(()=>campaigns.id),projectId:text('project_id').notNull().references(()=>projects.id),
 kind:text('kind').notNull(),offerId:text('offer_id').references(()=>offers.id),previousTier:text('previous_tier'),tier:text('tier'),
 previousPercent:integer('previous_percent'),percent:integer('percent'),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('campaign_prize_history_campaign_idx').on(t.campaignId,t.sequence),check('prize_history_kind',sql`${t.kind} IN('tier','percent')`)]);
export const itemPrimaryPhotos=sqliteTable('item_primary_photos',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),id:text('id').notNull().unique(),
 itemId:text('item_id').notNull().references(()=>items.id),projectId:text('project_id').notNull().references(()=>projects.id),
 attachmentId:text('attachment_id').notNull().references(()=>recordAttachments.id),previousAttachmentId:text('previous_attachment_id').references(()=>recordAttachments.id),
 actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('item_primary_photos_item_idx').on(t.itemId,t.sequence),check('primary_photo_distinct',sql`${t.previousAttachmentId} IS NULL OR ${t.previousAttachmentId}!=${t.attachmentId}`)]);
