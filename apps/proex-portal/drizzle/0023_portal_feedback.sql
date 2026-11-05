CREATE TABLE portal_feedback (
 id TEXT PRIMARY KEY NOT NULL,
 author_id TEXT NOT NULL,
 project_id TEXT REFERENCES projects(id),
 kind TEXT NOT NULL CHECK(kind IN ('problem','suggestion')),
 module TEXT NOT NULL,
 body TEXT NOT NULL CHECK(length(body) BETWEEN 10 AND 2000),
 release TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewing','resolved')),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX portal_feedback_author_idx ON portal_feedback(author_id,created_at);
CREATE INDEX portal_feedback_project_idx ON portal_feedback(project_id,created_at);
