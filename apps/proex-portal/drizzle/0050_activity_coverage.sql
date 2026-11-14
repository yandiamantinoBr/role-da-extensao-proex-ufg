ALTER TABLE followup_work_grants ADD COLUMN can_record_activity integer NOT NULL DEFAULT 0 CHECK(can_record_activity IN (0,1));
--> statement-breakpoint
ALTER TABLE followup_work_grants ADD COLUMN coverage_grantor_member_id text REFERENCES members(id);
--> statement-breakpoint
ALTER TABLE records ADD COLUMN coverage_task_id text REFERENCES followup_tasks(id);
--> statement-breakpoint
CREATE TRIGGER records_coverage_insert BEFORE INSERT ON records WHEN NEW.coverage_task_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.schedule_item_id IS NULL OR NEW.kind NOT IN ('project','observation') OR NOT EXISTS(
    SELECT 1 FROM followup_checklists c JOIN followup_tasks t ON t.id=c.task_id
    WHERE t.id=NEW.coverage_task_id AND t.project_id=NEW.project_id AND c.project_id=NEW.project_id
      AND c.kind='activity' AND c.schedule_item_id=NEW.schedule_item_id
  ) THEN RAISE(ABORT,'record_coverage_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER records_coverage_keep BEFORE UPDATE OF coverage_task_id,project_id,schedule_item_id ON records
WHEN OLD.coverage_task_id IS NOT NULL OR NEW.coverage_task_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.coverage_task_id IS NOT OLD.coverage_task_id OR NEW.project_id IS NOT OLD.project_id
    OR NEW.schedule_item_id IS NOT OLD.schedule_item_id
  THEN RAISE(ABORT,'record_coverage_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER coverage_member_access_lost AFTER UPDATE OF revoked_at,role ON members
WHEN OLD.revoked_at IS NULL AND OLD.role IN ('owner','manager','viewer')
  AND (NEW.revoked_at IS NOT NULL OR NEW.role NOT IN ('owner','manager','viewer'))
BEGIN
  UPDATE followup_work_grants SET can_record_activity=0
  WHERE can_record_activity=1 AND revoked_at IS NULL
    AND ((grantor_member_id=OLD.id OR coverage_grantor_member_id=OLD.id) AND (NEW.revoked_at IS NOT NULL OR NEW.role NOT IN ('owner','manager'))
      OR user_id=OLD.user_id AND task_id IN (
        SELECT t.id FROM followup_tasks t JOIN projects p ON p.id=t.project_id
        WHERE (OLD.project_id=p.id OR (OLD.project_id IS NULL AND (OLD.organization_id=p.organization_id
          OR (OLD.organization_id IS NULL AND OLD.role='owner'))))
        AND NOT EXISTS(SELECT 1 FROM members m WHERE m.user_id=OLD.user_id AND m.revoked_at IS NULL
          AND m.role IN ('owner','manager','viewer') AND (m.project_id=p.id OR (m.project_id IS NULL
          AND (m.organization_id=p.organization_id OR (m.organization_id IS NULL AND m.role='owner')))))
      ));
END;
--> statement-breakpoint
CREATE TRIGGER coverage_account_access_lost AFTER UPDATE OF status,activation_pending,anonymized_at ON portal_users
WHEN NEW.status!='active' OR NEW.activation_pending!=0 OR NEW.anonymized_at IS NOT NULL
BEGIN
  UPDATE followup_work_grants SET can_record_activity=0
    WHERE can_record_activity=1 AND revoked_at IS NULL AND (user_id=NEW.user_id OR created_by=NEW.user_id
      OR coverage_grantor_member_id IN (SELECT id FROM members WHERE user_id=NEW.user_id));
END;
--> statement-breakpoint
CREATE TRIGGER coverage_team_assignment_lost AFTER UPDATE OF removed_at ON followup_team_members
WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL
BEGIN
  UPDATE followup_work_grants SET can_record_activity=0
  WHERE can_record_activity=1 AND revoked_at IS NULL AND user_id=OLD.user_id
    AND task_id IN (SELECT task_id FROM followup_assignees WHERE team_id=OLD.team_id AND removed_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM followup_assignees a
      LEFT JOIN followup_teams ft ON ft.id=a.team_id AND ft.status='active'
      LEFT JOIN followup_team_members fm ON fm.team_id=ft.id AND fm.user_id=OLD.user_id AND fm.removed_at IS NULL
      WHERE a.task_id=followup_work_grants.task_id AND a.removed_at IS NULL AND (a.user_id=OLD.user_id OR fm.id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER coverage_team_archived AFTER UPDATE OF status ON followup_teams
WHEN OLD.status='active' AND NEW.status!='active'
BEGIN
  UPDATE followup_work_grants SET can_record_activity=0
  WHERE can_record_activity=1 AND revoked_at IS NULL
    AND task_id IN (SELECT task_id FROM followup_assignees WHERE team_id=OLD.id AND removed_at IS NULL)
    AND user_id IN (SELECT user_id FROM followup_team_members WHERE team_id=OLD.id AND removed_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM followup_assignees a
      LEFT JOIN followup_teams ft ON ft.id=a.team_id AND ft.status='active'
      LEFT JOIN followup_team_members fm ON fm.team_id=ft.id AND fm.user_id=followup_work_grants.user_id AND fm.removed_at IS NULL
      WHERE a.task_id=followup_work_grants.task_id AND a.removed_at IS NULL
      AND (a.user_id=followup_work_grants.user_id OR fm.id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER coverage_schedule_closed AFTER UPDATE OF status ON project_schedule_items
WHEN NEW.status='cancelled' AND OLD.status!='cancelled'
BEGIN
  UPDATE followup_work_grants SET can_record_activity=0
    WHERE can_record_activity=1 AND revoked_at IS NULL
      AND task_id IN (SELECT task_id FROM followup_checklists WHERE schedule_item_id=NEW.id);
END;
