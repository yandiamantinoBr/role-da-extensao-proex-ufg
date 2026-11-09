-- Additive only. Balances are never rewritten: a correction or an undo appends ledger rows
-- (a mirror of the superseded movement and, for a correction, its replacement) and links them
-- here. Existing movements, contexts, photos and saldos stay exactly as they are.
CREATE TABLE material_destinations (
 id TEXT PRIMARY KEY NOT NULL,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 kind TEXT NOT NULL,
 name TEXT NOT NULL,
 name_key TEXT NOT NULL,
 official_url TEXT DEFAULT '' NOT NULL,
 description TEXT DEFAULT '' NOT NULL,
 unit_id TEXT REFERENCES organizational_units(id),
 status TEXT DEFAULT 'active' NOT NULL,
 version INTEGER DEFAULT 1 NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CONSTRAINT material_destination_kind CHECK(kind IN('event','place','unit','partner','other')),
 CONSTRAINT material_destination_status CHECK(status IN('active','archived')),
 CHECK(length(trim(name)) BETWEEN 2 AND 160 AND length(name_key) BETWEEN 2 AND 160),
 CHECK(official_url='' OR (length(official_url)<=500 AND official_url LIKE 'https://%')),
 CHECK(length(description)<=1000),
 CHECK(typeof(version)='integer' AND version>=1),
 CHECK(unit_id IS NULL OR kind='unit')
);
--> statement-breakpoint
CREATE UNIQUE INDEX material_destinations_name_unique ON material_destinations(organization_id,name_key);
--> statement-breakpoint
CREATE INDEX material_destinations_org_status_idx ON material_destinations(organization_id,status,name_key);
--> statement-breakpoint
CREATE TRIGGER material_destinations_identity BEFORE UPDATE ON material_destinations
WHEN NEW.id!=OLD.id OR NEW.organization_id!=OLD.organization_id OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at OR NEW.version!=OLD.version+1
BEGIN SELECT RAISE(ABORT,'material_destination_identity'); END;
--> statement-breakpoint
CREATE TRIGGER material_destinations_no_delete BEFORE DELETE ON material_destinations
BEGIN SELECT RAISE(ABORT,'material_destination_immutable'); END;
--> statement-breakpoint
CREATE TABLE stock_movement_destinations (
 movement_id TEXT PRIMARY KEY NOT NULL REFERENCES stock_movements(id),
 destination_id TEXT NOT NULL REFERENCES material_destinations(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX stock_movement_destinations_destination_idx ON stock_movement_destinations(destination_id,created_at,movement_id);
--> statement-breakpoint
-- Appended with the movement in the same batch; the destination belongs to the project's organization.
CREATE TRIGGER stock_movement_destination_validate BEFORE INSERT ON stock_movement_destinations
WHEN NOT EXISTS(SELECT 1 FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id
  JOIN material_destinations d ON d.id=NEW.destination_id AND d.organization_id=p.organization_id AND d.status='active'
  WHERE m.id=NEW.movement_id AND p.id=NEW.project_id AND m.kind IN('receive','distribute','consume','adjust') AND m.created_at=NEW.created_at)
BEGIN SELECT RAISE(ABORT,'stock_destination_scope'); END;
--> statement-breakpoint
CREATE TRIGGER stock_movement_destination_no_update BEFORE UPDATE ON stock_movement_destinations
BEGIN SELECT RAISE(ABORT,'stock_destination_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER stock_movement_destination_no_delete BEFORE DELETE ON stock_movement_destinations
BEGIN SELECT RAISE(ABORT,'stock_destination_immutable'); END;
--> statement-breakpoint
CREATE TABLE stock_movement_revisions (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 id TEXT NOT NULL UNIQUE,
 item_id TEXT NOT NULL REFERENCES items(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 root_movement_id TEXT NOT NULL REFERENCES stock_movements(id),
 target_movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(id),
 kind TEXT NOT NULL,
 reversal_movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(id),
 replacement_movement_id TEXT UNIQUE REFERENCES stock_movements(id),
 reason TEXT NOT NULL,
 changes_json TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 CONSTRAINT stock_revision_kind CHECK(kind IN('correction','reversal')),
 CHECK((kind='correction')=(replacement_movement_id IS NOT NULL)),
 CHECK(length(trim(reason)) BETWEEN 3 AND 2000),
 CHECK(json_valid(changes_json)),
 CHECK(length(actor_id) BETWEEN 1 AND 200),
 CHECK(julianday(created_at) IS NOT NULL),
 CHECK(reversal_movement_id!=target_movement_id AND replacement_movement_id IS NOT target_movement_id AND replacement_movement_id IS NOT reversal_movement_id)
);
--> statement-breakpoint
CREATE INDEX stock_movement_revisions_root_idx ON stock_movement_revisions(root_movement_id,sequence);
--> statement-breakpoint
CREATE INDEX stock_movement_revisions_item_idx ON stock_movement_revisions(item_id,sequence);
--> statement-breakpoint
-- A movement is superseded at most once (UNIQUE target). Only the current version of a chain can be
-- revised; a mirror row is never a target; the mirror exactly cancels the target; the replacement keeps
-- the item and the kind. Both new rows are written in this very batch (same timestamp).
CREATE TRIGGER stock_revision_validate BEFORE INSERT ON stock_movement_revisions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stock_movements t JOIN items i ON i.id=t.item_id
   WHERE t.id=NEW.target_movement_id AND t.item_id=NEW.item_id AND i.project_id=NEW.project_id AND i.category<>'equipment'
   AND t.kind IN('receive','distribute','consume','adjust')) THEN RAISE(ABORT,'stock_revision_scope') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_movement_revisions r WHERE r.reversal_movement_id IN(NEW.target_movement_id,NEW.reversal_movement_id,NEW.replacement_movement_id)
   OR r.replacement_movement_id IN(NEW.reversal_movement_id,NEW.replacement_movement_id) OR r.target_movement_id IN(NEW.reversal_movement_id,NEW.replacement_movement_id))
  THEN RAISE(ABORT,'stock_revision_chain') END;
 SELECT CASE WHEN NEW.root_movement_id IS NOT COALESCE((SELECT r.root_movement_id FROM stock_movement_revisions r WHERE r.replacement_movement_id=NEW.target_movement_id),NEW.target_movement_id)
  THEN RAISE(ABORT,'stock_revision_chain') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stock_movements t JOIN stock_movements v ON v.id=NEW.reversal_movement_id
   WHERE t.id=NEW.target_movement_id AND v.item_id=t.item_id AND v.kind=t.kind AND v.delta=-t.delta AND v.created_at=NEW.created_at)
  THEN RAISE(ABORT,'stock_revision_mirror') END;
 SELECT CASE WHEN NEW.replacement_movement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM stock_movements t JOIN stock_movements n ON n.id=NEW.replacement_movement_id
   WHERE t.id=NEW.target_movement_id AND n.item_id=t.item_id AND n.kind=t.kind AND n.created_at=NEW.created_at)
  THEN RAISE(ABORT,'stock_revision_replacement') END;
