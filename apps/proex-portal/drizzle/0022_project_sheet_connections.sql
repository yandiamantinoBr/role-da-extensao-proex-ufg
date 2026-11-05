CREATE TABLE `project_sheet_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`expected_version` integer,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `project_sheet_connections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_sheet_conflict_status_check" CHECK("project_sheet_conflicts"."status" IN ('open','resolved'))
);
--> statement-breakpoint
CREATE TABLE `project_sheet_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`spreadsheet_id` text NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`include_tasks` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`tabs_json` text DEFAULT '{}' NOT NULL,
	`tabs_version` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_sheet_enabled_check" CHECK("project_sheet_connections"."enabled" IN (0,1)),
	CONSTRAINT "project_sheet_tasks_check" CHECK("project_sheet_connections"."include_tasks" IN (0,1)),
	CONSTRAINT "project_sheet_version_check" CHECK("project_sheet_connections"."version">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_sheet_connections_project_unique` ON `project_sheet_connections` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_sheet_connections_file_unique` ON `project_sheet_connections` (`spreadsheet_id`);--> statement-breakpoint
CREATE TABLE `project_sheet_receipts` (
	`operation_key` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`entity_id` text,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `project_sheet_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project_sheet_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`token_id` text NOT NULL,
	`connection_version` integer NOT NULL,
	`request_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`exported_count` integer DEFAULT 0 NOT NULL,
	`applied_count` integer DEFAULT 0 NOT NULL,
	`conflict_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `project_sheet_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`token_id`) REFERENCES `project_sheet_tokens`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_sheet_run_status_check" CHECK("project_sheet_runs"."status" IN ('running','completed','conflict','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_sheet_runs_request_unique` ON `project_sheet_runs` (`token_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `project_sheet_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`connection_version` integer NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_used_at` text,
	FOREIGN KEY (`connection_id`) REFERENCES `project_sheet_connections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_sheet_scope_check" CHECK("project_sheet_tokens"."scope" IN ('read','materials'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_sheet_tokens_hash_unique` ON `project_sheet_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `project_sheet_tokens_connection_idx` ON `project_sheet_tokens` (`connection_id`);