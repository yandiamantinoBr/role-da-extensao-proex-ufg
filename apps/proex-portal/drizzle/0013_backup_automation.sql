-- Internal backup control only. Never include tickets/receipts in portable exports.
CREATE TABLE backup_automation_configuration (
 id TEXT PRIMARY KEY CHECK(id='platform'), revision INTEGER NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), public_key_pem TEXT NOT NULL,
 key_id TEXT NOT NULL, drive_folder_id TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE backup_automation_quota (day TEXT PRIMARY KEY, issued INTEGER NOT NULL DEFAULT 0 CHECK(issued>=0));
--> statement-breakpoint
CREATE TABLE backup_automation_runs (
 id TEXT PRIMARY KEY, operation_scope TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, credential_hash TEXT,
 config_revision INTEGER NOT NULL, key_id TEXT NOT NULL, drive_folder_id TEXT NOT NULL,
 ticket_hash TEXT NOT NULL UNIQUE, ticket_expires_at INTEGER NOT NULL, ticket_used_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('issued','capturing','generated','verified_client','failed')),
 lease_id TEXT, artifact_sha256 TEXT, artifact_size INTEGER, drive_file_id TEXT,
 created_at TEXT NOT NULL, generated_at TEXT, verified_at TEXT, error_code TEXT
);
--> statement-breakpoint
CREATE INDEX backup_automation_runs_created_idx ON backup_automation_runs(created_at);
--> statement-breakpoint
CREATE TABLE backup_runtime_lease (id TEXT PRIMARY KEY CHECK(id='platform'), lease_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
