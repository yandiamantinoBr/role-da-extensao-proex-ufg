CREATE TABLE `chat_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploader_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_attachments_mime" CHECK("chat_attachments"."mime" IN ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "chat_attachments_size" CHECK("chat_attachments"."size" BETWEEN 1 AND 1572864)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_attachments_key_idx` ON `chat_attachments` (`object_key`);--> statement-breakpoint
CREATE INDEX `chat_attachments_expiry_idx` ON `chat_attachments` (`deleted_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `chat_attachments_uploader_idx` ON `chat_attachments` (`uploader_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`user_a` text,
	`user_b` text,
	`created_at` text NOT NULL,
	`last_message_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_a`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_b`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_conversations_kind" CHECK(("chat_conversations"."kind"='project' AND "chat_conversations"."project_id" IS NOT NULL AND "chat_conversations"."user_a" IS NULL AND "chat_conversations"."user_b" IS NULL) OR ("chat_conversations"."kind"='direct' AND "chat_conversations"."project_id" IS NULL AND "chat_conversations"."user_a" IS NOT NULL AND "chat_conversations"."user_b" IS NOT NULL AND "chat_conversations"."user_a"<"chat_conversations"."user_b"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_conversations_project_idx` ON `chat_conversations` (`project_id`) WHERE "chat_conversations"."kind"='project';--> statement-breakpoint
CREATE UNIQUE INDEX `chat_conversations_pair_idx` ON `chat_conversations` (`organization_id`,`user_a`,`user_b`) WHERE "chat_conversations"."kind"='direct';--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`attachment_id` text,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `chat_attachments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_messages_body" CHECK(length("chat_messages"."body")<=2000)
);
--> statement-breakpoint
CREATE INDEX `chat_messages_conversation_idx` ON `chat_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_messages_sender_idx` ON `chat_messages` (`sender_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_reads` (
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_read_at` text NOT NULL,
	PRIMARY KEY(`conversation_id`, `user_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `community_email_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
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
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "community_email_queue_status" CHECK("community_email_queue"."status" IN ('queued','claimed','sending','accepted','accepted_attested','uncertain','closed_unconfirmed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_email_queue_message_idx` ON `community_email_queue` (`message_id`);--> statement-breakpoint
CREATE INDEX `community_email_queue_dispatch_idx` ON `community_email_queue` (`organization_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `ombuds_designations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`designated_by` text NOT NULL,
	`reason` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text,
	`revoke_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ombuds_designations_reason" CHECK(length("ombuds_designations"."reason") BETWEEN 3 AND 300),
	CONSTRAINT "ombuds_designations_dates" CHECK("ombuds_designations"."ends_on">="ombuds_designations"."starts_on"),
	CONSTRAINT "ombuds_designations_revoke" CHECK(("ombuds_designations"."revoked_at" IS NULL AND "ombuds_designations"."revoked_by" IS NULL AND "ombuds_designations"."revoke_reason" IS NULL) OR ("ombuds_designations"."revoked_at" IS NOT NULL AND "ombuds_designations"."revoked_by" IS NOT NULL AND length("ombuds_designations"."revoke_reason") BETWEEN 3 AND 300))
);
--> statement-breakpoint
CREATE INDEX `ombuds_designations_user_idx` ON `ombuds_designations` (`user_id`,`revoked_at`,`starts_on`,`ends_on`);--> statement-breakpoint
ALTER TABLE `community_preferences` ADD `message_email` integer DEFAULT 1 NOT NULL;