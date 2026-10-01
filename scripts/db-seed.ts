// Seeds the local database with demo data (src/db/seed.ts), and with --company also a
// mid-sized company with a year of entries (src/db/seed-company.ts). Local only: refuses
// any URL that is not a file, so it can never write to a Turso database.
//
// Usage: bun run db:seed [--company] (after bun run db:migrate). --company on a database
// seeded without it adds the company.

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { SYSTEM_USER_ID } from '~/db/actor'
import { relations } from '~/db/relations'
import { organization, user } from '~/db/schema'
import { SEED_PASSWORD, seed } from '~/db/seed'
import { companyIds, companyUsers, seedCompany } from '~/db/seed-company'

const url = process.env.TURSO_DATABASE_URL
if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
  throw new Error('Production seeding requires DEMO_MODE=true.')
}
if (!url?.startsWith('file:')) {
  console.error(
    `[db-seed] Refusing to seed ${url ?? '(no TURSO_DATABASE_URL)'}: local file databases only.`,
  )
  process.exit(1)
}

const company = process.argv.includes('--company')
const db = drizzle({ connection: { url }, relations })

const [seeded] = await db.select({ id: user.id }).from(user).where(eq(user.id, SYSTEM_USER_ID))
const [companySeeded] = await db
  .select({ id: organization.id })
  .from(organization)
  .where(eq(organization.id, companyIds.org))
if (seeded && (!company || companySeeded)) {
  console.error(
    `[db-seed] ${url} is already seeded. To start over: rm local.db && bun run db:migrate && bun run db:seed`,
  )
  process.exit(1)
}

if (!seeded) await seed(db)
if (company) {
  const started = performance.now()
  await seedCompany(db)
  console.log(
    `[db-seed] Added Lumen Works in ${Math.round(performance.now() - started)} ms. Sign in as ${companyUsers[0].email} (owner) or another @lumen.example.com user.`,
  )
}
console.log(
  `[db-seed] Seeded ${url}. Sign in as owner@example.com (or admin@, lead@, member@) with password "${SEED_PASSWORD}".`,
)
