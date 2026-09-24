-- Passkey sign-in (task 015): the @better-auth/passkey plugin's table, in the shape of its
-- schema source. Additive: no existing table changes. Like account, a user's passkeys go
-- when the user row does; users are anonymized rather than deleted, which also removes
-- their credentials (docs/architecture.md, "Data conventions").
CREATE TABLE passkey (
  id text PRIMARY KEY NOT NULL,
  name text,
  public_key text NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  counter integer NOT NULL,
  device_type text NOT NULL,
  backed_up integer NOT NULL CONSTRAINT passkey_backed_up CHECK (backed_up IN (0, 1)),
  transports text,
  created_at integer,
  aaguid text
);
--> statement-breakpoint
CREATE INDEX passkey_user_id_idx ON passkey (user_id);
--> statement-breakpoint
-- Credential ids are unique per the WebAuthn spec; sign-in looks passkeys up by them.
CREATE UNIQUE INDEX passkey_credential_id_unique ON passkey (credential_id);
