-- Preserving transfer of a SIMPLE follow-up task between two active projects of the
-- same organization. The task keeps its id, history, assignees and notifications.
-- A transfer is authorized only by an immutable receipt inserted in the SAME atomic
-- batch as the task UPDATE; the receipt is settled by trigger on the very next task
-- update, so a pending receipt can never be reused later. Foreign keys and all
-- original 0014 validations remain in force.
CREATE TABLE followup_task_transfers (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 200),
 task_id TEXT NOT NULL REFERENCES followup_tasks(id),
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 source_project_id TEXT NOT NULL REFERENCES projects(id),
 dest_project_id TEXT NOT NULL REFERENCES projects(id),
 from_version INTEGER NOT NULL CHECK(typeof(from_version)='integer' AND from_version>0),
 to_version INTEGER NOT NULL CHECK(typeof(to_version)='integer'),
 actor_id TEXT NOT NULL REFERENCES portal_users(user_id),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500 AND reason=trim(reason)),
 operation_hash TEXT NOT NULL CHECK(length(operation_hash)=64),
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','applied','void')),
 created_at TEXT NOT NULL,
 applied_at TEXT,
 CHECK(source_project_id<>dest_project_id),
 CHECK(to_version=from_version+1),
 CHECK((state='pending')=(applied_at IS NULL)),
 UNIQUE(actor_id,operation_hash)
);
--> statement-breakpoint
CREATE INDEX followup_task_transfers_task_idx ON followup_task_transfers(task_id,created_at,id);
--> statement-breakpoint
CREATE UNIQUE INDEX followup_task_transfers_pending_idx ON followup_task_transfers(task_id) WHERE state='pending';
--> statement-breakpoint
-- Receipts are born pending, only for a currently simple task at the captured version,
-- between two distinct active projects of the same active organization, by an active
-- account holding a live owner/manager membership in that organization.
CREATE TRIGGER followup_task_transfer_insert BEFORE INSERT ON followup_task_transfers BEGIN
 SELECT CASE WHEN NEW.state<>'pending' OR NEW.applied_at IS NOT NULL THEN RAISE(ABORT,'followup_transfer_invalid') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup_tasks t WHERE t.id=NEW.task_id AND t.organization_id=NEW.organization_id AND t.project_id=NEW.source_project_id AND t.version=NEW.from_version AND t.campaign_id IS NULL AND t.item_id IS NULL AND t.loan_id IS NULL) THEN RAISE(ABORT,'followup_transfer_conflict') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM followup_checklists WHERE task_id=NEW.task_id) OR EXISTS(SELECT 1 FROM followup_checklist_actions WHERE task_id=NEW.task_id) THEN RAISE(ABORT,'followup_transfer_linked') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM organizations o WHERE o.id=NEW.organization_id AND o.status='active')
  OR NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.source_project_id AND p.organization_id=NEW.organization_id AND p.status='active')
  OR NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.dest_project_id AND p.organization_id=NEW.organization_id AND p.status='active') THEN RAISE(ABORT,'followup_transfer_scope') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members m JOIN portal_users u ON u.user_id=m.user_id WHERE m.user_id=NEW.actor_id AND m.revoked_at IS NULL AND m.role IN ('owner','manager')
  AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL
  AND ((m.project_id=NEW.source_project_id AND (m.organization_id IS NULL OR m.organization_id=NEW.organization_id))
   OR (m.project_id IS NULL AND (m.organization_id=NEW.organization_id OR (m.organization_id IS NULL AND m.role='owner'))))) OR NOT EXISTS(SELECT 1 FROM members m JOIN portal_users u ON u.user_id=m.user_id WHERE m.user_id=NEW.actor_id AND m.revoked_at IS NULL AND m.role IN ('owner','manager')
  AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL
  AND ((m.project_id=NEW.dest_project_id AND (m.organization_id IS NULL OR m.organization_id=NEW.organization_id))
   OR (m.project_id IS NULL AND (m.organization_id=NEW.organization_id OR (m.organization_id IS NULL AND m.role='owner'))))) THEN RAISE(ABORT,'followup_transfer_forbidden') END;
