-- Internal organization/project workflow. Teams never grant application access.
CREATE TABLE followup_teams (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX followup_teams_org_idx ON followup_teams(organization_id,status,name);
--> statement-breakpoint
CREATE TABLE followup_team_members (
 id TEXT PRIMARY KEY NOT NULL, team_id TEXT NOT NULL REFERENCES followup_teams(id), user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 added_by TEXT NOT NULL, created_at TEXT NOT NULL, removed_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX followup_team_member_active_idx ON followup_team_members(team_id,user_id) WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE TABLE followup_tasks (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), project_id TEXT REFERENCES projects(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160), body TEXT NOT NULL DEFAULT '' CHECK(length(body)<=4000),
 priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','blocked','completed','cancelled')), due_at TEXT,
 campaign_id TEXT REFERENCES campaigns(id), item_id TEXT REFERENCES items(id), loan_id TEXT REFERENCES loans(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(project_id IS NOT NULL OR (campaign_id IS NULL AND item_id IS NULL AND loan_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX followup_tasks_scope_idx ON followup_tasks(organization_id,project_id,status,updated_at,id);
--> statement-breakpoint
CREATE TABLE followup_assignees (
 id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL REFERENCES followup_tasks(id), user_id TEXT REFERENCES portal_users(user_id),
 team_id TEXT REFERENCES followup_teams(id), created_at TEXT NOT NULL, removed_at TEXT,
 CHECK((user_id IS NULL)!=(team_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX followup_assignee_active_idx ON followup_assignees(task_id,COALESCE(user_id,''),COALESCE(team_id,'')) WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE TABLE followup_history (
 id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL REFERENCES followup_tasks(id), version INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX followup_history_version_idx ON followup_history(task_id,version);
--> statement-breakpoint
CREATE TABLE followup_checklists (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), project_id TEXT NOT NULL REFERENCES projects(id),
 campaign_id TEXT REFERENCES campaigns(id), task_id TEXT NOT NULL UNIQUE REFERENCES followup_tasks(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160), status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE followup_checklist_items (
 id TEXT PRIMARY KEY NOT NULL, checklist_id TEXT NOT NULL REFERENCES followup_checklists(id), item_id TEXT NOT NULL REFERENCES items(id),
 size TEXT NOT NULL DEFAULT '' CHECK(length(size)<=40), expected INTEGER NOT NULL CHECK(expected BETWEEN 0 AND 1000000),
 counted INTEGER CHECK(counted IS NULL OR counted BETWEEN 0 AND 1000000), damaged INTEGER NOT NULL DEFAULT 0 CHECK(damaged>=0),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=600),
 CHECK((counted IS NULL AND damaged=0) OR (counted IS NOT NULL AND damaged<=counted)),
 UNIQUE(checklist_id,item_id,size)
);
--> statement-breakpoint
CREATE TABLE followup_checklist_actions (
 checklist_id TEXT NOT NULL REFERENCES followup_checklists(id), row_id TEXT NOT NULL REFERENCES followup_checklist_items(id),
 task_id TEXT NOT NULL UNIQUE REFERENCES followup_tasks(id), PRIMARY KEY(checklist_id,row_id)
);
--> statement-breakpoint
CREATE TABLE followup_notifications (
 id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL REFERENCES followup_tasks(id), user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 cause_key TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL, UNIQUE(task_id,user_id,cause_key)
);
--> statement-breakpoint
CREATE INDEX followup_notifications_inbox_idx ON followup_notifications(user_id,read_at,created_at,id);
--> statement-breakpoint
-- Explicit task-only delegation; neither membership in a team nor assignment grants it.
CREATE TABLE followup_work_grants (
 id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL REFERENCES followup_tasks(id), user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 grantor_member_id TEXT NOT NULL REFERENCES members(id), created_by TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX followup_work_grants_active_idx ON followup_work_grants(task_id,user_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
-- Defense in depth for stored relationships; all authorization is also checked live.
CREATE TRIGGER followup_task_scope_insert BEFORE INSERT ON followup_tasks BEGIN
 SELECT CASE WHEN NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND organization_id=NEW.organization_id) THEN RAISE(ABORT,'followup_scope_mismatch') END;
 SELECT CASE WHEN NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campaigns WHERE id=NEW.campaign_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
 SELECT CASE WHEN NEW.item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM items WHERE id=NEW.item_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
 SELECT CASE WHEN NEW.loan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM loans WHERE id=NEW.loan_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER followup_task_scope_update BEFORE UPDATE OF organization_id,project_id,campaign_id,item_id,loan_id ON followup_tasks BEGIN
 SELECT CASE WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id THEN RAISE(ABORT,'followup_scope_immutable') END;
 SELECT CASE WHEN NEW.campaign_id IS NOT OLD.campaign_id AND EXISTS(SELECT 1 FROM followup_checklists WHERE task_id=OLD.id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
 SELECT CASE WHEN NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campaigns WHERE id=NEW.campaign_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
 SELECT CASE WHEN NEW.item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM items WHERE id=NEW.item_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
 SELECT CASE WHEN NEW.loan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM loans WHERE id=NEW.loan_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER followup_team_scope_update BEFORE UPDATE OF organization_id ON followup_teams BEGIN SELECT RAISE(ABORT,'followup_scope_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER followup_checklist_scope_insert BEFORE INSERT ON followup_checklists BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup_tasks t WHERE t.id=NEW.task_id AND t.organization_id=NEW.organization_id AND t.project_id=NEW.project_id AND t.campaign_id IS NEW.campaign_id) THEN RAISE(ABORT,'followup_scope_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER followup_checklist_item_insert BEFORE INSERT ON followup_checklist_items BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup_checklists c JOIN items i ON i.project_id=c.project_id WHERE c.id=NEW.checklist_id AND i.id=NEW.item_id) THEN RAISE(ABORT,'followup_reference_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER followup_checklist_item_update BEFORE UPDATE OF checklist_id,item_id,size ON followup_checklist_items BEGIN SELECT RAISE(ABORT,'followup_scope_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER followup_checklist_scope_update BEFORE UPDATE OF organization_id,project_id,campaign_id,task_id ON followup_checklists BEGIN SELECT RAISE(ABORT,'followup_scope_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER followup_assignee_scope_insert BEFORE INSERT ON followup_assignees WHEN NEW.team_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup_tasks t JOIN followup_teams team ON team.organization_id=t.organization_id WHERE t.id=NEW.task_id AND team.id=NEW.team_id) THEN RAISE(ABORT,'followup_scope_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER followup_checklist_action_insert BEFORE INSERT ON followup_checklist_actions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup_checklists c JOIN followup_checklist_items r ON r.checklist_id=c.id JOIN followup_tasks t ON t.project_id=c.project_id AND t.organization_id=c.organization_id WHERE c.id=NEW.checklist_id AND r.id=NEW.row_id AND t.id=NEW.task_id) THEN RAISE(ABORT,'followup_scope_mismatch') END;
END;
