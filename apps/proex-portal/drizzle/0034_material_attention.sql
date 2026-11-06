-- Episodes start only on a new real crossing. Existing/initial low balances are not imported.
CREATE TABLE material_attention_episodes (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 id TEXT NOT NULL UNIQUE,
 item_id TEXT NOT NULL REFERENCES items(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 opened_at TEXT NOT NULL,
 opened_available INTEGER NOT NULL,
 opened_threshold INTEGER NOT NULL CHECK(opened_threshold>=0),
 cause TEXT NOT NULL CHECK(cause IN('stock','threshold')),
 resolved_at TEXT,
 resolved_available INTEGER,
 resolution TEXT CHECK(resolution IN('recovered','inactive')),
 CHECK((resolved_at IS NULL AND resolved_available IS NULL AND resolution IS NULL) OR
       (resolved_at IS NOT NULL AND resolved_available IS NOT NULL AND resolution IS NOT NULL))
);
CREATE UNIQUE INDEX material_attention_open_idx ON material_attention_episodes(item_id) WHERE resolved_at IS NULL;
CREATE INDEX material_attention_scope_idx ON material_attention_episodes(project_id,resolved_at,sequence);
CREATE TABLE material_attention_receipts (
 episode_id TEXT NOT NULL REFERENCES material_attention_episodes(id),
 user_id TEXT NOT NULL REFERENCES portal_users(user_id),
 read_at TEXT,
 dismissed_at TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(episode_id,user_id)
);
CREATE INDEX material_attention_user_idx ON material_attention_receipts(user_id,dismissed_at,episode_id);
CREATE TRIGGER material_attention_resolve AFTER UPDATE OF stock,reserved,low_stock,condition,category ON items
WHEN NEW.condition!='active' OR NEW.category='equipment' OR
 (NEW.stock-NEW.reserved>NEW.low_stock AND
  (NEW.stock!=OLD.stock OR NEW.low_stock!=OLD.low_stock OR NEW.reserved=OLD.reserved OR NOT EXISTS(
   -- A consumed reservation is released before its prize ledger row is inserted.
   -- That intermediate available balance is not a replenishment.
   SELECT 1 FROM reservations pending_reservation JOIN entitlements pending_delivery
    ON pending_delivery.attempt_id=pending_reservation.attempt_id AND pending_delivery.offer_id=pending_reservation.offer_id
   WHERE pending_reservation.item_id=NEW.id AND pending_reservation.state='consumed' AND pending_delivery.state='delivered'
    AND NOT EXISTS(SELECT 1 FROM stock_movements delivered WHERE delivered.ref_id='prize:'||pending_delivery.id||':'||NEW.id)
  )))
BEGIN
 UPDATE material_attention_episodes SET resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),resolved_available=NEW.stock-NEW.reserved,
 resolution=CASE WHEN NEW.condition!='active' OR NEW.category='equipment' THEN 'inactive' ELSE 'recovered' END
 WHERE item_id=NEW.id AND resolved_at IS NULL;
END;
CREATE TRIGGER material_attention_cross AFTER UPDATE OF stock,low_stock ON items
WHEN NEW.condition='active' AND NEW.category!='equipment' AND OLD.condition='active' AND OLD.category!='equipment'
 AND OLD.stock-OLD.reserved>OLD.low_stock AND NEW.stock-NEW.reserved<=NEW.low_stock
 AND (NEW.stock!=OLD.stock OR NEW.low_stock!=OLD.low_stock)
 AND (NEW.low_stock!=OLD.low_stock OR EXISTS(
  SELECT 1 FROM stock_movements manual_move WHERE manual_move.item_id=NEW.id
   AND manual_move.rowid=(SELECT MAX(last_move.rowid) FROM stock_movements last_move WHERE last_move.item_id=NEW.id)
   AND manual_move.ref_id LIKE 'manual:%' AND manual_move.kind IN('receive','consume','distribute','adjust')
   AND manual_move.delta=NEW.stock-OLD.stock
 ))
BEGIN
 INSERT OR IGNORE INTO material_attention_episodes(id,item_id,project_id,opened_at,opened_available,opened_threshold,cause)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.project_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.stock-NEW.reserved,NEW.low_stock,
 CASE WHEN NEW.stock!=OLD.stock THEN 'stock' ELSE 'threshold' END);
END;
CREATE TRIGGER material_attention_identity BEFORE UPDATE ON material_attention_episodes
WHEN NEW.sequence!=OLD.sequence OR NEW.id!=OLD.id OR NEW.item_id!=OLD.item_id OR NEW.project_id!=OLD.project_id
 OR NEW.opened_at!=OLD.opened_at OR NEW.opened_available!=OLD.opened_available OR NEW.opened_threshold!=OLD.opened_threshold
 OR NEW.cause!=OLD.cause OR OLD.resolved_at IS NOT NULL OR NEW.resolved_at IS NULL
BEGIN SELECT RAISE(ABORT,'material_attention_immutable'); END;
CREATE TRIGGER material_attention_no_delete BEFORE DELETE ON material_attention_episodes
BEGIN SELECT RAISE(ABORT,'material_attention_immutable'); END;
CREATE TRIGGER material_attention_receipt_identity BEFORE UPDATE ON material_attention_receipts
WHEN NEW.episode_id!=OLD.episode_id OR NEW.user_id!=OLD.user_id OR (OLD.read_at IS NOT NULL AND NEW.read_at IS NOT OLD.read_at)
BEGIN SELECT RAISE(ABORT,'material_attention_receipt_identity'); END;
