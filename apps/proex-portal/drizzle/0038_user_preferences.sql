CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`project_pins` text DEFAULT '[]' NOT NULL,
	`team_pins` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `portal_users`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_preferences_project_pins" CHECK(json_valid("user_preferences"."project_pins") AND json_type("user_preferences"."project_pins")='array' AND json_array_length("user_preferences"."project_pins")<=12),
	CONSTRAINT "user_preferences_team_pins" CHECK(json_valid("user_preferences"."team_pins") AND json_type("user_preferences"."team_pins")='array' AND json_array_length("user_preferences"."team_pins")<=12),
	CONSTRAINT "user_preferences_version" CHECK("user_preferences"."version" >= 1)
);
