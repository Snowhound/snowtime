// Seeds the local database with demo data (src/db/seed.ts). Local only: refuses any URL
// that is not a file, so it can never write to a Turso database.
//
// Usage: bun run db:seed (after bun run db:migrate, on an unseeded database)

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { SYSTEM_USER_ID } from '../src/db/actor'
import { relations } from '../src/db/relations'
import { user } from '../src/db/schema'
import { SEED_PASSWORD, seed } from '../src/db/seed'

const url = process.env.TURSO_DATABASE_URL
if (!url?.startsWith('file:')) {
  console.error(
    `[db-seed] Refusing to seed ${url ?? '(no TURSO_DATABASE_URL)'}: local file databases only.`,
  )
  process.exit(1)
}

const db = drizzle({ connection: { url }, relations })

const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.id, SYSTEM_USER_ID))
if (existing) {
  console.error(
    `[db-seed] ${url} is already seeded. To start over: rm local.db && bun run db:migrate && bun run db:seed`,
  )
  process.exit(1)
}

await seed(db)
console.log(
  `[db-seed] Seeded ${url}. Sign in as owner@example.com (or admin@, lead@, member@) with password "${SEED_PASSWORD}".`,
)
