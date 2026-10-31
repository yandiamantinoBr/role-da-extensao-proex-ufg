-- Private receipts retain only encrypted suggestions and source excerpts.
-- No original document artifact is stored; logical recovery expiry is 15 minutes.
-- result_ciphertext is scoped to organization+call and erased opportunistically at expiry.
CREATE TABLE ai_document_calls (
 id TEXT PRIMARY KEY NOT NULL,
 organization_id TEXT NOT NULL REFERENCES organizations(id), actor_id TEXT NOT NULL,
 project_id TEXT REFERENCES projects(id), kind TEXT NOT NULL CHECK(kind IN ('project','asset')),
 source_digest TEXT NOT NULL, config_revision INTEGER NOT NULL CHECK(config_revision>0),
 fingerprint TEXT NOT NULL, admission_nonce TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('reserved','complete','failed')),
 day TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL,
 result_ciphertext TEXT, result_digest TEXT,
 CHECK(project_id IS NOT NULL OR kind='project')
);
--> statement-breakpoint
CREATE INDEX ai_document_calls_org_actor_idx ON ai_document_calls(organization_id,actor_id,expires_at);
--> statement-breakpoint
CREATE TRIGGER ai_document_calls_scope_insert BEFORE INSERT ON ai_document_calls WHEN NEW.project_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND organization_id=NEW.organization_id) THEN RAISE(ABORT,'document_ai_scope_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_document_calls_identity_update BEFORE UPDATE OF organization_id,actor_id,project_id,kind,fingerprint,source_digest,config_revision,admission_nonce ON ai_document_calls BEGIN
 SELECT RAISE(ABORT,'document_ai_identity_immutable');
END;
