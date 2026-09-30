DROP INDEX time_entry_organization_id_started_at_idx;
--> statement-breakpoint
CREATE INDEX time_entry_organization_id_started_at_idx ON time_entry (organization_id, started_at, sys_deleted, stopped_at, user_id, project_id, ticket);
--> statement-breakpoint
DROP INDEX time_entry_organization_id_user_id_started_at_idx;
--> statement-breakpoint
CREATE INDEX time_entry_organization_id_user_id_started_at_idx ON time_entry (organization_id, user_id, started_at, sys_deleted, stopped_at, project_id, ticket);
