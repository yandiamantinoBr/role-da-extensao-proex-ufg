-- Generic activity verification reuses the task scope, grants and completion gate.
ALTER TABLE followup_checklists ADD COLUMN kind TEXT NOT NULL DEFAULT 'materials' CHECK(kind IN ('materials','activity'));
--> statement-breakpoint
CREATE TABLE followup_checklist_steps (
 id TEXT PRIMARY KEY NOT NULL,
 checklist_id TEXT NOT NULL REFERENCES followup_checklists(id),
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 99),
 label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 160),
 answer TEXT CHECK(answer IS NULL OR answer IN ('yes','no','not_applicable')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=600),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at TEXT NOT NULL,
 UNIQUE(checklist_id,position)
);
--> statement-breakpoint
CREATE TRIGGER followup_checklist_kind_immutable BEFORE UPDATE OF kind ON followup_checklists
 BEGIN SELECT RAISE(ABORT,'followup_scope_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER followup_material_checklist_kind BEFORE INSERT ON followup_checklist_items BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup_checklists WHERE id=NEW.checklist_id AND kind='materials') THEN RAISE(ABORT,'followup_reference_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER followup_activity_checklist_kind BEFORE INSERT ON followup_checklist_steps BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup_checklists WHERE id=NEW.checklist_id AND kind='activity' AND status='open') THEN RAISE(ABORT,'followup_reference_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER followup_activity_step_immutable BEFORE UPDATE OF checklist_id,position,label ON followup_checklist_steps
 BEGIN SELECT RAISE(ABORT,'followup_scope_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER followup_activity_step_open BEFORE UPDATE OF answer,note ON followup_checklist_steps BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup_checklists c JOIN followup_tasks t ON t.id=c.task_id WHERE c.id=NEW.checklist_id AND c.kind='activity' AND c.status='open' AND t.status IN ('open','in_progress','blocked')) THEN RAISE(ABORT,'followup_version_changed') END;
END;
