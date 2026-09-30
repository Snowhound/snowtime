// The migrator of a compiled release (scripts/build-self-hosted.ts), for a server without Bun:
// db:migrate's checks and migrations, from the drizzle/ folder beside the executable.
// drizzle-orm's migrator records migrations exactly as drizzle-kit migrate does, so either
// can run against the same database.
//
// Usage: TURSO_DATABASE_URL=file:/var/lib/snowtime/snowtime.db ./snowtime-migrate

import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { dirname, join } from 'node:path'
import { openClient } from '~/db/connection'
import { verifyMigrations } from './db-verify'

const url = process.env.TURSO_DATABASE_URL
if (!url) throw new Error('TURSO_DATABASE_URL is not set.')

const folder = join(dirname(process.execPath), 'drizzle')
const client = openClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
if (!(await verifyMigrations(client, folder))) process.exit(1)
await migrate(drizzle({ client }), { migrationsFolder: folder })
client.close()
console.log('[db-migrate] Migrations applied.')
