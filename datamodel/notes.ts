// The hand-written part of the diagram: table groups and notes. datamodel/generate-dbml.ts
// reads everything else (columns, types, keys, indexes, references) from src/db/schema.ts.
//
// The generator adds these on its own, so leave them out of the notes here: ON DELETE
// rules, partial index WHERE clauses, and which composite foreign key a column is part of.
// Notes are plain text without apostrophes (the ChartDB converter reads single-quoted
// strings only).

export const projectNote = `
Data model for Snowtime on Turso (libSQL/SQLite).

Tables in the auth and tenancy groups belong to Better Auth and its organization
plugin; their shape follows the plugin. Everything else is owned by the app.`

export interface Group {
  name: string
  color: string
  // Section heading and comment lines above the group's tables.
  title: string
  comment?: string[]
  tables: string[]
}

// Every table belongs to one group; the generator warns about any that does not.
export const groups: Group[] = [
  {
    name: 'auth',
    color: '#BAB0AC',
    title: 'Auth (Better Auth core and passkey plugin)',
    tables: ['user', 'session', 'account', 'passkey', 'verification'],
  },
  {
    name: 'tenancy',
    color: '#4E79A7',
    title: 'Tenancy (Better Auth organization plugin, teams enabled)',
    tables: ['organization', 'member', 'team', 'team_member', 'invitation'],
  },
  {
    name: 'tracking',
    color: '#59A14F',
    title: 'App',
    comment: [
      'Audit columns (see datamodel/README.md): created_*/updated_* on mutable tables,',
      'created_* only on insert-and-delete link tables, sys_deleted on entities users delete.',
    ],
    tables: ['user_settings', 'project', 'project_team', 'time_entry'],
  },
]

// Notes for the audit columns of every app-owned table (those with created_by). A table's
// own column note replaces them.
export const auditNotes: Record<string, string> = {
  created_at: 'Audit. Epoch ms, set by the database.',
  created_by: 'Audit. Acting user, set by the app per request.',
  updated_at: 'Audit. Set by the app on update; trigger fallback.',
  updated_by: 'Audit. Acting user of the last change, set by the app.',
  sys_deleted:
    'Audit. Logical delete, CHECK 0 or 1. Deleted rows are excluded everywhere, reports included.',
}

export interface TableNotes {
  note?: string
  columns?: Record<string, string>
  // By index name, as in schema.ts.
  indexes?: Record<string, string>
}

