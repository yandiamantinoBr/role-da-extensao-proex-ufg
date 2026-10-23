-- A pending physical attendance can be abandoned without inventing a game result.
DROP TRIGGER attempt_finalize_validate;
--> statement-breakpoint
CREATE TRIGGER attempt_finalize_validate BEFORE UPDATE ON attempts BEGIN
 SELECT CASE WHEN OLD.state!='pending' OR NOT ((NEW.state='done' AND NEW.result IN ('brinde','super','miss','retry','retry_exhausted')) OR (NEW.state='cancelled' AND NEW.result='cancelled')) OR NEW.participation_id!=OLD.participation_id OR NEW.number!=OLD.number OR NEW.idempotency_key!=OLD.idempotency_key THEN RAISE(ABORT,'attempt_immutable') END;
END;
--> statement-breakpoint
DROP TRIGGER attempt_finalize;
--> statement-breakpoint
CREATE TRIGGER attempt_finalize AFTER UPDATE ON attempts BEGIN
 UPDATE participations SET state= CASE WHEN NEW.state='cancelled' THEN 'cancelled' WHEN NEW.result='retry' THEN 'retry_ready' ELSE 'complete' END WHERE id=NEW.participation_id;
END;
