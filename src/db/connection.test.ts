/// <reference types="bun" />

import { createClient } from '@libsql/client'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import type { Database } from '.'
import { createTestDatabase } from './testing'

let db: Database
let url: string
let cleanup: () => Promise<void>

beforeAll(async () => {
  ;({ db, url, cleanup } = await createTestDatabase())
  await db.run(sql`CREATE TABLE busy_probe (v TEXT)`)
})

afterAll(() => cleanup())

// Stands in for db:seed or the sqlite3 shell: holds a write lock on the file, then commits.
const HOLD_LOCK = `
  import { createClient } from '@libsql/client'
  const tx = await createClient({ url: process.env.DB_URL }).transaction('write')
  await tx.execute("INSERT INTO busy_probe VALUES ('other process')")
  console.log('locked')
  await Bun.sleep(300)
  await tx.commit()
`

test('a write waits for another process to release its lock, and both writes land', async () => {
  const holder = Bun.spawn(['bun', '-e', HOLD_LOCK], {
    env: { ...process.env, DB_URL: url },
    stdout: 'pipe',
  })
  await holder.stdout.getReader().read()

  await db.run(sql`INSERT INTO busy_probe VALUES ('this process')`)
  await db.run(sql`INSERT INTO busy_probe VALUES ('after the wait')`)
  expect(await holder.exited).toBe(0)

  // A fresh client reads the file, so it sees only what was committed there.
  const fresh = createClient({ url })
  const { rows } = await fresh.execute('SELECT v FROM busy_probe')
  fresh.close()
  expect(rows.map((row) => row.v)).toEqual(['other process', 'this process', 'after the wait'])
})

// Two requests in one process: a transaction holds the write lock on its own connection
// while another request writes (task 043).
test('a write waits for an open transaction in this process, and later writes land', async () => {
  await db.run(sql`CREATE TABLE busy_request (v TEXT)`)
  let finish!: () => void
  const held = new Promise<void>((resolve) => (finish = resolve))
  const transaction = db.transaction(async (tx) => {
    await tx.run(sql`INSERT INTO busy_request VALUES ('in transaction')`)
    await held
  })
  await Bun.sleep(10)
  // A Drizzle query runs only once awaited, so start it here, while the transaction is open.
  const beside = Promise.resolve(db.run(sql`INSERT INTO busy_request VALUES ('beside it')`))
  await Bun.sleep(10)
  finish()
  await Promise.all([transaction, beside])
  await db.run(sql`INSERT INTO busy_request VALUES ('after it')`)

  const fresh = createClient({ url })
  const { rows } = await fresh.execute('SELECT v FROM busy_request')
  fresh.close()
  expect(rows.map((row) => row.v)).toEqual(['in transaction', 'beside it', 'after it'])
}, 15_000)
