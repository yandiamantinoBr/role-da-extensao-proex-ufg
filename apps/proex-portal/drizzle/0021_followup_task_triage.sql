ALTER TABLE followup_tasks ADD COLUMN importance TEXT CHECK (importance IN ('high','medium','low'));

CREATE TABLE ai_task_triage_calls (
 id TEXT PRIMARY KEY NOT NULL,
 actor_id TEXT NOT NULL,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 task_id TEXT NOT NULL REFERENCES followup_tasks(id),
 task_version INTEGER NOT NULL,
 config_revision INTEGER NOT NULL,
 fingerprint TEXT NOT NULL,
 admission_nonce TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('reserved','ready','abstained','applied','failed')),
 model TEXT NOT NULL,
 reserved_tokens INTEGER NOT NULL,
 reserved_usd_micros INTEGER NOT NULL,
 input_tokens INTEGER,
 proposal_json TEXT,
 day TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX ai_task_triage_usage_idx ON ai_task_triage_calls(organization_id,day);
