// Throwaway databases for tests: a fresh file with every migration applied.
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from '.'
import { relations } from './relations'

export async function createTestDatabase(): Promise<{ db: Database; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'snowtime-test-'))
  const db = drizzle({ connection: { url: `file:${join(dir, 'test.db')}` }, relations })
  await migrate(db, { migrationsFolder: 'drizzle' })
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