END;
--> statement-breakpoint
-- Immutable: the only change is pending -> applied (task really at destination/to_version)
-- or pending -> void. Every other column is frozen. Receipts are never deleted.
CREATE TRIGGER followup_task_transfer_update BEFORE UPDATE ON followup_task_transfers BEGIN
 SELECT CASE WHEN OLD.state<>'pending' OR NEW.state NOT IN ('applied','void') OR NEW.applied_at IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.task_id IS NOT OLD.task_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.source_project_id IS NOT OLD.source_project_id OR NEW.dest_project_id IS NOT OLD.dest_project_id
  OR NEW.from_version IS NOT OLD.from_version OR NEW.to_version IS NOT OLD.to_version OR NEW.actor_id IS NOT OLD.actor_id
  OR NEW.reason IS NOT OLD.reason OR NEW.operation_hash IS NOT OLD.operation_hash OR NEW.fingerprint IS NOT OLD.fingerprint
  OR NEW.created_at IS NOT OLD.created_at THEN RAISE(ABORT,'followup_transfer_immutable') END;
 SELECT CASE WHEN NEW.state='applied' AND NOT EXISTS(SELECT 1 FROM followup_tasks t WHERE t.id=OLD.task_id AND t.organization_id=OLD.organization_id AND t.project_id=OLD.dest_project_id AND t.version=OLD.to_version) THEN RAISE(ABORT,'followup_transfer_immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER followup_task_transfer_delete BEFORE DELETE ON followup_task_transfers BEGIN SELECT RAISE(ABORT,'followup_transfer_immutable'); END;
--> statement-breakpoint
-- Replaces ONLY the 0014 scope trigger. Every original validation is kept verbatim;
-- the single extension is that project_id may change when (and only when) a matching
-- pending receipt exists for exactly OLD.version -> NEW.version and OLD -> NEW project,
-- inside the same organization, for a task without any checklist or resource link.
DROP TRIGGER followup_task_scope_update;
--> statement-breakpoint
CREATE TRIGGER followup_task_scope_update BEFORE UPDATE OF organization_id,project_id,campaign_id,item_id,loan_id ON followup_tasks BEGIN
 SELECT CASE WHEN NEW.organization_id IS NOT OLD.organization_id THEN RAISE(ABORT,'followup_scope_immutable') END;
 SELECT CASE WHEN NEW.project_id IS NOT OLD.project_id AND NOT (
  OLD.project_id IS NOT NULL AND NEW.project_id IS NOT NULL
  AND OLD.campaign_id IS NULL AND OLD.item_id IS NULL AND OLD.loan_id IS NULL
  AND NEW.campaign_id IS NULL AND NEW.item_id IS NULL AND NEW.loan_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM followup_checklists WHERE task_id=OLD.id)
  AND NOT EXISTS(SELECT 1 FROM followup_checklist_actions WHERE task_id=OLD.id)
  AND EXISTS(SELECT 1 FROM projects dest WHERE dest.id=NEW.project_id AND dest.organization_id=NEW.organization_id AND dest.status='active')
  AND EXISTS(SELECT 1 FROM followup_task_transfers r WHERE r.task_id=OLD.id AND r.state='pending' AND r.organization_id=OLD.organization_id
   AND r.source_project_id=OLD.project_id AND r.dest_project_id=NEW.project_id AND r.from_version=OLD.version AND r.to_version=NEW.version)
 ) THEN RAISE(ABORT,'followup_scope_immutable') END;
 SELECT CASE WHEN NEW.campaign_id IS NOT OLD.campaign_id AND EXISTS(SELECT 1 FROM followup_checklists WHERE task_id=OLD.id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
 SELECT CASE WHEN NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campaigns WHERE id=NEW.campaign_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
 SELECT CASE WHEN NEW.item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM items WHERE id=NEW.item_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
 SELECT CASE WHEN NEW.loan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM loans WHERE id=NEW.loan_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
END;
--> statement-breakpoint
-- Settles any pending receipt on the next task update: applied only for the exact
-- captured move, otherwise void. A pending receipt cannot outlive its batch's UPDATE.
CREATE TRIGGER followup_task_transfer_settle AFTER UPDATE ON followup_tasks
 WHEN EXISTS(SELECT 1 FROM followup_task_transfers WHERE task_id=NEW.id AND state='pending') BEGIN
 UPDATE followup_task_transfers SET
  state=CASE WHEN OLD.project_id=source_project_id AND NEW.project_id=dest_project_id AND OLD.version=from_version AND NEW.version=to_version AND NEW.organization_id=organization_id THEN 'applied' ELSE 'void' END,
  applied_at=COALESCE(NEW.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE task_id=NEW.id AND state='pending';
END;
