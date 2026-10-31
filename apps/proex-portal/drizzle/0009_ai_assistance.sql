-- Server-only assistant state. Never include these tables in Sheets/public exports.
CREATE TABLE ai_settings (
 id TEXT PRIMARY KEY CHECK(id='portal'), revision INTEGER NOT NULL DEFAULT 1,
 config_json TEXT NOT NULL, credentials_ciphertext TEXT NOT NULL,
 updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE ai_daily_usage (
 day TEXT PRIMARY KEY, reserved_usd_micros INTEGER NOT NULL DEFAULT 0 CHECK(reserved_usd_micros>=0),
 reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),
 reserved_ms INTEGER NOT NULL DEFAULT 0 CHECK(reserved_ms>=0), calls INTEGER NOT NULL DEFAULT 0 CHECK(calls>=0)
);
--> statement-breakpoint
CREATE TABLE ai_plans (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 payload_json TEXT NOT NULL, payload_digest TEXT NOT NULL, expires_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','applied','cancelled')),
 result_json TEXT, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX ai_plans_actor_project_idx ON ai_plans(actor_id,project_id,expires_at);
--> statement-breakpoint
CREATE TABLE ai_calls (
 id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, actor_id TEXT NOT NULL, project_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('reserved','complete','failed')), plan_id TEXT,
 day TEXT NOT NULL, created_at TEXT NOT NULL
);
