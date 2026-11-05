// Time entries in the scope's organization. Everyone writes their own entries; admins and
// owners also write other members' entries; team leads only read their teams' entries
// (docs/architecture/data.md, "Tenancy").
import { and, count, desc, eq, gt, inArray, isNull, lt, min, ne, or } from 'drizzle-orm'
import type { Database, Executor } from '~/db'
import { member, timeEntry } from '~/db/schema'
import { AppError } from '../errors'
import { limits } from '../limits.server'
import { assertUsableProject } from '../projects/projects.server'
import { allInOrder, failedConstraint, live, notDeleted } from '../queries.server'
import { isAdmin, readableUserIds, type Scope } from '../scope.server'
import { MAX_ENTRY_MS } from './entries.schemas'
import type {
  CreateEntriesInput,
  CreateEntryInput,
  DeleteEntriesInput,
  GetFirstEntryStartInput,
  DeleteEntryInput,
  ListEntriesInput,
  UpdateEntryInput,
} from './entries.schemas'

// The columns the contract returns for an entry (Entry in entries.schemas.ts).
export const entryColumns = {
  id: timeEntry.id,
  organizationId: timeEntry.organizationId,
  userId: timeEntry.userId,
  projectId: timeEntry.projectId,
  description: timeEntry.description,
  ticket: timeEntry.ticket,
  startedAt: timeEntry.startedAt,
  stoppedAt: timeEntry.stoppedAt,
  calendarEvent: timeEntry.calendarEvent,
}

function assertCanWrite(scope: Scope, userId: string) {
  if (userId !== scope.userId && !isAdmin(scope)) {
    throw new AppError('FORBIDDEN', 'entry_forbidden')
  }
}

// An admin writing another user's entry: that user must be in the organization.
async function assertMember(db: Executor, scope: Scope, userId: string) {
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, scope.organizationId), eq(member.userId, userId)))
  if (!membership) throw new AppError('NOT_FOUND', 'member_not_found')
}

async function findEntry(db: Database, scope: Scope, id: string) {
  const [entry] = await db
    .select()
    .from(timeEntry)
    .where(and(eq(timeEntry.id, id), live(timeEntry, scope)))
  if (!entry) throw new AppError('NOT_FOUND', 'entry_not_found')
  return entry
}

const day = 24 * 60 * 60 * 1000

// Refuses a new entry when the user already has limits.entriesPerMemberPerDay entries in
// the organization starting within a day of it. Moving an entry checks the same, without
// counting the entry itself. The (organization_id, user_id, started_at) index makes this
// one short range read.
export async function assertEntryRoom(
  db: Executor,
  organizationId: string,
  userId: string,
  startedAt: Date,
  movingId?: string,
) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(timeEntry)
    .where(
      and(
        live(timeEntry, { organizationId }),
        eq(timeEntry.userId, userId),
        gt(timeEntry.startedAt, new Date(startedAt.getTime() - day)),
        lt(timeEntry.startedAt, new Date(startedAt.getTime() + day)),
        movingId ? ne(timeEntry.id, movingId) : undefined,
      ),
    )
  if (total >= limits.entriesPerMemberPerDay) {
    throw new AppError('LIMIT_REACHED', 'entry_limit')
  }
}

// assertEntryRoom for several new entries at once, each counting the others too. One read
// of the starts from a day before the first to a day after the last.
async function assertBatchRoom(
  db: Executor,
  organizationId: string,
  userId: string,
  starts: readonly Date[],
) {
  const times = starts.map((s) => s.getTime())
  const near = await db
    .select({ startedAt: timeEntry.startedAt })
    .from(timeEntry)
    .where(
      and(
        live(timeEntry, { organizationId }),
        eq(timeEntry.userId, userId),
        gt(timeEntry.startedAt, new Date(Math.min(...times) - day)),
        lt(timeEntry.startedAt, new Date(Math.max(...times) + day)),
      ),
    )
  const saved = near.map((e) => e.startedAt.getTime())
  for (const [i, time] of times.entries()) {
    function within(other: number) {
      return Math.abs(other - time) < day
    }
    const others = times.filter((other, j) => j !== i && within(other)).length
    if (saved.filter(within).length + others >= limits.entriesPerMemberPerDay) {
      throw new AppError('LIMIT_REACHED', 'entry_limit')
    }
  }
}

