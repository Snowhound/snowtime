// Fails if an applied migration was edited or deleted since it ran. drizzle-kit records a
// SHA-256 of each migration.sql in __drizzle_migrations but never re-checks it, so without
// this an edited migration is silently skipped on databases that already ran it.
//
// Usage: bun scripts/db-verify.ts   (target database from TURSO_DATABASE_URL)

import { createClient } from '@libsql/client'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

const url = process.env.TURSO_DATABASE_URL
if (!url) throw new Error('TURSO_DATABASE_URL is not set.')

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })

const table = await client.execute(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
)
if (table.rows.length === 0) {
  console.log('[db-verify] No migrations applied yet.')
  process.exit(0)
}

const applied = await client.execute('SELECT name, hash FROM __drizzle_migrations ORDER BY id')
const problems: string[] = []

for (const row of applied.rows) {
  const name = String(row.name)
  const file = `drizzle/${name}/migration.sql`
  if (!existsSync(file)) {
    problems.push(`${name}: applied, but ${file} no longer exists`)
    continue
  }
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (hash !== row.hash) {
    problems.push(`${name}: edited after it was applied`)
  }
}

if (problems.length) {
  console.error(
    '[db-verify] Applied migrations changed. Revert them and add a new migration instead:',
  )
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`[db-verify] ${applied.rows.length} applied migrations unchanged.`)
