-- A live entry never points at a deleted project (docs/architecture.md, "Data conventions").
-- deleteProject checks for live entries first, and createEntry and updateEntry check the
-- project, but a delete can land between another request's check and its write. The
-- composite foreign key can't catch it, because a deleted project's row stays. The messages
-- read like a failed CHECK, so failedConstraint (src/server/queries.server.ts) names them.
-- Additive: an entry already on a deleted project stays editable, since only a change of
-- project is checked.
CREATE TRIGGER time_entry_live_project_insert BEFORE INSERT ON time_entry FOR EACH ROW
WHEN NEW.project_id IS NOT NULL AND NEW.sys_deleted = 0
  AND EXISTS (SELECT 1 FROM project WHERE id = NEW.project_id AND sys_deleted = 1)
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: time_entry_live_project');
END;
--> statement-breakpoint
CREATE TRIGGER time_entry_live_project_update BEFORE UPDATE OF project_id ON time_entry FOR EACH ROW
WHEN NEW.project_id IS NOT OLD.project_id AND NEW.project_id IS NOT NULL AND NEW.sys_deleted = 0
  AND EXISTS (SELECT 1 FROM project WHERE id = NEW.project_id AND sys_deleted = 1)
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: time_entry_live_project');
END;
--> statement-breakpoint
CREATE TRIGGER project_deleted_with_entries BEFORE UPDATE OF sys_deleted ON project FOR EACH ROW
WHEN NEW.sys_deleted = 1 AND OLD.sys_deleted = 0
  AND EXISTS (SELECT 1 FROM time_entry WHERE project_id = NEW.id AND sys_deleted = 0)
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: project_deleted_with_entries');
END;
