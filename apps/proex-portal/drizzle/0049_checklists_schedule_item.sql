ALTER TABLE followup_checklists ADD COLUMN schedule_item_id text REFERENCES project_schedule_items(id);
--> statement-breakpoint
CREATE INDEX followup_checklists_schedule_idx ON followup_checklists (schedule_item_id, task_id);
--> statement-breakpoint
CREATE TRIGGER followup_checklists_schedule_insert BEFORE INSERT ON followup_checklists WHEN NEW.schedule_item_id IS NOT NULL BEGIN
  SELECT CASE WHEN NEW.kind != 'activity' OR NOT EXISTS (
    SELECT 1 FROM project_schedule_items s
    JOIN projects p ON p.id=s.project_id
    JOIN followup_tasks t ON t.id=NEW.task_id
    WHERE s.id=NEW.schedule_item_id AND s.project_id=NEW.project_id
      AND p.organization_id=NEW.organization_id AND t.project_id=NEW.project_id AND t.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'checklist_schedule_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER followup_checklists_schedule_update BEFORE UPDATE OF schedule_item_id,project_id,organization_id,task_id,kind ON followup_checklists
WHEN OLD.schedule_item_id IS NOT NULL OR NEW.schedule_item_id IS NOT NULL BEGIN
  SELECT CASE WHEN (OLD.schedule_item_id IS NOT NULL AND NEW.schedule_item_id IS NOT OLD.schedule_item_id)
    OR NEW.kind != 'activity' OR NOT EXISTS (
    SELECT 1 FROM project_schedule_items s
    JOIN projects p ON p.id=s.project_id
    JOIN followup_tasks t ON t.id=NEW.task_id
    WHERE s.id=NEW.schedule_item_id AND s.project_id=NEW.project_id
      AND p.organization_id=NEW.organization_id AND t.project_id=NEW.project_id AND t.organization_id=NEW.organization_id
  ) THEN RAISE(ABORT,'checklist_schedule_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER followup_checklists_schedule_keep BEFORE UPDATE OF project_id ON project_schedule_items
WHEN NEW.project_id IS NOT OLD.project_id AND EXISTS (SELECT 1 FROM followup_checklists c WHERE c.schedule_item_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT,'checklist_schedule_mismatch');
END;
