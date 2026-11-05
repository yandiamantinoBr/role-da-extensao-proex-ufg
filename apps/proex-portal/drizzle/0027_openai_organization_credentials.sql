-- Widen only the reviewed credential provider allowlist. Preserve all nine
-- metadata columns, PK, FK and state checks; no ciphertext or domain row changes.
CREATE TABLE ai_provider_credential_metadata_openai (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 provider TEXT NOT NULL,
 label TEXT NOT NULL,
 mask TEXT NOT NULL,
 state TEXT NOT NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 PRIMARY KEY(organization_id,provider),
 CONSTRAINT ai_provider_credential_name CHECK(provider IN ('deepseek','typesafe','deepgram','groq','openai')),
 CONSTRAINT ai_provider_credential_state CHECK(state IN ('active','disabled','removed'))
);
--> statement-breakpoint
INSERT INTO ai_provider_credential_metadata_openai SELECT organization_id,provider,label,mask,state,created_at,created_by,updated_at,updated_by FROM ai_provider_credential_metadata;
--> statement-breakpoint
DROP TABLE ai_provider_credential_metadata;
--> statement-breakpoint
ALTER TABLE ai_provider_credential_metadata_openai RENAME TO ai_provider_credential_metadata;
