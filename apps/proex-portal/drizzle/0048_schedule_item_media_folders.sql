CREATE TABLE `schedule_item_media_folders` (
	`schedule_item_id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`schedule_item_id`) REFERENCES `project_schedule_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `google_drive_folders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_item_media_folder_version" CHECK("schedule_item_media_folders"."version" > 0)
);
--> statement-breakpoint
CREATE TRIGGER activity_media_folder_insert BEFORE INSERT ON schedule_item_media_folders
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM project_schedule_items s JOIN projects p ON p.id=s.project_id
  JOIN google_drive_folders f ON f.project_id=p.id AND f.organization_id=p.organization_id
  WHERE s.id=NEW.schedule_item_id AND f.id=NEW.folder_id
)
BEGIN
  SELECT RAISE(ABORT,'activity_media_scope_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER activity_media_folder_update BEFORE UPDATE OF schedule_item_id,folder_id ON schedule_item_media_folders
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM project_schedule_items s JOIN projects p ON p.id=s.project_id
  JOIN google_drive_folders f ON f.project_id=p.id AND f.organization_id=p.organization_id
  WHERE s.id=NEW.schedule_item_id AND f.id=NEW.folder_id
)
BEGIN
  SELECT RAISE(ABORT,'activity_media_scope_mismatch');
END;
