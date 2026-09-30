/// <reference types="bun" />

// Throwaway databases for tests: a fresh file with every migration applied.
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from '.'
import { openClient } from './connection'
import { relations } from './relations'

export async function createTestDatabase(): Promise<{
  db: Database
  url: string
  cleanup: () => Promise<void>
}> {
  const dir = mkdtempSync(join(tmpdir(), 'snowtime-test-'))
  const url = `file:${join(dir, 'test.db')}`
  const db = drizzle({ client: openClient({ url }), relations })
  await migrate(db, { migrationsFolder: 'drizzle' })
  return { db, url, cleanup: () => removeDatabase(db, dir) }
}

// Windows won't delete an open file, and closing the client doesn't close it: the libsql
// binding can't finalize a statement, so the file stays open until garbage collection
// frees the connection's statements, which it does only after the event loop has turned.
async function removeDatabase(db: Database, dir: string) {
  db.$client.close()
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 10) throw error
      await Bun.sleep(attempt * 10)
      Bun.gc(true)
    }
  }
}
