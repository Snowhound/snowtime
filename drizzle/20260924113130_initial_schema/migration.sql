-- Initial schema: Better Auth core, organization plugin with teams, and the app tables.
-- Design and column notes: datamodel/snowtime.dbml. Conventions: docs/migrations.md.

-- Auth (Better Auth core) -----------------------------------------------------------------

CREATE TABLE user (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  email_verified integer DEFAULT 0 NOT NULL,
  image text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT user_email_verified CHECK (email_verified IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX user_email_unique ON user (email);
--> statement-breakpoint

CREATE TABLE organization (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  logo text,
  metadata text,
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_slug_unique ON organization (slug);
--> statement-breakpoint

CREATE TABLE team (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name text NOT NULL,
  member_count integer DEFAULT 0 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX team_organization_id_name_unique ON team (organization_id, name);
--> statement-breakpoint
CREATE UNIQUE INDEX team_id_organization_id_unique ON team (id, organization_id);
--> statement-breakpoint

CREATE TABLE session (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token text NOT NULL,
  expires_at integer NOT NULL,
  ip_address text,
  user_agent text,
  active_organization_id text REFERENCES organization(id) ON DELETE SET NULL,
  active_team_id text REFERENCES team(id) ON DELETE SET NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX session_token_unique ON session (token);
--> statement-breakpoint
CREATE INDEX session_user_id_idx ON session (user_id);
--> statement-breakpoint

CREATE TABLE account (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at integer,
  refresh_token_expires_at integer,
  scope text,
  password text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX account_user_id_idx ON account (user_id);
--> statement-breakpoint

CREATE TABLE verification (
  id text PRIMARY KEY NOT NULL,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX verification_identifier_idx ON verification (identifier);
--> statement-breakpoint

-- Tenancy (Better Auth organization plugin, teams enabled) ---------------------------------

CREATE TABLE member (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role text DEFAULT 'member' NOT NULL,
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX member_organization_id_user_id_unique ON member (organization_id, user_id);
--> statement-breakpoint
CREATE INDEX member_user_id_idx ON member (user_id);
--> statement-breakpoint

-- role is app-managed: Better Auth has no additional fields on team members and never
-- touches it, so its inserts get the default.
CREATE TABLE team_member (
  id text PRIMARY KEY NOT NULL,
  team_id text NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role text DEFAULT 'member' NOT NULL,
  membership_key text,
  created_at integer,
  CONSTRAINT team_member_role CHECK (role IN ('lead', 'member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX team_member_team_id_user_id_unique ON team_member (team_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX team_member_membership_key_unique ON team_member (membership_key);
--> statement-breakpoint
CREATE INDEX team_member_user_id_idx ON team_member (user_id);
--> statement-breakpoint

CREATE TABLE invitation (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text,
  team_id text REFERENCES team(id) ON DELETE SET NULL,
  status text DEFAULT 'pending' NOT NULL,
  expires_at integer NOT NULL,
  inviter_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX invitation_organization_id_email_idx ON invitation (organization_id, email);
--> statement-breakpoint

-- App ----------------------------------------------------------------------------------------

CREATE TABLE user_settings (
  user_id text PRIMARY KEY NOT NULL REFERENCES user(id),
  time_zone text NOT NULL,
  week_start text DEFAULT 'mon' NOT NULL,
  created_at integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
  created_by text NOT NULL REFERENCES user(id),
  updated_at integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
  updated_by text NOT NULL REFERENCES user(id),
  CONSTRAINT user_settings_week_start CHECK (week_start IN ('mon', 'sun'))
);
--> statement-breakpoint
CREATE TRIGGER user_settings_updated_at AFTER UPDATE ON user_settings FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE user_settings SET updated_at = CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)
  WHERE user_id = NEW.user_id;
END;
--> statement-breakpoint

CREATE TABLE project (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organization(id),
  name text NOT NULL,
  color text,
  archived_at integer,
  created_at integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
  created_by text NOT NULL REFERENCES user(id),
  updated_at integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
  updated_by text NOT NULL REFERENCES user(id),
  sys_deleted integer DEFAULT 0 NOT NULL,
  CONSTRAINT project_sys_deleted CHECK (sys_deleted IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_organization_id_name_unique ON project (organization_id, name)
  WHERE sys_deleted = 0;
--> statement-breakpoint
CREATE UNIQUE INDEX project_id_organization_id_unique ON project (id, organization_id);
--> statement-breakpoint
CREATE TRIGGER project_updated_at AFTER UPDATE ON project FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE project SET updated_at = CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)
  WHERE id = NEW.id;
END;
--> statement-breakpoint

CREATE TABLE project_team (
  project_id text NOT NULL,
  team_id text NOT NULL,
  organization_id text NOT NULL REFERENCES organization(id),
  created_at integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
  created_by text NOT NULL REFERENCES user(id),
  CONSTRAINT project_team_pk PRIMARY KEY (project_id, team_id),
  CONSTRAINT project_team_project_fk FOREIGN KEY (project_id, organization_id)
    REFERENCES project(id, organization_id),
  CONSTRAINT project_team_team_fk FOREIGN KEY (team_id, organization_id)
    REFERENCES team(id, organization_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX project_team_organization_id_team_id_idx ON project_team (organization_id, team_id);
--> statement-breakpoint

CREATE TABLE time_entry (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organization(id),
  user_id text NOT NULL REFERENCES user(id),
  project_id text,
  description text DEFAULT '' NOT NULL,
  started_at integer NOT NULL,
  stopped_at integer,
  created_at integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
  created_by text NOT NULL REFERENCES user(id),
  updated_at integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
  updated_by text NOT NULL REFERENCES user(id),
  sys_deleted integer DEFAULT 0 NOT NULL,
  CONSTRAINT time_entry_project_fk FOREIGN KEY (project_id, organization_id)
    REFERENCES project(id, organization_id),
  CONSTRAINT time_entry_stopped_after_started CHECK (stopped_at IS NULL OR stopped_at > started_at),
  CONSTRAINT time_entry_sys_deleted CHECK (sys_deleted IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX time_entry_one_running ON time_entry (user_id)
  WHERE stopped_at IS NULL AND sys_deleted = 0;
--> statement-breakpoint
CREATE INDEX time_entry_organization_id_user_id_started_at_idx
  ON time_entry (organization_id, user_id, started_at);
--> statement-breakpoint
CREATE INDEX time_entry_organization_id_started_at_idx ON time_entry (organization_id, started_at);
--> statement-breakpoint
CREATE INDEX time_entry_project_id_idx ON time_entry (project_id);
--> statement-breakpoint
CREATE TRIGGER time_entry_updated_at AFTER UPDATE ON time_entry FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE time_entry SET updated_at = CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)
  WHERE id = NEW.id;
END;
