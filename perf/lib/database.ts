// The benchmark database: the demo seed plus the company seed (a year of Lumen Works
// entries), made once per version of the seed and the schema and reused after that.
// Everything is seeded against a fixed SEED_NOW, so row counts, pages, and query plans
// don't change from one day to the next; clock.ts moves the server's and browser's clocks
// to match. The seed's running timers are stopped at SEED_NOW.

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { relations } from '~/db/relations'
import { SEED_PASSWORD, seed } from '~/db/seed'
import { companyIds, seedCompany } from '~/db/seed-company'

export const ROOT = join(import.meta.dir, '../..')
export const CACHE = join(ROOT, 'perf/.cache')

// A Wednesday morning in Tallinn, where the owner and most members work.
export const SEED_NOW = new Date('2026-09-30T07:30:00Z')

export const COMPANY = { id: companyIds.org, slug: 'lumen' }

// The owner sees every entry; Liis is a plain member of Design and sees only their own.
export const USERS = {
  admin: { email: 'kristiina@lumen.example.com', password: SEED_PASSWORD },
  member: { email: 'liis@lumen.example.com', password: SEED_PASSWORD },
} as const

// What the seeded data depends on. A change to any of these makes a new file.
const INPUTS = [
  'src/db/seed.ts',
  'src/db/seed-company.ts',
  'src/db/schema.ts',
  'perf/lib/database.ts',
  'drizzle',
]

function files(path: string): string[] {
  const full = join(ROOT, path)
  if (!statSync(full).isDirectory()) return [path]
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)))
    .sort()
}

// With extra, the hash also covers those files, for data built on top of the seed.
export function inputsHash(extra: string[] = []) {
  const hash = createHash('sha256')
  for (const file of [...INPUTS, ...extra].flatMap(files)) {
    hash.update(file).update(readFileSync(join(ROOT, file)))
  }
  return hash.digest('hex').slice(0, 12)
}

// Returns the path of the seeded file, seeding it first when this version has none. Older
// versions are removed. Takes a few seconds.
export async function seededDatabase(): Promise<string> {
  mkdirSync(CACHE, { recursive: true })
  const name = `company-${inputsHash()}.db`
  const path = join(CACHE, name)
  if (existsSync(path)) return path

  for (const old of readdirSync(CACHE)) {
    if (old.startsWith('company-')) rmSync(join(CACHE, old), { force: true })
  }
  const started = performance.now()
  console.log(`[perf] Seeding ${relative(ROOT, path)} ...`)
  // Seeded under another name and renamed, so an interrupted run leaves nothing to reuse.
  const partial = `${path}.partial`
  rmSync(partial, { force: true })
  const db = drizzle({ connection: { url: `file:${partial}` }, relations })
  await migrate(db, { migrationsFolder: join(ROOT, 'drizzle') })
  await seed(db, { now: SEED_NOW })
  await seedCompany(db, { now: SEED_NOW })
  // A running timer's elapsed time grows with the clock and changes report totals, and so
  // the bytes, on every request.
  await db.run(
    sql`update time_entry set stopped_at = ${SEED_NOW.getTime()} where stopped_at is null`,
  )
  db.$client.close()
  renameSync(partial, path)
  console.log(`[perf] Seeded in ${Math.round((performance.now() - started) / 1000)} s`)
  return path
}
