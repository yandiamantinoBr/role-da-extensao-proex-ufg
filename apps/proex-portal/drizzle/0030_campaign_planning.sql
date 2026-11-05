-- Campaign planning and host context. Additive and empty: no rows are created, moved or
-- imported by this migration. Campaign ownership stays in the legacy campaigns.project_id.
-- Quantities, stock, offers and participations are deliberately absent from these tables.
--
-- Timezone contract: session_date is a civil calendar date (YYYY-MM-DD) and starts_at/ends_at
-- are local wall-clock times (HH:MM, 24h) on that date, in the event's own local time
-- (UFG/Goiânia, America/Sao_Paulo, no DST). They are never converted to UTC and carry no offset.
-- A session never crosses midnight (ends_at > starts_at on the same date). Audit/created_at/
-- updated_at/revoked_at columns are UTC ISO-8601 instants written by the server.
CREATE TABLE campaign_planning (
 campaign_id TEXT PRIMARY KEY NOT NULL REFERENCES campaigns(id),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE campaign_host_contexts (
 campaign_id TEXT NOT NULL REFERENCES campaign_planning(campaign_id),
 host_project_id TEXT NOT NULL REFERENCES projects(id),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL CHECK(length(created_by) BETWEEN 1 AND 200),
 revoked_at TEXT,
 PRIMARY KEY(campaign_id,host_project_id)
);
CREATE INDEX campaign_host_contexts_host_idx ON campaign_host_contexts(host_project_id,revoked_at);
CREATE TABLE campaign_sessions (
 id TEXT PRIMARY KEY NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaign_planning(campaign_id),
 -- IS (not =) so an invalid date/time, for which date()/time() return NULL, fails the CHECK.
 session_date TEXT NOT NULL CHECK(length(session_date)=10 AND date(session_date) IS session_date AND session_date BETWEEN '2000-01-01' AND '2100-12-31'),
 ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 1 AND 10),
 label TEXT NOT NULL DEFAULT '' CHECK(length(label)<=100 AND label=trim(label)),
 starts_at TEXT CHECK(starts_at IS NULL OR (length(starts_at)=5 AND substr(time(starts_at),1,5) IS starts_at)),
 ends_at TEXT CHECK(ends_at IS NULL OR (length(ends_at)=5 AND substr(time(ends_at),1,5) IS ends_at)),
 status TEXT NOT NULL DEFAULT 'tentative' CHECK(status IN('tentative','confirmed','cancelled','done')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=500),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(campaign_id,session_date,ordinal),
 CHECK((starts_at IS NULL)=(ends_at IS NULL)),
 CHECK(starts_at IS NULL OR starts_at<ends_at),
 CHECK(status NOT IN('confirmed','done') OR (starts_at IS NOT NULL AND ends_at IS NOT NULL))
);
CREATE INDEX campaign_sessions_campaign_idx ON campaign_sessions(campaign_id,session_date,ordinal);

-- Header: immutable identity; the CAS version only moves forward by exactly one.
CREATE TRIGGER campaign_planning_header_update BEFORE UPDATE ON campaign_planning BEGIN
 SELECT CASE WHEN NEW.campaign_id!=OLD.campaign_id THEN RAISE(ABORT,'planning_identity_immutable') END;
 SELECT CASE WHEN NEW.version!=OLD.version AND NEW.version!=OLD.version+1 THEN RAISE(ABORT,'planning_version_step') END;
END;
CREATE TRIGGER campaign_planning_header_delete BEFORE DELETE ON campaign_planning BEGIN SELECT RAISE(ABORT,'planning_delete_forbidden'); END;

-- Host links: different from the primary, same organization, both projects and the organization
-- active whenever a link is (re)activated; identities immutable; at most 20 active hosts.
CREATE TRIGGER campaign_host_contexts_insert BEFORE INSERT ON campaign_host_contexts BEGIN
 SELECT CASE WHEN NEW.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM campaigns c JOIN projects primary_project ON primary_project.id=c.project_id
  JOIN projects host ON host.id=NEW.host_project_id JOIN organizations o ON o.id=primary_project.organization_id
  WHERE c.id=NEW.campaign_id AND host.id!=c.project_id AND host.organization_id=primary_project.organization_id
  AND primary_project.status='active' AND host.status='active' AND o.status='active') THEN RAISE(ABORT,'planning_host_invalid') END;
 -- An upsert that reaffirms an already-active pair must not trip the limit.
 SELECT CASE WHEN NEW.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM campaign_host_contexts WHERE campaign_id=NEW.campaign_id AND host_project_id=NEW.host_project_id AND revoked_at IS NULL)
  AND (SELECT COUNT(*) FROM campaign_host_contexts WHERE campaign_id=NEW.campaign_id AND revoked_at IS NULL)>=20 THEN RAISE(ABORT,'planning_host_limit') END;