// The constraint errors an insert of manual entries can meet.
// A user logs a calendar event once. A key on a live entry is refused; one on a deleted entry
// moves to the new entry, since the user asks for it again. The unique index refuses a
// second tab that logs the same key in between (insertError).
async function claimCalendarEvents(db: Executor, userId: string, keys: string[]) {
  if (!keys.length) return
  if (new Set(keys).size < keys.length) throw new AppError('CONFLICT', 'calendar_event_logged')
  const where = and(eq(timeEntry.userId, userId), inArray(timeEntry.calendarEvent, keys))
  const [logged] = await db
    .select({ id: timeEntry.id })
    .from(timeEntry)
    .where(and(where, notDeleted(timeEntry)))
    .limit(1)
  if (logged) throw new AppError('CONFLICT', 'calendar_event_logged')
  await db
    .update(timeEntry)
    .set({ calendarEvent: null })
    .where(and(where, eq(timeEntry.sysDeleted, true)))
}

function insertError(error: unknown) {
  if (failedConstraint(error) === 'time_entry.user_id, time_entry.calendar_event') {
    return new AppError('CONFLICT', 'calendar_event_logged')
  }
  if (failedConstraint(error) === 'time_entry.id') {
    return new AppError('CONFLICT', 'entry_id_taken')
  }
  // Deleted since assertUsableProject found it.
  if (failedConstraint(error) === 'time_entry_live_project') {
    return new AppError('NOT_FOUND', 'project_not_found')
  }
  return error
}

export async function createEntry(db: Database, scope: Scope, input: CreateEntryInput) {
  const userId = input.userId ?? scope.userId
  assertCanWrite(scope, userId)
  await allInOrder([
    userId !== scope.userId && assertMember(db, scope, userId),
    input.projectId && assertUsableProject(db, scope, input.projectId),
    assertEntryRoom(db, scope.organizationId, userId, input.startedAt),
  ])

  try {
    if (input.calendarEvent) await claimCalendarEvents(db, userId, [input.calendarEvent])
    const [entry] = await db
      .insert(timeEntry)
      .values({
        id: input.id,
        organizationId: scope.organizationId,
        userId,
        projectId: input.projectId ?? null,
        description: input.description,
        ticket: input.ticket ?? null,
        startedAt: input.startedAt,
        stoppedAt: input.stoppedAt,
        calendarEvent: input.calendarEvent ?? null,
      })
      .returning(entryColumns)
    return entry
  } catch (error) {
    throw insertError(error)
  }
}

// Entries of the same work at several times, all or none: one transaction holds the checks
// and the insert. An entry's own description, project, ticket, and calendar event replace
// the call's, as when logging several meetings. Answers them in input order. A retried call ends on the first id, with
// entry_id_taken, after the first call saved them all.
export async function createEntries(db: Database, scope: Scope, input: CreateEntriesInput) {
  const userId = input.userId ?? scope.userId
  assertCanWrite(scope, userId)
  function projectOf(e: CreateEntriesInput['entries'][number]) {
    return e.projectId === undefined ? input.projectId : e.projectId
  }
  const projectIds = [...new Set(input.entries.map(projectOf).filter((id) => !!id))] as string[]
  const keys = input.entries.flatMap((e) => (e.calendarEvent ? [e.calendarEvent] : []))
  try {
    const created = await db.transaction(async (tx) => {
      await allInOrder([
        userId !== scope.userId && assertMember(tx, scope, userId),
        ...projectIds.map((id) => assertUsableProject(tx, scope, id)),
        claimCalendarEvents(tx, userId, keys),
        assertBatchRoom(
          tx,
          scope.organizationId,
          userId,
          input.entries.map((e) => e.startedAt),
        ),
      ])
      return tx
        .insert(timeEntry)
        .values(
          input.entries.map((e) => ({
            id: e.id,
            organizationId: scope.organizationId,
            userId,
            projectId: projectOf(e) ?? null,
            description: e.description ?? input.description,
            ticket: (e.ticket === undefined ? input.ticket : e.ticket) ?? null,
            startedAt: e.startedAt,
            stoppedAt: e.stoppedAt,
            calendarEvent: e.calendarEvent ?? null,
          })),
        )
        .returning(entryColumns)
    })
    // SQLite returns inserted rows in no set order.
    const order = new Map(input.entries.map((e, i) => [e.id, i]))
    return created.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  } catch (error) {
    throw insertError(error)
  }
}

