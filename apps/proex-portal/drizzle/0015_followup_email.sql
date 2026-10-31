-- Private MailApp dispatch controls. Excluded by default from every portable projection.
CREATE TABLE followup_email_dispatch_tokens (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
--> statement-breakpoint
CREATE TABLE followup_email_configuration (
 organization_id TEXT PRIMARY KEY REFERENCES organizations(id), version INTEGER NOT NULL DEFAULT 1,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)), sender_email TEXT NOT NULL, portal_origin TEXT NOT NULL,
 daily_limit INTEGER NOT NULL DEFAULT 50 CHECK(daily_limit BETWEEN 1 AND 500), person_daily_limit INTEGER NOT NULL DEFAULT 3 CHECK(person_daily_limit BETWEEN 1 AND 10),
 event_limit INTEGER NOT NULL DEFAULT 100 CHECK(event_limit BETWEEN 1 AND 500), interval_seconds INTEGER NOT NULL DEFAULT 300 CHECK(interval_seconds BETWEEN 60 AND 3600),
 next_send_at INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE followup_email_preferences (
 organization_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)), consent_email TEXT NOT NULL, enabled_at TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,user_id)
);
--> statement-breakpoint
CREATE TABLE followup_email_queue (
 id TEXT PRIMARY KEY, notification_id TEXT NOT NULL UNIQUE REFERENCES followup_notifications(id), organization_id TEXT NOT NULL REFERENCES organizations(id),
 task_id TEXT NOT NULL REFERENCES followup_tasks(id), user_id TEXT NOT NULL REFERENCES portal_users(user_id), event_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','claimed','sending','accepted','accepted_attested','uncertain','closed_unconfirmed','cancelled')),
 claim_hash TEXT, claim_nonce TEXT, claim_expires_at INTEGER, dispatcher_id TEXT, credential_hash TEXT, configuration_version INTEGER,
 send_nonce TEXT, acceptance_hash TEXT, sending_at TEXT, accepted_at TEXT, reconciled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(task_id,user_id,event_key)
);
--> statement-breakpoint
CREATE INDEX followup_email_queue_dispatch_idx ON followup_email_queue(organization_id,status,created_at,id);
--> statement-breakpoint
CREATE TABLE followup_email_usage (
 organization_id TEXT NOT NULL REFERENCES organizations(id), day TEXT NOT NULL, bucket TEXT NOT NULL, reserved INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,day,bucket)
);
--> statement-breakpoint
CREATE TABLE followup_email_dispatch_state (
 organization_id TEXT PRIMARY KEY REFERENCES organizations(id), last_attempt_at TEXT, last_accepted_at TEXT, remaining_quota INTEGER,
 last_outcome TEXT NOT NULL DEFAULT 'not_started', updated_at TEXT NOT NULL
);
