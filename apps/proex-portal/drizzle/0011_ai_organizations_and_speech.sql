-- Internal, server-only tables; never export through portable/MCP/Sheets/Drive.
ALTER TABLE ai_calls ADD admission_nonce TEXT;
--> statement-breakpoint
CREATE TABLE ai_organization_settings (
 organization_id TEXT PRIMARY KEY REFERENCES organizations(id), revision INTEGER NOT NULL,
 config_json TEXT NOT NULL, credentials_ciphertext TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE ai_configuration_grants (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL,
 grantor_member_id TEXT NOT NULL REFERENCES members(id), granted_by TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX ai_configuration_grants_active_idx ON ai_configuration_grants(organization_id,user_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE ai_organization_usage (
 organization_id TEXT NOT NULL REFERENCES organizations(id), day TEXT NOT NULL,
 reserved_usd_micros INTEGER NOT NULL DEFAULT 0 CHECK(reserved_usd_micros>=0), reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),
 reserved_ms INTEGER NOT NULL DEFAULT 0 CHECK(reserved_ms>=0), calls INTEGER NOT NULL DEFAULT 0 CHECK(calls>=0), PRIMARY KEY(organization_id,day)
);
--> statement-breakpoint
CREATE TABLE ai_transcriptions (
 id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, admission_nonce TEXT NOT NULL, actor_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 organization_id TEXT NOT NULL REFERENCES organizations(id), config_revision INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('reserved','complete','failed')), result_ciphertext TEXT, created_at TEXT NOT NULL
);
