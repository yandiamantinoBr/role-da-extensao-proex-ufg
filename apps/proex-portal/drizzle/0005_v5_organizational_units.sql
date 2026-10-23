CREATE TABLE `organizational_units` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`acronym` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "organizational_units_kind_check" CHECK("organizational_units"."kind" IN ('proex','academic','agency','external')),
	CONSTRAINT "organizational_units_status_check" CHECK("organizational_units"."status" IN ('active','archived')),
	CONSTRAINT "organizational_units_version_check" CHECK("organizational_units"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `organizational_units_status_name_idx` ON `organizational_units` (`status`,`name`);--> statement-breakpoint
-- Extend existing rows in place; preserve operational data, foreign keys and triggers.
ALTER TABLE `projects` ADD `unit_id` text REFERENCES organizational_units(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `prizes_enabled` integer DEFAULT 0 NOT NULL CONSTRAINT projects_prizes_enabled_check CHECK(prizes_enabled IN (0,1));--> statement-breakpoint
CREATE INDEX `projects_unit_idx` ON `projects` (`unit_id`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `unit_id` text REFERENCES organizational_units(id);--> statement-breakpoint
ALTER TABLE `profiles` ADD `affiliation` text DEFAULT '' NOT NULL CONSTRAINT profiles_affiliation_check CHECK(affiliation IN ('','student','technical','faculty','scholar','intern','collaborator','other'));--> statement-breakpoint
ALTER TABLE `profiles` ADD `registration_type` text DEFAULT '' NOT NULL CONSTRAINT profiles_registration_type_check CHECK(registration_type IN ('','siape','student','other'));--> statement-breakpoint
ALTER TABLE `profiles` ADD `registration_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `profiles_unit_idx` ON `profiles` (`unit_id`);
