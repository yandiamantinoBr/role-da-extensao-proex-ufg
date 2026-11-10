import {sql} from 'drizzle-orm';
import {check,index,sqliteTable,text,uniqueIndex} from 'drizzle-orm/sqlite-core';
import {campaigns,invites,projects} from './base-schema';
/**
 * Mirrors drizzle/0046_campaign_volunteers.sql (triggers live only in the SQL migration).
 * A volunteer works at one action (campaign) until a fixed end. It is NOT a project membership:
 * nothing that asks "is this person on the team?" reads this table, so the grant cannot leak.
 */
export const inviteCampaignScopes=sqliteTable('invite_campaign_scopes',{
 inviteId:text('invite_id').primaryKey().notNull().references(()=>invites.id),
 campaignId:text('campaign_id').notNull().references(()=>campaigns.id),
 endsAt:text('ends_at').notNull(),createdAt:text('created_at').notNull(),
});
export const campaignVolunteers=sqliteTable('campaign_volunteers',{
 id:text('id').primaryKey().notNull(),userId:text('user_id').notNull(),email:text('email').notNull(),
 campaignId:text('campaign_id').notNull().references(()=>campaigns.id),
 projectId:text('project_id').notNull().references(()=>projects.id),
 inviteId:text('invite_id').notNull().references(()=>invites.id),
 endsAt:text('ends_at').notNull(),grantedBy:text('granted_by').notNull(),createdAt:text('created_at').notNull(),
 revokedAt:text('revoked_at'),revokedBy:text('revoked_by'),revokeReason:text('revoke_reason'),
},t=>[
 uniqueIndex('campaign_volunteers_invite_unique').on(t.inviteId),
 uniqueIndex('campaign_volunteers_active_unique').on(t.userId,t.campaignId).where(sql`${t.revokedAt} IS NULL`),
 index('campaign_volunteers_user_idx').on(t.userId,t.revokedAt),
 index('campaign_volunteers_project_idx').on(t.projectId,t.createdAt),
 index('campaign_volunteers_due_idx').on(t.endsAt).where(sql`${t.revokedAt} IS NULL`),
 check('campaign_volunteers_revoke_check',sql`(${t.revokedAt} IS NULL AND ${t.revokedBy} IS NULL AND ${t.revokeReason} IS NULL) OR (${t.revokedAt} IS NOT NULL AND ${t.revokeReason} IN ('expired','revoked'))`),
]);
