import type { Client, InValue } from '@libsql/client'
import { Database } from 'bun:sqlite'
import { chmodSync, existsSync, linkSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyMigrations } from './db-verify'

export type ImportCleanup = {
  clearSessions: boolean
  clearPasskeys: boolean
  clearProviderTokens: boolean
}

type SchemaObject = { type: string; name: string; sql: string }

const COMPANY_SCOPE = `WITH company_users(id) AS (
  SELECT user_id FROM member WHERE organization_id = :organizationId
  UNION SELECT user_id FROM time_entry WHERE organization_id = :organizationId
  UNION SELECT created_by FROM time_entry WHERE organization_id = :organizationId
  UNION SELECT updated_by FROM time_entry WHERE organization_id = :organizationId
  UNION SELECT created_by FROM project WHERE organization_id = :organizationId
  UNION SELECT updated_by FROM project WHERE organization_id = :organizationId
  UNION SELECT inviter_id FROM invitation WHERE organization_id = :organizationId
  UNION SELECT created_by FROM project_team WHERE organization_id = :organizationId
  UNION SELECT user_id FROM team_member WHERE team_id IN (SELECT id FROM team WHERE organization_id = :organizationId)
), selected_users(id) AS (
  SELECT id FROM company_users
  UNION SELECT created_by FROM user_settings WHERE user_id IN (SELECT id FROM company_users)
  UNION SELECT updated_by FROM user_settings WHERE user_id IN (SELECT id FROM company_users)
)`

const companyPredicates: Record<string, string> = {
  organization: 'id = :organizationId',
  team: 'organization_id = :organizationId',
  member: 'organization_id = :organizationId',
  invitation: 'organization_id = :organizationId',
  project: 'organization_id = :organizationId',
  project_team: 'organization_id = :organizationId',
  time_entry: 'organization_id = :organizationId',
  team_member: 'team_id IN (SELECT id FROM team WHERE organization_id = :organizationId)',
  user: 'id IN (SELECT id FROM selected_users)',
  user_settings: 'user_id IN (SELECT id FROM company_users)',
  account: 'user_id IN (SELECT id FROM company_users)',
  passkey: 'user_id IN (SELECT id FROM company_users)',
  session: `user_id IN (SELECT id FROM company_users)
    AND (active_organization_id IS NULL OR active_organization_id = :organizationId)
    AND (active_team_id IS NULL OR active_team_id IN (SELECT id FROM team WHERE organization_id = :organizationId))`,
  verification: '0',
  __drizzle_migrations: '1',
}

const providerTokenColumns = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'access_token_expires_at',
  'refresh_token_expires_at',
])

const PAGE_SIZE = 500
// The page cursor's column; no Snowtime table has a column by this name.
const ROWID = '__import_rowid'

function identifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

export function localDatabasePath(url: string): string {
  if (!url.startsWith('file:') || url === 'file::memory:') {
    throw new Error('The destination must be a local file: database.')
  }
  return url.startsWith('file://')
    ? fileURLToPath(url)
    : resolve(decodeURIComponent(url.slice('file:'.length)))
}

function binding(value: InValue): string | number | bigint | Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'boolean') return Number(value)
  return value
}

