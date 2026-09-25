// Helpers for tests of server logic: a migrated, seeded throwaway database and the scope
// of a seeded user, the way scopeMiddleware would resolve it.
import type { InStatement } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { Database } from '~/db'
import { withActor } from '~/db/actor'
import { relations } from '~/db/relations'
import { seed } from '~/db/seed'
import { createTestDatabase } from '~/db/testing'
import { resolveScope, type Scope } from './scope.server'

export async function createSeededDatabase(now = new Date()) {
  const test = await createTestDatabase()
  await seed(test.db, { now })
  return test
}

export async function scopeOf(db: Database, userId: string, organizationId: string) {
  return resolveScope(db, userId, organizationId)
}

// Runs fn as the scope's user, as the middleware does for a request.
export function as<T>(scope: Pick<Scope, 'userId'>, fn: () => Promise<T>): Promise<T> {
  return withActor(scope.userId, fn)
}

// The database as one request sees it while another request runs `between` just before
// its first statement matching `statement`: the gap a check-then-write race needs.
export function interleaved(
  db: Database,
  statement: RegExp,
  between: () => Promise<unknown>,
): Database {
  const client = db.$client
  let waited = false
  const paused = new Proxy(client, {
    get(target, key) {
      if (key === 'execute') {
        return async (stmt: InStatement) => {
          const text = typeof stmt === 'string' ? stmt : stmt.sql
          if (!waited && statement.test(text)) {
            waited = true
            await between()
          }
          return target.execute(stmt)
        }
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return drizzle({ client: paused, relations })
}
