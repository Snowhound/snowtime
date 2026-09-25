// The running timer: a time entry with stopped_at NULL. At most one per user across all
// organizations; the partial unique index time_entry_one_running backs this up. The
// functions here see only entries in organizations the user still belongs to; removing a
// member stops their timer there (stopTimerOfRemovedMember).
import { and, eq, isNull, not, sql } from 'drizzle-orm'
import type { Database, Executor } from '~/db'
import { member, timeEntry } from '~/db/schema'
import { MAX_ENTRY_MS } from '../entries/entries.schemas'
import { assertEntryRoom } from '../entries/entries.server'
import { AppError } from '../errors'
import { assertUsableProject } from '../projects/projects.server'
import { failedConstraint, notDeleted } from '../queries.server'
import type { Scope } from '../scope.server'
import type { StartTimerInput, StopTimerInput } from './timer.schemas'

function runningOf(userId: string) {
  return and(eq(timeEntry.userId, userId), isNull(timeEntry.stoppedAt), notDeleted(timeEntry))
}

function isMemberOfEntryOrganization(userId: string) {
  return sql`exists (select 1 from ${member} where ${member.organizationId} = ${timeEntry.organizationId} and ${member.userId} = ${userId})`
}

// stopped_at must be after started_at; a timer stopped within its first millisecond (or
// started ahead of this server's clock) ends one millisecond after it started. A timer left
// running past MAX_ENTRY_HOURS ends there.
function stopAt(now: Date) {
  return sql`min(max(${now.getTime()}, ${timeEntry.startedAt} + 1), ${timeEntry.startedAt} + ${MAX_ENTRY_MS})`
}

async function stopRunning(db: Executor, userId: string, now: Date, id?: string) {
  const where = and(
    runningOf(userId),
    isMemberOfEntryOrganization(userId),
    id ? eq(timeEntry.id, id) : undefined,
  )
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
      // The scope was resolved before this transaction. A member removed since would get a
      // timer the removal hook has already missed, running on in an organization they left.
      const [membership] = await tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(eq(member.organizationId, scope.organizationId), eq(member.userId, scope.userId)),
        )
      if (!membership) throw new AppError('FORBIDDEN', 'not_organization_member')
      if (input.projectId) await assertUsableProject(tx, scope, input.projectId)
      await assertEntryRoom(tx, scope.organizationId, scope.userId, now)
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
      const [left] = await db
        .select({ id: timeEntry.id })
        .from(timeEntry)
        .where(and(runningOf(scope.userId), not(isMemberOfEntryOrganization(scope.userId))))
      // A timer the removal hook failed to stop blocks every new one; say so.
      throw new AppError(
        'CONFLICT',
        left ? 'timer_running_in_left_organization' : 'timer_started_elsewhere',
      )
    }
    if (constraint === 'time_entry.id') {
      throw new AppError('CONFLICT', 'entry_id_taken')
    }
    if (constraint === 'time_entry_live_project') {
      throw new AppError('NOT_FOUND', 'project_not_found')
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
    where: {
      userId,
      stoppedAt: { isNull: true },
      RAW: notDeleted,
      organization: { members: { userId } },
    },
    with: { project: { columns: { id: true, name: true, color: true } } },
  })
  return entry ?? null
}

// Stops the timer a removed member left running in the organization, as of the removal.
// Called from Better Auth's after hook once the member row is gone, so it skips the
// membership check.
export async function stopTimerOfRemovedMember(
  db: Database,
  userId: string,
  organizationId: string,
) {
  const [stopped] = await db
    .update(timeEntry)
    .set({ stoppedAt: stopAt(new Date()) })
    .where(and(runningOf(userId), eq(timeEntry.organizationId, organizationId)))
    .returning()
  return stopped ?? null
}
