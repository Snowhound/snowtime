// Drizzle mapping of the database schema. Hand-maintained to match the SQL migrations in
// drizzle/; `bun run db:drift` reports any difference. See docs/migrations.md.
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { LOCALES, THEMES, TIMER_LAYOUTS } from '~/schemas/settings'
import { currentActor } from './actor'

const nowMs = sql`(CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER))`

function timestamp(name: string) {
  return integer(name, { mode: 'timestamp_ms' })
}

// Audit columns, in the order docs/migrations.md prescribes. updated_at is set here on
// every update; the table's trigger only covers statements that bypass Drizzle.
function createdAudit() {
  return {
    createdAt: timestamp('created_at').default(nowMs).notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id)
      .$defaultFn(currentActor),
  }
}

function updatedAudit() {
  return {
    updatedAt: timestamp('updated_at')
      .default(nowMs)
      .notNull()
      .$onUpdateFn(() => new Date()),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id)
      .$defaultFn(currentActor)
      .$onUpdateFn(currentActor),
  }
}

function sysDeleted() {
  return {
    sysDeleted: integer('sys_deleted', { mode: 'boolean' })
      .default(sql`0`)
      .notNull(),
  }
}

// Auth (Better Auth core) -------------------------------------------------------------------

export const user = sqliteTable(
  'user',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' })
      .default(sql`0`)
      .notNull(),
    image: text(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('user_email_unique').on(t.email),
    check('user_email_verified', sql`email_verified IN (0, 1)`),
  ],
)

export const organization = sqliteTable(
  'organization',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    slug: text().notNull(),
    logo: text(),
    metadata: text(),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [uniqueIndex('organization_slug_unique').on(t.slug)],
)

export const team = sqliteTable(
  'team',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    memberCount: integer('member_count').default(0).notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    uniqueIndex('team_organization_id_name_unique').on(t.organizationId, t.name),
    uniqueIndex('team_id_organization_id_unique').on(t.id, t.organizationId),
  ],
)

export const session = sqliteTable(
  'session',
  {
    id: text().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    activeOrganizationId: text('active_organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    activeTeamId: text('active_team_id').references(() => team.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('session_token_unique').on(t.token),
    index('session_user_id_idx').on(t.userId),
  ],
)

export const account = sqliteTable(
  'account',
  {
    id: text().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text(),
    password: text(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
)

// @better-auth/passkey's table (task 015). The key credentialID matches the plugin's
// field name, which the Drizzle adapter looks up.
export const passkey = sqliteTable(
  'passkey',
  {
    id: text().primaryKey(),
    name: text(),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer().notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
    transports: text(),
    createdAt: timestamp('created_at'),
    aaguid: text(),
  },
  (t) => [
    index('passkey_user_id_idx').on(t.userId),
    uniqueIndex('passkey_credential_id_unique').on(t.credentialID),
    check('passkey_backed_up', sql`backed_up IN (0, 1)`),
  ],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

// Tenancy (Better Auth organization plugin, teams enabled) -----------------------------------

export const member = sqliteTable(
  'member',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text().default('member').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('member_organization_id_user_id_unique').on(t.organizationId, t.userId),
    index('member_user_id_idx').on(t.userId),
  ],
)

export const teamMember = sqliteTable(
  'team_member',
  {
    id: text().primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // App-managed; Better Auth never reads or writes it.
    role: text({ enum: ['lead', 'member'] })
      .default('member')
      .notNull(),
    membershipKey: text('membership_key'),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    uniqueIndex('team_member_team_id_user_id_unique').on(t.teamId, t.userId),
    uniqueIndex('team_member_membership_key_unique').on(t.membershipKey),
    index('team_member_user_id_idx').on(t.userId),
    check('team_member_role', sql`role IN ('lead', 'member')`),
  ],
)

export const invitation = sqliteTable(
  'invitation',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    role: text(),
    teamId: text('team_id').references(() => team.id, { onDelete: 'set null' }),
    status: text().default('pending').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('invitation_organization_id_email_idx').on(t.organizationId, t.email)],
)

// App -----------------------------------------------------------------------------------------

export const userSettings = sqliteTable(
  'user_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id),
    timeZone: text('time_zone').notNull(),
    weekStart: text('week_start', { enum: ['mon', 'sun'] })
      .default('mon')
      .notNull(),
    ...createdAudit(),
    ...updatedAudit(),
    // Added by a later migration, so they follow the audit columns. Text values are
    // validated in the app (src/schemas/settings.ts).
    locale: text({ enum: LOCALES }).default('en').notNull(),
    theme: text({ enum: THEMES }).default('system').notNull(),
    timerLayout: text('timer_layout', { enum: TIMER_LAYOUTS }).default('bar').notNull(),
    showSummary: integer('show_summary', { mode: 'boolean' })
      .default(sql`1`)
      .notNull(),
  },
  () => [
    check('user_settings_week_start', sql`week_start IN ('mon', 'sun')`),
    check('user_settings_show_summary', sql`show_summary IN (0, 1)`),
  ],
)

export const project = sqliteTable(
  'project',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    name: text().notNull(),
    color: text(),
    archivedAt: timestamp('archived_at'),
    ...createdAudit(),
    ...updatedAudit(),
    ...sysDeleted(),
  },
  (t) => [
    uniqueIndex('project_organization_id_name_unique')
      .on(t.organizationId, t.name)
      .where(sql`sys_deleted = 0`),
    uniqueIndex('project_id_organization_id_unique').on(t.id, t.organizationId),
    check('project_sys_deleted', sql`sys_deleted IN (0, 1)`),
  ],
)

export const projectTeam = sqliteTable(
  'project_team',
  {
    projectId: text('project_id').notNull(),
    teamId: text('team_id').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    ...createdAudit(),
  },
  (t) => [
    primaryKey({ name: 'project_team_pk', columns: [t.projectId, t.teamId] }),
    foreignKey({
      name: 'project_team_project_fk',
      columns: [t.projectId, t.organizationId],
      foreignColumns: [project.id, project.organizationId],
    }),
    foreignKey({
      name: 'project_team_team_fk',
      columns: [t.teamId, t.organizationId],
      foreignColumns: [team.id, team.organizationId],
    }).onDelete('cascade'),
    index('project_team_organization_id_team_id_idx').on(t.organizationId, t.teamId),
  ],
)

export const timeEntry = sqliteTable(
  'time_entry',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    projectId: text('project_id'),
    description: text().default('').notNull(),
    startedAt: timestamp('started_at').notNull(),
    stoppedAt: timestamp('stopped_at'),
    ...createdAudit(),
    ...updatedAudit(),
    ...sysDeleted(),
  },
  (t) => [
    foreignKey({
      name: 'time_entry_project_fk',
      columns: [t.projectId, t.organizationId],
      foreignColumns: [project.id, project.organizationId],
    }),
    check('time_entry_stopped_after_started', sql`stopped_at IS NULL OR stopped_at > started_at`),
    check('time_entry_sys_deleted', sql`sys_deleted IN (0, 1)`),
    uniqueIndex('time_entry_one_running')
      .on(t.userId)
      .where(sql`stopped_at IS NULL AND sys_deleted = 0`),
    index('time_entry_organization_id_user_id_started_at_idx').on(
      t.organizationId,
      t.userId,
      t.startedAt,
    ),
    index('time_entry_organization_id_started_at_idx').on(t.organizationId, t.startedAt),
    index('time_entry_project_id_idx').on(t.projectId),
  ],
)