export const tables: Record<string, TableNotes> = {
  user: {
    note: 'Better Auth user. One row per human, shared across organizations.',
    columns: {
      id: 'UUIDv7.',
      name: 'Display name.',
      email: 'Sign-in email, stored lowercased.',
      email_verified: 'Boolean.',
      image: 'Avatar URL.',
      created_at: 'Epoch ms, UTC.',
      updated_at: 'Epoch ms, UTC.',
    },
  },
  session: {
    note: 'Better Auth session. Carries the active organization and team, which every server function reads to scope its queries.',
    columns: {
      token: 'Session token held in the cookie.',
      expires_at: 'Epoch ms, UTC.',
      active_organization_id:
        'Organization plugin. The tenant every query in this session is scoped to.',
      active_team_id: 'Organization plugin with teams. Optional filter, not an access boundary.',
    },
  },
  account: {
    note: 'Better Auth credential or linked provider. Email/password sign-in stores the password hash here.',
    columns: {
      account_id: 'Identifier at the provider; equals user_id for the credential provider.',
      provider_id: 'credential, or an OAuth provider id.',
      password: 'Password hash, credential provider only.',
    },
  },
  passkey: {
    note: 'Passkey plugin (@better-auth/passkey). A WebAuthn credential a signed-in user registered; sign-in looks it up by credential_id.',
    columns: {
      name: 'Label the user gave it.',
      public_key: 'COSE public key, base64.',
      credential_id: 'WebAuthn credential id, base64url.',
      counter: 'Signature counter, checked against replayed assertions.',
      device_type: 'singleDevice or multiDevice.',
      backed_up: 'Boolean. Synced by the platform, e.g. iCloud Keychain.',
      transports: 'Comma-separated, e.g. internal,hybrid.',
      created_at: 'Epoch ms, UTC.',
      aaguid: 'Authenticator model id.',
    },
  },
  verification: {
    note: 'Better Auth one-time values: email verification, password reset.',
    columns: {
      identifier: 'What the value verifies, e.g. an email address.',
    },
  },
  organization: {
    note: 'Tenant. Every app-owned table carries organization_id and every query filters by it.',
    columns: {
      slug: 'URL-safe handle.',
      metadata: 'Plugin-defined JSON. Not used by the app.',
    },
  },
  member: {
    note: 'A user in an organization. A user can be a member of several organizations.',
    columns: {
      role: 'owner, admin, member (plugin defaults). No CHECK: the plugin can store several roles comma-separated.',
    },
  },
  team: {
    note: 'A group of members within an organization. Groups people for access and reporting; it owns no data.',
    columns: {
      member_count: 'Maintained by Better Auth when members join or leave.',
    },
    indexes: {
      team_id_organization_id_unique:
        'Target of composite foreign keys, so rows pointing at a team cannot name another organization.',
    },
  },
  team_member: {
    note: 'A user in a team. A member can be in several teams of the same organization.',
    columns: {
      role: 'App-managed. CHECK: lead, member. A lead reads and reports on the time of the team. Better Auth 1.7 has no additional fields on team members, so it never reads or writes this column; new rows get the default.',
      membership_key: 'Better Auth dedupe key, SHA-256 of team_id and user_id.',
    },
  },
  invitation: {
    note: 'Pending invitation to an organization, optionally into a team.',
    columns: {
      email: 'Invitee address, lowercased.',
      role: 'Organization role granted on acceptance.',
      team_id: 'Team joined on acceptance, if any.',
      status: 'pending, accepted, rejected, canceled.',
    },
  },
  user_settings: {
    note: 'Per-user settings, one row per user, shared across organizations and devices. Created on first sign-in with the time zone and language of the browser. Lives as long as the user, so no sys_deleted.',
    columns: {
      time_zone: 'IANA zone, e.g. Europe/Tallinn. Drives display and report day/week boundaries.',
      week_start: 'CHECK: mon, sun.',
      locale:
        'UI language: en, et. Set from the browser on first sign-in; validated in the app, no CHECK.',
      theme:
        'system, light, dark. The server renders the theme class from it. Validated in the app, no CHECK.',
      timer_layout: 'bar, focus, table. Validated in the app, no CHECK.',
      show_summary: 'Boolean 0/1 (CHECK). Whether the timer page shows the summary.',
      compact_rows: 'Boolean 0/1 (CHECK), default 0. Whether the timer shows entry rows compact.',
      app_icon:
        'Brand concept 01 to 12 (src/lib/app-icon.ts), default 02. Header mark and favicon. Validated in the app, no CHECK.',
      scene_season:
        'auto (by month), winter, spring, summer, autumn. The scene, weather, and tagline. Validated in the app, no CHECK.',
      scene_background: 'Boolean 0/1 (CHECK). Whether the season image shows behind the pages.',
      scene_strength:
        'dimmed, full: how much page color covers the image. Validated in the app, no CHECK.',
      surfaces:
        'glass, solid: whether cards let the image show through. Validated in the app, no CHECK.',
      scene_weather: 'Boolean 0/1 (CHECK). Whether the season weather effect runs.',
      scene_intro: 'Boolean 0/1 (CHECK). Whether the intro plays on first visit and once a season.',
    },
  },
  project: {
    note: 'Owned by the organization. Visible to the whole organization unless assigned to teams.',
    columns: {
      id: 'UUIDv7, generated on the client.',
      color: 'Hex color for the UI, e.g. #4E79A7.',
      archived_at:
        'Epoch ms. Domain lifecycle, not deletion: archived projects take no new entries but stay in history and reports.',
    },
    indexes: {
      project_organization_id_name_unique: 'A deleted project frees its name.',
      project_id_organization_id_unique:
        'Target of composite foreign keys, so rows pointing at a project cannot name another organization.',
    },
  },
  project_team: {
    note: 'Assigns a project to a team. A project with no rows here is available to everyone in the organization. Rows are inserted and deleted, never updated, so only created_* audit columns.',
    columns: {
      team_id: 'Deleting a team (Better Auth deletes rows) drops its assignments.',
      organization_id:
        'Tenant key. The composite foreign keys to project and team make it equal the organization of both.',
    },
  },
  time_entry: {
    note: 'A span of tracked time. A row with stopped_at null is the running timer; elapsed time is computed on the client and never written periodically.',
    columns: {
      id: 'UUIDv7, generated on the client so optimistic updates keep a stable key.',
      user_id:
        'Whose time this is. May differ from created_by when an admin adds an entry for someone.',
      project_id: 'Optional. Keeps the entry in the organization of its project.',
      description: 'What was worked on.',
      started_at: 'Epoch ms, UTC.',
      stopped_at: 'Epoch ms, UTC. CHECK stopped_at > started_at. Null while running.',
    },
    indexes: {
      time_entry_one_running: 'At most one running timer per user across all organizations.',
      time_entry_organization_id_user_id_started_at_idx: 'Own entry list and per-member reports.',
      time_entry_organization_id_started_at_idx: 'Organization-wide reports by time range.',
    },
  },
}
