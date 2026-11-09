CREATE TABLE `community_badges` (
	`user_id` text NOT NULL,
	`badge` text NOT NULL,
	`week` text NOT NULL,
	`earned_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `badge`, `week`),
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "community_badges_badge" CHECK("community_badges"."badge" IN ('closer','helpful','thanks','field'))
);
--> statement-breakpoint
CREATE TABLE `community_blocks` (
	`user_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `blocked_id`),
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocked_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "community_blocks_people" CHECK("community_blocks"."user_id"!="community_blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE `community_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	`sender_hidden_at` text,
	`recipient_hidden_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "community_messages_body" CHECK(length("community_messages"."body") BETWEEN 1 AND 1000),
	CONSTRAINT "community_messages_people" CHECK("community_messages"."sender_id"!="community_messages"."recipient_id")
);
--> statement-breakpoint
CREATE INDEX `community_messages_inbox_idx` ON `community_messages` (`recipient_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `community_messages_sent_idx` ON `community_messages` (`sender_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `community_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`badges` integer DEFAULT 1 NOT NULL,
	`paused_until` text,
	`seen_level` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "community_preferences_badges" CHECK("community_preferences"."badges" IN (0,1))
);
