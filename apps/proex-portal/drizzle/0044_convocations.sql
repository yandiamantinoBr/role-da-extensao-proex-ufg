-- Convocations: attendance confirmation by guests without a portal account. Additive only.
-- A guest is reached only through a personal edit token (stored as a hash); the invite link is counted and
-- limited atomically by triggers; the event log carries no personal data, so purging the guests leaves no names.
CREATE TABLE convocations (
 id TEXT PRIMARY KEY NOT NULL,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 title TEXT NOT NULL,
 edition TEXT DEFAULT '' NOT NULL,
 location TEXT DEFAULT '' NOT NULL,
 event_date TEXT NOT NULL,
 response_deadline TEXT,
 description TEXT DEFAULT '' NOT NULL,
 purpose_notice TEXT NOT NULL,
 retention_days INTEGER DEFAULT 180 NOT NULL,
 status TEXT DEFAULT 'open' NOT NULL,
 version INTEGER DEFAULT 1 NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 purged_at TEXT,
 CHECK(length(trim(title)) BETWEEN 3 AND 160 AND length(edition)<=120 AND length(location)<=200 AND length(description)<=2000),
 CHECK(length(trim(purpose_notice)) BETWEEN 10 AND 1000),
 CHECK(event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(event_date)=event_date),
 CHECK(response_deadline IS NULL OR julianday(response_deadline) IS NOT NULL),
 CHECK(typeof(retention_days)='integer' AND retention_days BETWEEN 30 AND 730),
 CHECK(status IN('open','closed')),
 CHECK(typeof(version)='integer' AND version>=1)
);
--> statement-breakpoint
CREATE INDEX convocations_project_idx ON convocations(project_id,event_date);
--> statement-breakpoint
CREATE INDEX convocations_org_idx ON convocations(organization_id,status,event_date);
--> statement-breakpoint
CREATE TRIGGER convocations_scope BEFORE INSERT ON convocations
WHEN NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'convocation_scope'); END;
--> statement-breakpoint
CREATE TRIGGER convocations_identity BEFORE UPDATE ON convocations
WHEN NEW.id!=OLD.id OR NEW.organization_id!=OLD.organization_id OR NEW.project_id!=OLD.project_id OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at OR NEW.version!=OLD.version+1
BEGIN SELECT RAISE(ABORT,'convocation_identity'); END;
--> statement-breakpoint
CREATE TRIGGER convocations_no_delete BEFORE DELETE ON convocations BEGIN SELECT RAISE(ABORT,'convocation_immutable'); END;
--> statement-breakpoint
CREATE TABLE convocation_shifts (
 id TEXT PRIMARY KEY NOT NULL,
 convocation_id TEXT NOT NULL REFERENCES convocations(id),
 label TEXT NOT NULL,
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 position INTEGER NOT NULL,
 CHECK(length(trim(label)) BETWEEN 1 AND 80),
 CHECK(starts_at GLOB '[0-2][0-9]:[0-5][0-9]' AND ends_at GLOB '[0-2][0-9]:[0-5][0-9]' AND starts_at<'24:00' AND ends_at<'24:00' AND ends_at>starts_at),
 CHECK(typeof(position)='integer' AND position BETWEEN 1 AND 112)
);
--> statement-breakpoint
CREATE UNIQUE INDEX convocation_shifts_position_unique ON convocation_shifts(convocation_id,position);
--> statement-breakpoint
CREATE TABLE convocation_projects (
 convocation_id TEXT NOT NULL REFERENCES convocations(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 PRIMARY KEY(convocation_id,project_id)
);
--> statement-breakpoint
CREATE INDEX convocation_projects_project_idx ON convocation_projects(project_id);
--> statement-breakpoint
CREATE TRIGGER convocation_projects_scope BEFORE INSERT ON convocation_projects
WHEN NOT EXISTS(SELECT 1 FROM convocations c JOIN projects p ON p.organization_id=c.organization_id WHERE c.id=NEW.convocation_id AND p.id=NEW.project_id AND p.status='active')
BEGIN SELECT RAISE(ABORT,'convocation_project_scope'); END;
--> statement-breakpoint
CREATE TABLE convocation_responsibles (
 convocation_id TEXT NOT NULL REFERENCES convocations(id),
 user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 added_by TEXT NOT NULL,
 added_at TEXT NOT NULL,
 PRIMARY KEY(convocation_id,user_id)
);
--> statement-breakpoint
CREATE INDEX convocation_responsibles_user_idx ON convocation_responsibles(user_id);
--> statement-breakpoint
CREATE TABLE convocation_invites (
 id TEXT PRIMARY KEY NOT NULL,
 convocation_id TEXT NOT NULL REFERENCES convocations(id),
 token_hash TEXT NOT NULL,
 label TEXT DEFAULT '' NOT NULL,
 expires_at TEXT NOT NULL,
 max_uses INTEGER NOT NULL,
 use_count INTEGER DEFAULT 0 NOT NULL,
 revoked_at TEXT,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 CHECK(length(token_hash)=64 AND length(label)<=80),
 CHECK(julianday(expires_at) IS NOT NULL AND julianday(expires_at)>julianday(created_at)),
 CHECK(typeof(max_uses)='integer' AND max_uses BETWEEN 1 AND 2000),
 CHECK(typeof(use_count)='integer' AND use_count BETWEEN 0 AND max_uses)
);
--> statement-breakpoint
CREATE UNIQUE INDEX convocation_invites_token_unique ON convocation_invites(token_hash);
--> statement-breakpoint
CREATE INDEX convocation_invites_convocation_idx ON convocation_invites(convocation_id);
--> statement-breakpoint
CREATE TRIGGER convocation_invites_identity BEFORE UPDATE ON convocation_invites
WHEN NEW.id!=OLD.id OR NEW.convocation_id!=OLD.convocation_id OR NEW.token_hash!=OLD.token_hash OR NEW.max_uses!=OLD.max_uses OR NEW.expires_at!=OLD.expires_at
 OR NEW.use_count<OLD.use_count OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
BEGIN SELECT RAISE(ABORT,'convocation_invite_identity'); END;
--> statement-breakpoint
CREATE TRIGGER convocation_invites_no_delete BEFORE DELETE ON convocation_invites BEGIN SELECT RAISE(ABORT,'convocation_immutable'); END;
--> statement-breakpoint
CREATE TABLE convocation_guests (
 id TEXT PRIMARY KEY NOT NULL,
 convocation_id TEXT NOT NULL REFERENCES convocations(id),
 invite_id TEXT NOT NULL REFERENCES convocation_invites(id),
 edit_hash TEXT NOT NULL,
 name TEXT NOT NULL,
 enrollment TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id),
 response TEXT NOT NULL,
 consent_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 version INTEGER DEFAULT 1 NOT NULL,
 CHECK(length(edit_hash)=64),
 CHECK(length(trim(name)) BETWEEN 3 AND 120),
 CHECK(length(trim(enrollment)) BETWEEN 4 AND 20),
 CHECK(response IN('yes','no','maybe')),
 CHECK(typeof(version)='integer' AND version>=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX convocation_guests_edit_unique ON convocation_guests(edit_hash);
--> statement-breakpoint
CREATE INDEX convocation_guests_convocation_idx ON convocation_guests(convocation_id,project_id);
--> statement-breakpoint
-- The invite must be live and still have room; the convocation must accept answers; the project must be invited.
CREATE TRIGGER convocation_guests_admit BEFORE INSERT ON convocation_guests BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM convocation_invites i JOIN convocations c ON c.id=i.convocation_id
   WHERE i.id=NEW.invite_id AND i.convocation_id=NEW.convocation_id AND i.revoked_at IS NULL AND julianday(i.expires_at)>julianday(NEW.created_at)
   AND i.use_count<i.max_uses AND c.status='open' AND c.purged_at IS NULL) THEN RAISE(ABORT,'convocation_invite_closed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM convocation_projects cp WHERE cp.convocation_id=NEW.convocation_id AND cp.project_id=NEW.project_id)
  THEN RAISE(ABORT,'convocation_project_scope') END;
END;
--> statement-breakpoint
CREATE TRIGGER convocation_guests_count AFTER INSERT ON convocation_guests BEGIN
 UPDATE convocation_invites SET use_count=use_count+1 WHERE id=NEW.invite_id;
END;
--> statement-breakpoint
CREATE TRIGGER convocation_guests_update BEFORE UPDATE ON convocation_guests
WHEN NEW.id!=OLD.id OR NEW.convocation_id!=OLD.convocation_id OR NEW.invite_id!=OLD.invite_id OR NEW.edit_hash!=OLD.edit_hash OR NEW.created_at!=OLD.created_at
 OR NEW.version!=OLD.version+1
 OR NOT EXISTS(SELECT 1 FROM convocations c WHERE c.id=NEW.convocation_id AND c.status='open' AND c.purged_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM convocation_projects cp WHERE cp.convocation_id=NEW.convocation_id AND cp.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'convocation_guest_changed'); END;
--> statement-breakpoint
CREATE TABLE convocation_guest_shifts (
 guest_id TEXT NOT NULL REFERENCES convocation_guests(id),
 shift_id TEXT NOT NULL REFERENCES convocation_shifts(id),
 PRIMARY KEY(guest_id,shift_id)
);
--> statement-breakpoint
CREATE TRIGGER convocation_guest_shifts_scope BEFORE INSERT ON convocation_guest_shifts
WHEN NOT EXISTS(SELECT 1 FROM convocation_guests g JOIN convocation_shifts s ON s.convocation_id=g.convocation_id WHERE g.id=NEW.guest_id AND s.id=NEW.shift_id)
BEGIN SELECT RAISE(ABORT,'convocation_shift_scope'); END;
--> statement-breakpoint
CREATE TABLE convocation_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 id TEXT NOT NULL UNIQUE,
 convocation_id TEXT NOT NULL REFERENCES convocations(id),
 kind TEXT NOT NULL,
 guest_id TEXT,
 project_id TEXT,
 actor_id TEXT,
 details TEXT DEFAULT '{}' NOT NULL,
 created_at TEXT NOT NULL,
 CHECK(kind IN('created','updated','closed','reopened','invite_created','invite_revoked','response_created','response_updated','response_deleted','purged')),
 CHECK(json_valid(details) AND length(details)<=2000)
);
--> statement-breakpoint
CREATE INDEX convocation_events_convocation_idx ON convocation_events(convocation_id,sequence);
--> statement-breakpoint
CREATE TRIGGER convocation_events_no_update BEFORE UPDATE ON convocation_events BEGIN SELECT RAISE(ABORT,'convocation_event_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER convocation_events_no_delete BEFORE DELETE ON convocation_events BEGIN SELECT RAISE(ABORT,'convocation_event_immutable'); END;
--> statement-breakpoint
CREATE TABLE convocation_receipts (
 user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 convocation_id TEXT NOT NULL REFERENCES convocations(id),
 seen_sequence INTEGER DEFAULT 0 NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,convocation_id),
 CHECK(typeof(seen_sequence)='integer' AND seen_sequence>=0)
);
--> statement-breakpoint
CREATE TABLE convocation_notification_preferences (
 user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 kind TEXT NOT NULL,
 channel TEXT NOT NULL,
 enabled INTEGER NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,kind,channel),
 CHECK(kind IN('digest','reminder','response')),
 CHECK(channel IN('bell','email','whatsapp')),
 CHECK(enabled IN(0,1)),
 CHECK(channel!='whatsapp' OR enabled=0)
);
--> statement-breakpoint
CREATE TABLE convocation_email_queue (
 id TEXT PRIMARY KEY NOT NULL,
 notice_key TEXT NOT NULL,
 convocation_id TEXT NOT NULL REFERENCES convocations(id),
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 kind TEXT NOT NULL,
 status TEXT DEFAULT 'queued' NOT NULL,
 claim_hash TEXT,
 claim_nonce TEXT,
 claim_expires_at INTEGER,
 dispatcher_id TEXT,
 credential_hash TEXT,
 configuration_version INTEGER,
 send_nonce TEXT,
 acceptance_hash TEXT,
 sending_at TEXT,
 accepted_at TEXT,
 reconciled_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK(kind IN('digest','reminder','response')),
 CHECK(status IN('queued','claimed','sending','accepted','accepted_attested','uncertain','closed_unconfirmed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX convocation_email_queue_notice_unique ON convocation_email_queue(notice_key);
--> statement-breakpoint
CREATE INDEX convocation_email_queue_dispatch_idx ON convocation_email_queue(organization_id,status,created_at,id);
