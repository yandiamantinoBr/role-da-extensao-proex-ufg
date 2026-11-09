-- Comunidade, fase 1. Widgets pessoais (só a própria pessoa lê), retorno ampliado
-- (elogio, evento, resposta da gestão) e ouvidoria anônima.
-- A ouvidoria NÃO tem coluna de autoria e guarda apenas dias civis (AAAA-MM-DD), nunca instantes.
-- WITHOUT ROWID: a ordem física segue o identificador aleatório, não a ordem de chegada.
CREATE TABLE personal_widget_settings (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES portal_users(user_id),
 notes INTEGER NOT NULL DEFAULT 0,
 reminders INTEGER NOT NULL DEFAULT 0,
 role_shortcut INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version)='integer' AND version>=1),
 updated_at TEXT NOT NULL,
 CONSTRAINT personal_widget_flags CHECK(notes IN (0,1) AND reminders IN (0,1) AND role_shortcut IN (0,1))
);
--> statement-breakpoint
CREATE TABLE personal_notes (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 kind TEXT NOT NULL,
 body TEXT NOT NULL,
 due_on TEXT CHECK(due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 due_time TEXT CHECK(due_time IS NULL OR (due_on IS NOT NULL AND due_time GLOB '[0-2][0-9]:[0-5][0-9]')),
 done_at TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version)='integer' AND version>=1),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CONSTRAINT personal_notes_kind CHECK(kind IN ('note','reminder')),
 CONSTRAINT personal_notes_body CHECK(length(body) BETWEEN 1 AND 500),
 CONSTRAINT personal_notes_reminder_fields CHECK(kind='reminder' OR (due_on IS NULL AND due_time IS NULL AND done_at IS NULL))
);
--> statement-breakpoint
CREATE INDEX personal_notes_owner_idx ON personal_notes(user_id,kind,done_at,due_on);
--> statement-breakpoint
CREATE TABLE ombuds_reports (
 id TEXT PRIMARY KEY NOT NULL,
 code_hash TEXT NOT NULL CHECK(length(code_hash)=64 AND code_hash NOT GLOB '*[^0-9a-f]*'),
 category TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'received',
 received_on TEXT NOT NULL CHECK(received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 updated_on TEXT NOT NULL CHECK(updated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version)='integer' AND version>=1),
 CONSTRAINT ombuds_reports_category CHECK(category IN ('conduct','workload','environment','process','platform','other')),
 CONSTRAINT ombuds_reports_status CHECK(status IN ('received','reviewing','answered','closed'))
) WITHOUT ROWID;
--> statement-breakpoint
CREATE UNIQUE INDEX ombuds_reports_code_idx ON ombuds_reports(code_hash);
--> statement-breakpoint
CREATE INDEX ombuds_reports_status_idx ON ombuds_reports(status,received_on);
--> statement-breakpoint
CREATE TABLE ombuds_messages (
 id TEXT PRIMARY KEY NOT NULL,
 report_id TEXT NOT NULL REFERENCES ombuds_reports(id),
 side TEXT NOT NULL,
 body TEXT NOT NULL,
 sent_on TEXT NOT NULL CHECK(sent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 seq INTEGER NOT NULL CHECK(typeof(seq)='integer' AND seq>=1),
 CONSTRAINT ombuds_messages_side CHECK(side IN ('reporter','ombuds')),
 CONSTRAINT ombuds_messages_body CHECK(length(body) BETWEEN 1 AND 4000)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE UNIQUE INDEX ombuds_messages_seq_idx ON ombuds_messages(report_id,seq);
--> statement-breakpoint
-- Retorno: o CHECK de tipo só muda recriando a tabela. Preserva identificadores, datas e estados.
CREATE TABLE portal_feedback_v36 (
 id TEXT PRIMARY KEY NOT NULL,
 author_id TEXT NOT NULL,
 project_id TEXT REFERENCES projects(id),
 campaign_id TEXT REFERENCES campaigns(id),
 kind TEXT NOT NULL,
 module TEXT NOT NULL,
 body TEXT NOT NULL,
 release TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'new',
 version INTEGER NOT NULL DEFAULT 1,
 response TEXT,
 responded_by TEXT,
 responded_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CONSTRAINT portal_feedback_kind CHECK(kind IN ('problem','suggestion','praise')),
 CONSTRAINT portal_feedback_body CHECK(length(body) BETWEEN 10 AND 2000),
 CONSTRAINT portal_feedback_status CHECK(status IN ('new','reviewing','resolved')),
 CONSTRAINT portal_feedback_campaign_project CHECK(campaign_id IS NULL OR project_id IS NOT NULL),
 CONSTRAINT portal_feedback_response CHECK((response IS NULL AND responded_by IS NULL AND responded_at IS NULL) OR (length(response) BETWEEN 1 AND 2000 AND responded_by IS NOT NULL AND responded_at IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO portal_feedback_v36(id,author_id,project_id,kind,module,body,release,status,version,created_at,updated_at)
 SELECT id,author_id,project_id,kind,module,body,release,status,version,created_at,updated_at FROM portal_feedback;
--> statement-breakpoint
DROP TABLE portal_feedback;
--> statement-breakpoint
ALTER TABLE portal_feedback_v36 RENAME TO portal_feedback;
--> statement-breakpoint
CREATE INDEX portal_feedback_author_idx ON portal_feedback(author_id,created_at);
--> statement-breakpoint
CREATE INDEX portal_feedback_project_idx ON portal_feedback(project_id,created_at);
--> statement-breakpoint
CREATE INDEX portal_feedback_campaign_idx ON portal_feedback(campaign_id);
