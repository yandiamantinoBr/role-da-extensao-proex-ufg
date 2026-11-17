CREATE TABLE `invite_email_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`code_cipher` text,
	`requested_by` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`claim_hash` text,
	`claim_nonce` text,
	`claim_expires_at` integer,
	`dispatcher_id` text,
	`credential_hash` text,
	`configuration_version` integer,
	`send_nonce` text,
	`acceptance_hash` text,
	`sending_at` text,
	`accepted_at` text,
	`reconciled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invite_email_queue_status" CHECK("invite_email_queue"."status" IN ('queued','claimed','sending','accepted','accepted_attested','uncertain','closed_unconfirmed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_email_queue_invite_idx` ON `invite_email_queue` (`invite_id`);--> statement-breakpoint
CREATE INDEX `invite_email_queue_dispatch_idx` ON `invite_email_queue` (`organization_id`,`status`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `followup_email_dispatch_state` ADD `invite_kind_at` text;