-- Dedicated read-only team + project files. No production files, identities or credentials are seeded.
-- Abort on pre-existing master/project collisions; never repair or discard legacy data implicitly.
SELECT CASE WHEN EXISTS(SELECT 1 FROM project_sheet_connections p JOIN settings s ON s.name='sync.google_sheets.configuration' AND CASE WHEN json_valid(s.value) THEN json_extract(s.value,'$.spreadsheetId') END=p.spreadsheet_id)
 THEN json_extract('[]','legacy_master_project_workbook_collision') ELSE 1 END;

CREATE TABLE team_sheet_connections (
 id TEXT PRIMARY KEY NOT NULL,
 team_id TEXT NOT NULL REFERENCES followup_teams(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 spreadsheet_id TEXT NOT NULL,
 label TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CONSTRAINT team_sheet_enabled CHECK(enabled IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1 CONSTRAINT team_sheet_version CHECK(version>0),
 sheet_gid INTEGER CONSTRAINT team_sheet_gid CHECK(sheet_gid IS NULL OR sheet_gid BETWEEN 0 AND 2147483647),
 tabs_version INTEGER NOT NULL DEFAULT 0 CONSTRAINT team_sheet_tabs_version CHECK(tabs_version>=0),
 created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CONSTRAINT team_sheet_label CHECK(length(label) BETWEEN 1 AND 100),
 CONSTRAINT team_sheet_file_id CHECK(length(spreadsheet_id) BETWEEN 10 AND 200 AND spreadsheet_id NOT GLOB '*[^A-Za-z0-9_-]*')
);
CREATE UNIQUE INDEX team_sheet_scope_unique ON team_sheet_connections(team_id,project_id);
CREATE UNIQUE INDEX team_sheet_file_unique ON team_sheet_connections(spreadsheet_id);
CREATE TABLE team_sheet_tokens (
 id TEXT PRIMARY KEY NOT NULL,connection_id TEXT NOT NULL REFERENCES team_sheet_connections(id),
 connection_version INTEGER NOT NULL CONSTRAINT team_sheet_token_version CHECK(connection_version>0),
 token_hash TEXT NOT NULL CONSTRAINT team_sheet_token_hash CHECK(length(token_hash)=64),
 user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 member_id TEXT NOT NULL REFERENCES members(id),
 team_member_id TEXT NOT NULL REFERENCES followup_team_members(id),
 label TEXT NOT NULL CONSTRAINT team_sheet_token_label CHECK(length(label) BETWEEN 1 AND 80),
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,
 CONSTRAINT team_sheet_token_ttl CHECK(julianday(expires_at) IS NOT NULL AND julianday(created_at) IS NOT NULL AND julianday(expires_at)>julianday(created_at) AND julianday(expires_at)-julianday(created_at)<=30.00001)
);
CREATE UNIQUE INDEX team_sheet_token_hash_unique ON team_sheet_tokens(token_hash);
CREATE INDEX team_sheet_tokens_connection_idx ON team_sheet_tokens(connection_id,revoked_at,expires_at);
CREATE TABLE team_sheet_runs (
 id TEXT PRIMARY KEY NOT NULL,connection_id TEXT NOT NULL REFERENCES team_sheet_connections(id),
 token_id TEXT NOT NULL REFERENCES team_sheet_tokens(id),connection_version INTEGER NOT NULL,
 request_id TEXT NOT NULL,status TEXT NOT NULL CONSTRAINT team_sheet_run_status CHECK(status IN('running','completed','failed')),
 started_at TEXT NOT NULL,finished_at TEXT,
 snapshot_digest TEXT,expected_count INTEGER CONSTRAINT team_sheet_expected_count CHECK(expected_count IS NULL OR expected_count BETWEEN 0 AND 5000),
 exported_count INTEGER NOT NULL DEFAULT 0 CONSTRAINT team_sheet_exported_count CHECK(exported_count BETWEEN 0 AND 5000),
 readback_verified INTEGER NOT NULL DEFAULT 0 CONSTRAINT team_sheet_readback CHECK(readback_verified IN(0,1))
);
CREATE UNIQUE INDEX team_sheet_runs_request_unique ON team_sheet_runs(token_id,request_id);
CREATE INDEX team_sheet_runs_connection_idx ON team_sheet_runs(connection_id,started_at);

CREATE TRIGGER team_sheet_scope_insert BEFORE INSERT ON team_sheet_connections
WHEN NOT EXISTS(SELECT 1 FROM followup_teams t JOIN projects p ON p.organization_id=t.organization_id WHERE t.id=NEW.team_id AND p.id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'team_sheet_scope_mismatch'); END;
CREATE TRIGGER team_sheet_scope_update BEFORE UPDATE OF team_id,project_id ON team_sheet_connections
WHEN NEW.team_id!=OLD.team_id OR NEW.project_id!=OLD.project_id
BEGIN SELECT RAISE(ABORT,'team_sheet_scope_immutable'); END;
CREATE TRIGGER team_sheet_file_insert BEFORE INSERT ON team_sheet_connections
WHEN EXISTS(SELECT 1 FROM project_sheet_connections WHERE spreadsheet_id=NEW.spreadsheet_id)
 OR EXISTS(SELECT 1 FROM settings WHERE name='sync.google_sheets.configuration' AND CASE WHEN json_valid(value) THEN json_extract(value,'$.spreadsheetId') END=NEW.spreadsheet_id)
BEGIN SELECT RAISE(ABORT,'team_sheet_file_collision'); END;
CREATE TRIGGER team_sheet_file_update BEFORE UPDATE OF spreadsheet_id ON team_sheet_connections
WHEN EXISTS(SELECT 1 FROM project_sheet_connections WHERE spreadsheet_id=NEW.spreadsheet_id)
 OR EXISTS(SELECT 1 FROM settings WHERE name='sync.google_sheets.configuration' AND CASE WHEN json_valid(value) THEN json_extract(value,'$.spreadsheetId') END=NEW.spreadsheet_id)
BEGIN SELECT RAISE(ABORT,'team_sheet_file_collision'); END;
CREATE TRIGGER project_sheet_team_file_insert BEFORE INSERT ON project_sheet_connections
WHEN EXISTS(SELECT 1 FROM team_sheet_connections WHERE spreadsheet_id=NEW.spreadsheet_id)
BEGIN SELECT RAISE(ABORT,'team_sheet_file_collision'); END;
CREATE TRIGGER project_sheet_team_file_update BEFORE UPDATE OF spreadsheet_id ON project_sheet_connections
WHEN EXISTS(SELECT 1 FROM team_sheet_connections WHERE spreadsheet_id=NEW.spreadsheet_id)
BEGIN SELECT RAISE(ABORT,'team_sheet_file_collision'); END;
CREATE TRIGGER master_sheet_team_file_insert BEFORE INSERT ON settings
WHEN NEW.name='sync.google_sheets.configuration' AND EXISTS(SELECT 1 FROM team_sheet_connections WHERE spreadsheet_id=CASE WHEN json_valid(NEW.value) THEN json_extract(NEW.value,'$.spreadsheetId') END)
BEGIN SELECT RAISE(ABORT,'team_sheet_file_collision'); END;
CREATE TRIGGER master_sheet_team_file_update BEFORE UPDATE OF name,value ON settings
WHEN NEW.name='sync.google_sheets.configuration' AND EXISTS(SELECT 1 FROM team_sheet_connections WHERE spreadsheet_id=CASE WHEN json_valid(NEW.value) THEN json_extract(NEW.value,'$.spreadsheetId') END)
BEGIN SELECT RAISE(ABORT,'team_sheet_file_collision'); END;
CREATE TRIGGER project_sheet_master_file_insert BEFORE INSERT ON project_sheet_connections
WHEN EXISTS(SELECT 1 FROM settings WHERE name='sync.google_sheets.configuration' AND CASE WHEN json_valid(value) THEN json_extract(value,'$.spreadsheetId') END=NEW.spreadsheet_id)
BEGIN SELECT RAISE(ABORT,'project_sheet_master_forbidden'); END;
CREATE TRIGGER project_sheet_master_file_update BEFORE UPDATE OF spreadsheet_id ON project_sheet_connections
WHEN EXISTS(SELECT 1 FROM settings WHERE name='sync.google_sheets.configuration' AND CASE WHEN json_valid(value) THEN json_extract(value,'$.spreadsheetId') END=NEW.spreadsheet_id)
BEGIN SELECT RAISE(ABORT,'project_sheet_master_forbidden'); END;
CREATE TRIGGER master_sheet_project_file_insert BEFORE INSERT ON settings
WHEN NEW.name='sync.google_sheets.configuration' AND EXISTS(SELECT 1 FROM project_sheet_connections WHERE spreadsheet_id=CASE WHEN json_valid(NEW.value) THEN json_extract(NEW.value,'$.spreadsheetId') END)
BEGIN SELECT RAISE(ABORT,'sync_project_workbook'); END;
CREATE TRIGGER master_sheet_project_file_update BEFORE UPDATE OF name,value ON settings
WHEN NEW.name='sync.google_sheets.configuration' AND EXISTS(SELECT 1 FROM project_sheet_connections WHERE spreadsheet_id=CASE WHEN json_valid(NEW.value) THEN json_extract(NEW.value,'$.spreadsheetId') END)
BEGIN SELECT RAISE(ABORT,'sync_project_workbook'); END;
CREATE TRIGGER team_sheet_project_org_stable BEFORE UPDATE OF organization_id ON projects
WHEN EXISTS(SELECT 1 FROM team_sheet_connections c JOIN followup_teams t ON t.id=c.team_id WHERE c.project_id=OLD.id AND t.organization_id IS NOT NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'team_sheet_scope_mismatch'); END;
CREATE TRIGGER team_sheet_affiliation_revoked AFTER UPDATE OF removed_at ON followup_team_members
WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL
BEGIN
 UPDATE team_sheet_tokens SET revoked_at=COALESCE(revoked_at,NEW.removed_at) WHERE team_member_id=NEW.id;
 UPDATE team_sheet_runs SET status='failed',finished_at=NEW.removed_at WHERE status='running' AND token_id IN(SELECT id FROM team_sheet_tokens WHERE team_member_id=NEW.id);
END;
CREATE TRIGGER team_sheet_grant_revoked AFTER UPDATE OF revoked_at ON members
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
 UPDATE team_sheet_tokens SET revoked_at=COALESCE(revoked_at,NEW.revoked_at) WHERE member_id=NEW.id;
 UPDATE team_sheet_runs SET status='failed',finished_at=NEW.revoked_at WHERE status='running' AND token_id IN(SELECT id FROM team_sheet_tokens WHERE member_id=NEW.id);
END;
