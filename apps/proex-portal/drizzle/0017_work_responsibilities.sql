-- Explicit organizational duties. These records NEVER grant application access.
CREATE TABLE work_responsibility_scopes (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), project_id TEXT NOT NULL REFERENCES projects(id),
 area TEXT NOT NULL CHECK(area IN ('projects','materials','loans','campaigns')),
 item_id TEXT REFERENCES items(id), loan_id TEXT REFERENCES loans(id), campaign_id TEXT REFERENCES campaigns(id),
 target_key TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(target_key=COALESCE(item_id,loan_id,campaign_id,'')),
 CHECK((area='projects' AND item_id IS NULL AND loan_id IS NULL AND campaign_id IS NULL)
 OR (area='materials' AND loan_id IS NULL AND campaign_id IS NULL)
 OR (area='loans' AND item_id IS NULL AND campaign_id IS NULL)
 OR (area='campaigns' AND item_id IS NULL AND loan_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX work_responsibility_target_idx ON work_responsibility_scopes(project_id,area,target_key);
--> statement-breakpoint
CREATE INDEX work_responsibility_scope_idx ON work_responsibility_scopes(organization_id,project_id,status,area,id);
--> statement-breakpoint
CREATE TABLE work_responsibility_assignees (
 id TEXT PRIMARY KEY NOT NULL, scope_id TEXT NOT NULL REFERENCES work_responsibility_scopes(id),
 user_id TEXT REFERENCES portal_users(user_id), team_id TEXT REFERENCES followup_teams(id),
 created_at TEXT NOT NULL, revoked_at TEXT,
 CHECK((user_id IS NULL)!=(team_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX work_responsibility_person_idx ON work_responsibility_assignees(scope_id,user_id) WHERE revoked_at IS NULL AND user_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX work_responsibility_team_idx ON work_responsibility_assignees(scope_id,team_id) WHERE revoked_at IS NULL AND team_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX work_responsibility_user_idx ON work_responsibility_assignees(user_id,revoked_at,scope_id);
--> statement-breakpoint
CREATE TABLE work_responsibility_history (
 id TEXT PRIMARY KEY NOT NULL, scope_id TEXT NOT NULL REFERENCES work_responsibility_scopes(id), version INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(scope_id,version)
);
--> statement-breakpoint
CREATE TRIGGER work_responsibility_scope_insert BEFORE INSERT ON work_responsibility_scopes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND organization_id=NEW.organization_id) THEN RAISE(ABORT,'responsibility_scope_mismatch') END;
 SELECT CASE WHEN NEW.item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM items WHERE id=NEW.item_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'responsibility_target_mismatch') END;
 SELECT CASE WHEN NEW.loan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM loans WHERE id=NEW.loan_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'responsibility_target_mismatch') END;
 SELECT CASE WHEN NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campaigns WHERE id=NEW.campaign_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'responsibility_target_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER work_responsibility_scope_update BEFORE UPDATE OF organization_id,project_id,area,item_id,loan_id,campaign_id,target_key ON work_responsibility_scopes BEGIN
 SELECT RAISE(ABORT,'responsibility_scope_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER work_responsibility_team_insert BEFORE INSERT ON work_responsibility_assignees WHEN NEW.team_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM work_responsibility_scopes s JOIN followup_teams team ON team.organization_id=s.organization_id WHERE s.id=NEW.scope_id AND team.id=NEW.team_id) THEN RAISE(ABORT,'responsibility_team_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER work_responsibility_assignee_update BEFORE UPDATE OF scope_id,user_id,team_id ON work_responsibility_assignees BEGIN SELECT RAISE(ABORT,'responsibility_scope_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER work_responsibility_history_update BEFORE UPDATE ON work_responsibility_history BEGIN SELECT RAISE(ABORT,'responsibility_history_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER work_responsibility_history_delete BEFORE DELETE ON work_responsibility_history BEGIN SELECT RAISE(ABORT,'responsibility_history_immutable'); END;
