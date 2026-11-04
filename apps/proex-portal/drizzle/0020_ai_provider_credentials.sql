CREATE TABLE `ai_provider_credential_metadata` (
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`mask` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`organization_id`, `provider`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_provider_credential_name" CHECK("ai_provider_credential_metadata"."provider" IN ('deepseek','typesafe','deepgram')),
	CONSTRAINT "ai_provider_credential_state" CHECK("ai_provider_credential_metadata"."state" IN ('active','disabled','removed'))
);
