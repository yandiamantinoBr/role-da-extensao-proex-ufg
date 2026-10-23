CREATE TABLE `sync_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_tokens_hash_unique` ON `sync_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sync_tokens_user_idx` ON `sync_tokens` (`user_id`);--> statement-breakpoint
-- Extend in place, preserving data, foreign keys and triggers. Existing projects stay internal.
ALTER TABLE `projects` ADD `scope` text DEFAULT 'internal' NOT NULL CONSTRAINT projects_scope_check CHECK(scope IN ('internal','external'));
