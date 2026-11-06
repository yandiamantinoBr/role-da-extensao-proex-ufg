import {sql} from 'drizzle-orm';
import {check,index,integer,sqliteTable,text,unique,uniqueIndex} from 'drizzle-orm/sqlite-core';
import {organizations} from './base-schema';

// Private references, deliberately independent of auth, memberships and message delivery.
export const directoryPeople=sqliteTable('directory_people',{
 id:text('id').primaryKey().notNull(),organizationId:text('organization_id').notNull().references(()=>organizations.id),
 name:text('name').notNull(),position:text('position').notNull().default(''),sector:text('sector').notNull().default(''),contact:text('contact').notNull().default(''),
 contactStatus:text('contact_status').notNull(),status:text('status').notNull().default('pending'),sourceKind:text('source_kind').notNull(),referenceId:text('reference_id'),sourceUrl:text('source_url'),sourceUpdatedOn:text('source_updated_on'),checkedOn:text('checked_on').notNull(),adapted:integer('adapted').notNull().default(0),
 version:integer('version').notNull().default(1),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[unique().on(t.organizationId,t.id),uniqueIndex('directory_official_reference_idx').on(t.organizationId,t.referenceId).where(sql`${t.referenceId} IS NOT NULL`),index('directory_people_org_idx').on(t.organizationId,t.status,t.name,t.id),
 check('directory_name',sql`length(trim(${t.name})) BETWEEN 1 AND 160`),check('directory_position',sql`length(${t.position})<=160`),check('directory_sector',sql`length(${t.sector})<=160`),check('directory_contact',sql`length(${t.contact})<=254`),
 check('directory_contact_status',sql`${t.contactStatus} IN('published','entered','review')`),check('directory_status',sql`${t.status} IN('pending','review','archived')`),check('directory_source_kind',sql`${t.sourceKind} IN('manual','official')`),check('directory_adapted',sql`${t.adapted} IN(0,1)`),check('directory_version',sql`${t.version}>0`),
 check('directory_source',sql`(${t.sourceKind}='manual' AND ${t.referenceId} IS NULL AND ${t.sourceUrl} IS NULL AND ${t.sourceUpdatedOn} IS NULL) OR (${t.sourceKind}='official' AND ${t.referenceId} IS NOT NULL AND ${t.sourceUrl} IS NOT NULL AND ${t.sourceUrl}='https://proex.ufg.br/p/equipe-proex' AND ${t.sourceUpdatedOn} IS NOT NULL)`),
 check('directory_checked_on',sql`length(${t.checkedOn})=10 AND COALESCE(date(${t.checkedOn}),'')=${t.checkedOn}`),check('directory_source_date',sql`${t.sourceUpdatedOn} IS NULL OR(length(${t.sourceUpdatedOn})=10 AND COALESCE(date(${t.sourceUpdatedOn}),'')=${t.sourceUpdatedOn})`),check('directory_review',sql`${t.contactStatus}!='review' OR ${t.status} IN('review','archived')`)]);
export const directoryPeopleHistory=sqliteTable('directory_people_history',{
 id:text('id').primaryKey().notNull(),personId:text('person_id').notNull().references(()=>directoryPeople.id),version:integer('version').notNull(),snapshotJson:text('snapshot_json').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[unique().on(t.personId,t.version),check('directory_history_version',sql`${t.version}>0`),check('directory_history_json',sql`json_valid(${t.snapshotJson})`)]);
