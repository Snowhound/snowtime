// Warns when src/db/schema.ts no longer matches what the migrations produce. Applies every
// migration to a throwaway database, then asks drizzle-kit what it would change to make that
// database match schema.ts. Anything other than "No changes detected" is drift.
//
// Warn-only by decision: exits 0 on drift, non-zero only if the migrations themselves fail.
// Known blind spot: partial-index WHERE clauses are invisible on both sides.
//
// Usage: bun scripts/db-drift.ts

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'snowtime-drift-'))
const env: NodeJS.ProcessEnv = {
  ...process.env,
  TURSO_DATABASE_URL: `file:${join(dir, 'drift.db')}`,
}
delete env.TURSO_AUTH_TOKEN

function drizzleKit(...args: string[]) {
  const result = spawnSync('bunx', ['--bun', 'drizzle-kit', ...args], { env, encoding: 'utf8' })
  return { ok: result.status === 0, output: result.stdout + result.stderr }
}

try {
  const migrate = drizzleKit('migrate')
  if (!migrate.ok) {
    console.error(migrate.output)
    console.error('[db-drift] Migrations failed on an empty database.')
    process.exit(1)
  }

  const explain = drizzleKit('push', '--explain')
  if (explain.ok && explain.output.includes('No changes detected')) {
    console.log('[db-drift] schema.ts matches the migrations.')
  } else {
    console.warn(explain.output)
    console.warn('[db-drift] WARNING: schema.ts differs from the migrations. The statements above')
    console.warn('[db-drift] are what would make the database match schema.ts; fix schema.ts, or')
    console.warn('[db-drift] add a migration if the database is what is missing something.')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
