CREATE TABLE `user_tutorials` (
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`chapter_version` integer NOT NULL,
	`step_id` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `chapter_id`),
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_tutorials_ids" CHECK(length("user_tutorials"."chapter_id") BETWEEN 1 AND 40 AND length("user_tutorials"."step_id") <= 40),
	CONSTRAINT "user_tutorials_status" CHECK("user_tutorials"."status" IN ('in_progress','paused','completed','dismissed','started')),
	CONSTRAINT "user_tutorials_version" CHECK("user_tutorials"."chapter_version" >= 1)
);
