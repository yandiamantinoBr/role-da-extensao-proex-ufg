-- Classificação da extensão (FORPROEX/UFG) e metadados das unidades da UFG.
-- Aditiva: preserva dados, chaves estrangeiras e gatilhos. Valores vazios = não informado.
ALTER TABLE `organizational_units` ADD `group_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `organizational_units` ADD `campus` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `organizational_units` ADD `official_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `thematic_area` text DEFAULT '' NOT NULL CONSTRAINT projects_thematic_area_check CHECK(thematic_area IN ('','comunicacao','cultura','direitos_humanos_justica','educacao','meio_ambiente','saude','tecnologia_producao','trabalho'));--> statement-breakpoint
ALTER TABLE `projects` ADD `extension_line` text DEFAULT '' NOT NULL CONSTRAINT projects_extension_line_check CHECK(extension_line='' OR (length(extension_line)=2 AND extension_line BETWEEN '01' AND '53'));--> statement-breakpoint
CREATE INDEX `projects_thematic_area_idx` ON `projects` (`thematic_area`);
