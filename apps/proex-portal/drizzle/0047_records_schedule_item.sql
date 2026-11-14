ALTER TABLE `records` ADD `schedule_item_id` text REFERENCES project_schedule_items(id);--> statement-breakpoint
CREATE INDEX `records_schedule_occurred_idx` ON `records` (`project_id`,`schedule_item_id`,`occurred_at`);
--> statement-breakpoint
CREATE TRIGGER records_schedule_insert BEFORE INSERT ON records WHEN NEW.schedule_item_id IS NOT NULL BEGIN
  SELECT CASE WHEN NEW.kind NOT IN ('project','observation') OR NEW.item_id IS NOT NULL OR NEW.loan_id IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM project_schedule_items s WHERE s.id=NEW.schedule_item_id AND s.project_id=NEW.project_id)
    THEN RAISE(ABORT,'record_schedule_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER records_schedule_update BEFORE UPDATE OF schedule_item_id,project_id,kind,item_id,loan_id ON records WHEN NEW.schedule_item_id IS NOT NULL BEGIN
  SELECT CASE WHEN NEW.kind NOT IN ('project','observation') OR NEW.item_id IS NOT NULL OR NEW.loan_id IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM project_schedule_items s WHERE s.id=NEW.schedule_item_id AND s.project_id=NEW.project_id)
    THEN RAISE(ABORT,'record_schedule_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER records_schedule_project_keep BEFORE UPDATE OF project_id ON project_schedule_items
WHEN NEW.project_id IS NOT OLD.project_id AND EXISTS (SELECT 1 FROM records r WHERE r.schedule_item_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT,'record_schedule_mismatch');
END;
