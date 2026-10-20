CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`participation_id` text NOT NULL,
	`number` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`result` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`participation_id`) REFERENCES `participations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attempts_number_check" CHECK("attempts"."number" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_participation_number_unique` ON `attempts` (`participation_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_idempotency_unique` ON `attempts` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`project_id` text,
	`action` text NOT NULL,
	`entity_id` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_project_created_idx` ON `audit` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`retry_limit` integer,
	`brinde_offer_id` text,
	`super_offer_id` text,
	`rules_text` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brinde_offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`super_offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campaigns_status_check" CHECK("campaigns"."status" IN ('draft','active','paused','closed')),
	CONSTRAINT "campaigns_retry_check" CHECK("campaigns"."retry_limit" IS NULL OR "campaigns"."retry_limit" BETWEEN 0 AND 3),
	CONSTRAINT "campaigns_version_check" CHECK("campaigns"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `campaigns_project_idx` ON `campaigns` (`project_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`loan_id` text NOT NULL,
	`project_id` text NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_size_check" CHECK("documents"."size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_object_key_unique` ON `documents` (`object_key`);--> statement-breakpoint
CREATE TABLE `entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`participation_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`delivered_at` text,
	`delivered_by` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participation_id`) REFERENCES `participations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "entitlements_state_check" CHECK("entitlements"."state" IN ('reserved','delivered','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entitlements_attempt_unique` ON `entitlements` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`project_id` text,
	`created_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_by` text,
	`accepted_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invites_role_check" CHECK("invites"."role" IN ('manager','operator','inventory','loans','viewer')),
	CONSTRAINT "invites_accepted_pair_check" CHECK(("invites"."accepted_at" IS NULL) = ("invites"."accepted_by" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invites_email_idx` ON `invites` (`email`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`unit` text NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`low_stock` integer DEFAULT 0 NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`condition` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "items_category_check" CHECK("items"."category" IN ('gift','equipment','distribution','consumption')),
	CONSTRAINT "items_condition_check" CHECK("items"."condition" IN ('active','maintenance','inactive')),
	CONSTRAINT "items_quantities_check" CHECK("items"."stock" >= 0 AND "items"."reserved" >= 0 AND "items"."reserved" <= "items"."stock" AND "items"."low_stock" >= 0),
	CONSTRAINT "items_equipment_single_check" CHECK("items"."category" != 'equipment' OR "items"."stock" <= 1)
);
--> statement-breakpoint
CREATE INDEX `items_project_idx` ON `items` (`project_id`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`item_id` text NOT NULL,
	`action_name` text NOT NULL,
	`borrower_name` text NOT NULL,
	`borrower_contact` text DEFAULT '' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`condition_out` text DEFAULT '' NOT NULL,
	`condition_in` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`returned_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "loans_interval_check" CHECK("loans"."ends_at" > "loans"."starts_at"),
	CONSTRAINT "loans_status_check" CHECK("loans"."status" IN ('reserved','out','returned','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `loans_item_interval_idx` ON `loans` (`item_id`,`status`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `loans_project_idx` ON `loans` (`project_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`project_id` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "members_role_check" CHECK("members"."role" IN ('owner','manager','operator','inventory','loans','viewer')),
	CONSTRAINT "members_owner_scope_check" CHECK("members"."role" != 'owner' OR "members"."project_id" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `members_user_active_idx` ON `members` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `members_project_idx` ON `members` (`project_id`);--> statement-breakpoint
CREATE TABLE `offer_components` (
	`offer_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "offer_components_quantity_check" CHECK("offer_components"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `offer_components_unique` ON `offer_components` (`offer_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "offers_kind_check" CHECK("offers"."kind" IN ('brinde','super')),
	CONSTRAINT "offers_active_check" CHECK("offers"."active" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `offers_project_idx` ON `offers` (`project_id`);--> statement-breakpoint
CREATE TABLE `participations` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`identity_id` text NOT NULL,
	`identity_method` text NOT NULL,
	`modality` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "participations_identity_method_check" CHECK("participations"."identity_method" IN ('account','ticket')),
	CONSTRAINT "participations_modality_check" CHECK("participations"."modality" IN ('wheel','dice','physical')),
	CONSTRAINT "participations_attempt_count_check" CHECK("participations"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participations_campaign_identity_unique` ON `participations` (`campaign_id`,`identity_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`participation_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`participation_id`) REFERENCES `participations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reservations_quantity_check" CHECK("reservations"."quantity" > 0),
	CONSTRAINT "reservations_state_check" CHECK("reservations"."state" IN ('held','released','consumed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_attempt_offer_item_unique` ON `reservations` (`attempt_id`,`offer_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `reservations_item_state_idx` ON `reservations` (`item_id`,`state`);--> statement-breakpoint
CREATE TABLE `settings` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`delta` integer NOT NULL,
	`kind` text NOT NULL,
	`note` text NOT NULL,
	`ref_id` text,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_movements_delta_check" CHECK("stock_movements"."delta" != 0),
	CONSTRAINT "stock_movements_kind_check" CHECK("stock_movements"."kind" IN ('receive','distribute','consume','adjust','redeem','transfer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_movements_ref_unique` ON `stock_movements` (`ref_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_item_idx` ON `stock_movements` (`item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `visits` (
	`campaign_id` text NOT NULL,
	`day` text NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "visits_hits_check" CHECK("visits"."hits" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visits_campaign_day_unique` ON `visits` (`campaign_id`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX members_active_scope_unique ON members(user_id,COALESCE(project_id,'')) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER stock_equipment_in_use BEFORE INSERT ON stock_movements WHEN NEW.delta<0 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM items WHERE id=NEW.item_id AND stock+NEW.delta<reserved) THEN RAISE(ABORT,'stock_unavailable') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM items i JOIN loans l ON l.item_id=i.id WHERE i.id=NEW.item_id AND i.category='equipment' AND l.status IN ('reserved','out')) THEN RAISE(ABORT,'asset_unavailable') END;
END;
--> statement-breakpoint
CREATE TRIGGER stock_apply AFTER INSERT ON stock_movements BEGIN
 UPDATE items SET stock=stock+NEW.delta WHERE id=NEW.item_id;
END;
--> statement-breakpoint
CREATE TRIGGER movement_immutable_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT,'movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER movement_immutable_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT,'movement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER reservation_validate BEFORE INSERT ON reservations BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM items WHERE id=NEW.item_id AND stock-reserved<NEW.quantity) THEN RAISE(ABORT,'stock_unavailable') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM offer_components oc JOIN offers o ON o.id=oc.offer_id JOIN items i ON i.id=oc.item_id JOIN attempts a ON a.id=NEW.attempt_id JOIN participations p ON p.id=a.participation_id JOIN campaigns c ON c.id=p.campaign_id WHERE oc.offer_id=NEW.offer_id AND oc.item_id=NEW.item_id AND oc.quantity=NEW.quantity AND o.project_id=c.project_id AND i.project_id=c.project_id AND i.condition='active' AND NEW.participation_id=p.id AND NEW.state='held') THEN RAISE(ABORT,'reservation_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER reservation_hold AFTER INSERT ON reservations WHEN NEW.state='held' BEGIN UPDATE items SET reserved=reserved+NEW.quantity WHERE id=NEW.item_id; END;
--> statement-breakpoint
CREATE TRIGGER reservation_transition BEFORE UPDATE ON reservations BEGIN
 SELECT CASE WHEN OLD.state!='held' OR NEW.state NOT IN ('released','consumed') OR NEW.item_id!=OLD.item_id OR NEW.quantity!=OLD.quantity OR NEW.offer_id!=OLD.offer_id OR NEW.attempt_id!=OLD.attempt_id OR NEW.participation_id!=OLD.participation_id THEN RAISE(ABORT,'reservation_transition') END;
END;
--> statement-breakpoint
CREATE TRIGGER reservation_release AFTER UPDATE ON reservations WHEN OLD.state='held' AND NEW.state IN ('released','consumed') BEGIN UPDATE items SET reserved=reserved-OLD.quantity WHERE id=OLD.item_id; END;
--> statement-breakpoint
CREATE TRIGGER attempt_validate BEFORE INSERT ON attempts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM participations p JOIN campaigns c ON c.id=p.campaign_id WHERE p.id=NEW.participation_id AND p.state IN ('ready','retry_ready') AND NEW.number=p.attempt_count+1 AND NEW.number<=c.retry_limit+1 AND c.status='active' AND c.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND c.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN RAISE(ABORT,'participation_used') END;
 SELECT CASE WHEN NOT ((NEW.state='pending' AND NEW.result='pending') OR (NEW.state='done' AND NEW.result IN ('brinde','super','miss','retry','retry_exhausted'))) THEN RAISE(ABORT,'attempt_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER attempt_apply AFTER INSERT ON attempts BEGIN
 UPDATE participations SET attempt_count=NEW.number,state= CASE WHEN NEW.state='pending' THEN 'physical_pending' WHEN NEW.result='retry' THEN 'retry_ready' ELSE 'complete' END WHERE id=NEW.participation_id;
END;
--> statement-breakpoint
CREATE TRIGGER attempt_finalize_validate BEFORE UPDATE ON attempts BEGIN
 SELECT CASE WHEN OLD.state!='pending' OR NEW.state!='done' OR NEW.result NOT IN ('brinde','super','miss','retry','retry_exhausted') OR NEW.participation_id!=OLD.participation_id OR NEW.number!=OLD.number OR NEW.idempotency_key!=OLD.idempotency_key THEN RAISE(ABORT,'attempt_immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER attempt_finalize AFTER UPDATE ON attempts BEGIN UPDATE participations SET state= CASE WHEN NEW.result='retry' THEN 'retry_ready' ELSE 'complete' END WHERE id=NEW.participation_id; END;
--> statement-breakpoint
CREATE TRIGGER loan_validate_insert BEFORE INSERT ON loans WHEN NEW.status IN ('reserved','out') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM items WHERE id=NEW.item_id AND project_id=NEW.project_id AND category='equipment' AND stock=1 AND condition='active') THEN RAISE(ABORT,'asset_unavailable') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM loans l WHERE l.item_id=NEW.item_id AND l.status IN ('reserved','out') AND ((NEW.status='out' AND l.status='out') OR (l.starts_at<NEW.ends_at AND l.ends_at>NEW.starts_at) OR (l.status='out' AND l.ends_at<unixepoch('now')*1000))) THEN RAISE(ABORT,'loan_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER loan_validate_update BEFORE UPDATE ON loans WHEN NEW.status IN ('reserved','out') BEGIN
 SELECT CASE WHEN NEW.status='out' AND (NEW.starts_at>unixepoch('now')*1000 OR NEW.ends_at<=unixepoch('now')*1000) THEN RAISE(ABORT,'loan_checkout_window') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM items WHERE id=NEW.item_id AND project_id=NEW.project_id AND category='equipment' AND stock=1 AND condition='active') THEN RAISE(ABORT,'asset_unavailable') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM loans l WHERE l.id!=NEW.id AND l.item_id=NEW.item_id AND l.status IN ('reserved','out') AND ((NEW.status='out' AND l.status='out') OR (l.starts_at<NEW.ends_at AND l.ends_at>NEW.starts_at) OR (l.status='out' AND l.ends_at<unixepoch('now')*1000))) THEN RAISE(ABORT,'loan_conflict') END;
END;
