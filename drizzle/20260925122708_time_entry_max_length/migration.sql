-- An entry is at most 24 hours long (MAX_ENTRY_MS, docs/architecture.md). The app checks it
-- before writing, but two concurrent edits, one to each end, can each pass that check. A
-- CHECK constraint would need a table rebuild; triggers enforce it without one. The message
-- reads like a failed CHECK, so failedConstraint (src/server/queries.server.ts) names it.
CREATE TRIGGER time_entry_max_length_insert BEFORE INSERT ON time_entry FOR EACH ROW
WHEN NEW.stopped_at - NEW.started_at > 86400000
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: time_entry_max_length');
END;
--> statement-breakpoint
CREATE TRIGGER time_entry_max_length_update BEFORE UPDATE OF started_at, stopped_at ON time_entry FOR EACH ROW
WHEN NEW.stopped_at - NEW.started_at > 86400000
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: time_entry_max_length');
END;
