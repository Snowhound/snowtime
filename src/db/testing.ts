// Throwaway databases for tests: a fresh file with every migration applied.
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from '.'
import { BUSY_TIMEOUT_MS } from './connection'
import { relations } from './relations'

export async function createTestDatabase(): Promise<{
  db: Database
  url: string
  cleanup: () => void
}> {
  const dir = mkdtempSync(join(tmpdir(), 'snowtime-test-'))
  const url = `file:${join(dir, 'test.db')}`
  const db = drizzle({ connection: { url, timeout: BUSY_TIMEOUT_MS }, relations })
  await migrate(db, { migrationsFolder: 'drizzle' })
  return { db, url, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
