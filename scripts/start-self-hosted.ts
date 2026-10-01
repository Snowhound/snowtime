import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { join } from 'node:path'
import { openClient } from '~/db/connection'
import { env } from '~/env'
import { verifyMigrations } from './db-verify'

if (env.MIGRATE_ON_START) {
  if (!env.TURSO_DATABASE_URL.startsWith('file:')) {
    throw new Error('MIGRATE_ON_START requires a local file database.')
  }
  const folder = env.MIGRATIONS_DIR ?? join(process.cwd(), 'drizzle')
  const client = openClient({ url: env.TURSO_DATABASE_URL })
  try {
    if (!(await verifyMigrations(client, folder))) {
      throw new Error('Applied migrations changed; refusing to start.')
    }
    await migrate(drizzle({ client }), { migrationsFolder: folder })
    console.log('[startup] Migrations applied; starting the server.')
  } finally {
    client.close()
  }
}

// The listener is imported only after migrations succeed, so no request can write during them.
// oxlint-disable-next-line import/no-relative-parent-imports -- The generated build is outside src/ and has no source alias.
await import('../.output/server/index.mjs')
