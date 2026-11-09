-- Additive only. Prize levels are configuration of a dynamic: they never touch stock,
-- reservations, entitlements or deliveries. Primary photos are an append-only pointer log;
-- earlier photos stay as attachments and in the history.
CREATE TABLE campaign_prize_settings (
 campaign_id TEXT PRIMARY KEY NOT NULL REFERENCES campaigns(id),
 super_super_percent INTEGER NOT NULL CHECK(typeof(super_super_percent)='integer' AND super_super_percent BETWEEN 0 AND 100),
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version>=1),
 updated_by TEXT NOT NULL CHECK(length(updated_by) BETWEEN 1 AND 200),
 updated_at TEXT NOT NULL
);
CREATE TABLE campaign_prize_tiers (
 campaign_id TEXT NOT NULL REFERENCES campaign_prize_settings(campaign_id),
 offer_id TEXT NOT NULL REFERENCES offers(id),
 tier TEXT NOT NULL CHECK(tier IN('brinde','super','super_super')),
 updated_by TEXT NOT NULL CHECK(length(updated_by) BETWEEN 1 AND 200),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(campaign_id,offer_id)
);
CREATE INDEX campaign_prize_tiers_offer_idx ON campaign_prize_tiers(offer_id);
CREATE TABLE campaign_prize_history (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 id TEXT NOT NULL UNIQUE,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 kind TEXT NOT NULL CHECK(kind IN('tier','percent')),
 offer_id TEXT REFERENCES offers(id),
 previous_tier TEXT CHECK(previous_tier IS NULL OR previous_tier IN('brinde','super','super_super')),
 tier TEXT CHECK(tier IS NULL OR tier IN('brinde','super','super_super')),
 previous_percent INTEGER CHECK(previous_percent IS NULL OR previous_percent BETWEEN 0 AND 100),
 percent INTEGER CHECK(percent IS NULL OR percent BETWEEN 0 AND 100),
 actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 200),
 created_at TEXT NOT NULL,
 CHECK((kind='tier' AND offer_id IS NOT NULL AND previous_percent IS NULL AND percent IS NULL AND previous_tier IS NOT tier)
    OR (kind='percent' AND offer_id IS NULL AND previous_tier IS NULL AND tier IS NULL AND percent IS NOT NULL AND previous_percent IS NOT percent))
);
CREATE INDEX campaign_prize_history_campaign_idx ON campaign_prize_history(campaign_id,sequence);
-- A level may only point to an offer of the dynamic's own project.
CREATE TRIGGER campaign_prize_tier_scope_insert BEFORE INSERT ON campaign_prize_tiers
WHEN NOT EXISTS(SELECT 1 FROM offers o JOIN campaigns c ON c.project_id=o.project_id WHERE o.id=NEW.offer_id AND c.id=NEW.campaign_id)
BEGIN SELECT RAISE(ABORT,'prize_tier_scope'); END;
CREATE TRIGGER campaign_prize_tier_scope_update BEFORE UPDATE ON campaign_prize_tiers
WHEN NEW.campaign_id!=OLD.campaign_id OR NEW.offer_id!=OLD.offer_id
BEGIN SELECT RAISE(ABORT,'prize_tier_scope'); END;
CREATE TRIGGER campaign_prize_settings_identity BEFORE UPDATE ON campaign_prize_settings
WHEN NEW.campaign_id!=OLD.campaign_id OR NEW.version!=OLD.version+1
BEGIN SELECT RAISE(ABORT,'prize_settings_version'); END;
CREATE TRIGGER campaign_prize_settings_no_delete BEFORE DELETE ON campaign_prize_settings
BEGIN SELECT RAISE(ABORT,'prize_history_immutable'); END;
CREATE TRIGGER campaign_prize_history_no_update BEFORE UPDATE ON campaign_prize_history
BEGIN SELECT RAISE(ABORT,'prize_history_immutable'); END;
CREATE TRIGGER campaign_prize_history_no_delete BEFORE DELETE ON campaign_prize_history
BEGIN SELECT RAISE(ABORT,'prize_history_immutable'); END;

CREATE TABLE item_primary_photos (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 id TEXT NOT NULL UNIQUE,
 item_id TEXT NOT NULL REFERENCES items(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 attachment_id TEXT NOT NULL REFERENCES record_attachments(id),
 previous_attachment_id TEXT REFERENCES record_attachments(id),
 actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 200),
 created_at TEXT NOT NULL,
 CHECK(previous_attachment_id IS NULL OR previous_attachment_id!=attachment_id)
);
CREATE INDEX item_primary_photos_item_idx ON item_primary_photos(item_id,sequence);
-- The new photo must be a live image of this material; "previous" must be the photo that was
-- actually primary (the latest pointer, or before any pointer an image of the same material).
CREATE TRIGGER item_primary_photo_guard BEFORE INSERT ON item_primary_photos
WHEN NOT EXISTS(SELECT 1 FROM items i WHERE i.id=NEW.item_id AND i.project_id=NEW.project_id)
 OR NOT EXISTS(SELECT 1 FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id
  WHERE a.id=NEW.attachment_id AND a.deleted_at IS NULL AND a.mime LIKE 'image/%' AND r.item_id=NEW.item_id AND r.project_id=NEW.project_id AND r.loan_id IS NULL)
 OR (EXISTS(SELECT 1 FROM item_primary_photos p WHERE p.item_id=NEW.item_id)
  AND NEW.previous_attachment_id IS NOT (SELECT p.attachment_id FROM item_primary_photos p WHERE p.item_id=NEW.item_id ORDER BY p.sequence DESC LIMIT 1))
 OR (NOT EXISTS(SELECT 1 FROM item_primary_photos p WHERE p.item_id=NEW.item_id) AND NEW.previous_attachment_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id
   WHERE a.id=NEW.previous_attachment_id AND r.item_id=NEW.item_id AND r.project_id=NEW.project_id))
BEGIN SELECT RAISE(ABORT,'primary_photo_changed'); END;
CREATE TRIGGER item_primary_photos_no_update BEFORE UPDATE ON item_primary_photos
BEGIN SELECT RAISE(ABORT,'primary_photo_immutable'); END;
CREATE TRIGGER item_primary_photos_no_delete BEFORE DELETE ON item_primary_photos
BEGIN SELECT RAISE(ABORT,'primary_photo_immutable'); END;
-- Photos referenced by the history are kept: they cannot be hidden or removed.
CREATE TRIGGER item_primary_photo_attachment_keep BEFORE UPDATE OF deleted_at,record_id,object_key,mime ON record_attachments
WHEN EXISTS(SELECT 1 FROM item_primary_photos p WHERE p.attachment_id=OLD.id OR p.previous_attachment_id=OLD.id)
 AND (NEW.deleted_at IS NOT NULL OR NEW.record_id!=OLD.record_id OR NEW.object_key!=OLD.object_key OR NEW.mime!=OLD.mime)
BEGIN SELECT RAISE(ABORT,'primary_photo_immutable'); END;
CREATE TRIGGER item_primary_photo_attachment_no_delete BEFORE DELETE ON record_attachments
WHEN EXISTS(SELECT 1 FROM item_primary_photos p WHERE p.attachment_id=OLD.id OR p.previous_attachment_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'primary_photo_immutable'); END;
