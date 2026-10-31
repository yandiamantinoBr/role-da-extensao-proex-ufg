-- Optional participant accounts; no membership or project grant is created here.
CREATE TABLE public_participant_config (
 id integer PRIMARY KEY CHECK(id=1), enabled integer NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 notice_text text NOT NULL DEFAULT '', eligibility_text text NOT NULL DEFAULT '',
 notice_approved integer NOT NULL DEFAULT 0 CHECK(notice_approved IN (0,1)),
 eligibility_approved integer NOT NULL DEFAULT 0 CHECK(eligibility_approved IN (0,1)),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at text NOT NULL, updated_by text,
 sender_fingerprint text, sender_verified_at integer, sender_domain text, sender_status text
);
--> statement-breakpoint
INSERT INTO public_participant_config(id,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
CREATE TABLE participant_accounts (
 user_id text PRIMARY KEY NOT NULL REFERENCES portal_users(user_id),
 verified_at text NOT NULL, notice_hash text NOT NULL, eligibility_hash text NOT NULL,
 created_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE participant_email_challenges (
 id text PRIMARY KEY NOT NULL, token_hash text NOT NULL UNIQUE, email text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('signup','recovery')),
 expires_at integer NOT NULL, used_at text, provider_accepted_at text,
 config_version integer NOT NULL, notice_hash text NOT NULL, eligibility_hash text NOT NULL,
 return_to text NOT NULL, created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX participant_challenges_expiry_idx ON participant_email_challenges(expires_at);
--> statement-breakpoint
CREATE INDEX participant_challenges_email_idx ON participant_email_challenges(email,created_at);
