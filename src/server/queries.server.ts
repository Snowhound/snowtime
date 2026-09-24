// Shared filters for soft-deleted tables. Server functions build their queries from these
// instead of repeating sys_deleted = 0 (docs/architecture.md, "Application rules").
import { and, eq, type SQL } from 'drizzle-orm'
import { project, timeEntry } from '../db/schema'
import type { Scope } from './scope.server'

type SoftDeleted = typeof project | typeof timeEntry

export function notDeleted(table: SoftDeleted): SQL {
  return eq(table.sysDeleted, false)
}

// Rows of the scope's organization that are not deleted. Use it as the base of every
// query on a soft-deleted table.
export function live(table: SoftDeleted, scope: Pick<Scope, 'organizationId'>): SQL {
  return and(eq(table.organizationId, scope.organizationId), notDeleted(table))!
}

// The same filter for relational queries: db.query.project.findMany({ where: liveWhere(scope) }).
export function liveWhere(scope: Pick<Scope, 'organizationId'>) {
  return { organizationId: scope.organizationId, sysDeleted: false } as const
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
