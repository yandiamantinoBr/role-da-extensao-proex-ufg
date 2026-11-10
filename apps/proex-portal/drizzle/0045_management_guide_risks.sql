-- Gestão da organização: guia da PROEX (páginas, versões, editores), riscos e modelo usado por equipe.
-- Só acréscimos; nenhum dado é criado pela migração.
CREATE TABLE `org_guide_editors` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `org_guide_page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `org_guide_pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "org_guide_page_versions_note" CHECK(length("org_guide_page_versions"."note") <= 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_guide_page_versions_idx` ON `org_guide_page_versions` (`page_id`,`version`);--> statement-breakpoint
CREATE TABLE `org_guide_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`section` text NOT NULL,
	`body` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "org_guide_pages_slug" CHECK(length("org_guide_pages"."slug") BETWEEN 1 AND 80 AND "org_guide_pages"."slug" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "org_guide_pages_title" CHECK(length("org_guide_pages"."title") BETWEEN 1 AND 160),
	CONSTRAINT "org_guide_pages_section" CHECK("org_guide_pages"."section" IN ('organizacao','processos','referencias')),
	CONSTRAINT "org_guide_pages_body" CHECK(length("org_guide_pages"."body") <= 40000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_guide_pages_slug_idx` ON `org_guide_pages` (`organization_id`,`slug`);--> statement-breakpoint
CREATE TABLE `org_risks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`campaign_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'operacional' NOT NULL,
	`probability` integer NOT NULL,
	`impact` integer NOT NULL,
	`owner_label` text DEFAULT '' NOT NULL,
	`mitigation` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`review_on` text,
	`is_example` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "org_risks_title" CHECK(length("org_risks"."title") BETWEEN 1 AND 160),
	CONSTRAINT "org_risks_text" CHECK(length("org_risks"."description") <= 2000 AND length("org_risks"."mitigation") <= 2000 AND length("org_risks"."owner_label") <= 120),
	CONSTRAINT "org_risks_scale" CHECK("org_risks"."probability" BETWEEN 1 AND 5 AND "org_risks"."impact" BETWEEN 1 AND 5),
	CONSTRAINT "org_risks_status" CHECK("org_risks"."status" IN ('open','monitoring','mitigated','closed')),
	CONSTRAINT "org_risks_category" CHECK("org_risks"."category" IN ('operacional','tecnologia','pessoas','financeiro','reputacao','legal','outro')),
	CONSTRAINT "org_risks_example" CHECK("org_risks"."is_example" IN (0,1)),
	CONSTRAINT "org_risks_campaign" CHECK("org_risks"."campaign_id" IS NULL OR "org_risks"."project_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `org_risks_scope_idx` ON `org_risks` (`organization_id`,`project_id`,`status`,`review_on`);--> statement-breakpoint
CREATE TABLE `team_template_applications` (
	`team_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`template_id` text NOT NULL,
	`applied_by` text NOT NULL,
	`applied_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `followup_teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_template_applications_template" CHECK(length("team_template_applications"."template_id") BETWEEN 1 AND 40)
);
