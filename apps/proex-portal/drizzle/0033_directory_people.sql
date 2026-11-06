-- Private administrative records. No account, invitation, membership or delivery is created.
CREATE TABLE directory_people (
 id TEXT PRIMARY KEY NOT NULL,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 position TEXT NOT NULL DEFAULT '' CHECK(length(position)<=160),
 sector TEXT NOT NULL DEFAULT '' CHECK(length(sector)<=160),
 contact TEXT NOT NULL DEFAULT '' CHECK(length(contact)<=254),
 contact_status TEXT NOT NULL CHECK(contact_status IN('published','entered','review')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','review','archived')),
 source_kind TEXT NOT NULL CHECK(source_kind IN('manual','official')),
 reference_id TEXT,
 source_url TEXT,
 source_updated_on TEXT,
 checked_on TEXT NOT NULL,
 adapted INTEGER NOT NULL DEFAULT 0 CHECK(adapted IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(organization_id,id),
 CHECK((source_kind='manual' AND reference_id IS NULL AND source_url IS NULL AND source_updated_on IS NULL) OR
       (source_kind='official' AND reference_id IS NOT NULL AND source_url IS NOT NULL AND source_url='https://proex.ufg.br/p/equipe-proex' AND source_updated_on IS NOT NULL)),
 CHECK(length(checked_on)=10 AND COALESCE(date(checked_on),'')=checked_on),
 CHECK(source_updated_on IS NULL OR(length(source_updated_on)=10 AND COALESCE(date(source_updated_on),'')=source_updated_on)),
 CHECK(contact_status!='review' OR status IN('review','archived'))
);
CREATE UNIQUE INDEX directory_official_reference_idx ON directory_people(organization_id,reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX directory_people_org_idx ON directory_people(organization_id,status,name,id);
CREATE TABLE directory_people_history (
 id TEXT PRIMARY KEY NOT NULL,
 person_id TEXT NOT NULL REFERENCES directory_people(id),
 version INTEGER NOT NULL CHECK(version>0),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(person_id,version)
);
CREATE TRIGGER directory_identity_immutable BEFORE UPDATE ON directory_people
WHEN NEW.id!=OLD.id OR NEW.organization_id!=OLD.organization_id OR NEW.source_kind!=OLD.source_kind
 OR NEW.reference_id IS NOT OLD.reference_id OR NEW.source_url IS NOT OLD.source_url
 OR NEW.source_updated_on IS NOT OLD.source_updated_on OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at
BEGIN SELECT RAISE(ABORT,'directory_identity_immutable'); END;
CREATE TRIGGER directory_version_update BEFORE UPDATE ON directory_people WHEN NEW.version!=OLD.version+1
BEGIN SELECT RAISE(ABORT,'directory_version_changed'); END;
CREATE TRIGGER directory_limit BEFORE INSERT ON directory_people
WHEN (SELECT COUNT(*) FROM directory_people WHERE organization_id=NEW.organization_id)>=500
BEGIN SELECT RAISE(ABORT,'directory_limit'); END;
CREATE TRIGGER directory_no_delete BEFORE DELETE ON directory_people
BEGIN SELECT RAISE(ABORT,'directory_archive_required'); END;
CREATE TRIGGER directory_history_no_update BEFORE UPDATE ON directory_people_history
BEGIN SELECT RAISE(ABORT,'directory_history_immutable'); END;
CREATE TRIGGER directory_history_no_delete BEFORE DELETE ON directory_people_history
BEGIN SELECT RAISE(ABORT,'directory_history_immutable'); END;
