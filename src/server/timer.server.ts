// The running timer: a time entry with stopped_at NULL. At most one per user across all
// organizations; the partial unique index time_entry_one_running backs this up.
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database, Executor } from '../db'
import { timeEntry } from '../db/schema'
import type { StartTimerInput, StopTimerInput } from '../schemas/timer'
import { AppError } from './errors'
import { assertUsableProject } from './projects.server'
import { failedConstraint, notDeleted } from './queries.server'
import type { Scope } from './scope.server'

function runningOf(userId: string) {
  return and(eq(timeEntry.userId, userId), isNull(timeEntry.stoppedAt), notDeleted(timeEntry))
}

// stopped_at must be after started_at; a timer stopped within its first millisecond (or
// started ahead of this server's clock) ends one millisecond after it started.
function stopAt(now: Date) {
  return sql`max(${now.getTime()}, ${timeEntry.startedAt} + 1)`
}

async function stopRunning(db: Executor, userId: string, now: Date, id?: string) {
  const where = id ? and(runningOf(userId), eq(timeEntry.id, id)) : runningOf(userId)
  const [stopped] = await db
    .update(timeEntry)
    .set({ stoppedAt: stopAt(now) })
    .where(where)
    .returning()
  return stopped ?? null
}

// Starts a timer in the scope's organization. A running timer, in any organization, is
// stopped first in the same transaction.
export async function startTimer(db: Database, scope: Scope, input: StartTimerInput) {
  const now = new Date()
  try {
    return await db.transaction(async (tx) => {
      if (input.projectId) await assertUsableProject(tx, scope, input.projectId)
      const stopped = await stopRunning(tx, scope.userId, now)
      const [started] = await tx
        .insert(timeEntry)
        .values({
          id: input.id,
          organizationId: scope.organizationId,
          userId: scope.userId,
          projectId: input.projectId ?? null,
          description: input.description,
          startedAt: now,
        })
        .returning()
      return { started, stopped }
    })
  } catch (error) {
    const constraint = failedConstraint(error)
    if (constraint === 'time_entry.user_id') {
      throw new AppError('CONFLICT', 'timer_started_elsewhere')
    }
    if (constraint === 'time_entry.id') {
      throw new AppError('CONFLICT', 'entry_id_taken')
    }
    throw error
  }
}

// Stops the user's running timer if it is the given entry. The entry may belong to any of
// the user's organizations.
export async function stopTimer(db: Database, userId: string, input: StopTimerInput) {
  const stopped = await stopRunning(db, userId, new Date(), input.id)
  if (!stopped) throw new AppError('NOT_FOUND', 'timer_not_running')
  return stopped
}

// The user's running timer in any organization, with its project, or null.
export async function getRunningTimer(db: Database, userId: string) {
  const entry = await db.query.timeEntry.findFirst({
    where: { userId, stoppedAt: { isNull: true }, sysDeleted: false },
    with: { project: { columns: { id: true, name: true, color: true } } },
  })
  return entry ?? null
}