export async function importDatabase(
  source: Client,
  destination: string,
  cleanup: ImportCleanup,
  migrationsFolder = 'drizzle',
  organizationId?: string,
): Promise<Record<string, number>> {
  const path = resolve(destination)
  if ([path, `${path}-wal`, `${path}-shm`, `${path}-journal`].some(existsSync)) {
    throw new Error('The destination or its SQLite sidecar already exists. Use a fresh volume.')
  }
  mkdirSync(dirname(path), { recursive: true })
  const staging = `${path}.import-${crypto.randomUUID()}`
  const target = new Database(staging, { create: true, strict: true, safeIntegers: true })
  chmodSync(staging, 0o600)
  let published = false
  try {
    const snapshot = await source.transaction('read')
    try {
      if (!(await verifyMigrations(snapshot, migrationsFolder))) {
        throw new Error('Use a release containing the source database migrations.')
      }
      if (organizationId) {
        const selected = await snapshot.execute({
          sql: 'SELECT id FROM organization WHERE id = ?',
          args: [organizationId],
        })
        if (selected.rows.length !== 1) throw new Error('The selected company no longer exists.')
      }
      const schema = await snapshot.execute(
        "SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
      )
      const objects = schema.rows.map((row): SchemaObject => {
        if (
          typeof row.type !== 'string' ||
          typeof row.name !== 'string' ||
          typeof row.sql !== 'string'
        ) {
          throw new Error('Invalid source schema.')
        }
        return { type: row.type, name: row.name, sql: row.sql }
      })
      const tables = objects.filter((object) => object.type === 'table')
      for (const required of [
        'user',
        'account',
        'session',
        'passkey',
        'time_entry',
        '__drizzle_migrations',
      ]) {
        if (!tables.some((table) => table.name === required)) {
          throw new Error(`Source is missing the Snowtime table ${required}.`)
        }
      }
      if (tables.some((table) => /^CREATE\s+VIRTUAL\s+TABLE/i.test(table.sql))) {
        throw new Error('Virtual tables are not supported by this importer.')
      }
      // Rows are read in rowid order, page by page.
      if (tables.some((table) => /\bWITHOUT\s+ROWID\s*$/i.test(table.sql))) {
        throw new Error('WITHOUT ROWID tables are not supported by this importer.')
      }
      if (organizationId && tables.some((table) => !Object.hasOwn(companyPredicates, table.name))) {
        throw new Error(
          'Company filtering needs updating for the source schema. No data was imported.',
        )
      }
      target.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE')
      const counts: Record<string, number> = {}
      for (const table of tables) {
        target.exec(table.sql)
        if (
          (cleanup.clearSessions && ['session', 'verification'].includes(table.name)) ||
          (cleanup.clearPasskeys && table.name === 'passkey') ||
          (organizationId && table.name === 'verification')
        ) {
          counts[table.name] = 0
          continue
        }
        const columns = await snapshot.execute(`PRAGMA table_xinfo(${identifier(table.name)})`)
        const writable = columns.rows.filter((column) => Number(column.hidden) === 0)
        const names = writable.map((column) => {
          if (typeof column.name !== 'string') throw new Error('Invalid source column.')
          return column.name
        })
        const fields = names.map(identifier).join(', ')
        const selectedFields = names
          .map((name) =>
            table.name === 'account' &&
            cleanup.clearProviderTokens &&
            providerTokenColumns.has(name)
              ? `NULL AS ${identifier(name)}`
              : identifier(name),
          )
          .join(', ')
        const insert = target.prepare(
          `INSERT INTO ${identifier(table.name)} (${fields}) VALUES (${names.map(() => '?').join(', ')})`,
        )
        // Each page starts after the last rowid read, so it reads only its own rows.
        const sql = `${organizationId ? COMPANY_SCOPE : ''}
          SELECT rowid AS ${identifier(ROWID)}, ${selectedFields} FROM ${identifier(table.name)}
          WHERE rowid > :after ${organizationId ? `AND (${companyPredicates[table.name]})` : ''}
          ORDER BY rowid LIMIT :pageSize`
        let after: InValue = -1
        let count = 0
        for (;;) {
          const page = await snapshot.execute({
            sql,
            args: { ...(organizationId ? { organizationId } : {}), pageSize: PAGE_SIZE, after },
          })
          for (const row of page.rows) insert.run(...names.map((name) => binding(row[name])))
          count += page.rows.length
          if (page.rows.length < PAGE_SIZE) break
          after = page.rows[page.rows.length - 1][ROWID]
        }
        insert.finalize()
        counts[table.name] = count
      }
      const sequence = await snapshot.execute(
        "SELECT 1 FROM sqlite_schema WHERE name = 'sqlite_sequence'",
      )
      if (sequence.rows.length > 0) {
        const rows = await snapshot.execute('SELECT name, seq FROM sqlite_sequence')
        target.exec('DELETE FROM sqlite_sequence')
        const insert = target.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)')
        for (const row of rows.rows) insert.run(binding(row.name), binding(row.seq))
        insert.finalize()
      }
      // Triggers are installed after copying, so imported audit fields stay unchanged.
      for (const object of objects.filter((object) => object.type !== 'table')) {
        target.exec(object.sql)
      }
      if (target.query('PRAGMA foreign_key_check').all().length > 0) {
        throw new Error('Imported data failed the foreign-key check.')
      }
      const integrity = target.query('PRAGMA integrity_check').values()
      if (integrity.length !== 1 || integrity[0][0] !== 'ok') {
        throw new Error('Imported data failed the integrity check.')
      }
      target.exec('COMMIT; PRAGMA foreign_keys = ON')
      await snapshot.commit()
      target.close()
      // Creating a hard link publishes the completed file atomically and refuses an existing target.
      linkSync(staging, path)
      published = true
      return counts
    } finally {
      snapshot.close()
    }
  } finally {
    target.close()
    if (existsSync(staging)) unlinkSync(staging)
    if (!published) {
      for (const suffix of ['-journal', '-wal', '-shm']) {
        if (existsSync(staging + suffix)) unlinkSync(staging + suffix)
      }
    }
  }
}

export async function chooseImportCleanup(
  question: (prompt: string) => Promise<string>,
): Promise<ImportCleanup | null> {
  async function yesNo(prompt: string, fallback: boolean) {
    for (;;) {
      const answer = (await question(`${prompt} ${fallback ? '[Y/n]' : '[y/N]'} `))
        .trim()
        .toLowerCase()
      if (!answer) return fallback
      if (answer === 'yes' || answer === 'y') return true
      if (answer === 'no' || answer === 'n') return false
    }
  }
  if (
    !(await yesNo('Have you stopped the destination app and every other database writer?', false))
  ) {
    return null
  }
  let different: boolean
  for (;;) {
    const answer = (
      await question('Will the destination use the same or a different hostname? [same/different] ')
    )
      .trim()
      .toLowerCase()
    if (answer === 'same' || answer === 'different') {
      different = answer === 'different'
      break
    }
  }
  return {
    clearSessions: await yesNo(
      'Clear sessions and pending verification challenges? Recommended for a move.',
      true,
    ),
    clearPasskeys: await yesNo(
      different
        ? 'Clear passkeys? Existing passkeys cannot authenticate on the new hostname.'
        : 'Clear passkeys? They can work on the same hostname.',
      different,
    ),
    clearProviderTokens: await yesNo(
      'Clear stored OAuth tokens while keeping account links?',
      true,
    ),
  }
}
