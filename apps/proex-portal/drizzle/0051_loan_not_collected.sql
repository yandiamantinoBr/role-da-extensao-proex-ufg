-- Reserva cujo horário venceu sem retirada (decisão de 2026-11-16): vira "Não retirada" e libera o equipamento.
-- Fica com status 'cancelled' e o motivo em close_reason; a restrição de situação da tabela não muda (sem reconstruir).
ALTER TABLE `loans` ADD `close_reason` text;--> statement-breakpoint
CREATE INDEX `loans_status_ends_idx` ON `loans` (`status`,`ends_at`);--> statement-breakpoint
-- O motivo só nasce no encerramento de uma reserva (reserved → cancelled) e depois não muda nem some.
CREATE TRIGGER `loan_close_reason_insert` BEFORE INSERT ON `loans` WHEN NEW.close_reason IS NOT NULL BEGIN
	SELECT RAISE(ABORT,'loan_close_reason');
END;--> statement-breakpoint
CREATE TRIGGER `loan_close_reason_set` BEFORE UPDATE OF close_reason ON `loans` WHEN NEW.close_reason IS NOT OLD.close_reason AND (OLD.close_reason IS NOT NULL OR NEW.close_reason<>'not_collected' OR OLD.status<>'reserved' OR NEW.status<>'cancelled') BEGIN
	SELECT RAISE(ABORT,'loan_close_reason');
END;--> statement-breakpoint
CREATE TRIGGER `loan_close_reason_keep` BEFORE UPDATE ON `loans` WHEN OLD.close_reason IS NOT NULL AND (NEW.close_reason IS NOT OLD.close_reason OR NEW.status IS NOT OLD.status) BEGIN
	SELECT RAISE(ABORT,'loan_close_reason');
END;
