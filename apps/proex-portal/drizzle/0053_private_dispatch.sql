CREATE TABLE `followup_dispatch_details` (
	`task_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`document_kind` text,
	`holder_user_id` text,
	`document_ref` text DEFAULT '' NOT NULL,
	`urgency` text DEFAULT 'medium' NOT NULL,
	`on_agenda` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `followup_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`holder_user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "followup_dispatch_kind" CHECK("followup_dispatch_details"."kind" IN ('signature','question','decision','document_review','referral','agenda')),
	CONSTRAINT "followup_dispatch_document" CHECK("followup_dispatch_details"."document_kind" IS NULL OR "followup_dispatch_details"."document_kind" IN ('term','draft','notice','dispatch','acknowledgement','agreement','other')),
	CONSTRAINT "followup_dispatch_ref" CHECK(length("followup_dispatch_details"."document_ref") <= 500),
	CONSTRAINT "followup_dispatch_agenda" CHECK("followup_dispatch_details"."on_agenda" IN (0,1)),
	CONSTRAINT "followup_dispatch_urgency" CHECK("followup_dispatch_details"."urgency" IN ('immediate','high','medium','low'))
);
--> statement-breakpoint
CREATE TABLE `followup_task_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` text NOT NULL,
	`removed_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `followup_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `followup_task_participant_active_idx` ON `followup_task_participants` (`task_id`,`user_id`) WHERE "followup_task_participants"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `followup_task_participant_user_idx` ON `followup_task_participants` (`user_id`,`removed_at`,`task_id`);--> statement-breakpoint
CREATE TABLE `followup_task_privacy` (
	`task_id` text PRIMARY KEY NOT NULL,
	`visibility` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `followup_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "followup_task_privacy_visibility" CHECK("followup_task_privacy"."visibility" IN ('leadership','participants'))
);
--> statement-breakpoint
CREATE TABLE `leadership_group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` text NOT NULL,
	`removed_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leadership_group_active_idx` ON `leadership_group_members` (`organization_id`,`user_id`) WHERE "leadership_group_members"."removed_at" IS NULL;--> statement-breakpoint
CREATE TRIGGER `followup_task_privacy_no_delete` BEFORE DELETE ON `followup_task_privacy` BEGIN SELECT RAISE(ABORT, 'followup_privacy_immutable'); END;
