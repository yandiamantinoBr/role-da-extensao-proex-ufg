CREATE TABLE `calendar_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`category` text NOT NULL,
	`project_id` text,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_token_hash_unique` ON `calendar_feeds` (`token_hash`);--> statement-breakpoint
CREATE INDEX `calendar_feeds_owner_idx` ON `calendar_feeds` (`owner_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `identity_aliases` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_aliases_provider_subject_unique` ON `identity_aliases` (`provider`,`subject`);--> statement-breakpoint
CREATE INDEX `identity_aliases_user_idx` ON `identity_aliases` (`user_id`);--> statement-breakpoint
CREATE TABLE `mutation_keys` (
	`scope` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portal_rate_limits` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL,
	CONSTRAINT "portal_rate_limits_count_check" CHECK("portal_rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `portal_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "portal_users_status_check" CHECK("portal_users"."status" IN ('active','blocked'))
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`avatar_key` text,
	`mime` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "profiles_version_check" CHECK("profiles"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE `record_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`project_id` text NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`operation_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "record_attachments_size_check" CHECK("record_attachments"."size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `record_attachments_object_key_unique` ON `record_attachments` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `record_attachments_operation_key_unique` ON `record_attachments` (`operation_key`);--> statement-breakpoint
CREATE INDEX `record_attachments_record_idx` ON `record_attachments` (`record_id`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`item_id` text,
	`loan_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "records_interval_check" CHECK("records"."starts_at" IS NULL OR "records"."ends_at" IS NULL OR "records"."ends_at" >= "records"."starts_at")
);
--> statement-breakpoint
CREATE INDEX `records_project_occurred_idx` ON `records` (`project_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `records_loan_idx` ON `records` (`loan_id`);--> statement-breakpoint
CREATE INDEX `records_item_idx` ON `records` (`item_id`);--> statement-breakpoint
CREATE TABLE `auth_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_account_user_idx` ON `auth_account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_account_provider_account_unique` ON `auth_account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `auth_rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_rate_limit_key_unique` ON `auth_rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `auth_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_session_token_unique` ON `auth_session` (`token`);--> statement-breakpoint
CREATE INDEX `auth_session_user_idx` ON `auth_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_session_expires_idx` ON `auth_session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`ban_expires` integer,
	CONSTRAINT "auth_user_role_check" CHECK("auth_user"."role" = 'user')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_user_email_unique` ON `auth_user` (`email`);--> statement-breakpoint
CREATE TABLE `auth_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_verification_identifier_idx` ON `auth_verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `auth_verification_expires_idx` ON `auth_verification` (`expires_at`);--> statement-breakpoint
ALTER TABLE `documents` ADD `operation_key` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `content_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_operation_key_unique` ON `documents` (`operation_key`);--> statement-breakpoint
-- Additive migration: preserve all existing triggers, foreign keys and rows.
ALTER TABLE items ADD COLUMN asset_code text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE items ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
--> statement-breakpoint
ALTER TABLE items ADD COLUMN updated_at text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX items_asset_code_unique ON items(project_id,asset_code) WHERE asset_code!='';
--> statement-breakpoint
ALTER TABLE `loans` ADD `checked_out_at` text;--> statement-breakpoint
ALTER TABLE `loans` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE projects ADD COLUMN short_name text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived'));
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN color text NOT NULL DEFAULT '#54216C';
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN official_url text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN starts_at text;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN ends_at text;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN location text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