END;
--> statement-breakpoint
CREATE TRIGGER stock_revision_no_update BEFORE UPDATE ON stock_movement_revisions
BEGIN SELECT RAISE(ABORT,'stock_revision_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER stock_revision_no_delete BEFORE DELETE ON stock_movement_revisions
BEGIN SELECT RAISE(ABORT,'stock_revision_immutable'); END;
--> statement-breakpoint
-- Evidence of a movement (photo of the delivery, the CI/SEI paper, a PDF) is a regular record
-- attachment kept in the same private storage as the material photos. This link keeps it out of
-- the material's photo gallery.
CREATE TABLE stock_movement_records (
 movement_id TEXT PRIMARY KEY NOT NULL REFERENCES stock_movements(id),
 record_id TEXT NOT NULL UNIQUE REFERENCES records(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER stock_movement_record_validate BEFORE INSERT ON stock_movement_records
WHEN NOT EXISTS(SELECT 1 FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN records r ON r.id=NEW.record_id
  WHERE m.id=NEW.movement_id AND i.project_id=NEW.project_id AND r.project_id=NEW.project_id AND r.item_id=m.item_id AND r.loan_id IS NULL
  AND r.kind IN('material','distribution','consumption'))
 OR EXISTS(SELECT 1 FROM record_attachments a WHERE a.record_id=NEW.record_id)
BEGIN SELECT RAISE(ABORT,'stock_record_scope'); END;
--> statement-breakpoint
CREATE TRIGGER stock_movement_record_no_update BEFORE UPDATE ON stock_movement_records
BEGIN SELECT RAISE(ABORT,'stock_record_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER stock_movement_record_no_delete BEFORE DELETE ON stock_movement_records
BEGIN SELECT RAISE(ABORT,'stock_record_immutable'); END;
--> statement-breakpoint
-- An evidence record cannot become the main photo of the material.
DROP TRIGGER item_primary_photo_guard;
--> statement-breakpoint
CREATE TRIGGER item_primary_photo_guard BEFORE INSERT ON item_primary_photos
WHEN NOT EXISTS(SELECT 1 FROM items i WHERE i.id=NEW.item_id AND i.project_id=NEW.project_id)
 OR NOT EXISTS(SELECT 1 FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id
  WHERE a.id=NEW.attachment_id AND a.deleted_at IS NULL AND a.mime LIKE 'image/%' AND r.item_id=NEW.item_id AND r.project_id=NEW.project_id AND r.loan_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM stock_movement_records evidence WHERE evidence.record_id=r.id))
 OR (EXISTS(SELECT 1 FROM item_primary_photos p WHERE p.item_id=NEW.item_id)
  AND NEW.previous_attachment_id IS NOT (SELECT p.attachment_id FROM item_primary_photos p WHERE p.item_id=NEW.item_id ORDER BY p.sequence DESC LIMIT 1))
 OR (NOT EXISTS(SELECT 1 FROM item_primary_photos p WHERE p.item_id=NEW.item_id) AND NEW.previous_attachment_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id
   WHERE a.id=NEW.previous_attachment_id AND r.item_id=NEW.item_id AND r.project_id=NEW.project_id))
BEGIN SELECT RAISE(ABORT,'primary_photo_changed'); END;
--> statement-breakpoint
-- Logical deletion of a photo or an evidence file: who, when and why are written first, in the same
-- batch. The bytes stay in storage and the row stays in the table (only hidden).
CREATE TABLE record_attachment_deletions (
 attachment_id TEXT PRIMARY KEY NOT NULL REFERENCES record_attachments(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 item_id TEXT REFERENCES items(id),
 movement_id TEXT REFERENCES stock_movements(id),
 reason TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 CHECK(length(actor_id) BETWEEN 1 AND 200),
 CHECK(julianday(created_at) IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX record_attachment_deletions_item_idx ON record_attachment_deletions(item_id,created_at);
--> statement-breakpoint
CREATE TRIGGER record_attachment_deletion_validate BEFORE INSERT ON record_attachment_deletions
WHEN NOT EXISTS(SELECT 1 FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id
  WHERE a.id=NEW.attachment_id AND a.project_id=NEW.project_id AND a.deleted_at IS NULL AND r.loan_id IS NULL
  AND (NEW.item_id IS NULL OR r.item_id=NEW.item_id)
  AND (NEW.movement_id IS NULL OR EXISTS(SELECT 1 FROM stock_movement_records l WHERE l.record_id=r.id AND l.movement_id=NEW.movement_id)))
BEGIN SELECT RAISE(ABORT,'attachment_deletion_scope'); END;
--> statement-breakpoint
CREATE TRIGGER record_attachment_deletion_no_update BEFORE UPDATE ON record_attachment_deletions
BEGIN SELECT RAISE(ABORT,'attachment_deletion_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER record_attachment_deletion_no_delete BEFORE DELETE ON record_attachment_deletions
BEGIN SELECT RAISE(ABORT,'attachment_deletion_immutable'); END;
--> statement-breakpoint
-- The current main photo must be replaced before it is hidden; earlier main photos may be hidden
-- (the pointer history keeps the reference). Identity of referenced photos never changes.
DROP TRIGGER item_primary_photo_attachment_keep;
--> statement-breakpoint
CREATE TRIGGER item_primary_photo_attachment_keep BEFORE UPDATE OF deleted_at,record_id,object_key,mime ON record_attachments
WHEN (EXISTS(SELECT 1 FROM item_primary_photos p WHERE p.attachment_id=OLD.id OR p.previous_attachment_id=OLD.id)
  AND (NEW.record_id!=OLD.record_id OR NEW.object_key!=OLD.object_key OR NEW.mime!=OLD.mime))
 OR (NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM item_primary_photos p WHERE p.attachment_id=OLD.id
  AND p.sequence=(SELECT MAX(q.sequence) FROM item_primary_photos q WHERE q.item_id=p.item_id)))
BEGIN SELECT RAISE(ABORT,'primary_photo_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER record_attachment_hide_logged BEFORE UPDATE OF deleted_at ON record_attachments
WHEN NEW.deleted_at IS NOT OLD.deleted_at AND (OLD.deleted_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM record_attachment_deletions d WHERE d.attachment_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'attachment_deletion_required'); END;
--> statement-breakpoint
-- Ownership of a material: the project keeps access control; an organizational unit (gabinete,
-- comunicação) may be the owner, and the material may be set aside for an event destination.
ALTER TABLE items ADD COLUMN owner_unit_id TEXT REFERENCES organizational_units(id);
--> statement-breakpoint
ALTER TABLE items ADD COLUMN event_destination_id TEXT;
--> statement-breakpoint
CREATE INDEX items_owner_unit_idx ON items(owner_unit_id);
--> statement-breakpoint
CREATE TRIGGER items_owner_validate_insert BEFORE INSERT ON items
WHEN (NEW.owner_unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organizational_units u WHERE u.id=NEW.owner_unit_id AND u.status='active'))
 OR (NEW.event_destination_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_destinations d JOIN projects p ON p.organization_id=d.organization_id
  WHERE d.id=NEW.event_destination_id AND p.id=NEW.project_id AND d.status='active'))
BEGIN SELECT RAISE(ABORT,'item_owner_scope'); END;
--> statement-breakpoint
CREATE TRIGGER items_owner_validate_update BEFORE UPDATE OF owner_unit_id,event_destination_id ON items
WHEN (NEW.owner_unit_id IS NOT OLD.owner_unit_id AND NEW.owner_unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organizational_units u WHERE u.id=NEW.owner_unit_id AND u.status='active'))
 OR (NEW.event_destination_id IS NOT OLD.event_destination_id AND NEW.event_destination_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_destinations d JOIN projects p ON p.organization_id=d.organization_id
  WHERE d.id=NEW.event_destination_id AND p.id=NEW.project_id AND d.status='active'))
BEGIN SELECT RAISE(ABORT,'item_owner_scope'); END;
