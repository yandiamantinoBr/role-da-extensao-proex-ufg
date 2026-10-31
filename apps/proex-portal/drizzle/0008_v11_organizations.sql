-- Organizations are security boundaries; organizational_units remains a shared UFG catalog.
CREATE TABLE organizations (
 id text PRIMARY KEY NOT NULL, name text NOT NULL, slug text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at text NOT NULL, updated_at text NOT NULL
);
--> statement-breakpoint
INSERT INTO organizations(id,name,slug,created_at,updated_at)
 VALUES('org_proex','PROEX UFG','proex',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
-- SQLite cannot add a non-null REFERENCES column with a non-null default to populated tables.
-- Add the real FK first, backfill existing projects, then enforce non-null via triggers.
ALTER TABLE projects ADD organization_id text REFERENCES organizations(id);
--> statement-breakpoint
UPDATE projects SET organization_id='org_proex';
--> statement-breakpoint
ALTER TABLE members ADD organization_id text REFERENCES organizations(id);
--> statement-breakpoint
ALTER TABLE invites ADD organization_id text REFERENCES organizations(id);
--> statement-breakpoint
ALTER TABLE audit ADD organization_id text REFERENCES organizations(id);
--> statement-breakpoint
UPDATE audit SET organization_id=(SELECT organization_id FROM projects WHERE projects.id=audit.project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE organization_grant_migrations (
 member_id text PRIMARY KEY NOT NULL, user_id text NOT NULL, previous_role text NOT NULL,
 previous_project_id text, previous_revoked_at text, organization_id text REFERENCES organizations(id),
 classification text NOT NULL CHECK(classification IN ('platform_owner','legacy_organization','project')),
 migration text NOT NULL, migrated_at text NOT NULL
);
--> statement-breakpoint
INSERT INTO organization_grant_migrations
 SELECT id,user_id,role,project_id,revoked_at,CASE WHEN role='owner' THEN NULL ELSE 'org_proex' END,
 CASE WHEN role='owner' THEN 'platform_owner' WHEN project_id IS NULL THEN 'legacy_organization' ELSE 'project' END,
 '0008_v11_organizations',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM members;
--> statement-breakpoint
UPDATE members SET organization_id='org_proex' WHERE role!='owner';
--> statement-breakpoint
UPDATE invites SET organization_id='org_proex';
--> statement-breakpoint
DROP INDEX members_active_scope_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX members_active_scope_unique ON members(user_id,COALESCE(organization_id,''),COALESCE(project_id,'')) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX projects_organization_idx ON projects(organization_id,id);
--> statement-breakpoint
CREATE INDEX members_organization_idx ON members(organization_id,user_id,revoked_at);
--> statement-breakpoint
CREATE TRIGGER organization_project_insert BEFORE INSERT ON projects BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM organizations WHERE id=COALESCE(NEW.organization_id,'org_proex')) THEN RAISE(ABORT,'organization_not_found') END;
 SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.parent_id AND p.organization_id=COALESCE(NEW.organization_id,'org_proex')) THEN RAISE(ABORT,'organization_parent_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_project_fill AFTER INSERT ON projects WHEN NEW.organization_id IS NULL BEGIN
 UPDATE projects SET organization_id='org_proex' WHERE id=NEW.id;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=NEW.id AND organization_id IS NULL) THEN RAISE(ABORT,'organization_project_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_project_update BEFORE UPDATE OF organization_id,parent_id ON projects BEGIN
 SELECT CASE WHEN NEW.organization_id IS NULL OR (OLD.organization_id IS NOT NULL AND NEW.organization_id IS NOT OLD.organization_id) THEN RAISE(ABORT,'organization_transfer_requires_review') END;
 SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.parent_id AND p.organization_id=NEW.organization_id) THEN RAISE(ABORT,'organization_parent_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_member_insert BEFORE INSERT ON members WHEN NEW.project_id IS NOT NULL AND NEW.organization_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.organization_id=NEW.organization_id) THEN RAISE(ABORT,'organization_member_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_member_fill AFTER INSERT ON members WHEN NEW.organization_id IS NULL AND NEW.role!='owner' BEGIN
 UPDATE members SET organization_id=COALESCE((SELECT organization_id FROM projects WHERE id=NEW.project_id),'org_proex') WHERE id=NEW.id;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM members WHERE id=NEW.id AND organization_id IS NULL) THEN RAISE(ABORT,'organization_member_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_member_update BEFORE UPDATE OF organization_id,project_id,role ON members BEGIN
 SELECT CASE WHEN OLD.organization_id IS NOT NULL AND (NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id) THEN RAISE(ABORT,'organization_grant_scope_immutable') END;
 SELECT CASE WHEN NEW.role!='owner' AND NEW.organization_id IS NULL THEN RAISE(ABORT,'organization_member_required') END;
 SELECT CASE WHEN NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.organization_id=NEW.organization_id) THEN RAISE(ABORT,'organization_member_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_invite_insert BEFORE INSERT ON invites WHEN NEW.project_id IS NOT NULL AND NEW.organization_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.organization_id=NEW.organization_id) THEN RAISE(ABORT,'organization_invite_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_invite_fill AFTER INSERT ON invites WHEN NEW.organization_id IS NULL BEGIN
 UPDATE invites SET organization_id=COALESCE((SELECT organization_id FROM projects WHERE id=NEW.project_id),'org_proex') WHERE id=NEW.id;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM invites WHERE id=NEW.id AND organization_id IS NULL) THEN RAISE(ABORT,'organization_invite_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_invite_update BEFORE UPDATE OF organization_id,project_id ON invites BEGIN
 SELECT CASE WHEN OLD.organization_id IS NOT NULL AND (NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id) THEN RAISE(ABORT,'organization_invite_scope_immutable') END;
 SELECT CASE WHEN NEW.organization_id IS NULL THEN RAISE(ABORT,'organization_invite_required') END;
 SELECT CASE WHEN NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.organization_id=NEW.organization_id) THEN RAISE(ABORT,'organization_invite_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_audit_fill AFTER INSERT ON audit WHEN NEW.project_id IS NOT NULL AND NEW.organization_id IS NULL BEGIN
 UPDATE audit SET organization_id=(SELECT organization_id FROM projects WHERE id=NEW.project_id) WHERE id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER organization_call_link_insert BEFORE INSERT ON project_calls BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM calls c JOIN projects source ON source.id=c.project_id JOIN projects target ON target.id=NEW.project_id WHERE c.id=NEW.call_id AND source.organization_id=target.organization_id) THEN RAISE(ABORT,'organization_call_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_call_link_update BEFORE UPDATE ON project_calls BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM calls c JOIN projects source ON source.id=c.project_id JOIN projects target ON target.id=NEW.project_id WHERE c.id=NEW.call_id AND source.organization_id=target.organization_id) THEN RAISE(ABORT,'organization_call_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER organization_grant_trace_update BEFORE UPDATE ON organization_grant_migrations BEGIN SELECT RAISE(ABORT,'organization_trace_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER organization_grant_trace_delete BEFORE DELETE ON organization_grant_migrations BEGIN SELECT RAISE(ABORT,'organization_trace_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER organization_delete_guard BEFORE DELETE ON organizations WHEN EXISTS(SELECT 1 FROM projects WHERE organization_id=OLD.id) BEGIN SELECT RAISE(ABORT,'organization_has_projects'); END;
--> statement-breakpoint
CREATE TRIGGER organization_id_immutable BEFORE UPDATE OF id ON organizations BEGIN SELECT RAISE(ABORT,'organization_id_immutable'); END;
