-- Voluntário por ação (10/11/2026). Acesso a uma única dinâmica (campanha), com data de fim.
-- Não é vínculo com o projeto: fica fora de `members`, então nenhuma verificação de "faz parte da equipe" o enxerga.
-- O convite continua em `invites` (função operator) e ganha um recorte em `invite_campaign_scopes`.
CREATE TABLE `campaign_volunteers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`campaign_id` text NOT NULL,
	`project_id` text NOT NULL,
	`invite_id` text NOT NULL,
	`ends_at` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text,
	`revoke_reason` text,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campaign_volunteers_revoke_check" CHECK(("campaign_volunteers"."revoked_at" IS NULL AND "campaign_volunteers"."revoked_by" IS NULL AND "campaign_volunteers"."revoke_reason" IS NULL) OR ("campaign_volunteers"."revoked_at" IS NOT NULL AND "campaign_volunteers"."revoke_reason" IN ('expired','revoked')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_volunteers_invite_unique` ON `campaign_volunteers` (`invite_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_volunteers_active_unique` ON `campaign_volunteers` (`user_id`,`campaign_id`) WHERE "campaign_volunteers"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `campaign_volunteers_user_idx` ON `campaign_volunteers` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `campaign_volunteers_project_idx` ON `campaign_volunteers` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `campaign_volunteers_due_idx` ON `campaign_volunteers` (`ends_at`) WHERE "campaign_volunteers"."revoked_at" IS NULL;--> statement-breakpoint
CREATE TABLE `invite_campaign_scopes` (
	`invite_id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`ends_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- O recorte só vale para convite de operador do mesmo projeto da ação, com fim válido.
CREATE TRIGGER `invite_campaign_scope_validate` BEFORE INSERT ON `invite_campaign_scopes` BEGIN
	SELECT RAISE(ABORT,'invite_campaign_scope') WHERE julianday(NEW.ends_at) IS NULL OR NOT EXISTS(
		SELECT 1 FROM invites i JOIN campaigns c ON c.id=NEW.campaign_id AND c.project_id=i.project_id
		WHERE i.id=NEW.invite_id AND i.role='operator' AND i.accepted_at IS NULL AND i.revoked_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER `invite_campaign_scope_immutable_update` BEFORE UPDATE ON `invite_campaign_scopes` BEGIN SELECT RAISE(ABORT,'invite_campaign_scope_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `invite_campaign_scope_immutable_delete` BEFORE DELETE ON `invite_campaign_scopes` BEGIN SELECT RAISE(ABORT,'invite_campaign_scope_immutable'); END;
--> statement-breakpoint
-- O voluntário nasce só do convite recortado: mesma ação, mesmo projeto e mesmo prazo, ainda vigente.
CREATE TRIGGER `campaign_volunteer_validate` BEFORE INSERT ON `campaign_volunteers` BEGIN
	SELECT RAISE(ABORT,'campaign_volunteer_scope') WHERE NEW.revoked_at IS NOT NULL OR julianday(NEW.ends_at)<=julianday('now') OR NOT EXISTS(
		SELECT 1 FROM invite_campaign_scopes s JOIN invites i ON i.id=s.invite_id JOIN campaigns c ON c.id=s.campaign_id
		WHERE s.invite_id=NEW.invite_id AND s.campaign_id=NEW.campaign_id AND s.ends_at=NEW.ends_at
		AND i.project_id=NEW.project_id AND c.project_id=NEW.project_id AND i.created_by=NEW.granted_by);
END;
--> statement-breakpoint
-- Depois de criado, só se encerra (vencimento ou revogação), uma única vez, sem mudar a ação, a pessoa ou o prazo.
-- A única outra mudança é apagar o e-mail na anonimização (LGPD).
CREATE TRIGGER `campaign_volunteer_update` BEFORE UPDATE ON `campaign_volunteers` BEGIN
	SELECT RAISE(ABORT,'campaign_volunteer_immutable') WHERE (NEW.email IS NOT OLD.email AND NEW.email!='')
		OR NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.campaign_id IS NOT OLD.campaign_id
		OR NEW.project_id IS NOT OLD.project_id OR NEW.invite_id IS NOT OLD.invite_id OR NEW.ends_at IS NOT OLD.ends_at
		OR NEW.granted_by IS NOT OLD.granted_by OR NEW.created_at IS NOT OLD.created_at
		OR (OLD.revoked_at IS NULL AND NEW.revoked_at IS NULL)
		OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.revoked_by IS NOT OLD.revoked_by OR NEW.revoke_reason IS NOT OLD.revoke_reason));
END;
--> statement-breakpoint
CREATE TRIGGER `campaign_volunteer_delete` BEFORE DELETE ON `campaign_volunteers` BEGIN SELECT RAISE(ABORT,'campaign_volunteer_immutable'); END;
