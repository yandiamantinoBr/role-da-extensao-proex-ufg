import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { portalUsers } from './base-schema';
export const mcpPersonalTokens = sqliteTable('mcp_personal_tokens', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => portalUsers.userId), label: text('label').notNull(),
  tokenHash: text('token_hash').notNull(), scopeJson: text('scope_json').notNull(), projectsJson: text('projects_json').notNull(), requestId: text('request_id').notNull(),
  expiresAt: text('expires_at').notNull(), revokedAt: text('revoked_at'), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('mcp_token_hash_unique').on(t.tokenHash), uniqueIndex('mcp_token_request_unique').on(t.userId, t.requestId), index('mcp_token_user_created_idx').on(t.userId, t.createdAt),
  check('mcp_token_hash_length', sql`length(${t.tokenHash})=64`), check('mcp_token_label_length', sql`length(trim(${t.label})) BETWEEN 1 AND 80`),
  check('mcp_token_scopes_json', sql`json_valid(${t.scopeJson}) AND json_type(${t.scopeJson})='array' AND json_array_length(${t.scopeJson}) BETWEEN 1 AND 2`),
  check('mcp_token_projects_json', sql`json_valid(${t.projectsJson}) AND json_type(${t.projectsJson})='array' AND json_array_length(${t.projectsJson}) BETWEEN 1 AND 20`),
  check('mcp_token_expiry', sql`julianday(${t.expiresAt})>julianday(${t.createdAt}) AND julianday(${t.expiresAt})<=julianday(${t.createdAt})+30`),
]);
