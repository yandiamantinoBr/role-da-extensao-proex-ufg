CREATE TABLE `followup_hidden_pending` (
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_version` integer NOT NULL,
	PRIMARY KEY(`user_id`, `task_id`),
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `followup_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "followup_hidden_pending_version" CHECK("followup_hidden_pending"."task_version">0)
);
--> statement-breakpoint
CREATE TABLE `followup_inbox_entries` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notification_id` text NOT NULL,
	`dismissed_at` text,
	FOREIGN KEY (`notification_id`) REFERENCES `followup_notifications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `followup_inbox_entries_notification_id_unique` ON `followup_inbox_entries` (`notification_id`);
--> statement-breakpoint
INSERT INTO followup_inbox_entries(notification_id)
 SELECT id FROM followup_notifications ORDER BY created_at,id;
--> statement-breakpoint
CREATE TRIGGER followup_inbox_entries_after_notice
 AFTER INSERT ON followup_notifications
 BEGIN
  INSERT INTO followup_inbox_entries(notification_id) VALUES(NEW.id);
 END;