// Updates the fields present in input. A running entry keeps running: stop it with
// stopTimer, not by setting stoppedAt here.
export async function updateEntry(db: Database, scope: Scope, input: UpdateEntryInput) {
  const entry = await findEntry(db, scope, input.id)
  assertCanWrite(scope, entry.userId)

  if (input.stoppedAt && !entry.stoppedAt) {
    throw new AppError('INVALID', 'entry_running')
  }
  const startedAt = input.startedAt ?? entry.startedAt
  const stoppedAt = input.stoppedAt ?? entry.stoppedAt
  if (stoppedAt && stoppedAt <= startedAt) {
    throw new AppError('INVALID', 'entry_end_before_start')
  }
  if (stoppedAt && stoppedAt.getTime() - startedAt.getTime() > MAX_ENTRY_MS) {
    throw new AppError('INVALID', 'entry_too_long')
  }
  await allInOrder([
    // Keeping an archived project is fine; moving time onto one is not.
    input.projectId &&
      input.projectId !== entry.projectId &&
      assertUsableProject(db, scope, input.projectId),
    input.startedAt &&
      input.startedAt.getTime() !== entry.startedAt.getTime() &&
      assertEntryRoom(db, scope.organizationId, entry.userId, input.startedAt, entry.id),
  ])

  // The checks above read the entry before the update, so a concurrent edit of the other
  // end can still make it too long or end before it starts, and the new project can be
  // deleted in between. The database refuses all three (time_entry_stopped_after_started,
  // time_entry_max_length, time_entry_live_project).
  try {
    const [updated] = await db
      .update(timeEntry)
      .set({
        projectId: input.projectId,
        description: input.description,
        ticket: input.ticket,
        startedAt: input.startedAt,
        stoppedAt: input.stoppedAt,
      })
      .where(and(eq(timeEntry.id, entry.id), live(timeEntry, scope)))
      .returning(entryColumns)
    if (!updated) throw new AppError('NOT_FOUND', 'entry_not_found')
    return updated
  } catch (error) {
    if (failedConstraint(error) === 'time_entry_stopped_after_started') {
      throw new AppError('INVALID', 'entry_end_before_start')
    }
    if (failedConstraint(error) === 'time_entry_max_length') {
      throw new AppError('INVALID', 'entry_too_long')
    }
    if (failedConstraint(error) === 'time_entry_live_project') {
      throw new AppError('NOT_FOUND', 'project_not_found')
    }
    throw error
  }
}

// Logical delete: the row stays, with sys_deleted set and updated_by recording who.
export async function deleteEntry(db: Database, scope: Scope, input: DeleteEntryInput) {
  const entry = await findEntry(db, scope, input.id)
  assertCanWrite(scope, entry.userId)
  await db
    .update(timeEntry)
    .set({ sysDeleted: true })
    .where(and(eq(timeEntry.id, entry.id), live(timeEntry, scope)))
  return { id: entry.id }
}

// Logical deletes of several entries, all or none, as Undo takes back a createEntries. Every
// one must exist and be the user's to write.
export async function deleteEntries(db: Database, scope: Scope, input: DeleteEntriesInput) {
  const ids = [...new Set(input.ids)]
  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: timeEntry.id, userId: timeEntry.userId })
      .from(timeEntry)
      .where(and(inArray(timeEntry.id, ids), live(timeEntry, scope)))
    if (found.length < ids.length) throw new AppError('NOT_FOUND', 'entry_not_found')
    for (const entry of found) assertCanWrite(scope, entry.userId)
    await tx
      .update(timeEntry)
      .set({ sysDeleted: true })
      .where(and(inArray(timeEntry.id, ids), live(timeEntry, scope)))
    return { ids }
  })
}

// Entries overlapping [from, to), newest first, including a running one. Members see their
// own; team leads also their teams' members'; admins and owners everyone's.
async function assertReadable(db: Database, scope: Scope, userId: string) {
  const readable = await readableUserIds(db, scope)
  if (readable && !readable.includes(userId)) {
    throw new AppError('FORBIDDEN', 'entries_forbidden')
  }
}

// When the user's earliest entry in the organization started, or null without entries.
export async function getFirstEntryStart(
  db: Database,
  scope: Scope,
  input: GetFirstEntryStartInput,
) {
  await assertReadable(db, scope, input.userId)
  const [row] = await db
    .select({ startedAt: min(timeEntry.startedAt) })
    .from(timeEntry)
    .where(and(live(timeEntry, scope), eq(timeEntry.userId, input.userId)))
  return row?.startedAt ?? null
}

export async function listEntries(db: Database, scope: Scope, input: ListEntriesInput) {
  const readable = await readableUserIds(db, scope)
  if (input.userId && readable && !readable.includes(input.userId)) {
    throw new AppError('FORBIDDEN', 'entries_forbidden')
  }
  const users = input.userId ? [input.userId] : readable

  return db
    .select(entryColumns)
    .from(timeEntry)
    .where(
      and(
        live(timeEntry, scope),
        users ? inArray(timeEntry.userId, users) : undefined,
        gt(timeEntry.startedAt, new Date(input.from.getTime() - MAX_ENTRY_MS)),
        lt(timeEntry.startedAt, input.to),
        or(isNull(timeEntry.stoppedAt), gt(timeEntry.stoppedAt, input.from)),
      ),
    )
    .orderBy(desc(timeEntry.startedAt))
}
