// Helpers for tests of server logic: a migrated, seeded throwaway database and the scope
// of a seeded user, the way scopeMiddleware would resolve it.
import type { Database } from '~/db'
import { withActor } from '~/db/actor'
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
