CREATE TABLE `stock_movement_contexts` (
	`movement_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`counterparty_unit_id` text,
	`counterparty_project_id` text,
	`process_reference` text DEFAULT '' NOT NULL,
	`beneficiary_reference` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`date_source` text NOT NULL,
	`material_name` text NOT NULL,
	`measurement_unit` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counterparty_unit_id`) REFERENCES `organizational_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counterparty_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_context_process_length" CHECK(length("stock_movement_contexts"."process_reference")<=120),
	CONSTRAINT "stock_context_beneficiary_length" CHECK(length("stock_movement_contexts"."beneficiary_reference")<=160),
	CONSTRAINT "stock_context_occurred_valid" CHECK(julianday("stock_movement_contexts"."occurred_at") IS NOT NULL),
	CONSTRAINT "stock_context_created_valid" CHECK(julianday("stock_movement_contexts"."created_at") IS NOT NULL),
	CONSTRAINT "stock_context_date_source" CHECK("stock_movement_contexts"."date_source" IN('registration','declared')),
	CONSTRAINT "stock_context_name_length" CHECK(length(trim("stock_movement_contexts"."material_name")) BETWEEN 1 AND 200),
	CONSTRAINT "stock_context_unit_length" CHECK(length(trim("stock_movement_contexts"."measurement_unit")) BETWEEN 1 AND 200),
	CONSTRAINT "stock_context_exclusive" CHECK("stock_movement_contexts"."counterparty_unit_id" IS NULL OR "stock_movement_contexts"."counterparty_project_id" IS NULL),
	CONSTRAINT "stock_context_date_range" CHECK(julianday("stock_movement_contexts"."occurred_at")>=julianday('2000-01-01') AND julianday("stock_movement_contexts"."occurred_at")<julianday('2201-01-01')),
	CONSTRAINT "stock_context_date_future" CHECK(julianday("stock_movement_contexts"."occurred_at")<=julianday("stock_movement_contexts"."created_at")+5.0/1440)
);
--> statement-breakpoint
CREATE INDEX `stock_context_project_date_idx` ON `stock_movement_contexts` (`project_id`,`occurred_at`,`movement_id`);--> statement-breakpoint
CREATE INDEX `stock_context_unit_idx` ON `stock_movement_contexts` (`counterparty_unit_id`,`occurred_at`,`movement_id`);--> statement-breakpoint
CREATE INDEX `stock_context_counterparty_project_idx` ON `stock_movement_contexts` (`counterparty_project_id`,`occurred_at`,`movement_id`);
--> statement-breakpoint
-- The context is appended with the ledger in one batch. Legacy rows stay absent.
CREATE TRIGGER stock_context_validate BEFORE INSERT ON stock_movement_contexts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id JOIN organizations o ON o.id=p.organization_id WHERE m.id=NEW.movement_id AND m.kind IN('receive','distribute','consume','adjust') AND p.id=NEW.project_id AND p.status='active' AND o.status='active' AND i.name=NEW.material_name AND i.unit=NEW.measurement_unit AND m.created_at=NEW.created_at) THEN RAISE(ABORT,'stock_context_scope') END;
 SELECT CASE WHEN NEW.counterparty_unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organizational_units WHERE id=NEW.counterparty_unit_id AND status='active') THEN RAISE(ABORT,'stock_context_counterparty') END;
 SELECT CASE WHEN NEW.counterparty_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects owner JOIN projects other ON other.organization_id=owner.organization_id WHERE owner.id=NEW.project_id AND other.id=NEW.counterparty_project_id AND other.status='active' AND other.id<>owner.id) THEN RAISE(ABORT,'stock_context_counterparty') END;
 SELECT CASE WHEN NEW.date_source='registration' AND NEW.occurred_at<>NEW.created_at THEN RAISE(ABORT,'stock_context_date') END;
END;
--> statement-breakpoint
CREATE TRIGGER stock_context_immutable_update BEFORE UPDATE ON stock_movement_contexts BEGIN SELECT RAISE(ABORT,'stock_context_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER stock_context_immutable_delete BEFORE DELETE ON stock_movement_contexts BEGIN SELECT RAISE(ABORT,'stock_context_immutable'); END;
