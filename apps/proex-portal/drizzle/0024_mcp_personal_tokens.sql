CREATE TABLE `mcp_personal_tokens` (
 `id` text PRIMARY KEY NOT NULL,
 `user_id` text NOT NULL REFERENCES `portal_users`(`user_id`),
 `label` text NOT NULL,
 `token_hash` text NOT NULL,
 `scope_json` text NOT NULL,
 `projects_json` text NOT NULL,
 `request_id` text NOT NULL,
 `expires_at` text NOT NULL,
 `revoked_at` text,
 `created_at` text NOT NULL,
 CONSTRAINT `mcp_token_hash_length` CHECK(length(`token_hash`)=64),
 CONSTRAINT `mcp_token_label_length` CHECK(length(trim(`label`)) BETWEEN 1 AND 80),
 CONSTRAINT `mcp_token_scopes_json` CHECK(json_valid(`scope_json`) AND json_type(`scope_json`)='array' AND json_array_length(`scope_json`) BETWEEN 1 AND 2),
 CONSTRAINT `mcp_token_projects_json` CHECK(json_valid(`projects_json`) AND json_type(`projects_json`)='array' AND json_array_length(`projects_json`) BETWEEN 1 AND 20),
 CONSTRAINT `mcp_token_expiry` CHECK(julianday(`expires_at`)>julianday(`created_at`) AND julianday(`expires_at`)<=julianday(`created_at`)+30)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_token_hash_unique` ON `mcp_personal_tokens` (`token_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_token_request_unique` ON `mcp_personal_tokens` (`user_id`,`request_id`);
--> statement-breakpoint
CREATE INDEX `mcp_token_user_created_idx` ON `mcp_personal_tokens` (`user_id`,`created_at`);
