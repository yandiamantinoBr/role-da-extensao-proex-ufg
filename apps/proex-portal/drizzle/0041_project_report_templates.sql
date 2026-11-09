-- Relatório do projeto: modelos salvos por projeto (seções, ordem, período, título e observações).
-- Aditiva: só cria a tabela e os índices. Sem dados reais.
CREATE TABLE `project_report_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`config_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL CHECK(typeof(`version`)='integer' AND `version`>=1),
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_report_templates_name" CHECK(length("project_report_templates"."name") BETWEEN 1 AND 80),
	CONSTRAINT "project_report_templates_config" CHECK(json_valid("project_report_templates"."config_json") AND length("project_report_templates"."config_json")<=40000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_report_templates_name_idx` ON `project_report_templates` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `project_report_templates_project_idx` ON `project_report_templates` (`project_id`,`updated_at`);