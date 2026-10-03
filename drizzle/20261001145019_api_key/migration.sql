-- Personal API keys (task 082): the @better-auth/api-key plugin's table, in the shape of its
-- schema source. Additive: no existing table changes. The plugin's reference_id is the
-- owning user; the foreign key, which the plugin doesn't declare, deletes a user's keys with
-- the user row. `key` holds a hash of the key, never the key itself.
CREATE TABLE api_key (
  id text PRIMARY KEY NOT NULL,
  config_id text NOT NULL DEFAULT 'default',
  name text,
  start text,
  reference_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  prefix text,
  key text NOT NULL,
  refill_interval integer,
  refill_amount integer,
  last_refill_at integer,
  enabled integer NOT NULL DEFAULT 1 CONSTRAINT api_key_enabled CHECK (enabled IN (0, 1)),
  rate_limit_enabled integer NOT NULL DEFAULT 1 CONSTRAINT api_key_rate_limit_enabled CHECK (rate_limit_enabled IN (0, 1)),
  rate_limit_time_window integer,
  rate_limit_max integer,
  request_count integer NOT NULL DEFAULT 0,
  remaining integer,
  last_request integer,
  expires_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  permissions text,
  metadata text
);
--> statement-breakpoint
-- Settings lists a user's keys.
CREATE INDEX api_key_reference_id_idx ON api_key (reference_id);
--> statement-breakpoint
-- Verifying a request looks its key up by hash.
CREATE UNIQUE INDEX api_key_key_unique ON api_key (key);
