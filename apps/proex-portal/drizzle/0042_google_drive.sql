CREATE TABLE `google_drive_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`google_email` text NOT NULL,
	`scopes` text NOT NULL,
	`token_ciphertext` text,
	`key_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`connected_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "google_drive_connections_status" CHECK("google_drive_connections"."status" IN ('active','revoked')),
	CONSTRAINT "google_drive_connections_token" CHECK(("google_drive_connections"."status"='active' AND "google_drive_connections"."token_ciphertext" IS NOT NULL AND "google_drive_connections"."key_id" IS NOT NULL) OR ("google_drive_connections"."status"='revoked' AND "google_drive_connections"."token_ciphertext" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `google_drive_folder_grants` (
	`user_id` text NOT NULL,
	`folder_id` text NOT NULL,
	`google_sub` text NOT NULL,
	`confirmed_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `folder_id`),
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `google_drive_folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `google_drive_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`drive_folder_id` text NOT NULL,
	`shared_drive_id` text,
	`name` text NOT NULL,
	`drive_name` text NOT NULL,
	`purpose` text NOT NULL,
	`unit_id` text,
	`project_id` text,
	`audience` text DEFAULT 'organization' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `organizational_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "google_drive_folders_audience" CHECK("google_drive_folders"."audience" IN ('organization','project','managers')),
	CONSTRAINT "google_drive_folders_project" CHECK("google_drive_folders"."audience"!='project' OR "google_drive_folders"."project_id" IS NOT NULL),
	CONSTRAINT "google_drive_folders_status" CHECK("google_drive_folders"."status" IN ('active','archived')),
	CONSTRAINT "google_drive_folders_text" CHECK(length("google_drive_folders"."name") BETWEEN 1 AND 120 AND length("google_drive_folders"."purpose") BETWEEN 1 AND 300 AND length("google_drive_folders"."drive_name") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_drive_folders_drive_idx` ON `google_drive_folders` (`organization_id`,`drive_folder_id`);--> statement-breakpoint
CREATE INDEX `google_drive_folders_org_idx` ON `google_drive_folders` (`organization_id`,`status`,`name`);--> statement-breakpoint
CREATE TABLE `google_drive_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`user_id` text NOT NULL,
	`via` text NOT NULL,
	`folder_id` text NOT NULL,
	`drive_folder_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text,
	`file_name` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`drive_file_id` text,
	`web_view_link` text,
	`status` text NOT NULL,
	`error_code` text,
	`plan_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `google_drive_folders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "google_drive_uploads_via" CHECK("google_drive_uploads"."via" IN ('screen','role')),
	CONSTRAINT "google_drive_uploads_source" CHECK(length("google_drive_uploads"."source_kind") BETWEEN 3 AND 40),
	CONSTRAINT "google_drive_uploads_status" CHECK("google_drive_uploads"."status" IN ('sent','failed')),
	CONSTRAINT "google_drive_uploads_bytes" CHECK("google_drive_uploads"."bytes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_drive_uploads_plan_idx` ON `google_drive_uploads` (`plan_id`);--> statement-breakpoint
CREATE INDEX `google_drive_uploads_org_idx` ON `google_drive_uploads` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `google_drive_uploads_user_idx` ON `google_drive_uploads` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `google_drive_uploads_folder_idx` ON `google_drive_uploads` (`folder_id`,`created_at`);