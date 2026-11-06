-- Calendar connections (task 097.02). Additive: two new tables and a nullable column.
-- A connection is a user's link to a calendar provider's account, with its tokens encrypted
-- by the app (src/server/calendar/tokens.server.ts). Disconnecting deletes it and its
-- sources physically, so neither table is soft-deleted.
CREATE TABLE calendar_connection (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider text NOT NULL,
  account_id text NOT NULL,
  account_email text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  access_token_expires_at integer NOT NULL,
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'connected',
  created_at integer NOT NULL DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)),
  created_by text NOT NULL REFERENCES user(id),
  updated_at integer NOT NULL DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)),
  updated_by text NOT NULL REFERENCES user(id)
);
--> statement-breakpoint
CREATE TRIGGER calendar_connection_updated_at AFTER UPDATE ON calendar_connection FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE calendar_connection SET updated_at = CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)
  WHERE id = NEW.id;
END;
--> statement-breakpoint
-- Connecting the same account again updates its row.
CREATE UNIQUE INDEX calendar_connection_user_id_provider_account_id_unique ON calendar_connection (user_id, provider, account_id);
--> statement-breakpoint
-- A calendar of a connection. auto_track_* are for task 097.04 and stay null until then.
CREATE TABLE calendar_source (
  id text PRIMARY KEY NOT NULL,
  connection_id text NOT NULL REFERENCES calendar_connection(id) ON DELETE CASCADE,
  provider_calendar_id text NOT NULL,
  name text NOT NULL,
  color text,
  is_primary integer NOT NULL DEFAULT 0 CONSTRAINT calendar_source_is_primary CHECK (is_primary IN (0, 1)),
  shown integer NOT NULL DEFAULT 0 CONSTRAINT calendar_source_shown CHECK (shown IN (0, 1)),
  auto_track_organization_id text REFERENCES organization(id) ON DELETE SET NULL,
  auto_track_since integer,
  created_at integer NOT NULL DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)),
  created_by text NOT NULL REFERENCES user(id),
  updated_at integer NOT NULL DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)),
  updated_by text NOT NULL REFERENCES user(id)
);
--> statement-breakpoint
CREATE TRIGGER calendar_source_updated_at AFTER UPDATE ON calendar_source FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE calendar_source SET updated_at = CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)
  WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE UNIQUE INDEX calendar_source_connection_id_provider_calendar_id_unique ON calendar_source (connection_id, provider_calendar_id);
--> statement-breakpoint
-- The key of the calendar event an entry was logged from. Deleted rows keep theirs, so the
-- index, unlike the table's others, leaves out the sys_deleted filter: a meeting is logged
-- once per user, and a deleted one stays deleted until the user logs it again.
ALTER TABLE time_entry ADD COLUMN calendar_event text;
--> statement-breakpoint
CREATE UNIQUE INDEX time_entry_user_id_calendar_event_unique ON time_entry (user_id, calendar_event) WHERE calendar_event IS NOT NULL;
