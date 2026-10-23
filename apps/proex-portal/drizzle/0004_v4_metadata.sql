CREATE TABLE `activity_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`occurred_at` text NOT NULL,
	`kind` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "activity_groups_kind_check" CHECK("activity_groups"."kind" IN ('donation','loan','mixed'))
);
--> statement-breakpoint
CREATE INDEX `activity_groups_project_occurred_idx` ON `activity_groups` (`project_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`reference_code` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`opens_at` text,
	`closes_at` text,
	`official_url` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "calls_status_check" CHECK("calls"."status" IN ('draft','open','closed','archived'))
);
--> statement-breakpoint
CREATE INDEX `calls_project_idx` ON `calls` (`project_id`);--> statement-breakpoint
CREATE TABLE `entity_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "entity_versions_type_check" CHECK("entity_versions"."entity_type" IN ('project','item','category','call','project_link','project_schedule_item'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_versions_revision_unique` ON `entity_versions` (`entity_type`,`entity_id`,`version`);--> statement-breakpoint
CREATE INDEX `entity_versions_project_created_idx` ON `entity_versions` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `login_identifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`lookup_hash` text NOT NULL,
	`display_hint` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "login_identifiers_kind_check" CHECK("login_identifiers"."kind" IN ('username','cpf'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_identifiers_lookup_unique` ON `login_identifiers` (`lookup_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `login_identifiers_user_kind_unique` ON `login_identifiers` (`user_id`,`kind`);--> statement-breakpoint
CREATE INDEX `login_identifiers_user_idx` ON `login_identifiers` (`user_id`);--> statement-breakpoint
CREATE TABLE `material_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`label_key` text NOT NULL,
	`core_kind` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_categories_core_kind_check" CHECK("material_categories"."core_kind" IN ('gift','equipment','distribution','consumption')),
	CONSTRAINT "material_categories_status_check" CHECK("material_categories"."status" IN ('active','archived')),
	CONSTRAINT "material_categories_version_check" CHECK("material_categories"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_categories_label_unique` ON `material_categories` (`project_id`,`label_key`);--> statement-breakpoint
CREATE INDEX `material_categories_project_status_idx` ON `material_categories` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `privacy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`completed_at` text,
	`reason` text DEFAULT 'account_anonymization' NOT NULL,
	CONSTRAINT "privacy_requests_status_check" CHECK("privacy_requests"."status" IN ('pending','cleanup_pending','completed','rejected'))
);
--> statement-breakpoint
CREATE INDEX `privacy_requests_user_idx` ON `privacy_requests` (`user_id`);--> statement-breakpoint
CREATE TABLE `private_object_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text,
	`mime` text,
	`created_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `private_object_deletions_user_idx` ON `private_object_deletions` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_calls` (
	`call_id` text NOT NULL,
	`project_id` text NOT NULL,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_calls_unique` ON `project_calls` (`call_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `project_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_links_kind_check" CHECK("project_links"."kind" IN ('official','notice','report','gallery','other'))
);
--> statement-breakpoint
CREATE INDEX `project_links_project_idx` ON `project_links` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_schedule_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_schedule_status_check" CHECK("project_schedule_items"."status" IN ('planned','completed','cancelled')),
	CONSTRAINT "project_schedule_interval_check" CHECK("project_schedule_items"."ends_at" >= "project_schedule_items"."starts_at")
);
--> statement-breakpoint
CREATE INDEX `project_schedule_project_start_idx` ON `project_schedule_items` (`project_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `project_types` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "project_types_status_check" CHECK("project_types"."status" IN ('active','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_types_key_unique` ON `project_types` (`key`);--> statement-breakpoint
CREATE TABLE `sync_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`run_id` text,
	`operation_key` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`expected_version` integer,
	`actual_version` integer,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`connection_id`) REFERENCES `sync_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sync_conflicts_status_check" CHECK("sync_conflicts"."status" IN ('open','resolved'))
);
--> statement-breakpoint
CREATE INDEX `sync_conflicts_run_idx` ON `sync_conflicts` (`run_id`);--> statement-breakpoint
CREATE TABLE `sync_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`external_id` text,
	`enabled` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "sync_connections_provider_check" CHECK("sync_connections"."provider" IN ('google_sheets','excel')),
	CONSTRAINT "sync_connections_enabled_check" CHECK("sync_connections"."enabled" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `sync_receipts` (
	`operation_key` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`entity_id` text,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`status` text NOT NULL,
	`direction` text NOT NULL,
	`started_by` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`exported_count` integer DEFAULT 0 NOT NULL,
	`applied_count` integer DEFAULT 0 NOT NULL,
	`conflict_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	FOREIGN KEY (`connection_id`) REFERENCES `sync_connections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sync_runs_status_check" CHECK("sync_runs"."status" IN ('running','completed','conflict','failed')),
	CONSTRAINT "sync_runs_direction_check" CHECK("sync_runs"."direction" IN ('export','import','bidirectional'))
);
--> statement-breakpoint
ALTER TABLE `items` ADD `category_id` text REFERENCES material_categories(id);--> statement-breakpoint
ALTER TABLE `loans` ADD `group_id` text REFERENCES activity_groups(id);--> statement-breakpoint
ALTER TABLE `portal_users` ADD `anonymized_at` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `unit` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `job_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Add columns in place: preserve all existing foreign keys, triggers and production data.
ALTER TABLE `projects` ADD `lifecycle` text DEFAULT 'active' NOT NULL CHECK(lifecycle IN ('active','past','catalog'));--> statement-breakpoint
ALTER TABLE `projects` ADD `type_id` text REFERENCES project_types(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `parent_id` text REFERENCES projects(id);--> statement-breakpoint

CREATE INDEX `projects_parent_idx` ON `projects` (`parent_id`);--> statement-breakpoint
ALTER TABLE `record_attachments` ADD `caption` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `record_attachments` ADD `attachment_role` text DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE `record_attachments` ADD `display_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `record_attachments` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `records` ADD `group_id` text REFERENCES activity_groups(id);--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `group_id` text REFERENCES activity_groups(id);
--> statement-breakpoint
CREATE TRIGGER projects_parent_cycle_insert BEFORE INSERT ON projects WHEN NEW.parent_id IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.parent_id=NEW.id OR EXISTS(WITH RECURSIVE ancestors(id,parent_id) AS (
   SELECT id,parent_id FROM projects WHERE id=NEW.parent_id UNION SELECT p.id,p.parent_id FROM projects p JOIN ancestors a ON p.id=a.parent_id
 ) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE(ABORT,'project_parent_cycle') END;
END;
--> statement-breakpoint
CREATE TRIGGER projects_parent_cycle_update BEFORE UPDATE OF parent_id ON projects WHEN NEW.parent_id IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.parent_id=NEW.id OR EXISTS(WITH RECURSIVE ancestors(id,parent_id) AS (
   SELECT id,parent_id FROM projects WHERE id=NEW.parent_id UNION SELECT p.id,p.parent_id FROM projects p JOIN ancestors a ON p.id=a.parent_id
 ) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE(ABORT,'project_parent_cycle') END;
END;
--> statement-breakpoint
CREATE TRIGGER material_category_item_insert BEFORE INSERT ON items WHEN NEW.category_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM material_categories c WHERE c.id=NEW.category_id AND c.project_id=NEW.project_id AND c.core_kind=NEW.category AND c.status='active') THEN RAISE(ABORT,'material_category_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER material_category_item_update BEFORE UPDATE OF category_id,category,project_id ON items WHEN NEW.category_id IS NOT NULL AND (NEW.category_id IS NOT OLD.category_id OR NEW.category IS NOT OLD.category OR NEW.project_id IS NOT OLD.project_id) BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM material_categories c WHERE c.id=NEW.category_id AND c.project_id=NEW.project_id AND c.core_kind=NEW.category AND c.status='active') THEN RAISE(ABORT,'material_category_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER material_category_core_immutable BEFORE UPDATE OF core_kind,project_id ON material_categories WHEN NEW.core_kind IS NOT OLD.core_kind OR NEW.project_id IS NOT OLD.project_id BEGIN
 SELECT RAISE(ABORT,'material_category_core_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER movement_group_project BEFORE INSERT ON stock_movements WHEN NEW.group_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM activity_groups g JOIN items i ON i.project_id=g.project_id WHERE g.id=NEW.group_id AND i.id=NEW.item_id) THEN RAISE(ABORT,'group_project_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER loan_group_project_insert BEFORE INSERT ON loans WHEN NEW.group_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM activity_groups g WHERE g.id=NEW.group_id AND g.project_id=NEW.project_id) THEN RAISE(ABORT,'group_project_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER loan_group_project_update BEFORE UPDATE OF group_id,project_id ON loans WHEN NEW.group_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM activity_groups g WHERE g.id=NEW.group_id AND g.project_id=NEW.project_id) THEN RAISE(ABORT,'group_project_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER record_group_project_insert BEFORE INSERT ON records WHEN NEW.group_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM activity_groups g WHERE g.id=NEW.group_id AND g.project_id=NEW.project_id) THEN RAISE(ABORT,'group_project_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER record_group_project_update BEFORE UPDATE OF group_id,project_id ON records WHEN NEW.group_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM activity_groups g WHERE g.id=NEW.group_id AND g.project_id=NEW.project_id) THEN RAISE(ABORT,'group_project_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER entity_versions_immutable_update BEFORE UPDATE ON entity_versions BEGIN SELECT RAISE(ABORT,'metadata_version_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER entity_versions_immutable_delete BEFORE DELETE ON entity_versions BEGIN SELECT RAISE(ABORT,'metadata_version_immutable'); END;

--> statement-breakpoint
CREATE TABLE `sync_attachment_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`attachment_kind` text NOT NULL,
	`attachment_id` text NOT NULL,
	`drive_file_id` text NOT NULL,
	`drive_url` text NOT NULL,
	`content_hash` text NOT NULL,
	`size` integer NOT NULL,
	`exported_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "sync_attachment_exports_kind_check" CHECK("sync_attachment_exports"."attachment_kind" IN ('record','loan','avatar')),
	CONSTRAINT "sync_attachment_exports_size_check" CHECK("sync_attachment_exports"."size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_attachment_exports_attachment_unique` ON `sync_attachment_exports` (`attachment_kind`,`attachment_id`);--> statement-breakpoint
CREATE TABLE `sync_attachment_tickets` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`attachment_kind` text NOT NULL,
	`attachment_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "sync_attachment_tickets_kind_check" CHECK("sync_attachment_tickets"."attachment_kind" IN ('record','loan','avatar'))
);
