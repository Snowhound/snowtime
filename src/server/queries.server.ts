// Shared query helpers. The rules build their queries on the soft-delete filters
// instead of repeating sys_deleted = 0 (docs/architecture/README.md, "Application rules").
import { and, eq, type SQL, sql } from 'drizzle-orm'
import { project, timeEntry } from '~/db/schema'
import type { Scope } from './scope.server'

type SoftDeleted = typeof project | typeof timeEntry

// A literal 0, not a bound parameter: SQLite uses a partial index (WHERE sys_deleted = 0)
// only when it can prove the query matches it, and a parameter could be anything.
export function notDeleted(table: SoftDeleted): SQL {
  return sql`${table.sysDeleted} = 0`
}

// Rows of the scope's organization that are not deleted. Use it as the base of every
// query on a soft-deleted table.
export function live(table: SoftDeleted, scope: Pick<Scope, 'organizationId'>): SQL {
  return and(eq(table.organizationId, scope.organizationId), notDeleted(table))!
}

// The failed constraint of a SQLite constraint violation, e.g. "time_entry.user_id" for a
// unique index, or null for any other error. Drizzle wraps the libSQL error as its cause.
export function failedConstraint(error: unknown): string | null {
  for (let e = error; e instanceof Error; e = e.cause) {
    const match = /constraint failed: (.+)$/.exec(e.message)
    if (match) return match[1]
  }
  return null
}

// Awaits independent statements together, so they cost one round trip to Turso, and throws
// the error of the first to fail in list order, so the error doesn't depend on timing.
export async function allInOrder<T extends readonly unknown[]>(
  statements: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results = await Promise.allSettled(statements)
  return results.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  }) as { -readonly [K in keyof T]: Awaited<T[K]> }
}
