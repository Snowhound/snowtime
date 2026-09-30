// The app's server functions on a copy of the benchmark database, with every statement they
// run recorded: its SQL, its arguments, and the rows it returned.

import type { InStatement } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '~/db'
import { relations } from '~/db/relations'
import { CACHE, COMPANY, SEED_NOW, USERS } from '../lib/database'

interface Statement {
  sql: string
  args: unknown[]
  rows: number
}

type Scope = Awaited<ReturnType<typeof import('~/server/scope.server').resolveScope>>

export interface Recorder {
  db: Database
  scopes: Record<keyof typeof USERS, Scope>
  userIds: Record<keyof typeof USERS, string>
  now: Date
  // Runs `call` and returns its result with the statements it ran.
  record: <T>(call: () => Promise<T>) => Promise<{ result: T; statements: Statement[] }>
  explain: (statement: Statement) => Promise<string[]>
  close: () => void
}

function statementOf(stmt: InStatement): { sql: string; args: unknown[] } {
  if (typeof stmt === 'string') return { sql: stmt, args: [] }
  return { sql: stmt.sql, args: Array.isArray(stmt.args) ? stmt.args : [] }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export async function openRecorder(database: string): Promise<Recorder> {
  // src/env.ts validates these when ~/db or a server module first loads.
  const copy = join(CACHE, 'check.db')
  copyFileSync(database, copy)
  process.env.TURSO_DATABASE_URL = `file:${copy}`
  process.env.BETTER_AUTH_SECRET ??= 'perf-harness-secret-perf-harness-secret'
  process.env.BETTER_AUTH_URL ??= 'http://127.0.0.1:1'

  const db = drizzle({ connection: { url: `file:${copy}` }, relations })
  const client = db.$client
  function execute(stmt: InStatement) {
    return client.execute(stmt)
  }
  let log: Statement[] | null = null
  const patched = client.execute.bind(client)
  client.execute = async (stmt: InStatement) => {
    const result = await patched(stmt)
    log?.push({ ...statementOf(stmt), rows: result.rows.length })
    return result
  }

  const { resolveScope } = await import('~/server/scope.server')
  const scopes = {} as Recorder['scopes']
  const userIds = {} as Recorder['userIds']
  for (const who of Object.keys(USERS) as (keyof typeof USERS)[]) {
    const found = await execute({
      sql: 'select id from user where email = ?',
      args: [USERS[who].email],
    })
    userIds[who] = text(found.rows[0].id)
    scopes[who] = await resolveScope(db, userIds[who], COMPANY.id)
  }

  return {
    db,
    scopes,
    userIds,
    now: SEED_NOW,
    async record(call) {
      log = []
      try {
        const result = await call()
        return { result, statements: log }
      } finally {
        log = null
      }
    },
    async explain(statement) {
      const plan = await execute({
        sql: `explain query plan ${statement.sql}`,
        args: statement.args as never,
      })
      return plan.rows.map((row) => text(row.detail))
    },
    close: () => client.close(),
  }
}
