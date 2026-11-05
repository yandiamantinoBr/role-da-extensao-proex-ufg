import {sql} from 'drizzle-orm';
import {check,index,integer,primaryKey,sqliteTable,text,unique} from 'drizzle-orm/sqlite-core';
import {campaigns,projects} from './base-schema';
/** Mirrors drizzle/0030_campaign_planning.sql. Triggers live only in the SQL migration. */
export const campaignPlanning=sqliteTable('campaign_planning',{
 campaignId:text('campaign_id').primaryKey().notNull().references(()=>campaigns.id),version:integer('version').notNull().default(0),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[check('planning_version',sql`${t.version}>=0`)]);
export const campaignHostContexts=sqliteTable('campaign_host_contexts',{
 campaignId:text('campaign_id').notNull().references(()=>campaignPlanning.campaignId),hostProjectId:text('host_project_id').notNull().references(()=>projects.id),
 createdAt:text('created_at').notNull(),createdBy:text('created_by').notNull(),revokedAt:text('revoked_at'),
},t=>[primaryKey({columns:[t.campaignId,t.hostProjectId]}),index('campaign_host_contexts_host_idx').on(t.hostProjectId,t.revokedAt),check('planning_host_created_by',sql`length(${t.createdBy}) BETWEEN 1 AND 200`)]);
export const campaignSessions=sqliteTable('campaign_sessions',{
 id:text('id').primaryKey().notNull(),campaignId:text('campaign_id').notNull().references(()=>campaignPlanning.campaignId),
 sessionDate:text('session_date').notNull(),ordinal:integer('ordinal').notNull(),label:text('label').notNull().default(''),
 startsAt:text('starts_at'),endsAt:text('ends_at'),status:text('status').notNull().default('tentative'),note:text('note').notNull().default(''),
 version:integer('version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[unique().on(t.campaignId,t.sessionDate,t.ordinal),index('campaign_sessions_campaign_idx').on(t.campaignId,t.sessionDate,t.ordinal),
 check('planning_session_date',sql`length(${t.sessionDate})=10 AND date(${t.sessionDate}) IS ${t.sessionDate} AND ${t.sessionDate} BETWEEN '2000-01-01' AND '2100-12-31'`),
 check('planning_session_ordinal',sql`typeof(${t.ordinal})='integer' AND ${t.ordinal} BETWEEN 1 AND 10`),check('planning_session_label',sql`length(${t.label})<=100 AND ${t.label}=trim(${t.label})`),
 check('planning_session_starts',sql`${t.startsAt} IS NULL OR (length(${t.startsAt})=5 AND substr(time(${t.startsAt}),1,5) IS ${t.startsAt})`),
 check('planning_session_ends',sql`${t.endsAt} IS NULL OR (length(${t.endsAt})=5 AND substr(time(${t.endsAt}),1,5) IS ${t.endsAt})`),
 check('planning_session_status',sql`${t.status} IN('tentative','confirmed','cancelled','done')`),check('planning_session_note',sql`length(${t.note})<=500`),check('planning_session_version',sql`${t.version}>=1`),
 check('planning_session_pair',sql`(${t.startsAt} IS NULL)=(${t.endsAt} IS NULL)`),check('planning_session_order',sql`${t.startsAt} IS NULL OR ${t.startsAt}<${t.endsAt}`),
 check('planning_session_confirmed',sql`${t.status} NOT IN('confirmed','done') OR (${t.startsAt} IS NOT NULL AND ${t.endsAt} IS NOT NULL)`)]);