END;
CREATE TRIGGER campaign_host_contexts_update BEFORE UPDATE ON campaign_host_contexts BEGIN
 SELECT CASE WHEN NEW.campaign_id!=OLD.campaign_id OR NEW.host_project_id!=OLD.host_project_id THEN RAISE(ABORT,'planning_identity_immutable') END;
 SELECT CASE WHEN NEW.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM campaigns c JOIN projects primary_project ON primary_project.id=c.project_id
  JOIN projects host ON host.id=NEW.host_project_id JOIN organizations o ON o.id=primary_project.organization_id
  WHERE c.id=NEW.campaign_id AND host.id!=c.project_id AND host.organization_id=primary_project.organization_id
  AND primary_project.status='active' AND host.status='active' AND o.status='active') THEN RAISE(ABORT,'planning_host_invalid') END;
 SELECT CASE WHEN NEW.revoked_at IS NULL AND OLD.revoked_at IS NOT NULL AND (SELECT COUNT(*) FROM campaign_host_contexts WHERE campaign_id=NEW.campaign_id AND revoked_at IS NULL)>=20 THEN RAISE(ABORT,'planning_host_limit') END;
END;
CREATE TRIGGER campaign_host_contexts_delete BEFORE DELETE ON campaign_host_contexts BEGIN SELECT RAISE(ABORT,'planning_delete_forbidden'); END;

-- Sessions: immutable identity, version moves by exactly one on every update, bounded count.
-- Time/order/status rules are table CHECK constraints above (no zero/default times).
CREATE TRIGGER campaign_sessions_insert BEFORE INSERT ON campaign_sessions BEGIN
 SELECT CASE WHEN NEW.version!=1 THEN RAISE(ABORT,'planning_version_step') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM campaign_sessions WHERE campaign_id=NEW.campaign_id)>=200 THEN RAISE(ABORT,'planning_session_limit') END;
END;
CREATE TRIGGER campaign_sessions_update BEFORE UPDATE ON campaign_sessions BEGIN
 SELECT CASE WHEN NEW.id!=OLD.id OR NEW.campaign_id!=OLD.campaign_id THEN RAISE(ABORT,'planning_identity_immutable') END;
 SELECT CASE WHEN NEW.version!=OLD.version+1 THEN RAISE(ABORT,'planning_version_step') END;
END;
CREATE TRIGGER campaign_sessions_delete BEFORE DELETE ON campaign_sessions BEGIN SELECT RAISE(ABORT,'planning_delete_forbidden'); END;

-- Ownership stays where the legacy model puts it: a planned campaign cannot silently move to
-- another project, and a project referenced by planning cannot move to another organization.
CREATE TRIGGER campaign_planning_owner_immutable BEFORE UPDATE OF project_id ON campaigns
WHEN NEW.project_id IS NOT OLD.project_id AND EXISTS(SELECT 1 FROM campaign_planning WHERE campaign_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'planning_owner_immutable'); END;
CREATE TRIGGER campaign_planning_project_org_immutable BEFORE UPDATE OF organization_id ON projects
WHEN NEW.organization_id IS NOT OLD.organization_id AND(
 EXISTS(SELECT 1 FROM campaign_host_contexts WHERE host_project_id=OLD.id)
 OR EXISTS(SELECT 1 FROM campaign_planning cp JOIN campaigns c ON c.id=cp.campaign_id WHERE c.project_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'planning_owner_immutable'); END;

-- Additive repair for the 0029 date CHECK NULL semantics. The applied migration stays intact.
-- Existing rows are preserved; only future source date inserts/changes are checked.
CREATE TRIGGER institutional_source_date_insert BEFORE INSERT ON institutional_structures
WHEN NEW.source_issued_on IS NOT NULL AND (length(NEW.source_issued_on)!=10 OR date(NEW.source_issued_on) IS NOT NEW.source_issued_on)
BEGIN SELECT RAISE(ABORT,'structure_source_date_invalid'); END;
CREATE TRIGGER institutional_source_date_update BEFORE UPDATE OF source_issued_on ON institutional_structures
WHEN NEW.source_issued_on IS NOT NULL AND (length(NEW.source_issued_on)!=10 OR date(NEW.source_issued_on) IS NOT NEW.source_issued_on)
BEGIN SELECT RAISE(ABORT,'structure_source_date_invalid'); END;
