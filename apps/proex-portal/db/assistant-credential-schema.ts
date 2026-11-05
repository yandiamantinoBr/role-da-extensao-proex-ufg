import { sql } from 'drizzle-orm';
import { check, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organizations } from './base-schema';

export const aiProviderCredentialMetadata = sqliteTable('ai_provider_credential_metadata', {
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  mask: text('mask').notNull(),
  state: text('state').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
}, table => [
  primaryKey({ columns: [table.organizationId, table.provider] }),
  check('ai_provider_credential_name', sql`${table.provider} IN ('deepseek','typesafe','deepgram','groq')`),
  check('ai_provider_credential_state', sql`${table.state} IN ('active','disabled','removed')`),
]);
